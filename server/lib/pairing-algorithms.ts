import { storage } from '../storage';
import { parseTournamentConfig } from "@shared/tournament-config";
import { getPointsForResult } from "@shared/match-results";

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

    const applicableGap = gaps.find((g) => g.afterBoard === currentBoard);
    if (applicableGap) {
      currentBoard += applicableGap.skip;
    }

    currentBoard += increment;
  }
  return sequence;
}

export async function generatePairings(
  tournament: any,
  players: any[],
  matches: any[],
  existingPairings: any[],
  round: number,
  boardNumbers?: number[]
) {
  const pairings = [];

  if (tournament.format === 'swiss') {
    const swissPairings = await generateSwissPairings(tournament, players, matches, round, existingPairings, boardNumbers);

    for (const pairing of swissPairings) {
      if (pairing.isBye) {
        const byePoints = pairing.byeType === 'half_point' ? 1 : 2;
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
          result: '1-0',
          status: 'completed',
          isBye: true,
        });
      } else {
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
    console.log('Round Robin tournament - pairings should be pre-generated');
    return [];
  }

  return pairings;
}

export function groupPlayersByScore(playerStats: any[], tournament: any): any[][] {
  const groups: { [score: string]: any[] } = {};

  for (const player of playerStats) {
    const score = player.points.toString();
    if (!groups[score]) {
      groups[score] = [];
    }
    groups[score].push(player);
  }

  return Object.keys(groups)
    .sort((a, b) => parseFloat(b) - parseFloat(a))
    .map(score => groups[score].sort((a, b) => {
      const tournamentConfig = parseTournamentConfig(tournament);
      const isFide = tournamentConfig.details.primaryRatingSystem === 'fide';
      const ratingA = (isFide ? (a.player.fideRating ?? a.player.rating) : (a.player.uscfRating ?? a.player.rating)) || 0;
      const ratingB = (isFide ? (b.player.fideRating ?? b.player.rating) : (b.player.uscfRating ?? b.player.rating)) || 0;
      const ratingDiff = ratingB - ratingA;
      if (ratingDiff !== 0) return ratingDiff;

      const firstNameCmp = (a.player.firstName || '').localeCompare(b.player.firstName || '');
      if (firstNameCmp !== 0) return firstNameCmp;

      const lastNameCmp = (a.player.lastName || '').localeCompare(b.player.lastName || '');
      if (lastNameCmp !== 0) return lastNameCmp;

      return a.player.id - b.player.id;
    }));
}

export function pairUpperVsLowerHalf(scoreGroup: any[], matches: any[], round: number, tournament: any): { paired: any[][], unpaired: any[] } {
  const paired: any[][] = [];
  const unpaired: any[] = [];

  if (scoreGroup.length < 2) {
    return { paired, unpaired: [...scoreGroup] };
  }

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

  const maxPairs = Math.min(upperHalf.length, lowerHalf.length);

  for (let i = 0; i < maxPairs; i++) {
    const upperPlayer = upperHalf[i];
    let pairedLowerPlayer = null;
    let pairedIndex = -1;

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
      lowerHalf.splice(pairedIndex, 1);
    } else {
      unpaired.push(upperPlayer);
    }
  }

  unpaired.push(...upperHalf.slice(maxPairs), ...lowerHalf);

  return { paired, unpaired };
}

export function determineSwissColors(player1: any, player2: any, tournament: any): { whitePlayer: any, blackPlayer: any } {
  const p1Stats = player1.player ? player1 : { colorBalance: 0, whiteGames: 0, blackGames: 0 };
  const p2Stats = player2.player ? player2 : { colorBalance: 0, whiteGames: 0, blackGames: 0 };

  const p1Balance = p1Stats.colorBalance;
  const p2Balance = p2Stats.colorBalance;

  if (p1Balance >= 2) {
    console.log(`  ${p1Stats.player?.firstName || 'Player1'} must get black (has +${p1Balance} color balance)`);
    return { whitePlayer: p2Stats.player, blackPlayer: p1Stats.player };
  }

  if (p1Balance <= -2) {
    console.log(`  ${p1Stats.player?.firstName || 'Player1'} must get white (has ${p1Balance} color balance)`);
    return { whitePlayer: p1Stats.player, blackPlayer: p2Stats.player };
  }

  if (p2Balance >= 2) {
    console.log(`  ${p2Stats.player?.firstName || 'Player2'} must get black (has +${p2Balance} color balance)`);
    return { whitePlayer: p1Stats.player, blackPlayer: p2Stats.player };
  }

  if (p2Balance <= -2) {
    console.log(`  ${p2Stats.player?.firstName || 'Player2'} must get white (has ${p2Balance} color balance)`);
    return { whitePlayer: p2Stats.player, blackPlayer: p1Stats.player };
  }

  if (p1Balance < p2Balance) {
    console.log(`  ${p1Stats.player?.firstName || 'Player1'} gets white (better balance: ${p1Balance} vs ${p2Balance})`);
    return { whitePlayer: p1Stats.player, blackPlayer: p2Stats.player };
  } else if (p2Balance < p1Balance) {
    console.log(`  ${p2Stats.player?.firstName || 'Player2'} gets white (better balance: ${p2Balance} vs ${p1Balance})`);
    return { whitePlayer: p2Stats.player, blackPlayer: p1Stats.player };
  } else {
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
    return firstNameCmp < 0;
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
  primaryRatingSystem: string,
  nonPairings?: [number, number][],
  colorTranspositionLimitPts?: number
): ('p1_white_p2_black' | 'p1_black_p2_white')[] {
  if (!allowRepeats && p1.opponents.has(p2.id)) {
    return [];
  }

  // US Chess Rule 28T – Non-Pairing Requests
  if (nonPairings) {
    for (const [a, b] of nonPairings) {
      if ((a === p1.id && b === p2.id) || (a === p2.id && b === p1.id)) {
        return [];
      }
    }
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

  // US Chess Rule 29E5 – Color Transposition Limit
  // If the rating difference between the higher-rated player and the lower-rated player exceeds
  // colorTranspositionLimitPts (200 pts for balance swaps, 80 pts for due-color swaps),
  // we cannot give the higher-rated player the color they are not due.
  // This enforces that color preferences of lower-rated players cannot override those of much higher-rated players.
  if (colorTranspositionLimitPts !== undefined && colorTranspositionLimitPts > 0) {
    const p1Rating = getPlayerRating(p1.player, primaryRatingSystem);
    const p2Rating = getPlayerRating(p2.player, primaryRatingSystem);
    const ratingDiff = Math.abs(p1Rating - p2Rating);
    if (ratingDiff >= colorTranspositionLimitPts) {
      // Determine who is higher rated
      const higherIsP1 = p1Rating >= p2Rating;
      const higherStats = higherIsP1 ? p1 : p2;
      const higherBalance = higherStats.colorBalance;
      // Higher-rated player's due color preference must be respected
      if (higherBalance > 0) {
        // Higher-rated is due black
        if (higherIsP1) p1WhiteOk = false;
        else p2BlackOk = false;
      } else if (higherBalance < 0) {
        // Higher-rated is due white
        if (!higherIsP1) p2BlackOk = false;
        // When p2 must be white, p1 can only be black
      }
    }
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
  primaryRatingSystem: string,
  nonPairings?: [number, number][]
): boolean {
  if (unpairedList.length === 0) {
    return true;
  }

  const p1 = unpairedList[0];

  for (let i = 1; i < unpairedList.length; i++) {
    const p2 = unpairedList[i];

    const colorOptions = getValidColorAssignments(p1, p2, strictColors, allowRepeats, primaryRatingSystem, nonPairings);
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

      if (backtrack(remaining, currentPairings, strictColors, allowRepeats, boardNumbers, boardIdx + 1, primaryRatingSystem, nonPairings)) {
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
  /** US Chess Rule 28R1: Accelerated pairings in rounds 1-2 */
  const acceleratedPairings = tournamentConfig.details.acceleratedPairings === true;
  /** US Chess Rule 28T: Non-pairing requests */
  const nonPairings: [number, number][] = tournamentConfig.details.nonPairings ?? [];

  if (round === 1) {
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
      // Lowest-rated / unrated gets the bye
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

    if (acceleratedPairings) {
      // US Chess Rule 28R1: In round 1 with accelerated pairings, pair upper half vs upper half
      // and lower half vs lower half (top-vs-top, bottom-vs-bottom).
      // This means board 1 = player 1 vs player 2, board 2 = player 3 vs player 4, etc.
      console.log(`  [Accelerated Pairings] Round 1: top-vs-top, bottom-vs-bottom pairing`);
      const allPlayers = byePlayer
        ? sortedPlayers.filter(p => p.id !== byePlayer.id)
        : [...sortedPlayers];

      for (let i = 0; i < allPlayers.length - 1; i += 2) {
        const p1 = allPlayers[i];
        const p2 = allPlayers[i + 1];
        const coinFlip = Math.random() < 0.5;
        pairings.push({
          whitePlayerId: coinFlip ? p1.id : p2.id,
          blackPlayerId: coinFlip ? p2.id : p1.id,
          board: resolvedBoardNumbers[Math.floor(i / 2)],
          isBye: false,
        });
      }
    } else {
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
        if (pairing.round < round && pairing.playerId === player.id && pairing.isBye) {
          byesReceived++;
        }
      }
      for (const m of playerMatches) {
        if (m.round < round && m.status === 'completed') {
          const isWhite = m.whitePlayerId === player.id;
          if (m.result === '1F-0F' && isWhite) {
            byesReceived++;
          } else if (m.result === '0F-1F' && !isWhite) {
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
        } else {
          consecutiveColor = 0;
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

    const isOdd = playerStatsList.length % 2 === 1;
    let byePlayerStats: PlayerStats | null = null;
    let candidatesForBye = [...playerStatsList];

    if (isOdd) {
      candidatesForBye.sort((a, b) => {
        if (a.byesReceived !== b.byesReceived) return a.byesReceived - b.byesReceived;
        if (a.points !== b.points) return a.points - b.points;
        return getPlayerRating(a.player, primaryRatingSystem) - getPlayerRating(b.player, primaryRatingSystem);
      });

      byePlayerStats = candidatesForBye[0];
      console.log(`Assigned round bye to: ${byePlayerStats.player.firstName} ${byePlayerStats.player.lastName} (ID: ${byePlayerStats.id}) with ${byePlayerStats.points} pts.`);
    }

    const playersToPair = byePlayerStats
      ? playerStatsList.filter(p => p.id !== byePlayerStats!.id)
      : playerStatsList;

    // US Chess Rule 28R1: Assign virtual accelerated points for rounds 1-2
    if (acceleratedPairings && round <= 2) {
      const allForRating = [...playerStatsList].sort((a, b) => {
        const rA = getPlayerRating(a.player, primaryRatingSystem);
        const rB = getPlayerRating(b.player, primaryRatingSystem);
        return rB - rA;
      });
      const topHalfCount = Math.ceil(allForRating.length / 2);
      const topHalfIds = new Set(allForRating.slice(0, topHalfCount).map(p => p.id));
      for (const ps of playerStatsList) {
        (ps as any).acceleratedPoints = ps.points + (topHalfIds.has(ps.id) ? 1.0 : 0);
      }
      console.log(`  [Accelerated Pairings] Round ${round}: Added virtual point to top ${topHalfCount} players.`);
    }

    const sortedPlayersToPair = [...playersToPair].sort((a, b) => {
      // US Chess Rule 28R1: For rounds 1 and 2 with accelerated pairings, add 1.0 virtual
      // point to players in the upper half (by rating) for pairing purposes.
      const aVirtual = (acceleratedPairings && round <= 2) ? (a as any).acceleratedPoints ?? a.points : a.points;
      const bVirtual = (acceleratedPairings && round <= 2) ? (b as any).acceleratedPoints ?? b.points : b.points;
      if (aVirtual !== bVirtual) return bVirtual - aVirtual;
      const ratingA = getPlayerRating(a.player, primaryRatingSystem);
      const ratingB = getPlayerRating(b.player, primaryRatingSystem);
      if (ratingB !== ratingA) return ratingB - ratingA;
      const nameA = `${a.player.firstName || ''} ${a.player.lastName || ''}`;
      const nameB = `${b.player.firstName || ''} ${b.player.lastName || ''}`;
      if (nameA !== nameB) return nameA.localeCompare(nameB);
      return a.id - b.id;
    });

    const scoreGroups = groupPlayersByScore(sortedPlayersToPair, tournament);

    let unpaired: PlayerStats[] = [];
    const tempPairings: any[] = [];
    const numBoards = Math.floor(playerStatsList.length / 2) + (isOdd ? 1 : 0);
    const resolvedBoardNumbers = boardNumbers ?? generateBoardNumberSequence(tournament.boardNumberingSettings, numBoards);

    let boardIdx = 0;
    for (const group of scoreGroups) {
      const combinedList = [...unpaired, ...group];
      const pairingResult = pairUpperVsLowerHalf(combinedList, matches, round, tournament);

      for (const pair of pairingResult.paired) {
        const p1 = pair[0];
        const p2 = pair[1];

        const colorAssignments = getValidColorAssignments(p1, p2, true, false, primaryRatingSystem, nonPairings);
        if (colorAssignments.length > 0) {
          const whitePlayer = colorAssignments[0] === 'p1_white_p2_black' ? p1 : p2;
          const blackPlayer = colorAssignments[0] === 'p1_white_p2_black' ? p2 : p1;
          tempPairings.push({
            whitePlayerId: whitePlayer.id,
            blackPlayerId: blackPlayer.id,
            board: resolvedBoardNumbers[boardIdx++],
            isBye: false,
          });
        } else {
          pairingResult.unpaired.push(p1, p2);
        }
      }
      unpaired = pairingResult.unpaired;
    }

    if (unpaired.length > 0) {
      console.log(`Strict search failed to pair ${unpaired.length} players. Initiating backtracking search...`);
      const totalBoardsNeeded = Math.floor(sortedPlayersToPair.length / 2);
      const boardsForBacktrack = resolvedBoardNumbers.slice(0, totalBoardsNeeded);
      const backtrackPairings: any[] = [];

      let found = backtrack(sortedPlayersToPair, backtrackPairings, true, false, boardsForBacktrack, 0, primaryRatingSystem, nonPairings);
      if (!found) {
        console.log("Strict backtracking failed. Relaxing strict color constraints...");
        backtrackPairings.length = 0;
        found = backtrack(sortedPlayersToPair, backtrackPairings, false, false, boardsForBacktrack, 0, primaryRatingSystem, nonPairings);
      }
      if (!found) {
        console.log("Color relaxed backtracking failed. Allowing repeat matchups...");
        backtrackPairings.length = 0;
        found = backtrack(sortedPlayersToPair, backtrackPairings, false, true, boardsForBacktrack, 0, primaryRatingSystem, nonPairings);
      }

      if (found) {
        pairings.push(...backtrackPairings);
      } else {
        console.error("CRITICAL: Backtracking was unable to find any valid pairings!");
        pairings.push(...tempPairings);
      }
    } else {
      pairings.push(...tempPairings);
    }

    if (isOdd && byePlayerStats) {
      pairings.push({
        whitePlayerId: byePlayerStats.id,
        blackPlayerId: null,
        board: resolvedBoardNumbers[numBoards - 1],
        isBye: true,
        byeType: 'full_point',
      });
    }
  }

  return pairings;
}
