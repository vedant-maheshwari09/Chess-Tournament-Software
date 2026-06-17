import { normalizePlayerName } from './util';
import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { storage } from '../storage';
import { setupVite, serveStatic, log } from '../vite';
import { z } from "zod";
import Stripe from "stripe";
import {
  insertTournamentSchema,
  insertPlayerSchema,
  insertMatchSchema,
  loginSchema,
  registerSchema,
  forgotPasswordSchema,
  forgotUsernameSchema,
  resetPasswordSchema,
  changePasswordSchema,
  verifyEmailSchema,
  resendVerificationSchema,
  type Player,
  type Pairing,
  type Match,
  type PlayerRegistration,
} from "@shared/schema";
import {
  hashPassword,
  verifyPassword,
  createSession,
  requireAuth,
  requireRole,
  requireTournamentAccess,
  generateSessionToken
} from '../auth';
import { sendEmailVerificationCode, sendPasswordResetCode } from '../emailVerification';
import { generateRoundRobinSchedule, validateRoundRobinSchedule } from '../round-robin';
import { notificationService } from '../notifications';
import { searchUSCF, searchFide, type LocalRatingResult, type LocalSearchParams } from '../lib/localRatings';
import {
  initializeChessResultsSchedulers,
  syncChessResults,
  testChessResultsConnection,
  updateChessResultsScheduler,
} from '../services/chessResults';
import {
  parseTournamentConfig,
  serializeTournamentConfig,
  type PaymentSettings,
  type EntryFeeRule,
  type AccountPaymentSettings,
  type TournamentConfig,
  type MatchFormat,
  type MatchWinConditionValue,
  calculateMatchupScore,
  getMatchFormat
} from "@shared/tournament-config";

import { generateFideTrf16Report } from "../lib/fideTrf";
import { lookupFideProfiles, searchFideDirectory } from "../lib/fideDirectory";
import { getPointsForResult, getResultSummary, type MatchResultCode } from "@shared/match-results";

export type RatingSource = "uscf" | "fide";


export const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY ?? "";
export const STRIPE_PUBLISHABLE_KEY = process.env.STRIPE_PUBLISHABLE_KEY ?? "";
export const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET ?? "";

export const stripe = STRIPE_SECRET_KEY ? new Stripe(STRIPE_SECRET_KEY) : null;

export const PAYMENT_STATUSES = ["unpaid", "processing", "paid", "failed", "refunded"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export interface RatingLookupResult {
  source: RatingSource;
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


export async function lookupUSCF(params: LocalSearchParams, limit = 30): Promise<RatingLookupResult[]> {
  const results = await searchUSCF(params, limit);
  return results.map((entry) => mapLocalResult("uscf", entry));
}

export async function lookupFide(params: LocalSearchParams, limit = 30): Promise<RatingLookupResult[]> {
  const results = await searchFide(params, limit);
  return results.map((entry) => mapLocalResult("fide", entry));
}

export function mapLocalResult(source: RatingSource, entry: LocalRatingResult): RatingLookupResult {
  const extraRatings: RatingLookupResult["extraRatings"] = [];
  if (entry.quickRating) {
    extraRatings.push({
      type: "quick",
      label: "Quick",
      value: entry.quickRating.value,
      display: entry.quickRating.raw ?? entry.quickRating.value,
    });
  }
  if (entry.rapidRating) {
    extraRatings.push({
      type: "rapid",
      label: "Rapid",
      value: entry.rapidRating.value,
      display: entry.rapidRating.raw ?? entry.rapidRating.value,
    });
  }
  if (entry.blitzRating) {
    extraRatings.push({
      type: "blitz",
      label: "Blitz",
      value: entry.blitzRating.value,
      display: entry.blitzRating.raw ?? entry.blitzRating.value,
    });
  }

  const location = entry.location ?? entry.federation ?? undefined;
  const extra = source === "fide" ? entry.title ?? undefined : undefined;
  const metadata: Record<string, string | undefined> = { ...entry.metadata };
  if (source === "fide" && entry.birthYear) {
    metadata.birthYear = entry.birthYear;
  }
  if (source === "uscf" && entry.location) {
    metadata.state = entry.location;
  }

  const cleanedMetadata = Object.values(metadata).some((value) => value)
    ? metadata
    : undefined;

  return {
    source,
    id: entry.id,
    name: entry.name,
    rating: entry.rating?.value,
    ratingDisplay: entry.rating?.raw ?? entry.rating?.value,
    location,
    extra,
    extraRatings: extraRatings.length > 0 ? extraRatings : undefined,
    metadata: cleanedMetadata,
    sex: entry.sex,
    birthYear: entry.birthYear,
  };
}

export function extractQueryParam(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function normalizeSearchParams(params: LocalSearchParams): LocalSearchParams {
  const normalized: LocalSearchParams = {};
  if (params.term) normalized.term = params.term;
  if (params.lastName) normalized.lastName = params.lastName;
  if (params.firstName) normalized.firstName = params.firstName;
  if (params.id) normalized.id = params.id;
  return normalized;
}

export function parseLimitParam(value: unknown, fallback: number, max: number): number {
  if (typeof value !== "string") return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

export function getGeminiConfig() {
  return {
    apiKey: process.env.GEMINI_API_KEY,
    model: process.env.GEMINI_MODEL ?? "gemini-2.5-pro",
  } as const;
}

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

export const paymentProviderEnum = z.enum(["stripe", "paypal"]);
export const paymentScopeEnum = z.enum(["tournament", "account"]);
export const offlineMethodEnum = z.enum(["cash", "check", "venmo", "zelle", "paypal", "other"]);

export const updateTournamentPaymentsSchema = z.object({
  provider: paymentProviderEnum,
  defaultCurrency: z.string().trim().length(3).optional(),
  onlineEnabled: z.boolean().optional(),
  requirePaymentOnRegistration: z.boolean().optional(),
  allowProcessingContribution: z.boolean().optional(),
  processingFeePercent: z
    .number({ invalid_type_error: "processingFeePercent must be a number" })
    .min(0)
    .max(100)
    .nullable()
    .optional(),
  stripeAccountId: z.string().trim().optional(),
  stripePublishableKey: z.string().trim().optional(),
  payoutStatementDescriptor: z.string().trim().optional(),
  paypalMerchantId: z.string().trim().optional(),
  paypalClientId: z.string().trim().optional(),
  paypalEmail: z.string().trim().email().optional(),
  connectionScope: paymentScopeEnum.optional(),
  acceptedOfflineMethods: z.array(offlineMethodEnum).optional(),
  offlineInstructions: z.string().trim().optional(),
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

export async function generatePairings(tournament: any, players: any[], matches: any[], existingPairings: any[], round: number, boardNumbers?: number[]) {
  const pairings = [];

  if (tournament.format === 'swiss') {
    // Use proper Swiss pairing algorithm
    const swissPairings = await generateSwissPairings(tournament, players, matches, round, existingPairings, boardNumbers);

    // Convert to our pairing format and persist to database
    for (const pairing of swissPairings) {
      if (pairing.isBye) {
        // Handle bye - use integer mapping: 0=0pts, 1=0.5pts, 2=1pt
        const byePoints = pairing.byeType === 'half_point' ? 1 : 2; // 1=0.5pts, 2=1pt
        const pObj = {
          tournamentId: tournament.id,
          round,
          playerId: pairing.whitePlayerId,
          opponentId: null,
          color: null,
          points: byePoints,
          isBye: true,
        };
        pairings.push(pObj);
        await storage.createPairing(pObj);

        await storage.createMatch({
          tournamentId: tournament.id,
          round,
          whitePlayerId: pairing.whitePlayerId,
          blackPlayerId: null,
          board: pairing.board ?? 0,
          result: '1-0', // Automatic bye gets 1.0 point
          status: 'completed',
          isBye: true,
        });
      } else {
        // Create pairing entries for both players
        const pWhite = {
          tournamentId: tournament.id,
          round,
          playerId: pairing.whitePlayerId,
          opponentId: pairing.blackPlayerId,
          color: 'white',
          points: 0,
          isBye: false,
        };
        const pBlack = {
          tournamentId: tournament.id,
          round,
          playerId: pairing.blackPlayerId,
          opponentId: pairing.whitePlayerId,
          color: 'black',
          points: 0,
          isBye: false,
        };
        pairings.push(pWhite);
        pairings.push(pBlack);

        await storage.createPairing(pWhite);
        await storage.createPairing(pBlack);

        await storage.createMatch({
          tournamentId: tournament.id,
          round,
          whitePlayerId: pairing.whitePlayerId,
          blackPlayerId: pairing.blackPlayerId,
          board: pairing.board ?? 0,
          result: null,
          status: 'pending',
          isBye: false,
        });
      }
    }
  } else if (tournament.format === 'roundrobin') {
    // Round robin uses pre-generated pairings, not generated per round
    console.log('Round Robin tournament - pairings should be pre-generated');
    return [];
  }

  return pairings;
}

// Helper functions for proper Swiss pairing
export function groupPlayersByScore(playerStats: any[], tournament: any): any[][] {
  const groups: { [score: string]: any[] } = {};

  for (const player of playerStats) {
    const score = player.points.toString();
    if (!groups[score]) {
      groups[score] = [];
    }
    groups[score].push(player);
  }

  // Sort groups by score (highest first) and players within groups by seeding order
  return Object.keys(groups)
    .sort((a, b) => parseFloat(b) - parseFloat(a))
    .map(score => groups[score].sort((a, b) => {
      // Sort by rating first, then alphabetically for consistent seeding
      const tournamentConfig = parseTournamentConfig(tournament);
      const isFide = tournamentConfig.details.primaryRatingSystem === 'fide';
      const ratingA = (isFide ? (a.player.fideRating ?? a.player.rating) : (a.player.uscfRating ?? a.player.rating)) || 0;
      const ratingB = (isFide ? (b.player.fideRating ?? b.player.rating) : (b.player.uscfRating ?? b.player.rating)) || 0;
      const ratingDiff = ratingB - ratingA;
      if (ratingDiff !== 0) return ratingDiff;

      // If ratings are equal, sort alphabetically by first name, then last name
      const firstNameCmp = (a.player.firstName || '').localeCompare(b.player.firstName || '');
      if (firstNameCmp !== 0) return firstNameCmp;

      const lastNameCmp = (a.player.lastName || '').localeCompare(b.player.lastName || '');
      if (lastNameCmp !== 0) return lastNameCmp;

      // If names are also equal, sort by ID for consistent ordering
      return a.player.id - b.player.id;
    }));
}

export function pairUpperVsLowerHalf(scoreGroup: any[], matches: any[], round: number, tournament: any): { paired: any[][], unpaired: any[] } {
  const paired: any[][] = [];
  const unpaired: any[] = [];

  if (scoreGroup.length < 2) {
    return { paired, unpaired: [...scoreGroup] };
  }

  // Sort by rating (highest first for proper upper/lower half)
  const tournamentConfig = parseTournamentConfig(tournament);
  const isFide = tournamentConfig.details.primaryRatingSystem === 'fide';
  const sortedGroup = [...scoreGroup].sort((a, b) => {
    const ratingA = (isFide ? (a.player.fideRating ?? a.player.rating) : (a.player.uscfRating ?? a.player.rating)) || 0;
    const ratingB = (isFide ? (b.player.fideRating ?? b.player.rating) : (b.player.uscfRating ?? b.player.rating)) || 0;
    return ratingB - ratingA;
  });
  const midPoint = Math.floor(sortedGroup.length / 2);

  const upperHalf = sortedGroup.slice(0, midPoint);
  const lowerHalf = sortedGroup.slice(midPoint);

  // Pair upper half with lower half
  const maxPairs = Math.min(upperHalf.length, lowerHalf.length);

  for (let i = 0; i < maxPairs; i++) {
    const upperPlayer = upperHalf[i];
    let pairedLowerPlayer = null;
    let pairedIndex = -1;

    // Rule #1: Find a lower half player they haven't played before
    for (let j = i; j < lowerHalf.length; j++) {
      const lowerPlayer = lowerHalf[j];
      if (!matches.some(match =>
        (match.whitePlayerId === upperPlayer.player.id && match.blackPlayerId === lowerPlayer.player.id) ||
        (match.whitePlayerId === lowerPlayer.player.id && match.blackPlayerId === upperPlayer.player.id)
      )) {
        pairedLowerPlayer = lowerPlayer;
        pairedIndex = j;
        break;
      }
    }

    if (pairedLowerPlayer) {
      paired.push([upperPlayer, pairedLowerPlayer]);
      // Remove the paired lower player
      lowerHalf.splice(pairedIndex, 1);
    } else {
      // No unplayed opponent available, add to unpaired
      unpaired.push(upperPlayer);
    }
  }

  // Add any remaining unpaired players
  unpaired.push(...upperHalf.slice(maxPairs), ...lowerHalf);

  return { paired, unpaired };
}



export function determineSwissColors(player1: any, player2: any, tournament: any): { whitePlayer: any, blackPlayer: any } {
  // Calculate player stats for color balancing
  const p1Stats = player1.player ? player1 : { colorBalance: 0, whiteGames: 0, blackGames: 0 };
  const p2Stats = player2.player ? player2 : { colorBalance: 0, whiteGames: 0, blackGames: 0 };

  const p1Balance = p1Stats.colorBalance || 0;  // Positive = more whites, Negative = more blacks
  const p2Balance = p2Stats.colorBalance || 0;

  console.log(`Color assignment: ${p1Stats.player?.firstName || 'Player1'} (balance: ${p1Balance}) vs ${p2Stats.player?.firstName || 'Player2'} (balance: ${p2Balance})`);

  // USCF Rule: Player cannot have more than 2-color difference
  // If a player has +2 whites, they MUST get black next
  // If a player has -2 blacks, they MUST get white next

  if (p1Balance >= 2) {
    // Player 1 has 2+ more whites, MUST get black
    console.log(`  ${p1Stats.player?.firstName || 'Player1'} must get black (has +${p1Balance} color balance)`);
    return { whitePlayer: p2Stats.player, blackPlayer: p1Stats.player };
  }

  if (p1Balance <= -2) {
    // Player 1 has 2+ more blacks, MUST get white
    console.log(`  ${p1Stats.player?.firstName || 'Player1'} must get white (has ${p1Balance} color balance)`);
    return { whitePlayer: p1Stats.player, blackPlayer: p2Stats.player };
  }

  if (p2Balance >= 2) {
    // Player 2 has 2+ more whites, MUST get black
    console.log(`  ${p2Stats.player?.firstName || 'Player2'} must get black (has +${p2Balance} color balance)`);
    return { whitePlayer: p1Stats.player, blackPlayer: p2Stats.player };
  }

  if (p2Balance <= -2) {
    // Player 2 has 2+ more blacks, MUST get white
    console.log(`  ${p2Stats.player?.firstName || 'Player2'} must get white (has ${p2Balance} color balance)`);
    return { whitePlayer: p2Stats.player, blackPlayer: p1Stats.player };
  }

  // Neither player has a forced color, use normal Swiss preference rules
  if (p1Balance < p2Balance) {
    // Player 1 needs white more
    console.log(`  ${p1Stats.player?.firstName || 'Player1'} gets white (better balance: ${p1Balance} vs ${p2Balance})`);
    return { whitePlayer: p1Stats.player, blackPlayer: p2Stats.player };
  } else if (p2Balance < p1Balance) {
    // Player 2 needs white more
    console.log(`  ${p2Stats.player?.firstName || 'Player2'} gets white (better balance: ${p2Balance} vs ${p1Balance})`);
    return { whitePlayer: p2Stats.player, blackPlayer: p1Stats.player };
  } else {
    // Equal balance - higher rated player gets white (or random if equal ratings)
    const tournamentConfig = parseTournamentConfig(tournament);
    const isFide = tournamentConfig.details.primaryRatingSystem === 'fide';
    const p1Rating = (isFide ? (p1Stats.player?.fideRating ?? p1Stats.player?.rating) : (p1Stats.player?.uscfRating ?? p1Stats.player?.rating)) || 0;
    const p2Rating = (isFide ? (p2Stats.player?.fideRating ?? p2Stats.player?.rating) : (p2Stats.player?.uscfRating ?? p2Stats.player?.rating)) || 0;

    if (p1Rating > p2Rating) {
      console.log(`  ${p1Stats.player?.firstName || 'Player1'} gets white (higher rated: ${p1Rating} vs ${p2Rating})`);
      return { whitePlayer: p1Stats.player, blackPlayer: p2Stats.player };
    } else if (p2Rating > p1Rating) {
      console.log(`  ${p2Stats.player?.firstName || 'Player2'} gets white (higher rated: ${p2Rating} vs ${p1Rating})`);
      return { whitePlayer: p2Stats.player, blackPlayer: p1Stats.player };
    } else {
      // Equal ratings - random assignment
      const randomWhite = Math.random() < 0.5;
      console.log(`  Random assignment: ${randomWhite ? p1Stats.player?.firstName || 'Player1' : p2Stats.player?.firstName || 'Player2'} gets white`);
      return randomWhite
        ? { whitePlayer: p1Stats.player, blackPlayer: p2Stats.player }
        : { whitePlayer: p2Stats.player, blackPlayer: p1Stats.player };
    }
  }
}

function getPlayerRating(player: any, primaryRatingSystem: string): number {
  const rating = primaryRatingSystem === 'fide' ? player.fideRating : player.uscfRating;
  return rating ?? player.rating ?? 0;
}

function isPlayerUnrated(player: any, primaryRatingSystem: string): boolean {
  const rating = primaryRatingSystem === 'fide' ? player.fideRating : player.uscfRating;
  return rating === null || rating === 0;
}

interface PlayerStats {
  id: number;
  player: any;
  points: number;
  opponents: Set<number>;
  byesReceived: number;
  colorHistory: ('white' | 'black' | null)[];
  colorBalance: number;
  consecutiveColor: number;
  lastColor: 'white' | 'black' | null;
  isUnrated: boolean;
}

function isHigherSeed(p1: PlayerStats, p2: PlayerStats, primaryRatingSystem: string): boolean {
  const isFide = primaryRatingSystem === 'fide';
  const ratingA = (isFide ? (p1.player.fideRating ?? p1.player.rating) : (p1.player.uscfRating ?? p1.player.rating)) || 0;
  const ratingB = (isFide ? (p2.player.fideRating ?? p2.player.rating) : (p2.player.uscfRating ?? p2.player.rating)) || 0;
  if (ratingA !== ratingB) {
    return ratingA > ratingB;
  }
  const firstNameCmp = (p1.player.firstName || '').localeCompare(p2.player.firstName || '');
  if (firstNameCmp !== 0) {
    return firstNameCmp < 0; // lower alphabetical is higher seed
  }
  const lastNameCmp = (p1.player.lastName || '').localeCompare(p2.player.lastName || '');
  if (lastNameCmp !== 0) {
    return lastNameCmp < 0;
  }
  return p1.id < p2.id;
}

function lookBackColorDifference(p1: PlayerStats, p2: PlayerStats, dueColor: 'white' | 'black'): number {
  const history1 = p1.colorHistory || [];
  const history2 = p2.colorHistory || [];
  const len1 = history1.length;
  const len2 = history2.length;
  const maxLen = Math.max(len1, len2);
  const avoidedColor = dueColor === 'white' ? 'black' : 'white';

  for (let i = 1; i <= maxLen; i++) {
    const c1 = len1 >= i ? history1[len1 - i] : null;
    const c2 = len2 >= i ? history2[len2 - i] : null;
    if (c1 !== c2) {
      if (c1 === avoidedColor) return 1;
      if (c2 === avoidedColor) return -1;
    }
  }
  return 0;
}

function getPlayerDueColorAndStrength(p: PlayerStats): { color: 'white' | 'black' | null, strength: number } {
  const balance = p.colorBalance || 0;
  if (balance > 0) {
    return { color: 'black', strength: balance };
  } else if (balance < 0) {
    return { color: 'white', strength: -balance };
  } else {
    const last = p.lastColor;
    if (last === 'black') {
      return { color: 'white', strength: 0.1 };
    } else if (last === 'white') {
      return { color: 'black', strength: 0.1 };
    }
  }
  return { color: null, strength: 0 };
}

function scoreColorOption(p1: PlayerStats, p2: PlayerStats, p1White: boolean, primaryRatingSystem: string): number {
  const p1Pref = getPlayerDueColorAndStrength(p1);
  const p2Pref = getPlayerDueColorAndStrength(p2);

  if (p1Pref.color === 'white' && p2Pref.color === 'white') {
    let p1Claim = p1Pref.strength - p2Pref.strength;
    if (Math.abs(p1Claim) < 0.01) {
      p1Claim = lookBackColorDifference(p1, p2, 'white');
      if (p1Claim === 0) {
        const p1IsHigher = isHigherSeed(p1, p2, primaryRatingSystem);
        p1Claim = p1IsHigher ? 1 : -1;
      }
    }
    return p1White ? p1Claim : -p1Claim;
  }

  if (p1Pref.color === 'black' && p2Pref.color === 'black') {
    let p1BlackClaim = p1Pref.strength - p2Pref.strength;
    if (Math.abs(p1BlackClaim) < 0.01) {
      p1BlackClaim = lookBackColorDifference(p1, p2, 'black');
      if (p1BlackClaim === 0) {
        const p1IsHigher = isHigherSeed(p1, p2, primaryRatingSystem);
        p1BlackClaim = p1IsHigher ? 1 : -1;
      }
    }
    return p1White ? -p1BlackClaim : p1BlackClaim;
  }

  if (p1Pref.color === 'white' && p2Pref.color === 'black') {
    return p1White ? 10 : -10;
  }
  if (p1Pref.color === 'black' && p2Pref.color === 'white') {
    return p1White ? -10 : 10;
  }

  let score = 0;
  if (p1White) {
    if (p1Pref.color === 'white') score += p1Pref.strength;
    if (p1Pref.color === 'black') score -= p1Pref.strength;
    if (p2Pref.color === 'black') score += p2Pref.strength;
    if (p2Pref.color === 'white') score -= p2Pref.strength;
  } else {
    if (p1Pref.color === 'black') score += p1Pref.strength;
    if (p1Pref.color === 'white') score -= p1Pref.strength;
    if (p2Pref.color === 'white') score += p2Pref.strength;
    if (p2Pref.color === 'black') score -= p2Pref.strength;
  }

  return score;
}

function getValidColorAssignments(
  p1: PlayerStats,
  p2: PlayerStats,
  strictColors: boolean,
  allowRepeats: boolean,
  primaryRatingSystem: string
): ('p1_white_p2_black' | 'p1_black_p2_white')[] {
  if (!allowRepeats && p1.opponents.has(p2.id)) {
    return [];
  }

  const options: ('p1_white_p2_black' | 'p1_black_p2_white')[] = [];

  let p1WhiteOk = true;
  let p2BlackOk = true;

  if (strictColors) {
    if (p1.consecutiveColor >= 2) p1WhiteOk = false;
    if (p1.colorBalance >= 2) p1WhiteOk = false;
    if (p2.consecutiveColor <= -2) p2BlackOk = false;
    if (p2.colorBalance <= -2) p2BlackOk = false;
  }

  if (p1WhiteOk && p2BlackOk) {
    options.push('p1_white_p2_black');
  }

  let p1BlackOk = true;
  let p2WhiteOk = true;

  if (strictColors) {
    if (p1.consecutiveColor <= -2) p1BlackOk = false;
    if (p1.colorBalance <= -2) p1BlackOk = false;
    if (p2.consecutiveColor >= 2) p2WhiteOk = false;
    if (p2.colorBalance >= 2) p2WhiteOk = false;
  }

  if (p1BlackOk && p2WhiteOk) {
    options.push('p1_black_p2_white');
  }

  if (options.length === 2) {
    const pref1 = scoreColorOption(p1, p2, true, primaryRatingSystem);
    const pref2 = scoreColorOption(p1, p2, false, primaryRatingSystem);
    if (pref2 > pref1) {
      return ['p1_black_p2_white', 'p1_white_p2_black'];
    }
  }

  return options;
}

function backtrack(
  unpairedList: PlayerStats[],
  currentPairings: any[],
  strictColors: boolean,
  allowRepeats: boolean,
  boardNumbers: number[],
  boardIdx: number,
  primaryRatingSystem: string
): boolean {
  if (unpairedList.length === 0) {
    return true;
  }

  const p1 = unpairedList[0];

  for (let i = 1; i < unpairedList.length; i++) {
    const p2 = unpairedList[i];

    const colorOptions = getValidColorAssignments(p1, p2, strictColors, allowRepeats, primaryRatingSystem);
    for (const option of colorOptions) {
      const whitePlayer = option === 'p1_white_p2_black' ? p1 : p2;
      const blackPlayer = option === 'p1_white_p2_black' ? p2 : p1;

      const board = boardNumbers[boardIdx];
      currentPairings.push({
        whitePlayerId: whitePlayer.id,
        blackPlayerId: blackPlayer.id,
        board,
        isBye: false,
      });

      const remaining = unpairedList.filter(p => p.id !== p1.id && p.id !== p2.id);

      if (backtrack(remaining, currentPairings, strictColors, allowRepeats, boardNumbers, boardIdx + 1, primaryRatingSystem)) {
        return true;
      }

      currentPairings.pop();
    }
  }

  return false;
}

export async function generateSwissPairings(
  tournament: any,
  players: any[],
  matches: any[],
  round: number,
  existingPairings: any[] = [],
  boardNumbers?: number[]
) {
  console.log(`=== SWISS PAIRING ENGINE: ROUND ${round} ===`);
  const pairings: any[] = [];

  // Filter out withdrawn players and players with round-specific bye requests
  const withdrawnPlayerIds = new Set<number>();
  const roundByePlayerIds = new Set<number>();

  for (const pairing of existingPairings) {
    if (pairing.isBye) {
      if (pairing.byeType === 'zero_point' && pairing.round >= round) {
        withdrawnPlayerIds.add(pairing.playerId);
      }
      if (pairing.round === round) {
        roundByePlayerIds.add(pairing.playerId);
      }
    }
  }

  const rawActivePlayers = players.filter(player =>
    !withdrawnPlayerIds.has(player.id) && !roundByePlayerIds.has(player.id) && player.status !== 'withdrawn'
  );

  let activePlayers = [...rawActivePlayers];
  const housePlayer = rawActivePlayers.find(p => p.isActiveTd);
  if (housePlayer) {
    const nonHousePlayersCount = rawActivePlayers.filter(p => !p.isActiveTd).length;
    if (nonHousePlayersCount % 2 === 0) {
      activePlayers = rawActivePlayers.filter(p => !p.isActiveTd);
      console.log(`House player ${housePlayer.firstName} ${housePlayer.lastName} (ID: ${housePlayer.id}) is removed because the number of non-house active players (${nonHousePlayersCount}) is even.`);
    } else {
      console.log(`House player ${housePlayer.firstName} ${housePlayer.lastName} (ID: ${housePlayer.id}) is retained because the number of non-house active players (${nonHousePlayersCount}) is odd.`);
    }
  }

  console.log(`Active players for round ${round}: ${activePlayers.length}`);

  const tournamentConfig = parseTournamentConfig(tournament);
  const primaryRatingSystem = tournamentConfig.details.primaryRatingSystem || 'uscf';

  if (round === 1) {
    // Round 1: Sort by rating, pair upper half vs lower half
    const sortedPlayers = [...activePlayers].sort((a, b) => {
      const ratingA = getPlayerRating(a, primaryRatingSystem);
      const ratingB = getPlayerRating(b, primaryRatingSystem);
      if (ratingB !== ratingA) return ratingB - ratingA;
      const nameA = `${a.firstName || ''} ${a.lastName || ''}`;
      const nameB = `${b.firstName || ''} ${b.lastName || ''}`;
      if (nameA !== nameB) return nameA.localeCompare(nameB);
      return a.id - b.id;
    });

    const isOdd = sortedPlayers.length % 2 === 1;
    const numPairs = Math.floor(sortedPlayers.length / 2);
    const numBoards = numPairs + (isOdd ? 1 : 0);
    const resolvedBoardNumbers = boardNumbers ?? generateBoardNumberSequence(tournament.boardNumberingSettings, numBoards);

    let upperHalf: any[] = [];
    let lowerHalf: any[] = [];
    let byePlayer: any = null;

    if (isOdd) {
      // Find the bye player: lowest-rated rated player who is not unrated.
      let byeIdx = sortedPlayers.length - 1;
      for (let i = sortedPlayers.length - 1; i >= 0; i--) {
        if (!isPlayerUnrated(sortedPlayers[i], primaryRatingSystem)) {
          byeIdx = i;
          break;
        }
      }
      byePlayer = sortedPlayers[byeIdx];
      const remaining = sortedPlayers.filter((_, idx) => idx !== byeIdx);
      upperHalf = remaining.slice(0, numPairs);
      lowerHalf = remaining.slice(numPairs);
    } else {
      upperHalf = sortedPlayers.slice(0, numPairs);
      lowerHalf = sortedPlayers.slice(numPairs);
    }

    const firstBoardWhiteIsUpper = Math.random() < 0.5;

    for (let i = 0; i < upperHalf.length && i < lowerHalf.length; i++) {
      const upperPlayer = upperHalf[i];
      const lowerPlayer = lowerHalf[i];
      const upperPlayerIsWhite = i === 0 ? firstBoardWhiteIsUpper : (i % 2 === 0) === firstBoardWhiteIsUpper;

      pairings.push({
        whitePlayerId: upperPlayerIsWhite ? upperPlayer.id : lowerPlayer.id,
        blackPlayerId: upperPlayerIsWhite ? lowerPlayer.id : upperPlayer.id,
        board: resolvedBoardNumbers[i],
        isBye: false,
      });
    }

    if (isOdd && byePlayer) {
      pairings.push({
        whitePlayerId: byePlayer.id,
        blackPlayerId: null,
        board: resolvedBoardNumbers[numPairs],
        isBye: true,
        byeType: 'full_point',
      });
    }
  } else {
    // Round 2+ pairings: calculate standings, histories, and run backtracking search
    const playerStatsList: PlayerStats[] = activePlayers.map(player => {
      const playerMatches = matches.filter(m =>
        m.whitePlayerId === player.id || m.blackPlayerId === player.id
      );

      let points = 0;
      for (let r = 1; r < round; r++) {
        const match = playerMatches.find(m => m.round === r);
        if (match) {
          if (match.whitePlayerId === player.id) {
            points += getPointsForResult(match.result, "white");
          } else if (match.blackPlayerId === player.id) {
            points += getPointsForResult(match.result, "black");
          }
        } else {
          const bye = existingPairings.find(p => p.playerId === player.id && p.isBye && p.points !== null && p.round === r);
          if (bye) {
            const byePoints = bye.points === 1 ? 0.5 : bye.points === 2 ? 1 : 0;
            points += byePoints;
          }
        }
      }

      const opponents = new Set<number>();
      for (const match of playerMatches) {
        if (match.whitePlayerId === player.id && match.blackPlayerId) {
          opponents.add(match.blackPlayerId);
        } else if (match.blackPlayerId === player.id && match.whitePlayerId) {
          opponents.add(match.whitePlayerId);
        }
      }
      for (const pairing of existingPairings) {
        if (pairing.round < round && pairing.playerId === player.id && !pairing.isBye && pairing.opponentId) {
          opponents.add(pairing.opponentId);
        }
      }

      let byesReceived = 0;
      for (const pairing of existingPairings) {
        if (pairing.round < round && pairing.playerId === player.id && pairing.isBye && !pairing.isRequested) {
          if (pairing.points === 2 || pairing.points === null) {
            byesReceived++;
          }
        }
      }

      const colorHistory: ('white' | 'black' | null)[] = [];
      for (let r = 1; r < round; r++) {
        const p = existingPairings.find(pair => pair.playerId === player.id && pair.round === r);
        if (p) {
          if (p.isBye) {
            colorHistory.push(null);
          } else {
            colorHistory.push(p.color as 'white' | 'black');
          }
        } else {
          const m = matches.find(match => match.round === r && (match.whitePlayerId === player.id || match.blackPlayerId === player.id));
          if (m) {
            if (m.whitePlayerId === player.id) {
              colorHistory.push('white');
            } else {
              colorHistory.push('black');
            }
          } else {
            colorHistory.push(null);
          }
        }
      }

      let whiteGames = 0;
      let blackGames = 0;
      let consecutiveColor = 0;
      let lastColor: 'white' | 'black' | null = null;

      for (const col of colorHistory) {
        if (col === 'white') {
          whiteGames++;
          if (consecutiveColor > 0) {
            consecutiveColor++;
          } else {
            consecutiveColor = 1;
          }
          lastColor = 'white';
        } else if (col === 'black') {
          blackGames++;
          if (consecutiveColor < 0) {
            consecutiveColor--;
          } else {
            consecutiveColor = -1;
          }
          lastColor = 'black';
        }
      }
      const colorBalance = whiteGames - blackGames;
      const isUnrated = isPlayerUnrated(player, primaryRatingSystem);

      return {
        id: player.id,
        player,
        points,
        opponents,
        byesReceived,
        colorHistory,
        colorBalance,
        consecutiveColor,
        lastColor,
        isUnrated,
      };
    });

    const sortedPlayers = [...playerStatsList].sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      const ratingA = getPlayerRating(a.player, primaryRatingSystem);
      const ratingB = getPlayerRating(b.player, primaryRatingSystem);
      if (ratingB !== ratingA) return ratingB - ratingA;
      const nameA = `${a.player.firstName || ''} ${a.player.lastName || ''}`;
      const nameB = `${b.player.firstName || ''} ${b.player.lastName || ''}`;
      if (nameA !== nameB) return nameA.localeCompare(nameB);
      return a.id - b.id;
    });

    const numPairs = Math.floor(sortedPlayers.length / 2);
    const isOdd = sortedPlayers.length % 2 === 1;
    const numBoards = numPairs + (isOdd ? 1 : 0);
    const resolvedBoardNumbers = boardNumbers ?? generateBoardNumberSequence(tournament.boardNumberingSettings, numBoards);

    const getByeCandidates = (playersStats: PlayerStats[]) => {
      return [...playersStats].sort((a, b) => {
        if (a.byesReceived !== b.byesReceived) return a.byesReceived - b.byesReceived;
        if (a.isUnrated !== b.isUnrated) return a.isUnrated ? 1 : -1;
        if (a.points !== b.points) return a.points - b.points;
        const ratingA = getPlayerRating(a.player, primaryRatingSystem);
        const ratingB = getPlayerRating(b.player, primaryRatingSystem);
        return ratingA - ratingB;
      });
    };

    let success = false;
    let pairingsResult: any[] = [];

    const relaxationLevels = [
      { strictColors: true, allowRepeats: false },
      { strictColors: false, allowRepeats: false },
      { strictColors: false, allowRepeats: true },
    ];

    for (const level of relaxationLevels) {
      if (isOdd) {
        const byeCandidates = getByeCandidates(sortedPlayers);
        for (const byeCandidate of byeCandidates) {
          const remainingPlayers = sortedPlayers.filter(p => p.id !== byeCandidate.id);
          const tempPairings: any[] = [];

          if (backtrack(remainingPlayers, tempPairings, level.strictColors, level.allowRepeats, resolvedBoardNumbers, 0, primaryRatingSystem)) {
            pairingsResult = tempPairings;
            const byeBoard = resolvedBoardNumbers[resolvedBoardNumbers.length - 1];
            pairingsResult.push({
              whitePlayerId: byeCandidate.id,
              blackPlayerId: null,
              board: byeBoard,
              isBye: true,
              byeType: 'full_point',
            });
            success = true;
            break;
          }
        }
      } else {
        const tempPairings: any[] = [];
        if (backtrack(sortedPlayers, tempPairings, level.strictColors, level.allowRepeats, resolvedBoardNumbers, 0, primaryRatingSystem)) {
          pairingsResult = tempPairings;
          success = true;
        }
      }

      if (success) {
        console.log(`Swiss pairings for round ${round} generated successfully at level:`, level);
        break;
      }
    }

    if (!success) {
      throw new Error(`Failed to generate Swiss pairings for round ${round} even after constraint relaxation.`);
    }

    pairings.push(...pairingsResult);
  }

  return pairings;
}

// ============== BOARD NUMBERING ==============

export type BoardNumberingSettings = {
  start?: number;
  increment?: number;
  gaps?: { afterBoard: number; skip: number }[];
  customSequence?: number[];
  prefix?: string;
  suffix?: string;
};

export function generateBoardNumberSequence(
  settings: BoardNumberingSettings | null | undefined,
  count: number,
): number[] {
  if (!settings) {
    // Default: 1, 2, 3, ...
    return Array.from({ length: count }, (_, i) => i + 1);
  }

  if (settings.customSequence && settings.customSequence.length > 0) {
    return settings.customSequence.slice(0, count);
  }

  const sequence: number[] = [];
  let currentBoard = settings.start ?? 1;
  const increment = settings.increment ?? 1;
  const gaps = settings.gaps ? [...settings.gaps].sort((a, b) => a.afterBoard - b.afterBoard) : [];

  while (sequence.length < count) {
    sequence.push(currentBoard);

    // Apply gap if needed
    const applicableGap = gaps.find((g) => g.afterBoard === currentBoard);
    if (applicableGap) {
      currentBoard += applicableGap.skip;
    }

    // Increment for the next board
    currentBoard += increment;
  }
  return sequence;
}

export function isMatchDecided(
  score: { p1Score: number; p2Score: number; p1Id: number | null; p2Id: number | null },
  format: MatchFormat,
  lastMatch: any
): { decided: boolean; winnerId: number | null } {
  const thresholds = format.thresholds || [1.5];

  for (const threshold of thresholds) {
    const t = threshold === "armageddon" ? Infinity : Number(threshold);

    if (threshold === "armageddon") {
      // Armageddon always decides the match
      if (lastMatch.result === '1-0' || lastMatch.result === '1-0F') return { decided: true, winnerId: lastMatch.whitePlayerId };
      if (lastMatch.result === '0-1' || lastMatch.result === '0-1F') return { decided: true, winnerId: lastMatch.blackPlayerId };
      if (lastMatch.result === '1/2-1/2') {
        // In Armageddon, draw = black wins
        return { decided: true, winnerId: lastMatch.blackPlayerId };
      }
      // If result is somehow missing but it's an Armageddon, we can't decide yet
      continue;
    }

    // Standard threshold check
    if (score.p1Score >= t && score.p2Score < t) {
      return { decided: true, winnerId: score.p1Id };
    }
    if (score.p2Score >= t && score.p1Score < t) {
      return { decided: true, winnerId: score.p2Id };
    }

    if (score.p1Score >= t && score.p2Score >= t) {
      console.log(`[VICTORY PROTOCOL] Threshold ${t} reached by both players (TIE). Moving to next stage...`);
      continue;
    }

    // If we haven't reached this threshold yet, and there are no more thresholds,
    // the series is not yet decided.
    // If there ARE more thresholds, we also stop here because thresholds are cumulative.
    console.log(`[VICTORY PROTOCOL] Threshold ${t} not yet reached (Current: ${score.p1Score}-${score.p2Score}). Series continues.`);
    return { decided: false, winnerId: null };
  }

  return { decided: false, winnerId: null };
}

export async function spawnNextMatchupGame(tournamentId: number, lastMatch: Match, matchupGames: Match[]) {
  // 1. Get the tournament config and format
  const tournament = await storage.getTournament(tournamentId);
  if (!tournament) return;

  const config = parseTournamentConfig(tournament);
  const format = getMatchFormat(config, lastMatch.round, lastMatch.bracketType || undefined);
  const score = calculateMatchupScore(matchupGames);

  // 2. Determine if the series is ALREADY decided
  const decision = isMatchDecided(score, format, lastMatch);
  if (decision.decided) {
    console.log(`[DEBUG] spawnNextMatchupGame: Match series ALREADY DECIDED (Winner: ${decision.winnerId}). Skipping spawn.`);
    return;
  }

  // 3. Check if a next game ALREADY exists to prevent duplicates
  const existingUpcoming = matchupGames.find(m => (m.gameNumber || 1) > (lastMatch.gameNumber || 0));
  if (existingUpcoming) {
    console.log(`[DEBUG] spawnNextMatchupGame: A subsequent game ${existingUpcoming.gameNumber} already exists (ID: ${existingUpcoming.id}). Skipping spawn.`);
    return;
  }

  console.log(`[DEBUG] spawnNextMatchupGame: Checking potential spawn. Games played: ${matchupGames.length}, Thresholds: ${JSON.stringify(format.thresholds)}, Current Score: P1=${score.p1Score}, P2=${score.p2Score}`);

  // 4. Determine if we SHOULD spawn
  let nextGameType = 'standard';
  const currentMaxGameNumber = Math.max(...matchupGames.map(m => m.gameNumber || 1), 0);
  const nextGameNumber = currentMaxGameNumber + 1;

  // Determine if we are still within the "standard" games part of the series
  const maxStandardGames = format.games || 2;

  if (matchupGames.length < maxStandardGames) {
    // We still have standard games to play
    console.log(`[DEBUG] spawnNextMatchupGame: Spawning standard game ${nextGameNumber} (Game ${matchupGames.length + 1} of ${maxStandardGames})`);
  } else {
    // Regular games exhausted. Check for tie-break (Armageddon)
    // We only spawn Armageddon if it's explicitly tied and in the thresholds
    if (score.p1Score === score.p2Score && format.thresholds.includes('armageddon')) {
      nextGameType = 'armageddon';
      console.log(`[DEBUG] spawnNextMatchupGame: Series tied at ${score.p1Score}-${score.p2Score}. Spawning Armageddon!`);
    } else {
      console.log(`[DEBUG] spawnNextMatchupGame: Match decided or no more tie-breaks. Skipping spawn.`);
      return;
    }
  }

  // 5. Determine colors (swap from lastMatch)
  const whitePlayerId = lastMatch.blackPlayerId;
  const blackPlayerId = lastMatch.whitePlayerId;

  if (!whitePlayerId || !blackPlayerId) {
    console.log(`[DEBUG] spawnNextMatchupGame: Incomplete players for next game. Skipping.`);
    return;
  }

  await storage.createMatch({
    tournamentId,
    round: lastMatch.round,
    board: lastMatch.board,
    whitePlayerId,
    blackPlayerId,
    gameType: nextGameType,
    gameNumber: nextGameNumber,
    bracketType: lastMatch.bracketType,
    sectionId: lastMatch.sectionId,
    result: '*',
    status: 'pending'
  });
  console.log(`[DEBUG] spawnNextMatchupGame: Successfully spawned game ${nextGameNumber} (${nextGameType})`);
}

export async function advanceKnockoutWinner(tournamentId: number, match: any, winnerId: number) {
  console.log(`[DEBUG] advanceKnockoutWinner: Advancing Winner ${winnerId} from Match ${match.id}`);
  const tournament = await storage.getTournament(tournamentId);
  if (!tournament || tournament.format !== 'knockout') {
    console.log(`[DEBUG] advanceKnockoutWinner: Tournament not valid for knockout advancement.`);
    return;
  }

  const players = await storage.getPlayersByTournament(tournamentId);
  const allMatches = await storage.getMatchesByTournament(tournamentId);
  const sectionPlayers = players.filter((p: Player) => (p.sectionId || null) === (match.sectionId || null));

  const isDoubleElim = tournament.isDoubleElimination;
  // Bracket size based on section players
  const bracketSize = Math.pow(2, Math.ceil(Math.log2(sectionPlayers.length || 2)));
  const totalWBRounds = Math.log2(bracketSize);

  if (match.bracketType === 'winners') {
    if (match.round === totalWBRounds) {
      // WB Final -> Winner goes to Grand Final, Loser goes to LB Final
      const gfMatch = allMatches.find(m => m.bracketType === 'grand_final' && m.round === 1);
      if (gfMatch) {
        await storage.updateMatch(gfMatch.id, { whitePlayerId: winnerId });
      }

      if (isDoubleElim) {
        const loserId = winnerId === match.whitePlayerId ? match.blackPlayerId : match.whitePlayerId;
        const finalLBRound = (totalWBRounds - 1) * 2;
        const lbFinal = allMatches.find(m => m.bracketType === 'losers' && m.round === finalLBRound);
        if (lbFinal) {
          await storage.updateMatch(lbFinal.id, { blackPlayerId: loserId });
        }
      }
    } else {
      // Regular WB advancement
      const nextRound = match.round + 1;
      const nextBoard = Math.ceil((match.board || 1) / 2);
      const isWhite = (match.board || 1) % 2 === 1;

      const nm = allMatches.find((m: any) =>
        m.round === nextRound &&
        m.board === nextBoard &&
        m.bracketType === 'winners' &&
        (m.sectionId || null) === (match.sectionId || null)
      );

      if (nm) {
        await storage.updateMatch(nm.id, { [isWhite ? 'whitePlayerId' : 'blackPlayerId']: winnerId });
      }

      if (isDoubleElim) {
        const loserId = winnerId === match.whitePlayerId ? match.blackPlayerId : match.whitePlayerId;
        if (loserId) {
          if (match.round === 1) {
            const lbBoard = Math.ceil((match.board || 1) / 2);
            const isWhiteLB = (match.board || 1) % 2 === 1;
            const lbMatch = allMatches.find(m => m.bracketType === 'losers' && m.round === 1 && m.board === lbBoard);
            if (lbMatch) {
              await storage.updateMatch(lbMatch.id, { [isWhiteLB ? 'whitePlayerId' : 'blackPlayerId']: loserId });
            }
          } else {
            const lbRound = 2 * (match.round - 1);
            const lbMatch = allMatches.find(m => m.bracketType === 'losers' && m.round === lbRound && m.board === match.board);
            if (lbMatch) {
              await storage.updateMatch(lbMatch.id, { blackPlayerId: loserId });
            }
          }
        }
      }
    }
  } else if (match.bracketType === 'losers') {
    const totalLBRounds = (totalWBRounds - 1) * 2;
    if (match.round === totalLBRounds) {
      const gfMatch = allMatches.find(m => m.bracketType === 'grand_final' && m.round === 1);
      if (gfMatch) {
        await storage.updateMatch(gfMatch.id, { blackPlayerId: winnerId });
      }
    } else {
      if (match.round % 2 === 1) {
        const nextRound = match.round + 1;
        const nm = allMatches.find(m => m.bracketType === 'losers' && m.round === nextRound && m.board === match.board);
        if (nm) {
          await storage.updateMatch(nm.id, { whitePlayerId: winnerId });
        }
      } else {
        const nextRound = match.round + 1;
        const nextBoard = Math.ceil((match.board || 1) / 2);
        const isWhite = (match.board || 1) % 2 === 1;
        const nm = allMatches.find(m => m.bracketType === 'losers' && m.round === nextRound && m.board === nextBoard);
        if (nm) {
          await storage.updateMatch(nm.id, { [isWhite ? 'whitePlayerId' : 'blackPlayerId']: winnerId });
        }
      }
    }
  }
}

