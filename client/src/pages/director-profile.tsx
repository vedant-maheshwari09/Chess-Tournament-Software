import React, { useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation, Link } from "wouter";
import { ArrowLeft, Trophy, Users, Award, Mail, Building2, Calendar, ShieldCheck, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import type { Tournament, User } from "@shared/schema";
import { apiRequest } from "@/lib/queryClient";
import { cn, slugify } from "@/lib/utils";

interface DirectorProfileProps {
  directorId: number;
}

export default function DirectorProfilePage({ directorId }: DirectorProfileProps) {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { user } = useAuth();

  // 1. Fetch director's public info
  const { data: director, isLoading: directorLoading, refetch: refetchDirector } = useQuery<User & { followersCount: number }>({
    queryKey: [`/api/users/${directorId}`],
  });

  // 2. Fetch all public tournaments and filter by creator
  const { data: tournaments = [], isLoading: tournamentsLoading } = useQuery<Tournament[]>({
    queryKey: ["/api/tournaments"],
  });

  const directorTournaments = useMemo(() => {
    return tournaments.filter((t) => t.createdBy === directorId);
  }, [tournaments, directorId]);

  // 3. Fetch follow status
  const { data: followStatus, refetch: refetchFollowStatus } = useQuery<{ following: boolean }>({
    queryKey: [`/api/follows/status/${directorId}`],
    enabled: !!user && user.id !== directorId,
  });

  // 4. Follow/Unfollow mutations
  const followMutation = useMutation({
    mutationFn: async () => {
      return apiRequest(`/api/follows/${directorId}`, {
        method: "POST",
      });
    },
    onSuccess: () => {
      refetchFollowStatus();
      refetchDirector();
      toast({
        title: "Subscribed!",
        description: `You are now subscribed to ${director?.organizationName || `${director?.firstName} ${director?.lastName}`}.`,
      });
    },
    onError: (err: any) => {
      toast({
        title: "Failed to subscribe",
        description: err.message || "An unexpected error occurred.",
        variant: "destructive",
      });
    },
  });

  const unfollowMutation = useMutation({
    mutationFn: async () => {
      return apiRequest(`/api/follows/${directorId}`, {
        method: "DELETE",
      });
    },
    onSuccess: () => {
      refetchFollowStatus();
      refetchDirector();
      toast({
        title: "Unsubscribed",
        description: `You have unsubscribed from ${director?.organizationName || `${director?.firstName} ${director?.lastName}`}.`,
      });
    },
    onError: (err: any) => {
      toast({
        title: "Failed to unsubscribe",
        description: err.message || "An unexpected error occurred.",
        variant: "destructive",
      });
    },
  });

  const categorizedTournaments = useMemo(() => {
    return {
      live: directorTournaments.filter((t) => t.status === "active"),
      upcoming: directorTournaments.filter((t) => t.status === "upcoming"),
      past: directorTournaments.filter((t) => t.status === "completed"),
    };
  }, [directorTournaments]);

  const handleBack = () => {
    if (window.history.length > 1) {
      window.history.back();
    } else {
      setLocation("/");
    }
  };

  const getFormatLabel = (format: string) => {
    switch (format) {
      case "swiss": return "Swiss System";
      case "roundrobin": return "Round Robin";
      case "knockout": return "Knockout";
      case "arena": return "Arena";
      default: return format.charAt(0).toUpperCase() + format.slice(1);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "active":
        return <Badge className="bg-green-100 text-green-800 border-none rounded-full px-3 py-1 font-bold">LIVE</Badge>;
      case "upcoming":
        return <Badge className="bg-blue-100 text-blue-850 border-none rounded-full px-3 py-1 font-bold">UPCOMING</Badge>;
      case "completed":
        return <Badge className="bg-slate-100 text-slate-600 border-none rounded-full px-3 py-1 font-bold">PAST</Badge>;
      default:
        return null;
    }
  };

  const formatDate = (dateStr: any) => {
    if (!dateStr) return "TBD";
    return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(new Date(dateStr));
  };

  if (directorLoading || tournamentsLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-transparent">
        <div className="text-center">
          <Loader2 className="h-12 w-12 animate-spin text-indigo-600 mx-auto" />
          <p className="mt-4 text-slate-600 dark:text-slate-400 font-medium">Loading organizer profile...</p>
        </div>
      </div>
    );
  }

  if (!director) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-transparent">
        <Card className="w-full max-w-md border-none shadow-xl">
          <CardContent className="pt-8 pb-8 text-center">
            <Building2 className="mx-auto mb-6 h-16 w-16 text-slate-200" />
            <h3 className="mb-2 text-2xl font-bold text-slate-900 dark:text-white">Organizer Not Found</h3>
            <p className="mb-8 text-slate-500 dark:text-slate-400">The director or organization profile you're looking for doesn't exist.</p>
            <Button onClick={() => setLocation("/")} className="w-full bg-indigo-600 hover:bg-indigo-700">Back to Home</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-transparent pb-12">
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8 space-y-8">
        
        {/* Back Button */}
        <div className="flex items-center">
          <Button
            variant="ghost"
            onClick={handleBack}
            className="flex items-center gap-2 text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </Button>
        </div>

        {/* Profile Card */}
        <Card className="overflow-hidden border-none shadow-xl shadow-slate-200/50 dark:bg-slate-900 bg-white p-6 sm:p-8">
          <CardContent className="p-0 flex flex-col md:flex-row items-center md:items-start gap-8">
            {/* Avatar */}
            <div className="relative group w-28 h-28 rounded-full overflow-hidden border-4 border-indigo-100 dark:border-slate-800 shadow-inner flex items-center justify-center bg-indigo-50/50 shrink-0">
              {director.profilePicture ? (
                <img src={director.profilePicture} alt={director.organizationName || director.firstName} className="w-full h-full object-cover" />
              ) : (
                <Building2 className="w-12 h-12 text-indigo-300" />
              )}
            </div>

            {/* Info Details */}
            <div className="space-y-4 text-center md:text-left flex-grow">
              <div className="space-y-1">
                <h1 className="text-3xl font-extrabold text-slate-950 dark:text-white tracking-tight">
                  {director.organizationName || `${director.firstName} ${director.lastName}`}
                </h1>
                {director.organizationName && (
                  <p className="text-sm font-semibold text-indigo-600 dark:text-indigo-400">
                    Directed by: {director.firstName} {director.lastName}
                  </p>
                )}
                <p className="text-xs text-slate-500 dark:text-slate-400">@{director.username}</p>
              </div>

              {/* Follower Badge & Credentials */}
              <div className="flex flex-wrap items-center justify-center md:justify-start gap-3 text-sm">
                <Badge className="bg-indigo-50 text-indigo-700 hover:bg-indigo-50 dark:bg-slate-800 dark:text-indigo-300 font-bold px-3 py-1 rounded-full border-none">
                  {director.followersCount || 0} subscriber{(director.followersCount || 0) === 1 ? "" : "s"}
                </Badge>
                {director.fideArbiterTitle && director.fideArbiterTitle !== "none" && (
                  <Badge className="bg-amber-50 text-amber-800 hover:bg-amber-50 dark:bg-slate-800 dark:text-amber-300 font-bold px-3 py-1 rounded-full border-none flex items-center gap-1">
                    <ShieldCheck className="h-3.5 w-3.5" />
                    {director.fideArbiterTitle} (FIDE)
                  </Badge>
                )}
              </div>

              {/* Arbiter Credentials Block */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-slate-600 dark:text-slate-300 pt-2 border-t border-slate-100 dark:border-slate-850">
                {director.uscfAffiliateId && (
                  <div className="flex items-center justify-center md:justify-start gap-1.5">
                    <Award className="h-4 w-4 text-slate-400" />
                    <span>USCF Affiliate ID: <strong className="text-slate-800 dark:text-slate-200">{director.uscfAffiliateId}</strong></span>
                  </div>
                )}
                {director.fideArbiterId && (
                  <div className="flex items-center justify-center md:justify-start gap-1.5">
                    <Award className="h-4 w-4 text-slate-400" />
                    <span>FIDE Arbiter ID: <strong className="text-slate-800 dark:text-slate-200">{director.fideArbiterId}</strong></span>
                  </div>
                )}
                <div className="flex items-center justify-center md:justify-start gap-1.5">
                  <Mail className="h-4 w-4 text-slate-400" />
                  <span>Email: <strong className="text-slate-800 dark:text-slate-200">{director.email}</strong></span>
                </div>
              </div>
            </div>

            {/* Subscribe Button */}
            {user && user.id !== directorId && user.role === "player" && (
              <div className="self-center md:self-start">
                <Button
                  size="lg"
                  variant={followStatus?.following ? "secondary" : "default"}
                  className={cn(
                    "rounded-full font-bold px-6 py-5 tracking-wide shadow-md transition-all duration-200 hover:-translate-y-0.5",
                    followStatus?.following
                      ? "bg-slate-100 hover:bg-slate-200 text-slate-800 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-200 border-none"
                      : "bg-indigo-600 hover:bg-indigo-700 text-white"
                  )}
                  onClick={() => {
                    if (followStatus?.following) {
                      unfollowMutation.mutate();
                    } else {
                      followMutation.mutate();
                    }
                  }}
                  disabled={followMutation.isPending || unfollowMutation.isPending}
                >
                  {followMutation.isPending || unfollowMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : null}
                  {followStatus?.following ? "Subscribed" : "Subscribe to Updates"}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Tournaments List */}
        <div className="space-y-4">
          <h2 className="text-xl font-bold text-slate-900 dark:text-white tracking-tight">Tournaments by this Organizer</h2>

          <Tabs defaultValue="live" className="w-full">
            <TabsList className="flex w-full min-h-[48px] overflow-x-auto no-scrollbar items-center gap-1 bg-slate-100 p-1 rounded-xl border border-slate-200/60 shadow-sm">
              <TabsTrigger value="live" className="flex-1 rounded-lg text-xs sm:text-sm font-semibold py-2">
                Live ({categorizedTournaments.live.length})
              </TabsTrigger>
              <TabsTrigger value="upcoming" className="flex-1 rounded-lg text-xs sm:text-sm font-semibold py-2">
                Upcoming ({categorizedTournaments.upcoming.length})
              </TabsTrigger>
              <TabsTrigger value="past" className="flex-1 rounded-lg text-xs sm:text-sm font-semibold py-2">
                Past ({categorizedTournaments.past.length})
              </TabsTrigger>
            </TabsList>

            {Object.entries(categorizedTournaments).map(([key, list]) => (
              <TabsContent key={key} value={key} className="mt-6">
                {list.length === 0 ? (
                  <Card className="border-none shadow-sm dark:bg-slate-900">
                    <CardContent className="flex flex-col items-center justify-center gap-4 py-12 text-center text-slate-500">
                      <Trophy className="h-12 w-12 mx-auto text-slate-200" />
                      <p>No {key} tournaments available for this organizer.</p>
                    </CardContent>
                  </Card>
                ) : (
                  <div className="grid gap-4 sm:grid-cols-2">
                    {list.map((tournament) => (
                      <Card key={tournament.id} className="hover:shadow-md transition-all border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/50">
                        <CardHeader className="pb-3 flex flex-row items-start justify-between gap-4">
                          <div>
                            <CardTitle className="text-lg font-bold">{tournament.name}</CardTitle>
                            <CardDescription className="text-xs mt-1">
                              {getFormatLabel(tournament.format)}
                            </CardDescription>
                          </div>
                          {getStatusBadge(tournament.status)}
                        </CardHeader>
                        <CardContent className="space-y-4">
                          <div className="flex flex-col gap-1.5 text-xs text-slate-600 dark:text-slate-400">
                            <span className="flex items-center gap-1.5">
                              <Calendar className="h-3.5 w-3.5" />
                              {formatDate(tournament.startDate)} – {formatDate(tournament.endDate)}
                            </span>
                            <span className="flex items-center gap-1.5">
                              <Users className="h-3.5 w-3.5" />
                              {tournament.rounds ? `${tournament.rounds} rounds` : "Arena event"}
                            </span>
                          </div>
                          <Link href={`/tournaments/${slugify(tournament.name)}`}>
                            <Button className="w-full bg-slate-900 hover:bg-slate-800 dark:bg-slate-850 dark:hover:bg-slate-800 font-semibold rounded-xl text-xs py-2 shadow-sm">
                              View Tournament
                            </Button>
                          </Link>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </TabsContent>
            ))}
          </Tabs>
        </div>

      </div>
    </div>
  );
}
