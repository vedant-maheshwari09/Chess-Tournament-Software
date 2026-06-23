import { storage } from '../storage';
import { type Match, type Player } from "@shared/schema";
import {
  parseTournamentConfig,
  calculateMatchupScore,
  getMatchFormat,
  type MatchFormat
} from "@shared/tournament-config";

export function isMatchDecided(
  score: { p1Score: number; p2Score: number; p1Id: number | null; p2Id: number | null },
  format: MatchFormat,
  lastMatch: any
): { decided: boolean; winnerId: number | null } {
  const thresholds = format.thresholds || [1.5];

  for (const threshold of thresholds) {
    const t = threshold === "armageddon" ? Infinity : Number(threshold);

    if (threshold === "armageddon") {
      if (lastMatch.result === '1-0' || lastMatch.result === '1-0F') return { decided: true, winnerId: lastMatch.whitePlayerId };
      if (lastMatch.result === '0-1' || lastMatch.result === '0-1F') return { decided: true, winnerId: lastMatch.blackPlayerId };
      if (lastMatch.result === '1/2-1/2') {
        return { decided: true, winnerId: lastMatch.blackPlayerId };
      }
      continue;
    }

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

    console.log(`[VICTORY PROTOCOL] Threshold ${t} not yet reached (Current: ${score.p1Score}-${score.p2Score}). Series continues.`);
    return { decided: false, winnerId: null };
  }

  return { decided: false, winnerId: null };
}

export async function spawnNextMatchupGame(tournamentId: number, lastMatch: Match, matchupGames: Match[]) {
  const tournament = await storage.getTournament(tournamentId);
  if (!tournament) return;

  const config = parseTournamentConfig(tournament);
  const format = getMatchFormat(config, lastMatch.round, lastMatch.bracketType || undefined);
  const score = calculateMatchupScore(matchupGames);

  const decision = isMatchDecided(score, format, lastMatch);
  if (decision.decided) {
    console.log(`[DEBUG] spawnNextMatchupGame: Match series ALREADY DECIDED (Winner: ${decision.winnerId}). Skipping spawn.`);
    return;
  }

  const existingUpcoming = matchupGames.find(m => (m.gameNumber || 1) > (lastMatch.gameNumber || 0));
  if (existingUpcoming) {
    console.log(`[DEBUG] spawnNextMatchupGame: A subsequent game ${existingUpcoming.gameNumber} already exists (ID: ${existingUpcoming.id}). Skipping spawn.`);
    return;
  }

  console.log(`[DEBUG] spawnNextMatchupGame: Checking potential spawn. Games played: ${matchupGames.length}, Thresholds: ${JSON.stringify(format.thresholds)}, Current Score: P1=${score.p1Score}, P2=${score.p2Score}`);

  let nextGameType = 'standard';
  const currentMaxGameNumber = Math.max(...matchupGames.map(m => m.gameNumber || 1), 0);
  const nextGameNumber = currentMaxGameNumber + 1;

  const maxStandardGames = format.games || 2;

  if (matchupGames.length < maxStandardGames) {
    console.log(`[DEBUG] spawnNextMatchupGame: Spawning standard game ${nextGameNumber} (Game ${matchupGames.length + 1} of ${maxStandardGames})`);
  } else {
    if (score.p1Score === score.p2Score && format.thresholds.includes('armageddon')) {
      nextGameType = 'armageddon';
      console.log(`[DEBUG] spawnNextMatchupGame: Series tied at ${score.p1Score}-${score.p2Score}. Spawning Armageddon!`);
    } else {
      console.log(`[DEBUG] spawnNextMatchupGame: Match decided or no more tie-breaks. Skipping spawn.`);
      return;
    }
  }

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
  const bracketSize = Math.pow(2, Math.ceil(Math.log2(sectionPlayers.length || 2)));
  const totalWBRounds = Math.log2(bracketSize);

  if (match.bracketType === 'winners') {
    if (match.round === totalWBRounds) {
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
