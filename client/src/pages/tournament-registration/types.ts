import { z } from "zod";
import type { Tournament, Player, PlayerRegistration } from "@shared/schema";
import type { PaymentSettings, SectionDefinition } from "@/lib/tournament-config";

export type { PaymentSettings, SectionDefinition };

export const PAYMENT_STATUS_VALUES = ["unpaid", "processing", "paid", "failed", "refunded"] as const;

export const registrationSchema = z.object({
  lookupMode: z.enum(["profile", "manual"]).default("profile"),
  profileSelected: z.boolean().default(false),
  ratingProvider: z.enum(["uscf", "fide", "manual", "none"]).default("none"),
  firstName: z.string().min(1, "Required"),
  lastName: z.string().min(1, "Required"),
  uscfId: z.string().optional(),
  fideId: z.string().optional(),
  uscfRating: z.string().optional(),
  fideRating: z.string().optional(),
  uscfRatingRaw: z.string().optional(),
  fideRatingRaw: z.string().optional(),
  email: z.string().email("Enter a valid email"),
  address1: z.string().optional(),
  address2: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  postalCode: z.string().optional(),
  country: z.string().optional(),
  pairingNotifications: z.enum(["none", "push", "email", "both"]).default("email"),
  newsletter: z.boolean().default(false),
  sectionChoice: z.string().min(1, "Select a section"),
  entryFeeId: z.string().min(1, "Select an entry option"),
  processingContribution: z
    .string()
    .default("0")
    .refine((value) => {
      if (!value.trim()) return true;
      const numeric = Number(value);
      return Number.isFinite(numeric) && numeric >= 0 && numeric <= 500;
    }, "Enter a valid contribution between $0 and $500"),
  paymentAcknowledgement: z
    .boolean()
    .refine((value) => value, { message: "Please acknowledge the offline payment terms." }),
  byePreference: z.enum(["none", "yes"]).default("none"),
  byeRounds: z.array(z.string()).default([]),
  arrivalTime: z.string().optional(),
  notes: z.string().optional(),
  paymentIntentId: z.string().optional(),
  paymentStatus: z.enum(PAYMENT_STATUS_VALUES).optional(),
  paymentReceiptUrl: z.string().url().optional(),
  paymentMethod: z.string().optional(),
  currency: z.string().optional(),
  amountDue: z.number().optional(),
  amountPaid: z.number().optional(),
  customAnswers: z.record(z.any()).optional().default({}),
});

export type RegistrationFormValues = z.infer<typeof registrationSchema>;

export const DEFAULT_FORM_VALUES: RegistrationFormValues = {
  lookupMode: "profile",
  profileSelected: false,
  ratingProvider: "none",
  firstName: "",
  lastName: "",
  uscfId: "",
  fideId: "",
  uscfRating: "",
  fideRating: "",
  uscfRatingRaw: "",
  fideRatingRaw: "",
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
  customAnswers: {},
};

export interface PaymentsConfigResponse {
  payments: PaymentSettings;
  publishableKey: string | null;
  onlineConfigured: boolean;
}

export interface PaymentIntentResponse {
  clientSecret: string;
  paymentIntentId: string;
  amount: number;
  subtotal: number;
  feeAmount: number;
  currency: string;
}

export interface PaymentTotals {
  subtotal: number;
  feeAmount: number;
  total: number;
  currency: string;
}

export interface TournamentRegistrationFormProps {
  tournamentId: number;
}

export type PaymentStatusKey = typeof PAYMENT_STATUS_VALUES[number];

export interface PlayerDraft {
  id: string;
  values: RegistrationFormValues;
}

// --- localStorage draft helpers ---
export interface RegistrationDraft {
  formValues: Partial<RegistrationFormValues>;
  playerDrafts: PlayerDraft[];
  currentStep: number;
  editingDraftId: string | null;
}

export const DRAFT_KEY_PREFIX = "reg-draft";
export function getDraftKey(tournamentId: number) {
  return `${DRAFT_KEY_PREFIX}-${tournamentId}`;
}
export function loadDraft(tournamentId: number): RegistrationDraft | null {
  try {
    const raw = localStorage.getItem(getDraftKey(tournamentId));
    if (!raw) return null;
    return JSON.parse(raw) as RegistrationDraft;
  } catch {
    return null;
  }
}
export function saveDraft(tournamentId: number, draft: RegistrationDraft) {
  try {
    localStorage.setItem(getDraftKey(tournamentId), JSON.stringify(draft));
  } catch {
    // quota exceeded – silently ignore
  }
}
export function clearDraft(tournamentId: number) {
  try {
    localStorage.removeItem(getDraftKey(tournamentId));
  } catch {
    // ignore
  }
}

export const COUNTRY_OPTIONS = [
  "United States",
  "Canada",
  "Mexico",
  "India",
  "United Kingdom",
  "Other",
];

export type SectionOption = Pick<SectionDefinition, "name" | "ratingMin" | "ratingMax"> & {
  id: string;
};


export type RatingLookupSource = "uscf" | "fide";

export interface RatingLookupResult {
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

export interface RatingLookupResponse {
  uscf?: RatingLookupResult[];
  fide?: RatingLookupResult[];
  errors?: Partial<Record<RatingLookupSource, string>>;
}
