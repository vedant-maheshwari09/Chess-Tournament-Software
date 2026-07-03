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

import type { SwissStandingsProps, SwissPlayerStanding, PlayerRoundResult } from "./types";
import { calculateSwissStandings, interpretPlayerResult } from "./calculations";
import { StandingsTable } from "./standings-table";

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
  const [showPrizes, setShowPrizes] = useState<boolean>(false);

  const tournamentConfig = useMemo(() => (tournament ? parseTournamentConfig(tournament) : null), [tournament]);

  const hasExtraGames = useMemo(() => {
    return (matches?.some(m => m.isExtraGame) ?? false) || !!tournamentConfig?.registers?.allowExtraGames;
  }, [matches, tournamentConfig]);

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
    const standardPlayers = players.filter(player => player.status !== 'guest' && player.status !== 'houseplayer');
    if (selectedSectionId === "__all__") return standardPlayers;
    return standardPlayers.filter((player) => playerSectionMap.get(player.id)?.id === selectedSectionId);
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


  const standings = useMemo(
    () => calculateSwissStandings(filteredPlayers, filteredMatches, filteredPairings, playerById, tournament, selectedSectionId, selectedSectionLabel, tournamentConfig),
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
    
    let html = `<h3 style="font-family: Arial, sans-serif; font-size: 15px; font-weight: bold; margin: 0 0 10px 0; text-align: left;">SwissSys Wall Chart. ${tournament?.name ?? 'Tournament'}: ${sectionLabel}</h3>\n`;
    html += `<table style="border-collapse: collapse; border: 1px solid black; width: 100%; font-family: Arial, sans-serif; font-size: 13px; color: #000; background-color: #fff;">\n`;
    
    // Headers
    html += `<thead>\n  <tr style="border: 1px solid black; padding: 6px 8px;">\n`;
    html += `    <td style="background-color: #e8e8e8; border: 1px solid black; font-weight: bold; padding: 6px 8px; text-align: center; width: 45px;">#</td>\n`;
    html += `    <td style="background-color: #e8e8e8; border: 1px solid black; font-weight: bold; padding: 6px 8px; text-align: left; width: 200px;">Name/Rating/ID</td>\n`;
    for (let r = 1; r <= totalRounds; r++) {
      html += `    <td style="background-color: #e8e8e8; border: 1px solid black; font-weight: bold; padding: 6px 8px; text-align: center; width: 55px;">Rd ${r}</td>\n`;
    }
    html += `    <td style="background-color: #e8e8e8; border: 1px solid black; font-weight: bold; padding: 6px 8px; text-align: center; width: 50px;">Total</td>\n`;
    if (tournamentConfig?.prizesEnabled && showPrizes) {
      html += `    <td style="background-color: #e8e8e8; border: 1px solid black; font-weight: bold; padding: 6px 8px; text-align: left; width: 110px;">Prizes</td>\n`;
    }
    html += `  </tr>\n</thead>\n<tbody>\n`;
    
    // Rows
    sectionStandings.forEach((standing, index) => {
      const playerRating = (isFide ? (standing.player.fideRating ?? standing.player.rating) : (standing.player.uscfRating ?? standing.player.rating)) || 'Unrated';
      const playerID = standing.player.localId || '';
      const lastName = standing.player.lastName || '';
      const firstName = standing.player.firstName || '';
      const playerName = lastName && firstName ? `${lastName}, ${firstName}` : `${firstName} ${lastName}`.trim();
      
      const pairingNum = getPlayerPairingNumber(standing.player.id);
      const uscfId = standing.player.localId;
      const isDigitsOnly = uscfId && /^\d+$/.test(uscfId);
      
      const nameHtml = isDigitsOnly 
        ? `<a href="http://www.uschess.org/msa/MbrDtlMain.php?${uscfId}" target="_blank" style="color: #0066cc; text-decoration: none; font-weight: bold;">${playerName}</a>` 
        : playerName;
        
      // Row 1: Pairing No, Name, Round results, Total Points, Prize Category
      html += `  <tr style="border: 1px solid black; padding: 6px 8px;">\n`;
      html += `    <td style="background-color: #e8e8e8; border: 1px solid black; font-weight: bold; padding: 6px 8px; text-align: center;">${index + 1}</td>\n`;
      html += `    <td style="border: 1px solid black; font-weight: bold; padding: 6px 8px; text-align: left;">${nameHtml}</td>\n`;
      
      standing.roundResults.forEach((res) => {
        const resultText = formatRoundResultDisplay(res);
        html += `    <td style="border: 1px solid black; padding: 6px 8px; text-align: center;">${resultText}</td>\n`;
      });
      
      const totalPointsStr = standing.totalPoints.toFixed(1).replace(/\.0$/, "");
      html += `    <td style="border: 1px solid black; font-weight: bold; padding: 6px 8px; text-align: center;">${totalPointsStr}</td>\n`;
      
      if (tournamentConfig?.prizesEnabled && showPrizes) {
        html += `    <td style="border: 1px solid black; padding: 6px 8px; text-align: left;">${standing.prizeCategory || '---'}</td>\n`;
      }
      html += `  </tr>\n`;
      
      // Row 2: Empty, Rating/ID, Cumulative scores, Empty (Total), Prize Amount
      html += `  <tr style="border: 1px solid black; padding: 6px 8px;">\n`;
      html += `    <td style="background-color: #e8e8e8; border: 1px solid black; padding: 6px 8px; text-align: center;">&nbsp;</td>\n`;
      html += `    <td style="border: 1px solid black; padding: 6px 8px; text-align: left;">${playerRating}${playerID ? ` &nbsp;&nbsp; ID: ${playerID}` : ''}</td>\n`;
      
      standing.roundResults.forEach((res, roundIndex) => {
        const cumulative = standing.roundResults
          .slice(0, roundIndex + 1)
          .reduce((sum, entry) => sum + entry.points, 0);
        const cumulativeText = roundIndex < currentRound ? cumulative.toFixed(1) : '';
        html += `    <td style="border: 1px solid black; padding: 6px 8px; text-align: center;">${cumulativeText}</td>\n`;
      });
      
      html += `    <td style="border: 1px solid black; padding: 6px 8px; text-align: center;">&nbsp;</td>\n`;
      
      if (tournamentConfig?.prizesEnabled && showPrizes) {
        const amountText = standing.prizeAmount || '---';
        html += `    <td style="border: 1px solid black; padding: 6px 8px; text-align: left; font-weight: bold;">${amountText}</td>\n`;
      }
      html += `  </tr>\n`;
    });
    
    html += `</tbody>\n</table>\n`;
    return html;
  }, [tournament, totalRounds, showPrizes, getPlayerPairingNumber, formatRoundResultDisplay, currentRound, tournamentConfig]);

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
        const secStandings = calculateSwissStandings(secPlayers, secMatches, secPairings, playerById, tournament, selectedSectionId, selectedSectionLabel, tournamentConfig);
        
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
        const secStandings = calculateSwissStandings(secPlayers, secMatches, secPairings, playerById, tournament, selectedSectionId, selectedSectionLabel, tournamentConfig);
        
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
    if (result.isInProgress) {
      return `GIP${result.board ?? ""}`;
    }

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
    const opponentNum = result.opponent?.isActiveTd 
      ? 'TD' 
      : (result.opponentPosition && result.opponentPosition > 0 ? result.opponentPosition : getPlayerPairingNumber(result.opponent.id));

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
    if (result.isInProgress) {
      return `GIP${result.board ?? ""}`;
    }

    if (!result.opponent) {
      return '---';
    }

    const colorPrefix = result.color === 'white' ? 'W' : 'B';
    const opponentNum = result.opponent?.isActiveTd 
      ? 'TD' 
      : (result.opponentPosition && result.opponentPosition > 0 ? result.opponentPosition : getPlayerPairingNumber(result.opponent.id));

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
    if (result.isInProgress) {
      return `GIP${result.board ?? ""}`;
    }

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
    const opponentDisplayText = result.opponent?.isActiveTd 
      ? 'TD' 
      : (result.opponentPosition && result.opponentPosition > 0 ? result.opponentPosition : getPlayerPairingNumber(result.opponent.id));

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
    if (text === '---') return <span className="text-slate-400 dark:text-slate-600">—</span>;
    return <span className="text-slate-800 dark:text-slate-200 text-xs font-bold font-sans">{text}</span>;
  };


  return (
    <Card className="mx-4 md:mx-0 border border-slate-200 dark:border-slate-800 shadow-xl dark:bg-slate-900">
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
                <div className="flex items-center space-x-2 bg-slate-50 dark:bg-slate-800 px-3 py-1.5 rounded-xl border border-slate-100 dark:border-slate-700 opacity-60">
                  <Switch
                    id="show-prizes-toggle"
                    checked={false}
                    disabled
                  />
                  <Label htmlFor="show-prizes-toggle" className="text-xs font-medium text-slate-500 dark:text-slate-400 cursor-not-allowed">
                    Show Prizes (Coming Soon)
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
      <CardContent className="px-4 pb-4 md:px-6 md:pb-6">
        {standings.length === 0 ? (
          <div className="text-center py-16 text-slate-500 dark:text-slate-400">
            No standings available yet
          </div>
        ) : (
          <StandingsTable
            standings={standings}
            totalRounds={totalRounds}
            activeTiebreakRules={activeTiebreakRules}
            tournamentConfig={tournamentConfig}
            getPlayerPairingNumber={getPlayerPairingNumber}
            renderRoundOutcomeBadge={renderRoundOutcomeBadge}
            formatPoints={formatPoints}
          />
        )}
      </CardContent>
    </Card>
  );
}

