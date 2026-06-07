import type { Tournament, Player, Match, Pairing } from "@shared/schema";
import type { TournamentConfig } from "@shared/tournament-config";
import { normalizeMatchResult } from "@shared/match-results";
import type { FideDirectoryEntry } from "./fideDirectory";
import { resolveFederationCode } from "./fideUtils";

interface GenerateTrf16Options {
  tournament: Tournament;
  config: TournamentConfig;
  players: Player[];
  matches: Match[];
  pairings: Pairing[];
  fideProfiles?: Map<number, FideDirectoryEntry>;
}

interface PlayerRoundEntry {
  opponentStartNumber: number | null;
  color: "w" | "b" | "-";
  result: string;
  points: number;
}

interface PlayerLinePayload {
  player: Player;
  startNumber: number;
  sex?: string;
  title?: string;
  federationCode: string;
  fideId: string;
  birthDate?: string;
  rating?: number | null;
  totalPoints: number;
  rank: number;
  rounds: PlayerRoundEntry[];
}

function toUpperTrim(value?: string | null): string {
  return value ? value.trim().toUpperCase() : "";
}

function formatDate(value?: string | null): string {
  if (!value) return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (/^\d{4}$/.test(trimmed)) {
    return trimmed;
  }
  if (/^\d{8}$/.test(trimmed)) {
    return `${trimmed.slice(0, 4)}/${trimmed.slice(4, 6)}/${trimmed.slice(6, 8)}`;
  }
  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const year = date.getUTCFullYear();
  const month = `${date.getUTCMonth() + 1}`.padStart(2, "0");
  const day = `${date.getUTCDate()}`.padStart(2, "0");
  return `${year}/${month}/${day}`;
}

function createEmptyRoundEntries(rounds: number): PlayerRoundEntry[] {
  return Array.from({ length: rounds }, () => ({
    opponentStartNumber: null,
    color: "-" as const,
    result: " ",
    points: 0,
  }));
}

function mapMatchResultToTrf(
  rawResult: string | null,
  color: "white" | "black",
  scoring: { win: number; draw: number; loss: number },
): { code: string; points: number } {
  const normalized = normalizeMatchResult(rawResult);
  if (!normalized) {
    return { code: " ", points: 0 };
  }

  switch (normalized) {
    case "1-0":
      return {
        code: color === "white" ? "1" : "0",
        points: color === "white" ? scoring.win : scoring.loss,
      };
    case "0-1":
      return {
        code: color === "white" ? "0" : "1",
        points: color === "white" ? scoring.loss : scoring.win,
      };
    case "1/2-1/2":
      return {
        code: "=",
        points: scoring.draw,
      };
    case "1F-0F":
      return {
        code: color === "white" ? "+" : "-",
        points: color === "white" ? scoring.win : scoring.loss,
      };
    case "0F-1F":
      return {
        code: color === "white" ? "-" : "+",
        points: color === "white" ? scoring.loss : scoring.win,
      };
    case "1F-1F":
      return {
        code: "-",
        points: 0,
      };
    case "0F-0F":
      return {
        code: "Z",
        points: 0,
      };
    case "1-bye":
      return {
        code: "F",
        points: scoring.win,
      };
    case "1/2-bye":
      return {
        code: "H",
        points: scoring.draw,
      };
    case "0-bye":
      return {
        code: "Z",
        points: scoring.loss,
      };
    default:
      return { code: " ", points: 0 };
  }
}

function mapByePairingToTrf(pairing: Pairing): { code: string; points: number } {
  const pointsValue = typeof pairing.points === "number" ? pairing.points : 0;
  const normalizedPoints = pointsValue / 2;
  const byeType = pairing.byeType ?? "";

  if (byeType === "half_point") {
    return { code: "H", points: 0.5 };
  }
  if (byeType === "full_point") {
    return { code: "F", points: 1 };
  }
  if (byeType === "zero_point") {
    return { code: "Z", points: 0 };
  }

  if (normalizedPoints >= 1) {
    return { code: "F", points: 1 };
  }
  if (normalizedPoints >= 0.5) {
    return { code: "H", points: 0.5 };
  }
  return { code: "Z", points: 0 };
}

function buildPlayerLine(entry: PlayerLinePayload, totalRounds: number): string {
  const lineLength = 91 + totalRounds * 10;
  const chars = Array(lineLength).fill(" ");

  function set(from: number, value: string) {
    for (let i = 0; i < value.length; i += 1) {
      const index = from + i;
      if (index < chars.length) {
        chars[index] = value[i];
      }
    }
  }

  chars[0] = "0";
  chars[1] = "0";
  chars[2] = "1";

  set(4, `${entry.startNumber}`.padStart(4, " ").slice(0, 4));

  if (entry.sex && entry.sex.trim()) {
    set(9, entry.sex.trim().charAt(0).toLowerCase());
  }

  if (entry.title && entry.title.trim()) {
    set(10, entry.title.trim().toUpperCase().padEnd(3, " ").slice(0, 3));
  }

  const last = toUpperTrim(entry.player.lastName);
  const first = toUpperTrim(entry.player.firstName);
  const name = [last, first].filter(Boolean).join(", ");
  set(14, name.slice(0, 33).padEnd(33, " "));

  if (typeof entry.rating === "number" && Number.isFinite(entry.rating)) {
    const ratingFormatted = Math.round(entry.rating);
    set(48, `${ratingFormatted}`.padStart(4, " ").slice(0, 4));
  }

  if (entry.federationCode) {
    set(53, entry.federationCode.padEnd(3, " ").slice(0, 3));
  }

  if (entry.fideId) {
    set(57, entry.fideId.padStart(11, "0").slice(0, 11));
  }

  if (entry.birthDate) {
    set(69, entry.birthDate.slice(0, 10).padEnd(10, " "));
  }

  const pointsString = entry.totalPoints.toFixed(1);
  set(80, pointsString.padStart(4, " ").slice(0, 4));

  set(85, `${entry.rank}`.padStart(4, " ").slice(0, 4));

  entry.rounds.forEach((round, index) => {
    const base = 91 + index * 10;
    const opponent = round.opponentStartNumber ?? 0;
    set(base, `${opponent}`.padStart(4, " ").slice(0, 4));
    set(base + 5, round.color);
    set(base + 7, round.result);
  });

  return chars.join("").replace(/\s+$/, "");
}

function assignStartNumbers(players: Player[]): Map<number, number> {
  const sorted = [...players].sort((a, b) => {
    if (typeof a.seed === "number" && typeof b.seed === "number") {
      return a.seed - b.seed;
    }
    if (typeof a.seed === "number") return -1;
    if (typeof b.seed === "number") return 1;
    const ratingDiff = (b.rating ?? 0) - (a.rating ?? 0);
    if (ratingDiff !== 0) return ratingDiff;
    const lastCompare = a.lastName.localeCompare(b.lastName);
    if (lastCompare !== 0) return lastCompare;
    const firstCompare = a.firstName.localeCompare(b.firstName);
    if (firstCompare !== 0) return firstCompare;
    return a.id - b.id;
  });

  const map = new Map<number, number>();
  sorted.forEach((player, index) => {
    map.set(player.id, index + 1);
  });
  return map;
}

function determineTotalRounds(
  config: TournamentConfig,
  tournamentRounds: number | null | undefined,
  matches: Match[],
  pairings: Pairing[],
): number {
  const configRounds = config.details?.rounds ?? 0;
  const declaredRounds = typeof tournamentRounds === "number" ? tournamentRounds : 0;
  const maxMatchRound = matches.reduce((max, match) => Math.max(max, match.round ?? 0), 0);
  const maxPairingRound = pairings.reduce((max, pairing) => Math.max(max, pairing.round ?? 0), 0);
  return Math.max(configRounds, declaredRounds, maxMatchRound, maxPairingRound);
}

function ensureFideId(value?: string | null): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    return "00000000000";
  }
  const digitsOnly = trimmed.replace(/[^0-9]/g, "");
  if (!digitsOnly) {
    return "00000000000";
  }
  return digitsOnly.slice(0, 11).padStart(11, "0");
}

export function generateFideTrf16Report(options: GenerateTrf16Options): { content: string; warnings: string[] } {
  const { tournament, config, players, matches, pairings, fideProfiles } = options;
  const warnings: string[] = [];

  if (players.length === 0) {
    return { content: "", warnings: ["No players registered for this tournament."] };
  }

  const startNumbers = assignStartNumbers(players);
  const totalRounds = determineTotalRounds(config, tournament.rounds, matches, pairings);
  const scoring = config.details?.scoring ?? { win: 1, draw: 0.5, loss: 0 };

  const playerPayloads = players.map((player) => {
    const startNumber = startNumbers.get(player.id) ?? 0;
    return {
      player,
      startNumber,
      sex: undefined as string | undefined,
      title: undefined as string | undefined,
      federationCode: resolveFederationCode(player.federation) || resolveFederationCode(config.basic?.federation),
      fideId: ensureFideId((player as any).fideId ?? null),
      birthDate: undefined as string | undefined,
      rating: player.rating ?? null,
      totalPoints: 0,
      rank: 0,
      rounds: createEmptyRoundEntries(totalRounds),
    } satisfies PlayerLinePayload;
  });

  const unmatchedDirectoryPlayers: string[] = [];

  if (fideProfiles && fideProfiles.size > 0) {
    playerPayloads.forEach((payload) => {
      const entry = fideProfiles.get(payload.player.id);
      if (!entry) {
        unmatchedDirectoryPlayers.push(
          [payload.player.lastName, payload.player.firstName].filter(Boolean).join(", ") || payload.player.id.toString(),
        );
        return;
      }

      if (entry.federation) {
        payload.federationCode = entry.federation.toUpperCase();
      }
      if (entry.sex) {
        payload.sex = entry.sex.toUpperCase();
      }
      if (entry.title) {
        payload.title = entry.title.toUpperCase();
      }
      if (entry.birthDate) {
        payload.birthDate = entry.birthDate;
      }
      payload.fideId = ensureFideId(entry.fideId);
      if (typeof entry.rating === "number" && entry.rating > 0) {
        payload.rating = entry.rating;
      }
    });
  }

  if (unmatchedDirectoryPlayers.length > 0) {
    const sample = unmatchedDirectoryPlayers.slice(0, 5).join("; ");
    const more = unmatchedDirectoryPlayers.length > 5 ? ` (and ${unmatchedDirectoryPlayers.length - 5} more)` : "";
    warnings.push(`Unable to match ${unmatchedDirectoryPlayers.length} player${
      unmatchedDirectoryPlayers.length === 1 ? "" : "s"
    } against FIDE directory: ${sample}${more}`);
  }

  const missingFideIds = playerPayloads.filter((payload) => payload.fideId === "00000000000");
  if (missingFideIds.length > 0) {
    warnings.push(
      `${missingFideIds.length} player${missingFideIds.length === 1 ? "" : "s"} missing FIDE ID; exported with placeholder values`,
    );
  }

  const missingFederations = playerPayloads.filter((payload) => !payload.federationCode);
  if (missingFederations.length > 0) {
    warnings.push(
      `${missingFederations.length} player${missingFederations.length === 1 ? "" : "s"} missing federation code`,
    );
  }

  const payloadByPlayerId = new Map<number, PlayerLinePayload>();
  playerPayloads.forEach((payload) => {
    payloadByPlayerId.set(payload.player.id, payload);
  });

  matches.forEach((match) => {
    if (!match.round || match.round <= 0) return;
    const roundIndex = match.round - 1;
    if (roundIndex >= totalRounds) return;

    if (match.whitePlayerId) {
      const whitePayload = payloadByPlayerId.get(match.whitePlayerId);
      if (whitePayload) {
        const mapping = mapMatchResultToTrf(match.result ?? null, "white", scoring);
        const rounds = whitePayload.rounds;
        const entry = rounds[roundIndex];
        entry.opponentStartNumber = match.blackPlayerId ? startNumbers.get(match.blackPlayerId) ?? 0 : 0;
        entry.color = "w";
        entry.result = mapping.code;
        entry.points = mapping.points;
        whitePayload.totalPoints += mapping.points;
      }
    }

    if (match.blackPlayerId) {
      const blackPayload = payloadByPlayerId.get(match.blackPlayerId);
      if (blackPayload) {
        const mapping = mapMatchResultToTrf(match.result ?? null, "black", scoring);
        const rounds = blackPayload.rounds;
        const entry = rounds[roundIndex];
        entry.opponentStartNumber = match.whitePlayerId ? startNumbers.get(match.whitePlayerId) ?? 0 : 0;
        entry.color = "b";
        entry.result = mapping.code;
        entry.points = mapping.points;
        blackPayload.totalPoints += mapping.points;
      }
    }
  });

  pairings.forEach((pairing) => {
    if (!pairing.isBye) return;
    if (!pairing.playerId) return;
    if (!pairing.round || pairing.round <= 0) return;
    const payload = payloadByPlayerId.get(pairing.playerId);
    if (!payload) return;
    const roundIndex = pairing.round - 1;
    if (roundIndex >= payload.rounds.length) return;
    const existing = payload.rounds[roundIndex];
    if (existing.result.trim()) {
      return;
    }
    const mapping = mapByePairingToTrf(pairing);
    existing.opponentStartNumber = null;
    existing.color = "-";
    existing.result = mapping.code;
    existing.points = mapping.points;
    payload.totalPoints += mapping.points;
  });

  const sortedByPoints = [...playerPayloads].sort((a, b) => {
    if (b.totalPoints !== a.totalPoints) return b.totalPoints - a.totalPoints;
    const ratingDiff = (b.rating ?? 0) - (a.rating ?? 0);
    if (ratingDiff !== 0) return ratingDiff;
    return a.startNumber - b.startNumber;
  });

  sortedByPoints.forEach((payload, index) => {
    payload.rank = index + 1;
  });

  const tournamentLines: string[] = [];
  
  // Detect if all players belong to a single section to append section name to the TRF header
  const sectionNames = Array.from(new Set(players.map((p) => p.sectionName).filter(Boolean)));
  const sectionName = sectionNames.length === 1 ? sectionNames[0] : "";
  const baseName = config.basic?.name || tournament.name || "";
  const tournamentName = sectionName ? `${baseName} - ${sectionName}` : baseName;
  
  tournamentLines.push(`012 ${tournamentName}`.trimEnd());

  const city = config.basic?.city || tournament.location || "";
  if (city) {
    tournamentLines.push(`022 ${city}`.trimEnd());
  }

  const federationCode = resolveFederationCode(config.basic?.federation);
  if (federationCode) {
    tournamentLines.push(`032 ${federationCode}`);
  }

  const startDate = formatDate(config.basic?.startDate);
  if (startDate) {
    tournamentLines.push(`042 ${startDate}`);
  }

  const endDate = formatDate(config.basic?.endDate);
  if (endDate) {
    tournamentLines.push(`052 ${endDate}`);
  }

  tournamentLines.push(`062 ${players.length}`);
  tournamentLines.push(`072 ${players.length}`);

  // 092 Type of Tournament
  const pairingSystem = config.details?.pairingSystem || (tournament.format === "roundrobin" ? "Round Robin" : "Swiss System");
  tournamentLines.push(`092 Individual ${pairingSystem}`);

  // 102 Chief Arbiter
  const chiefArbiterName = config.fide?.chiefArbiter || config.details?.chiefArbiter || "";
  const chiefArbiterId = (config.fide as any)?.chiefArbiterId || "";
  const chiefArbiterTitle = (config.fide as any)?.chiefArbiterTitle || "";
  
  if (chiefArbiterName) {
    let chiefArbiterLine = chiefArbiterName;
    if (chiefArbiterTitle) chiefArbiterLine = `${chiefArbiterTitle} ${chiefArbiterLine}`;
    if (chiefArbiterId) chiefArbiterLine = `${chiefArbiterLine} (${chiefArbiterId})`;
    tournamentLines.push(`102 ${chiefArbiterLine}`.trimEnd());
  }

  // 112 Deputy Chief Arbiter(s)
  const deputyArbiters = new Set<string>();
  const primaryDeputy = config.fide?.arbiterSurname || "";
  if (primaryDeputy.trim()) {
    deputyArbiters.add(primaryDeputy.trim());
  }
  const assistantsStr = config.fide?.assistants || "";
  if (assistantsStr.trim()) {
    assistantsStr.split(",").forEach((name) => {
      const trimmed = name.trim();
      if (trimmed) deputyArbiters.add(trimmed);
    });
  } else if (config.details?.assistantTDs && config.details.assistantTDs.length > 0) {
    config.details.assistantTDs.forEach((name) => {
      const trimmed = name.trim();
      if (trimmed) deputyArbiters.add(trimmed);
    });
  }
  deputyArbiters.forEach((name) => {
    tournamentLines.push(`112 ${name}`);
  });

  // 122 Allotted times per moves/game (Time Control)
  const timeControl = config.fide?.timeControl || "";
  let timeControlStr = timeControl.trim();
  if (!timeControlStr && config.details?.timeControls && config.details.timeControls.length > 0) {
    const tc = config.details.timeControls[0];
    timeControlStr = tc.addonValue
      ? `${tc.minutes} min + ${tc.addonValue}s increment`
      : `${tc.minutes} min`;
  }
  if (timeControlStr) {
    tournamentLines.push(`122 ${timeControlStr}`);
  }

  if (totalRounds > 0) {
    const roundDates: string[] = [];
    for (let round = 1; round <= totalRounds; round += 1) {
      const scheduleEntry = config.schedule?.find((event) => event.round === round && event.date);
      const formatted = formatDate(scheduleEntry?.date ?? null);
      if (formatted) {
        roundDates.push(`R${round}: ${formatted}`);
      }
    }
    if (roundDates.length > 0) {
      tournamentLines.push(`132 ${roundDates.join("  ")}`.trimEnd());
    }
  }

  const playerLines = playerPayloads
    .sort((a, b) => a.startNumber - b.startNumber)
    .map((payload) => buildPlayerLine(payload, totalRounds));

  const content = [...tournamentLines, ...playerLines].map((line) => `${line}\r`).join("\n");

  return { content, warnings };
}
