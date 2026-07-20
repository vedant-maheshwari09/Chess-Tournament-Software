import { useQuery } from "@tanstack/react-query";
import { useMemo, useState, useCallback, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Trophy, Medal, Award, Printer, Download } from "lucide-react";
import type { Player, Match, Pairing, Tournament } from "@shared/schema";
import { parseTournamentConfig } from "@/lib/tournament-config";
import type { SectionDefinition } from "@shared/tournament-config";
import { cn } from "@/lib/utils";
import { resolveDisplayRating } from "@shared/tournament-config";

interface StandingsProps {
  tournamentId: number;
  showExportControls?: boolean;
}

interface PlayerStanding {
  player: Player;
  points: number;
  gamesPlayed: number;
  wins: number;
  draws: number;
  losses: number;
  position: number;
}

export default function Standings({ tournamentId, showExportControls = true }: StandingsProps) {
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

  const tournamentConfig = useMemo(() => (tournament ? parseTournamentConfig(tournament) : null), [tournament]);
  const sections = useMemo<SectionDefinition[]>(() => {
    if (!tournamentConfig) return [];
    return (tournamentConfig.sections ?? []).filter((section) => section.name.trim().length > 0);
  }, [tournamentConfig]);
  const [selectedSectionId, setSelectedSectionId] = useState<string>("__all__");
  const selectedSectionLabel = useMemo(() => {
    if (selectedSectionId === "__all__") return "All Sections";
    return sections.find((section) => section.id === selectedSectionId)?.name ?? "All Sections";
  }, [sections, selectedSectionId]);

  useEffect(() => {
    setSelectedSectionId((prev) => {
      if (prev === "__all__") return prev;
      return sections.some((section) => section.id === prev) ? prev : sections[0]?.id ?? "__all__";
    });
  }, [sections]);

  const playerSectionMap = useMemo(() => {
    const map = new Map<number, SectionDefinition>();
    if (!players) return map;
    const sectionsByName = new Map<string, SectionDefinition>();
    sections.forEach((section) => sectionsByName.set(section.name.trim().toLowerCase(), section));
    players.forEach((player) => {
      let assigned: SectionDefinition | undefined;
      if (player.sectionId) {
        assigned = sections.find((section) => section.id === player.sectionId);
      }
      if (!assigned && player.sectionName) {
        assigned = sectionsByName.get(player.sectionName.trim().toLowerCase());
      }
      if (!assigned && sections.length) {
        const rating = typeof player.rating === "number" ? player.rating : Number(player.rating);
        if (!Number.isNaN(rating)) {
          assigned = sections.find((section) => {
            const minOk = section.ratingMin === null || rating >= section.ratingMin;
            const maxOk = section.ratingMax === null || rating <= section.ratingMax;
            return minOk && maxOk;
          });
        }
      }
      if (!assigned && sections.length) {
        assigned = sections[0];
      }
      if (assigned) {
        map.set(player.id, assigned);
      }
    });
    return map;
  }, [players, sections]);

  const filteredPlayers = useMemo(() => {
    if (!players) return [] as Player[];
    if (selectedSectionId === "__all__") return players;
    return players.filter((player) => playerSectionMap.get(player.id)?.id === selectedSectionId);
  }, [players, playerSectionMap, selectedSectionId]);

  const calculateStandings = useCallback((): PlayerStanding[] => {
    if (!filteredPlayers.length || !matches) return [];

    const pairingsList = pairings ?? [];
    const currentRound = matches.length > 0 ? Math.max(...matches.map((m) => m.round)) : 0;

    const standings: PlayerStanding[] = filteredPlayers.map((player) => {
      const playerMatches = matches.filter(
        match => {
          const isWhite = match.whitePlayerId === player.id;
          const isBlack = match.blackPlayerId === player.id;
          if (!isWhite && !isBlack) return false;

          // If the match has an explicit sectionId, check if it matches the player's sectionId
          if (match.sectionId) {
            const matchSec = match.sectionId || "";
            const playerSec = player.sectionId || "";
            if (matchSec.trim() !== playerSec.trim()) {
              return false;
            }
          }
          return true;
        }
      );

      // Get bye pairings for this player - ONLY for completed/current rounds
      const playerByes = pairingsList.filter(
        (pairing: any) =>
          pairing.playerId === player.id &&
          pairing.isBye &&
          pairing.points !== null &&
          pairing.round <= currentRound,
      );

      let points = 0;
      let wins = 0;
      let draws = 0;
      let losses = 0;

      // Add points from matches
      playerMatches.forEach(match => {
        if (!match.result) return;

        const isWhite = match.whitePlayerId === player.id;
        
        if (match.result === '1-0') {
          if (isWhite) {
            wins++;
            points += 1;
          } else {
            losses++;
          }
        } else if (match.result === '0-1') {
          if (isWhite) {
            losses++;
          } else {
            wins++;
            points += 1;
          }
        } else if (match.result === '1/2-1/2') {
          draws++;
          points += 0.5;
        }
      });

      // Add points from byes (convert from integer mapping: 0=0pts, 1=0.5pts, 2=1pt)
      playerByes.forEach((bye: any) => {
        const byePoints = bye.points === 1 ? 0.5 : bye.points === 2 ? 1 : 0;
        points += byePoints;
        if (bye.points === 2) {
          wins++; // Full point bye counts as win
        }
        // Half-point byes don't count as wins/draws/losses for record purposes
      });

      return {
        player,
        points,
        gamesPlayed: playerMatches.filter(m => m.result).length + playerByes.length,
        wins,
        draws,
        losses,
        position: 0, // Will be set after sorting
      };
    });

    // Sort by points (descending), then by rating (descending)
    standings.sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      const isFide = tournamentConfig?.details.primaryRatingSystem === 'fide';
      const ratingA = (isFide ? (a.player.fideRating ?? a.player.rating) : (a.player.uscfRating ?? a.player.rating)) || 0;
      const ratingB = (isFide ? (b.player.fideRating ?? b.player.rating) : (b.player.uscfRating ?? b.player.rating)) || 0;
      return ratingB - ratingA;
    });

    // Assign positions
    standings.forEach((standing, index) => {
      standing.position = index + 1;
    });

    return standings;
  }, [filteredPlayers, matches, pairings, tournamentConfig]);

  const standings = useMemo(() => calculateStandings(), [calculateStandings]);
  const hasStandings = standings.length > 0;

  const handlePrintStandings = useCallback(() => {
    if (!hasStandings || typeof window === "undefined") return;
    const headingSuffix = selectedSectionId === "__all__" ? "" : ` – ${selectedSectionLabel}`;
    const title = `${tournament?.name ?? "Tournament"} Standings${headingSuffix}`;
    const printWindow = window.open("", "_blank");
    if (!printWindow) return;

    printWindow.document.write(
      `<html><head><title>${title}</title><style>body{font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;padding:24px;color:#0f172a;}h1{font-size:24px;margin-bottom:16px;}table{width:100%;border-collapse:collapse;}th,td{border:1px solid #cbd5f5;padding:8px;text-align:left;font-size:14px;}th{background:#f1f5f9;text-transform:uppercase;font-size:12px;color:#475569;letter-spacing:0.05em;}</style></head><body>`,
    );
    printWindow.document.write(`<h1>${title}</h1>`);
    printWindow.document.write(`<table><thead><tr><th>Rank</th><th>Player</th><th>Points</th><th>Games</th><th>W-D-L</th><th>Rating</th></tr></thead><tbody>`);
    standings.forEach((standing) => {
      const isFide = tournamentConfig?.details.primaryRatingSystem === 'fide';
      const threshold = tournamentConfig?.registers?.uscfMinGamesThreshold ?? 4;
      const uscfDisp = resolveDisplayRating((standing.player as any).uscfRatingRaw, standing.player.uscfRating, threshold, false);
      const fideDisp = resolveDisplayRating((standing.player as any).fideRatingRaw, standing.player.fideRating, 0, true);
      const playerRating = isFide
        ? (fideDisp !== "Unrated" ? fideDisp : uscfDisp)
        : (uscfDisp !== "Unrated" ? uscfDisp : fideDisp);
      const playerName = `${standing.player.firstName} ${standing.player.lastName}`.trim();
      const record = `${standing.wins}-${standing.draws}-${standing.losses}`;
      printWindow.document.write(
        `<tr><td>${standing.position}</td><td>${playerName}</td><td>${standing.points}</td><td>${standing.gamesPlayed}</td><td>${record}</td><td>${playerRating}</td></tr>`,
      );
    });
    printWindow.document.write(`</tbody></table></body></html>`);
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
  }, [hasStandings, selectedSectionId, selectedSectionLabel, standings, tournament?.name, tournamentConfig]);

  const handleDownloadStandings = useCallback(() => {
    if (!hasStandings || typeof window === "undefined") return;
    const rows: string[][] = [["Rank", "Player", "Points", "Games", "Record", "Rating"]];
    standings.forEach((standing) => {
      const playerName = `${standing.player.firstName} ${standing.player.lastName}`.trim();
      const record = `${standing.wins}-${standing.draws}-${standing.losses}`;
      const isFide = tournamentConfig?.details.primaryRatingSystem === 'fide';
      const playerRating = (isFide ? ((standing.player as any).fideRatingRaw || standing.player.fideRating || standing.player.rating) : ((standing.player as any).uscfRatingRaw || standing.player.uscfRating || standing.player.rating));
      rows.push([
        String(standing.position),
        playerName,
        String(standing.points),
        String(standing.gamesPlayed),
        record,
        playerRating != null ? String(playerRating) : "",
      ]);
    });

    const csv = rows
      .map((row) =>
        row
          .map((value) => {
            const safe = value.replace(/"/g, '""');
            return `"${safe}"`;
          })
          .join(","),
      )
      .join("\r\n");

    const sectionSlug = selectedSectionId === "__all__"
      ? "all-sections"
      : selectedSectionLabel.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "section";
    const baseName = (tournament?.name ?? "tournament").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "event";
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${baseName}-standings-${sectionSlug}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [hasStandings, selectedSectionId, selectedSectionLabel, standings, tournament?.name, tournamentConfig]);

  if (tournamentLoading || playersLoading || matchesLoading || pairingsLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Tournament Standings</CardTitle>
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

  const getPositionIcon = (position: number) => {
    switch (position) {
      case 1:
        return <Trophy className="h-5 w-5 text-slate-500" />;
      case 2:
        return <Medal className="h-5 w-5 text-gray-400" />;
      case 3:
        return <Award className="h-5 w-5 text-blue-600" />;
      default:
        return <span className="text-gray-500 font-medium">{position}</span>;
    }
  };

  const getPositionBadge = (position: number) => {
    if (position <= 3) {
      return <Badge variant="default" className="bg-slate-100 text-slate-800">Top 3</Badge>;
    }
    return null;
  };

  return (
    <Card>
      <CardHeader className="gap-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <CardTitle>Tournament Standings</CardTitle>
            <p className="mt-1 text-sm text-gray-600">Current rankings based on points and performance</p>
            {selectedSectionId !== "__all__" && (
              <p className="text-xs text-muted-foreground">Showing results for {selectedSectionLabel}</p>
            )}
          </div>
          <div className="flex flex-col items-end gap-3">
            {sections.length > 0 && (
              <div className="flex flex-wrap justify-end gap-2">
                <Button
                  variant={selectedSectionId === "__all__" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setSelectedSectionId("__all__")}
                >
                  All Sections
                </Button>
                {sections.map((section) => (
                  <Button
                    key={section.id}
                    variant={selectedSectionId === section.id ? "default" : "outline"}
                    size="sm"
                    onClick={() => setSelectedSectionId(section.id)}
                  >
                    {section.name}
                  </Button>
                ))}
              </div>
            )}
            {showExportControls ? (
              <div className="flex flex-wrap justify-end gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handlePrintStandings}
                  disabled={!hasStandings}
                >
                  <Printer className="mr-2 h-4 w-4" />
                  Print
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleDownloadStandings}
                  disabled={!hasStandings}
                >
                  <Download className="mr-2 h-4 w-4" />
                  Download
                </Button>
              </div>
            ) : null}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {standings.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-gray-500">
              {selectedSectionId === "__all__" ? "No standings available yet" : "No standings available for this section yet"}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <div className="overflow-hidden border border-slate-100 dark:border-slate-800 rounded-2xl shadow-sm bg-white dark:bg-slate-950">
              <table className="min-w-full divide-y divide-slate-100 dark:divide-slate-800/40">
                <thead className="bg-slate-50/80 dark:bg-slate-900/60">
                  <tr>
                    <th className="px-6 py-3.5 text-left text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider w-16">
                      Rank
                    </th>
                    <th className="px-6 py-3.5 text-left text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                      Player
                    </th>
                    <th className="px-6 py-3.5 text-center text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                      Points
                    </th>
                    <th className="px-6 py-3.5 text-center text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                      Games
                    </th>
                    <th className="px-6 py-3.5 text-center text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                      W-D-L
                    </th>
                    <th className="px-6 py-3.5 text-center text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                      Rating
                    </th>
                    <th className="px-6 py-3.5 text-center text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white dark:bg-slate-950 divide-y divide-slate-100 dark:divide-slate-800/40">
                  {standings.map((standing) => (
                    <tr key={standing.player.id} className="group hover:bg-indigo-50/20 dark:hover:bg-indigo-950/10 transition-colors">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center">
                          {standing.position <= 3 ? (
                            <div className="flex items-center justify-center w-8 h-8 rounded-full bg-gradient-to-br from-amber-100 to-amber-50 dark:from-amber-900/40 dark:to-amber-800/20 shadow-sm border border-amber-200/50 dark:border-amber-700/30">
                              {getPositionIcon(standing.position)}
                            </div>
                          ) : (
                            <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-800 font-mono text-sm font-black text-slate-600 dark:text-slate-400 border border-slate-200/40 dark:border-slate-700/40 group-hover:bg-indigo-100/40 group-hover:border-indigo-200/30 transition-colors">
                              {standing.position}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex flex-col">
                          <span className="font-semibold text-slate-800 dark:text-slate-100 text-sm group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
                            {standing.player.firstName} {standing.player.lastName}
                          </span>
                          <span className="text-[10px] font-mono font-medium text-slate-400 dark:text-slate-500">
                            {standing.player.localId ? `ID: ${standing.player.localId}` : 'No ID'}
                          </span>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-center">
                        <span className="inline-flex items-center justify-center px-2.5 py-1 rounded-lg text-sm font-black font-mono shadow-sm border bg-indigo-50 dark:bg-indigo-950/30 text-indigo-700 dark:text-indigo-400 border-indigo-100 dark:border-indigo-900/30">
                          {standing.points}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-center font-medium text-slate-600 dark:text-slate-400">
                        {standing.gamesPlayed}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-center">
                        <Badge variant="outline" className="bg-slate-50 dark:bg-slate-900 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700">
                          {standing.wins}-{standing.draws}-{standing.losses}
                        </Badge>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-center font-medium text-slate-600 dark:text-slate-400">
                                {(() => {
                                  const isFide = tournamentConfig?.details.primaryRatingSystem === 'fide';
                                  const threshold = tournamentConfig?.registers?.uscfMinGamesThreshold ?? 4;
                                  const uscfDisp = resolveDisplayRating((standing.player as any).uscfRatingRaw, standing.player.uscfRating, threshold, false);
                                  const fideDisp = resolveDisplayRating((standing.player as any).fideRatingRaw, standing.player.fideRating, 0, true);
                                  const display = isFide
                                    ? (fideDisp !== "Unrated" ? fideDisp : uscfDisp)
                                    : (uscfDisp !== "Unrated" ? uscfDisp : fideDisp);
                                  return display;
                                })()}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-center">
                        <Badge
                          variant="outline"
                          className={cn(
                            "font-medium",
                            standing.player.status === "withdrawn"
                              ? "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/30 dark:text-rose-400 dark:border-rose-900/30"
                              : "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-400 dark:border-emerald-900/30",
                          )}
                        >
                          {standing.player.status === "withdrawn" ? "Withdrawn" : "Active"}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
