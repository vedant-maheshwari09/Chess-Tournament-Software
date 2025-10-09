import { useQuery } from "@tanstack/react-query";
import { Plus, Settings, Users, Trophy, Calendar } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/useAuth";
import type { Tournament } from "@shared/schema";
import SettingsMenu from "@/components/settings-menu";

export default function TournamentDirectorDashboard() {
  const { user } = useAuth();

  const { data: tournaments = [], isLoading } = useQuery<Tournament[]>({
    queryKey: ["/api/my-tournaments"],
  });

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active': return 'bg-green-500';
      case 'draft': return 'bg-yellow-500';
      case 'completed': return 'bg-gray-500';
      default: return 'bg-gray-500';
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'active': return 'Live';
      case 'draft': return 'Draft';
      case 'completed': return 'Completed';
      default: return status;
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading your tournaments...</p>
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
                Tournament Director Dashboard
              </h1>
              <p className="text-gray-600 dark:text-gray-300">
                Welcome back, {user?.firstName} {user?.lastName}
              </p>
            </div>
            <div className="flex items-center gap-4">
              <SettingsMenu />
              <Link href="/tournaments/new">
                <Button className="flex items-center gap-2">
                  <Plus className="h-4 w-4" />
                  Host New Tournament
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Stats Overview */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Tournaments</CardTitle>
              <Trophy className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{tournaments.length}</div>
            </CardContent>
          </Card>
          
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Active Tournaments</CardTitle>
              <Calendar className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {tournaments.filter(t => t.status === 'active').length}
              </div>
            </CardContent>
          </Card>
          
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Draft Tournaments</CardTitle>
              <Settings className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {tournaments.filter(t => t.status === 'draft').length}
              </div>
            </CardContent>
          </Card>
          
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Completed</CardTitle>
              <Trophy className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {tournaments.filter(t => t.status === 'completed').length}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Tournaments List */}
        <Card>
          <CardHeader>
            <CardTitle>Your Tournaments</CardTitle>
            <CardDescription>
              Manage and monitor all your hosted tournaments
            </CardDescription>
          </CardHeader>
          <CardContent>
            {tournaments.length === 0 ? (
              <div className="text-center py-12">
                <Trophy className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
                  No tournaments yet
                </h3>
                <p className="text-gray-600 dark:text-gray-300 mb-4">
                  Get started by hosting your first tournament
                </p>
                <Link href="/tournaments/new">
                  <Button>
                    <Plus className="h-4 w-4 mr-2" />
                    Host Your First Tournament
                  </Button>
                </Link>
              </div>
            ) : (
              <div className="grid gap-4">
                {tournaments.map((tournament) => (
                  <Card key={tournament.id} className="hover:shadow-md transition-shadow">
                    <CardContent className="p-6">
                      <div className="flex items-center justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-3 mb-2">
                            <h3 className="text-lg font-semibold">{tournament.name}</h3>
                            <Badge className={getStatusColor(tournament.status)}>
                              {getStatusText(tournament.status)}
                            </Badge>
                          </div>
                          <div className="flex items-center gap-6 text-sm text-gray-600 dark:text-gray-300">
                            <span className="flex items-center gap-1">
                              <Users className="h-4 w-4" />
                              Format: {tournament.format}
                            </span>
                            {tournament.rounds && (
                              <span>Rounds: {tournament.rounds}</span>
                            )}
                            <span>Round: {tournament.currentRound}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Link href={`/tournaments/${tournament.id}/manage`}>
                            <Button variant="outline" size="sm">
                              Manage
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
      </div>
    </div>
  );
}