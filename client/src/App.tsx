import { useEffect } from "react";
import { Switch, Route, Redirect, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAuth } from "@/hooks/useAuth";
import AuthForm from "@/components/auth-form";
import { AnimatedBackground } from "@/components/ui/animated-background";
import TournamentDirectorDashboard from "@/pages/tournament-director-dashboard";
import PlayerDashboard from "@/pages/player-dashboard";
import TournamentCreation from "@/pages/tournament-creation";

import TournamentManagement from "@/pages/tournament-management";
import TournamentView from "@/pages/tournament-view";
import NotFound from "@/pages/not-found";
import SettingsPage from "@/pages/settings";
import AddPlayerPage from "@/pages/add-player";
import TournamentSettingsPage from "@/pages/tournament-settings";
import TournamentActionsPage from "@/pages/tournament-actions";
import TournamentRegistrationFormPage from "@/pages/tournament-registration-form";
import TournamentPaymentSetupPage from "@/pages/tournament-payment-setup";
import TournamentReportsPage from "@/pages/tournament-reports";
import OnboardingPage from "@/pages/onboarding";
import MessagesDashboard from "@/pages/messages";
import QrResultSubmit from "@/pages/qr-result-submit";
import MatchSubmitMobile from "@/pages/match-submit-mobile";

import LandingPage from "@/pages/landing-page";
import ScrollToTop from "@/components/scroll-to-top";

function TournamentSlugResolver() {
  const [location, setLocation] = useLocation();
  
  const match = location.match(/^\/tournaments\/([^/]+)(.*)$/);
  if (!match) return null;
  
  const slugOrId = match[1];
  const rest = match[2];
  
  if (slugOrId === "new" || /^\d+$/.test(slugOrId)) {
    return null;
  }
  
  const { data: tournament, error, isLoading } = useQuery<any>({
    queryKey: [`/api/tournaments/by-name/${slugOrId}`],
    enabled: !!slugOrId && slugOrId !== "new" && !/^\d+$/.test(slugOrId),
    retry: false,
  });
  
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white/50 backdrop-blur-md">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mx-auto"></div>
          <p className="mt-4 text-slate-600 font-medium">Resolving tournament link...</p>
        </div>
      </div>
    );
  }
  
  if (error || !tournament) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-transparent">
        <div className="text-center max-w-md p-8 bg-white dark:bg-slate-900 rounded-3xl border border-slate-100 dark:border-slate-800 shadow-2xl">
          <h2 className="text-2xl font-bold text-slate-950 dark:text-white">Tournament Not Found</h2>
          <p className="mt-2 text-slate-500">The tournament link or name you requested could not be resolved.</p>
          <button 
            onClick={() => setLocation('/')}
            className="mt-6 px-6 py-2.5 bg-indigo-600 text-white rounded-xl font-bold shadow-lg hover:bg-indigo-700 transition-all"
          >
            Go to Home
          </button>
        </div>
      </div>
    );
  }
  
  setTimeout(() => {
    setLocation(`/tournaments/${tournament.id}${rest || ''}`);
  }, 0);
  
  return null;
}

function AuthenticatedApp() {
  const { user, isLoading } = useAuth();
  const [location, setLocation] = useLocation();

  // Global check to enforce onboarding
  useEffect(() => {
    if (!isLoading && user && !user.hasOnboarded && location !== '/onboarding') {
      setLocation('/onboarding');
    }
  }, [user, location, setLocation, isLoading]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  if (user && !user.hasOnboarded && location !== '/onboarding') {
    return null; // prevent rendering other routes until redirect completes
  }

  return (
    <>
      <AnimatedBackground />
      <TournamentSlugResolver />
      {!user ? (
        <div className="min-h-screen bg-transparent">
          <Switch>
            <Route path="/" component={LandingPage} />
            <Route path="/login" component={AuthForm} />
            <Route path="/register" component={AuthForm} />
            <Route path="/submit-result" component={QrResultSubmit} />
            <Route path="/mobile/matches/:id/submit" component={MatchSubmitMobile} />
            <Route>
              <AuthForm />
            </Route>
          </Switch>
        </div>
      ) : (
        <div className="min-h-screen bg-transparent">
          {/* Role-based Routing */}
          <Switch>
            <Route path="/login">
              <Redirect to="/" />
            </Route>
            <Route path="/register">
              <Redirect to="/" />
            </Route>
            <Route path="/submit-result" component={QrResultSubmit} />
            <Route path="/mobile/matches/:id/submit" component={MatchSubmitMobile} />
            <Route path="/settings" component={SettingsPage} />
            <Route path="/onboarding" component={OnboardingPage} />
            <Route path="/messages" component={MessagesDashboard} />
            {(user as any)?.role === 'tournament_director' ? (
              <>
                <Route path="/">
                  <Redirect to="/dashboard/drafts" />
                </Route>
                <Route path="/dashboard">
                  <Redirect to="/dashboard/drafts" />
                </Route>
                <Route path="/dashboard/:tab" component={TournamentDirectorDashboard} />
                <Route path="/tournaments/new" component={TournamentCreation} />
                <Route path="/tournaments/:id/manage/:tab">
                  {(params) => <TournamentManagement tournamentId={parseInt(params.id)} />}
                </Route>
                <Route path="/tournaments/:id/manage">
                  {(params) => <Redirect to={`/tournaments/${params.id}/manage/dashboard`} />}
                </Route>
                <Route path="/tournaments/:id/settings/:section">
                  {(params) => <TournamentActionsPage tournamentId={parseInt(params.id)} />}
                </Route>
                <Route path="/tournaments/:id/settings">
                  {(params) => <TournamentActionsPage tournamentId={parseInt(params.id)} />}
                </Route>
                <Route path="/tournaments/:id/reports/uscf">
                  {(params) => <TournamentReportsPage tournamentId={parseInt(params.id)} type="uscf" />}
                </Route>
                <Route path="/tournaments/:id/reports/fide">
                  {(params) => <TournamentReportsPage tournamentId={parseInt(params.id)} type="fide" />}
                </Route>
                <Route path="/tournaments/:id/players/new">
                  {(params) => <AddPlayerPage tournamentId={parseInt(params.id)} />}
                </Route>
                <Route path="/tournaments/:id/players/:playerId">
                  {(params) => (
                    <AddPlayerPage
                      tournamentId={parseInt(params.id)}
                      playerId={parseInt(params.playerId)}
                    />
                  )}
                </Route>
                <Route path="/tournaments/:id/register">
                  {(params) => <TournamentRegistrationFormPage tournamentId={parseInt(params.id)} />}
                </Route>
                <Route path="/tournaments/:id/payments/setup">
                  {(params) => <TournamentPaymentSetupPage tournamentId={parseInt(params.id)} />}
                </Route>
                <Route path="/tournaments/:id/:tab">
                  {(params) => <TournamentView tournamentId={parseInt(params.id)} />}
                </Route>
                <Route path="/tournaments/:id">
                  {(params) => <Redirect to={`/tournaments/${params.id}/info`} />}
                </Route>
              </>
            ) : (
              <>
                <Route path="/">
                  <Redirect to="/dashboard/ongoing" />
                </Route>
                <Route path="/dashboard">
                  <Redirect to="/dashboard/ongoing" />
                </Route>
                <Route path="/dashboard/:tab" component={PlayerDashboard} />
                <Route path="/tournaments/:id/register">
                  {(params) => <TournamentRegistrationFormPage tournamentId={parseInt(params.id)} />}
                </Route>
                <Route path="/tournaments/:id/:tab">
                  {(params) => <TournamentView tournamentId={parseInt(params.id)} />}
                </Route>
                <Route path="/tournaments/:id">
                  {(params) => <Redirect to={`/tournaments/${params.id}/info`} />}
                </Route>
              </>
            )}
            <Route component={NotFound} />
          </Switch>
        </div>
      )}
    </>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <ScrollToTop />
        <Toaster />
        <AuthenticatedApp />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
