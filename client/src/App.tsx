import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import SettingsMenu from "@/components/settings-menu";
import { useAuth } from "@/hooks/useAuth";
import AuthForm from "@/components/auth-form";
import TournamentDirectorDashboard from "@/pages/tournament-director-dashboard";
import PlayerDashboard from "@/pages/player-dashboard";
import TournamentCreation from "@/pages/tournament-creation";

import TournamentManagement from "@/pages/tournament-management";
import TournamentView from "@/pages/tournament-view";
import NotFound from "@/pages/not-found";
import SettingsPage from "@/pages/settings";

function AuthenticatedApp() {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <AuthForm />;
  }

  return (
    <div className="min-h-screen">
      {/* Global Navigation Bar */}
      <div className="fixed top-0 right-0 z-50 p-4">
        <SettingsMenu />
      </div>

      {/* Role-based Routing */}
      <Switch>
        <Route path="/settings" component={SettingsPage} />
        {(user as any)?.role === 'tournament_director' ? (
          <>
            <Route path="/" component={TournamentDirectorDashboard} />
            <Route path="/dashboard" component={TournamentDirectorDashboard} />
            <Route path="/tournaments/new" component={TournamentCreation} />
            <Route path="/tournaments/:id/manage">
              {(params) => <TournamentManagement tournamentId={parseInt(params.id)} />}
            </Route>
            <Route path="/tournaments/:id">
              {(params) => <TournamentView tournamentId={parseInt(params.id)} />}
            </Route>
          </>
        ) : (
          <>
            <Route path="/" component={PlayerDashboard} />
            <Route path="/dashboard" component={PlayerDashboard} />
            <Route path="/tournaments/:id">
              {(params) => <TournamentView tournamentId={parseInt(params.id)} />}
            </Route>
          </>
        )}
        <Route component={NotFound} />
      </Switch>
    </div>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <AuthenticatedApp />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
