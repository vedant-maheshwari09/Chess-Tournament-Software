import { searchUSCF, searchFide, type LocalRatingResult, type LocalSearchParams } from './localRatings';

export type RatingSource = "uscf" | "fide";

export interface RatingLookupResult {
  source: RatingSource;
  id: string;
  name: string;
  rating?: string;
  ratingDisplay?: string;
  ratingRaw?: string;
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

export function parseUscfGamesPlayed(raw: string | null | undefined): number {
  if (!raw) return 25; // Default to established if no raw rating
  const trimmed = raw.trim();
  if (!trimmed) return 25;
  const slashIndex = trimmed.indexOf("/");
  if (slashIndex !== -1) {
    const gamesPart = trimmed.slice(slashIndex + 1).replace(/\D/g, "");
    const games = parseInt(gamesPart, 10);
    return Number.isFinite(games) ? games : 25;
  }
  return 25; // Established if no slash
}

export async function lookupUSCF(params: LocalSearchParams, limit = 30, threshold = 4): Promise<RatingLookupResult[]> {
  const results = await searchUSCF(params, limit);
  return results.map((entry) => mapLocalResult("uscf", entry, threshold));
}

export async function lookupFide(params: LocalSearchParams, limit = 30): Promise<RatingLookupResult[]> {
  const results = await searchFide(params, limit);
  return results.map((entry) => mapLocalResult("fide", entry));
}

export function mapLocalResult(source: RatingSource, entry: LocalRatingResult, threshold = 4): RatingLookupResult {
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

  let rating: string | undefined = entry.rating?.value;
  let ratingDisplay: string | undefined = entry.rating?.raw ?? entry.rating?.value;

  if (source === "uscf" && entry.rating?.value) {
    const rawVal = entry.rating.raw ?? entry.rating.value;
    const games = parseUscfGamesPlayed(rawVal);
    if (games < threshold) {
      rating = undefined;
      ratingDisplay = "Unrated";
    } else if (games < 25) {
      rating = entry.rating.value;
      ratingDisplay = `${entry.rating.value}p`;
    } else {
      rating = entry.rating.value;
      ratingDisplay = entry.rating.value;
    }
  }

  return {
    source,
    id: entry.id,
    name: entry.name,
    rating,
    ratingDisplay,
    ratingRaw: entry.rating?.raw ?? entry.rating?.value,
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
