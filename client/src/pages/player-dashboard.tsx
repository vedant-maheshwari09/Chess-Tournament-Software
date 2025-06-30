import { useQuery } from "@tanstack/react-query";
import { Trophy, Clock, Users, Eye } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/useAuth";
import type { Tournament } from "@shared/schema";

export default function PlayerDashboard() {
  const { user } = useAuth();

  const { data: tournaments = [], isLoading } = useQuery<Tournament[]>({
    queryKey: ["/api/tournaments"],
  });

  const getFormatIcon = (format: string) => {
    switch (format) {
      case 'swiss': return '🏆';
      case 'roundrobin': return '🔄';
      case 'knockout': return '⚔️';
      default: return '🎯';
    }
  };

  const getFormatName = (format: string) => {
    switch (format) {
      case 'swiss': return 'Swiss System';
      case 'roundrobin': return 'Round Robin';
      case 'knockout': return 'Knockout';
      default: return format;
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading tournaments...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Header */}
      <div className="bg-white dark:bg-gray-800 shadow">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-6">
            <div>
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
                Live Tournaments
              </h1>
              <p className="text-gray-600 dark:text-gray-300">
                Welcome, {user?.firstName} {user?.lastName} - Find tournaments to join and spectate
              </p>
            </div>
            <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
              <Users className="h-4 w-4" />
              Player Account
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Stats Overview */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Live Tournaments</CardTitle>
              <Trophy className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{tournaments.length}</div>
              <p className="text-xs text-muted-foreground">
                Active tournaments you can view
              </p>
            </CardContent>
          </Card>
          
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Swiss Tournaments</CardTitle>
              <Clock className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {tournaments.filter(t => t.format === 'swiss').length}
              </div>
              <p className="text-xs text-muted-foreground">
                Professional rating tournaments
              </p>
            </CardContent>
          </Card>
          
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Round Robin</CardTitle>
              <Users className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {tournaments.filter(t => t.format === 'roundrobin').length}
              </div>
              <p className="text-xs text-muted-foreground">
                Everyone plays everyone
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Live Tournaments */}
        <Card>
          <CardHeader>
            <CardTitle>Active Tournaments</CardTitle>
            <CardDescription>
              View live tournament standings, pairings, and results
            </CardDescription>
          </CardHeader>
          <CardContent>
            {tournaments.length === 0 ? (
              <div className="text-center py-12">
                <Trophy className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
                  No active tournaments
                </h3>
                <p className="text-gray-600 dark:text-gray-300 mb-4">
                  There are no live tournaments at the moment. Check back later!
                </p>
                <div className="text-sm text-gray-500">
                  Tournament directors can host new tournaments to get started.
                </div>
              </div>
            ) : (
              <div className="grid gap-4">
                {tournaments.map((tournament) => (
                  <Card key={tournament.id} className="hover:shadow-md transition-shadow">
                    <CardContent className="p-6">
                      <div className="flex items-center justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-3 mb-2">
                            <div className="text-2xl">{getFormatIcon(tournament.format)}</div>
                            <div>
                              <h3 className="text-lg font-semibold">{tournament.name}</h3>
                              <div className="flex items-center gap-4 text-sm text-gray-600 dark:text-gray-300">
                                <span>{getFormatName(tournament.format)}</span>
                                {tournament.rounds && (
                                  <span>• {tournament.rounds} rounds</span>
                                )}
                                <span>• Round {tournament.currentRound}</span>
                              </div>
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge className="bg-green-500 text-white">
                            Live
                          </Badge>
                          <Link href={`/tournaments/${tournament.id}/view`}>
                            <Button variant="outline" size="sm" className="flex items-center gap-2">
                              <Eye className="h-4 w-4" />
                              View
                            </Button>
                          </Link>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Tournament Formats Info */}
        <div className="mt-8 grid gap-6 md:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                🏆 Swiss System
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-gray-600 dark:text-gray-300">
                The most popular tournament format where players with similar scores are paired together. 
                Professional USCF rules with proper color balancing.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                🔄 Round Robin
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-gray-600 dark:text-gray-300">
                Every player plays against every other player. Perfect for smaller groups 
                where you want complete standings.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                ⚔️ Knockout
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-gray-600 dark:text-gray-300">
                Single elimination tournament where losing a game eliminates you. 
                Fast-paced and exciting format for quick competitions.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}