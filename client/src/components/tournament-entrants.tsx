import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Users } from "lucide-react";
import type { Player } from "@shared/schema";

interface TournamentEntrantsProps {
  tournamentId: number;
}

export default function TournamentEntrants({ tournamentId }: TournamentEntrantsProps) {
  const { data: players, isLoading } = useQuery<Player[]>({
    queryKey: [`/api/tournaments/${tournamentId}/players`],
  });

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Entrants
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="animate-pulse space-y-2">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-10 bg-gray-200 rounded"></div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  const sortedPlayers = [...(players || [])].sort((a, b) => {
    const ratingA = a.rating ?? 0;
    const ratingB = b.rating ?? 0;
    return ratingB - ratingA;
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="h-5 w-5" />
          Entrants ({players?.length ?? 0})
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4 max-h-[400px] overflow-y-auto pr-2">
          {sortedPlayers.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">No players registered yet.</p>
          ) : (
            sortedPlayers.map((player) => (
              <div key={player.id} className="flex items-center justify-between group">
                <div>
                  <p className="font-medium text-sm">
                    {player.firstName} {player.lastName}
                  </p>
                  {player.club && (
                    <p className="text-xs text-muted-foreground">{player.club}</p>
                  )}
                </div>
                <div className="text-right">
                  <p className="text-sm font-bold text-slate-700">{player.rating}</p>
                  <p className="text-[10px] uppercase text-muted-foreground">Rating</p>
                </div>
              </div>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
}
