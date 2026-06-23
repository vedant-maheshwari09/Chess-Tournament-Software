import { DEFAULT_REGISTRATION_FIELDS, resolveEntryFeeBounds } from "@/lib/tournament-config";
import type { EntryFeeRule } from "@/lib/tournament-config";
import type { RegistrationFormValues, SectionOption, PaymentStatusKey, PaymentSettings, PaymentTotals } from "./types";
import type { UseFormReturn } from "react-hook-form";

export const formatDate = (value: string | Date | null | undefined) => {
  if (!value) return "TBD";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "TBD";
  return date.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
};

export const statusStyles: Record<string, string> = {
  draft: "bg-blue-100/80 text-blue-800 border border-blue-200/50",
  upcoming: "bg-blue-50/80 text-blue-700 border border-blue-200/50",
  active: "bg-emerald-50 text-emerald-700 border border-emerald-200/50",
  completed: "bg-slate-100 text-slate-600 border border-slate-200/50",
};

export const SECTION_FALLBACKS: Record<string, string> = {
  premier: "Premier",
  championship: "Championship",
  under1800: "Under 1800",
  under1600: "Under 1600",
  under1400: "Under 1400",
  under1200: "Under 1200",
  unrated: "Unrated",
};

export const NO_ENTRY_FEE_ID = "offline-entry-fee";

export function getFieldConfig(config: any, fieldId: string) {
  const fields = config?.registrationFormConfig?.fields || DEFAULT_REGISTRATION_FIELDS;
  const field = fields.find((f: any) => f.id === fieldId);
  return field ?? { id: fieldId, label: fieldId, type: "text", required: false, visible: false };
}


export function splitName(fullName: string): { firstName: string; lastName: string } {
  const value = fullName?.trim() ?? "";
  if (!value) return { firstName: "", lastName: "" };
  if (value.includes(",")) {
    const [last, first] = value.split(",");
    return {
      firstName: (first ?? "").trim() || value,
      lastName: (last ?? "").trim(),
    };
  }
  const parts = value.split(/\s+/);
  if (parts.length === 1) {
    return { firstName: parts[0], lastName: "" };
  }
  const lastName = parts.pop() ?? "";
  return {
    firstName: parts.join(" "),
    lastName,
  };
}

export const DEBUG_LOG = (title: string, data?: any, level: 'info' | 'warn' | 'error' = 'info') => {
  const timestamp = new Date().toLocaleTimeString();
  const prefix = `[REG_FLOW][${timestamp}] ${title}`;

  if (data !== undefined && typeof data === 'object' && data !== null) {
    // If it's an object, we log it descriptive first, then stringified for copy-pasting
    console.groupCollapsed(prefix);
    console[level]("Full Data Object:", data);
    console[level]("STRINGIFIED (Copy-paste friendly):");
    try {
      console.log(JSON.stringify(data, null, 2));
    } catch (err) {
      console.warn("Could not stringify data (likely circular structure). Falling back to direct log.");
      console.log(data);
    }
    console.groupEnd();
  } else if (data !== undefined) {
    console[`${level}`](`${prefix}:`, data);
  } else {
    console[`${level}`](prefix);
  }
};

export function toggleArrayValue(
  form: UseFormReturn<RegistrationFormValues>,
  name: keyof RegistrationFormValues,
  value: string,
) {
  const current = (form.getValues(name as any) as string[]) ?? [];
  const next = current.includes(value)
    ? current.filter((item) => item !== value)
    : [...current, value];
  form.setValue(name as any, next, { shouldDirty: true });
}

export function buildArrivalNotes(values: RegistrationFormValues, entryFees: EntryFeeRule[]) {
  const selectedEntryFee = entryFees.find((fee) => fee.id === values.entryFeeId) ?? null;
  const contribution = parseContribution(values.processingContribution);
  const segments = [
    values.arrivalTime && `Arr:${truncate(values.arrivalTime, 15)}`,
    selectedEntryFee && `Fee:${truncate(selectedEntryFee.section, 10)} ${Math.round(selectedEntryFee.amount)}`,
    contribution > 0 && `Add:${contribution.toFixed(2)}`,
    values.byePreference === "yes" && values.byeRounds.length > 0
      ? `Byes:${values.byeRounds.join("/")}`
      : undefined,
    values.notes && `Notes:${truncate(values.notes, 18)}`,
  ].filter(Boolean);

  return segments.join(" | ").slice(0, 90);
}

export function derivePlayerRating(
  provider: RegistrationFormValues["ratingProvider"] | undefined,
  uscfRatingValue: string | undefined,
  fideRatingValue: string | undefined,
  primarySystem: "uscf" | "fide" = "uscf",
): number | null {
  const parsedUscf = Number.parseInt(uscfRatingValue ?? "", 10);
  const parsedFide = Number.parseInt(fideRatingValue ?? "", 10);

  if (provider === "uscf" || provider === "manual") {
    return Number.isFinite(parsedUscf) ? parsedUscf : null;
  }
  if (provider === "fide") {
    return Number.isFinite(parsedFide) ? parsedFide : null;
  }

  // Fallback when provider is "none" or undefined
  if (primarySystem === "fide") {
    if (Number.isFinite(parsedFide)) return parsedFide;
    if (Number.isFinite(parsedUscf)) return parsedUscf;
  } else {
    // Default to USCF
    if (Number.isFinite(parsedUscf)) return parsedUscf;
    if (Number.isFinite(parsedFide)) return parsedFide;
  }
  return null;
}

export function filterEntryFeesBySection(
  entryFees: EntryFeeRule[],
  sectionName: string | undefined,
  sections: SectionOption[],
): EntryFeeRule[] {
  if (!sectionName) return [];
  const normalized = sectionName.trim().toLowerCase();
  const targetSection = sections.find((section) => section.name.trim().toLowerCase() === normalized);
  const relevantFees = entryFees.filter((fee) => {
    if (fee.sectionId) {
      const linked = sections.find((section) => section.id === fee.sectionId);
      if (linked && linked.name.trim().toLowerCase() === normalized) {
        return true;
      }
    }
    return (fee.section ?? "").trim().toLowerCase() === normalized;
  });

  if (relevantFees.length === 0) {
    return [];
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayTs = today.getTime();

  const groups = new Map<string, EntryFeeRule[]>();
  relevantFees.forEach((fee) => {
    const linkedSection = findSectionForFee(fee, sections) ?? targetSection;
    const bounds = resolveEntryFeeBounds(fee, linkedSection);
    const key = `${bounds.ratingMin ?? "null"}|${bounds.ratingMax ?? "null"}`;
    const bucket = groups.get(key);
    if (bucket) {
      bucket.push(fee);
    } else {
      groups.set(key, [fee]);
    }
  });

  const resolved: EntryFeeRule[] = [];
  groups.forEach((feesInGroup) => {
    const activeNow = feesInGroup
      .filter((fee) => effectiveDateTimestamp(fee.effectiveAfter) <= todayTs)
      .sort((a, b) => effectiveDateTimestamp(b.effectiveAfter) - effectiveDateTimestamp(a.effectiveAfter));
    if (activeNow.length > 0) {
      resolved.push(activeNow[0]);
      return;
    }
    const upcoming = feesInGroup
      .slice()
      .sort((a, b) => effectiveDateTimestamp(a.effectiveAfter) - effectiveDateTimestamp(b.effectiveAfter));
    if (upcoming.length > 0) {
      resolved.push(upcoming[0]);
    }
  });

  resolved.sort((a, b) => compareEntryFeeRange(a, b, sections, targetSection));
  return resolved;
}

export function effectiveDateTimestamp(value: string | null | undefined): number {
  if (!value) return Number.NEGATIVE_INFINITY;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return Number.NEGATIVE_INFINITY;
  }
  parsed.setHours(0, 0, 0, 0);
  return parsed.getTime();
}

export function compareEntryFeeRange(
  a: EntryFeeRule,
  b: EntryFeeRule,
  sections: SectionOption[],
  fallback: SectionOption | undefined,
): number {
  const aSection = findSectionForFee(a, sections) ?? fallback;
  const bSection = findSectionForFee(b, sections) ?? fallback;
  const aBounds = resolveEntryFeeBounds(a, aSection);
  const bBounds = resolveEntryFeeBounds(b, bSection);
  const minCompare = compareNullableNumbers(aBounds.ratingMin, bBounds.ratingMin);
  if (minCompare !== 0) return minCompare;
  const maxCompare = compareNullableNumbers(aBounds.ratingMax, bBounds.ratingMax);
  if (maxCompare !== 0) return maxCompare;
  return a.amount - b.amount;
}

export function compareNullableNumbers(a: number | null, b: number | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return -1;
  if (b === null) return 1;
  return a - b;
}

export function findRecommendedEntryFee(
  options: EntryFeeRule[],
  rating: number | null,
  sections: SectionOption[],
  section: SectionOption | undefined,
): EntryFeeRule | undefined {
  if (options.length === 0) return undefined;
  if (rating === null) return options[0];
  return options.find((fee) => ratingWithinEntryFee(rating, fee, sections, section)) ?? options[0];
}

export function ratingWithinEntryFee(
  rating: number | null,
  fee: EntryFeeRule,
  sections: SectionOption[],
  fallback: SectionOption | undefined,
): boolean {
  if (rating === null) return false;
  const linkedSection = findSectionForFee(fee, sections) ?? fallback;
  const bounds = resolveEntryFeeBounds(fee, linkedSection);
  if (bounds.ratingMin !== null && rating < bounds.ratingMin) return false;
  if (bounds.ratingMax !== null && rating > bounds.ratingMax) return false;
  return true;
}

export function ratingWithinSectionRange(
  rating: number | null,
  section: { ratingMin: number | null; ratingMax: number | null },
): boolean {
  if (rating === null) return true;
  if (section.ratingMin !== null && rating < section.ratingMin) return false;
  if (section.ratingMax !== null && rating > section.ratingMax) return false;
  return true;
}

export function formatEntryFeeRange(
  fee: EntryFeeRule,
  sections: SectionOption[],
  fallback?: SectionOption,
): string {
  const linkedSection = findSectionForFee(fee, sections) ?? fallback;
  const { ratingMin, ratingMax } = resolveEntryFeeBounds(fee, linkedSection);
  if (ratingMin !== null && ratingMax !== null) {
    return `Rating ${ratingMin}–${ratingMax}`;
  }
  if (ratingMin !== null) {
    return `Rating ${ratingMin}+`;
  }
  if (ratingMax !== null) {
    return `Rating ≤${ratingMax}`;
  }
  return "All ratings";
}

export function findSectionForFee(fee: EntryFeeRule, sections: SectionOption[]): SectionOption | undefined {
  if (fee.sectionId) {
    const byId = sections.find((section) => section.id === fee.sectionId);
    if (byId) {
      return byId;
    }
  }
  const normalized = (fee.section ?? "").trim().toLowerCase();
  if (!normalized) return undefined;
  return sections.find((section) => section.name.trim().toLowerCase() === normalized);
}

export function formatCurrency(amount: number, currency: string) {
  const safeCurrency = currency && currency.length === 3 ? currency : "USD";
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: safeCurrency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `$${amount.toFixed(2)}`;
  }
}

export function parseContribution(value: unknown): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? Math.max(0, Math.round(value * 100) / 100) : 0;
  }
  if (typeof value === "string") {
    if (!value.trim()) return 0;
    const numeric = Number(value);
    return Number.isFinite(numeric) ? Math.max(0, Math.round(numeric * 100) / 100) : 0;
  }
  return 0;
}

export function computePaymentTotals(
  entryFee: EntryFeeRule | null,
  contribution: number,
  paymentSettings: PaymentSettings | null,
  customAnswers?: Record<string, any>,
): PaymentTotals {
  const allowContribution = paymentSettings?.allowProcessingContribution !== false;
  const baseContribution = allowContribution ? contribution : 0;

  // Calculate custom payment addons
  let addonTotal = 0;
  if (customAnswers) {
    const hasUscf = customAnswers.uscfMembershipRenewalFee === true || customAnswers.uscfMembershipRenewalFee === "true";
    const hasTshirt = customAnswers.tshirtPreorderFee === true || customAnswers.tshirtPreorderFee === "true";
    const donationValue = customAnswers.donationPrizeFund;
    let donationAmount = 0;
    if (typeof donationValue === "string") {
      if (donationValue.includes("$10")) donationAmount = 10;
      else if (donationValue.includes("$25")) donationAmount = 25;
      else if (donationValue.includes("$50")) donationAmount = 50;
      else if (donationValue.includes("$100")) donationAmount = 100;
    }
    const discountCode = customAnswers.earlyBirdDiscountCode || customAnswers.voucherCode;
    let discountAmount = 0;
    if (typeof discountCode === "string") {
      const code = discountCode.trim().toUpperCase();
      if (code === "EARLYBIRD10" || code === "CHESSCLUB") {
        discountAmount = 10;
      }
    }
    addonTotal = (hasUscf ? 45 : 0) + (hasTshirt ? 20 : 0) + donationAmount - discountAmount;
  }

  const baseAmount = Math.max(0, (entryFee?.amount ?? 0) + addonTotal);
  const currency = (entryFee?.currency ?? paymentSettings?.defaultCurrency ?? "USD").toUpperCase();
  const subtotal = Number((baseAmount + baseContribution).toFixed(2));
  const percent = typeof paymentSettings?.processingFeePercent === "number" ? paymentSettings.processingFeePercent : 0;
  const feeRate = Math.max(0, Math.min(10, percent));
  const feeAmount = Number(((subtotal * feeRate) / 100).toFixed(2));
  const total = Number((subtotal + feeAmount).toFixed(2));

  return {
    subtotal,
    feeAmount,
    total,
    currency,
  };
}

export function mapStripeStatus(status: string | null | undefined): PaymentStatusKey {
  switch (status) {
    case "succeeded":
      return "paid";
    case "processing":
    case "requires_capture":
    case "requires_action":
    case "requires_confirmation":
      return "processing";
    case "canceled":
      return "failed";
    case "requires_payment_method":
      return "unpaid";
    case "requires_customer_action":
      return "processing";
    case "refunded":
      return "refunded";
    default:
      return "processing";
  }
}

export function truncate(value: string, length: number): string {
  if (!value) return "";
  return value.length > length ? `${value.slice(0, length)}…` : value;
}

