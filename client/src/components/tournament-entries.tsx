import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, Users } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { Pairing, Player } from "@shared/schema";
import { apiRequest } from "@/lib/queryClient";

interface TournamentEntriesProps {
  tournamentId: number;
  players: Player[];
}

function formatByeBadge(byeType: string | null | undefined) {
  switch (byeType) {
    case "half_point": return { label: "½ Bye", color: "bg-amber-100 text-amber-700 border-amber-200" };
    case "full_point": return { label: "1 Bye", color: "bg-emerald-100 text-emerald-700 border-emerald-200" };
    case "zero_point": return { label: "0 Bye", color: "bg-slate-100 text-slate-600 border-slate-200" };
    default: return { label: "Bye", color: "bg-slate-100 text-slate-600 border-slate-200" };
  }
}

export default function TournamentEntries({ tournamentId, players }: TournamentEntriesProps) {
  const { data: pairings = [], isLoading } = useQuery<Pairing[]>({
    queryKey: ["/api/tournaments", tournamentId, "pairings"],
    queryFn: async () => {
      return (await apiRequest(`/api/tournaments/${tournamentId}/pairings`)) as Pairing[];
    },
  });

  // Build a map: playerId -> list of { round, byeType }
  const byesByPlayer = useMemo(() => {
    const map = new Map<number, { round: number; byeType: string | null | undefined }[]>();
    for (const p of pairings) {
      if (!p.isBye || !p.playerId) continue;
      const arr = map.get(p.playerId) ?? [];
      arr.push({ round: p.round, byeType: p.byeType });
      map.set(p.playerId, arr);
    }
    return map;
  }, [pairings]);

  // Only show active players, sorted by section then last name
  const sortedPlayers = useMemo(() => {
    return [...players]
      .filter(p => p.status === "active" || !p.status)
      .sort((a, b) => {
        const sectionCmp = (a.sectionName ?? "").localeCompare(b.sectionName ?? "");
        if (sectionCmp !== 0) return sectionCmp;
        return `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`);
      });
  }, [players]);

  if (isLoading) {
    return (
      <Card className="border-none shadow-sm">
        <CardContent className="flex items-center justify-center gap-3 py-16 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin text-indigo-500" />
          Loading entries…
        </CardContent>
      </Card>
    );
  }

  if (!sortedPlayers.length) {
    return (
      <Card className="border-none shadow-sm">
        <CardHeader className="border-b border-slate-100">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Users className="h-5 w-5 text-indigo-500" />
            Entries
          </CardTitle>
        </CardHeader>
        <CardContent className="py-16 text-center text-sm text-slate-500">
          No players have been registered yet.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-none shadow-sm dark:bg-slate-900">
      <CardHeader className="border-b border-slate-100 dark:border-slate-800">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Users className="h-5 w-5 text-indigo-500" />
          <span>Entries</span>
          <span className="ml-1 text-sm font-semibold text-slate-400">({sortedPlayers.length})</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow className="bg-slate-50 dark:bg-slate-800/50">
              <TableHead className="pl-6 font-bold text-slate-600 w-8">#</TableHead>
              <TableHead className="font-bold text-slate-600">Name</TableHead>
              <TableHead className="font-bold text-slate-600">Section</TableHead>
              <TableHead className="font-bold text-slate-600">Rating</TableHead>
              <TableHead className="font-bold text-slate-600 pr-6">Byes</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedPlayers.map((player, idx) => {
              const playerByes = byesByPlayer.get(player.id) ?? [];
              const displayRating = player.uscfRating ?? player.fideRating ?? player.rating ?? "—";
              return (
                <TableRow key={player.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/30 transition-colors">
                  <TableCell className="pl-6 text-xs text-slate-400 font-semibold">{idx + 1}</TableCell>
                  <TableCell className="font-semibold text-slate-800 dark:text-slate-200">
                    {player.firstName} {player.lastName}
                  </TableCell>
                  <TableCell className="text-slate-600 dark:text-slate-400 text-sm">
                    {player.sectionName ? (
                      <span className="bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 text-xs font-bold px-2 py-0.5 rounded-full border border-indigo-100 dark:border-indigo-800">
                        {player.sectionName}
                      </span>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-slate-700 dark:text-slate-300 font-semibold text-sm">
                    {displayRating}
                  </TableCell>
                  <TableCell className="pr-6">
                    {playerByes.length === 0 ? (
                      <span className="text-slate-400 text-xs">—</span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {playerByes
                          .sort((a, b) => a.round - b.round)
                          .map(({ round, byeType }) => {
                            const { label, color } = formatByeBadge(byeType);
                            return (
                              <span
                                key={round}
                                className={`inline-flex items-center text-[10px] font-bold px-1.5 py-0.5 rounded border ${color}`}
                              >
                                R{round} {label}
                              </span>
                            );
                          })}
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
