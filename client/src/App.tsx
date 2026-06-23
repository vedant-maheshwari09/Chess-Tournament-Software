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
import DirectorProfilePage from "@/pages/director-profile";
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
import { slugify } from "@/lib/utils";

function TournamentRouteWrapper({
  idParam,
  requireDirector = false,
  children,
}: {
  idParam: string;
  requireDirector?: boolean;
  children: (id: number) => React.ReactNode;
}) {
  const { user } = useAuth();
  const [location, setLocation] = useLocation();
  const isNumeric = /^\d+$/.test(idParam);

  // Security check: If requireDirector is true and user is not a tournament director, deny access
  if (requireDirector && user?.role !== 'tournament_director') {
    return <Redirect to="/dashboard" />;
  }

  // If the parameter is "new", it's not a real tournament ID/slug, so do nothing (shouldn't really hit here anyway)
  if (idParam === "new") {
    return <>{children(0)}</>;
  }

  if (isNumeric) {
    // If it's a numeric ID, fetch the tournament to get its slug and redirect
    const tournamentId = parseInt(idParam, 10);
    const { data: tournament, isLoading, error } = useQuery<any>({
      queryKey: [`/api/tournaments/${tournamentId}`],
      retry: false,
    });

    if (isLoading) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-transparent backdrop-blur-md">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mx-auto"></div>
            <p className="mt-4 text-slate-600 font-medium">Redirecting to slugified link...</p>
          </div>
        </div>
      );
    }

    if (error || !tournament) {
      return <Redirect to="/not-found" />;
    }

    // Secondary security check
    if (requireDirector && tournament.createdBy !== user?.id && user?.role !== 'admin') {
      return <Redirect to="/dashboard" />;
    }

    const slug = slugify(tournament.name);
    // Construct new path replacing the numeric tournament ID with the slug
    const currentPath = window.location.pathname;
    const newPath = currentPath.replace(`/tournaments/${idParam}`, `/tournaments/${slug}`);
    return <Redirect to={newPath} replace />;
  }

  // If it's a slug, query by-name to resolve the ID
  const { data: tournament, isLoading, error } = useQuery<any>({
    queryKey: [`/api/tournaments/by-name/${idParam}`],
    retry: false,
  });

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-transparent backdrop-blur-md">
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

  // Security check: check ownership of tournament if requireDirector is true
  if (requireDirector && tournament.createdBy !== user?.id && user?.role !== 'admin') {
    return <Redirect to={`/tournaments/${idParam}`} />;
  }

  return <>{children(tournament.id)}</>;
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
                <Route path="/directors/:id">
                  {(params) => <DirectorProfilePage directorId={parseInt(params.id)} />}
                </Route>
                <Route path="/tournaments/new" component={TournamentCreation} />
                <Route path="/tournaments/:id/manage/:tab/*">
                  {(params) => (
                    <TournamentRouteWrapper idParam={params.id} requireDirector>
                      {(resolvedId) => <TournamentManagement tournamentId={resolvedId} />}
                    </TournamentRouteWrapper>
                  )}
                </Route>
                <Route path="/tournaments/:id/manage/:tab">
                  {(params) => (
                    <TournamentRouteWrapper idParam={params.id} requireDirector>
                      {(resolvedId) => <TournamentManagement tournamentId={resolvedId} />}
                    </TournamentRouteWrapper>
                  )}
                </Route>
                <Route path="/tournaments/:id/manage">
                  {(params) => (
                    <TournamentRouteWrapper idParam={params.id} requireDirector>
                      {(resolvedId) => <Redirect to={`/tournaments/${params.id}/manage/dashboard`} />}
                    </TournamentRouteWrapper>
                  )}
                </Route>
                <Route path="/tournaments/:id/settings/:section">
                  {(params) => (
                    <TournamentRouteWrapper idParam={params.id} requireDirector>
                      {(resolvedId) => <TournamentActionsPage tournamentId={resolvedId} />}
                    </TournamentRouteWrapper>
                  )}
                </Route>
                <Route path="/tournaments/:id/settings">
                  {(params) => (
                    <TournamentRouteWrapper idParam={params.id} requireDirector>
                      {(resolvedId) => <TournamentActionsPage tournamentId={resolvedId} />}
                    </TournamentRouteWrapper>
                  )}
                </Route>
                <Route path="/tournaments/:id/reports/uscf">
                  {(params) => (
                    <TournamentRouteWrapper idParam={params.id} requireDirector>
                      {(resolvedId) => <TournamentReportsPage tournamentId={resolvedId} type="uscf" />}
                    </TournamentRouteWrapper>
                  )}
                </Route>
                <Route path="/tournaments/:id/reports/fide">
                  {(params) => (
                    <TournamentRouteWrapper idParam={params.id} requireDirector>
                      {(resolvedId) => <TournamentReportsPage tournamentId={resolvedId} type="fide" />}
                    </TournamentRouteWrapper>
                  )}
                </Route>
                <Route path="/tournaments/:id/players/new">
                  {(params) => (
                    <TournamentRouteWrapper idParam={params.id} requireDirector>
                      {(resolvedId) => <AddPlayerPage tournamentId={resolvedId} />}
                    </TournamentRouteWrapper>
                  )}
                </Route>
                <Route path="/tournaments/:id/players/:playerId">
                  {(params) => (
                    <TournamentRouteWrapper idParam={params.id} requireDirector>
                      {(resolvedId) => (
                        <AddPlayerPage
                          tournamentId={resolvedId}
                          playerId={parseInt(params.playerId)}
                        />
                      )}
                    </TournamentRouteWrapper>
                  )}
                </Route>
                <Route path="/tournaments/:id/register">
                  {(params) => (
                    <TournamentRouteWrapper idParam={params.id}>
                      {(resolvedId) => <TournamentRegistrationFormPage tournamentId={resolvedId} />}
                    </TournamentRouteWrapper>
                  )}
                </Route>
                <Route path="/tournaments/:id/payments/setup">
                  {(params) => (
                    <TournamentRouteWrapper idParam={params.id} requireDirector>
                      {(resolvedId) => <TournamentPaymentSetupPage tournamentId={resolvedId} />}
                    </TournamentRouteWrapper>
                  )}
                </Route>
                <Route path="/tournaments/:id/:tab/*">
                  {(params) => (
                    <TournamentRouteWrapper idParam={params.id}>
                      {(resolvedId) => <TournamentView tournamentId={resolvedId} />}
                    </TournamentRouteWrapper>
                  )}
                </Route>
                <Route path="/tournaments/:id/:tab">
                  {(params) => (
                    <TournamentRouteWrapper idParam={params.id}>
                      {(resolvedId) => <TournamentView tournamentId={resolvedId} />}
                    </TournamentRouteWrapper>
                  )}
                </Route>
                <Route path="/tournaments/:id">
                  {(params) => (
                    <TournamentRouteWrapper idParam={params.id}>
                      {(resolvedId) => <Redirect to={`/tournaments/${params.id}/info`} />}
                    </TournamentRouteWrapper>
                  )}
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
                <Route path="/directors/:id">
                  {(params) => <DirectorProfilePage directorId={parseInt(params.id)} />}
                </Route>
                <Route path="/tournaments/:id/register">
                  {(params) => (
                    <TournamentRouteWrapper idParam={params.id}>
                      {(resolvedId) => <TournamentRegistrationFormPage tournamentId={resolvedId} />}
                    </TournamentRouteWrapper>
                  )}
                </Route>
                <Route path="/tournaments/:id/:tab/*">
                  {(params) => (
                    <TournamentRouteWrapper idParam={params.id}>
                      {(resolvedId) => <TournamentView tournamentId={resolvedId} />}
                    </TournamentRouteWrapper>
                  )}
                </Route>
                <Route path="/tournaments/:id/:tab">
                  {(params) => (
                    <TournamentRouteWrapper idParam={params.id}>
                      {(resolvedId) => <TournamentView tournamentId={resolvedId} />}
                    </TournamentRouteWrapper>
                  )}
                </Route>
                <Route path="/tournaments/:id">
                  {(params) => (
                    <TournamentRouteWrapper idParam={params.id}>
                      {(resolvedId) => <Redirect to={`/tournaments/${params.id}/info`} />}
                    </TournamentRouteWrapper>
                  )}
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
