import React from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { Tournament, Player } from "@shared/schema";

interface PlayerManagerProps {
  tournament: Tournament;
  tournamentId: number;
}

export default function PlayerManager({ tournament, tournamentId }: PlayerManagerProps) {
  const [, setLocation] = useLocation();

  const { data: players = [], isLoading } = useQuery<Player[]>({
    queryKey: [`/api/tournaments/${tournamentId}/players`],
  });

  return (
    <div className="grid gap-4 lg:grid-cols-[240px,1fr]">
      <Card className="self-start">
        <CardHeader>
          <CardTitle className="text-lg">Player tools</CardTitle>
          <p className="text-sm text-muted-foreground">Manage roster actions for this tournament.</p>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button className="w-full" onClick={() => setLocation(`/tournaments/${tournamentId}/players/new`)}>
            Add Player
          </Button>
          <Button variant="outline" className="w-full" disabled>
            Entry fees
          </Button>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" className="w-full" disabled>
              Export
            </Button>
            <Button variant="secondary" className="w-full" disabled>
              Import
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Chess-Results syncing will use these controls once backend automation is enabled.
          </p>
        </CardContent>
      </Card>

      <Card className="lg:col-span-1">
        <CardHeader className="flex items-center justify-between">
          <div>
            <CardTitle className="text-xl">Players</CardTitle>
            <p className="text-sm text-muted-foreground">Overview of everyone registered for this event.</p>
          </div>
          <Badge variant="secondary">Total: {players.length}</Badge>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading players…</p>
          ) : players.length === 0 ? (
            <div className="py-12 text-center">
              <p className="text-sm text-muted-foreground">No players registered yet.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">#</TableHead>
                  <TableHead>Surname, Name</TableHead>
                  <TableHead>Rating</TableHead>
                  <TableHead>Club</TableHead>
                  <TableHead>Birthdate</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {players.map((player, index) => (
                  <TableRow key={player.id}>
                    <TableCell>{index + 1}</TableCell>
                    <TableCell>
                      {player.lastName}, {player.firstName}
                    </TableCell>
                    <TableCell>{player.rating ?? "-"}</TableCell>
                    <TableCell>-</TableCell>
                    <TableCell>-</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
