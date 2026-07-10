import React, { useState, useEffect, useMemo, useRef } from "react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { Button } from "@/components/ui/button";

import { Input } from "@/components/ui/input";

import { Label } from "@/components/ui/label";

import { Textarea } from "@/components/ui/textarea";

import { Switch } from "@/components/ui/switch";

import { Badge } from "@/components/ui/badge";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

import {

  Upload, Check, X, ChevronUp, ChevronDown, Plus, CreditCard, ExternalLink,

  Trophy, Users, Calculator, Link, QrCode, Printer, Copy, Clock, Zap, Paperclip, Loader2, Trash2, Eye, EyeOff, FileDown, FileUp, Wifi, WifiOff, Settings

} from "lucide-react";

import { WebhookSyncSettingsCard } from "@/components/tournament-settings/sections";

import { OfficialSearchInput } from "@/components/ui/official-search-input";

import { DatePicker } from "@/components/ui/date-picker";

import { TimePicker } from "@/components/ui/time-picker";

import { parseISO, format as formatDateFn } from "date-fns";

import TournamentPagePanel from "@/components/tournament-page-panel";

import { RegistrationFormCustomizer } from "@/components/registration-form-customizer";

import { KnockoutFormatEditor } from "@/components/knockout-format-editor";

import { useToast } from "@/hooks/use-toast";

import { apiRequest } from "@/lib/queryClient";

import { QRCodeCanvas } from "qrcode.react";

import qrcode from "qrcode";

import { useLocation } from "wouter";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { cn } from "@/lib/utils";

import { Card, CardContent } from "@/components/ui/card";

import { BasicInformationFields } from "./step-one";

import { ArenaSettingsTab } from "./arena-settings-tab";



import type { Tournament } from "@shared/schema";

import type { TournamentConfig, SectionDefinition, EntryFeeRule, PrizeRule, OfflinePaymentMethod, ScoringRules } from "@/lib/tournament-config";

import {

  TimeAddonType, TimeControlType, TimeControlDefinition, ScheduleEvent,

  createDefaultConfig, SCHEDULE_EVENT_OPTIONS

} from "@/lib/tournament-config";

import {

  isTournamentTemplateSnapshot, TOURNAMENT_TEMPLATE_OPTIONS, applyTournamentTemplateSnapshot

} from "@/lib/tournament-templates";

import {

  TIEBREAK_OPTIONS, RATING_TYPE_OPTIONS, ENTRY_FEE_CURRENCY_OPTIONS, OFFLINE_METHOD_OPTIONS,

  type SettingsShortcutTab, type StepTwoProps, type PaymentsConfigResponse

} from "./types";

import {

  cloneConfig, downloadJson, fileToText, templateLabelToRound,

  ScoreInput, TiebreakRow, createPrizeRow, formatRatingRange,

  createSectionDefinition, createEntryFeeRow

} from "./helpers";



export default function StepTwo({

  format,

  mode,

  builderMode,

  config,

  onConfigChange,

  onBack: _onBack,

  onCancel,

  onSave,

  saving,

  tournament,

  activeSubTab,

  onSubTabChange,

}: StepTwoProps) {

  const scheduleTemplateOptions = SCHEDULE_EVENT_OPTIONS;

  const { toast } = useToast();

  const queryClient = useQueryClient();

  const prizeImportInputRef = useRef<HTMLInputElement | null>(null);

  const [isOnline, setIsOnline] = useState(typeof window !== "undefined" ? window.navigator.onLine : true);



  useEffect(() => {

    if (typeof window === "undefined") return;

    const handleOnline = () => setIsOnline(true);

    const handleOffline = () => setIsOnline(false);

    window.addEventListener("online", handleOnline);

    window.addEventListener("offline", handleOffline);

    return () => {

      window.removeEventListener("online", handleOnline);

      window.removeEventListener("offline", handleOffline);

    };

  }, []);



  const handleExportBackup = async () => {

    if (!tournamentId) return;

    try {

      const token = localStorage.getItem("auth_token");

      const headers: Record<string, string> = {};

      if (token) headers.Authorization = `Bearer ${token}`;



      const res = await fetch(`/api/tournaments/${tournamentId}/backup`, { headers });

      if (!res.ok) throw new Error("Failed to export backup");

      const data = await res.json();

      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });

      const url = URL.createObjectURL(blob);

      const link = document.createElement("a");

      link.href = url;

      link.download = `tournament-${tournament?.name || "backup"}-${new Date().toISOString().split('T')[0]}.json`;

      document.body.appendChild(link);

      link.click();

      document.body.removeChild(link);

      URL.revokeObjectURL(url);

      toast({ title: "Backup Exported", description: "Tournament data downloaded successfully." });

    } catch (err: any) {

      toast({ title: "Export Failed", description: err.message, variant: "destructive" });

    }

  };



  const handleImportBackup = async (e: React.ChangeEvent<HTMLInputElement>) => {

    if (!tournamentId) return;

    const file = e.target.files?.[0];

    if (!file) return;



    const reader = new FileReader();

    reader.onload = async (event: any) => {

      try {

        const backupData = JSON.parse(event.target?.result as string);

        if (!backupData.tournament || !backupData.players) {

          throw new Error("Invalid tournament backup JSON format.");

        }



        const confirmRestore = window.confirm("Warning: Importing this backup will overwrite all current players, matches, pairings, and history. Do you want to proceed?");

        if (!confirmRestore) return;



        const token = localStorage.getItem("auth_token");

        const headers: Record<string, string> = { "Content-Type": "application/json" };

        if (token) headers.Authorization = `Bearer ${token}`;



        const res = await fetch(`/api/tournaments/${tournamentId}/restore`, {

          method: "POST",

          headers,

          body: JSON.stringify(backupData)

        });



        if (!res.ok) {

          const errText = await res.text();

          throw new Error(errText || "Failed to restore backup");

        }



        toast({ title: "Restore Successful", description: "Tournament state successfully restored." });

        queryClient.invalidateQueries({ queryKey: [`/api/tournaments/${tournamentId}`] });

        queryClient.invalidateQueries({ queryKey: [`/api/tournaments/${tournamentId}/matches`] });

        queryClient.invalidateQueries({ queryKey: [`/api/tournaments/${tournamentId}/pairings`] });

        window.location.reload();

      } catch (err: any) {

        toast({ title: "Restore Failed", description: err.message, variant: "destructive" });

      }

    };

    reader.readAsText(file);

  };

  const sections = config.sections ?? [];

  const prizes = config.prizes ?? [];

  const tournamentId = tournament?.id;

  const { data: paymentsConfigData } = useQuery<PaymentsConfigResponse>({

    queryKey: ["tournament-payments-config", tournamentId],

    queryFn: async () => {

      if (!tournamentId) {

        throw new Error("Tournament id is required");

      }

      return apiRequest(`/api/tournaments/${tournamentId}/payments/config`);

    },

    enabled: Boolean(tournamentId),

    staleTime: 30_000,

  });



  const paymentsSnapshot = paymentsConfigData?.payments ?? config.payments;

  const onlinePaymentsEnabled = Boolean(paymentsSnapshot.onlineEnabled);

  const provider = paymentsSnapshot.provider;

  const hasConnectionDetails = provider === "stripe"

    ? Boolean(

        paymentsSnapshot.stripeAccountId?.trim() ||

          paymentsSnapshot.stripePublishableKey?.trim(),

      )

    : provider === "paypal"

    ? Boolean(

        paymentsSnapshot.paypalMerchantId?.trim() ||

          paymentsSnapshot.paypalClientId?.trim() ||

          paymentsSnapshot.paypalEmail?.trim(),

      )

    : false;

  const collectFeesStatus: "hidden" | "setup" | "pending" | "connected" = !tournamentId || !onlinePaymentsEnabled

    ? "hidden"

    : paymentsConfigData?.onlineConfigured

    ? "connected"

    : hasConnectionDetails

    ? "pending"

    : "setup";

  const collectFeesButtonClass = collectFeesStatus === "connected"

    ? "bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm"

    : collectFeesStatus === "pending"

    ? "bg-blue-500 hover:bg-blue-600 text-white shadow-sm"

    : "bg-red-600 hover:bg-red-700 text-white shadow-sm";

  const updateDetails = (updates: Partial<TournamentConfig["details"]>) =>

    onConfigChange({ ...config, details: { ...config.details, ...updates } });



  const handleAddAssistantTD = () => {

    const assistantTDs = config.details.assistantTDs ?? [];

    updateDetails({ assistantTDs: [...assistantTDs, ""] });

  };



  const handleUpdateAssistantTD = (index: number, value: string) => {

    const assistantTDs = [...(config.details.assistantTDs ?? [])];

    assistantTDs[index] = value;

    updateDetails({ assistantTDs });

  };



  const handleRemoveAssistantTD = (index: number) => {

    const assistantTDs = (config.details.assistantTDs ?? []).filter((_: any, i: any) => i !== index);

    updateDetails({ assistantTDs });

  };



  const updateRegisters = (updates: Partial<TournamentConfig["registers"]>) => {

    const finalUpdates = { ...updates };

    if ("allowSignup" in updates) {

      finalUpdates.allowPlayerToJoin = updates.allowSignup;

    }

    onConfigChange({ ...config, registers: { ...config.registers, ...finalUpdates } });

  };



  const updatePayments = (updates: Partial<TournamentConfig["payments"]>) =>

    onConfigChange({ ...config, payments: { ...config.payments, ...updates } });



  const updateChessResults = (updates: Partial<TournamentConfig["chessResults"]>) =>

    onConfigChange({ ...config, chessResults: { ...config.chessResults, ...updates } });



  const updatePublicPage = (updates: Partial<NonNullable<TournamentConfig["publicPage"]>>) =>

    onConfigChange({ 

      ...config, 

      publicPage: { 

        ...(config.publicPage || {}), 

        ...updates 

      } 

    });



  const addSection = () => {

    const nextSection = createSectionDefinition(sections.length);

    onConfigChange({

      ...config,

      sections: [...sections, nextSection],

    });

  };



  const updateSection = (id: string, updates: Partial<SectionDefinition>) => {

    const previousSection = sections.find((section: any) => section.id === id);

    const nextSections = sections.map((section: any) => (section.id === id ? { ...section, ...updates } : section));

    let nextEntryFees = config.entryFees;

    let nextPrizes = prizes;

    if (updates.name !== undefined || updates.ratingMin !== undefined || updates.ratingMax !== undefined) {

      const target = nextSections.find((section: any) => section.id === id);

      if (target) {

        const previousName = previousSection?.name.trim().toLowerCase() ?? "";

        const nextName = target.name.trim().toLowerCase();

        nextEntryFees = nextEntryFees.map((fee: any) => {

          const matchesById = fee.sectionId === id;

          const matchesByName =

            !fee.sectionId &&

            (fee.section ?? "").trim().toLowerCase() === (previousName || nextName);

          if (!matchesById && !matchesByName) {

            return fee;

          }

          return {

            ...fee,

            sectionId: target.id,

            section: target.name,

            ratingMin: fee.ratingMin ?? target.ratingMin ?? null,

            ratingMax: fee.ratingMax ?? target.ratingMax ?? null,

          };

        });

        nextPrizes = nextPrizes.map((prize: any) => {

          const matchesById = prize.sectionId === id;

          const matchesByName =

            !prize.sectionId &&

            (prize.section ?? "").trim().toLowerCase() === (previousName || nextName);

          if (!matchesById && !matchesByName) {

            return prize;

          }

          return {

            ...prize,

            sectionId: target.id,

            section: target.name,

            ratingCap: prize.ratingCap ?? target.ratingMax ?? null,

          };

        });

      }

    }

    onConfigChange({

      ...config,

      sections: nextSections,

      entryFees: nextEntryFees,

      prizes: nextPrizes,

    });

  };



  const removeSection = (id: string) => {

    const removedSection = sections.find((section: any) => section.id === id);

    const removedName = removedSection?.name.trim().toLowerCase() ?? null;

    const nextSections = sections.filter((section: any) => section.id !== id);

    const nextEntryFees = config.entryFees.filter((fee: any) => {

      if (fee.sectionId === id) return false;

      if (removedName && (fee.section ?? "").trim().toLowerCase() === removedName) {

        return false;

      }

      return true;

    });

    const nextPrizes = prizes.filter((prize: any) => {

      if (prize.sectionId === id) return false;

      if (removedName && (prize.section ?? "").trim().toLowerCase() === removedName) {

        return false;

      }

      return true;

    });

    onConfigChange({

      ...config,

      sections: nextSections,

      entryFees: nextEntryFees,

      prizes: nextPrizes,

    });

  };



  const addEntryFee = () => {

    if (sections.length === 0) {

      toast({

        title: "Add a section first",

        description: "Create sections under Details before configuring pricing.",

        variant: "destructive",

      });

      return;

    }

    const sectionWithGap = sections.find((section: any) =>

      !entryFees.some((fee: any) => {

        if (fee.sectionId && fee.sectionId === section.id) return true;

        return (fee.section ?? "").trim().toLowerCase() === section.name.trim().toLowerCase();

      }),

    );

    const targetSection = sectionWithGap ?? sections[0];

    const defaultCurrency = config.payments.defaultCurrency ?? "USD";

    onConfigChange({

      ...config,

      entryFees: [

        ...config.entryFees,

        createEntryFeeRow(targetSection, defaultCurrency),

      ],

    });

  };



  const updateEntryFee = (id: string, updates: Partial<EntryFeeRule>) => {

    const nextEntryFees = config.entryFees.map((fee: any) => {

      if (fee.id !== id) return fee;

      let nextFee: EntryFeeRule = { ...fee, ...updates };

      const nextSectionId = updates.sectionId ?? fee.sectionId;

      let linked: SectionDefinition | undefined;

      if (nextSectionId) {

        linked = sections.find((section: any) => section.id === nextSectionId);

      } else if (updates.section) {

        const normalized = updates.section.trim().toLowerCase();

        linked = sections.find((section: any) => section.name.trim().toLowerCase() === normalized);

      }

      if (linked) {

        nextFee = {

          ...nextFee,

          sectionId: linked.id,

          section: linked.name,

        };

        if (updates.sectionId !== undefined || updates.section !== undefined) {

          nextFee.ratingMin = null;

          nextFee.ratingMax = null;

        }

        if (!nextFee.currency) {

          nextFee.currency = config.payments.defaultCurrency ?? "USD";

        }

      }

      return nextFee;

    });

    onConfigChange({

      ...config,

      entryFees: nextEntryFees,

    });

  };



  const removeEntryFee = (id: string) =>

    onConfigChange({

      ...config,

      entryFees: config.entryFees.filter((fee: any) => fee.id !== id),

    });



  const handleSectionRatingChange = (id: string, field: "ratingMin" | "ratingMax", raw: string) => {

    const trimmed = raw.trim();

    if (trimmed.length === 0) {

      updateSection(id, { [field]: null } as Partial<SectionDefinition>);

      return;

    }

    const numeric = Number(trimmed);

    updateSection(id, { [field]: Number.isFinite(numeric) ? numeric : null } as Partial<SectionDefinition>);

  };



  const handleEntryFeeAmountChange = (id: string, raw: string) => {

    const trimmed = raw.trim();

    if (trimmed.length === 0) {

      updateEntryFee(id, { amount: 0 });

      return;

    }

    const parsed = Number(trimmed);

    updateEntryFee(id, { amount: Number.isFinite(parsed) ? Math.max(0, parsed) : 0 });

  };



  const handleEntryFeeRatingChange = (id: string, field: "ratingMin" | "ratingMax", raw: string) => {

    const trimmed = raw.trim();

    if (!trimmed) {

      updateEntryFee(id, { [field]: null } as Partial<EntryFeeRule>);

      return;

    }

    const numeric = Number(trimmed);

    updateEntryFee(id, { [field]: Number.isFinite(numeric) ? numeric : null } as Partial<EntryFeeRule>);

  };



  const handleEntryFeeDateChange = (id: string, value: string | null) => {

    const trimmed = value?.trim();

    updateEntryFee(id, { effectiveAfter: trimmed ? trimmed : null });

  };



  const addPrize = () => {

    const defaultCurrency = config.payments.defaultCurrency ?? "USD";

    const targetSection = sections.length > 0 ? sections[0] : undefined;

    onConfigChange({

      ...config,

      prizes: [...prizes, createPrizeRow(targetSection, defaultCurrency)],

    });

  };



  const updatePrize = (id: string, updates: Partial<PrizeRule>) => {

    const nextPrizes = prizes.map((prize: any) => {

      if (prize.id !== id) return prize;

      let nextPrize: PrizeRule = { ...prize, ...updates };

      const nextSectionId = updates.sectionId ?? prize.sectionId;

      let linked: SectionDefinition | undefined;

      if (nextSectionId) {

        linked = sections.find((section: any) => section.id === nextSectionId);

      } else if (updates.section) {

        const normalized = updates.section.trim().toLowerCase();

        linked = sections.find((section: any) => section.name.trim().toLowerCase() === normalized);

      }

      if (linked) {

        nextPrize = {

          ...nextPrize,

          sectionId: linked.id,

          section: linked.name,

        };

        if (updates.sectionId !== undefined || updates.section !== undefined) {

          nextPrize.ratingCap = linked.ratingMax ?? null;

        }

      }

      if (!nextPrize.currency) {

        nextPrize.currency = config.payments.defaultCurrency ?? "USD";

      }

      return nextPrize;

    });

    onConfigChange({

      ...config,

      prizes: nextPrizes,

    });

  };



  const removePrize = (id: string) =>

    onConfigChange({

      ...config,

      prizes: prizes.filter((prize: any) => prize.id !== id),

    });



  const handlePrizeRatingCapChange = (id: string, raw: string) => {

    const trimmed = raw.trim();

    if (!trimmed) {

      updatePrize(id, { ratingCap: null });

      return;

    }

    const numeric = parseRatingCap(trimmed);

    updatePrize(id, { ratingCap: numeric });

  };



  const handlePrizeAmountChange = (id: string, raw: string) => {

    const trimmed = raw.trim();

    if (!trimmed) {

      updatePrize(id, { amount: 0 });

      return;

    }

    const normalized = Number(trimmed.replace(/[^0-9.-]/g, ""));

    const amount = Number.isFinite(normalized) ? Number(normalized.toFixed(2)) : 0;

    updatePrize(id, { amount });

  };



  const handlePrizeCurrencyChange = (id: string, currency: string) => {

    updatePrize(id, { currency: currency.toUpperCase() });

  };



  const handlePrizePlaceChange = (id: string, value: string) => {

    updatePrize(id, { place: value.trim() });

  };



  const formatPrizeRating = (rating: number | null) => {

    if (rating === null) {

      return "Open";

    }

    return `U${rating}`;

  };



  const parseRatingCap = (input: string): number | null => {

    const match = input.match(/\d+/);

    if (!match) return null;

    const numeric = Number(match[0]);

    if (!Number.isFinite(numeric)) return null;

    return Math.max(0, Math.round(numeric));

  };



  const escapeHtml = (value: string) =>

    value

      .replace(/&/g, "&amp;")

      .replace(/</g, "&lt;")

      .replace(/>/g, "&gt;")

      .replace(/"/g, "&quot;")

      .replace(/'/g, "&#39;");



  const formatDate = (dateString: string | null): string | null => {

    if (!dateString) return null;

    const [year, month, day] = dateString.split('-').map(Number);

    if (!year || !month || !day) return null;

    const date = new Date(year, month - 1, day);

    return date.toLocaleDateString('en-US', {

      year: 'numeric',

      month: 'long',

      day: 'numeric',

      timeZone: 'UTC',

    });

  };



  const handlePrizePrint = () => {

    if (typeof window === "undefined") return;



    const groupedBySection: Record<string, PrizeRule[]> = prizes.reduce(

      (acc: any, prize: any) => {

        const sectionKey = prize.section || "Uncategorized";

        if (!acc[sectionKey]) {

          acc[sectionKey] = [];

        }

        acc[sectionKey].push(prize);

        return acc;

      },

      {} as Record<string, PrizeRule[]>,

    );



    const sectionsHtml = Object.entries(groupedBySection)

      .map(([sectionName, prizesInSection]) => {

        const sectionDef = sections.find((s: any) => s.name === sectionName);

        const sectionRatingMax = sectionDef?.ratingMax ?? null;



        const groupedByRatingCap: Record<string, PrizeRule[]> = prizesInSection.reduce(

          (acc: any, prize: any) => {

            const ratingCapKey =

              prize.ratingCap === sectionRatingMax || prize.ratingCap === null

                ? "main"

                : `U${prize.ratingCap}`;

            if (!acc[ratingCapKey]) {

              acc[ratingCapKey] = [];

            }

            acc[ratingCapKey].push(prize);

            return acc;

          },

          {} as Record<string, PrizeRule[]>,

        );



        const ratingCapsHtml = Object.entries(groupedByRatingCap)

          .map(([ratingCapName, prizesInCap]) => {

            const prizesHtml = prizesInCap

              .map((prize: any) => {

                const placeLabel = escapeHtml(prize.place ?? "");

                const amountLabel = escapeHtml(

                  `${prize.currency ?? "USD"} ${Number(prize.amount || 0).toFixed(2)}`,

                );

                return `<div class="prize-item">${placeLabel} - ${amountLabel}</div>`;

              })

              .join("");



            const capTitle =

              ratingCapName !== "main" ? `<h3 class="rating-cap-title">${escapeHtml(ratingCapName)}</h3>` : "";



            return `<div class="rating-group">

                      ${capTitle}

                      ${prizesHtml}

                    </div>`;

          })

          .join("");



        return `<div class="section">

                  <h2 class="section-title">${escapeHtml(sectionName)}</h2>

                  ${ratingCapsHtml}

                </div>`;

      })

      .join("");



    const tableHtml = prizes.length ? sectionsHtml : `<p>No prizes configured.</p>`;

    const tournamentName = escapeHtml(config.basic.name || "Tournament");

    

    const formattedStartDate = formatDate(config.basic.startDate);

    const formattedEndDate = formatDate(config.basic.endDate);

    const tournamentDate = escapeHtml(

      formattedStartDate

        ? `${formattedStartDate}${formattedEndDate && formattedEndDate !== formattedStartDate ? ` - ${formattedEndDate}` : ""}`

        : "N/A",

    );



    const content = `<!doctype html><html><head><title>Prize Payouts</title><style>

      body { font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; padding: 24px; color: #1e293b; }

      .header { text-align: center; margin-bottom: 2rem; }

      h1 { font-size: 1.875rem; line-height: 2.25rem; margin: 0; }

      .date { font-size: 1.125rem; line-height: 1.75rem; color: #475569; }

      .section { margin-bottom: 2.5rem; page-break-inside: avoid; }

      .section-title { text-align: center; font-size: 1.5rem; line-height: 2rem; margin-bottom: 1.5rem; color: #334155; }

      .rating-group { margin-top: 1.5rem; }

      .rating-cap-title { text-align: center; font-size: 1.125rem; font-weight: 600; color: #4f46e5; margin-bottom: 1rem; }

      .prize-item { text-align: center; font-size: 1rem; line-height: 1.5rem; margin-bottom: 0.5rem; }

      p { text-align: center; color: #64748b; }

    </style></head><body>

      <div class="header">

        <h1>${tournamentName}</h1>

        <p class="date">${tournamentDate}</p>

      </div>

      ${tableHtml}

    </body></html>`;



    const iframe = document.createElement("iframe");

    iframe.style.position = "absolute";

    iframe.style.width = "0";

    iframe.style.height = "0";

    iframe.style.border = "none";

    document.body.appendChild(iframe);



    const doc = iframe.contentWindow?.document;

    if (doc) {

      doc.open();

      doc.write(content);

      doc.close();

      iframe.contentWindow?.focus();

      iframe.contentWindow?.print();

    }



    setTimeout(() => {

      document.body.removeChild(iframe);

    }, 1000);

  };



  const handleSpectatorLinkPrint = async () => {

    if (typeof window === "undefined") return;



    const currentSpectatorLink = tournamentId ? `${window.location.origin}/tournaments/${tournamentId}` : "";

    let qrCodeDataUrl = "";

    try {

      qrCodeDataUrl = await qrcode.toDataURL(currentSpectatorLink, { errorCorrectionLevel: "H", width: 200 });

      console.log("Generated QR Code Data URL:", qrCodeDataUrl);

    } catch (error) {

      console.error("Failed to generate QR code", error);

    }



    const content = `<!doctype html><html><head><title>Spectator Link</title><style>

      body { font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; padding: 24px; text-align: center; }

      h1 { font-size: 24px; margin-bottom: 16px; }

      p { margin-bottom: 16px; }

      img { margin: 0 auto; display: block; }

    </style></head><body>

      <h1>Spectator Link for ${escapeHtml(config.basic.name)}</h1>

      <p>Share this link to allow others to spectate the event:</p>

      <p><a href="${currentSpectatorLink}">${currentSpectatorLink}</a></p>

      ${qrCodeDataUrl ? `<img src="${qrCodeDataUrl}" alt="QR Code" style="width: 200px; height: 200px;"/>` : ""}

      ${config.registers.allowPlayerToJoin ? `<p>Players can register for this tournament.</p>` : `<p>Players cannot register for this tournament.</p>`}

    </body></html>`;



    const iframe = document.createElement("iframe");

    iframe.style.position = "absolute";

    iframe.style.width = "0";

    iframe.style.height = "0";

    iframe.style.border = "none";

    document.body.appendChild(iframe);



    const doc = iframe.contentWindow?.document;

    if (doc) {

      doc.open();

      doc.write(content);

      doc.close();

      iframe.contentWindow?.focus();

      iframe.contentWindow?.print();

    }



    setTimeout(() => {

      document.body.removeChild(iframe);

    }, 1000);

  };



  const handlePrizeDownload = () => {

    if (typeof window === "undefined") return;

    const header = ["Section", "Rating", "Place", "Amount", "Currency"];

    const rows = prizes.map((prize: any) => [

      prize.section ?? "",

      formatPrizeRating(prize.ratingCap),

      prize.place ?? "",

      String(Number(prize.amount || 0).toFixed(2)),

      prize.currency ?? "USD",

    ]);

    const toCsvCell = (value: string) => `"${value.replace(/"/g, '""')}"`;

    const csv = [header, ...rows].map((row) => row.map((cell) => toCsvCell(cell ?? "")).join(",")).join("\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });

    const url = URL.createObjectURL(blob);

    const slug = config.basic.name

      ? config.basic.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")

      : "tournament";

    const link = document.createElement("a");

    link.href = url;

    link.download = `${slug || "tournament"}-prizes.csv`;

    document.body.appendChild(link);

    link.click();

    document.body.removeChild(link);

    URL.revokeObjectURL(url);

  };



  const handlePrizeImport = async (event: React.ChangeEvent<HTMLInputElement>) => {

    const file = event.target.files?.[0];

    if (!file) return;

    try {

      const text = await file.text();

      const lines = text

        .split(/\r?\n/)

        .map((line) => line.trim())

        .filter((line) => line.length > 0);

      if (lines.length === 0) {

        toast({

          title: "No data found",

          description: "Upload a CSV export from Google Sheets with at least one row.",

          variant: "destructive",

        });

        return;

      }

      let startIndex = 0;

      const header = lines[0].toLowerCase();

      if (header.includes("section") && header.includes("rating")) {

        startIndex = 1;

      }

      const defaultCurrency = config.payments.defaultCurrency ?? "USD";

      const headerCells =

        startIndex === 1 ? lines[0].split(",").map((cell) => cell.trim().toLowerCase()) : [];

      const imported: PrizeRule[] = [];

      for (let index = startIndex; index < lines.length; index += 1) {

        const rawLine = lines[index];

        if (!rawLine) continue;

        const cells = rawLine.split(",").map((cell) => cell.trim());

        const findIndex = (match: string) =>

          headerCells.findIndex((column) => column.includes(match));

        const sectionIndex = headerCells.length ? findIndex("section") : -1;

        const ratingIndex = headerCells.length ? findIndex("rating") : -1;

        const sectionCell = sectionIndex >= 0 && sectionIndex < cells.length ? cells[sectionIndex] : cells[0] ?? "";

        const ratingCell = ratingIndex >= 0 && ratingIndex < cells.length ? cells[ratingIndex] : cells[1] ?? "";

        const placeCell = (() => {

          if (headerCells.length) {

            const explicitPlace = findIndex("place");

            if (explicitPlace >= 0 && explicitPlace < cells.length) {

              return cells[explicitPlace];

            }

            const legacyNotes = findIndex("note");

            if (legacyNotes >= 0 && legacyNotes < cells.length) {

              return cells[legacyNotes];

            }

          }

          if (cells.length >= 5) {

            return cells[2] ?? "";

          }

          return "";

        })();

        const amountCell = (() => {

          if (headerCells.length) {

            const amountIndex = findIndex("amount");

            if (amountIndex >= 0 && amountIndex < cells.length) {

              return cells[amountIndex];

            }

          }

          if (cells.length === 4) {

            return cells[2] ?? "";

          }

          return cells[3] ?? "";

        })();

        const currencyCell = (() => {

          if (headerCells.length) {

            const currencyIndex = findIndex("currency");

            if (currencyIndex >= 0 && currencyIndex < cells.length) {

              return cells[currencyIndex];

            }

          }

          if (cells.length === 4) {

            return cells[3] ?? "";

          }

          return cells[4] ?? "";

        })();

        if (!sectionCell) continue;

        const linkedSection = sections.find(

          (section: any) => section.name.trim().toLowerCase() === sectionCell.trim().toLowerCase(),

        );

        const base = createPrizeRow(linkedSection, currencyCell || defaultCurrency);

        base.section = linkedSection?.name ?? sectionCell;

        base.sectionId = linkedSection?.id;

        base.ratingCap = ratingCell ? parseRatingCap(ratingCell) : linkedSection?.ratingMax ?? null;

        const normalizedAmount = Number(amountCell.replace(/[^0-9.-]/g, ""));

        base.amount = Number.isFinite(normalizedAmount) ? Number(normalizedAmount.toFixed(2)) : 0;

        base.currency = currencyCell ? currencyCell.toUpperCase() : defaultCurrency;

        base.place = placeCell.trim();

        imported.push(base);

      }

      if (imported.length === 0) {

        toast({

          title: "No rows imported",

          description: "Ensure your sheet has Section, Rating, Place, and Amount columns.",

          variant: "destructive",

        });

        return;

      }

      onConfigChange({

        ...config,

        prizes: imported,

      });

      toast({

        title: "Prizes imported",

        description: `Loaded ${imported.length} prize ${imported.length === 1 ? "row" : "rows"}`,

      });

    } catch (error) {

      toast({

        title: "Unable to import prizes",

        description:

          error instanceof Error

            ? error.message

            : "Upload failed. Export your Google Sheet as CSV and try again.",

        variant: "destructive",

      });

    } finally {

      if (event.target) {

        event.target.value = "";

      }

    }

  };



  const entryFees = config.entryFees ?? [];

  const sectionsMissingPricing = sections.filter((section: any) =>

    !entryFees.some((fee: any) => {

      if (fee.sectionId && fee.sectionId === section.id) return true;

      return (fee.section ?? "").trim().toLowerCase() === section.name.trim().toLowerCase();

    }),

  );



  const [, setLocation] = useLocation();

  const [settingsShortcut, setSettingsShortcut] = useState<SettingsShortcutTab>("rate-tournament");

  const [paymentsDialogOpen, setPaymentsDialogOpen] = useState(false);

  const [paymentSettingsDraft, setPaymentSettingsDraft] = useState(config.payments);

  const [chessResultsEnabled, setChessResultsEnabled] = useState(false);

  const [qrCodeModalOpen, setQrCodeModalOpen] = useState(false);

  const spectatorLink = tournamentId ? `${window.location.origin}/tournaments/${tournamentId}` : "";



  const testMutation = useMutation({

    mutationFn: async () => {

      if (!config) throw new Error("Configuration not ready");

      await apiRequest(`/api/tournaments/${tournamentId}/webhook-sync/test`, {

        method: "POST",

        body: JSON.stringify({ config }),

      });

    },

    onSuccess: () => {

      toast({ title: "Webhook connection successful" });

    },

    onError: (error: any) => {

      toast({

        title: "Connection failed",

        description: error?.message ?? "Verify credentials and try again.",

        variant: "destructive",

      });

    },

  });



  const syncMutation = useMutation({

    mutationFn: async () => {

      if (!config) throw new Error("Configuration not ready");

      const response = await apiRequest(`/api/tournaments/${tournamentId}/webhook-sync`, {

        method: "POST",

        body: JSON.stringify({ config }),

      });

      return response;

    },

    onSuccess: (result: any) => {

      if (result?.config) {

        onConfigChange(cloneConfig(result.config));

      }

      toast({ title: "Webhook sync complete" });

      queryClient.invalidateQueries({ queryKey: [`/api/tournaments/${tournamentId}`] });

    },

    onError: (error: any) => {

      toast({

        title: "Sync failed",

        description: error?.message ?? "Check credentials and network access.",

        variant: "destructive",

      });

    },

  });



  useEffect(() => {

    if (paymentsDialogOpen) {

      setPaymentSettingsDraft(config.payments);

    }

  }, [paymentsDialogOpen, config.payments]);



  const handlePaymentSettingsDialogChange = (open: boolean) => {

    setPaymentsDialogOpen(open);

    if (!open) {

      setPaymentSettingsDraft(config.payments);

    }

  };



  const commitPaymentSettings = (next: TournamentConfig["payments"]) => {

    onConfigChange({ ...config, payments: next });

  };



  const updatePaymentDraft = <K extends keyof TournamentConfig["payments"]>(

    key: K,

    value: TournamentConfig["payments"][K],

  ) => {

    setPaymentSettingsDraft((prev: any) => ({ ...prev, [key]: value }));

  };



  const toggleOfflineMethod = (method: OfflinePaymentMethod) => {

    setPaymentSettingsDraft((prev: any) => {

      const current = prev.acceptedOfflineMethods ?? [];

      const next = current.includes(method)

        ? current.filter((value: any) => value !== method)

        : [...current, method];

      return { ...prev, acceptedOfflineMethods: next };

    });

  };



  const handleProcessingFeeChange = (raw: string) => {

    const trimmed = raw.trim();

    if (!trimmed) {

      updatePaymentDraft("processingFeePercent", null);

      return;

    }

    const numeric = Number(trimmed);

    if (Number.isFinite(numeric)) {

      const clamped = Math.max(0, Math.min(10, Number(numeric.toFixed(2))));

      updatePaymentDraft("processingFeePercent", clamped);

    }

  };



  const handlePaymentSettingsSave = () => {

    commitPaymentSettings(paymentSettingsDraft);

    setPaymentsDialogOpen(false);

    onSave();

  };



  const handleDownloadWebhookSync = () => {

    if (!config) return;

    downloadJson(`tournament-${tournamentId}-webhook-sync.json`, {

      tournamentId,

      tournamentName: tournament?.name,

      form: "WebhookSync",

      data: config.webhookSync,

    });

  };



  const defaultTimeControlFor = (type: TimeControlType): TimeControlDefinition => {

    switch (type) {

      case "rapid":

        return { minutes: 15, addonType: "increment", addonValue: 10 };

      case "blitz":

        return { minutes: 5, addonType: "none", addonValue: 0 };

      default:

        return { minutes: 90, addonType: "increment", addonValue: 30 };

    }

  };



  const baseTimeControls: TimeControlDefinition[] =

    config.details.timeControls && config.details.timeControls.length > 0

      ? config.details.timeControls

      : [defaultTimeControlFor(config.details.timeControl)];



  const addTimeControl = () => {

    const last = baseTimeControls[baseTimeControls.length - 1] ?? defaultTimeControlFor(config.details.timeControl);

    const next = [...baseTimeControls, { ...last }];

    onConfigChange({

      ...config,

      details: { ...config.details, timeControls: next },

    });

  };



  const updateTimeControlDefinition = (index: number, updates: Partial<TimeControlDefinition>) => {

    const next = baseTimeControls.map((control, idx) => (idx === index ? { ...control, ...updates } : control));

    onConfigChange({

      ...config,

      details: { ...config.details, timeControls: next },

    });

  };



  const removeTimeControl = (index: number) => {

    if (baseTimeControls.length <= 1) return;

    const next = baseTimeControls.filter((_, idx) => idx !== index);

    onConfigChange({

      ...config,

      details: { ...config.details, timeControls: next },

    });

  };



  const templateLabelToRound = (label: string): number | null => {

    const match = label.match(/^Round\s+(\d+)/i);

    if (!match) return null;

    const value = parseInt(match[1] ?? "", 10);

    return Number.isFinite(value) ? value : null;

  };



  const ensureRoundSchedule = (schedule: ScheduleEvent[], rounds: number): ScheduleEvent[] => {

    const roundEvents: ScheduleEvent[] = [];

    const nonRoundEvents: ScheduleEvent[] = [];

    const seenRounds = new Set<number>();



    schedule.forEach((event: any) => {

      if (event.round && event.round >= 1 && event.round <= rounds) {

        if (!seenRounds.has(event.round)) {

          seenRounds.add(event.round);

          roundEvents.push({

            ...event,

            label: event.label || `Round ${event.round}`,

            round: event.round,

          });

        }

      } else if (event.round && event.round > rounds) {

        nonRoundEvents.push({ ...event, round: null });

      } else {

        nonRoundEvents.push(event);

      }

    });



    for (let round = 1; round <= rounds; round++) {

      if (!seenRounds.has(round)) {

        roundEvents.push({

          id: `${Date.now()}-${round}-${Math.random()}`,

          date: null,

          time: null,

          label: scheduleTemplateOptions[round - 1] ?? `Round ${round}`,

          round,

        });

      }

    }



    roundEvents.sort((a, b) => (a.round ?? 0) - (b.round ?? 0));

    return [...roundEvents, ...nonRoundEvents];

  };



  const addScheduleRow = () => {

    const newEvent: ScheduleEvent = {

      id: `${Date.now()}-${Math.random()}`,

      date: null,

      time: null,

      label: "Other Event",

      round: null,

    };

    onConfigChange({

      ...config,

      schedule: [...config.schedule, newEvent],

    });

  };



  const removeScheduleRow = (id: string) => {

    const nextSchedule = config.schedule.filter((event: any) => event.id !== id);

    onConfigChange({

      ...config,

      schedule: ensureRoundSchedule(nextSchedule, config.details.rounds),

    });

  };



  const updateScheduleRow = (id: string, updates: Partial<ScheduleEvent>) => {

    const nextSchedule = config.schedule.map((event: any) => {

      if (event.id !== id) return event;

      const nextEvent = { ...event, ...updates };

      if (updates.label !== undefined) {

        const derivedRound = templateLabelToRound(updates.label ?? "");

        nextEvent.round = derivedRound;

      }

      if (updates.round !== undefined && updates.round === null) {

        nextEvent.round = null;

      }

      return nextEvent;

    });



    onConfigChange({

      ...config,

      schedule: ensureRoundSchedule(nextSchedule, config.details.rounds),

    });

  };



  const handleRoundsChange = (value: number) => {

    const nextRounds = Math.max(1, value);

    // When the user explicitly changes the rounds count here,

    // we should update the config details AND update the schedule

    // to match the new count. This ensures that the generated schedule

    // respects the configured number of rounds.

    onConfigChange({

      ...config,

      details: { ...config.details, rounds: nextRounds },

      schedule: ensureRoundSchedule(config.schedule, nextRounds),

    });

  };



  const handleShortcutChange = (next: SettingsShortcutTab) => {

    if (next === "rate-tournament") {

      setSettingsShortcut("rate-tournament");

      return;

    }

    if (!tournament) {

      setSettingsShortcut("rate-tournament");

      return;

    }



    const target = `/tournaments/${tournament.id}/reports/${next}`;

    setSettingsShortcut("rate-tournament");

    setLocation(target);

  };



  const fideEnabled = config.registers.fideRated;

  



  const renderTabSaveButton = () => {

    if (builderMode === "create") {

      return (

        <div className="flex justify-end pt-4">

          <Button type="button" onClick={onSave} disabled={saving}>

            {saving ? "Creating..." : "Create Tournament"}

          </Button>

        </div>

      );

    }

    

    return (

      <div className="flex items-center justify-end pt-4 gap-2 text-[11px] font-medium text-slate-400 h-10">

        {saving ? (

          <>

            <Loader2 className="h-3 w-3 animate-spin text-indigo-500" />

            <span>Autosaving...</span>

          </>

        ) : (

          <div className="flex items-center gap-1.5 opacity-60">

            <Check className="h-3 w-3 text-green-500" />

            <span>All changes saved</span>

          </div>

        )}

      </div>

    );

  };



  const defaultScoring = useMemo(() => createDefaultConfig(format).details.scoring, [format]);

  const scoring = config.details.scoring ?? defaultScoring;

  const tiebreaks = config.details.tiebreaks ?? [];

  const handleScoreChange = (field: keyof ScoringRules, raw: string) => {

    if (raw === "") {

      updateDetails({ scoring: { ...scoring, [field]: 0 } });

      return;

    }

    const numeric = Number(raw);

    if (!Number.isFinite(numeric)) {

      return;

    }

    const clamped = Math.max(-10, Math.min(10, Number(numeric.toFixed(2))));

    updateDetails({ scoring: { ...scoring, [field]: clamped } });

  };

  const resetScoring = () => updateDetails({ scoring: { ...defaultScoring } });

  const setTiebreaks = (next: string[]) => updateDetails({ tiebreaks: next });

  const addTiebreakRule = () => {

    const fallback = TIEBREAK_OPTIONS.find((option) => !tiebreaks.includes(option.label))?.label ?? "Buchholz";

    updateDetails({

      tiebreaks: [...tiebreaks, fallback],

      tiebreaksEnabled: true

    });

  };

  const updateTiebreakRule = (index: number, value: string) => {

    const next = [...tiebreaks];

    next[index] = value;

    setTiebreaks(next);

  };

  const removeTiebreakRule = (index: number) => {

    const next = tiebreaks.filter((_: any, position: any) => position !== index);

    setTiebreaks(next);

  };

  const moveTiebreakRule = (index: number, delta: number) => {

    const target = index + delta;

    if (target < 0 || target >= tiebreaks.length) {

      return;

    }

    const next = [...tiebreaks];

    const [entry] = next.splice(index, 1);

    next.splice(target, 0, entry);

    setTiebreaks(next);

  };

  const toggleTiebreaks = (checked: boolean) => updateDetails({ tiebreaksEnabled: checked });



  return (

    <>

      <div className="space-y-6">

        <div className="flex flex-wrap items-center justify-between gap-3">

        <div className="flex items-center gap-2 text-sm text-muted-foreground">

          <span>

            Format: <Badge variant="secondary">{format.toUpperCase()}</Badge>

          </span>

          <span>

            Mode: <Badge variant="outline">{mode.toUpperCase()}</Badge>

          </span>

        </div>

      </div>



      <div className="grid gap-6 lg:grid-cols-1">

        <Card className="overflow-hidden">

          <CardContent className="p-0">

            <Tabs

              value={activeSubTab ?? undefined}

              defaultValue={activeSubTab ? undefined : "basic"}

              onValueChange={onSubTabChange as any}

              className="w-full"

            >

            <TabsList className="flex w-full min-h-[44px] h-auto flex-nowrap overflow-x-auto no-scrollbar items-center bg-slate-100 p-1 mb-8 rounded-xl border border-slate-200/60 shadow-sm backdrop-blur-sm">

              <TabsTrigger value="basic" className="flex-none md:flex-1 h-full min-h-[36px] data-[state=active]:bg-white data-[state=active]:shadow-md data-[state=active]:text-black transition-all font-medium rounded-lg px-4 text-xs xl:text-sm">Basic Info</TabsTrigger>

              <TabsTrigger value="details" className="flex-none md:flex-1 h-full min-h-[36px] data-[state=active]:bg-white data-[state=active]:shadow-md data-[state=active]:text-black transition-all font-medium rounded-lg px-4 text-xs xl:text-sm">Details</TabsTrigger>

              <TabsTrigger value="tournamentPage" className="flex-none md:flex-1 h-full min-h-[36px] data-[state=active]:bg-white data-[state=active]:shadow-md data-[state=active]:text-black transition-all font-medium rounded-lg px-4 text-xs xl:text-sm">Public Page</TabsTrigger>

              <TabsTrigger value="payments" className="flex-none md:flex-1 h-full min-h-[36px] data-[state=active]:bg-white data-[state=active]:shadow-md data-[state=active]:text-black transition-all font-medium rounded-lg px-4 text-xs xl:text-sm">Payments</TabsTrigger>

              <TabsTrigger value="prizes" disabled className="flex-none md:flex-1 h-full min-h-[36px] data-[state=active]:bg-white data-[state=active]:shadow-md data-[state=active]:text-black transition-all font-medium rounded-lg px-4 text-xs xl:text-sm opacity-40 cursor-not-allowed pointer-events-none flex items-center justify-center gap-1.5">

                Prizes

                <span className="text-[9px] font-semibold text-slate-500 bg-slate-200/80 px-1 py-0.5 rounded leading-none">Soon</span>

              </TabsTrigger>

              <TabsTrigger value="options" className="flex-none md:flex-1 h-full min-h-[36px] data-[state=active]:bg-white data-[state=active]:shadow-md data-[state=active]:text-black transition-all font-medium rounded-lg px-4 text-xs xl:text-sm">Options</TabsTrigger>

            </TabsList>



              <TabsContent value="basic" className="bg-white p-6 space-y-4">

                <BasicInformationFields config={config} onConfigChange={onConfigChange} />

                {renderTabSaveButton()}

              </TabsContent>





              <TabsContent value="details" className="bg-white p-6 space-y-4">











                {config.format !== 'arena' && config.format !== 'knockout' && (

                  <div className="grid gap-4 md:grid-cols-2">

                    <div className="space-y-2">

                      <Label>Rounds</Label>

                      <Input

                        type="number"

                        min={1}

                        value={config.details.rounds}

                        onChange={(event: any) => {

                          const value = Math.max(1, parseInt(event.target.value || "1", 10));

                          handleRoundsChange(value);

                        }}

                      />

                    </div>

                  </div>

                )}

                {config.format === 'arena' && (

                  <div className="space-y-6 pt-4 border-t border-slate-100">

                      <h3 className="text-base font-medium text-black">Arena Configuration</h3>

                    <ArenaSettingsTab config={config} onConfigChange={onConfigChange} onSave={onSave} saving={saving} />

                  </div>

                )}



                {config.format !== 'arena' && (

                  <div className="space-y-4 pt-4 border-t border-slate-100">

                    <h3 className="text-base font-medium text-black">Scoring Protocol</h3>

                    <div className="flex items-center justify-between mb-2">

                      <p className="text-xs text-slate-500">Customize how many points players earn for each result.</p>

                      <Button variant="outline" size="sm" className="h-8 text-[10px] font-medium text-black" onClick={resetScoring}>

                        Reset to defaults

                      </Button>

                    </div>

                    <div className="grid gap-4 md:grid-cols-3">

                      <ScoreInput

                        id="scoring-win"

                        label="Win"

                        value={scoring.win}

                        onChange={(v: any) => handleScoreChange("win", v)}

                      />

                      <ScoreInput

                        id="scoring-draw"

                        label="Draw"

                        value={scoring.draw}

                        onChange={(v: any) => handleScoreChange("draw", v)}

                      />

                      <ScoreInput

                        id="scoring-loss"

                        label="Loss"

                        value={scoring.loss}

                        onChange={(v: any) => handleScoreChange("loss", v)}

                      />

                    </div>

                  </div>

                )}



                {/* Swiss Pairing Options (US Chess Rules 28R, 28T) */}

                {config.format === 'swiss' && (

                  <div className="space-y-4 pt-4 border-t border-slate-100">

                    <div>

                      <h3 className="text-base font-medium text-black">Swiss Pairing Options</h3>

                      <p className="text-xs text-slate-500 mt-0.5">US Chess Rule Book pairing options for compliant tournaments.</p>

                    </div>



                    {/* Rule 28R - Accelerated Swiss */}

                    <div className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50/30 px-4 py-3.5">

                      <div className="space-y-0.5">

                        <Label className="text-[15px] font-medium text-black">Accelerated Pairings (Rule 28R)</Label>

                        <p className="text-xs text-slate-500 font-normal">Adds 1 virtual point to the top half of players in rounds 1 and 2 to reduce perfect scores. Helps identify the top player faster.</p>

                      </div>

                      <Switch

                        checked={!!(config.details as any).acceleratedPairings}

                        onCheckedChange={(checked) => onConfigChange({ ...config, details: { ...config.details, acceleratedPairings: checked } as any })}

                      />

                    </div>

                  </div>

                )}



                {(config.format === 'knockout' || config.format === 'arena') && (

                  <div className="space-y-6 mb-6 p-6 rounded-2xl bg-white border border-slate-200 shadow-sm">

                      <h3 className="text-base font-medium text-black flex items-center gap-2">

                        {config.format === 'knockout' ? 'Knockout Protocol' : 'Arena Rating Attachment'}

                        <Paperclip className="h-4 w-4 text-slate-400" />

                      </h3>



                    <div className="grid gap-6 md:grid-cols-2">

                      {config.format !== 'arena' && (

                        <div className="space-y-2">

                          <Label className="text-[15px] font-medium text-black">Seeding Protocol</Label>

                          <p className="text-[11px] text-slate-600 mb-2">

                            Define how participants are positioned within the tournament {config.format === 'knockout' ? 'bracket' : 'pairing pool'}.

                          </p>

                          <Select

                            value={config.seedingMethod ?? "fide_world_cup"}

                            onValueChange={(value: any) => onConfigChange({ ...config, seedingMethod: value as any })}

                          >

                            <SelectTrigger className="w-full bg-white shadow-sm border-indigo-100 focus:ring-indigo-500">

                              <SelectValue placeholder="Select seeding method" />

                            </SelectTrigger>

                            <SelectContent>

                              <SelectItem value="fide_world_cup">Standard {config.format === 'knockout' ? 'Knockout' : 'Arena'} System(Default)</SelectItem>

                              <SelectItem value="slaughter">Slaughter Seeding (Top Half vs Bottom Half)</SelectItem>

                              <SelectItem value="random">Randomized (Blind Draw)</SelectItem>

                              <SelectItem value="manual">Manual Assignment (Custom Seeds)</SelectItem>

                            </SelectContent>

                          </Select>

                        </div>

                      )}



                      {(config.format === 'arena' || (config.seedingMethod !== 'random' && config.seedingMethod !== 'manual')) && (

                        <div className="space-y-2">

                          <Label className="text-[15px] font-medium text-black">Rating Source (Attachment)</Label>

                          <p className="text-[11px] text-slate-600 mb-2">

                            Select the primary rating database used to determine participant eligibility and {config.format === 'knockout' ? 'bracket position' : 'pairing priority'}.

                          </p>

                          <Select

                            value={config.seedingSource ?? "rating"}

                            onValueChange={(value: any) => onConfigChange({ ...config, seedingSource: value as any })}

                          >

                            <SelectTrigger className="w-full bg-white shadow-sm border-indigo-100 focus:ring-indigo-500">

                              <div className="flex items-center gap-2">

                                <Paperclip className="h-3 w-3 text-indigo-500" />

                                <SelectValue placeholder="Select rating source" />

                              </div>

                            </SelectTrigger>

                            <SelectContent>

                              <SelectItem value="rating">Tournament Entry Rating</SelectItem>

                              <SelectItem value="uscf">USCF Official Rating</SelectItem>

                              <SelectItem value="fide">FIDE Official Rating</SelectItem>

                            </SelectContent>

                          </Select>

                        </div>

                      )}

                    </div>



                    {config.format === 'knockout' && (

                      <>

                        <div className="flex items-center space-x-2 border-t border-indigo-100/50 pt-6">

                          <Switch 

                            id="third-place" 

                            checked={config.details.thirdPlaceMatch}

                            onCheckedChange={(checked) => updateDetails({ thirdPlaceMatch: checked })}

                          />

                          <div className="space-y-0.5">

                            <Label htmlFor="third-place" className="text-[15px] font-medium text-black">3rd-Place Match</Label>

                            <p className="text-[11px] text-slate-600">

                              Enable a playoff between semi-final losers to determine the 3rd place finisher.

                            </p>

                          </div>

                        </div>



                        <div className="flex items-center space-x-2 border-t border-indigo-100/50 pt-6">

                          <Switch 

                            id="double-elim" 

                            checked={config.registers.isDoubleElimination}

                            onCheckedChange={(checked) => updateRegisters({ isDoubleElimination: checked })}

                          />

                          <div className="space-y-0.5">

                            <Label htmlFor="double-elim" className="text-[15px] font-medium text-black">Double Elimination</Label>

                            <p className="text-[11px] text-slate-600">

                              Enable a losers bracket for participants who lose their first match.

                            </p>

                          </div>

                        </div>



                        <div className="border-t border-indigo-100/50 pt-6">

                          <KnockoutFormatEditor 

                            config={config}

                            onConfigChange={onConfigChange}

                          />

                        </div>

                      </>

                    )}

                  </div>

                )}







                <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50/70 p-4">

                  <div className="flex flex-wrap items-center justify-between gap-3">

                    <div>

                      <h3 className="text-base font-medium text-black">Sections & Rating Bands</h3>

                      <p className="text-xs text-slate-500">

                        Define the sections players can enter. Rating bounds are enforced throughout registration and pricing.

                      </p>

                    </div>

                    <Button variant="outline" onClick={addSection}>

                      Add section

                    </Button>

                  </div>



                  {sections.length === 0 ? (

                    <div className="space-y-3">

                      <div className="flex items-center justify-between p-4 rounded-xl border border-dashed border-slate-200 bg-slate-50/50">

                        <div className="flex items-center gap-3">

                          <div className="w-8 h-8 rounded-lg bg-white flex items-center justify-center border shadow-sm">

                            <span className="text-[10px] font-bold text-slate-400">01</span>

                          </div>

                          <div>

                            <span className="text-base font-medium text-black">Open Section</span>

                            <p className="text-[10px] text-slate-400 font-medium italic">Auto-generated fallback section</p>

                          </div>

                        </div>

                        <Badge variant="outline" className="text-[10px] font-bold">ACTIVE</Badge>

                      </div>

                      <p className="text-[11px] text-slate-500 italic px-1">Adding your first custom section will replace this default.</p>

                    </div>

                  ) : (

                    <div className="space-y-3">

                      {sections.map((section: any) => {

                        const ratingLabel =

                          section.ratingMin === null && section.ratingMax === null

                            ? "Open to all ratings"

                            : `${section.ratingMin ?? "Unrated"} – ${section.ratingMax ?? "Open"}`;



                        return (

                          <div key={section.id} className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">

                            <div className="grid gap-3 md:grid-cols-[minmax(0,1.6fr)_repeat(2,minmax(0,1fr))_auto] md:items-end">

                              <div>

                                <Label className="text-sm font-semibold text-slate-500">Section name</Label>

                                <Input

                                  value={section.name}

                                  onChange={(event: any) => updateSection(section.id, { name: event.target.value })}

                                  placeholder="e.g., Championship"

                                />

                              </div>

                              <div>

                                <Label className="text-sm font-semibold text-slate-500">Rating floor</Label>

                                <Input

                                  type="number"

                                  value={section.ratingMin ?? ""}

                                  onChange={(event: any) =>

                                    handleSectionRatingChange(section.id, "ratingMin", event.target.value)

                                  }

                                  placeholder="e.g., 1800"

                                />

                              </div>

                              <div>

                                <Label className="text-sm font-semibold text-slate-500">Rating ceiling</Label>

                                <Input

                                  type="number"

                                  value={section.ratingMax ?? ""}

                                  onChange={(event: any) =>

                                    handleSectionRatingChange(section.id, "ratingMax", event.target.value)

                                  }

                                  placeholder="Leave blank for open"

                                />

                              </div>

                              <Button

                                type="button"

                                variant="ghost"

                                className="justify-self-end text-red-600 font-medium"

                                onClick={() => removeSection(section.id)}

                              >

                                Remove

                              </Button>

                            </div>

                            <p className="text-[11px] uppercase tracking-wide text-slate-400">{ratingLabel}</p>

                          </div>

                        );

                      })}

                    </div>

                  )}



                  {sections.length > 0 && (

                    <p className="text-xs text-slate-500">

                      Tip: After defining sections, configure required entry fees in the Payments tab.

                    </p>

                  )}

                </div>



                {config.format === 'swiss' && (

                  <div className="space-y-6 pt-6 border-t border-slate-100">

                    {/* Allow Extra Games Toggle */}

                    <div className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50/30 px-5 py-4 transition-all hover:bg-slate-50/50">

                      <div className="space-y-0.5">

                        <Label htmlFor="details-allow-extra-games" className="text-base font-medium text-black">Allow Extra Games</Label>

                        <p className="text-xs text-slate-500 font-normal">Allow TDs to schedule rated extra games that are excluded from official standings.</p>

                      </div>

                      <Switch

                        id="details-allow-extra-games"

                        checked={config.registers.allowExtraGames ?? false}

                        onCheckedChange={(checked) => updateRegisters({ allowExtraGames: checked })}

                      />

                    </div>



                    <div className="space-y-4 pt-6 border-t border-slate-100/60">

                      <div className="flex items-center justify-between">

                        <div>

                          <h3 className="text-base font-semibold text-black">Tiebreaker System</h3>

                          <p className="text-xs text-slate-500">

                            Configure tiebreaker systems and their sorting priority order for Swiss standings.

                          </p>

                        </div>

                        <div className="flex items-center space-x-2">

                          <Switch

                            id="tiebreaks-enabled"

                            checked={config.details.tiebreaksEnabled ?? false}

                            onCheckedChange={toggleTiebreaks}

                          />

                          <Label htmlFor="tiebreaks-enabled">Enable Tiebreaks</Label>

                        </div>

                      </div>



                    {config.details.tiebreaksEnabled && (

                      <div className="space-y-3">

                        {tiebreaks.map((rule: any, idx: any) => (

                          <TiebreakRow

                            key={idx}

                            index={idx}

                            total={tiebreaks.length}

                            value={rule}

                            onChange={(value: any) => updateTiebreakRule(idx, value)}

                            onRemove={() => removeTiebreakRule(idx)}

                            onMoveUp={() => moveTiebreakRule(idx, -1)}

                            onMoveDown={() => moveTiebreakRule(idx, 1)}

                          />

                        ))}

                        <Button

                          type="button"

                          variant="outline"

                          onClick={addTiebreakRule}

                          className="w-full gap-2 border-dashed border-slate-200 text-slate-600 hover:text-black hover:border-slate-300"

                        >

                          <Plus className="h-4 w-4" />

                          Add Tiebreaker Rule

                        </Button>

                      </div>

                    )}

                    </div>

                  </div>

                )}



                {config.format !== 'knockout' && config.format !== 'arena' && (

                  <div className="space-y-4 pt-6 border-t border-slate-100">

                    <div className="space-y-1">

                      <h3 className="text-base font-semibold text-black">Bye Rules</h3>

                      <p className="text-xs text-slate-500">Control how half-point byes are requested by players.</p>

                    </div>

                    <div className="space-y-2">

                      <Label className="text-sm font-medium text-black">Limit Requested Byes Per Player</Label>

                      <Input

                        type="number"

                        className="h-11 border-slate-200"

                        placeholder="No limit"

                        min={0}

                        value={config.registers.byeLimit ?? ""}

                        onChange={(e) => updateRegisters({ byeLimit: e.target.value ? parseInt(e.target.value) : null })}

                      />

                      <p className="text-xs text-slate-400">Limit the number of requested byes allowed per player. Leave blank for no limit.</p>

                    </div>

                    <div className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50/30 px-4 py-3.5">

                      <div className="space-y-0.5">

                        <Label className="text-[15px] font-medium text-black">Allow Bye in Last Round</Label>

                        <p className="text-xs text-slate-500 font-normal">When disabled, players cannot request a bye in the final round.</p>

                      </div>

                      <Switch

                        checked={config.registers?.allowLastRoundBye !== false}

                        onCheckedChange={(checked) => updateRegisters({ allowLastRoundBye: checked })}

                      />

                    </div>

                  </div>

                )}



                {renderTabSaveButton()}

              </TabsContent>





              <TabsContent value="tournamentPage" className="bg-white p-6">

                {tournament && (

                  <TournamentPagePanel

                    tournament={tournament}

                    onUpdated={() => {

                      queryClient.invalidateQueries({ queryKey: [`/api/tournaments/${tournament.id}`] });

                    }}

                  />

                )}

              </TabsContent>

              <TabsContent value="payments" className="bg-white p-6 space-y-5">

                <div className="flex flex-wrap items-center justify-between gap-3">

                  <div>

                    <h3 className="text-base font-semibold text-slate-900">Entry fee rules</h3>

                    <p className="text-xs text-slate-600">

                      Configure pricing by section, rating eligibility, and effective date.

                    </p>

                  </div>

                  <div className="flex items-center gap-2">

                    {collectFeesStatus !== "hidden" && (

                      <Button

                        type="button"

                        className={cn("flex items-center gap-2", collectFeesButtonClass)}

                        onClick={() => {

                          if (tournamentId) {

                            setLocation(`/tournaments/${tournamentId}/payments/setup`);

                          }

                        }}

                        disabled={!tournamentId}

                      >

                        <CreditCard className="h-4 w-4" />

                        Collect Entry Fees

                      </Button>

                    )}

                    <Button

                      type="button"

                      variant="ghost"

                      size="sm"

                      className="h-9 gap-2 border"

                      onClick={() => setPaymentsDialogOpen(true)}

                    >

                      <Settings className="h-4 w-4" />

                      <span>Settings</span>

                    </Button>

                    <Button variant="outline" onClick={addEntryFee} disabled={sections.length === 0}>

                      Add entry rule

                    </Button>

                  </div>

                </div>



                {sections.length === 0 ? (

                  <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4 text-xs text-slate-600">

                    Create sections under the Details tab before configuring pricing.

                  </div>

                ) : entryFees.length === 0 ? (

                  <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4 text-xs text-slate-600">

                    No entry rules configured yet. Add a rule for each section to open registration.

                  </div>

                ) : (

                  <div className="space-y-3">

                    {entryFees.map((fee: any) => {

                      const activeSection =

                        sections.find((section: any) => section.id === fee.sectionId) ??

                        sections.find(

                          (section: any) => section.name.trim().toLowerCase() === (fee.section ?? "").trim().toLowerCase(),

                        );

                      const derivedRatingMin =

                        fee.ratingMin ?? activeSection?.ratingMin ?? null;

                      const derivedRatingMax =

                        fee.ratingMax ?? activeSection?.ratingMax ?? null;

                      const inheritsSectionRange = fee.ratingMin === null && fee.ratingMax === null;

                      const ratingSummary = formatRatingRange(derivedRatingMin, derivedRatingMax);



                      return (

                        <div key={fee.id} className="space-y-4 rounded-lg border border-slate-200 bg-slate-50/60 p-4">

                          <div className="grid gap-3 md:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)_auto] md:items-baseline">

                            <div className="space-y-2">

                              <Label className="text-sm font-semibold text-slate-700">Section</Label>

                              <Select

                                value={activeSection?.id ?? fee.sectionId ?? ""}

                                onValueChange={(value: any) => updateEntryFee(fee.id, { sectionId: value })}

                              >

                                <SelectTrigger className="h-11">

                                  <SelectValue placeholder="Select section" />

                                </SelectTrigger>

                                <SelectContent>

                                  {sections.map((section: any) => (

                                    <SelectItem key={section.id} value={section.id}>

                                      {section.name || "Unnamed section"}

                                    </SelectItem>

                                  ))}

                                </SelectContent>

                              </Select>

                              <p className="mt-1 text-[11px] text-slate-500">{ratingSummary}</p>

                            </div>

                            <div className="space-y-2">

                              <Label className="text-sm font-semibold text-slate-700">Amount</Label>

                              <Input

                                type="number"

                                step="0.01"

                                className="h-11"

                                value={typeof fee.amount === "number" ? String(fee.amount) : ""}

                                onChange={(event: any) => handleEntryFeeAmountChange(fee.id, event.target.value)}

                                placeholder="e.g., 120"

                              />

                            </div>

                            <div className="space-y-2">

                              <Label className="text-sm font-semibold text-slate-700">Currency</Label>

                              <Select

                                value={fee.currency || config.payments.defaultCurrency || "USD"}

                                onValueChange={(value: any) => updateEntryFee(fee.id, { currency: value })}

                              >

                                <SelectTrigger className="h-11">

                                  <SelectValue />

                                </SelectTrigger>

                                <SelectContent>

                                  {ENTRY_FEE_CURRENCY_OPTIONS.map((option) => (

                                    <SelectItem key={option} value={option}>

                                      {option}

                                    </SelectItem>

                                  ))}

                                </SelectContent>

                              </Select>

                            </div>

                            <Button

                              type="button"

                              variant="ghost"

                              className="justify-self-end text-red-600"

                              onClick={() => removeEntryFee(fee.id)}

                            >

                              Remove

                            </Button>

                          </div>



                          <div className="grid gap-3 md:grid-cols-3">

                            <div>

                              <Label className="text-xs font-semibold uppercase text-slate-500">Rating floor</Label>

                              <Input

                                type="number"

                                value={fee.ratingMin ?? ""}

                                onChange={(event: any) =>

                                  handleEntryFeeRatingChange(fee.id, "ratingMin", event.target.value)

                                }

                                placeholder={inheritsSectionRange ? "Inherits section" : "e.g., 2000"}

                              />

                            </div>

                            <div>

                              <Label className="text-xs font-semibold uppercase text-slate-500">Rating ceiling</Label>

                              <Input

                                type="number"

                                value={fee.ratingMax ?? ""}

                                onChange={(event: any) =>

                                  handleEntryFeeRatingChange(fee.id, "ratingMax", event.target.value)

                                }

                                placeholder={inheritsSectionRange ? "Inherits section" : "Leave blank for open"}

                              />

                            </div>

                            <div>

                              <Label className="text-xs font-semibold uppercase text-slate-500">Effective after</Label>

                              <DatePicker

                                date={fee.effectiveAfter ? parseISO(fee.effectiveAfter) : null}

                                setDate={(date) => handleEntryFeeDateChange(fee.id, date ? formatDateFn(date, "yyyy-MM-dd") : "")}

                                placeholder="Pick effective date"

                              />

                            </div>

                          </div>





                          <p className="text-[11px] text-slate-500">

                            {inheritsSectionRange

                              ? "Leaving the rating fields blank inherits the section rating window."

                              : "Custom rating bounds override the section window for this rule."}

                          </p>

                        </div>

                      );

                    })}

                  </div>

                )}



                {sections.length > 0 && sectionsMissingPricing.length > 0 && (

                  <div className="rounded-lg border border-dashed border-blue-200 bg-blue-50 p-3 text-xs text-blue-700">

                    {sectionsMissingPricing.length === 1

                      ? `${sectionsMissingPricing[0].name || "Unnamed section"} still needs an entry rule.`

                      : `The following sections still need at least one entry rule: ${sectionsMissingPricing

                          .map((section: any) => section.name || "Unnamed section")

                          .join(", ")}.`}

                  </div>

                )}



                {renderTabSaveButton()}

              </TabsContent>



              <TabsContent value="prizes" className="bg-white p-6 space-y-5">

                  <div className="flex flex-wrap items-center justify-between gap-3">

                    <div className="flex items-center gap-4">

                      <div>

                        <h3 className="text-base font-semibold text-slate-900">Prize payouts</h3>

                        <p className="text-xs text-slate-600">

                          Define prize amounts by section and U-rating cutoff (e.g., U1600).

                        </p>

                      </div>

                      <Switch

                        checked={config.prizesEnabled}

                        onCheckedChange={(checked) => onConfigChange({ ...config, prizesEnabled: checked })}

                      />

                    </div>

                    {config.prizesEnabled && (

                      <div className="space-y-4">

                        <div className="flex items-center justify-between border-t border-slate-100 pt-4">

                          <div>

                            <h4 className="text-sm font-semibold text-slate-800">Show Payout Amounts in Standings</h4>

                            <p className="text-xs text-slate-500">

                              Display actual prize amounts (e.g. $100) on the standings board to players and spectators.

                            </p>

                          </div>

                          <Switch

                            checked={config.showPrizeAmounts !== false}

                            onCheckedChange={(checked) => onConfigChange({ ...config, showPrizeAmounts: checked })}

                          />

                        </div>

                        <div className="flex flex-wrap items-center gap-2">

                          <Button variant="outline" onClick={handlePrizePrint} disabled={prizes.length === 0}>

                            Print

                          </Button>

                          <Button variant="outline" onClick={handlePrizeDownload} disabled={prizes.length === 0}>

                            Download

                          </Button>

                          <Button variant="outline" onClick={() => prizeImportInputRef.current?.click()}>

                            Import Google Sheet

                          </Button>

                          <input

                            ref={prizeImportInputRef}

                            type="file"

                            accept=".csv,text/csv"

                            className="hidden"

                            onChange={handlePrizeImport}

                          />

                          <Button onClick={addPrize}>

                            Add prize

                          </Button>

                        </div>

                      </div>

                    )}

                  </div>



                  {config.prizesEnabled && (

                    <div className="overflow-hidden rounded-lg border border-slate-200">

                      <table className="min-w-full divide-y divide-slate-200 bg-white">

                        <thead className="bg-slate-50">

                          <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-600">

                            <th className="px-4 py-3">Section</th>

                            <th className="px-4 py-3">Rating cap (U)</th>

                            <th className="px-4 py-3">Place</th>

                            <th className="px-4 py-3">Prize amount</th>

                            <th className="px-4 py-3">Currency</th>

                            <th className="px-4 py-3 text-right">Actions</th>

                          </tr>

                        </thead>

                        <tbody className="divide-y divide-slate-200 text-sm text-slate-700">

                          {prizes.length === 0 ? (

                            <tr>

                              <td colSpan={6} className="px-4 py-6 text-center text-sm text-slate-500">

                                {sections.length === 0

                                  ? "Create sections before defining prizes."

                                  : "No prizes added yet. Select Add prize to create your first payout."}

                              </td>

                            </tr>

                          ) : (

                            prizes.map((prize: any) => {

                              const activeSection =

                                sections.find((section: any) => section.id === prize.sectionId) ??

                                sections.find(

                                  (section: any) =>

                                    section.name.trim().toLowerCase() === (prize.section ?? "").trim().toLowerCase(),

                                );

                              return (

                                <tr key={prize.id} className="align-top">

                                  <td className="px-4 py-3">

                                    <Select

                                      value={activeSection?.id ?? prize.sectionId ?? ""}

                                      onValueChange={(value: any) => updatePrize(prize.id, { sectionId: value })}

                                    >

                                      <SelectTrigger>

                                        <SelectValue placeholder="Select section" />

                                      </SelectTrigger>

                                      <SelectContent>

                                        {sections.map((section: any) => (

                                          <SelectItem key={section.id} value={section.id}>

                                            {section.name || "Unnamed section"}

                                          </SelectItem>

                                        ))}

                                      </SelectContent>

                                    </Select>

                                    <p className="mt-1 text-[11px] text-slate-500">

                                      {prize.section || "Choose a section"}

                                    </p>

                                  </td>

                                  <td className="px-4 py-3">

                                    <div className="flex items-center gap-2">

                                      <span className="text-sm text-slate-500">U</span>

                                      <Input

                                        type="number"

                                        value={prize.ratingCap ?? ""}

                                        onChange={(event: any) => handlePrizeRatingCapChange(prize.id, event.target.value)}

                                        placeholder="e.g., 1600"

                                      />

                                    </div>

                                    <p className="mt-1 text-[11px] text-slate-500">

                                      {prize.ratingCap === null

                                        ? "Open to all ratings"

                                        : `Players rated under ${prize.ratingCap}`}

                                    </p>

                                  </td>

                                  <td className="px-4 py-3">

                                    <Input

                                      value={prize.place ?? ""}

                                      onChange={(event: any) => handlePrizePlaceChange(prize.id, event.target.value)}

                                      placeholder="e.g., 1st"

                                    />

                                    <p className="mt-1 text-[11px] text-slate-500">Label how this prize is awarded.</p>

                                  </td>

                                  <td className="px-4 py-3">

                                    <Input

                                      type="number"

                                      step="0.01"

                                      value={typeof prize.amount === "number" ? String(prize.amount) : ""}

                                      onChange={(event: any) => handlePrizeAmountChange(prize.id, event.target.value)}

                                      placeholder="Amount"

                                    />

                                  </td>

                                  <td className="px-4 py-3">

                                    <Select

                                      value={prize.currency || config.payments.defaultCurrency || "USD"}

                                      onValueChange={(value: any) => handlePrizeCurrencyChange(prize.id, value)}

                                    >

                                      <SelectTrigger>

                                        <SelectValue />

                                      </SelectTrigger>

                                      <SelectContent>

                                        {ENTRY_FEE_CURRENCY_OPTIONS.map((option) => (

                                          <SelectItem key={option} value={option}>

                                            {option}

                                          </SelectItem>

                                        ))}

                                      </SelectContent>

                                    </Select>

                                  </td>

                                  <td className="px-4 py-3 text-right">

                                    <Button variant="ghost" className="text-red-600" onClick={() => removePrize(prize.id)}>

                                      Remove

                                    </Button>

                                  </td>

                                </tr>

                              );

                            })

                          )}

                        </tbody>

                      </table>

                    </div>

                  )}



                  {config.prizesEnabled && (

                    <p className="text-xs text-slate-500">

                      Export your Google Sheet as CSV with columns: Section, Rating, Place, Amount, Currency.

                    </p>

                  )}



                {renderTabSaveButton()}

              </TabsContent>









              <TabsContent value="options" className="bg-slate-50/30 p-8 space-y-8">

                {/* Offline Resilience & Data Backups */}

                <div className="rounded-2xl border bg-white p-6 space-y-4 shadow-sm border-slate-200/60">

                  <div className="flex items-center justify-between border-b border-slate-100 pb-3">

                    <div className="space-y-0.5">

                      <h3 className="text-base font-semibold text-black flex items-center gap-2">

                        Offline Resilience & Backups

                      </h3>

                      <p className="text-xs text-slate-500 font-normal">

                        Export snapshots of the tournament to run/revert offline, or restore them.

                      </p>

                    </div>

                    <div className="flex items-center gap-2">

                      {isOnline ? (

                        <Badge className="bg-emerald-500/10 text-emerald-600 border-emerald-500/30 flex items-center gap-1.5 px-2.5 py-1 rounded-full font-semibold text-xs">

                          <Wifi className="h-3.5 w-3.5" />

                          Online

                        </Badge>

                      ) : (

                        <Badge className="bg-rose-500/10 text-rose-600 border-rose-500/30 flex items-center gap-1.5 px-2.5 py-1 rounded-full font-semibold text-xs animate-pulse">

                          <WifiOff className="h-3.5 w-3.5" />

                          Offline Mode

                        </Badge>

                      )}

                    </div>

                  </div>



                  <div className="grid gap-4 sm:grid-cols-2">

                    <div className="p-4 rounded-xl border border-slate-100 bg-slate-50/50 space-y-3 flex flex-col justify-between">

                      <div className="space-y-1">

                        <Label className="text-sm font-bold text-black flex items-center gap-1.5">

                          <FileDown className="h-4 w-4 text-blue-500" /> Export JSON Snapshot

                        </Label>

                        <p className="text-xs text-slate-500 leading-relaxed">

                          Download a complete backup of this tournament (players, matches, pairings, and history) as a JSON file. Use this as a snapshot at any point.

                        </p>

                      </div>

                      <Button 

                        type="button" 

                        variant="outline" 

                        className="w-full h-10 gap-2 border-slate-200 bg-white font-semibold text-xs tracking-wider uppercase hover:bg-slate-50"

                        onClick={handleExportBackup}

                      >

                        Download Backup (.json)

                      </Button>

                    </div>



                    <div className="p-4 rounded-xl border border-slate-100 bg-slate-50/50 space-y-3 flex flex-col justify-between">

                      <div className="space-y-1">

                        <Label className="text-sm font-bold text-black flex items-center gap-1.5">

                          <Upload className="h-4 w-4 text-indigo-500" /> Restore JSON Snapshot

                        </Label>

                        <p className="text-xs text-slate-500 leading-relaxed">

                          Restore the entire tournament state from a locally saved JSON file. Warning: this replaces all current pairings and scores with the snapshot.

                        </p>

                      </div>

                      <div className="relative w-full">

                        <input

                          type="file"

                          id="restore-upload"

                          accept=".json"

                          className="hidden"

                          onChange={handleImportBackup}

                        />

                        <Button

                          type="button"

                          variant="outline"

                          className="w-full h-10 gap-2 border-slate-200 bg-white font-semibold text-xs tracking-wider uppercase hover:bg-slate-50"

                          onClick={() => document.getElementById("restore-upload")?.click()}

                        >

                          Upload & Restore File

                        </Button>

                      </div>

                    </div>

                  </div>

                </div>



                {/* Public Access Protocol */}

                <div className="rounded-2xl border bg-white p-6 space-y-4 shadow-sm border-slate-200/60">

                  <div className="flex items-center gap-2 mb-2">

                    <h3 className="text-base font-semibold text-black">Public Access Protocol</h3>

                  </div>

                  

                  <div className="space-y-4">

                    <div className="flex items-center gap-3">

                      <div className="flex-1 relative group">

                        <Input 

                          readOnly 

                          value={spectatorLink} 

                          className="bg-slate-50 border-slate-200 h-10 pr-10 text-xs select-all focus:ring-slate-400 focus:bg-white transition-all font-medium text-black" 

                        />

                        <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">

                           <button 

                             onClick={() => {

                               navigator.clipboard.writeText(spectatorLink);

                               toast({ title: "Copied", description: "Spectator link copied to clipboard" });

                             }}

                             className="p-1.5 hover:bg-slate-200 rounded transition-colors text-slate-400"

                           >

                             <Copy className="h-3.5 w-3.5" />

                           </button>

                        </div>

                      </div>

                      <Button variant="outline" className="h-10 gap-2 text-sm border-slate-200 bg-white font-semibold hover:bg-slate-50" onClick={() => setQrCodeModalOpen(true)}>

                        <QrCode className="h-4 w-4" />

                        QR Code

                      </Button>

                      <Button variant="outline" className="h-10 gap-2 text-sm border-slate-200 bg-white font-semibold hover:bg-slate-50" onClick={handleSpectatorLinkPrint}>

                        <Printer className="h-4 w-4" />

                        Print

                      </Button>

                    </div>

                    <p className="text-sm text-slate-500 leading-relaxed">

                      Distribute this URL to allow participants to self-register or spectators to monitor live progress and results.

                    </p>

                  </div>

                </div>



                {/* Registration Policy */}

                <div className="rounded-2xl border bg-white p-6 space-y-8 shadow-sm border-slate-200/60">

                    <div className="space-y-1">

                      <h3 className="text-base font-semibold text-black">Registration Policy</h3>

                      <p className="text-sm text-slate-500">Configure entry rules and participant interface options.</p>

                    </div>

                    <div className="grid gap-4 md:grid-cols-2">

                      <div className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50/30 px-5 py-4 transition-all hover:bg-slate-50/50">

                        <div className="space-y-0.5">

                          <Label className="text-base font-medium text-black">Allow Online Registrations</Label>

                           <p className="text-xs text-slate-500 font-normal">Allow users to register and sign up for this tournament online.</p>

                        </div>

                        <Switch

                          checked={Boolean(config.registers.allowSignup !== false)}

                          onCheckedChange={(checked) => updateRegisters({ allowSignup: checked })}

                        />

                      </div>



                      {config.format === "swiss" && (

                        <div className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50/30 px-5 py-4 transition-all hover:bg-slate-50/50">

                          <div className="space-y-0.5">

                            <Label className="text-base font-medium text-black">Pairing Predictor</Label>

                            <p className="text-xs text-slate-500 font-normal">Allow live simulation of upcoming pairings.</p>

                          </div>

                          <Switch

                            checked={config.registers.enablePairingPredictor}

                            onCheckedChange={(checked) => updateRegisters({ enablePairingPredictor: checked })}

                          />

                        </div>

                      )}

                    </div>



                    <div className="pt-6 border-t border-slate-100">

                      <div className="space-y-4">

                        <Label className="text-base font-semibold text-black">Communication</Label>

                        <div className="grid gap-4 md:grid-cols-2">

                          <div className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50/30 px-4 py-3.5">

                             <div className="space-y-0.5">

                               <Label className="text-[15px] font-medium text-black">Email Notifications</Label>

                               <p className="text-xs text-slate-500 font-normal">Notify pairings via email.</p>

                             </div>

                             <Switch

                               checked={config.registers.notifyPairingsEmail}

                               onCheckedChange={(checked) => updateRegisters({ notifyPairingsEmail: checked })}

                             />

                          </div>



                          <div className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50/30 px-4 py-3.5">

                             <div className="space-y-0.5">

                               <Label className="text-[15px] font-medium text-black">Push Notifications</Label>

                               <p className="text-xs text-slate-500 font-normal">Send real-time updates and pairing alerts.</p>

                             </div>

                             <Switch

                               checked={config.registers.pushNotifications}

                               onCheckedChange={(checked) => updateRegisters({ pushNotifications: checked })}

                             />

                          </div>

                        </div>

                      </div>

                    </div>

                </div>



                <div className="flex items-center justify-between rounded-2xl border border-slate-100 bg-slate-50/50 px-6 py-4 shadow-sm">

                  <div className="space-y-1">

                    <Label className="text-base font-semibold text-black">Calendar Visibility</Label>

                    <p className="text-sm text-slate-500 leading-none">List this tournament on the public global calendar.</p>

                  </div>

                  <Switch

                    checked={config.registers.showOnCalendar}

                    onCheckedChange={(checked) => updateRegisters({ showOnCalendar: checked })}

                  />

                </div>



                {/* Page Customization */}

                <div className="rounded-2xl border bg-white p-6 space-y-8 shadow-sm border-slate-200/60">

                    <div className="space-y-1">

                      <h3 className="text-base font-semibold text-black">Page Customization</h3>

                      <p className="text-sm text-slate-500">Customize the appearance and features of your public tournament page.</p>

                    </div>



                    <div className="grid gap-6 md:grid-cols-2">

                      <div className="space-y-2">

                        <Label className="text-sm font-medium text-black">Visual Theme</Label>

                        <Select

                          value={config.publicPage?.theme || "professional"}

                          onValueChange={(value: any) => updatePublicPage({ theme: value })}

                        >

                          <SelectTrigger className="h-11 border-slate-200">

                            <SelectValue placeholder="Select theme" />

                          </SelectTrigger>

                          <SelectContent>

                            <SelectItem value="professional">Professional</SelectItem>

                            <SelectItem value="vibrant">Vibrant</SelectItem>

                            <SelectItem value="dark">Dark Mode</SelectItem>

                            <SelectItem value="glass">Glassmorphism</SelectItem>

                          </SelectContent>

                        </Select>

                        <p className="text-xs text-slate-400">Sets the overall look and feel of the tournament page.</p>

                      </div>



                      <div className="space-y-2">

                        <Label className="text-sm font-medium text-black">Custom Accent Color</Label>

                        <div className="flex gap-2">

                          <Input

                            type="color"

                            value={config.publicPage?.customAccentColor || "#000000"}

                            onChange={(e) => updatePublicPage({ customAccentColor: e.target.value })}

                            className="w-12 h-11 p-1 border-slate-200 cursor-pointer"

                          />

                          <Input

                            type="text"

                            value={config.publicPage?.customAccentColor || ""}

                            onChange={(e) => updatePublicPage({ customAccentColor: e.target.value })}

                            placeholder="#000000"

                            className="h-11 border-slate-200 flex-1"

                          />

                        </div>

                        <p className="text-xs text-slate-400">Define a primary color for buttons and highlights.</p>

                      </div>

                    </div>



                    <div className="space-y-2">

                      <Label className="text-sm font-medium text-black">Header Image URL</Label>

                      <Input

                        type="text"

                        placeholder="https://example.com/image.jpg"

                        value={config.publicPage?.bannerUrl || ""}

                        onChange={(e) => updatePublicPage({ bannerUrl: e.target.value })}

                        className="h-11 border-slate-200"

                      />

                      <p className="text-xs text-slate-400">Displayed at the top of the tournament page.</p>

                    </div>



                    <div className="space-y-2">

                      <Label className="text-sm font-medium text-black">Announcement</Label>

                      <Textarea

                        placeholder="Important notice for all players..."

                        value={config.publicPage?.announcement || ""}

                        onChange={(e) => updatePublicPage({ announcement: e.target.value })}

                        className="min-h-[100px] border-slate-200"

                      />

                      <p className="text-xs text-slate-400">A special message displayed prominently at the top of the page.</p>

                    </div>





                </div>



                {/* Extensions */}

                <div className="space-y-4">

                  <div className="flex items-center gap-2 px-2">

                     <h3 className="text-base font-semibold text-black tracking-tight">Extensions</h3>

                  </div>

                  <WebhookSyncSettingsCard

                    value={config.webhookSync}

                    onChange={(update) => {

                      onConfigChange({

                        ...config,

                        webhookSync: { ...config.webhookSync, ...update },

                      });

                    }}

                    onTest={() => testMutation.mutate()}

                    onSync={() => syncMutation.mutate()}

                    testing={testMutation.isPending}

                    syncing={syncMutation.isPending}

                    disabled={config.webhookSync.syncMode === "disabled"}

                    onDownload={handleDownloadWebhookSync}

                    enabled={true}

                    onEnabledChange={() => {}}

                  />

                </div>



                {/* Rate Event Card */}

                <div className="rounded-2xl border border-slate-200 bg-white p-6 space-y-5 shadow-sm">

                  <div className="flex items-center gap-2">

                    <h3 className="text-base font-semibold text-black tracking-tight">Rate Event</h3>

                  </div>

                  <div className="flex flex-wrap gap-3">

                                          <Button

                        variant="outline"

                        className="h-11 px-6 font-bold text-black border-slate-200 bg-white hover:bg-slate-50 transition-all shadow-sm rounded-xl"

                        onClick={() => handleShortcutChange("fide")}

                        disabled={!tournament}

                      >

                        FIDE Report

                      </Button>

                    <Button

                        variant="outline"

                        className="h-11 px-6 font-bold text-black border-slate-200 bg-white hover:bg-slate-50 transition-all shadow-sm rounded-xl"

                        onClick={() => handleShortcutChange("uscf")}

                        disabled={!tournament}

                      >

                        USCF Report

                      </Button>

                  </div>

                </div>



                {renderTabSaveButton()}

              </TabsContent>





            </Tabs>

          </CardContent>

        </Card>



        

      </div>



      {onCancel && (

        <div className="flex justify-start">

          <Button variant="outline" onClick={onCancel}>

            Cancel

          </Button>

        </div>

      )}

    </div>



      <Dialog open={paymentsDialogOpen} onOpenChange={handlePaymentSettingsDialogChange}>

    <DialogContent className="w-full max-w-3xl sm:max-w-4xl [&>button.absolute]:hidden">

      <div className="flex flex-col gap-4">

        <div className="flex items-start gap-3">

          <DialogClose asChild>

            <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full border border-slate-200">

              <X className="h-4 w-4" />

              <span className="sr-only">Close</span>

            </Button>

          </DialogClose>

          <div className="flex-1">

            <DialogHeader className="items-start text-left">

              <DialogTitle className="text-xl">Payment settings</DialogTitle>

              <DialogDescription>

                Manage currencies, online checkout requirements, and offline payment instructions.

              </DialogDescription>

            </DialogHeader>

          </div>

        </div>



        <div className="space-y-6">

          <div className="rounded-lg border border-indigo-100 bg-indigo-50/80 px-4 py-3">

            <div className="flex flex-wrap items-center justify-between gap-3">

              <div>

                <p className="text-sm font-semibold text-slate-900">Online payments</p>

                <p className="text-xs text-slate-600">

                  Enable Stripe-powered checkout inside the player registration flow.

                </p>

              </div>

              <Switch

                checked={paymentSettingsDraft.onlineEnabled}

                onCheckedChange={(checked) => updatePaymentDraft("onlineEnabled", checked)}

              />

            </div>

            {!paymentSettingsDraft.onlineEnabled && (

              <p className="mt-3 text-xs text-indigo-700">

                Players will acknowledge offline payment instructions during registration. Toggle this on once your Stripe API keys are active.

              </p>

            )}

          </div>



          <div className="grid gap-4 md:grid-cols-2">

            <div className="space-y-2">

              <Label htmlFor="dialog-payment-currency">Default currency</Label>

              <Select

                value={paymentSettingsDraft.defaultCurrency ?? "USD"}

                onValueChange={(value: any) => updatePaymentDraft("defaultCurrency", value)}

              >

                <SelectTrigger id="dialog-payment-currency">

                  <SelectValue />

                </SelectTrigger>

                <SelectContent>

                  {ENTRY_FEE_CURRENCY_OPTIONS.map((currency) => (

                    <SelectItem key={currency} value={currency}>

                      {currency}

                    </SelectItem>

                  ))}

                </SelectContent>

              </Select>

            </div>

            <div className="space-y-2">

              <Label htmlFor="dialog-payment-descriptor">Statement descriptor (optional)</Label>

              <Input

                id="dialog-payment-descriptor"

                value={paymentSettingsDraft.payoutStatementDescriptor ?? ""}

                onChange={(event: any) => updatePaymentDraft("payoutStatementDescriptor", event.target.value)}

                placeholder="e.g., SD CHESS CLUB"

              />

            </div>



            {paymentSettingsDraft.onlineEnabled && (

              <>

                <div className="space-y-2">

                  <Label className="flex items-center gap-2">

                    Require payment on registration

                    <Badge variant="outline" className="text-xs">

                      Recommended

                    </Badge>

                  </Label>

                  <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-4 py-3">

                    <p className="text-xs text-slate-600 pr-6">

                      Players must complete Stripe checkout before their registration is submitted.

                    </p>

                    <Switch

                      checked={paymentSettingsDraft.requirePaymentOnRegistration}

                      onCheckedChange={(checked) => updatePaymentDraft("requirePaymentOnRegistration", checked)}

                    />

                  </div>

                </div>



                <div className="space-y-2">

                  <Label>Processing contribution</Label>

                  <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-4 py-3">

                    <p className="text-xs text-slate-600 pr-6">

                      Allow players to add an optional amount to help cover Stripe fees.

                    </p>

                    <Switch

                      checked={paymentSettingsDraft.allowProcessingContribution}

                      onCheckedChange={(checked) => updatePaymentDraft("allowProcessingContribution", checked)}

                    />

                  </div>

                </div>



                <div className="space-y-2">

                  <Label htmlFor="dialog-processing-fee">Processing fee (%)</Label>

                  <Input

                    id="dialog-processing-fee"

                    type="number"

                    min={0}

                    max={10}

                    step={0.1}

                    value={

                      typeof paymentSettingsDraft.processingFeePercent === "number"

                        ? String(paymentSettingsDraft.processingFeePercent)

                        : ""

                    }

                    onChange={(event: any) => handleProcessingFeeChange(event.target.value)}

                    placeholder="0"

                  />

                  <p className="text-xs text-muted-foreground">

                    Applied on top of the entry fee total when the checkout session is created.

                  </p>

                </div>



                <div className="space-y-2">

                  <Label htmlFor="dialog-stripe-account">Stripe Connect account (optional)</Label>

                  <Input

                    id="dialog-stripe-account"

                    value={paymentSettingsDraft.stripeAccountId ?? ""}

                    onChange={(event: any) => updatePaymentDraft("stripeAccountId", event.target.value)}

                    placeholder="acct_1234"

                  />

                  <p className="text-xs text-muted-foreground">

                    Provide a connected account ID if payouts route to a tournament sub-account.

                  </p>

                </div>

              </>

            )}

          </div>



          <div className="space-y-2">

            <Label>Accepted offline payment methods</Label>

            <div className="flex flex-wrap gap-2">

              {OFFLINE_METHOD_OPTIONS.map((option) => {

                const active = paymentSettingsDraft.acceptedOfflineMethods?.includes(option.id) ?? false;

                return (

                  <button

                    key={option.id}

                    type="button"

                    onClick={() => toggleOfflineMethod(option.id)}

                    className={cn(

                      "rounded-full border px-3 py-1 text-xs font-medium transition",

                      active

                        ? "border-indigo-500 bg-indigo-500 text-white shadow-sm"

                        : "border-slate-200 bg-white text-slate-600 hover:border-indigo-300 hover:text-indigo-600",

                    )}

                  >

                    {option.label}

                  </button>

                );

              })}

            </div>

            <p className="text-xs text-muted-foreground">

              These options display on the review step so players know how to pay if they skip online checkout.

            </p>

          </div>



          <div className="space-y-2">

            <Label htmlFor="dialog-offline-instructions">Offline payment instructions</Label>

            <Textarea

              id="dialog-offline-instructions"

              rows={4}

              value={paymentSettingsDraft.offlineInstructions ?? ""}

              onChange={(event: any) => updatePaymentDraft("offlineInstructions", event.target.value)}

              placeholder="Include on-site payment windows, who to Venmo, or mailing addresses for checks."

            />

          </div>

        </div>



        <DialogFooter className="border-t border-slate-200 pt-4">

          <Button className="ml-auto" onClick={handlePaymentSettingsSave}>

            Save & Close

          </Button>

        </DialogFooter>

      </div>

    </DialogContent>

      </Dialog>

      <Dialog open={qrCodeModalOpen} onOpenChange={setQrCodeModalOpen}>

        <DialogContent>

          <DialogHeader>

            <DialogTitle>Spectator QR Code</DialogTitle>

            <DialogDescription>

              Scan this QR code to spectate the tournament.

            </DialogDescription>

          </DialogHeader>

          <div className="flex flex-col items-center justify-center p-6 space-y-4 w-full">

            <div className="p-4 bg-white rounded-2xl shadow-md border border-slate-100 flex items-center justify-center">

              <QRCodeCanvas value={spectatorLink} size={256} className="rounded-lg" />

            </div>

            <p className="text-xs font-semibold text-slate-400 select-all font-mono tracking-wider text-center break-all w-full max-w-xs">{spectatorLink}</p>

          </div>

        </DialogContent>

      </Dialog>

    </>

  );

}

