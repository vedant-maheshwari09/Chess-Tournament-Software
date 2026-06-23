import type { Player, Match, Pairing, Tournament } from "@shared/schema";
import type { SectionDefinition } from "@shared/tournament-config";
import { getPointsForResult, normalizeMatchResult } from "@shared/match-results";
import { calculateMatchupScore } from "@shared/tournament-config";
import type { SwissPlayerStanding, PlayerRoundResult } from "./types";

export function interpretPlayerResult(
  result: string | null | undefined,
  isWhite: boolean,
): { outcome: PlayerRoundResult["result"]; points: number } {
  const normalized = normalizeMatchResult(result);
  const color = isWhite ? "white" : "black";
  const points = getPointsForResult(result, color);

  if (!normalized) {
    return { outcome: "unplayed", points: 0 };
  }
  if (normalized === "1-bye" || normalized === "1/2-bye" || normalized === "0-bye") {
    return { outcome: "bye", points };
  }
  if (normalized === "1-0") {
    return { outcome: isWhite ? "W" : "L", points };
  }
  if (normalized === "0-1") {
    return { outcome: isWhite ? "L" : "W", points };
  }
  if (normalized === "1/2-1/2") {
    return { outcome: "D", points };
  }
  if (normalized === "1F-0F") {
    return { outcome: isWhite ? "forfeit-win" : "forfeit-loss", points };
  }
  if (normalized === "0F-1F") {
    return { outcome: isWhite ? "forfeit-loss" : "forfeit-win", points };
  }
  if (normalized === "1F-1F" || normalized === "0F-0F") {
    return { outcome: "double-forfeit", points };
  }
  return { outcome: "unplayed", points };
}

export function calculateSwissStandings(
  sourcePlayers: Player[],
  sourceMatches: Match[],
  sourcePairings: Pairing[],
  playerById: Map<number, Player>,
  tournament: Tournament | null | undefined,
  selectedSectionId: string,
  selectedSectionLabel: string,
  tournamentConfig: any
): SwissPlayerStanding[] {
      if (!tournament) return [];

      const players = sourcePlayers;
      const matches = sourceMatches;
      const pairings = sourcePairings;

      // Calculate current round from existing matches
      const currentRound = matches.length > 0 ? Math.max(...matches.map((m: any) => m.round)) : 0;
      // Use the actual highest round number instead of planned rounds to show extended tournaments
      const totalRounds = Math.max(currentRound, tournament.rounds || 5);

      const isFide = tournamentConfig?.details.primaryRatingSystem === 'fide';

      // Helper function to get opponents faced by a player
      const getOpponents = (playerId: number): number[] => {
        const opponentIds: number[] = [];
        matches.forEach((match) => {
          if (match.whitePlayerId === playerId && match.blackPlayerId) {
            opponentIds.push(match.blackPlayerId);
          } else if (match.blackPlayerId === playerId && match.whitePlayerId) {
            opponentIds.push(match.whitePlayerId);
          }
        });
        return opponentIds;
      };

      // First pass: Calculate basic points and rankings
      const basicStandings = players.map((player: any) => {
        const playerMatches = matches.filter(
          (match) => match.whitePlayerId === player.id || match.blackPlayerId === player.id
        );

        // Get bye pairings for this player
        const playerByes = pairings.filter(
          (pairing: any) =>
            pairing.playerId === player.id && pairing.isBye && pairing.points !== null && pairing.round <= currentRound,
        );

        let totalPoints = 0;

        for (let round = 1; round <= currentRound; round++) {
          const match = playerMatches.find((m: any) => m.round === round);
          if (match) {
            const normalized = normalizeMatchResult(match.result);
            if (normalized) {
              const isWhite = match.whitePlayerId === player.id;
              totalPoints += getPointsForResult(match.result, isWhite ? "white" : "black");
            }
          } else {
            const bye = playerByes.find((b) => b.round === round);
            if (bye) {
              const byePoints = bye.points === 1 ? 0.5 : bye.points === 2 ? 1 : 0;
              totalPoints += byePoints;
            }
          }
        }

        return {
          player,
          totalPoints,
          isWithdrawn: player.status === 'withdrawn',
        };
      });

      // Create a map of player ID to their total points
      const playerPointsMap = new Map<number, number>();
      basicStandings.forEach((s: any) => playerPointsMap.set(s.player.id, s.totalPoints));

      // USCF/FIDE-compliant virtual opponent scores helper for Solkoff, Buchholz, Median, and Modified Median
      const getTiebreakOpponentScores = (playerId: number, myPoints: number): number[] => {
        const scores: number[] = [];
        const playerMatches = matches.filter(
          (m: any) => m.whitePlayerId === playerId || m.blackPlayerId === playerId
        );
        const playerByes = pairings.filter(
          (pairing: any) => pairing.playerId === playerId && pairing.isBye && pairing.points !== null && pairing.round <= currentRound
        );

        const getPlayerScoreBeforeRound = (pId: number, roundNum: number): number => {
          let score = 0;
          for (let r = 1; r < roundNum; r++) {
            score += getPlayerScoreInRound(pId, r);
          }
          return score;
        };

        const getPlayerScoreInRound = (pId: number, roundNum: number): number => {
          const match = playerMatches.find((m: any) => m.round === roundNum);
          if (match) {
            const normalized = normalizeMatchResult(match.result);
            if (normalized) {
              const isWhite = match.whitePlayerId === pId;
              return getPointsForResult(match.result, isWhite ? "white" : "black");
            }
            return 0;
          }
          const bye = playerByes.find((b) => b.round === roundNum);
          if (bye) {
            return bye.points === 1 ? 0.5 : bye.points === 2 ? 1.0 : 0.0;
          }
          return 0;
        };

        for (let round = 1; round <= currentRound; round++) {
          const bye = playerByes.find((b) => b.round === round);
          if (bye) {
            const s_pr = getPlayerScoreBeforeRound(playerId, round);
            const s_fpr = bye.points === 1 ? 0.5 : bye.points === 2 ? 1.0 : 0.0;
            const s_von = s_pr + (1.0 - s_fpr) + 0.5 * (currentRound - round);
            scores.push(s_von);
            continue;
          }

          const match = playerMatches.find((m: any) => m.round === round);
          if (match) {
            const isWhite = match.whitePlayerId === playerId;
            const oppId = isWhite ? match.blackPlayerId : match.whitePlayerId;
            const normalized = normalizeMatchResult(match.result);
            if (!normalized) continue;

            const interpretation = interpretPlayerResult(match.result, isWhite);
            if (interpretation.outcome === 'W' || interpretation.outcome === 'D' || interpretation.outcome === 'L') {
              const oppPoints = oppId ? playerPointsMap.get(oppId) ?? 0 : 0;
              scores.push(oppPoints);
            } else if (interpretation.outcome === 'forfeit-win') {
              const s_pr = getPlayerScoreBeforeRound(playerId, round);
              const s_fpr = 1.0;
              const s_von = s_pr + (1.0 - s_fpr) + 0.5 * (currentRound - round);
              scores.push(s_von);
            } else if (interpretation.outcome === 'forfeit-loss' || interpretation.outcome === 'double-forfeit') {
              const s_pr = getPlayerScoreBeforeRound(playerId, round);
              const s_fpr = 0.0;
              const s_von = s_pr + (1.0 - s_fpr) + 0.5 * (currentRound - round);
              scores.push(s_von);
            }
          } else {
            const s_pr = getPlayerScoreBeforeRound(playerId, round);
            const s_fpr = 0.0;
            const s_von = s_pr + (1.0 - s_fpr) + 0.5 * (currentRound - round);
            scores.push(s_von);
          }
        }
        return scores;
      };

      // Precompute Cumulative Scores for all players
      const playerCumulativeMap = new Map<number, number>();
      players.forEach((player: any) => {
        let cumulative = 0;
        let runningTotal = 0;
        const playerMatches = matches.filter(
          (m: any) => m.whitePlayerId === player.id || m.blackPlayerId === player.id
        );
        const playerByes = pairings.filter(
          (pairing: any) => pairing.playerId === player.id && pairing.isBye && pairing.points !== null
        );

        for (let r = 1; r <= currentRound; r++) {
          const match = playerMatches.find((m: any) => m.round === r);
          if (match) {
            const normalized = normalizeMatchResult(match.result);
            if (normalized) {
              runningTotal += getPointsForResult(match.result, match.whitePlayerId === player.id ? "white" : "black");
            }
          } else {
            const bye = playerByes.find((b) => b.round === r);
            if (bye) {
              const byePoints = bye.points === 1 ? 0.5 : bye.points === 2 ? 1 : 0;
              runningTotal += byePoints;
            }
          }
          cumulative += runningTotal;
        }
        playerCumulativeMap.set(player.id, cumulative);
      });

      // Define tiebreaker calculators
      const tiebreakCalculators: Record<string, (playerId: number) => number> = {
        "Points": (playerId) => {
          return playerPointsMap.get(playerId) ?? 0;
        },
        "Solkoff": (playerId) => {
          const points = playerPointsMap.get(playerId) ?? 0;
          return getTiebreakOpponentScores(playerId, points).reduce((sum, s) => sum + s, 0);
        },
        "Buchholz": (playerId) => {
          const points = playerPointsMap.get(playerId) ?? 0;
          return getTiebreakOpponentScores(playerId, points).reduce((sum, s) => sum + s, 0);
        },
        "Modified Median": (playerId) => {
          const points = playerPointsMap.get(playerId) ?? 0;
          const scores = getTiebreakOpponentScores(playerId, points);
          if (scores.length === 0) return 0;
          const halfPoints = totalRounds * 0.5;

          const sorted = [...scores].sort((a: any, b: any) => a - b);
          const numToExclude = totalRounds >= 9 ? 2 : 1;

          if (points > halfPoints) {
            return sorted.slice(numToExclude).reduce((sum, s) => sum + s, 0);
          } else if (points < halfPoints) {
            return sorted.slice(0, -numToExclude).reduce((sum, s) => sum + s, 0);
          } else {
            if (sorted.length <= numToExclude * 2) {
              return sorted.reduce((sum, s) => sum + s, 0);
            }
            return sorted.slice(numToExclude, -numToExclude).reduce((sum, s) => sum + s, 0);
          }
        },
        "Median": (playerId) => {
          const points = playerPointsMap.get(playerId) ?? 0;
          const scores = getTiebreakOpponentScores(playerId, points);
          if (scores.length === 0) return 0;
          const sorted = [...scores].sort((a: any, b: any) => a - b);
          const numToExclude = totalRounds >= 9 ? 2 : 1;
          if (sorted.length <= numToExclude * 2) {
            return 0;
          }
          return sorted.slice(numToExclude, -numToExclude).reduce((sum, s) => sum + s, 0);
        },
        "Cumulative": (playerId) => {
          return playerCumulativeMap.get(playerId) ?? 0;
        },
        "Sonneborn-Berger": (playerId) => {
          let sb = 0;
          const playerMatches = matches.filter(
            (m: any) => m.whitePlayerId === playerId || m.blackPlayerId === playerId
          );
          const playerByes = pairings.filter(
            (pairing: any) => pairing.playerId === playerId && pairing.isBye && pairing.points !== null && pairing.round <= currentRound
          );

          const getPlayerScoreBeforeRound = (pId: number, roundNum: number): number => {
            let score = 0;
            for (let r = 1; r < roundNum; r++) {
              score += getPlayerScoreInRound(pId, r);
            }
            return score;
          };

          const getPlayerScoreInRound = (pId: number, roundNum: number): number => {
            const match = playerMatches.find((m: any) => m.round === roundNum);
            if (match) {
              const normalized = normalizeMatchResult(match.result);
              if (normalized) {
                const isWhite = match.whitePlayerId === pId;
                return getPointsForResult(match.result, isWhite ? "white" : "black");
              }
              return 0;
            }
            const bye = playerByes.find((b) => b.round === roundNum);
            if (bye) {
              return bye.points === 1 ? 0.5 : bye.points === 2 ? 1.0 : 0.0;
            }
            return 0;
          };

          for (let round = 1; round <= currentRound; round++) {
            const bye = playerByes.find((b) => b.round === round);
            if (bye) {
              const s_pr = getPlayerScoreBeforeRound(playerId, round);
              const s_fpr = bye.points === 1 ? 0.5 : bye.points === 2 ? 1.0 : 0.0;
              const s_von = s_pr + (1.0 - s_fpr) + 0.5 * (currentRound - round);
              sb += 0.5 * s_von;
              continue;
            }

            const match = playerMatches.find((m: any) => m.round === round);
            if (match) {
              const isWhite = match.whitePlayerId === playerId;
              const oppId = isWhite ? match.blackPlayerId : match.whitePlayerId;
              const normalized = normalizeMatchResult(match.result);
              if (!normalized) continue;

              const interpretation = interpretPlayerResult(match.result, isWhite);
              if (interpretation.outcome === 'W') {
                const oppPoints = oppId ? playerPointsMap.get(oppId) ?? 0 : 0;
                sb += oppPoints;
              } else if (interpretation.outcome === 'D') {
                const oppPoints = oppId ? playerPointsMap.get(oppId) ?? 0 : 0;
                sb += oppPoints * 0.5;
              } else if (interpretation.outcome === 'forfeit-win') {
                const s_pr = getPlayerScoreBeforeRound(playerId, round);
                const s_fpr = 1.0;
                const s_von = s_pr + (1.0 - s_fpr) + 0.5 * (currentRound - round);
                sb += 0.5 * s_von;
              }
            }
          }
          return sb;
        },
        "Kashdan": (playerId) => {
          let kashdan = 0;
          const playerMatches = matches.filter(
            (m: any) => m.whitePlayerId === playerId || m.blackPlayerId === playerId
          );
          const playerByes = pairings.filter(
            (pairing: any) => pairing.playerId === playerId && pairing.isBye && pairing.points !== null && pairing.round <= currentRound
          );

          for (let round = 1; round <= currentRound; round++) {
            const bye = playerByes.find((b) => b.round === round);
            if (bye) {
              const byePoints = bye.points === 1 ? 0.5 : bye.points === 2 ? 1.0 : 0.0;
              if (byePoints === 1.0) {
                kashdan += 4;
              } else if (byePoints === 0.5) {
                kashdan += 2;
              }
              continue;
            }

            const match = playerMatches.find((m: any) => m.round === round);
            if (match) {
              const isWhite = match.whitePlayerId === playerId;
              const normalized = normalizeMatchResult(match.result);
              if (!normalized) continue;

              const interpretation = interpretPlayerResult(match.result, isWhite);
              if (interpretation.outcome === 'W') {
                kashdan += 4;
              } else if (interpretation.outcome === 'D') {
                kashdan += 2;
              } else if (interpretation.outcome === 'L') {
                kashdan += 1;
              } else if (interpretation.outcome === 'forfeit-win') {
                kashdan += 4;
              } else if (interpretation.outcome === 'forfeit-loss') {
                kashdan += 0;
              }
            }
          }
          return kashdan;
        },
        "Opponent's Cumulative": (playerId) => {
          return getOpponents(playerId)
            .map((id) => playerCumulativeMap.get(id) ?? 0)
            .reduce((sum, s) => sum + s, 0);
        },
        "Opponent Average Rating": (playerId) => {
          const opponentIds = getOpponents(playerId);
          if (opponentIds.length === 0) return 0;
          const ratings = opponentIds.map(id => {
            const p = playerById.get(id);
            if (!p) return 1000;
            const r = (isFide ? (p.fideRating ?? p.rating) : (p.uscfRating ?? p.rating)) || 0;
            return r === 0 ? 1000 : r;
          });
          return ratings.reduce((sum, r) => sum + r, 0) / ratings.length;
        },
        "Number of Wins": (playerId) => {
          const playerMatches = matches.filter(
            (m: any) => m.whitePlayerId === playerId || m.blackPlayerId === playerId
          );
          let wins = 0;
          playerMatches.forEach(m => {
            const isWhite = m.whitePlayerId === playerId;
            const normalized = normalizeMatchResult(m.result);
            if (!normalized) return;
            const interpretation = interpretPlayerResult(m.result, isWhite);
            if (interpretation.outcome === 'W' || interpretation.outcome === 'forfeit-win') {
              wins++;
            }
          });

          const playerByes = pairings.filter(
            (pairing: any) => pairing.playerId === playerId && pairing.isBye && pairing.points !== null && pairing.round <= currentRound
          );
          playerByes.forEach(bye => {
            const byePoints = bye.points === 1 ? 0.5 : bye.points === 2 ? 1 : 0;
            if (byePoints === 1) {
              wins++;
            }
          });

          return wins;
        }
      };

      // Get active tiebreakers
      const activeTiebreakRules = (selectedSectionId === "extra_games" || !tournamentConfig?.details.tiebreaksEnabled)
        ? []
        : (tournamentConfig.details.tiebreaks || []);

      const standingsWithTiebreakers = basicStandings.map((standing: any) => {
        const values: Record<string, number> = {};
        activeTiebreakRules.forEach((rule: string) => {
          const calculator = tiebreakCalculators[rule];
          if (calculator) {
            values[rule] = calculator(standing.player.id);
          }
        });
        return {
          ...standing,
          tiebreakValues: values,
        };
      });

      // Sort strictly by points descending, then tiebreakers (if enabled), then rating descending, then player ID ascending
      standingsWithTiebreakers.sort((a: any, b: any) => {
        if (b.totalPoints !== a.totalPoints) return b.totalPoints - a.totalPoints;

        // Apply active tiebreakers in configured priority order (if enabled)
        for (const rule of activeTiebreakRules) {
          const valA = a.tiebreakValues[rule] ?? 0;
          const valB = b.tiebreakValues[rule] ?? 0;
          if (valB !== valA) return valB - valA;
        }

        const ratingA = (isFide ? (a.player.fideRating ?? a.player.rating) : (a.player.uscfRating ?? a.player.rating)) || 0;
        const ratingB = (isFide ? (b.player.fideRating ?? b.player.rating) : (b.player.uscfRating ?? b.player.rating)) || 0;
        if (ratingB !== ratingA) return ratingB - ratingA;

        return a.player.id - b.player.id;
      });

      // Assign positions
      const standingsWithPositions = standingsWithTiebreakers.map((standing, index) => ({
        ...standing,
        position: index + 1,
      }));

      // Helper functions for dynamic rating calculations (USCF formulas)
      const calculatePerformanceRating = (preRating: number, roundResults: PlayerRoundResult[]): number => {
        const playedGames = roundResults.filter(
          r => r.opponent && (r.result === 'W' || r.result === 'L' || r.result === 'D')
        );
        const effectivePreRating = preRating || 1000;
        if (playedGames.length === 0) return effectivePreRating;

        let totalOpponentRating = 0;
        let wins = 0;
        let losses = 0;
        let gamesCount = 0;

        playedGames.forEach(g => {
          if (!g.opponent) return;
          let oppRating = (isFide ? (g.opponent.fideRating ?? g.opponent.rating) : (g.opponent.uscfRating ?? g.opponent.rating)) || 0;
          if (oppRating === 0) oppRating = 1000; // default unrated opponent is 1000
          totalOpponentRating += oppRating;
          gamesCount++;
          if (g.result === 'W') {
            wins++;
          } else if (g.result === 'L') {
            losses++;
          }
        });

        if (gamesCount === 0) return effectivePreRating;

        const avgOpponentRating = totalOpponentRating / gamesCount;
        const perf = avgOpponentRating + 400 * (wins - losses) / gamesCount;
        return Math.round(perf);
      };

      const calculateEstimatedPostRating = (preRating: number, roundResults: PlayerRoundResult[]): number => {
        const playedGames = roundResults.filter(
          r => r.opponent && (r.result === 'W' || r.result === 'L' || r.result === 'D')
        );
        const hasPreRating = preRating && preRating > 0;
        
        if (!hasPreRating) {
          // If unrated, equal to Performance Rating
          return calculatePerformanceRating(preRating, roundResults);
        }

        if (playedGames.length === 0) return preRating;

        let actualScore = 0;
        let expectedScore = 0;

        playedGames.forEach(g => {
          if (!g.opponent) return;
          let oppRating = (isFide ? (g.opponent.fideRating ?? g.opponent.rating) : (g.opponent.uscfRating ?? g.opponent.rating)) || 0;
          if (oppRating === 0) oppRating = 1000; // default unrated opponent is 1000
          
          let expected;
          if (isFide) {
            let diff = oppRating - preRating;
            if (diff > 400) diff = 400;
            if (diff < -400) diff = -400;
            expected = 1 / (1 + Math.pow(10, diff / 400));
          } else {
            expected = 1 / (1 + Math.pow(10, (oppRating - preRating) / 400));
          }
          expectedScore += expected;

          if (g.result === 'W') {
            actualScore += 1;
          } else if (g.result === 'D') {
            actualScore += 0.5;
          }
        });

        let K = 32;
        if (isFide) {
          K = preRating >= 2400 ? 10 : 20;
        } else {
          if (preRating >= 2400) K = 16;
          else if (preRating >= 2200) K = 24;
          else K = 32;
        }

        const postRating = preRating + K * (actualScore - expectedScore);
        const rounded = Math.round(postRating);
        return Math.max(100, rounded); // capped at 100 minimum
      };

      // Second pass: Calculate detailed round results
      const detailedStandings: SwissPlayerStanding[] = standingsWithPositions.map((standing: any) => {
        const roundResults: PlayerRoundResult[] = [];

        for (let round = 1; round <= totalRounds; round++) {
          if (round > currentRound) {
            // Future rounds
            roundResults.push({
              opponent: null,
              opponentPosition: 0,
              result: "withdrawn",
              color: null,
              points: 0,
            });
            continue;
          }

          // Check for bye first
          const byeThisRound = pairings.find(
            (pairing: any) => pairing.playerId === standing.player.id && pairing.isBye && pairing.round === round,
          );

          if (byeThisRound) {
            const matchThisRound = matches.find(
              (match) => match.round === round && match.whitePlayerId === standing.player.id && match.blackPlayerId === null
            );

            let byePoints = byeThisRound.points === 1 ? 0.5 : byeThisRound.points === 2 ? 1 : 0;
            if (matchThisRound) {
              const normalized = normalizeMatchResult(matchThisRound.result);
              if (normalized) {
                byePoints = getPointsForResult(matchThisRound.result, "white");
              }
            }

            roundResults.push({
              opponent: null,
              opponentPosition: 0,
              result: "bye",
              color: null,
              points: byePoints,
              isRequested: byeThisRound.isRequested ?? false,
            });
            continue;
          }

          if (standing.isWithdrawn) {
            roundResults.push({
              opponent: null,
              opponentPosition: 0,
              result: "withdrawn",
              color: null,
              points: 0,
            });
            continue;
          }

          // Find match for this round
          const matchThisRound = matches.find(
            (match) =>
              match.round === round &&
              (match.whitePlayerId === standing.player.id || match.blackPlayerId === standing.player.id),
          );

          // Check if player has any pairing
          const pairingThisRound = pairings.find(
            (pairing: any) => pairing.playerId === standing.player.id && pairing.round === round,
          );

          if (!matchThisRound && !pairingThisRound) {
            roundResults.push({
              opponent: null,
              opponentPosition: 0,
              result: "unplayed",
              color: null,
              points: 0,
            });
            continue;
          }

          if (!matchThisRound) {
            roundResults.push({
              opponent: null,
              opponentPosition: 0,
              result: "withdrawn",
              color: null,
              points: 0,
            });
            continue;
          }

          const isWhite = matchThisRound.whitePlayerId === standing.player.id;
          const opponentId = isWhite ? matchThisRound.blackPlayerId : matchThisRound.whitePlayerId;
          const opponent = opponentId ? playerById.get(opponentId) ?? null : null;
          const opponentStanding = standingsWithPositions.find((s: any) => s.player.id === opponentId);
          const opponentPosition = opponentStanding?.position || 0;
          const interpretation = interpretPlayerResult(matchThisRound.result, isWhite);

          roundResults.push({
            opponent,
            opponentPosition,
            result: interpretation.outcome,
            color: isWhite ? "white" : "black",
            points: interpretation.points,
            isInProgress: !matchThisRound.result && matchThisRound.status !== 'completed',
            board: matchThisRound.board ?? undefined,
          });
        }

        // Calculate Prizes
        let prizeCategory = "---";
        let prizeAmount = "---";

        const playerRating = (isFide ? (standing.player.fideRating ?? standing.player.rating) : (standing.player.uscfRating ?? standing.player.rating)) || 0;

        if (tournamentConfig?.prizesEnabled && tournamentConfig.prizes) {
          const matchPrizes = tournamentConfig.prizes.filter((p: any) => {
            const sameSection = p.sectionId === selectedSectionId || p.section === selectedSectionLabel;
            const ratingQualifies = !p.ratingCap || playerRating < p.ratingCap;
            return sameSection && ratingQualifies;
          });

          matchPrizes.sort((a: any, b: any) => {
            if (a.ratingCap && !b.ratingCap) return 1;
            if (!a.ratingCap && b.ratingCap) return -1;
            return 0;
          });

          const ratingCappedPrize = matchPrizes.find((p: any) => p.ratingCap);
          const generalPrize = matchPrizes.find((p: any) => !p.ratingCap && (
            (p.place.toLowerCase().includes("1st") && standing.position === 1) ||
            (p.place.toLowerCase().includes("2nd") && standing.position === 2) ||
            (p.place.toLowerCase().includes("3rd") && standing.position === 3) ||
            (p.place.toLowerCase().includes("4th") && standing.position === 4) ||
            (p.place.toLowerCase().includes("5th") && standing.position === 5)
          ));

          if (generalPrize) {
            prizeCategory = generalPrize.place;
            prizeAmount = `$${generalPrize.amount}`;
          } else if (ratingCappedPrize && standing.position <= 10) {
            prizeCategory = `BU${ratingCappedPrize.ratingCap}`;
            prizeAmount = `$${ratingCappedPrize.amount}`;
          }
        }

        return {
          player: standing.player,
          position: standing.position,
          totalPoints: standing.totalPoints,
          roundResults,
          isWithdrawn: standing.isWithdrawn,
          tiebreakValues: standing.tiebreakValues,
          prizeCategory,
          prizeAmount,
          performanceRating: calculatePerformanceRating(playerRating, roundResults),
          postRating: calculateEstimatedPostRating(playerRating, roundResults),
        };
      });

      return detailedStandings;
}

