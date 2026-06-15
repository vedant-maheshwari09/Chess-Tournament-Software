import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Download, Printer } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import type { Player, Match, Pairing, Tournament } from "@shared/schema";
import { parseTournamentConfig, buildTournamentPayload, serializeTournamentConfig } from "@/lib/tournament-config";
import type { SectionDefinition, PrizeRule, TournamentConfig } from "@shared/tournament-config";
import { getPointsForResult, normalizeMatchResult } from "@shared/match-results";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";

interface SwissStandingsProps {
  tournamentId: number;
  showExportControls?: boolean;
}

interface PlayerRoundResult {
  opponent: Player | null;
  opponentPosition: number;
  result:
    | 'W'
    | 'L'
    | 'D'
    | 'bye'
    | 'withdrawn'
    | 'forfeit-win'
    | 'forfeit-loss'
    | 'unplayed'
    | 'double-forfeit';
  color: 'white' | 'black' | null;
  points: number;
  isRequested?: boolean;
}

interface SwissPlayerStanding {
  player: Player;
  position: number;
  totalPoints: number;
  roundResults: PlayerRoundResult[];
  isWithdrawn: boolean;
  tiebreakValues: Record<string, number>;
  prizeCategory?: string;
  prizeAmount?: string;
  postRating?: number;
  performanceRating?: number;
}

function interpretPlayerResult(
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

export default function SwissStandings({ tournamentId, showExportControls = true }: SwissStandingsProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: tournament, isLoading: tournamentLoading } = useQuery<Tournament>({
    queryKey: [`/api/tournaments/${tournamentId}`],
  });

  const { data: players, isLoading: playersLoading } = useQuery<Player[]>({
    queryKey: [`/api/tournaments/${tournamentId}/players`],
  });

  const { data: matches, isLoading: matchesLoading } = useQuery<Match[]>({
    queryKey: [`/api/tournaments/${tournamentId}/matches`],
  });

  const { data: pairings, isLoading: pairingsLoading } = useQuery<Pairing[]>({
    queryKey: [`/api/tournaments/${tournamentId}/pairings`],
  });

  const [selectedSectionId, setSelectedSectionId] = useState<string>("__all__");
  const [showPrizes, setShowPrizes] = useState<boolean>(true);

  const tournamentConfig = useMemo(() => (tournament ? parseTournamentConfig(tournament) : null), [tournament]);

  const hasExtraGames = useMemo(() => {
    return matches?.some(m => m.isExtraGame) ?? false;
  }, [matches]);

  const isDirector = !!(user?.role === 'tournament_director' && tournament && user && tournament.createdBy === user.id);

  const updateShowPrizeAmountsMutation = useMutation({
    mutationFn: async (checked: boolean) => {
      if (!tournamentConfig || !tournament) throw new Error("Configuration not ready");
      const updatedConfig: TournamentConfig = { ...tournamentConfig, showPrizeAmounts: checked };
      const serialized = serializeTournamentConfig(updatedConfig);
      const payload = buildTournamentPayload(serialized, { format: tournament.format });
      (payload as any).status = tournament.status;
      const res = await apiRequest(`/api/tournaments/${tournamentId}`, {
        method: "PUT",
        body: JSON.stringify(payload),
      });
      return res;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/tournaments/${tournamentId}`] });
      toast({
        title: "Standings updated",
        description: "Prize payout visibility preference saved.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Failed to update preference",
        description: error?.message ?? "An error occurred.",
        variant: "destructive",
      });
    }
  });

  const sections = useMemo<SectionDefinition[]>(() => {
    if (!tournamentConfig) return [];
    return (tournamentConfig.sections ?? []).filter((section) => section.name.trim().length > 0);
  }, [tournamentConfig]);

  const activeTiebreakRules = useMemo(() => {
    if (selectedSectionId === "extra_games" || !tournamentConfig?.details.tiebreaksEnabled) {
      return [];
    }
    return tournamentConfig?.details.tiebreaks || [];
  }, [selectedSectionId, tournamentConfig]);

  useEffect(() => {
    setSelectedSectionId((prev) => {
      if (prev === "__all__") return prev;
      return sections.some((section) => section.id === prev) ? prev : sections[0]?.id ?? "__all__";
    });
  }, [sections]);

  useEffect(() => {
    if (tournamentConfig) {
      setShowPrizes(!!tournamentConfig.prizesEnabled);
    }
  }, [tournamentConfig]);

  const playerSectionMap = useMemo(() => {
    const map = new Map<number, SectionDefinition>();
    if (!players) return map;
    const nameMap = new Map<string, SectionDefinition>();
    sections.forEach((section) => {
      nameMap.set(section.name.trim().toLowerCase(), section);
    });

    players.forEach((player) => {
      let resolved: SectionDefinition | undefined;
      if (player.sectionId) {
        resolved = sections.find((section) => section.id === player.sectionId);
      }
      if (!resolved && player.sectionName) {
        resolved = nameMap.get(player.sectionName.trim().toLowerCase());
      }
      if (!resolved && sections.length) {
        resolved = sections[0];
      }
      if (resolved) {
        map.set(player.id, resolved);
      }
    });

    return map;
  }, [players, sections]);

  const filteredPlayers = useMemo(() => {
    if (!players) return [] as Player[];
    if (selectedSectionId === "extra_games") {
      const extraGamePlayerIds = new Set(
        matches
          ?.filter(m => m.isExtraGame)
          .flatMap(m => [m.whitePlayerId, m.blackPlayerId])
          .filter((id): id is number => id !== null && id !== undefined) || []
      );
      return players.filter((player) => extraGamePlayerIds.has(player.id));
    }
    if (selectedSectionId === "__all__") return players;
    return players.filter((player) => playerSectionMap.get(player.id)?.id === selectedSectionId);
  }, [players, playerSectionMap, selectedSectionId, matches]);

  const filteredMatches = useMemo(() => {
    if (!matches) return [] as Match[];
    if (selectedSectionId === "extra_games") {
      return matches.filter(m => m.isExtraGame);
    }
    const baseMatches = matches.filter(m => !m.isExtraGame);
    if (selectedSectionId === "__all__") return baseMatches;
    return baseMatches.filter((match) => {
      const whiteSection = match.whitePlayerId ? playerSectionMap.get(match.whitePlayerId)?.id : undefined;
      const blackSection = match.blackPlayerId ? playerSectionMap.get(match.blackPlayerId)?.id : undefined;
      if (match.whitePlayerId && match.blackPlayerId) {
        return whiteSection === selectedSectionId && blackSection === selectedSectionId;
      }
      return whiteSection === selectedSectionId || blackSection === selectedSectionId;
    });
  }, [matches, playerSectionMap, selectedSectionId]);

  const filteredPairings = useMemo(() => {
    if (!pairings) return [] as Pairing[];
    if (selectedSectionId === "extra_games") return [] as Pairing[];
    if (selectedSectionId === "__all__") return pairings;
    return pairings.filter((pairing) => playerSectionMap.get(pairing.playerId)?.id === selectedSectionId);
  }, [pairings, playerSectionMap, selectedSectionId]);

  const selectedSectionLabel = useMemo(() => {
    if (selectedSectionId === "__all__") return "All Sections";
    if (selectedSectionId === "extra_games") return "Extra Games";
    return sections.find((section) => section.id === selectedSectionId)?.name ?? "All Sections";
  }, [sections, selectedSectionId]);

  const playerById = useMemo(() => {
    const map = new Map<number, Player>();
    if (players) {
      players.forEach((player) => map.set(player.id, player));
    }
    return map;
  }, [players]);

  const getPlayerPairingNumber = useCallback((playerId: number): number => {
    const p = playerById.get(playerId);
    if (!p) return 0;
    if (p.seed !== null && p.seed !== undefined && p.seed > 0) {
      return p.seed;
    }
    
    // Fallback: calculate seed dynamically within the section
    const pSection = playerSectionMap.get(playerId)?.id;
    const sectionPlayers = players?.filter(player => playerSectionMap.get(player.id)?.id === pSection) || [];
    
    const isFide = tournamentConfig?.details.primaryRatingSystem === 'fide';
    const sorted = [...sectionPlayers].sort((a, b) => {
      const ratingA = (isFide ? (a.fideRating ?? a.rating) : (a.uscfRating ?? a.rating)) || 0;
      const ratingB = (isFide ? (b.fideRating ?? b.rating) : (b.uscfRating ?? b.rating)) || 0;
      if (ratingB !== ratingA) return ratingB - ratingA;
      return a.id - b.id;
    });
    
    const idx = sorted.findIndex(player => player.id === playerId);
    return idx !== -1 ? idx + 1 : 1;
  }, [players, playerById, playerSectionMap, tournamentConfig]);

  const calculateSwissStandings = useCallback(
    (sourcePlayers: Player[], sourceMatches: Match[], sourcePairings: Pairing[]): SwissPlayerStanding[] => {
      if (!tournament) return [];

      const players = sourcePlayers;
      const matches = sourceMatches;
      const pairings = sourcePairings;

      // Calculate current round from existing matches
      const currentRound = matches.length > 0 ? Math.max(...matches.map((m) => m.round)) : 0;
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
      const basicStandings = players.map((player) => {
        const playerMatches = matches.filter(
          (match) => match.whitePlayerId === player.id || match.blackPlayerId === player.id
        );

        // Get bye pairings for this player
        const playerByes = pairings.filter(
          (pairing) =>
            pairing.playerId === player.id && pairing.isBye && pairing.points !== null && pairing.round <= currentRound,
        );

        let totalPoints = 0;

        for (let round = 1; round <= currentRound; round++) {
          const match = playerMatches.find((m) => m.round === round);
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
      basicStandings.forEach((s) => playerPointsMap.set(s.player.id, s.totalPoints));

      // Calculate opponent scores helper
      const getOpponentScores = (playerId: number): number[] => {
        return getOpponents(playerId).map((oppId) => playerPointsMap.get(oppId) ?? 0);
      };

      // Precompute Cumulative Scores for all players
      const playerCumulativeMap = new Map<number, number>();
      players.forEach((player) => {
        let cumulative = 0;
        let runningTotal = 0;
        const playerMatches = matches.filter(
          (m) => m.whitePlayerId === player.id || m.blackPlayerId === player.id
        );
        const playerByes = pairings.filter(
          (pairing) => pairing.playerId === player.id && pairing.isBye && pairing.points !== null
        );

        for (let r = 1; r <= currentRound; r++) {
          const match = playerMatches.find((m) => m.round === r);
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
        "Solkoff": (playerId) => {
          return getOpponentScores(playerId).reduce((sum, s) => sum + s, 0);
        },
        "Buchholz": (playerId) => {
          return getOpponentScores(playerId).reduce((sum, s) => sum + s, 0);
        },
        "Modified Median": (playerId) => {
          const scores = getOpponentScores(playerId);
          if (scores.length === 0) return 0;
          const points = playerPointsMap.get(playerId) ?? 0;
          const halfPoints = totalRounds * 0.5;

          const sorted = [...scores].sort((a, b) => a - b);
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
          return tiebreakCalculators["Modified Median"](playerId);
        },
        "Cumulative": (playerId) => {
          return playerCumulativeMap.get(playerId) ?? 0;
        },
        "Sonneborn-Berger": (playerId) => {
          let sb = 0;
          matches.forEach((match) => {
            const isWhite = match.whitePlayerId === playerId;
            const isBlack = match.blackPlayerId === playerId;
            if (!isWhite && !isBlack) return;

            const normalized = normalizeMatchResult(match.result);
            if (!normalized) return;

            const oppId = isWhite ? match.blackPlayerId : match.whitePlayerId;
            if (!oppId) return;

            const oppPoints = playerPointsMap.get(oppId) ?? 0;
            const resultPoints = getPointsForResult(match.result, isWhite ? "white" : "black");
            if (resultPoints === 1) {
              sb += oppPoints;
            } else if (resultPoints === 0.5) {
              sb += oppPoints * 0.5;
            }
          });
          return sb;
        },
        "Kashdan": (playerId) => {
          let kashdan = 0;
          const playerMatches = matches.filter(
            (m) => m.whitePlayerId === playerId || m.blackPlayerId === playerId
          );
          playerMatches.forEach((match) => {
            const normalized = normalizeMatchResult(match.result);
            if (!normalized) return;
            const pts = getPointsForResult(match.result, match.whitePlayerId === playerId ? "white" : "black");
            if (pts === 1) kashdan += 4;
            else if (pts === 0.5) kashdan += 2;
            else kashdan += 1;
          });
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
            if (!p) return 0;
            return (isFide ? (p.fideRating ?? p.rating) : (p.uscfRating ?? p.rating)) || 0;
          });
          return ratings.reduce((sum, r) => sum + r, 0) / ratings.length;
        },
        "Number of Wins": (playerId) => {
          const playerMatches = matches.filter(
            (m) => m.whitePlayerId === playerId || m.blackPlayerId === playerId
          );
          const playedWins = playerMatches.filter(m => getPointsForResult(m.result, m.whitePlayerId === playerId ? "white" : "black") === 1).length;
          const p = playerById.get(playerId);
          const extraWins = (p?.fullPointByesReceived ?? 0) + (p?.forfeitWinsReceived ?? 0);
          return playedWins + extraWins;
        }
      };

      // Get active tiebreakers
      const activeTiebreakRules = (selectedSectionId === "extra_games" || !tournamentConfig?.details.tiebreaksEnabled)
        ? []
        : (tournamentConfig.details.tiebreaks || []);

      const standingsWithTiebreakers = basicStandings.map((standing) => {
        const values: Record<string, number> = {};
        activeTiebreakRules.forEach(rule => {
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

      // Sort strictly by points descending, then rating descending
      standingsWithTiebreakers.sort((a, b) => {
        if (b.totalPoints !== a.totalPoints) return b.totalPoints - a.totalPoints;

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

      // Helper functions for dynamic rating calculations
      const calculatePerformanceRating = (preRating: number, roundResults: PlayerRoundResult[]): number => {
        const playedGames = roundResults.filter(
          r => r.opponent && (r.result === 'W' || r.result === 'L' || r.result === 'D' || r.result === 'forfeit-win' || r.result === 'forfeit-loss')
        );
        const effectivePreRating = preRating || 1200;
        if (playedGames.length === 0) return effectivePreRating;

        let totalOpponentRating = 0;
        let actualScore = 0;
        let gamesCount = 0;

        playedGames.forEach(g => {
          if (!g.opponent) return;
          let oppRating = (isFide ? (g.opponent.fideRating ?? g.opponent.rating) : (g.opponent.uscfRating ?? g.opponent.rating)) || 0;
          if (oppRating === 0) oppRating = 1200; // default for unrated opponent
          totalOpponentRating += oppRating;
          gamesCount++;
          if (g.result === 'W' || g.result === 'forfeit-win') {
            actualScore += 1;
          } else if (g.result === 'D') {
            actualScore += 0.5;
          }
        });

        if (gamesCount === 0) return effectivePreRating;

        const avgOpponentRating = totalOpponentRating / gamesCount;
        const p = actualScore / gamesCount;
        const diff = 400 * (2 * p - 1);
        return Math.round(avgOpponentRating + diff);
      };

      const calculateEstimatedPostRating = (preRating: number, roundResults: PlayerRoundResult[]): number => {
        const playedGames = roundResults.filter(
          r => r.opponent && (r.result === 'W' || r.result === 'L' || r.result === 'D' || r.result === 'forfeit-win' || r.result === 'forfeit-loss')
        );
        const effectivePreRating = preRating || 1200;
        if (playedGames.length === 0) return effectivePreRating;

        let actualScore = 0;
        let expectedScore = 0;

        playedGames.forEach(g => {
          if (!g.opponent) return;
          let oppRating = (isFide ? (g.opponent.fideRating ?? g.opponent.rating) : (g.opponent.uscfRating ?? g.opponent.rating)) || 0;
          if (oppRating === 0) oppRating = 1200; // default for unrated opponent
          const expected = 1 / (1 + Math.pow(10, (oppRating - effectivePreRating) / 400));
          expectedScore += expected;

          if (g.result === 'W' || g.result === 'forfeit-win') {
            actualScore += 1;
          } else if (g.result === 'D') {
            actualScore += 0.5;
          }
        });

        const K = 32;
        const postRating = effectivePreRating + K * (actualScore - expectedScore);
        return Math.round(postRating);
      };

      // Second pass: Calculate detailed round results
      const detailedStandings: SwissPlayerStanding[] = standingsWithPositions.map((standing) => {
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
            (pairing) => pairing.playerId === standing.player.id && pairing.isBye && pairing.round === round,
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
            (pairing) => pairing.playerId === standing.player.id && pairing.round === round,
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
          const opponentStanding = standingsWithPositions.find((s) => s.player.id === opponentId);
          const opponentPosition = opponentStanding?.position || 0;
          const interpretation = interpretPlayerResult(matchThisRound.result, isWhite);

          roundResults.push({
            opponent,
            opponentPosition,
            result: interpretation.outcome,
            color: isWhite ? "white" : "black",
            points: interpretation.points,
          });
        }

        // Calculate Prizes
        let prizeCategory = "---";
        let prizeAmount = "---";

        const playerRating = (isFide ? (standing.player.fideRating ?? standing.player.rating) : (standing.player.uscfRating ?? standing.player.rating)) || 0;

        if (tournamentConfig?.prizesEnabled && tournamentConfig.prizes) {
          const matchPrizes = tournamentConfig.prizes.filter(p => {
            const sameSection = p.sectionId === selectedSectionId || p.section === selectedSectionLabel;
            const ratingQualifies = !p.ratingCap || playerRating < p.ratingCap;
            return sameSection && ratingQualifies;
          });

          matchPrizes.sort((a, b) => {
            if (a.ratingCap && !b.ratingCap) return 1;
            if (!a.ratingCap && b.ratingCap) return -1;
            return 0;
          });

          const ratingCappedPrize = matchPrizes.find(p => p.ratingCap);
          const generalPrize = matchPrizes.find(p => !p.ratingCap && (
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
    },
    [playerById, tournament, selectedSectionId, selectedSectionLabel, tournamentConfig],
  );

  const standings = useMemo(
    () => calculateSwissStandings(filteredPlayers, filteredMatches, filteredPairings),
    [calculateSwissStandings, filteredPlayers, filteredMatches, filteredPairings],
  );
  const currentRound = filteredMatches.length > 0 ? Math.max(...filteredMatches.map((m) => m.round)) : 0;
  const totalRounds = Math.max(currentRound, tournament?.rounds || 5);

  const downloadStandings = useCallback(() => {
    const activeTiebreaks = tournamentConfig?.details.tiebreaksEnabled ? (tournamentConfig.details.tiebreaks || []) : [];
    const baseHeaders = ['Rank', 'Name', 'Rating', 'Points'];
    const tiebreakHeaders = activeTiebreaks;
    const roundHeaders = Array.from({ length: totalRounds }, (_, i) => `Round ${i + 1}`);
    const headers = [...baseHeaders, ...tiebreakHeaders, ...roundHeaders, 'Est. Post', 'Perf.', 'Prize Category', 'Prize Amount'];

    const rows = standings.map((standing) => {
      const baseData = [
        standing.position,
        `${standing.player.firstName} ${standing.player.lastName}`,
        (tournamentConfig?.details.primaryRatingSystem === 'fide'
          ? (standing.player.fideRating ?? standing.player.rating)
          : (standing.player.uscfRating ?? standing.player.rating)) || 'Unrated',
        standing.totalPoints.toFixed(1).replace(/\.0$/, ""),
      ];

      const tiebreakData = activeTiebreaks.map(rule => standing.tiebreakValues[rule]?.toFixed(2) || '0.00');

      const roundData = standing.roundResults.map((result, index) => formatRoundResult(result, index + 1));

      const pRating = (tournamentConfig?.details.primaryRatingSystem === 'fide' ? (standing.player.fideRating ?? standing.player.rating) : (standing.player.uscfRating ?? standing.player.rating)) || 0;

      return [
        ...baseData,
        ...tiebreakData,
        ...roundData,
        standing.postRating ?? pRating,
        standing.performanceRating ?? pRating,
        standing.prizeCategory || '---',
        tournamentConfig?.showPrizeAmounts !== false ? (standing.prizeAmount || '---') : '---'
      ];
    });

    const csvContent = [headers, ...rows]
      .map((row) => row.map((cell) => `"${cell}"`).join(','))
      .join('\n');

    const sectionSlug = selectedSectionId === "__all__"
      ? "all-sections"
      : selectedSectionLabel.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "section";
    const baseName = (tournament?.name ?? 'tournament').toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || 'event';

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${baseName}-standings-${sectionSlug}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [selectedSectionId, selectedSectionLabel, standings, tournament?.name, tournamentConfig?.details.tiebreaks, tournamentConfig?.details.tiebreaksEnabled, totalRounds, tournamentConfig?.showPrizeAmounts, tournamentConfig?.details.primaryRatingSystem]);

  const generateSwissSysHtmlTable = useCallback((sectionStandings: SwissPlayerStanding[], sectionLabel: string) => {
    const isFide = tournamentConfig?.details.primaryRatingSystem === 'fide';
    
    let html = `<h3 style="font-family: Arial, sans-serif; font-size: 15px; font-weight: bold; margin: 0 0 10px 0; text-align: left;">Wall Chart Standings. ${tournament?.name ?? 'Tournament'}: ${sectionLabel}</h3>\n`;
    html += `<table style="border-collapse: collapse; border: 1px solid black; width: 100%; font-family: Arial, sans-serif; font-size: 13px; color: #000; background-color: #fff; -webkit-print-color-adjust: exact; print-color-adjust: exact;">\n`;
    
    // Headers
    html += `<thead>\n  <tr style="border: 1px solid black; padding: 6px 8px;">\n`;
    html += `    <td style="background-color: #e8e8e8; border: 1px solid black; font-weight: bold; padding: 6px 8px; text-align: center; width: 35px;">#</td>\n`;
    html += `    <td style="background-color: #e8e8e8; border: 1px solid black; font-weight: bold; padding: 6px 8px; text-align: left; width: 200px;">Name</td>\n`;
    html += `    <td style="background-color: #e8e8e8; border: 1px solid black; font-weight: bold; padding: 6px 8px; text-align: left; width: 60px;">Rating</td>\n`;
    for (let r = 1; r <= totalRounds; r++) {
      html += `    <td style="background-color: #e8e8e8; border: 1px solid black; font-weight: bold; padding: 6px 8px; text-align: center; width: 55px;">Rd ${r}</td>\n`;
    }
    html += `    <td style="background-color: #e8e8e8; border: 1px solid black; font-weight: bold; padding: 6px 8px; text-align: center; width: 50px;">Total</td>\n`;
    activeTiebreakRules.forEach((rule) => {
      html += `    <td style="background-color: #e8e8e8; border: 1px solid black; font-weight: bold; padding: 6px 8px; text-align: center; width: 60px;">${rule}</td>\n`;
    });
    html += `    <td style="background-color: #e8e8e8; border: 1px solid black; font-weight: bold; padding: 6px 8px; text-align: center; width: 60px;">Est. Post</td>\n`;
    html += `    <td style="background-color: #e8e8e8; border: 1px solid black; font-weight: bold; padding: 6px 8px; text-align: center; width: 60px;">Perf.</td>\n`;
    if (tournamentConfig?.prizesEnabled && showPrizes) {
      html += `    <td style="background-color: #e8e8e8; border: 1px solid black; font-weight: bold; padding: 6px 8px; text-align: left; width: 110px;">Prizes</td>\n`;
    }
    html += `  </tr>\n</thead>\n<tbody>\n`;
    
    // Rows
    sectionStandings.forEach((standing) => {
      const playerRating = (isFide ? (standing.player.fideRating ?? standing.player.rating) : (standing.player.uscfRating ?? standing.player.rating)) || 'Unrated';
      const lastName = standing.player.lastName || '';
      const firstName = standing.player.firstName || '';
      const nameStr = lastName && firstName ? `${lastName}, ${firstName}` : `${firstName} ${lastName}`.trim();
      
      html += `  <tr style="border: 1px solid black; padding: 6px 8px;">\n`;
      html += `    <td style="border: 1px solid black; padding: 6px 8px; text-align: center;">${standing.position}</td>\n`;
      html += `    <td style="border: 1px solid black; font-weight: bold; padding: 6px 8px; text-align: left;">${nameStr}</td>\n`;
      html += `    <td style="border: 1px solid black; padding: 6px 8px; text-align: left;">${playerRating}</td>\n`;
      
      standing.roundResults.forEach((res) => {
        const resultText = formatRoundResultDisplay(res);
        html += `    <td style="border: 1px solid black; padding: 6px 8px; text-align: center;">${resultText}</td>\n`;
      });
      
      const totalPointsStr = standing.totalPoints.toFixed(1).replace(/\.0$/, "");
      html += `    <td style="border: 1px solid black; font-weight: bold; padding: 6px 8px; text-align: center;">${totalPointsStr}</td>\n`;
      
      activeTiebreakRules.forEach((rule) => {
        const val = standing.tiebreakValues[rule] || 0;
        html += `    <td style="border: 1px solid black; padding: 6px 8px; text-align: center;">${val.toFixed(2)}</td>\n`;
      });

      html += `    <td style="border: 1px solid black; padding: 6px 8px; text-align: center;">${standing.postRating ?? playerRating}</td>\n`;
      html += `    <td style="border: 1px solid black; padding: 6px 8px; text-align: center;">${standing.performanceRating ?? playerRating}</td>\n`;
      
      if (tournamentConfig?.prizesEnabled && showPrizes) {
        const cat = standing.prizeCategory || '---';
        const amt = tournamentConfig?.showPrizeAmounts !== false ? (standing.prizeAmount || '---') : '---';
        const prizeText = cat !== '---' ? `${cat} (${amt})` : '---';
        html += `    <td style="border: 1px solid black; padding: 6px 8px; text-align: left;">${prizeText}</td>\n`;
      }
      html += `  </tr>\n`;
    });
    
    html += `</tbody>\n</table>\n`;
    return html;
  }, [tournament, totalRounds, showPrizes, formatRoundResultDisplay, activeTiebreakRules, tournamentConfig]);

  const handlePrintStandings = useCallback(() => {
    if (standings.length === 0 || typeof window === 'undefined') return;
    const headingSuffix = selectedSectionId === '__all__' ? '' : ` – ${selectedSectionLabel}`;
    const title = `${tournament?.name ?? 'Tournament'} Swiss Standings${headingSuffix}`;
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;

    printWindow.document.write(`<html><head><title>${title}</title><style>
      @media print {
        @page { size: auto; margin: 0; }
        body { margin: 15mm; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      }
      body { font-family: Arial, sans-serif; color: #000; background-color: #fff; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    </style></head><body>`);

    if (selectedSectionId === '__all__') {
      sections.forEach((sec) => {
        const secPlayers = players?.filter(p => playerSectionMap.get(p.id)?.id === sec.id) || [];
        const secMatches = matches?.filter(m => {
          if (m.isExtraGame) return false;
          const wSec = m.whitePlayerId ? playerSectionMap.get(m.whitePlayerId)?.id : undefined;
          const bSec = m.blackPlayerId ? playerSectionMap.get(m.blackPlayerId)?.id : undefined;
          return wSec === sec.id || bSec === sec.id;
        }) || [];
        const secPairings = pairings?.filter(p => playerSectionMap.get(p.playerId)?.id === sec.id) || [];
        const secStandings = calculateSwissStandings(secPlayers, secMatches, secPairings);
        
        if (secStandings.length > 0) {
          printWindow.document.write(generateSwissSysHtmlTable(secStandings, sec.name));
          printWindow.document.write('<br/><br/>');
        }
      });
    } else {
      printWindow.document.write(generateSwissSysHtmlTable(standings, selectedSectionLabel));
    }
    
    printWindow.document.write('</body></html>');
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => {
      printWindow.print();
    }, 250);
  }, [standings, selectedSectionId, selectedSectionLabel, tournament?.name, players, matches, pairings, playerSectionMap, sections, calculateSwissStandings, generateSwissSysHtmlTable]);

  const downloadHtmlStandings = useCallback(() => {
    if (standings.length === 0 || typeof window === 'undefined') return;
    const headingSuffix = selectedSectionId === '__all__' ? '' : ` – ${selectedSectionLabel}`;
    const title = `${tournament?.name ?? 'Tournament'} Swiss Standings${headingSuffix}`;
    
    let htmlContent = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>${title}</title>
<style>
body { font-family: Arial, sans-serif; padding: 20px; color: #000; background-color: #fff; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
h3 { font-family: Arial, sans-serif; margin-top: 20px; }
a { color: #0066cc; text-decoration: none; }
a:hover { text-decoration: underline; }
</style>
</head>
<body>
`;

    if (selectedSectionId === '__all__') {
      sections.forEach((sec) => {
        const secPlayers = players?.filter(p => playerSectionMap.get(p.id)?.id === sec.id) || [];
        const secMatches = matches?.filter(m => {
          if (m.isExtraGame) return false;
          const wSec = m.whitePlayerId ? playerSectionMap.get(m.whitePlayerId)?.id : undefined;
          const bSec = m.blackPlayerId ? playerSectionMap.get(m.blackPlayerId)?.id : undefined;
          return wSec === sec.id || bSec === sec.id;
        }) || [];
        const secPairings = pairings?.filter(p => playerSectionMap.get(p.playerId)?.id === sec.id) || [];
        const secStandings = calculateSwissStandings(secPlayers, secMatches, secPairings);
        
        if (secStandings.length > 0) {
          htmlContent += generateSwissSysHtmlTable(secStandings, sec.name);
          htmlContent += '<br/><br/>\n';
        }
      });
    } else {
      htmlContent += generateSwissSysHtmlTable(standings, selectedSectionLabel);
    }
    
    htmlContent += `
</body>
</html>
`;

    const sectionSlug = selectedSectionId === "__all__"
      ? "all-sections"
      : selectedSectionLabel.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "section";
    const baseName = (tournament?.name ?? 'tournament').toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || 'event';

    const blob = new Blob([htmlContent], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${baseName}-standings-${sectionSlug}.html`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [selectedSectionId, selectedSectionLabel, standings, tournament?.name, players, matches, pairings, playerSectionMap, sections, calculateSwissStandings, generateSwissSysHtmlTable]);

  if (tournamentLoading || playersLoading || matchesLoading || pairingsLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Swiss Tournament Standings</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="animate-pulse space-y-4">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-16 bg-gray-200 rounded-lg"></div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!tournament || !players || !matches || !pairings) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Swiss Tournament Standings</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8">
            <p className="text-gray-500">No tournament data available</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  function formatRoundResult(result: PlayerRoundResult, round: number): string {
    if (result.result === 'bye' || result.result === 'unplayed') {
      if (result.isRequested) {
        if (result.points === 1) return 'B';
        if (result.points === 0.5) return 'H';
        return 'U';
      } else {
        return 'U';
      }
    }

    if (result.result === 'withdrawn') {
      return round <= currentRound ? '---' : '';
    }

    if (!result.opponent) {
      return '---';
    }

    const colorPrefix = result.color === 'white' ? 'W' : 'B';
    const opponentNum = result.opponent?.isActiveTd ? 'TD' : getPlayerPairingNumber(result.opponent.id);

    if (result.result === 'forfeit-win') {
      return `X ${opponentNum}`;
    }

    if (result.result === 'forfeit-loss') {
      return `F ${opponentNum}`;
    }

    if (result.result === 'double-forfeit') {
      return `FF ${opponentNum}`;
    }

    return `${colorPrefix} ${opponentNum}`;
  }

  function formatRoundOpponent(result: PlayerRoundResult): string {
    if (!result.opponent) {
      return '---';
    }

    const colorPrefix = result.color === 'white' ? 'W' : 'B';
    const opponentNum = result.opponent?.isActiveTd ? 'TD' : getPlayerPairingNumber(result.opponent.id);

    if (result.result === 'forfeit-win') {
      return `X ${opponentNum}`;
    }

    if (result.result === 'forfeit-loss') {
      return `F ${opponentNum}`;
    }

    if (result.result === 'double-forfeit') {
      return `FF ${opponentNum}`;
    }

    return `${colorPrefix} ${opponentNum}`;
  }

  function formatRoundResultDisplay(result: PlayerRoundResult): string {
    if (result.result === 'bye' || result.result === 'unplayed') {
      if (result.isRequested) {
        if (result.points === 1) return 'B';
        if (result.points === 0.5) return 'H';
        return 'U';
      } else {
        return 'U';
      }
    }

    if (result.result === 'withdrawn') {
      return '---';
    }

    if (!result.opponent) {
      return '---';
    }

    const colorPrefix = result.color === 'white' ? 'W' : 'B';

    // Show "TD" instead of position number if opponent is the houseplayer
    const opponentDisplayText = result.opponent?.isActiveTd ? 'TD' : getPlayerPairingNumber(result.opponent.id);

    if (result.result === 'forfeit-win') {
      return `X ${opponentDisplayText}`;
    }

    if (result.result === 'forfeit-loss') {
      return `F ${opponentDisplayText}`;
    }

    if (result.result === 'double-forfeit') {
      return `FF ${opponentDisplayText}`;
    }

    // Direct result outcomes: won (W), lost (L), drawn (D)
    // Format matches SwissSys format Color + Opponent Pairing Number (e.g. W 3, B 9, etc.)
    return `${colorPrefix} ${opponentDisplayText}`;
  }

  function formatPoints(standing: SwissPlayerStanding): string {
    if (standing.isWithdrawn) {
      return `U${standing.totalPoints}`;
    }
    return standing.totalPoints.toString();
  }

  const renderRoundOutcomeBadge = (res: PlayerRoundResult) => {
    const text = formatRoundResultDisplay(res);
    if (text === '---') return <span className="text-slate-300 dark:text-slate-700">—</span>;
    
    const outcome = res.result;
    
    if (outcome === 'W' || outcome === 'forfeit-win') {
      return (
        <span className="text-xs font-black text-emerald-600 dark:text-emerald-400 tracking-wide">
          {text}
        </span>
      );
    }
    if (outcome === 'L' || outcome === 'forfeit-loss' || outcome === 'double-forfeit') {
      return (
        <span className="text-xs font-medium text-rose-600 dark:text-rose-455">
          {text}
        </span>
      );
    }
    if (outcome === 'D') {
      return (
        <span className="text-xs font-semibold text-slate-550 dark:text-slate-400">
          {text}
        </span>
      );
    }
    if (outcome === 'bye') {
      return (
        <span className="text-xs font-bold text-indigo-600 dark:text-indigo-400">
          {text}
        </span>
      );
    }
    if (outcome === 'unplayed') {
      return (
        <span className="text-xs font-medium text-slate-400 dark:text-slate-500">
          {text}
        </span>
      );
    }
    return <span className="text-slate-500 dark:text-slate-400 text-xs font-medium">{text}</span>;
  };


  return (
    <Card className="border-none shadow-xl dark:bg-slate-900">
      <CardHeader className="border-b border-slate-100 dark:border-slate-800">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6">
          <div>
            <CardTitle className="text-xl font-black text-slate-900 dark:text-white flex items-center gap-2">
              🏆 Swiss Wall Chart Standings
            </CardTitle>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              San Diego Chess Club Style two-row standings layout
            </p>
            {selectedSectionId !== "__all__" && (
              <p className="text-xs text-muted-foreground mt-0.5">Showing Section: {selectedSectionLabel}</p>
            )}
          </div>
          <div className="flex flex-col items-stretch md:items-end gap-4">
            {(sections.length > 0 || hasExtraGames) && (
              <div className="flex flex-wrap gap-2">
                <Button
                  variant={selectedSectionId === "__all__" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setSelectedSectionId("__all__")}
                  className={selectedSectionId === "__all__" ? "bg-indigo-600 hover:bg-indigo-700" : ""}
                >
                  All Sections
                </Button>
                {sections.map((section) => (
                  <Button
                    key={section.id}
                    variant={selectedSectionId === section.id ? "default" : "outline"}
                    size="sm"
                    onClick={() => setSelectedSectionId(section.id)}
                    className={selectedSectionId === section.id ? "bg-indigo-600 hover:bg-indigo-700" : ""}
                  >
                    {section.name}
                  </Button>
                ))}
                {hasExtraGames && (
                  <Button
                    variant={selectedSectionId === "extra_games" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setSelectedSectionId("extra_games")}
                    className={selectedSectionId === "extra_games" ? "bg-indigo-600 hover:bg-indigo-700" : ""}
                  >
                    Extra Games
                  </Button>
                )}
              </div>
            )}
            <div className="flex flex-wrap items-center justify-end gap-4">
              {/* Prize toggler switch */}
              {tournamentConfig?.prizesEnabled && (
                <div className="flex items-center space-x-2 bg-slate-50 dark:bg-slate-800 px-3 py-1.5 rounded-xl border border-slate-100 dark:border-slate-700">
                  <Switch
                    id="show-prizes-toggle"
                    checked={showPrizes}
                    onCheckedChange={setShowPrizes}
                  />
                  <Label htmlFor="show-prizes-toggle" className="text-xs font-medium text-slate-500 dark:text-slate-400 cursor-pointer">
                    Show Prizes
                  </Label>
                </div>
              )}

              {/* Director-only Prize Amount Toggler */}
              {tournamentConfig?.prizesEnabled && isDirector && (
                <div className="flex items-center space-x-2 bg-slate-50 dark:bg-slate-800 px-3 py-1.5 rounded-xl border border-slate-100 dark:border-slate-700">
                  <Switch
                    id="show-amounts-toggle"
                    checked={tournamentConfig?.showPrizeAmounts !== false}
                    onCheckedChange={(checked) => updateShowPrizeAmountsMutation.mutate(checked)}
                    disabled={updateShowPrizeAmountsMutation.isPending}
                  />
                  <Label htmlFor="show-amounts-toggle" className="text-xs font-medium text-slate-500 dark:text-slate-400 cursor-pointer">
                    {updateShowPrizeAmountsMutation.isPending ? "Saving..." : "Show Payouts"}
                  </Label>
                </div>
              )}

              {showExportControls && (
                <div className="flex items-center gap-2">
                  <Button
                    onClick={handlePrintStandings}
                    variant="outline"
                    size="sm"
                    className="flex items-center gap-2 rounded-xl"
                    disabled={standings.length === 0}
                  >
                    <Printer className="h-4 w-4" />
                    Print
                  </Button>
                  <Button
                    onClick={downloadHtmlStandings}
                    variant="outline"
                    size="sm"
                    className="flex items-center gap-2 rounded-xl"
                    disabled={standings.length === 0}
                  >
                    <Download className="h-4 w-4" />
                    SwissSys HTML
                  </Button>
                  <Button
                    onClick={downloadStandings}
                    variant="outline"
                    size="sm"
                    className="flex items-center gap-2 rounded-xl"
                    disabled={standings.length === 0}
                  >
                    <Download className="h-4 w-4" />
                    CSV
                  </Button>
                </div>
              )}
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {standings.length === 0 ? (
          <div className="text-center py-16 text-slate-500 dark:text-slate-400">
            No standings available yet
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse border border-slate-200 dark:border-slate-800">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-800/85 border-b border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300">
                  <th className="px-3 py-3 text-center text-xs font-bold w-12 border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/80">
                    #
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-bold border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/80">
                    Name
                  </th>
                  <th className="px-3 py-3 text-left text-xs font-bold w-20 border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/80">
                    Rating
                  </th>
                  {Array.from({ length: totalRounds }, (_, i) => (
                    <th key={i} className="px-3 py-3 text-center text-xs font-bold w-16 border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/80">
                      Rd {i + 1}
                    </th>
                  ))}
                  <th className="px-3 py-3 text-center text-xs font-bold w-20 border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/80">
                    Total points
                  </th>
                  {activeTiebreakRules.map((rule) => (
                    <th key={rule} className="px-3 py-3 text-center text-xs font-bold w-20 border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/80">
                      {rule}
                    </th>
                  ))}
                  <th className="px-3 py-3 text-center text-xs font-bold w-20 border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/80">
                    Est. Post
                  </th>
                  <th className="px-3 py-3 text-center text-xs font-bold w-20 border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/80">
                    Perf.
                  </th>
                  {tournamentConfig?.prizesEnabled && showPrizes && (
                    <th className="px-4 py-3 text-left text-xs font-bold w-36 border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/80">
                      Prizes
                    </th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {standings.map((standing) => {
                  const isFide = tournamentConfig?.details.primaryRatingSystem === 'fide';
                  const playerRating = (isFide ? (standing.player.fideRating ?? standing.player.rating) : (standing.player.uscfRating ?? standing.player.rating)) || 'Unrated';
                  const lastName = standing.player.lastName || '';
                  const firstName = standing.player.firstName || '';
                  const nameStr = lastName && firstName ? `${lastName}, ${firstName}` : `${firstName} ${lastName}`.trim();
                  
                  const uscfId = standing.player.localId;
                  const isDigitsOnly = !!(uscfId && /^\d+$/.test(uscfId));
                  const isWithdrawn = standing.player.status === 'withdrawn' || standing.isWithdrawn;

                  return (
                    <tr
                      key={standing.player.id}
                      className={cn(
                        "hover:bg-indigo-50/20 dark:hover:bg-indigo-950/10 transition-colors",
                        isWithdrawn ? "opacity-60 bg-slate-50/50 dark:bg-slate-900/40 line-through text-slate-450 dark:text-slate-550" : ""
                      )}
                    >
                      <td className="px-3 py-2.5 text-center font-mono text-sm font-semibold border border-slate-200 dark:border-slate-800">
                        {standing.position}
                      </td>
                      <td className="px-4 py-2.5 text-sm font-semibold text-slate-800 dark:text-slate-100 border border-slate-200 dark:border-slate-800">
                        <div className="flex items-center gap-1.5">
                          {isDigitsOnly ? (
                            <a
                              href={`http://www.uschess.org/msa/MbrDtlMain.php?${uscfId}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="font-semibold text-indigo-650 dark:text-indigo-400 hover:underline transition-colors"
                            >
                              {nameStr}
                            </a>
                          ) : (
                            <span>{nameStr}</span>
                          )}
                          {standing.player.isActiveTd && (
                            <Badge variant="outline" className="text-[10px] py-0 px-1.5 border-slate-200 dark:border-slate-800 text-slate-400 dark:text-slate-500 font-normal">substitute</Badge>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-sm text-slate-600 dark:text-slate-350 border border-slate-200 dark:border-slate-800 font-mono">
                        {playerRating}
                      </td>
                      {standing.roundResults.map((result, roundIdx) => (
                        <td key={roundIdx} className="px-3 py-2.5 text-center border border-slate-200 dark:border-slate-800 bg-white/10 dark:bg-slate-950/5">
                          {renderRoundOutcomeBadge(result)}
                        </td>
                      ))}
                      <td className="px-3 py-2.5 text-center font-bold text-slate-900 dark:text-white border border-slate-200 dark:border-slate-800 font-mono bg-slate-50/50 dark:bg-slate-900/20">
                        {standing.totalPoints.toFixed(1).replace(/\.0$/, "")}
                      </td>
                      {activeTiebreakRules.map((rule) => {
                        const val = standing.tiebreakValues[rule];
                        return (
                          <td key={rule} className="px-3 py-2.5 text-center text-sm font-mono text-slate-600 dark:text-slate-350 border border-slate-200 dark:border-slate-800">
                            {val !== undefined ? val.toFixed(2) : "0.00"}
                          </td>
                        );
                      })}
                      <td className="px-3 py-2.5 text-center text-sm font-mono text-slate-600 dark:text-slate-350 border border-slate-200 dark:border-slate-800 bg-slate-50/10 dark:bg-slate-900/5">
                        {standing.postRating ?? playerRating}
                      </td>
                      <td className="px-3 py-2.5 text-center text-sm font-mono text-slate-600 dark:text-slate-350 border border-slate-200 dark:border-slate-800 bg-slate-50/10 dark:bg-slate-900/5">
                        {standing.performanceRating ?? playerRating}
                      </td>
                      {tournamentConfig?.prizesEnabled && showPrizes && (
                        <td className="px-4 py-2.5 text-left text-sm border border-slate-200 dark:border-slate-800">
                          {standing.prizeCategory && standing.prizeCategory !== '---' ? (
                            <div className="flex flex-col gap-0.5">
                              <Badge className="bg-indigo-50 dark:bg-indigo-950/30 text-indigo-650 dark:text-indigo-400 border border-indigo-100 dark:border-indigo-900/30 font-semibold text-[11px] py-0.5 px-2 hover:bg-indigo-50 dark:hover:bg-indigo-900/40 shadow-sm w-fit">
                                {standing.prizeCategory}
                              </Badge>
                              {tournamentConfig?.showPrizeAmounts !== false && standing.prizeAmount !== '---' && (
                                <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400 pl-1">
                                  {standing.prizeAmount}
                                </span>
                              )}
                            </div>
                          ) : (
                            <span className="text-slate-350 dark:text-slate-750 font-medium">—</span>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
