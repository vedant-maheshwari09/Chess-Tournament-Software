import { useEffect } from "react";
import { Switch, Route, Redirect, useLocation } from "wouter";
import { queryClient, apiRequest } from "./lib/queryClient";
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
import SubscribersModerationPage from "@/pages/subscribers";
import AddPlayerPage from "@/pages/add-player";
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
  const [, setLocation] = useLocation();

  // Security check: If requireDirector is true and user is not a tournament director, deny access
  if (requireDirector && user?.role !== 'tournament_director') {
    return <Redirect to="/dashboard" />;
  }

  // If the parameter is "new", it's not a real tournament ID/slug, so do nothing (shouldn't really hit here anyway)
  if (idParam === "new") {
    return <>{children(0)}</>;
  }

  // Query by-name/ID endpoint to resolve the tournament
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

  // Check if we accessed the tournament using its numeric ID instead of its slugified name.
  // If so, redirect to the slugified path.
  const slug = slugify(tournament.name);
  if (slug !== idParam) {
    const currentPath = window.location.pathname;
    const newPath = currentPath.replace(`/tournaments/${idParam}`, `/tournaments/${slug}`);
    return <Redirect to={newPath} replace />;
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

  // Process post-login auto-follow redirection
  useEffect(() => {
    if (!isLoading && user) {
      const followTdId = localStorage.getItem("follow_td_id");
      if (followTdId) {
        localStorage.removeItem("follow_td_id");
        const directorId = parseInt(followTdId, 10);
        if (!isNaN(directorId)) {
          apiRequest(`/api/follows/${directorId}`, { method: "POST" })
            .then(() => {
              setLocation(`/directors/${directorId}`);
            })
            .catch((err: any) => {
              console.error("Auto-follow error:", err);
              setLocation(`/directors/${directorId}`);
            });
        }
      }
    }
  }, [user, isLoading, setLocation]);

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

  const isDirector = (user as any)?.role === 'tournament_director';

  return (
    <>
      <AnimatedBackground />
      {!user ? (
        <div className="min-h-screen bg-transparent">
          <Switch>
            <Route path="/" component={LandingPage} />
            <Route path="/login" component={AuthForm} />
            <Route path="/register" component={AuthForm} />
            <Route path="/auth">
              <Redirect to="/login" />
            </Route>
            <Route path="/submit-result" component={QrResultSubmit} />
            <Route path="/mobile/matches/:id/submit" component={MatchSubmitMobile} />
            <Route>
              <AuthForm />
            </Route>
          </Switch>
        </div>
      ) : (
        <div className="min-h-screen bg-transparent">
          <Switch>
            <Route path="/login">
              <Redirect to="/" />
            </Route>
            <Route path="/register">
              <Redirect to="/" />
            </Route>
            <Route path="/auth">
              <Redirect to="/" />
            </Route>
            <Route path="/submit-result" component={QrResultSubmit} />
            <Route path="/mobile/matches/:id/submit" component={MatchSubmitMobile} />
            <Route path="/settings" component={SettingsPage} />
            <Route path="/onboarding" component={OnboardingPage} />
            <Route path="/messages" component={MessagesDashboard} />

            {/* Dashboard Redirects */}
            <Route path="/">
              {isDirector ? <Redirect to="/dashboard/drafts" /> : <Redirect to="/dashboard/ongoing" />}
            </Route>
            <Route path="/dashboard">
              {isDirector ? <Redirect to="/dashboard/drafts" /> : <Redirect to="/dashboard/ongoing" />}
            </Route>

            {/* Director Specific Dashboard & Subscriber routes */}
            {isDirector && (
              <Route path="/dashboard/:tab" component={TournamentDirectorDashboard} />
            )}
            {isDirector && (
              <Route path="/subscribers" component={SubscribersModerationPage} />
            )}

            {/* Player Specific Dashboard */}
            {!isDirector && (
              <Route path="/dashboard/:tab" component={PlayerDashboard} />
            )}

            {/* Director Profile page (accessible by both) */}
            <Route path="/directors/:id">
              {(params) => <DirectorProfilePage directorId={parseInt(params.id)} />}
            </Route>

            {/* Director Specific Tournament management/creation routes */}
            {isDirector && (
              <Route path="/tournaments/new" component={TournamentCreation} />
            )}
            {isDirector && (
              <Route path="/tournaments/:id/manage/:tab/*">
                {(params) => (
                  <TournamentRouteWrapper idParam={params.id} requireDirector>
                    {(resolvedId) => <TournamentManagement tournamentId={resolvedId} />}
                  </TournamentRouteWrapper>
                )}
              </Route>
            )}
            {isDirector && (
              <Route path="/tournaments/:id/manage/:tab">
                {(params) => (
                  <TournamentRouteWrapper idParam={params.id} requireDirector>
                    {(resolvedId) => <TournamentManagement tournamentId={resolvedId} />}
                  </TournamentRouteWrapper>
                )}
              </Route>
            )}
            {isDirector && (
              <Route path="/tournaments/:id/manage">
                {(params) => (
                  <TournamentRouteWrapper idParam={params.id} requireDirector>
                    {() => <Redirect to={`/tournaments/${params.id}/manage/dashboard`} />}
                  </TournamentRouteWrapper>
                )}
              </Route>
            )}
            {isDirector && (
              <Route path="/tournaments/:id/settings/:section">
                {(params) => (
                  <TournamentRouteWrapper idParam={params.id} requireDirector>
                    {(resolvedId) => <TournamentActionsPage tournamentId={resolvedId} />}
                  </TournamentRouteWrapper>
                )}
              </Route>
            )}
            {isDirector && (
              <Route path="/tournaments/:id/settings">
                {(params) => (
                  <TournamentRouteWrapper idParam={params.id} requireDirector>
                    {(resolvedId) => <TournamentActionsPage tournamentId={resolvedId} />}
                  </TournamentRouteWrapper>
                )}
              </Route>
            )}
            {isDirector && (
              <Route path="/tournaments/:id/reports/uscf">
                {(params) => (
                  <TournamentRouteWrapper idParam={params.id} requireDirector>
                    {(resolvedId) => <TournamentReportsPage tournamentId={resolvedId} type="uscf" />}
                  </TournamentRouteWrapper>
                )}
              </Route>
            )}
            {isDirector && (
              <Route path="/tournaments/:id/reports/fide">
                {(params) => (
                  <TournamentRouteWrapper idParam={params.id} requireDirector>
                    {(resolvedId) => <TournamentReportsPage tournamentId={resolvedId} type="fide" />}
                  </TournamentRouteWrapper>
                )}
              </Route>
            )}
            {isDirector && (
              <Route path="/tournaments/:id/players/new">
                {(params) => (
                  <TournamentRouteWrapper idParam={params.id} requireDirector>
                    {(resolvedId) => <AddPlayerPage tournamentId={resolvedId} />}
                  </TournamentRouteWrapper>
                )}
              </Route>
            )}
            {isDirector && (
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
            )}
            {isDirector && (
              <Route path="/tournaments/:id/payments/setup">
                {(params) => (
                  <TournamentRouteWrapper idParam={params.id} requireDirector>
                    {(resolvedId) => <TournamentPaymentSetupPage tournamentId={resolvedId} />}
                  </TournamentRouteWrapper>
                )}
              </Route>
            )}

            {/* General Tournament Registration & View (Accessible by both) */}
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
                  {() => <Redirect to={`/tournaments/${params.id}/info`} />}
                </TournamentRouteWrapper>
              )}
            </Route>

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
