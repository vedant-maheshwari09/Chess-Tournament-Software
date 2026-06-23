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
  paymentConfig: PaymentSettings,
) {
  const currency = normalizeCurrency(entryFee?.currency, paymentConfig.defaultCurrency ?? "USD");
  const baseAmount = (entryFee?.amount ?? 0) + contribution;
  const percent = Number(paymentConfig.processingFeePercent ?? 0);
  const feeAmount = percent > 0 ? Number((baseAmount * (percent / 100)).toFixed(2)) : 0;
  const total = Number((baseAmount + feeAmount).toFixed(2));
  return {
    subtotal: Number(baseAmount.toFixed(2)),
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
