export type MatchResultCode =
  | "Pending"
  | "1-0"
  | "0-1"
  | "1/2-1/2"
  | "1F-0F"
  | "0F-1F"
  | "1F-1F"
  | "0F-0F"
  | "1-0U"
  | "0-1U"
  | "1/2-1/2U"
  | "1F-0FU"
  | "0F-1FU"
  | "1F-1FU"
  | "0F-0FU"
  | "1-bye"
  | "1-byeU"
  | "1/2-bye"
  | "1/2-byeU"
  | "0-bye"
  | "0-byeU";

export const HEAD_TO_HEAD_RESULT_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "1-0", label: "1-0 (White win)" },
  { value: "0-1", label: "0-1 (Black win)" },
  { value: "1/2-1/2", label: "½-½ (Draw)" },
  { value: "1F-0F", label: "1F-0F (White forfeit win)" },
  { value: "0F-1F", label: "0F-1F (Black forfeit win)" },
  { value: "1F-1F", label: "1F-1F (Double forfeit)" },
  { value: "0F-0F", label: "0F-0F (No result)" },
  { value: "1-0U", label: "1-0U (White win, unrated)" },
  { value: "0-1U", label: "0-1U (Black win, unrated)" },
  { value: "1/2-1/2U", label: "½-½U (Draw, unrated)" },
  { value: "1F-0FU", label: "1F-0FU (White forfeit win, unrated)" },
  { value: "0F-1FU", label: "0F-1FU (Black forfeit win, unrated)" },
  { value: "1F-1FU", label: "1F-1FU (Double forfeit, unrated)" },
  { value: "0F-0FU", label: "0F-0FU (No result, unrated)" },
];

export const BYE_RESULT_OPTIONS: Array<{ value: string; label: string }> = [
  ...HEAD_TO_HEAD_RESULT_OPTIONS,
  { value: "1-bye", label: "1-point bye" },
  { value: "1/2-bye", label: "1/2-point bye" },
  { value: "0-bye", label: "0-point bye" },
  { value: "1-byeU", label: "1-point bye (unrated)" },
  { value: "1/2-byeU", label: "1/2-point bye (unrated)" },
  { value: "0-byeU", label: "0-point bye (unrated)" },
];

const LEGACY_RESULT_MAP: Record<string, string> = {
  white_wins: "1-0",
  black_wins: "0-1",
  draw: "1/2-1/2",
  bye: "1-bye",
  "1-0F": "1F-0F",
  "0-1F": "0F-1F",
  "0-0F": "0F-0F",
};

export function normalizeMatchResult(result: string | null | undefined): string | null {
  if (!result) {
    return null;
  }
  let clean = result.trim().toUpperCase().replace(/\s+/g, '');
  if (!clean || clean === "PENDING" || clean === "*") {
    return null;
  }

  const isUnrated = clean.endsWith("U");
  if (isUnrated) {
    clean = clean.slice(0, -1);
  }

  let mapped = LEGACY_RESULT_MAP[clean] ?? clean;
  if (clean === "1-0" || clean === "1-O" || clean === "1F-0" || clean === "1-0F" || clean === "1F-0F") {
    mapped = clean.includes("F") ? "1F-0F" : "1-0";
  } else if (clean === "0-1" || clean === "O-1" || clean === "0-1F" || clean === "0F-1" || clean === "0F-1F") {
    mapped = clean.includes("F") ? "0F-1F" : "0-1";
  } else if (clean === "1/2-1/2" || clean === "0.5-0.5" || clean === "1/2" || clean === "½" || clean === "½-½" || clean === "DRAW") {
    mapped = "1/2-1/2";
  } else if (clean === "0-0" || clean === "0-0F" || clean === "0F-0" || clean === "0F-0F") {
    mapped = "0F-0F";
  } else if (clean === "1F-1F" || clean === "1-1F") {
    mapped = "1F-1F";
  } else if (clean === "1-BYE" || clean === "BYE" || clean === "1BYE") {
    mapped = "1-bye";
  } else if (clean === "1/2-BYE" || clean === "1/2BYE" || clean === "HALF-BYE" || clean === "HALFPOINTBYE" || clean === "0.5-BYE") {
    mapped = "1/2-bye";
  } else if (clean === "0-BYE" || clean === "0BYE" || clean === "ZERO-BYE" || clean === "ZEROPOINTBYE") {
    mapped = "0-bye";
  }

  return isUnrated ? `${mapped}U` : mapped;
}

const RESULT_POINTS: Record<string, { white: number; black: number }> = {
  "1-0": { white: 1, black: 0 },
  "0-1": { white: 0, black: 1 },
  "1/2-1/2": { white: 0.5, black: 0.5 },
  "1F-0F": { white: 1, black: 0 },
  "0F-1F": { white: 0, black: 1 },
  "1F-1F": { white: 0, black: 0 },
  "0F-0F": { white: 0, black: 0 },
  "1-bye": { white: 1, black: 0 },
  "1/2-bye": { white: 0.5, black: 0 },
  "0-bye": { white: 0, black: 0 },
};

export function getPointsForResult(
  result: string | null | undefined,
  color: "white" | "black",
): number {
  const normalized = normalizeMatchResult(result);
  if (!normalized) {
    return 0;
  }
  const base = normalized.endsWith("U") ? normalized.slice(0, -1) : normalized;
  const entry = RESULT_POINTS[base];
  if (!entry) {
    return 0;
  }
  return entry[color];
}

export function getResultSummary(
  result: string | null | undefined,
): { whitePoints: number; blackPoints: number } {
  return {
    whitePoints: getPointsForResult(result, "white"),
    blackPoints: getPointsForResult(result, "black"),
  };
}

export function isForfeitResult(result: string | null | undefined): boolean {
  const normalized = normalizeMatchResult(result);
  if (!normalized) return false;
  const base = normalized.endsWith("U") ? normalized.slice(0, -1) : normalized;
  return base === "1F-0F" || base === "0F-1F" || base === "1F-1F" || base === "0F-0F";
}
