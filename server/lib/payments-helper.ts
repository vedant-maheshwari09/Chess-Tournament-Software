import { z } from "zod";
import Stripe from "stripe";
import { type AccountPaymentSettings, type EntryFeeRule, type PaymentSettings } from "@shared/tournament-config";
import { normalizePlayerName } from "../routes/util";

export const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY ?? "";
export const STRIPE_PUBLISHABLE_KEY = process.env.STRIPE_PUBLISHABLE_KEY ?? "";
export const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET ?? "";

export const stripe = STRIPE_SECRET_KEY ? new Stripe(STRIPE_SECRET_KEY) : null;

export const PAYMENT_STATUSES = ["unpaid", "processing", "paid", "failed", "refunded"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const paymentProviderEnum = z.enum(["stripe", "paypal"]);
export const paymentScopeEnum = z.enum(["tournament", "account"]);
export const offlineMethodEnum = z.enum(["cash", "check", "venmo", "zelle", "paypal", "other"]);

export function normalizeCurrency(input: unknown, fallback: string): string {
  if (typeof input !== "string" || input.trim().length < 3) return fallback;
  return input.trim().toUpperCase();
}

export function computePaymentTotals(
  entryFee: EntryFeeRule | null,
  contribution: number,
  paymentConfig: PaymentSettings | null,
  customAnswers?: Record<string, any>,
  fields?: any[],
  sections?: any[],
  sectionChoice?: string,
  ratingProvider?: string,
  uscfRating?: string,
  fideRating?: string,
  primaryRatingSystem?: "uscf" | "fide"
) {
  const allowContribution = paymentConfig?.allowProcessingContribution !== false;
  const baseContribution = allowContribution ? contribution : 0;

  // Calculate GM/IM/WGM/WIM Title Fee Waiver
  const entryFeeField = fields?.find((f: any) => f.id === "entryFee");
  const waiveTitledFee = entryFeeField?.settings?.waiveTitledFee === true;
  const fideTitle = customAnswers?.fideTitle;
  const isTitledPlayer = fideTitle && ["GM", "IM", "WGM", "WIM"].includes(String(fideTitle).toUpperCase());
  
  let entryFeeAmount = entryFee?.amount ?? 0;
  if (waiveTitledFee && isTitledPlayer) {
    entryFeeAmount = 0;
  }

  // Calculate Custom Surcharge Fee for Playing Up
  let playUpSurcharge = 0;
  if (sections && sectionChoice) {
    const selectedSection = sections.find((s: any) => s.name.trim().toLowerCase() === sectionChoice.trim().toLowerCase());
    if (selectedSection && selectedSection.ratingMin !== null) {
      // Inline derivePlayerRating logic
      const parsedUscf = uscfRating ? parseInt(String(uscfRating).replace(/[^\d]/g, ""), 10) : NaN;
      const parsedFide = fideRating ? parseInt(String(fideRating).replace(/[^\d]/g, ""), 10) : NaN;
      let numericRating: number | null = null;
      if (ratingProvider === "uscf" || ratingProvider === "manual") {
        numericRating = Number.isFinite(parsedUscf) ? parsedUscf : null;
      } else if (ratingProvider === "fide") {
        numericRating = Number.isFinite(parsedFide) ? parsedFide : null;
      } else {
        if (primaryRatingSystem === "fide") {
          numericRating = Number.isFinite(parsedFide) ? parsedFide : Number.isFinite(parsedUscf) ? parsedUscf : null;
        } else {
          numericRating = Number.isFinite(parsedUscf) ? parsedUscf : Number.isFinite(parsedFide) ? parsedFide : null;
        }
      }

      if (numericRating !== null && numericRating < selectedSection.ratingMin) {
        const sectionChoiceField = fields?.find((f: any) => f.id === "sectionChoice");
        const playUpFeeAmount = sectionChoiceField?.settings?.playUpFeeAmount ?? entryFeeField?.settings?.playUpFeeAmount;
        if (typeof playUpFeeAmount === "number" && playUpFeeAmount > 0) {
          playUpSurcharge = playUpFeeAmount;
        }
      }
    }
  }

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

  const baseAmount = Math.max(0, entryFeeAmount + playUpSurcharge + addonTotal);
  const currency = normalizeCurrency(entryFee?.currency, paymentConfig?.defaultCurrency ?? "USD");
  const subtotal = Number((baseAmount + baseContribution).toFixed(2));
  const percent = typeof paymentConfig?.processingFeePercent === "number" ? paymentConfig.processingFeePercent : 0;
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

export const updateTournamentPaymentsSchema = z.object({
  provider: paymentProviderEnum,
  defaultCurrency: z.string().trim().length(3).optional(),
  onlineEnabled: z.boolean().optional(),
  requirePaymentOnRegistration: z.boolean().optional(),
  allowProcessingContribution: z.boolean().optional(),
  stripeAccountId: z.string().trim().optional(),
  stripePublishableKey: z.string().trim().optional(),
  stripeClientSecret: z.string().trim().optional(),
  paypalMerchantId: z.string().trim().optional(),
  paypalClientId: z.string().trim().optional(),
  paypalEmail: z.string().trim().email().optional(),
  connectionScope: paymentScopeEnum.optional(),
  acceptedOfflineMethods: z.array(offlineMethodEnum).optional(),
  offlineInstructions: z.string().trim().optional(),
  processingFeePercent: z.coerce.number().min(0).max(100).nullable().optional(),
  payoutStatementDescriptor: z.string().trim().optional(),
});

export const accountPaymentSettingsSchema = z.object({
  preferredProvider: paymentProviderEnum.nullable().optional(),
  stripeAccountId: z.string().trim().optional(),
  stripePublishableKey: z.string().trim().optional(),
  payoutStatementDescriptor: z.string().trim().optional(),
  paypalMerchantId: z.string().trim().optional(),
  paypalClientId: z.string().trim().optional(),
  paypalEmail: z.string().trim().email().optional(),
});

export function normalizeAccountPaymentSettings(raw: unknown): AccountPaymentSettings {
  const base: AccountPaymentSettings = {
    preferredProvider: null,
  };
  if (!raw || typeof raw !== "object") {
    return base;
  }
  const parsed = accountPaymentSettingsSchema.partial().safeParse(raw);
  if (!parsed.success) {
    return base;
  }
  const data = parsed.data;
  const result: AccountPaymentSettings = {
    preferredProvider: data.preferredProvider ?? null,
  };
  if (data.stripeAccountId) result.stripeAccountId = data.stripeAccountId.trim();
  if (data.stripePublishableKey) result.stripePublishableKey = data.stripePublishableKey.trim();
  if (data.payoutStatementDescriptor) result.payoutStatementDescriptor = data.payoutStatementDescriptor.trim();
  if (data.paypalMerchantId) result.paypalMerchantId = data.paypalMerchantId.trim();
  if (data.paypalClientId) result.paypalClientId = data.paypalClientId.trim();
  if (data.paypalEmail) result.paypalEmail = data.paypalEmail.trim();
  if (typeof (raw as any)?.updatedAt === "string" && (raw as any).updatedAt.trim()) {
    result.updatedAt = (raw as any).updatedAt.trim();
  }
  return result;
}

export const geminiRefineSchema = z.object({
  config: z
    .object({
      basic: z
        .object({
          name: z.string().optional(),
          city: z.string().optional(),
          description: z.string().optional(),
          startDate: z.string().nullable().optional(),
          endDate: z.string().nullable().optional(),
          federation: z.string().optional(),
        })
        .partial()
        .optional(),
      details: z
        .object({
          rounds: z.number().optional(),
          timeControl: z.string().optional(),
          tiebreakSystem: z.string().optional(),
          pairingSystem: z.string().optional(),
          ratingType: z.string().optional(),
        })
        .partial()
        .optional(),
      schedule: z
        .array(
          z
            .object({
              label: z.string().optional(),
              date: z.string().nullable().optional(),
              time: z.string().nullable().optional(),
            })
            .passthrough(),
        )
        .optional(),
      contacts: z
        .array(
          z
            .object({
              name: z.string().optional(),
              role: z.string().optional(),
              email: z.string().optional(),
            })
            .passthrough(),
        )
        .optional(),
      instructions: z.string().optional(),
    })
    .passthrough(),
});

export function formatCurrencyAmount(amount: unknown, currency: unknown): string {
  const numeric = typeof amount === "number" ? amount : Number(amount);
  const code = typeof currency === "string" && currency.trim().length === 3 ? currency.trim().toUpperCase() : "USD";
  if (!Number.isFinite(numeric)) {
    return typeof amount === "string" && amount ? amount : code;
  }
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: code,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(numeric);
  } catch (error) {
    return `${code} ${numeric.toFixed(2)}`;
  }
}

export function describeRatingWindow(min: unknown, max: unknown): string {
  const low = Number(min);
  const high = Number(max);
  const hasLow = Number.isFinite(low);
  const hasHigh = Number.isFinite(high);
  if (hasLow && hasHigh) return `Rating ${low}-${high}`;
  if (hasLow) return `Rating ${low}+`;
  if (hasHigh) return `Rating ≤${high}`;
  return "All ratings";
}

export const updateNotificationPreferencesSchema = z.object({
  notifyEmail: z.boolean().optional(),
  notifyPairings: z.boolean().optional(),
  notifyRegistration: z.boolean().optional(),
  notifyTournamentStatus: z.boolean().optional(),
});

export const tournamentNotificationSchema = z.object({
  subject: z.string().min(1),
  message: z.string().min(1),
  sendEmail: z.boolean().optional(),
  sendPush: z.boolean().optional(),
  playerIds: z.array(z.number()).optional(),
});

export const createPaymentIntentSchema = z.object({
  entryFeeId: z.string().trim().optional(),
  contribution: z.coerce.number().min(0).max(500).default(0),
  currency: z.string().trim().optional(),
  receiptEmail: z.string().trim().email().optional(),
  playerName: z.string().trim().optional(),
  items: z.array(z.object({
    entryFeeId: z.string().trim().optional(),
    contribution: z.coerce.number().min(0).max(500).default(0),
    playerName: z.string().trim().optional(),
  })).optional(),
});

export const playerRegistrationSchema = z.object({
  playerName: z.string().min(1, "Player name is required").transform(normalizePlayerName),
  uscfRating: z.coerce.number().optional().nullable(),
  fideRating: z.coerce.number().optional().nullable(),
  uscfRatingRaw: z.string().trim().optional().nullable(),
  fideRatingRaw: z.string().trim().optional().nullable(),
  ratingProvider: z.string().trim().optional().nullable(),
  uscfId: z.string().trim().optional().nullable(),
  fideId: z.string().trim().optional().nullable(),
  email: z.string().email().optional().nullable(),
  address1: z.string().trim().optional().nullable(),
  address2: z.string().trim().optional().nullable(),
  city: z.string().trim().optional().nullable(),
  state: z.string().trim().optional().nullable(),
  postalCode: z.string().trim().optional().nullable(),
  country: z.string().trim().optional().nullable(),
  pairingNotifications: z.string().trim().optional().nullable(),
  newsletter: z.boolean().optional().default(false),
  sectionChoice: z.string().trim().optional().nullable(),
  entryFeeId: z.string().trim().optional().nullable(),
  processingContribution: z.coerce.number().optional().default(0),
  byePreference: z.string().trim().optional().nullable(),
  byeRounds: z.array(z.string()).optional().default([]),
  arrivalTime: z.string().trim().optional().nullable(),
  notes: z.string().trim().optional().nullable(),
  currency: z.string().optional().default("USD"),
  amountDue: z.coerce.number().optional().default(0),
  amountPaid: z.coerce.number().optional().default(0),
  paymentStatus: z.enum(PAYMENT_STATUSES).optional().default("unpaid"),
  paymentIntentId: z.string().trim().optional().nullable(),
  paymentMethod: z.string().trim().optional().nullable(),
  paymentReceiptUrl: z.string().url().optional().nullable(),
  paymentNotes: z.string().trim().optional().nullable(),
  customAnswers: z.record(z.any()).optional().nullable(),
});
