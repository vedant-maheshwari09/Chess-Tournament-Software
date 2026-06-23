import React, { useEffect, useMemo } from "react";
import { useFormContext } from "react-hook-form";
import { Info, HelpCircle, Trophy, AlertCircle, Check } from "lucide-react";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RadioOption, Field } from "./components";
import { cn } from "@/lib/utils";
import type { RegistrationFormValues, SectionOption, PaymentSettings, PaymentTotals } from "./types";
import { COUNTRY_OPTIONS } from "./types";
import {
  derivePlayerRating,
  filterEntryFeesBySection,
  ratingWithinSectionRange,
  formatCurrency,
  formatEntryFeeRange,
  findRecommendedEntryFee,
  getFieldConfig,
  buildArrivalNotes,
  toggleArrayValue,
  ratingWithinEntryFee,
  formatDate,
  NO_ENTRY_FEE_ID,
} from "./helpers";
import { DEFAULT_REGISTRATION_FIELDS } from "@/lib/tournament-config";
import type { parseTournamentConfig, EntryFeeRule, OfflinePaymentMethod } from "@/lib/tournament-config";

export default function StepTwo({
  config,
  entryFees,
  paymentSettings,
  sections,
}: {
  config: ReturnType<typeof parseTournamentConfig> | null;
  entryFees: EntryFeeRule[];
  paymentSettings: PaymentSettings | null;
  sections: SectionOption[];
}) {
  const form = useFormContext<RegistrationFormValues>();
  const byePreference = form.watch("byePreference");
  const ratingProvider = form.watch("ratingProvider");
  const uscfRatingValue = form.watch("uscfRating");
  const fideRatingValue = form.watch("fideRating");
  const selectedSection = form.watch("sectionChoice");
  const selectedEntryFeeId = form.watch("entryFeeId");

  const step2ActiveFields = useMemo(() => {
    const fields = config?.registrationFormConfig?.fields || DEFAULT_REGISTRATION_FIELDS;
    return fields.filter((f) => f.visible && f.id !== "uscfId" && f.id !== "fideId");
  }, [config]);

  const numericRating = useMemo(
    () => derivePlayerRating(ratingProvider, uscfRatingValue, fideRatingValue, config?.details.primaryRatingSystem),
    [fideRatingValue, ratingProvider, uscfRatingValue, config?.details.primaryRatingSystem],
  );

  const sectionDetails = useMemo(
    () =>
      sections.map((section) => {
        const options = filterEntryFeesBySection(entryFees, section.name, sections);
        const primaryFee = options[0] ?? null;
        const label = primaryFee
          ? `${section.name} (${formatCurrency(primaryFee.amount, primaryFee.currency)})`
          : `${section.name} (TBD)`;
        return {
          ...section,
          entryFee: primaryFee,
          label,
        };
      }),
    [sections, entryFees],
  );

  useEffect(() => {
    if (sectionDetails.length === 0) return;
    const current = form.getValues("sectionChoice");
    if (current && sectionDetails.some((section) => section.name === current)) {
      return;
    }
    const fallback =
      numericRating !== null
        ? sectionDetails.find((section) => ratingWithinSectionRange(numericRating, section))
        : sectionDetails[0];
    if (fallback) {
      form.setValue("sectionChoice", fallback.name, { shouldDirty: false, shouldValidate: true });
    }
  }, [sectionDetails, form, numericRating]);

  useEffect(() => {
    if (numericRating === null) return;
    if (!selectedSection) return;
    const current = sectionDetails.find((section) => section.name === selectedSection);
    if (current && !ratingWithinSectionRange(numericRating, current)) {
      const fallback = sectionDetails.find((section) => ratingWithinSectionRange(numericRating, section));
      form.setValue("sectionChoice", fallback ? fallback.name : "", { shouldDirty: true, shouldValidate: true });
    }
  }, [numericRating, selectedSection, sectionDetails, form]);

  const selectedSectionOption = useMemo(() => {
    if (!selectedSection) return undefined;
    const normalized = selectedSection.trim().toLowerCase();
    return sections.find((section) => section.name.trim().toLowerCase() === normalized);
  }, [selectedSection, sections]);

  const entryFeeOptions = useMemo(
    () => filterEntryFeesBySection(entryFees, selectedSection, sections),
    [entryFees, selectedSection, sections],
  );
  const contributionAllowed = paymentSettings?.allowProcessingContribution !== false;
  useEffect(() => {
    if (!contributionAllowed) {
      form.setValue("processingContribution", "0", { shouldDirty: false, shouldValidate: true });
    }
  }, [contributionAllowed, form]);

  const recommendedEntryFee = useMemo(
    () => findRecommendedEntryFee(entryFeeOptions, numericRating, sections, selectedSectionOption),
    [entryFeeOptions, numericRating, sections, selectedSectionOption],
  );

  useEffect(() => {
    if (entryFees.length === 0) {
      if (!form.getValues("entryFeeId")) {
        form.setValue("entryFeeId", NO_ENTRY_FEE_ID, { shouldDirty: false });
      }
      return;
    }
    if (entryFeeOptions.length === 0) {
      form.setValue("entryFeeId", NO_ENTRY_FEE_ID, { shouldDirty: false });
      return;
    }
    const current = form.getValues("entryFeeId");
    const fallback = recommendedEntryFee ?? entryFeeOptions[0];
    if (!current || !entryFeeOptions.some((fee) => fee.id === current)) {
      form.setValue("entryFeeId", fallback.id, { shouldDirty: false });
    }
  }, [entryFeeOptions, entryFees.length, form, recommendedEntryFee]);

  const byeRounds = useMemo(() => {
    const rounds = config?.details.rounds ?? 0;
    return Array.from({ length: rounds }, (_, index) => `Round ${index + 1}`);
  }, [config?.details.rounds]);

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="flex items-center gap-4 border-b border-gray-100 bg-gray-50/50 px-6 py-5">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-white border border-gray-200 shadow-sm">
          <Trophy className="h-5 w-5 text-gray-600" />
        </div>
        <div>
          <h2 className="text-lg font-semibold leading-tight text-gray-900">Tournament Options</h2>
          <p className="text-sm text-gray-500">Step 2 of 3: Section & Preferences</p>
        </div>
      </div>

      <div className="space-y-8 p-6">
        <div className="space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <Label className="text-sm font-bold text-slate-900 tracking-tight">Entry fee type</Label>
              <p className="text-xs font-medium text-slate-500">Pick the pricing tier for your section.</p>
            </div>
            <Badge variant="outline" className="w-fit border-blue-200 bg-blue-50/70 text-blue-800 font-bold px-3 py-1">
              {numericRating !== null ? `Live Rating: ${numericRating}` : "Status: Unrated"}
            </Badge>
          </div>
          {entryFees.length === 0 ? (
            <div className="rounded-lg border border-dashed border-blue-200 bg-blue-50/70 p-4 text-sm text-blue-700">
              Entry fees will be confirmed by the tournament director. Continue to acknowledge payment on the next step.
            </div>
          ) : entryFeeOptions.length === 0 ? (
            <div className="flex items-start gap-3 rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-700">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <p>No pricing has been configured for the selected section. Please contact the director for assistance.</p>
            </div>
          ) : (
            <>
              <RadioGroup
                value={selectedEntryFeeId ?? ""}
                onValueChange={(value) => form.setValue("entryFeeId", value, { shouldDirty: true })}
                className="grid gap-3 sm:grid-cols-2"
              >
                {entryFeeOptions.map((fee) => {
                  const eligible = ratingWithinEntryFee(numericRating, fee, sections, selectedSectionOption);
                  const isRecommended = recommendedEntryFee?.id === fee.id;
                  const isSelected = selectedEntryFeeId === fee.id;
                  const effectiveAfterLabel = fee.effectiveAfter
                    ? `Effective after ${formatDate(fee.effectiveAfter)}`
                    : "Effective immediately";
                  return (
                    <label
                      key={fee.id}
                      htmlFor={`entry-fee-${fee.id}`}
                      className={cn(
                        "relative flex cursor-pointer flex-col gap-2 rounded-xl border p-5 transition-all shadow-sm ring-1 ring-inset ring-transparent",
                        isSelected
                          ? "border-blue-400 bg-blue-50/80 ring-blue-400/20 shadow-md"
                          : "border-slate-200 bg-white hover:border-blue-300 hover:bg-blue-50/30",
                      )}
                    >
                      <RadioGroupItem id={`entry-fee-${fee.id}`} value={fee.id} className="sr-only" />
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold text-slate-900">{fee.section}</span>
                        <span className="text-sm font-semibold text-slate-900">
                          {formatCurrency(fee.amount, fee.currency)}
                        </span>
                      </div>
                      <p className="text-xs text-slate-500">{formatEntryFeeRange(fee, sections, selectedSectionOption)}</p>
                      <p className="text-[11px] text-slate-400">{effectiveAfterLabel}</p>
                      {fee.notes && <p className="text-xs text-slate-500">{fee.notes}</p>}
                      <div className="flex flex-wrap gap-2 pt-2">
                        {isRecommended && (
                          <Badge className="border-emerald-200 bg-emerald-50/80 text-emerald-700">Recommended</Badge>
                        )}
                        <Badge
                          variant="outline"
                          className={cn(
                            "border text-xs",
                            eligible
                              ? "border-emerald-200 bg-emerald-50/70 text-emerald-700"
                              : "border-blue-200 bg-blue-50/70 text-blue-700",
                          )}
                        >
                          {eligible ? "Matches rating" : "Director review required"}
                        </Badge>
                      </div>
                    </label>
                  );
                })}
              </RadioGroup>
              {form.formState.errors.entryFeeId && (
                <p className="text-xs text-red-500">{form.formState.errors.entryFeeId.message}</p>
              )}
            </>
          )}
        </div>

        {step2ActiveFields.length > 0 && (
          <>
            <Separator />
            <div className="grid gap-6 sm:grid-cols-2">
              {step2ActiveFields.map((field: any) => {
                const isCustom = field.isCustom;
                const path = isCustom ? `customAnswers.${field.id}` : field.id;

                // --- BYE PREFERENCE ---
                if (field.id === "byePreference") {
                  if (config?.format === "arena" || config?.format === "knockout") return null;
                  return (
                    <div key={field.id} className="space-y-4 col-span-2">
                      <Label className="text-sm font-semibold text-slate-700">
                        {field.label}
                        {field.required && <span className="ml-1 text-red-500">*</span>}
                      </Label>
                      <RadioGroup
                        value={byePreference}
                        onValueChange={(value) =>
                          form.setValue("byePreference", value as RegistrationFormValues["byePreference"], {
                            shouldDirty: true,
                            shouldValidate: true,
                          })
                        }
                        className="grid gap-3 sm:grid-cols-2"
                      >
                        <RadioOption group="byePreference" value="none" title="No byes" description="I plan to play every round." />
                        <RadioOption group="byePreference" value="yes" title="Request byes" description="Select rounds you cannot attend." />
                      </RadioGroup>

                      {byePreference === "yes" && (
                        <div className="rounded-xl border border-slate-200 bg-slate-50/20 p-5 space-y-3 animate-in fade-in slide-in-from-top-1 duration-200">
                          <Label className="text-sm font-semibold text-slate-700">Select eligible rounds</Label>
                          <div className="grid gap-3 sm:grid-cols-3">
                            {byeRounds.map((label) => {
                              const checked = form.watch("byeRounds")?.includes(label);
                              return (
                                <button
                                  key={label}
                                  type="button"
                                  onClick={() => toggleArrayValue(form, "byeRounds", label)}
                                  className={cn(
                                    "flex items-center justify-between rounded-xl border px-4 py-3.5 text-sm font-medium transition-all shadow-sm active:scale-[0.98]",
                                    checked
                                      ? "border-blue-500 bg-blue-600 text-white shadow-md shadow-blue-100/50"
                                      : "border-slate-200 bg-white text-slate-600 hover:border-blue-200 hover:bg-blue-50/50",
                                  )}
                                >
                                  <span>{label}</span>
                                  {checked && <Check className="h-4 w-4" />}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}
                      {form.formState.errors.byePreference && (
                        <p className="mt-1 text-xs text-red-500">{form.formState.errors.byePreference.message}</p>
                      )}
                    </div>
                  );
                }

                // --- BOOLEAN (CHECKBOX CARD) ---
                if (field.type === "boolean") {
                  const checked = form.watch(path as any) ?? false;
                  return (
                    <div 
                      key={field.id} 
                      className={cn(
                        "flex items-start gap-4 rounded-xl border p-5 transition-all group col-span-2 shadow-sm cursor-pointer",
                        checked
                          ? "border-blue-300 bg-blue-50/40 hover:bg-blue-50/60"
                          : "border-slate-200 bg-slate-50/50 hover:bg-white hover:shadow-md hover:border-blue-200"
                      )}
                      onClick={() => form.setValue(path as any, !checked, { shouldDirty: true, shouldValidate: true })}
                    >
                      <input
                        id={field.id}
                        type="checkbox"
                        className="mt-1 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                        checked={checked}
                        onChange={(event) => {
                          event.stopPropagation();
                          form.setValue(path as any, event.target.checked, { shouldDirty: true, shouldValidate: true });
                        }}
                      />
                      <div className="space-y-1">
                        <Label htmlFor={field.id} className="text-sm font-bold text-slate-900 cursor-pointer select-none">
                          {field.label}
                          {field.required && <span className="ml-1 text-red-500">*</span>}
                        </Label>
                        {field.description && (
                          <p className="text-xs leading-relaxed text-slate-500 select-none">
                            {field.description}
                          </p>
                        )}
                      </div>
                    </div>
                  );
                }

                // --- NOTES (TEXTAREA) ---
                if (field.id === "notes") {
                  const error = form.formState.errors.notes;
                  return (
                    <div key={field.id} className="col-span-2 space-y-2">
                      <Label className="text-sm font-medium text-slate-700">
                        {field.label}
                        {field.required && <span className="ml-1 text-red-500">*</span>}
                      </Label>
                      <Textarea
                        className="mt-1 bg-white focus:border-blue-400 focus:ring-blue-200 min-h-24"
                        placeholder={field.placeholder || "Share any additional information, companions, or messages for the Director."}
                        {...form.register("notes")}
                      />
                      {field.description && (
                        <p className="text-[11px] text-slate-400 leading-normal mt-1">{field.description}</p>
                      )}
                      {error && (
                        <p className="mt-1 text-xs text-red-500">{error.message}</p>
                      )}
                    </div>
                  );
                }

                // --- SELECT / DROPDOWN (including Country) ---
                if (field.type === "select" || field.id === "country") {
                  const val = form.watch(path as any) ?? (field.id === "country" ? "United States" : "");
                  const selectOptions = field.id === "country" ? COUNTRY_OPTIONS : (field.options ?? []);
                  const error = isCustom 
                    ? form.formState.errors.customAnswers?.[field.id] 
                    : form.formState.errors[field.id as keyof RegistrationFormValues];

                  return (
                    <div key={field.id} className="group space-y-2 col-span-1">
                      <Label className="text-sm font-medium text-slate-700 transition-colors group-focus-within:text-blue-700">
                        {field.label}
                        {field.required && <span className="ml-1 text-red-500">*</span>}
                      </Label>
                      <Select
                        value={val}
                        onValueChange={(value) => form.setValue(path as any, value, { shouldDirty: true, shouldValidate: true })}
                      >
                        <SelectTrigger className="bg-white border-slate-200 focus:ring-blue-200 focus:border-blue-400">
                          <SelectValue placeholder={field.placeholder || `Select ${field.label}`} />
                        </SelectTrigger>
                        <SelectContent>
                          {selectOptions.map((opt: any) => (
                            <SelectItem key={opt} value={opt}>
                              {opt}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {field.description && (
                        <p className="text-[11px] text-slate-400 leading-normal mt-0.5">{field.description}</p>
                      )}
                      {error && (
                        <p className="text-xs text-red-500">{error.message as string}</p>
                      )}
                    </div>
                  );
                }

                // --- TEXT / NUMBER FIELDS ---
                return (
                  <div key={field.id} className="col-span-1">
                    <Field
                      label={field.label}
                      name={path}
                      required={field.required}
                      placeholder={field.placeholder || `Enter ${field.label}...`}
                      type={field.type === "number" ? "number" : "text"}
                      description={field.description}
                    />
                  </div>
                );
              })}

              {/* Pairing Notifications (Always visible & active) */}
              <div className="group space-y-2 col-span-1">
                <Label className="text-sm font-medium text-slate-700 transition-colors group-focus-within:text-blue-700">
                  Pairing notifications
                </Label>
                <Select
                  value={form.watch("pairingNotifications") ?? "email"}
                  onValueChange={(value) =>
                    form.setValue("pairingNotifications", value as RegistrationFormValues["pairingNotifications"], {
                      shouldDirty: true,
                      shouldValidate: true,
                    })
                  }
                >
                  <SelectTrigger className="bg-white border-slate-200 focus:ring-blue-200 focus:border-blue-400">
                    <SelectValue placeholder="Select preference" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="email">Email only</SelectItem>
                    <SelectItem value="none">No notifications</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-slate-400 leading-normal mt-0.5">
                  Choose how you want to receive pairings and result alerts.
                </p>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const OFFLINE_METHOD_LABELS: Record<OfflinePaymentMethod, string> = {
  cash: "Cash",
  check: "Check",
  venmo: "Venmo",
  zelle: "Zelle",
  paypal: "PayPal",
  other: "Other",
};

type PaymentStatusKey = "unpaid" | "processing" | "paid" | "failed" | "refunded";

interface StepThreeProps {
  paymentDetails?: string | null;
  paymentSettings: PaymentSettings | null;
  paymentTotals: PaymentTotals;
  selectedEntryFee: EntryFeeRule | null;
  sections: SectionOption[];
  requiresPayment: boolean;
  onlineConfigured: boolean;
  clientSecret: string | null;
  registerPaymentHandler: (fn: (() => Promise<boolean>) | null) => void;
  setPaymentBusy: (busy: boolean) => void;
  onPaymentElementReady: (ready: boolean) => void;
  paymentIntentLoading: boolean;
  paymentIntentError: string | null;
  canAcceptOnlinePayment: boolean;
  tournamentId: number;
  retryPaymentIntent: () => void;
  playerDrafts?: Array<{ id: string; values: Partial<RegistrationFormValues> }>;
  onEditDraft?: (id: string) => void;
  onRemoveDraft?: (id: string) => void;
}

