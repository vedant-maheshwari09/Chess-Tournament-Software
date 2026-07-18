import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useLocation, Link, useSearch } from "wouter";
import { useForm, FormProvider } from "react-hook-form";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  ArrowLeft,
  Calendar,
  Check,
  CheckCircle2,
  Clock,
  CreditCard,
  Loader2,
  Mail,
  MapPin,
  Pencil,
  Plus,
  Save,
  Shield,
  Trash2,
  Trophy,
  User,
  Users,
  Wallet,
  X,
  ShieldCheck,
  ChevronRight,
} from "lucide-react";
import { zodResolver } from "@hookform/resolvers/zod";
import { loadStripe } from "@stripe/stripe-js";
import type { Stripe } from "@stripe/stripe-js";
import { Elements, useStripe, useElements, PaymentElement } from "@stripe/react-stripe-js";

import { cn, slugify } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { apiRequest } from "@/lib/queryClient";

import {
  parseTournamentConfig,
  type EntryFeeRule,
  type PaymentSettings,
  DEFAULT_REGISTRATION_FIELDS,
  type RegistrationFormField,
} from "@/lib/tournament-config";
import type { Tournament, Player, PlayerRegistration } from "@shared/schema";

import {
  registrationSchema,
  type RegistrationFormValues,
  DEFAULT_FORM_VALUES,
  type PaymentsConfigResponse,
  type PaymentIntentResponse,
  type PaymentTotals,
  type PlayerDraft,
  type RegistrationDraft,
  loadDraft,
  saveDraft,
  clearDraft,
  type SectionOption,
  COUNTRY_OPTIONS,
  type TournamentRegistrationFormProps,
} from "./types";

import {
  formatDate,
  statusStyles,
  SECTION_FALLBACKS,
  DEBUG_LOG,
  ratingWithinSectionRange,
  filterEntryFeesBySection,
  formatCurrency,
  computePaymentTotals,
  parseContribution,
  mapStripeStatus,
  derivePlayerRating,
  NO_ENTRY_FEE_ID,
} from "./helpers";

import StepOne from "./step-one";
import StepTwo from "./step-two";
import StepThree from "./step-three";
import { Field } from "./components";


interface ResumeCheckoutInnerProps {
  tournamentName: string;
}

function ResumeCheckoutInner({ tournamentName }: ResumeCheckoutInnerProps) {
  const stripe = useStripe();
  const elements = useElements();
  const { toast } = useToast();
  const [isProcessing, setIsProcessing] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stripe || !elements) return;

    setIsProcessing(true);
    try {
      const { error } = await stripe.confirmPayment({
        elements,
        confirmParams: {
          return_url: `${window.location.origin}/tournaments/${slugify(tournamentName)}/register?payment=complete`,
        },
      });

      if (error) {
        toast({
          title: "Payment Failed",
          description: error.message ?? "Something went wrong while confirming your payment.",
          variant: "destructive",
        });
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="mt-4 space-y-4 rounded-xl border border-slate-200 bg-slate-50/50 p-4 shadow-inner">
      <h3 className="text-sm font-semibold text-slate-800 flex items-center gap-1.5">
        <CreditCard className="h-4 w-4 text-slate-500" />
        Complete Payment to Secure Entry
      </h3>
      <p className="text-xs text-slate-500">
        You registered but have an outstanding payment. Enter your card details below to complete registration.
      </p>
      
      <PaymentElement />

      <Button type="submit" className="w-full mt-4" disabled={isProcessing || !stripe || !elements}>
        {isProcessing ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Processing...
          </>
        ) : (
          "Complete Payment & Submit"
        )}
      </Button>
    </form>
  );
}

interface ResumeCheckoutProps {
  paymentIntentId: string;
  tournamentName: string;
}

function ResumeCheckout({ paymentIntentId, tournamentName }: ResumeCheckoutProps) {
  const [stripePromise, setStripePromise] = useState<Promise<Stripe | null> | null>(null);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchSecret() {
      try {
        const res = await fetch(`/api/payments/intent/${paymentIntentId}`);
        if (!res.ok) throw new Error("Failed to fetch payment details");
        const data = await res.json();
        setClientSecret(data.clientSecret);
        if (data.publishableKey) {
          setStripePromise(loadStripe(data.publishableKey));
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    if (paymentIntentId) {
      fetchSecret();
    }
  }, [paymentIntentId]);

  if (loading) {
    return (
      <div className="mt-6 flex items-center justify-center p-6 border border-slate-100 rounded-xl bg-slate-50/30">
        <Loader2 className="h-5 w-5 animate-spin text-slate-400 mr-2" />
        <span className="text-xs text-slate-500">Loading payment form...</span>
      </div>
    );
  }

  if (!stripePromise || !clientSecret) {
    return null;
  }

  return (
    <Elements stripe={stripePromise} options={{ clientSecret }}>
      <ResumeCheckoutInner tournamentName={tournamentName} />
    </Elements>
  );
}


export default function TournamentRegistrationFormPage({ tournamentId }: TournamentRegistrationFormProps) {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const searchString = useSearch();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [currentStep, setCurrentStep] = useState(1);
  const [draftRestored, setDraftRestored] = useState(false);
  const [draftSavedFlash, setDraftSavedFlash] = useState(false);
  const [isAutosaving, setIsAutosaving] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);

  const queryParams = useMemo(() => new URLSearchParams(searchString), [searchString]);
  const isPreviewMode = useMemo(() => {
    return queryParams.get("preview") === "true" || user?.role === "tournament_director";
  }, [queryParams, user]);

  const { data: tournament, isLoading } = useQuery<Tournament>({
    queryKey: [`/api/tournaments/${tournamentId}`],
  });

  const { data: players = [] } = useQuery<Player[]>({
    queryKey: [`/api/tournaments/${tournamentId}/players`],
    enabled: Boolean(tournament),
  });

  const { data: registrations = [] } = useQuery<PlayerRegistration[]>({
    queryKey: ["/api/my-registrations"],
  });

  const { data: paymentsConfigResponse } = useQuery<PaymentsConfigResponse>({
    queryKey: [`/api/tournaments/${tournamentId}/payments/config`],
    enabled: Boolean(tournament),
  });

  const config = useMemo(
    () => (tournament ? parseTournamentConfig(tournament) : null),
    [tournament],
  );

  const hasLookupStep = config?.registers?.entryRequirementType !== "casual";

  const steps = useMemo(() => {
    if (!config) return [];
    const fields = config.registrationFormConfig?.fields || DEFAULT_REGISTRATION_FIELDS;
    const visibleFields = fields.filter(f => f.visible);

    // Group fields into pages based on type === "section"
    const pages: any[] = [];
    let currentPageFields: RegistrationFormField[] = [];
    let currentPageSection: RegistrationFormField | null = null;

    for (const field of visibleFields) {
      if (field.type === "section") {
        if (currentPageSection) {
          if (currentPageFields.length > 0 || currentPageSection.id === "checkoutSection") {
            pages.push({
              section: currentPageSection,
              fields: currentPageFields,
            });
          }
        }
        currentPageSection = field;
        currentPageFields = [];
      } else {
        currentPageFields.push(field);
      }
    }
    if (currentPageSection) {
      if (currentPageFields.length > 0 || currentPageSection.id === "checkoutSection") {
        pages.push({
          section: currentPageSection,
          fields: currentPageFields,
        });
      }
    }

    // Map pages to step definitions
    let detailsCount = 0;
    return pages.map((page, idx) => {
      const isCheckout = page.section?.id === "checkoutSection";
      const isLookup = page.section?.id === "lookupSection" || (!page.section && page.fields.some((f: any) => f.id === "firstName" || f.id === "lastName"));
      
      let type: "lookup" | "details" | "checkout" = "details";
      if (isCheckout) type = "checkout";
      else if (isLookup && config.registers?.entryRequirementType !== "casual") type = "lookup";

      let pageIndex = 0;
      if (type === "details") {
        pageIndex = detailsCount;
        detailsCount++;
      }

      return {
        type,
        pageIndex,
        sectionId: page.section?.id || `section-${idx}`,
        section: page.section,
        title: page.section?.label || `Page ${idx + 1}`,
        description: page.section?.description || "Complete registration details",
        fields: page.fields,
      };
    });
  }, [config, hasLookupStep]);

  const totalSteps = steps.length;
  const progressPercentage = totalSteps > 1 ? ((currentStep - 1) / (totalSteps - 1)) * 100 : 100;
  const stepMeta = useMemo(() => {
    return steps.map(s => ({ title: s.title, description: s.description }));
  }, [steps]);

  // Redirect if online registration has been disabled by the director
  useEffect(() => {
    if (tournament && config && config.registers?.allowSignup === false) {
      setLocation(`/tournaments/${slugify(tournament.name)}`);
    }
  }, [tournament, config, setLocation]);

  const multiPlayerAllowed = Boolean(config?.registers?.allowMultiPlayerSignup);
  const existingRegistrations = registrations.filter(
    (entry) => entry.tournamentId === tournamentId && entry.status !== "cancelled" && entry.status !== "declined"
  );
  const existingRegistration = existingRegistrations[0] ?? null;

  const entryFees = useMemo(() => config?.entryFees ?? [], [config]);
  const sections = useMemo<SectionOption[]>(() => {
    const map = new Map<string, SectionOption>();
    const ensureId = (name: string, id?: string | null) => {
      const key = name.trim().toLowerCase();
      if (!key) return `section-${Math.random().toString(36).slice(2, 8)}`;
      return id?.trim() || `section-${key}`;
    };
    const upsert = (
      name: string | null | undefined,
      ratingMin: number | null | undefined,
      ratingMax: number | null | undefined,
      id?: string | null,
    ) => {
      if (!name || !name.trim()) return;
      const key = name.trim().toLowerCase();
      const normalizedMin = typeof ratingMin === "number" && Number.isFinite(ratingMin) ? ratingMin : null;
      const normalizedMax = typeof ratingMax === "number" && Number.isFinite(ratingMax) ? ratingMax : null;
      const existing = map.get(key);
      map.set(key, {
        id: existing?.id ?? ensureId(name, id),
        name: existing?.name ?? name.trim(),
        ratingMin: existing?.ratingMin ?? normalizedMin,
        ratingMax: existing?.ratingMax ?? normalizedMax,
      });
    };

    if (config?.sections?.length) {
      for (const section of config.sections) {
        upsert(section.name, section.ratingMin, section.ratingMax, section.id);
      }
    }

    if (entryFees.length > 0) {
      for (const fee of entryFees) {
        upsert(fee.section, fee.ratingMin, fee.ratingMax, fee.sectionId);
      }
    }

    if (map.size === 0) {
      const fallback = config?.registers?.playerLimit ? ["Premier", "Championship"] : Object.values(SECTION_FALLBACKS);
      fallback.forEach((name) => upsert(name, null, null));
    }

    return Array.from(map.values());
  }, [config?.sections, config?.registers?.playerLimit, entryFees]);
  const form = useForm<RegistrationFormValues>({
    resolver: zodResolver(registrationSchema),
    defaultValues: {
      lookupMode: "profile",
      ratingProvider: "none",
      firstName: "",
      lastName: "",
      uscfId: "",
      fideId: "",
      uscfRating: "",
      fideRating: "",
      email: "",
      address1: "",
      address2: "",
      city: "",
      state: "",
      postalCode: "",
      country: "United States",
      pairingNotifications: "email",
      newsletter: true,
      sectionChoice: "",
      entryFeeId: "",
      processingContribution: "0",
      paymentAcknowledgement: false,
      byePreference: "none",
      byeRounds: [],
      arrivalTime: "",
      notes: "",
      paymentIntentId: undefined,
      paymentStatus: "unpaid",
      paymentReceiptUrl: undefined,
      paymentMethod: undefined,
      currency: undefined,
      amountDue: undefined,
      amountPaid: undefined,
    },
  });
  const validateCustomFormConfig = (): boolean => {
    let isValid = true;
    const values = form.getValues();
    const fields = config?.registrationFormConfig?.fields || [];
    
    form.clearErrors("customAnswers");

    for (const field of fields) {
      if (!field.isCustom) {
        if (field.visible && field.required) {
          const val = values[field.id as keyof RegistrationFormValues];
          if (val === undefined || val === null || (typeof val === "string" && !val.trim()) || (Array.isArray(val) && val.length === 0)) {
            form.setError(field.id as keyof RegistrationFormValues, {
              type: "manual",
              message: `${field.label} is required`
            });
            isValid = false;
          }
        }
      } else {
        const customVal = values.customAnswers?.[field.id];
        if (field.visible && field.required) {
          if (customVal === undefined || customVal === null || (typeof customVal === "string" && !customVal.trim()) || (Array.isArray(customVal) && customVal.length === 0)) {
            form.setError(`customAnswers.${field.id}` as any, {
              type: "manual",
              message: `${field.label} is required`
            });
            isValid = false;
          }
        }
      }
    }

    // USCF Membership validation if verifyUscfMembership is enabled
    if (config?.registers?.verifyUscfMembership) {
      const uscfId = values.uscfId;
      const uscfRating = values.uscfRating;
      const uscfExpiration = values.customAnswers?.uscfExpiration;

      // 1. Check USCF ID
      if (!uscfId || !/^\d{8}$/.test(uscfId.trim())) {
        form.setError("uscfId", {
          type: "manual",
          message: "Please enter a valid 8-digit USCF ID"
        });
        isValid = false;
      }

      // 2. Check Expiration Date
      if (!uscfExpiration || !/^\d{4}-\d{2}-\d{2}$/.test(uscfExpiration)) {
        form.setError("customAnswers.uscfExpiration" as any, {
          type: "manual",
          message: "USCF Expiration Date is required"
        });
        isValid = false;
      } else {
        const expDate = new Date(uscfExpiration);
        const tourneyStart = config.basic.startDate ? new Date(config.basic.startDate) : new Date();
        if (expDate < tourneyStart) {
          form.setError("customAnswers.uscfExpiration" as any, {
            type: "manual",
            message: `USCF Membership has expired (Expires: ${uscfExpiration}). Must be active through tournament.`
          });
          isValid = false;
        }
      }
    }

    return isValid;
  };

  const paymentSubmitRef = useRef<(() => Promise<boolean>) | null>(null);
  const paymentIntentRequestKeyRef = useRef<string | null>(null);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [isPaymentBusy, setIsPaymentBusy] = useState(false);
  const [isPaymentElementReady, setIsPaymentElementReady] = useState(false);

  const [playerDrafts, setPlayerDrafts] = useState<PlayerDraft[]>([]);
  const [editingDraftId, setEditingDraftId] = useState<string | null>(null);
  const lastSavedStateRef = useRef<string | null>(null);
  const allDraftValues: RegistrationFormValues[] = playerDrafts.map((entry) => entry.values);
  const stripePromise = useMemo(() => {
    if (!paymentsConfigResponse?.publishableKey) {
      return null;
    }
    return loadStripe(paymentsConfigResponse.publishableKey);
  }, [paymentsConfigResponse?.publishableKey]);
  const paymentSettings = paymentsConfigResponse?.payments ?? config?.payments ?? null;
  const canProcessOnline = Boolean(paymentSettings?.onlineEnabled && paymentsConfigResponse?.onlineConfigured && stripePromise);
  const offlineMethodsConfigured = paymentSettings?.acceptedOfflineMethods ?? [];
  const offlineAllowed = offlineMethodsConfigured.length > 0;

  const [watchEntryFeeId, watchContribution, watchFirstName, watchLastName, watchEmail, watchCustomAnswers] = form.watch([
    "entryFeeId",
    "processingContribution",
    "firstName",
    "lastName",
    "email",
    "customAnswers",
  ]);

  const selectedEntryFeeId = (watchEntryFeeId as string) ?? "";
  const selectedEntryFee = useMemo(
    () => entryFees.find((fee) => fee.id === selectedEntryFeeId) ?? null,
    [entryFees, selectedEntryFeeId],
  );
  const processingContributionValue = useMemo(() => parseContribution(watchContribution), [watchContribution]);
  const paymentTotals = useMemo(
    () => computePaymentTotals(selectedEntryFee, processingContributionValue, paymentSettings, watchCustomAnswers),
    [selectedEntryFee, processingContributionValue, paymentSettings, watchCustomAnswers],
  );

  const groupPaymentTotals = useMemo(() => {
    if (!multiPlayerAllowed || playerDrafts.length === 0) {
      return paymentTotals;
    }

    return playerDrafts.reduce((acc, entry) => {
      const values = entry.values;
      const entryFee = entryFees.find(f => f.id === values.entryFeeId) ?? null;
      const contribution = parseContribution(values.processingContribution);
      const totals = computePaymentTotals(entryFee, contribution, paymentSettings, values.customAnswers);

      return {
        subtotal: acc.subtotal + totals.subtotal,
        feeAmount: acc.feeAmount + totals.feeAmount,
        total: acc.total + totals.total,
        currency: totals.currency
      };
    }, {
      subtotal: 0,
      feeAmount: 0,
      total: 0,
      currency: paymentTotals.currency
    });
  }, [playerDrafts, entryFees, paymentSettings, paymentTotals, multiPlayerAllowed]);

  const requiresPayment = Boolean(
    canProcessOnline &&
    (paymentSettings?.requirePaymentOnRegistration || !offlineAllowed) &&
    (multiPlayerAllowed && playerDrafts.length > 0 ? groupPaymentTotals.total > 0 : paymentTotals.total > 0)
  );

  useEffect(() => {
    if (!canProcessOnline) {
      setClientSecret(null);
      paymentIntentRequestKeyRef.current = null;
      form.setValue("paymentIntentId", undefined, { shouldDirty: false });
      form.setValue("paymentStatus", "unpaid", { shouldDirty: false });
      form.setValue("currency", paymentTotals.currency, { shouldDirty: false });
      form.setValue("amountDue", paymentTotals.total, { shouldDirty: false });
      setIsPaymentElementReady(true);
    }
  }, [canProcessOnline, form, paymentTotals.currency, paymentTotals.total]);

  useEffect(() => {
    if (currentStep !== totalSteps) {
      setIsPaymentElementReady(false);
    }
  }, [currentStep, totalSteps]);

  useEffect(() => {
    // CRITICAL for group registrations: If we have multiple registrations, load them into playerDrafts
    if (existingRegistrations.length > 0 && !draftRestored && playerDrafts.length === 0 && !editingDraftId) {
      DEBUG_LOG("Restoring multiple existing registrations into draft roster", existingRegistrations);
      const drafts: PlayerDraft[] = existingRegistrations.map((reg: any, idx) => {
        const names = (reg.playerName || "").split(" ");
        const firstName = names[0] || "";
        const lastName = names.slice(1).join(" ") || "";

        const vals: RegistrationFormValues = {
          ...DEFAULT_FORM_VALUES,
          lookupMode: "manual",
          firstName,
          lastName,
          email: reg.email || "",

          address1: reg.address1 || "",
          address2: reg.address2 || "",
          city: reg.city || "",
          state: reg.state || "",
          postalCode: reg.postalCode || "",
          country: reg.country || "United States",
          sectionChoice: reg.sectionChoice || "",
          entryFeeId: reg.entryFeeId || "",
          processingContribution: (reg.processingContribution || 0).toString(),
          notes: reg.notes || "",
          arrivalTime: reg.arrivalTime || "",
          ratingProvider: (reg as any).ratingProvider || (reg.fideRating ? "fide" : (reg.uscfRating ? "uscf" : "manual")),
          uscfRating: reg.uscfRating?.toString() || "",
          fideRating: reg.fideRating?.toString() || "",
          uscfId: reg.uscfId || "",
          fideId: reg.fideId || "",
          paymentStatus: (reg.paymentStatus as any) || "unpaid",
          pairingNotifications: (reg.pairingNotifications as any) || "email",
          newsletter: Boolean(reg.newsletter),
          byePreference: (reg.byePreference as any) || "none",
          byeRounds: Array.isArray(reg.byeRounds) ? reg.byeRounds : [],
        };

        return {
          id: reg.id?.toString() || `existing-${idx}`,
          values: vals
        };
      });

      // Split: first one to form, rest to drafts
      if (drafts.length > 0) {
        const [first, ...rest] = drafts;
        DEBUG_LOG("Split existing registrations: Applying first to form, others to roster", { first, restCount: rest.length });
        form.reset(first.values);
        setPlayerDrafts(rest);
        setDraftRestored(true);
      }
    }
  }, [existingRegistrations, draftRestored, playerDrafts.length, editingDraftId, form, setPlayerDrafts]);

  useEffect(() => {
    if (user && !draftRestored) {
      const payment = (user.paymentSettings as any) || {};
      if (payment.prizePaymentEnabled) {
        const answers = form.getValues("customAnswers") || {};
        const updatedAnswers = {
          ...answers,
          prizeStripeEmail: payment.prizeStripeEmail || user.email || "",
          prizeBankRouting: payment.prizeBankRouting || "",
          prizeBankAccount: payment.prizeBankAccount || "",
        };
        form.setValue("customAnswers", updatedAnswers, { shouldDirty: false });
      }
    }
  }, [user, draftRestored, form]);

  // --- Restore draft from localStorage on initial mount ---
  useEffect(() => {
    if (draftRestored) return;
    if (isPreviewMode) {
      DEBUG_LOG("Preview mode or tournament director: skipping draft restoration");
      setDraftRestored(true);
      return;
    }
    const draft = loadDraft(tournamentId, user?.id);
    if (draft) {
      DEBUG_LOG("Draft found in localStorage, attempting restoration", draft);
      const { formValues, playerDrafts: savedRoster, currentStep: savedStep, editingDraftId: savedEditingId } = draft;

      // Check if user has entered something or has players in roster
      if (formValues.firstName || formValues.lastName || formValues.email || savedRoster.length > 0) {
        // Merge saved values into form defaults
        const current = form.getValues();
        form.reset({ ...current, ...formValues }, { keepDefaultValues: false });

        // Restore step, roster, and editing state
        if (savedRoster.length > 0) setPlayerDrafts(savedRoster);
        if (savedStep) setCurrentStep(savedStep);
        if (savedEditingId) setEditingDraftId(savedEditingId);

        setDraftRestored(true);
        DEBUG_LOG("Draft restored successfully", { formValues, savedRoster, savedStep, savedEditingId });
        toast({ title: "Draft restored", description: "Your previously saved progress has been loaded." });
      } else {
        DEBUG_LOG("Draft found but was essentially empty, skipping restoration");
        setDraftRestored(true);
      }
    } else {
      DEBUG_LOG("No draft found in localStorage for this tournament");
      setDraftRestored(true);
    }
  }, [draftRestored, existingRegistration, form, toast, tournamentId, isPreviewMode, user]);

  // --- Auto-save form to localStorage on changes (debounced) ---
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const entireFormState = form.watch(); // Watch everything

  useEffect(() => {
    if (isPreviewMode) return;
    const values = form.getValues();
    const hasMeaningfulData = values.firstName || values.lastName || values.email || playerDrafts.length > 0;

    if (!hasMeaningfulData) return;

    // Create a fingerprint of the current state to check if anything actually changed
    const currentStateFingerprint = JSON.stringify({
      formValues: values,
      playerDrafts,
      currentStep,
      editingDraftId
    });

    // If matches last saved, don't trigger timer
    if (currentStateFingerprint === lastSavedStateRef.current) {
      return;
    }

    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);

    autoSaveTimerRef.current = setTimeout(() => {
      // Show "Saving..." only when we are actually performing the save
      setIsAutosaving(true);

      // Brief delay to ensure the "Saving..." state is visible if the save is near-instant
      setTimeout(() => {
        DEBUG_LOG("Auto-saving draft to localStorage...", { values, playerDrafts, currentStep });
        saveDraft(tournamentId, {
          formValues: values,
          playerDrafts,
          currentStep,
          editingDraftId
        }, user?.id);

        lastSavedStateRef.current = currentStateFingerprint;
        setIsAutosaving(false);
        setLastSavedAt(new Date());
      }, 400);
    }, 2000); // 2-second debounce typical of modern web apps

    return () => { if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current); };
  }, [
    entireFormState,
    tournamentId,
    playerDrafts,
    currentStep,
    editingDraftId,
    isPreviewMode,
    user
  ]);

  // --- Manual Save Draft handler ---
  const handleSaveDraft = useCallback(() => {
    if (isPreviewMode) {
      toast({
        title: "Draft manual save disabled",
        description: "You are currently in Preview/Testing mode. Progress is not saved.",
        variant: "destructive"
      });
      return;
    }
    const values = form.getValues();
    const draft = {
      formValues: values,
      playerDrafts,
      currentStep,
      editingDraftId
    };
    DEBUG_LOG("Manually saving draft...", draft);
    saveDraft(tournamentId, draft, user?.id);
    lastSavedStateRef.current = JSON.stringify(draft);
    setDraftSavedFlash(true);
    setLastSavedAt(new Date());
    toast({ title: "Draft saved", description: "Your progress has been saved. You can return later to finish." });
    setTimeout(() => setDraftSavedFlash(false), 2000);
  }, [form, tournamentId, toast, playerDrafts, currentStep, editingDraftId, isPreviewMode, user]);

  const registerMutation = useMutation({
    mutationFn: async (values: RegistrationFormValues) => {
      const parsedUscf = parseInt(values.uscfRating || "", 10);
      const parsedFide = parseInt(values.fideRating || "", 10);
      const payload = {
        playerName: `${values.firstName} ${values.lastName}`.trim(),
        uscfRating: Number.isFinite(parsedUscf) ? parsedUscf : null,
        fideRating: Number.isFinite(parsedFide) ? parsedFide : null,
        uscfRatingRaw: values.uscfRatingRaw || values.uscfRating || null,
        fideRatingRaw: values.fideRatingRaw || values.fideRating || null,
        ratingProvider: values.ratingProvider === "none" ? null : (values.ratingProvider || null),
        uscfId: values.uscfId || null,
        fideId: values.fideId || null,
        sectionChoice: values.sectionChoice,
        email: values.email,
        address1: values.address1,
        address2: values.address2,
        city: values.city,
        state: values.state,
        postalCode: values.postalCode,
        country: values.country,
        pairingNotifications: values.pairingNotifications,
        newsletter: values.newsletter,
        entryFeeId: values.entryFeeId,
        processingContribution: parseContribution(values.processingContribution),
        byePreference: values.byePreference,
        byeRounds: values.byePreference === "yes" ? values.byeRounds : [],
        arrivalTime: values.arrivalTime,
        notes: values.notes,
        paymentIntentId: values.paymentIntentId,
        paymentStatus: values.paymentStatus,
        paymentReceiptUrl: values.paymentReceiptUrl,
        paymentMethod: values.paymentMethod,
        currency: values.currency,
        amountDue: typeof values.amountDue === "number" ? values.amountDue : undefined,
        amountPaid: typeof values.amountPaid === "number" ? values.amountPaid : undefined,
        customAnswers: values.customAnswers ?? {},
      };

      DEBUG_LOG("Submitting single registration mutation payload", payload);

      const data = await apiRequest(`/api/tournaments/${tournamentId}/register`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      DEBUG_LOG("Single registration mutation response", data);
      return data;
    },
    onSuccess: (data) => {
      clearDraft(tournamentId, user?.id);
      toast({
        title: "Registration submitted",
        description: "Your registration request has been sent to the tournament director.",
      });

      // Optimistically insert our newly created 'pending' registration to prevent UI reverting to an outdated cached 'approved' state
      queryClient.setQueryData<PlayerRegistration[]>(["/api/my-registrations"], (old) => {
        if (!old) return [data];
        return [...old.filter(r => r.tournamentId !== tournamentId), data];
      });

      queryClient.invalidateQueries({ queryKey: ["/api/my-registrations"] });
      queryClient.invalidateQueries({ queryKey: [`/api/tournaments/${tournamentId}/players`] });
      setCurrentStep(totalSteps);
      paymentSubmitRef.current = null;
      setClientSecret(null);
      paymentIntentRequestKeyRef.current = null;
    },
    onError: (error: Error) => {
      toast({
        title: "Registration failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const createPaymentIntent = useMutation({
    mutationFn: async (body: {
      entryFeeId?: string;
      contribution: number;
      receiptEmail?: string;
      playerName?: string;
      items?: Array<{ entryFeeId?: string; contribution: number; playerName?: string }>;
    }) => {
      const response = await apiRequest(`/api/tournaments/${tournamentId}/payments/intent`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      return response as PaymentIntentResponse;
    },
    onSuccess: (data) => {
      setClientSecret(data.clientSecret);
      form.setValue("paymentIntentId", data.paymentIntentId, { shouldDirty: false });
      form.setValue("currency", data.currency, { shouldDirty: false });
      form.setValue("amountDue", data.amount, { shouldDirty: false });
      form.setValue("amountPaid", 0, { shouldDirty: false });
      form.setValue("paymentStatus", "unpaid", { shouldDirty: false });
      setIsPaymentElementReady(false);

      const items = allDraftValues.map(d => {
        const id = d.entryFeeId && d.entryFeeId !== NO_ENTRY_FEE_ID ? d.entryFeeId : "offline";
        const c = parseContribution(d.processingContribution);
        const name = `${d.firstName ?? ""} ${d.lastName ?? ""}`.trim().toLowerCase();
        return `${id}|${c.toFixed(2)}|${name}`;
      });

      const currentEntryFeeIdRaw = form.getValues("entryFeeId");
      const normalizedEntryFeeId = currentEntryFeeIdRaw && currentEntryFeeIdRaw !== NO_ENTRY_FEE_ID ? currentEntryFeeIdRaw : "offline";
      const currentContribution = parseContribution(form.getValues("processingContribution"));
      const currentName = `${form.getValues("firstName") ?? ""} ${form.getValues("lastName") ?? ""}`.trim().toLowerCase();

      items.push(`${normalizedEntryFeeId}|${currentContribution.toFixed(2)}|${currentName}`);

      const email = (form.getValues("email") ?? "").trim().toLowerCase();
      paymentIntentRequestKeyRef.current = `${items.join(";")}|${email}`;
    },
    onError: (error: Error) => {
      // Do NOT reset paymentIntentRequestKeyRef.current to null, to prevent infinite reload loop!
      toast({
        title: "Payment setup failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const ensurePaymentIntent = useCallback(async () => {
    if (!canProcessOnline || createPaymentIntent.isPending || !requiresPayment) {
      return;
    }

    const currentEntryFeeIdRaw = form.getValues("entryFeeId");
    const normalizedEntryFeeId = currentEntryFeeIdRaw && currentEntryFeeIdRaw !== NO_ENTRY_FEE_ID ? currentEntryFeeIdRaw : undefined;

    if (!normalizedEntryFeeId && requiresPayment && allDraftValues.length === 0) {
      paymentIntentRequestKeyRef.current = null;
      return;
    }

    const contribution = parseContribution(form.getValues("processingContribution"));
    const receiptEmail = (form.getValues("email") ?? "").trim();
    const playerName = `${form.getValues("firstName") ?? ""} ${form.getValues("lastName") ?? ""}`.trim();

    const itemsPayload = allDraftValues.map(draft => {
      const eFee = draft.entryFeeId && draft.entryFeeId !== NO_ENTRY_FEE_ID ? draft.entryFeeId : undefined;
      const c = parseContribution(draft.processingContribution);
      const name = `${draft.firstName ?? ""} ${draft.lastName ?? ""}`.trim();
      return { entryFeeId: eFee, contribution: c, playerName: name };
    });

    itemsPayload.push({
      entryFeeId: normalizedEntryFeeId,
      contribution,
      playerName,
    });

    const itemsKey = itemsPayload.map(i => `${i.entryFeeId ?? "offline"}|${i.contribution.toFixed(2)}|${i.playerName.toLowerCase()}`).join(";");
    const requestKey = `${itemsKey}|${receiptEmail.toLowerCase()}`;

    if (paymentIntentRequestKeyRef.current === requestKey && clientSecret) {
      return;
    }

    paymentIntentRequestKeyRef.current = requestKey;
    try {
      await createPaymentIntent.mutateAsync({
        contribution: 0,
        receiptEmail: receiptEmail || undefined,
        items: itemsPayload,
      });
    } catch {
      // Do NOT reset paymentIntentRequestKeyRef to null, to prevent infinite reload loop!
    }
  }, [canProcessOnline, createPaymentIntent, form, clientSecret, requiresPayment, toast, allDraftValues]);

  const forceRetryPaymentIntent = useCallback(() => {
    paymentIntentRequestKeyRef.current = null;
    ensurePaymentIntent();
  }, [ensurePaymentIntent]);

  useEffect(() => {
    if (currentStep !== totalSteps) {
      return;
    }
    if (!canProcessOnline || !requiresPayment) {
      setIsPaymentElementReady(true);
      return;
    }
    ensurePaymentIntent();
  }, [
    currentStep,
    canProcessOnline,
    requiresPayment,
    ensurePaymentIntent,
    watchEntryFeeId,
    watchContribution,
    watchFirstName,
    watchLastName,
    watchEmail,
  ]);

  const paymentAcknowledged = form.watch("paymentAcknowledgement");

  const setPaymentSubmitHandler = useCallback((fn: (() => Promise<boolean>) | null) => {
    paymentSubmitRef.current = fn;
  }, []);

  const groupRegisterMutation = useMutation({
    mutationFn: async (players: RegistrationFormValues[]) => {
      const payloadArray = players.map(values => {
        const parsedUscf = parseInt(values.uscfRating || "", 10);
        const parsedFide = parseInt(values.fideRating || "", 10);
        return {
          playerName: `${values.firstName} ${values.lastName}`.trim(),
          uscfRating: Number.isFinite(parsedUscf) ? parsedUscf : null,
          fideRating: Number.isFinite(parsedFide) ? parsedFide : null,
          uscfRatingRaw: values.uscfRatingRaw || values.uscfRating || null,
          fideRatingRaw: values.fideRatingRaw || values.fideRating || null,
          ratingProvider: values.ratingProvider === "none" ? null : (values.ratingProvider || null),
          uscfId: values.uscfId || null,
          fideId: values.fideId || null,
          sectionChoice: values.sectionChoice,
        email: values.email,
        address1: values.address1,
        address2: values.address2,
        city: values.city,
        state: values.state,
        postalCode: values.postalCode,
        country: values.country,
        pairingNotifications: values.pairingNotifications,
        newsletter: values.newsletter,
        entryFeeId: values.entryFeeId,
        processingContribution: parseContribution(values.processingContribution),
        byePreference: values.byePreference,
        byeRounds: values.byePreference === "yes" ? values.byeRounds : [],
        arrivalTime: values.arrivalTime,
        notes: values.notes,
        paymentIntentId: values.paymentIntentId,
        paymentStatus: values.paymentStatus,
        paymentReceiptUrl: values.paymentReceiptUrl,
        paymentMethod: values.paymentMethod,
        currency: values.currency,
        amountDue: typeof values.amountDue === "number" ? values.amountDue : undefined,
        amountPaid: typeof values.amountPaid === "number" ? values.amountPaid : undefined,
        customAnswers: values.customAnswers ?? {},
      };
    });

      DEBUG_LOG("Submitting batch registration mutation payload", payloadArray);

      const data = await apiRequest(`/api/tournaments/${tournamentId}/register-batch`, {
        method: "POST",
        body: JSON.stringify(payloadArray),
      });
      DEBUG_LOG("Batch registration mutation response", data);
      return data;
    },
    onSuccess: (data) => {
      clearDraft(tournamentId, user?.id);
      toast({
        title: "Registrations submitted",
        description: "Your registration requests have been sent to the tournament director.",
      });

      // Optimistically insert our newly created 'pending' registrations
      queryClient.setQueryData<PlayerRegistration[]>(["/api/my-registrations"], (old) => {
        if (!old) return data;
        return [...old.filter(r => r.tournamentId !== tournamentId), ...data];
      });

      queryClient.invalidateQueries({ queryKey: ["/api/my-registrations"] });
      queryClient.invalidateQueries({ queryKey: [`/api/tournaments/${tournamentId}/players`] });
      setPlayerDrafts([]);
      setEditingDraftId(null);
      paymentSubmitRef.current = null;
      setClientSecret(null);
      paymentIntentRequestKeyRef.current = null;

      // Navigate to remove 'edit=true' so the success screen (Pending) shows correctly
      const newUrl = window.location.pathname;
      window.history.replaceState({}, '', newUrl);

      setCurrentStep(totalSteps);
    },
    onError: (error: Error) => {
      toast({
        title: "Registration failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const saveRegistrationBeforePayment = useCallback(async () => {
    try {
      const values = form.getValues();
      // Ensure the paymentStatus is set to unpaid initially
      form.setValue("paymentStatus", "unpaid", { shouldDirty: false });

      if (multiPlayerAllowed && (playerDrafts.length > 0 || editingDraftId)) {
        DEBUG_LOG("Preparing batch list for pre-payment draft write");
        const paymentOverride = {
          paymentIntentId: values.paymentIntentId,
          paymentStatus: "unpaid" as const,
          paymentReceiptUrl: values.paymentReceiptUrl,
          paymentMethod: values.paymentMethod,
          currency: values.currency,
          amountDue: values.amountDue,
          amountPaid: values.amountPaid,
        };

        let list: RegistrationFormValues[] = [];
        if (editingDraftId) {
          list = playerDrafts.map((entry) =>
            entry.id === editingDraftId
              ? { ...values, ...paymentOverride }
              : { ...entry.values, ...paymentOverride }
          );
        } else {
          const rosterValues = playerDrafts.map(e => e.values);
          list = [...rosterValues, values].map(v => ({ ...v, ...paymentOverride }));
        }

        await groupRegisterMutation.mutateAsync(list);
      } else {
        DEBUG_LOG("Preparing single registration for pre-payment draft write", values);
        await registerMutation.mutateAsync(values);
      }
      return true;
    } catch (error) {
      console.error("Failed to save registration before payment", error);
      toast({
        title: "Registration failed",
        description: error instanceof Error ? error.message : "Unable to save registration details. Please try again.",
        variant: "destructive",
      });
      return false;
    }
  }, [editingDraftId, form, groupRegisterMutation, multiPlayerAllowed, playerDrafts, registerMutation, toast]);

  const handleFinalSubmit = useCallback(async () => {
    DEBUG_LOG("Final submit triggered", {
      currentStep,
      multiPlayerAllowed,
      rosterSize: playerDrafts.length,
      currentForm: form.getValues()
    });

    const valid = await form.trigger(undefined, { shouldFocus: true });
    if (!valid) {
      DEBUG_LOG("Final submit blocked: UI validation failed", form.formState.errors, 'warn');
      return;
    }

    if (paymentSubmitRef.current) {
      DEBUG_LOG("Entering payment processing flow...");
      const proceed = await paymentSubmitRef.current();
      if (!proceed) {
        DEBUG_LOG("Payment flow interrupted or failed", null, 'warn');
        return;
      }
      DEBUG_LOG("Payment verification successful or skipped (offline/zero cost)");
    }

    const values = form.getValues();

    // Check if we already registered during the online payment confirmation phase.
    const isOnlinePayment = requiresPayment && canProcessOnline && form.getValues("paymentMethod") !== "offline";
    if (isOnlinePayment) {
      DEBUG_LOG("Online registration already saved and processed. Advancing to Success.");
      clearDraft(tournamentId, user?.id);
      queryClient.invalidateQueries({ queryKey: ["/api/my-registrations"] });
      queryClient.invalidateQueries({ queryKey: [`/api/tournaments/${tournamentId}/players`] });
      setCurrentStep(totalSteps);
      paymentSubmitRef.current = null;
      setClientSecret(null);
      paymentIntentRequestKeyRef.current = null;
      return;
    }

    // In multi-player mode, if there's a roster, we MUST include the current form's values (if filled)
    // as the final entry in the batch, unless it's already in the roster (editing case).
    if (multiPlayerAllowed && (playerDrafts.length > 0 || editingDraftId)) {
      DEBUG_LOG("Processing multi-player batch submission");

      // Payment fields from the final step should propagate to all entries if they are tied to a shared intent
      const paymentOverride = {
        paymentIntentId: values.paymentIntentId,
        paymentStatus: values.paymentStatus,
        paymentReceiptUrl: values.paymentReceiptUrl,
        paymentMethod: values.paymentMethod,
        currency: values.currency,
        amountDue: values.amountDue,
        amountPaid: values.amountPaid,
      };

      // Construct the list of ALL players the user intends to register
      let list: RegistrationFormValues[] = [];

      if (editingDraftId) {
        // We are editing a specific player from the roster
        list = playerDrafts.map((entry) =>
          entry.id === editingDraftId
            ? { ...values, ...paymentOverride }
            : { ...entry.values, ...paymentOverride }
        );
      } else {
        // We have a roster, AND the current form likely contains the final player
        const rosterValues = playerDrafts.map(e => e.values);
        list = [...rosterValues, values].map(v => ({ ...v, ...paymentOverride }));
      }

      DEBUG_LOG("Prepared batch list for submission", list);
      groupRegisterMutation.mutate(list);
      return;
    }

    DEBUG_LOG("Processing single-player registration submission", values);
    registerMutation.mutate(values);
  }, [editingDraftId, form, groupRegisterMutation, multiPlayerAllowed, playerDrafts, registerMutation, currentStep, requiresPayment, canProcessOnline, tournamentId, user?.id, queryClient, totalSteps]);

  const paymentIntentErrorMessage = createPaymentIntent.error
    ? createPaymentIntent.error instanceof Error
      ? createPaymentIntent.error.message
      : "Unable to prepare payment session"
    : null;

  const submitButtonLabel = registerMutation.isPending || groupRegisterMutation.isPending
    ? "Submitting..."
    : isPaymentBusy
      ? "Processing payment..."
      : requiresPayment
        ? "Pay & submit"
        : "Submit registration";

  const disableSubmitButton =
    registerMutation.isPending ||
    groupRegisterMutation.isPending ||
    isPaymentBusy ||
    (requiresPayment && canProcessOnline && (!clientSecret || createPaymentIntent.isPending || !isPaymentElementReady));

  // ===== Hooks must be declared before any conditional returns =====

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f7f6f3]">
        <div className="text-center">
          <div className="mx-auto h-10 w-10 animate-spin rounded-full border-2 border-gray-200 border-t-blue-600"></div>
          <p className="mt-4 text-sm text-gray-500">Loading registration form...</p>
        </div>
      </div>
    );
  }

  if (!tournament || !config) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f7f6f3] px-4">
        <div className="w-full max-w-md">
          <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
            <div className="p-8 text-center">
              <ShieldCheck className="mx-auto mb-4 h-10 w-10 text-gray-400" />
              <h2 className="text-lg font-semibold text-gray-900">Tournament unavailable</h2>
              <p className="mt-2 text-sm leading-relaxed text-gray-500">
                This registration form could not be loaded. This might happen if the tournament has been archived, paused, or deleted.
              </p>
              <Button
                className="mt-6 w-full"
                onClick={() => setLocation(`/tournaments/${tournament ? slugify(tournament.name) : tournamentId}`)}
              >
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back to Tournament Page
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const searchParams = new URLSearchParams(searchString);
  const isEditing = searchParams.get("edit") === "true";

  if (existingRegistration && !isEditing) {
    return (
      <div className="min-h-screen bg-transparent">
        <div className="border-b border-gray-200 bg-white">
          <div className="mx-auto flex max-w-4xl flex-col gap-3 px-4 py-5 sm:px-6 lg:px-8">
            <div className="flex items-center gap-3">
              <Button
                variant="ghost"
                size="sm"
                className="gap-1.5 text-sm font-medium text-gray-500 hover:text-gray-900"
                onClick={() => setLocation(`/tournaments/${slugify(tournament.name)}`)}
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Back to tournament
              </Button>
            </div>
            <h1 className="text-xl font-semibold tracking-tight text-gray-900">{tournament.name}</h1>
          </div>
        </div>

        <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
          <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
            {existingRegistration.status === 'approved' ? (
              <div className="flex items-center gap-3 border-b border-gray-100 bg-emerald-50 px-6 py-4">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-100">
                  <Check className="h-4 w-4 text-emerald-600" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-gray-900">Registration Accepted</h2>
                  <p className="text-xs text-gray-500">You are fully registered for this tournament.</p>
                </div>
              </div>
            ) : existingRegistration.status === 'declined' ? (
              <div className="flex items-center gap-3 border-b border-gray-100 bg-red-50 px-6 py-4">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-red-100">
                  <X className="h-4 w-4 text-red-600" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-gray-900">Registration Declined</h2>
                  <p className="text-xs text-gray-500">Your registration for this tournament was declined.</p>
                </div>
              </div>
            ) : (
              <div className={cn(
                "flex items-center gap-3 border-b border-gray-100 px-6 py-4",
                existingRegistration.paymentStatus === 'unpaid' && config?.payments?.onlineEnabled ? "bg-red-50" : "bg-blue-50"
              )}>
                <div className={cn(
                  "flex h-8 w-8 items-center justify-center rounded-full",
                  existingRegistration.paymentStatus === 'unpaid' && config?.payments?.onlineEnabled ? "bg-red-100" : "bg-blue-100"
                )}>
                  {existingRegistration.paymentStatus === 'unpaid' && config?.payments?.onlineEnabled ? (
                    <AlertCircle className="h-4 w-4 text-red-600" />
                  ) : (
                    <Clock className="h-4 w-4 text-blue-600" />
                  )}
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-gray-900">
                    {existingRegistration.paymentStatus === 'unpaid' && config?.payments?.onlineEnabled ? "Payment Required" : "Registration Pending"}
                  </h2>
                  <p className="text-xs text-gray-500">
                    {existingRegistration.paymentStatus === 'unpaid' && config?.payments?.onlineEnabled 
                      ? "Complete your payment below to secure your entry." 
                      : "Your entry is being reviewed by the tournament director."}
                  </p>
                </div>
              </div>
            )}
            <div className="p-6">
              <div className="grid grid-cols-2 gap-4 text-sm">
                {existingRegistration.playerName && (
                  <div className="rounded-lg border border-slate-100 bg-slate-50/70 p-3">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Player Name</p>
                    <p className="mt-1 font-medium text-slate-900">{existingRegistration.playerName}</p>
                  </div>
                )}
                {existingRegistration.uscfRating && (
                  <div className="rounded-lg border border-slate-100 bg-slate-50/70 p-3">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">USCF Rating</p>
                    <p className="mt-1 font-medium text-slate-900">{existingRegistration.uscfRating}</p>
                  </div>
                )}
                {existingRegistration.email && (
                  <div className="col-span-2 rounded-lg border border-slate-100 bg-slate-50/70 p-3">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Email</p>
                    <p className="mt-1 font-medium text-slate-900">{existingRegistration.email}</p>
                  </div>
                )}
              </div>
              {existingRegistration.paymentStatus === 'unpaid' && existingRegistration.paymentIntentId && config?.payments?.onlineEnabled ? (
                <ResumeCheckout paymentIntentId={existingRegistration.paymentIntentId} tournamentName={tournament.name} />
              ) : (
                <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                  We&apos;ll notify you once the tournament director processes your registration.
                </div>
              )}
              <Button className="mt-6 w-full" onClick={() => setLocation(`/tournaments/${slugify(tournament.name)}`)}>Return to tournament page</Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const startDateText = formatDate(config.basic.startDate ?? tournament.createdAt);
  const endDateText = formatDate(config.basic.endDate ?? config.basic.startDate);
  const playerCount = players.length;
  const playerLimit = config.registers?.playerLimit ?? null;

  const validateStepFields = async (step: typeof steps[number]): Promise<boolean> => {
    let isValid = true;
    const values = form.getValues();

    if (step.type === "lookup") {
      const lookupFields: (keyof RegistrationFormValues)[] = [];
      const fields = config?.registrationFormConfig?.fields || DEFAULT_REGISTRATION_FIELDS;
      
      const firstNameConfig = fields.find(f => f.id === "firstName");
      if (firstNameConfig?.visible) lookupFields.push("firstName");
      
      const lastNameConfig = fields.find(f => f.id === "lastName");
      if (lastNameConfig?.visible) lookupFields.push("lastName");
      
      const emailConfig = fields.find(f => f.id === "email");
      if (emailConfig?.visible) lookupFields.push("email");
      
      const sectionConfig = fields.find(f => f.id === "sectionChoice");
      if (sectionConfig?.visible) lookupFields.push("sectionChoice");
      
      const ratingConfig = fields.find(f => f.id === "ratingProvider");
      if (ratingConfig?.visible) lookupFields.push("ratingProvider");

      if (config?.registers?.verifyUscfMembership) {
        lookupFields.push("uscfId");
      }

      if (lookupFields.length > 0) {
        isValid = await form.trigger(lookupFields, { shouldFocus: true });
      }

      if (isValid && config?.registers?.verifyUscfMembership) {
        const uscfId = values.uscfId;
        if (!uscfId || !/^\d{8}$/.test(uscfId.trim())) {
          form.setError("uscfId", {
            type: "manual",
            message: "Please enter a valid 8-digit USCF ID"
          });
          isValid = false;
        }
      }
      return isValid;
    }

    if (step.type === "details") {
      const fieldsToTrigger: any[] = [];
      for (const field of step.fields) {
        if (field.type === "section") continue;

        if (field.id === "entryFee") {
          const selectedSection = values.sectionChoice;
          const sectionEntryFees = filterEntryFeesBySection(entryFees, selectedSection, sections);
          if (sectionEntryFees.length > 0) {
            fieldsToTrigger.push("entryFeeId");
          }
        } else if (field.id === "pairingNotifications") {
          fieldsToTrigger.push("pairingNotifications");
        } else if (field.isCustom) {
          fieldsToTrigger.push(`customAnswers.${field.id}`);
        } else {
          fieldsToTrigger.push(field.id);
        }
      }

      if (fieldsToTrigger.length > 0) {
        isValid = await form.trigger(fieldsToTrigger, { shouldFocus: true });
      }

      for (const field of step.fields) {
        if (field.type === "section") continue;
        if (field.visible && field.required) {
          if (field.isCustom) {
            const customVal = values.customAnswers?.[field.id];
            if (customVal === undefined || customVal === null || (typeof customVal === "string" && !customVal.trim()) || (Array.isArray(customVal) && customVal.length === 0)) {
              form.setError(`customAnswers.${field.id}` as any, {
                type: "manual",
                message: `${field.label} is required`
              });
              isValid = false;
            }
          } else {
            const val = values[field.id as keyof RegistrationFormValues];
            if (val === undefined || val === null || (typeof val === "string" && !val.trim()) || (Array.isArray(val) && val.length === 0)) {
              form.setError(field.id as keyof RegistrationFormValues, {
                type: "manual",
                message: `${field.label} is required`
              });
              isValid = false;
            }
          }
        }
      }
      return isValid;
    }

    return true;
  };

  const handleNextStep = async () => {
    const currentStepDef = steps[currentStep - 1];
    if (!currentStepDef) return;

    const valid = await validateStepFields(currentStepDef);

    if (!valid) {
      DEBUG_LOG("Step navigation blocked: validation failed", form.formState.errors, 'warn');
      if (form.formState.errors.entryFeeId) {
        toast({
          title: "Select an entry fee",
          description: "Pick the entry option that matches your section before continuing.",
          variant: "destructive",
        });
      }
      return;
    }

    DEBUG_LOG(`Advancing from Step ${currentStep} to ${currentStep + 1}`);

    // When moving to the final review step, finalize the current player into the drafts list
    if (currentStep === totalSteps - 1) {
      const currentValues = form.getValues();
      const hasData = Boolean(currentValues.firstName?.trim() || currentValues.lastName?.trim());

      if (hasData) {
        if (editingDraftId) {
          DEBUG_LOG(`Finalizing edit for player: ${currentValues.firstName} ${currentValues.lastName}`);
          setPlayerDrafts((prev) =>
            prev.map((entry) => (entry.id === editingDraftId ? { ...entry, values: currentValues } : entry)),
          );
        } else {
          // Save new player as draft and set as 'currently active' draft
          const draftId =
            typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
              ? crypto.randomUUID()
              : `player-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

          DEBUG_LOG(`Saving current form to roster as new draft entry (ID: ${draftId})`);
          setPlayerDrafts((prev) => [...prev, { id: draftId, values: currentValues }]);
          setEditingDraftId(draftId);
        }
      }
    }

    setCurrentStep((prev) => Math.min(prev + 1, totalSteps));
  };

  const handlePrevStep = () => {
    DEBUG_LOG(`Moving back from Step ${currentStep} to ${currentStep - 1}`);
    setCurrentStep((prev) => Math.max(prev - 1, 1));
  };


  const handleAddAnotherPlayer = async () => {
    // Only return if we truly can't allow more players
    if (!multiPlayerAllowed && playerDrafts.length === 0 && !existingRegistrations.length) {
      return;
    }

    const currentValues = form.getValues();
    const isEmpty = !currentValues.firstName?.trim() && !currentValues.lastName?.trim();

    if (currentStep === totalSteps && isEmpty) {
      DEBUG_LOG("Add Player clicked on Step 3 with empty form. Skipping validation and returning to Step 1.");
      setCurrentStep(1);
      setEditingDraftId(null);
      return;
    }

    let valid = true;
    for (const stepDef of steps) {
      if (stepDef.type !== "checkout") {
        const stepValid = await validateStepFields(stepDef);
        if (!stepValid) valid = false;
      }
    }

    if (!valid) {
      DEBUG_LOG("Add another player blocked: validation failed", form.formState.errors, 'warn');
      toast({
        title: "Validation error",
        description: "Please check that all steps are filled out correctly before adding another player.",
        variant: "destructive",
      });
      return;
    }

    DEBUG_LOG(`Saving ${currentValues.firstName} to roster and resetting for next entry`);

    if (editingDraftId) {
      setPlayerDrafts((prev) =>
        prev.map((entry) => (entry.id === editingDraftId ? { ...entry, values: currentValues } : entry)),
      );
      setEditingDraftId(null);
    } else {
      const draftId =
        typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : `player-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      DEBUG_LOG(`Creating new draft entry for roster (ID: ${draftId})`);
      setPlayerDrafts((prev) => [...prev, { id: draftId, values: currentValues }]);
    }

    // Reset for the next player - clean reset to prevent leakage
    DEBUG_LOG("Resetting form for next group member...");
    form.reset({
      // IMPORTANT: Force manual mode for subsequent players to stop profile autofill "ghosting"
      lookupMode: "manual",
      ratingProvider: "none",
      firstName: "",
      lastName: "",
      uscfId: "",
      fideId: "",
      uscfRating: "",
      fideRating: "",
      // Keep main contact email if it exists as a group default, but clear the rest
      email: currentValues.email,

      address1: "",
      address2: "",
      city: "",
      state: "",
      postalCode: "",
      country: "United States",
      pairingNotifications: "email",
      newsletter: true,
      sectionChoice: "",
      entryFeeId: "",
      processingContribution: "0",
      paymentAcknowledgement: false,
      byePreference: "none",
      byeRounds: [],
      arrivalTime: "",
      notes: "",
      paymentIntentId: undefined,
      paymentStatus: "unpaid",
      paymentReceiptUrl: undefined,
      paymentMethod: undefined,
      currency: undefined,
      amountDue: undefined,
      amountPaid: undefined,
      customAnswers: {},
    });
    setCurrentStep(1);
  };

  const handleEditDraft = (draftId: string) => {
    const draft = playerDrafts.find((entry) => entry.id === draftId);
    if (!draft) return;

    // Before switching, save the current in-progress player so they aren't lost.
    const currentValues = form.getValues();
    const hasCurrentData = Boolean(
      currentValues.firstName?.trim() || currentValues.lastName?.trim()
    );

    if (editingDraftId) {
      // We were already editing a draft — update it with the current form state
      setPlayerDrafts((prev) =>
        prev.map((entry) =>
          entry.id === editingDraftId ? { ...entry, values: currentValues } : entry,
        ),
      );
    } else if (hasCurrentData) {
      // There's an unsaved in-progress player — save them as a new draft
      const newDraftId =
        typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : `player-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      setPlayerDrafts((prev) => [...prev, { id: newDraftId, values: currentValues }]);
    }

    setEditingDraftId(draftId);
    form.reset(draft.values);
    setCurrentStep(1);
  };

  const handleRemoveDraft = async (draftId: string) => {
    DEBUG_LOG(`Checking if draft ${draftId} needs permanent deletion from database`);

    // Check if this is a real database registration (purely numeric ID)
    const isRealRegistration = /^\d+$/.test(draftId);
    const numericId = isRealRegistration ? parseInt(draftId, 10) : NaN;

    if (isRealRegistration) {
      DEBUG_LOG(`Initiating backend deletion for registration ID: ${numericId}`);
      try {
        const response = await apiRequest(`/api/registrations/${numericId}`, { method: "DELETE" });
        if (!response.ok) {
          if (response.status === 404) {
            // Treat as success locally if it doesn't exist on the server
            DEBUG_LOG(`Registration ${numericId} already removed or not found on server (404). Proceeding with local cleanup.`);
          } else {
            const error = await response.json();
            throw new Error(error.error || "Failed to remove registration");
          }
        } else {
          toast({
            title: "Registration removed",
            description: "The player has been permanently removed from the tournament.",
          });
        }

        // Refresh the registrations query so existingRegistrations list remains accurate
        queryClient.invalidateQueries({ queryKey: ["/api/my-registrations"] });
      } catch (error: any) {
        console.error("Failed to delete registration:", error);
        toast({
          title: "Deletion failed",
          description: error.message,
          variant: "destructive",
        });
        return; // Don't remove from local state if backend deletion failed
      }
    }

    if (editingDraftId === draftId) {
      setEditingDraftId(null);
      // If we were editing the draft we just removed, clear the form too
      form.reset({
        ...form.getValues(),
        firstName: "",
        lastName: "",
        uscfId: "",
        uscfRating: "",
        sectionChoice: "",
      });
    }

    const updatedDrafts = playerDrafts.filter((entry) => entry.id !== draftId);
    setPlayerDrafts(updatedDrafts);

    // CRITICAL: Force immediate localStorage sync after removal to prevent "ghost" restores
    if (!isPreviewMode) {
      try {
        saveDraft(tournamentId, {
          formValues: form.getValues(),
          playerDrafts: updatedDrafts,
          currentStep,
          editingDraftId: editingDraftId === draftId ? null : editingDraftId,
        }, user?.id);
        DEBUG_LOG("LocalStorage synced successfully after draft removal");
      } catch (saveError) {
        console.error("Failed to sync localStorage after removal:", saveError);
      }
    }
  };
  const currentPlayerLabel =
    `${form.getValues("firstName") ?? ""} ${form.getValues("lastName") ?? ""}`.trim() || "Current player";
  const currentPlayerSection = form.getValues("sectionChoice") || "Not selected";

  const getInitials = (firstName: string, lastName: string) => {
    return `${(firstName || "")[0] ?? ""}${(lastName || "")[0] ?? ""}`.toUpperCase();
  };

  return (
    <div className="min-h-screen bg-[#f0f4f9] w-full overflow-x-hidden">
      {/* ===== Slim top bar ===== */}
      <div className="sticky top-0 z-10 border-b border-slate-200/80 bg-white/95 backdrop-blur-sm">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-4 py-2.5 sm:px-6">
          <Link href={`/tournaments/${slugify(tournament.name)}`}>
            <button
              type="button"
              className="flex items-center gap-1.5 rounded-md px-2 py-1 text-sm font-medium text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 active:scale-95"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Back
            </button>
          </Link>
          <div className="flex items-center gap-3">
            <Badge
              className={cn(
                "border px-2 py-0.5 text-[11px] font-medium capitalize",
                tournament.status === "active"
                  ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                  : tournament.status === "upcoming"
                    ? "bg-blue-50 text-blue-700 border-blue-200"
                    : "bg-gray-100 text-gray-600 border-gray-200",
              )}
              variant="outline"
            >
              {tournament.status}
            </Badge>
            {isPreviewMode ? (
              <Badge className="bg-amber-50 text-amber-700 border-amber-200 text-[10px] font-semibold">Test Preview Mode</Badge>
            ) : (isAutosaving || lastSavedAt) && (
              <div className={cn(
                "flex items-center gap-1.5 transition-all duration-500",
                isAutosaving ? "opacity-100" : "opacity-40"
              )}>
                {isAutosaving ? (
                  <Loader2 className="h-3 w-3 animate-spin text-blue-500" />
                ) : (
                  <div className="flex h-3 w-3 items-center justify-center rounded-full bg-emerald-100">
                    <Check className="h-2 w-2 text-emerald-600" />
                  </div>
                )}
                <span className="text-[11px] font-medium text-gray-400">
                  {isAutosaving ? "Saving..." : `Saved ${lastSavedAt?.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ===== Main Content ===== */}
      <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
        <FormProvider {...form}>
          <form onSubmit={(event) => event.preventDefault()} autoComplete="off" className="space-y-4">

            {/* ===== Live Preview Warning Banner ===== */}
            {isPreviewMode && (
              <div className="overflow-hidden rounded-xl border border-amber-200 bg-amber-50/90 p-4 shadow-sm animate-in fade-in duration-300">
                <div className="flex gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-amber-100 border border-amber-200">
                    <ShieldCheck className="h-5 w-5 text-amber-700" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-amber-800">Live Form Preview (Testing Mode)</h3>
                    <p className="mt-1 text-xs leading-relaxed text-amber-750/90 font-medium">
                      You are previewing this form as a Tournament Director. Draft autosaving is suspended, and any test inputs you enter will not affect actual registrations or drafts.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* ===== Form Title Card (Google Forms style) ===== */}
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
              <div className="h-2.5 rounded-t-xl bg-primary" />
              <div className="px-7 py-6">
                <h1 className="text-2xl font-normal tracking-tight text-slate-900">
                  {config?.registrationFormConfig?.formTitle || `${tournament.name} Registration Form`}
                </h1>
                <p className="mt-2 text-sm text-slate-500 leading-relaxed">
                  {config?.registrationFormConfig?.formDescription ||
                    [startDateText && endDateText && endDateText !== "TBD" ? `${startDateText} – ${endDateText}` : startDateText, config?.basic.city || tournament.location || null, config?.details.timeControl ? `${config.details.timeControl.toUpperCase()} · ${config?.details.rounds} rounds` : null, `${playerCount}${playerLimit ? ` / ${playerLimit}` : ""} players registered`].filter(Boolean).join(" · ")}
                </p>
              </div>
            </div>

                {/* ===== Multi-player roster panel (Hidden in checkout step to avoid double summary) ===== */}
                {multiPlayerAllowed && currentStep < totalSteps && (playerDrafts.length > 0 || editingDraftId) && (
                  <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
                    <div className="flex items-center gap-4 border-b border-gray-100 bg-gray-50/50 px-6 py-4">
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-white border border-gray-200 shadow-sm">
                        <Users className="h-5 w-5 text-gray-600" />
                      </div>
                      <div>
                        <h3 className="text-base font-semibold leading-tight text-gray-900">Group Registration</h3>
                        <p className="text-sm text-gray-500">
                          {playerDrafts.length} player{playerDrafts.length !== 1 ? "s" : ""} saved
                        </p>
                      </div>
                    </div>
                    <div className="divide-y divide-slate-100">
                      {playerDrafts.map((entry, idx) => {
                        const values = entry.values;
                        const name = `${values.firstName} ${values.lastName}`.trim() || "Unnamed player";
                        const initials = getInitials(values.firstName ?? "", values.lastName ?? "");
                        const isEditing = editingDraftId === entry.id;

                        return (
                          <div
                            key={entry.id}
                            className={cn(
                              "flex items-center gap-3 px-5 py-3.5 transition",
                              isEditing && "bg-blue-50/60",
                            )}
                          >
                            <div
                              className={cn(
                                "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-medium",
                                isEditing
                                  ? "bg-blue-50 text-blue-700 border border-blue-200"
                                  : "bg-gray-50 text-gray-500 border border-gray-100",
                              )}
                            >
                              {idx + 1}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <p className="truncate text-sm font-medium text-gray-900">{name}</p>
                                {isEditing && (
                                  <span className="rounded bg-gray-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-gray-600">Editing</span>
                                )}
                              </div>
                              <p className="truncate text-xs text-slate-500">
                                {values.sectionChoice || "Section TBD"}
                              </p>
                            </div>
                            <div className="flex shrink-0 items-center gap-1">
                              <button
                                type="button"
                                onClick={() => handleEditDraft(entry.id)}
                                disabled={isEditing}
                                className="flex h-8 w-8 items-center justify-center rounded-md bg-white text-gray-400 transition hover:bg-gray-50 hover:text-gray-600 disabled:opacity-40"
                              >
                                <Pencil className="h-4 w-4" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleRemoveDraft(entry.id)}
                                className="flex h-8 w-8 items-center justify-center rounded-md bg-white text-gray-400 transition hover:bg-red-50 hover:text-red-500"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </div>
                          </div>
                        );
                      })}

                      {/* Current in-progress info bar (not in checkout step) */}
                      {!editingDraftId && currentStep < totalSteps && (
                        <div className="flex items-center gap-3 bg-gray-50 border-t border-dashed border-gray-200 px-6 py-3">
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-dashed border-gray-300 bg-white text-xs font-medium text-gray-400">
                            {playerDrafts.length + 1}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <p className="truncate text-sm font-medium text-gray-700">{currentPlayerLabel}</p>
                              <span className="rounded bg-gray-200 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-gray-700">
                                In progress
                              </span>
                            </div>
                            <p className="text-xs text-gray-500">Step {currentStep}: Filling details</p>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* ===== Step Content ===== */}
                <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
                  {(() => {
                    const step = steps[currentStep - 1];
                    if (!step) return null;

                    if (step.type === "lookup") {
                      return <StepOne config={config} players={players} sections={sections} entryFees={entryFees} />;
                    }

                    if (step.type === "details") {
                      return (
                        <StepTwo
                          config={config}
                          entryFees={entryFees}
                          paymentSettings={paymentSettings ?? null}
                          sections={sections}
                          activeFields={step.section ? [step.section, ...step.fields] : step.fields}
                          pageIndex={step.pageIndex}
                          totalPages={totalSteps - (hasLookupStep ? 2 : 1)}
                        />
                      );
                    }

                    if (step.type === "checkout") {
                      return (() => {
                    const displayDrafts = (() => {
                      const currentVals = form.getValues();
                      if (!multiPlayerAllowed) {
                        return [{ id: 'single', values: currentVals }];
                      }

                      // In multi-player mode:
                      // 1. Start with the roster
                      let list = [...playerDrafts];

                      if (editingDraftId) {
                        // 2a. If editing, replace that entry with current form values
                        list = list.map(d => d.id === editingDraftId ? { ...d, values: currentVals } : d);
                      } else {
                        // 2b. If not editing, the current form has been filled but not added to roster yet
                        // Check if it has enough data to be considered a 'final' entry
                        if (currentVals.firstName || currentVals.lastName) {
                          list.push({ id: 'current-form', values: currentVals });
                        }
                      }

                      return list.length > 0 ? list : [{ id: 'placeholder', values: currentVals }];
                    })();
                    const displayValues = displayDrafts.map(e => e.values);

                    return (
                      <>
                        {displayValues.length > 0 && (
                          <div className="mb-6 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
                            <div className="flex items-center gap-4 border-b border-gray-100 bg-gray-50/50 px-6 py-4">
                              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-white border border-gray-200 shadow-sm">
                                <CreditCard className="h-5 w-5 text-gray-600" />
                              </div>
                              <div className="min-w-0 flex-1">
                                <h3 className="text-base font-semibold leading-tight text-gray-900">Registration Summary</h3>
                                <p className="text-sm text-gray-500">
                                  {displayDrafts.length} player{displayDrafts.length !== 1 ? "s" : ""} included
                                </p>
                              </div>
                              {((multiPlayerAllowed || (existingRegistrations && existingRegistrations.length > 0)) &&
                                displayValues.length < (config?.registers?.playerLimit ?? 10)) && (
                                  <button
                                    type="button"
                                    id="add-player-button-summary"
                                    onClick={handleAddAnotherPlayer}
                                    className="inline-flex h-8 items-center gap-1.5 rounded-md border border-gray-200 bg-white px-3 text-xs font-medium text-gray-600 shadow-sm transition hover:bg-gray-50 active:scale-95"
                                  >
                                    <Plus className="h-3 w-3" />
                                    Add Player
                                  </button>
                                )}
                            </div>

                            <div className="divide-y divide-slate-100">
                              {displayDrafts.map((entry, index) => {
                                const values = entry.values;
                                const name = `${values.firstName} ${values.lastName}`.trim() || `Player ${index + 1}`;
                                const entryFee = entryFees.find((fee) => fee.id === values.entryFeeId) ?? null;
                                const contribution = parseContribution(values.processingContribution);
                                const totals = computePaymentTotals(entryFee, contribution, paymentSettings, values.customAnswers);
                                const isDraft = entry.id !== 'single' && entry.id !== 'current-form' && entry.id !== 'placeholder' && entry.id !== 'edit-draft';

                                return (
                                  <div key={entry.id} className="flex items-center justify-between px-6 py-4 transition hover:bg-slate-50/50">
                                    <div className="flex min-w-0 flex-1 items-center gap-4">
                                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-50 text-xs font-bold text-blue-700 shadow-sm ring-1 ring-blue-100/50">
                                        {getInitials(values.firstName ?? "", values.lastName ?? "") || (index + 1)}
                                      </div>
                                      <div className="min-w-0 flex-1">
                                        <div className="flex items-center gap-2">
                                          <p className="truncate text-sm font-semibold text-slate-900">{name}</p>
                                          <span className={cn(
                                            "rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide",
                                            (registerMutation.isSuccess || groupRegisterMutation.isSuccess)
                                              ? "bg-amber-100 text-amber-700 border border-amber-200"
                                              : "bg-blue-100 text-blue-700 border border-blue-200"
                                          )}>
                                            {(registerMutation.isSuccess || groupRegisterMutation.isSuccess) ? "Pending Approval" : "Ready to Submit"}
                                          </span>
                                        </div>
                                        <p className="flex items-center gap-2 truncate text-xs text-slate-500">
                                          <span className="font-medium text-slate-700">{entryFee?.section || values.sectionChoice || "Section TBA"}</span>
                                          <span className="text-slate-300">|</span>
                                          <span>
                                            {(() => {
                                              const rating = derivePlayerRating(values.ratingProvider, values.uscfRating, values.fideRating, config.details.primaryRatingSystem);
                                              const label = values.ratingProvider === 'fide' ? 'FIDE' : values.ratingProvider === 'uscf' ? 'USCF' : (config.details.primaryRatingSystem === 'fide' ? 'FIDE' : 'USCF');
                                              return rating ? `${label} ${rating}` : "Unrated";
                                            })()}
                                          </span>
                                        </p>
                                      </div>
                                    </div>
                                    <div className="ml-4 flex items-center gap-4">
                                      <div className="text-right">
                                        <span className="block text-sm font-bold text-blue-700">
                                          {formatCurrency(totals.total, totals.currency)}
                                        </span>
                                        {totals.feeAmount > 0 && (
                                          <span className="text-[10px] text-slate-400">Incl. {formatCurrency(totals.feeAmount, totals.currency)} fee</span>
                                        )}
                                      </div>
                                      <div className="flex items-center gap-1.5 border-l border-slate-100 pl-4">
                                        <button
                                          type="button"
                                          onClick={() => isDraft ? handleEditDraft(entry.id) : setCurrentStep(1)}
                                          className="rounded p-1.5 text-slate-400 transition hover:bg-white hover:text-blue-600 hover:shadow-sm"
                                          title="Edit player"
                                        >
                                          <Pencil className="h-3.5 w-3.5" />
                                        </button>
                                        {isDraft && (
                                          <button
                                            type="button"
                                            onClick={() => handleRemoveDraft(entry.id)}
                                            className="rounded p-1.5 text-slate-400 transition hover:bg-white hover:text-red-600 hover:shadow-sm"
                                            title="Remove player"
                                          >
                                            <Trash2 className="h-3.5 w-3.5" />
                                          </button>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>

                            <div className="flex items-center justify-between border-t border-gray-200 bg-gray-50 px-6 py-4">
                              <span className="text-sm font-medium text-gray-900">Combined registration total</span>
                              <span className="text-lg font-bold text-blue-700">
                                {formatCurrency(
                                  displayDrafts.reduce((sum, entry) => {
                                    const fee = entryFees.find((f) => f.id === entry.values.entryFeeId) ?? null;
                                    const contribution = parseContribution(entry.values.processingContribution);
                                    const totals = computePaymentTotals(fee, contribution, paymentSettings, entry.values.customAnswers);
                                    return sum + totals.total;
                                  }, 0),
                                  groupPaymentTotals.currency
                                )}
                              </span>
                            </div>
                          </div>
                        )}


                        {canProcessOnline && clientSecret && stripePromise ? (
                          <Elements key={clientSecret} stripe={stripePromise} options={{ clientSecret }}>
                            <StepThree
                              paymentDetails={config?.registers?.paymentDetails}
                              paymentSettings={paymentSettings ?? null}
                              paymentTotals={groupPaymentTotals}
                              playerDrafts={playerDrafts}
                              onEditDraft={handleEditDraft}
                              onRemoveDraft={handleRemoveDraft}
                              selectedEntryFee={selectedEntryFee}
                              sections={sections}
                              requiresPayment={requiresPayment}
                              onlineConfigured={Boolean(canProcessOnline)}
                              clientSecret={clientSecret}
                              registerPaymentHandler={setPaymentSubmitHandler}
                              setPaymentBusy={setIsPaymentBusy}
                              onPaymentElementReady={setIsPaymentElementReady}
                              paymentIntentLoading={createPaymentIntent.isPending}
                              paymentIntentError={paymentIntentErrorMessage}
                              canAcceptOnlinePayment={true}
                              tournamentId={tournamentId}
                              retryPaymentIntent={forceRetryPaymentIntent}
                              saveRegistrationBeforePayment={saveRegistrationBeforePayment}
                            />
                          </Elements>
                        ) : (
                          <StepThree
                            paymentDetails={config?.registers?.paymentDetails}
                            paymentSettings={paymentSettings ?? null}
                            paymentTotals={groupPaymentTotals}
                            playerDrafts={playerDrafts}
                            onEditDraft={handleEditDraft}
                            onRemoveDraft={handleRemoveDraft}
                            selectedEntryFee={selectedEntryFee}
                            sections={sections}
                            requiresPayment={requiresPayment}
                            onlineConfigured={Boolean(canProcessOnline)}
                            clientSecret={clientSecret}
                            registerPaymentHandler={setPaymentSubmitHandler}
                            setPaymentBusy={setIsPaymentBusy}
                            onPaymentElementReady={setIsPaymentElementReady}
                            paymentIntentLoading={createPaymentIntent.isPending}
                            paymentIntentError={paymentIntentErrorMessage}
                            canAcceptOnlinePayment={false}
                            tournamentId={tournamentId}
                            retryPaymentIntent={forceRetryPaymentIntent}
                            saveRegistrationBeforePayment={saveRegistrationBeforePayment}
                          />
                        )}
                      </>
                    );
                  })()
                }
              })()}
            </div>

                {/* ===== Navigation Footer (Google Forms style) ===== */}
                <div className="flex items-center justify-between gap-4 py-4 px-1">
                  <div className="flex items-center gap-3">
                    {currentStep > 1 && currentStep < totalSteps && (
                      <Button
                        type="button"
                        variant="outline"
                        onClick={handlePrevStep}
                        className="h-10 px-4 text-sm font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200/80 hover:text-slate-800 rounded-lg transition shadow-sm border border-slate-300"
                      >
                        Back
                      </Button>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    {currentStep < totalSteps && (
                      <Button
                        type="button"
                        variant="outline"
                        onClick={handleSaveDraft}
                        className={cn(
                          "h-10 px-4 text-sm font-semibold transition rounded-lg shadow-sm border",
                          draftSavedFlash
                            ? "bg-emerald-50 border-emerald-300 text-emerald-700 hover:bg-emerald-100 hover:text-emerald-800"
                            : "bg-slate-100 border-slate-300 text-slate-700 hover:bg-slate-200/80 hover:text-slate-800",
                        )}
                      >
                        {draftSavedFlash ? "Saved!" : "Save Draft"}
                      </Button>
                    )}
                    {currentStep < totalSteps ? (
                      <Button
                        type="button"
                        onClick={handleNextStep}
                        className="h-10 px-6 text-sm font-semibold text-white bg-primary hover:bg-primary/90 shadow-sm rounded-lg transition"
                      >
                        Continue
                      </Button>
                    ) : (
                      <Button
                        type="button"
                        disabled={disableSubmitButton || !paymentAcknowledged}
                        onClick={handleFinalSubmit}
                        className="h-10 px-6 text-sm font-semibold text-white bg-primary hover:bg-primary/90 shadow-sm rounded-lg transition"
                      >
                        {registerMutation.isPending || groupRegisterMutation.isPending ? (
                          "Submitting..."
                        ) : isPaymentBusy ? (
                          "Processing..."
                        ) : requiresPayment ? (
                          "Pay & Submit"
                        ) : (
                          "Submit"
                        )}
                      </Button>
                    )}
                  </div>
                </div>

                <div className="mt-8 text-center text-xs text-slate-400">
                  Registration powered by ChessSoftware · Confirmation sent after director review
                </div>
          </form>
        </FormProvider>
      </div>
    </div>
  );

}

type RatingLookupSource = "uscf" | "fide";

interface RatingLookupResult {
  source: RatingLookupSource;
  id: string;
  name: string;
  rating?: string;
  ratingDisplay?: string;
  location?: string;
  extra?: string;
  extraRatings?: Array<{
    type: "quick" | "blitz" | "rapid";
    label: string;
    value?: string;
    display?: string;
  }>;
  metadata?: Record<string, string | undefined>;
  sex?: string;
  birthYear?: string;
}

interface RatingLookupResponse {
  uscf?: RatingLookupResult[];
  fide?: RatingLookupResult[];
  errors?: Partial<Record<RatingLookupSource, string>>;
}

function getFieldConfig(config: any, fieldId: string) {
  const fields = config?.registrationFormConfig?.fields || DEFAULT_REGISTRATION_FIELDS;
  const field = fields.find((f: any) => f.id === fieldId);
  return field ?? { id: fieldId, label: fieldId, type: "text", required: false, visible: false };
}
