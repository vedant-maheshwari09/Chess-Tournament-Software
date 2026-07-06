import React, { useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation, Link } from "wouter";
import { ArrowLeft, Trophy, Users, Award, Calendar, ShieldCheck, Loader2 } from "lucide-react";
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
        title: "Following",
        description: `You are now following ${director?.organizationName || `${director?.firstName} ${director?.lastName}`}.`,
      });
    },
    onError: (err: any) => {
      toast({
        title: "Failed to follow",
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
        title: "Unfollowed",
        description: `You unfollowed ${director?.organizationName || `${director?.firstName} ${director?.lastName}`}.`,
      });
    },
    onError: (err: any) => {
      toast({
        title: "Failed to unfollow",
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

  const formatDate = (dateStr: any) => {
    if (!dateStr) return "TBD";
    return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(new Date(dateStr));
  };

  if (directorLoading || tournamentsLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950">
        <div className="text-center">
          <Loader2 className="h-12 w-12 animate-spin text-indigo-650 mx-auto" />
          <p className="mt-4 text-slate-500 font-medium">Loading profile...</p>
        </div>
      </div>
    );
  }

  if (!director) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950">
        <Card className="w-full max-w-md border shadow-md">
          <CardContent className="pt-8 pb-8 text-center space-y-4">
            <Trophy className="mx-auto h-12 w-12 text-slate-300" />
            <h3 className="text-xl font-bold text-slate-950">Director Not Found</h3>
            <p className="text-sm text-slate-500">The director or organization profile you're looking for doesn't exist.</p>
            <Button onClick={() => setLocation("/")} className="w-full bg-indigo-650 hover:bg-indigo-700 text-white rounded-xl">Back to Home</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Check if it's the logged-in user's own profile
  const isOwnProfile = user?.id === directorId;

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 pb-16 font-sans">
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 space-y-8">
        
        {/* Back Button */}
        <div className="flex items-center">
          <Button
            variant="ghost"
            onClick={handleBack}
            className="flex items-center gap-2 text-slate-500 hover:text-slate-900 rounded-xl"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </Button>
        </div>

        {/* INSTAGRAM-STYLE PROFILE HEADER */}
        <div className="flex flex-col md:flex-row items-center md:items-start gap-8 md:gap-12 pb-8 border-b border-slate-200">
          {/* Left: Avatar */}
          <div className="w-32 h-32 md:w-36 md:h-36 rounded-full overflow-hidden border border-slate-200 shadow-sm flex items-center justify-center bg-white shrink-0 relative">
            {director.profilePicture ? (
              <img src={director.profilePicture} alt={director.organizationName || director.firstName} className="w-full h-full object-cover" />
            ) : (
              <span className="text-4xl font-bold text-slate-400">
                {(director.organizationName || director.firstName || "?")[0].toUpperCase()}
              </span>
            )}
          </div>

          {/* Right: User Information */}
          <div className="space-y-4 text-center md:text-left flex-1 min-w-0">
            {/* Username + Follow Action Button Row */}
            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
              <h2 className="text-xl font-light text-slate-800 dark:text-slate-100 truncate">
                {director.username}
              </h2>
              
              {!isOwnProfile && user && user.role === "player" && (
                <Button
                  size="sm"
                  variant={followStatus?.following ? "outline" : "default"}
                  className={cn(
                    "rounded-lg font-bold px-5 h-8.5 tracking-wide text-xs transition active:scale-95 shrink-0",
                    followStatus?.following
                      ? "bg-white border-slate-250 text-slate-700 hover:bg-slate-50 shadow-sm"
                      : "bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm"
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
                    <Loader2 className="h-3 w-3 animate-spin mr-1.5" />
                  ) : null}
                  {followStatus?.following ? "Following" : "Follow"}
                </Button>
              )}
            </div>

            {/* Stats Row */}
            <div className="flex justify-center md:justify-start gap-8 text-sm">
              <div>
                <span className="font-bold text-slate-900 dark:text-slate-150">{directorTournaments.length}</span>
                <span className="text-slate-500 ml-1">tournaments</span>
              </div>
              <div>
                <span className="font-bold text-slate-900 dark:text-slate-150">{director.followersCount || 0}</span>
                <span className="text-slate-500 ml-1">followers</span>
              </div>
            </div>

            {/* User Bio and Credentials */}
            <div className="space-y-1">
              <h1 className="text-sm font-bold text-slate-900 dark:text-white">
                {director.organizationName || `${director.firstName} ${director.lastName}`}
              </h1>
              {director.organizationName && (
                <p className="text-xs text-slate-500">
                  Directed by: {director.firstName} {director.lastName}
                </p>
              )}
            </div>

            {/* Credentials Row */}
            <div className="flex flex-wrap gap-2 pt-1 justify-center md:justify-start">
              {director.fideArbiterTitle && director.fideArbiterTitle !== "none" && (
                <Badge className="bg-amber-50 border border-amber-200 text-amber-800 hover:bg-amber-50 font-bold px-2.5 py-0.5 rounded-lg flex items-center gap-1 shrink-0 text-[10px]">
                  <ShieldCheck className="h-3 w-3" />
                  FIDE {director.fideArbiterTitle}
                </Badge>
              )}
              {director.uscfAffiliateId && (
                <Badge className="bg-slate-100 border border-slate-200 text-slate-700 hover:bg-slate-100 font-semibold px-2.5 py-0.5 rounded-lg shrink-0 text-[10px]">
                  USCF Affil: {director.uscfAffiliateId}
                </Badge>
              )}
              {director.fideArbiterId && (
                <Badge className="bg-slate-100 border border-slate-200 text-slate-700 hover:bg-slate-100 font-semibold px-2.5 py-0.5 rounded-lg shrink-0 text-[10px]">
                  FIDE ID: {director.fideArbiterId}
                </Badge>
              )}
            </div>
          </div>
        </div>

        {/* Tournaments Grid Section */}
        <div className="space-y-6">
          {/* Instagram-style Clean Tab Bar */}
          <Tabs defaultValue="live" className="w-full">
            <TabsList className="flex items-center justify-center gap-8 bg-transparent border-t border-slate-200 rounded-none p-0 h-auto">
              <TabsTrigger 
                value="live" 
                className="rounded-none border-t-2 border-t-transparent data-[state=active]:border-t-indigo-650 data-[state=active]:text-indigo-650 font-bold text-xs uppercase tracking-wider py-4 bg-transparent shadow-none"
              >
                Live ({categorizedTournaments.live.length})
              </TabsTrigger>
              <TabsTrigger 
                value="upcoming" 
                className="rounded-none border-t-2 border-t-transparent data-[state=active]:border-t-indigo-650 data-[state=active]:text-indigo-650 font-bold text-xs uppercase tracking-wider py-4 bg-transparent shadow-none"
              >
                Upcoming ({categorizedTournaments.upcoming.length})
              </TabsTrigger>
              <TabsTrigger 
                value="past" 
                className="rounded-none border-t-2 border-t-transparent data-[state=active]:border-t-indigo-650 data-[state=active]:text-indigo-650 font-bold text-xs uppercase tracking-wider py-4 bg-transparent shadow-none"
              >
                Past ({categorizedTournaments.past.length})
              </TabsTrigger>
            </TabsList>

            {Object.entries(categorizedTournaments).map(([key, list]) => (
              <TabsContent key={key} value={key} className="mt-6">
                {list.length === 0 ? (
                  <div className="flex flex-col items-center justify-center gap-3 py-16 text-center text-slate-400">
                    <Trophy className="h-10 w-10 text-slate-200" />
                    <p className="text-sm font-medium">No {key} tournaments found.</p>
                  </div>
                ) : (
                  <div className="grid gap-6 sm:grid-cols-2">
                    {list.map((tournament) => (
                      <Card key={tournament.id} className="bg-white border border-slate-200 shadow-sm hover:shadow-md transition rounded-2xl overflow-hidden flex flex-col justify-between">
                        <div className="p-5 space-y-3">
                          <div className="flex justify-between items-start gap-2">
                            <h3 className="font-bold text-slate-900 text-base leading-snug line-clamp-1">
                              {tournament.name}
                            </h3>
                            <span className={cn(
                              "text-[9px] font-extrabold px-2 py-0.5 rounded-full border tracking-wide uppercase shrink-0",
                              tournament.status === "active" ? "bg-green-50 text-green-700 border-green-200" :
                              tournament.status === "upcoming" ? "bg-blue-50 text-blue-700 border-blue-200" :
                              "bg-slate-50 text-slate-500 border-slate-200"
                            )}>
                              {tournament.status === "active" ? "live" : tournament.status}
                            </span>
                          </div>

                          <div className="space-y-1.5 text-xs text-slate-500">
                            <div className="flex items-center gap-2">
                              <Calendar className="h-3.5 w-3.5 shrink-0" />
                              <span>{formatDate(tournament.startDate)} – {formatDate(tournament.endDate)}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <Trophy className="h-3.5 w-3.5 shrink-0" />
                              <span>{getFormatLabel(tournament.format)} · {tournament.rounds ? `${tournament.rounds} rounds` : "Arena event"}</span>
                            </div>
                          </div>
                        </div>

                        <div className="px-5 pb-5 pt-0">
                          <Link href={`/tournaments/${slugify(tournament.name)}`}>
                            <a className="w-full inline-flex items-center justify-center h-9 bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold rounded-xl shadow-sm transition">
                              View Tournament →
                            </a>
                          </Link>
                        </div>
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
