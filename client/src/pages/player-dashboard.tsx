import React, { useEffect, useMemo, useState } from "react";
import type { ComponentType } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useRoute, Link } from "wouter";
import { Trophy, Users, Eye, Medal, Info, Calculator, PauseCircle, Star, Loader2, MessageCircle, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import SettingsMenu from "@/components/settings-menu";

import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import type { Tournament, Player, PlayerRegistration as PlayerRegistrationType, TournamentStar } from "@shared/schema";
import { parseTournamentConfig } from "@/lib/tournament-config";
import { apiRequest } from "@/lib/queryClient";
import { requestFirebaseToken } from "@/lib/firebase";
import NotificationBell from "@/components/notification-bell";
import { slugify } from "@/lib/utils";

type SortKey = "date" | "players" | "subscribers" | "state" | "name" | "format" | "rounds";

type DetailTabKey = "pairings" | "standings" | "byes" | "predictor" | "info";

interface TournamentRow {
  tournament: Tournament;
  playersCount: number;
  sectionsCount: number | null;
  startDate: Date | null;
  endDate: Date | null;
  state: string;
}

interface SectionData {
  key: string;
  label: string;
  description: string;
  items: TournamentRow[];
  empty: string;
}

export default function PlayerDashboard() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [, dashboardParams] = useRoute("/dashboard/:tab");
  const activeTab = dashboardParams?.tab ?? "ongoing";
  const queryClient = useQueryClient();
  const isPlayer = user?.role === "player";
  const [pendingStarId, setPendingStarId] = useState<number | null>(null);

  const validTabs = ["ongoing", "upcoming", "past"];
  React.useEffect(() => {
    if (!validTabs.includes(activeTab)) {
      setLocation("/dashboard/ongoing", { replace: true });
    }
  }, [activeTab, setLocation]);

  useEffect(() => {
    if (isPlayer) {
      // Request FCM token and register it
      requestFirebaseToken().then((token) => {
        if (token) {
          apiRequest('/api/users/fcm-token', {
            method: 'POST',
            body: JSON.stringify({ token })
          }).catch(console.error);
        }
      });
    }
  }, [isPlayer]);

  const { data: tournaments = [], isLoading } = useQuery<Tournament[]>({
    queryKey: ["/api/tournaments"],
  });

  const { data: starredEntries = [] } = useQuery<TournamentStar[]>({
    queryKey: ["/api/tournaments/starred"],
    enabled: isPlayer,
  });

  const { data: myRegistrations = [] } = useQuery<PlayerRegistrationType[]>({
    queryKey: ["/api/my-registrations"],
  });

  const { data: followingList = [] } = useQuery<any[]>({
    queryKey: ["/api/follows/following"],
    enabled: isPlayer,
  });

  const followingIds = useMemo(() => new Set(followingList.map((f) => f.id)), [followingList]);

  const starredIds = useMemo(() => new Set(starredEntries.map((entry) => entry.tournamentId)), [starredEntries]);

  const toggleStar = useMutation<
    TournamentStar | { success: boolean },
    any,
    { tournamentId: number; starred: boolean },
    { previous?: TournamentStar[] }
  >({
    mutationFn: async ({ tournamentId, starred }) => {
      const method = starred ? "DELETE" : "POST";
      return apiRequest(`/api/tournaments/${tournamentId}/star`, { method });
    },
    onMutate: async ({ tournamentId, starred }) => {
      setPendingStarId(tournamentId);
      if (!isPlayer) {
        return {};
      }
      await queryClient.cancelQueries({ queryKey: ["/api/tournaments/starred"] });
      const previous = queryClient.getQueryData<TournamentStar[]>(["/api/tournaments/starred"]);
      const current = previous ?? [];
      let optimistic: TournamentStar[];
      if (starred) {
        optimistic = current.filter((entry) => entry.tournamentId !== tournamentId);
      } else {
        const optimisticEntry: TournamentStar = {
          id: Date.now(),
          tournamentId,
          userId: user?.id ?? 0,
          createdAt: new Date(),
        } as TournamentStar;
        optimistic = current.filter((entry) => entry.tournamentId !== tournamentId).concat(optimisticEntry);
      }
      queryClient.setQueryData(["/api/tournaments/starred"], optimistic);
      return { previous: current };
    },
    onError: (error: any, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(["/api/tournaments/starred"], context.previous);
      }
      toast({
        title: "Unable to update favorites",
        description: error?.message ?? "Please try again.",
        variant: "destructive",
      });
    },
    onSuccess: (result, { tournamentId, starred }) => {
      if (!isPlayer) return;
      queryClient.setQueryData(["/api/tournaments/starred"], (existing?: TournamentStar[]) => {
        const current = existing ?? [];
        if (starred) {
          return current.filter((entry) => entry.tournamentId !== tournamentId);
        }
        const normalized =
          result && typeof result === "object" && "tournamentId" in result
            ? (result as TournamentStar)
            : {
              id: Date.now(),
              tournamentId,
              userId: user?.id ?? 0,
              createdAt: new Date(),
            };
        const filtered = current.filter((entry) => entry.tournamentId !== tournamentId);
        return [...filtered, normalized];
      });
    },
    onSettled: () => {
      setPendingStarId(null);
      if (isPlayer) {
        queryClient.invalidateQueries({ queryKey: ["/api/tournaments/starred"] });
      }
    },
  });

  const handleToggleStar = (tournamentId: number, currentlyStarred: boolean) => {
    if (!isPlayer) return;
    toggleStar.mutate({ tournamentId, starred: currentlyStarred });
  };

  const registrationMap = useMemo(() => {
    const map = new Map<number, PlayerRegistrationType>();
    myRegistrations.forEach((registration) => {
      map.set(registration.tournamentId, registration);
    });
    return map;
  }, [myRegistrations]);

  const [searchQuery, setSearchQuery] = useState("");
  const [filterFormat, setFilterFormat] = useState("all");
  const [filterState, setFilterState] = useState("all");
  const [filterMinSubscribers, setFilterMinSubscribers] = useState("0");
  const [filterOnlyFavorites, setFilterOnlyFavorites] = useState(false);
  const [filterOnlyFollowing, setFilterOnlyFollowing] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [isFiltersOpen, setIsFiltersOpen] = useState(false);

  const activeFiltersCount = useMemo(() => {
    let count = 0;
    if (searchQuery) count++;
    if (filterFormat !== "all") count++;
    if (filterState !== "all") count++;
    if (filterMinSubscribers !== "0") count++;
    if (filterOnlyFavorites) count++;
    if (filterOnlyFollowing) count++;
    return count;
  }, [searchQuery, filterFormat, filterState, filterMinSubscribers, filterOnlyFavorites, filterOnlyFollowing]);

  const { data: statsData = [], isLoading: statsLoading } = useQuery<TournamentRow[]>({
    queryKey: ["tournament-stats", tournaments.map((tournament) => tournament.id)],
    enabled: tournaments.length > 0,
    queryFn: async () => {
      return Promise.all(
        tournaments.map(async (tournament) => {
          let players: Player[] = [];
          try {
            players = (await apiRequest(`/api/tournaments/${tournament.id}/players`)) as Player[];
          } catch (error) {
            console.error("Failed to fetch players for tournament", tournament.id, error);
          }

          const config = parseTournamentConfig(tournament);
          const sectionsCandidate = (config as any)?.sections ?? (config as any)?.sectionDefinitions;
          const sectionsCount = Array.isArray(sectionsCandidate) ? sectionsCandidate.length : null;
          const state =
            (config.uscf?.state?.trim() || tournament.location?.split(",").pop()?.trim() || "") || "N/A";

          return {
            tournament,
            playersCount: players.length,
            sectionsCount,
            startDate: config.basic.startDate ? new Date(config.basic.startDate) : null,
            endDate: config.basic.endDate ? new Date(config.basic.endDate) : null,
            state,
          } as TournamentRow;
        })
      );
    },
  });

  const statsRows = useMemo<TournamentRow[]>(() => {
    if (statsData.length === tournaments.length && statsData.length > 0) {
      return statsData;
    }

    return tournaments.map((tournament) => {
      const config = parseTournamentConfig(tournament);
      const state =
        (config.uscf?.state?.trim() || tournament.location?.split(",").pop()?.trim() || "") || "N/A";

      return {
        tournament,
        playersCount: typeof (tournament as any).playerCount === "number" ? (tournament as any).playerCount : 0,
        sectionsCount: null,
        startDate: config.basic.startDate ? new Date(config.basic.startDate) : null,
        endDate: config.basic.endDate ? new Date(config.basic.endDate) : null,
        state,
      } as TournamentRow;
    });
  }, [statsData, tournaments]);

  const uniqueStates = useMemo(() => {
    const states = new Set<string>();
    statsRows.forEach((row) => {
      if (row.state && row.state !== "N/A") {
        states.add(row.state);
      }
    });
    return Array.from(states).sort();
  }, [statsRows]);

  const filteredAndSortedRows = useMemo(() => {
    return statsRows
      .filter((row) => {
        // Search Query (name / location)
        if (searchQuery) {
          const q = searchQuery.toLowerCase();
          const nameMatch = (row.tournament.name || "").toLowerCase().includes(q);
          const locMatch = (row.tournament.location || "").toLowerCase().includes(q);
          if (!nameMatch && !locMatch) return false;
        }

        // Format
        if (filterFormat !== "all" && row.tournament.format !== filterFormat) {
          return false;
        }

        // State
        if (filterState !== "all" && row.state !== filterState) {
          return false;
        }

        // Min Subscribers
        const minSubs = parseInt(filterMinSubscribers, 10);
        const creatorSubs = (row.tournament as any).creatorSubscribers ?? 0;
        if (creatorSubs < minSubs) {
          return false;
        }

        // Only Favorites
        if (filterOnlyFavorites && !starredIds.has(row.tournament.id)) {
          return false;
        }

        // Only Following
        if (filterOnlyFollowing && !followingIds.has(row.tournament.createdBy)) {
          return false;
        }

        return true;
      })
      .sort((a, b) => {
        let comparison = 0;
        switch (sortKey) {
          case "name":
            comparison = (a.tournament.name || "").localeCompare(b.tournament.name || "");
            break;
          case "format":
            comparison = (a.tournament.format || "").localeCompare(b.tournament.format || "");
            break;
          case "rounds": {
            const aRounds = a.tournament.rounds ?? 0;
            const bRounds = b.tournament.rounds ?? 0;
            comparison = aRounds - bRounds;
            break;
          }
          case "players":
            comparison = a.playersCount - b.playersCount;
            break;
          case "subscribers": {
            const aSubs = (a.tournament as any).creatorSubscribers ?? 0;
            const bSubs = (b.tournament as any).creatorSubscribers ?? 0;
            comparison = aSubs - bSubs;
            break;
          }
          case "state":
            comparison = (a.state || "").localeCompare(b.state || "");
            break;
          case "date":
          default: {
            const aTime = a.startDate ? a.startDate.getTime() : Number.POSITIVE_INFINITY;
            const bTime = b.startDate ? b.startDate.getTime() : Number.POSITIVE_INFINITY;
            comparison = aTime - bTime;
            break;
          }
        }

        // Apply sort direction
        if (sortDirection === "desc") {
          comparison = -comparison;
        }

        // Secondary sorting by favorites
        if (comparison === 0 && isPlayer) {
          const aStar = starredIds.has(a.tournament.id);
          const bStar = starredIds.has(b.tournament.id);
          if (aStar !== bStar) {
            return aStar ? -1 : 1;
          }
        }

        return comparison;
      });
  }, [statsRows, searchQuery, filterFormat, filterState, filterMinSubscribers, filterOnlyFavorites, filterOnlyFollowing, sortKey, sortDirection, starredIds, followingIds, isPlayer]);

  const sectionsData = useMemo<SectionData[]>(() => {
    const ongoing = filteredAndSortedRows.filter((entry) => entry.tournament.status === "active");
    const upcoming = filteredAndSortedRows.filter((entry) => entry.tournament.status === "upcoming");
    const past = filteredAndSortedRows.filter((entry) => entry.tournament.status === "completed");

    return [
      {
        key: "ongoing",
        label: "Ongoing Tournaments",
        description: "Live events happening right now.",
        items: ongoing,
        empty: "No tournaments match the active filters.",
      },
      {
        key: "upcoming",
        label: "Upcoming Tournaments",
        description: "Events that are scheduled to start soon.",
        items: upcoming,
        empty: "No upcoming tournaments match the active filters.",
      },
      {
        key: "past",
        label: "Past Tournaments",
        description: "Completed events you can revisit.",
        items: past,
        empty: "No past tournaments match the active filters.",
      },
    ];
  }, [filteredAndSortedRows]);

  const getFormatName = (format: string) => {
    switch (format) {
      case 'swiss': return 'Swiss System';
      case 'roundrobin': return 'Round Robin';
      case 'knockout': return 'Knockout';
      default: return format;
    }
  };

  const formatDateRange = (start: Date | null, end: Date | null) => {
    const format = (date: Date | null) =>
      date ? new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(date) : "TBD";

    if (!start && !end) return "TBD";
    if (!start) return `TBD - ${format(end)}`;
    if (!end) return `${format(start)} - TBD`;
    return `${format(start)} - ${format(end)}`;
  };

  const renderTournamentRow = (entry: TournamentRow) => {
    const { tournament, playersCount, sectionsCount, startDate, endDate, state } = entry;
    const isStarred = starredIds.has(tournament.id);
    const isPendingStar = pendingStarId === tournament.id && toggleStar.isPending;

    const rowClass = isStarred
      ? "border-b border-slate-200 bg-blue-50/60 transition-colors duration-200 last:border-b-0 hover:bg-blue-100/60 dark:border-slate-800 dark:bg-blue-900/20 dark:hover:bg-blue-900/40"
      : "border-b border-slate-200 bg-white transition-colors duration-200 last:border-b-0 hover:bg-slate-50 dark:border-slate-800 dark:bg-transparent dark:hover:bg-slate-800/40";

    return (
      <tr key={tournament.id} className={rowClass}>
        <td className="px-4 py-4 text-center align-middle">
          {isPlayer ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded-full"
              onClick={(event) => {
                event.preventDefault();
                handleToggleStar(tournament.id, isStarred);
              }}
              disabled={isPendingStar}
              aria-label={isStarred ? "Remove from favorites" : "Add to favorites"}
            >
              {isPendingStar ? (
                <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
              ) : (
                <Star
                  className={isStarred ? "h-4 w-4 text-blue-500" : "h-4 w-4 text-slate-400"}
                  fill={isStarred ? "currentColor" : "none"}
                />
              )}
            </Button>
          ) : (
            <span className="text-xs text-slate-400">—</span>
          )}
        </td>
        <td className="px-4 py-4 align-middle">
          <div className="space-y-1">
            <div className="flex items-center gap-2 font-semibold text-slate-900 dark:text-slate-100">
              <span>{tournament.name}</span>
            </div>
            <div className="text-xs text-slate-500">{getFormatName(tournament.format)}</div>
          </div>
        </td>
        <td className="px-4 py-4 text-center align-middle text-sm text-slate-700 dark:text-slate-300">{state || "N/A"}</td>
        <td className="px-4 py-4 text-center align-middle text-sm text-slate-700 dark:text-slate-300">
          {playersCount} player{playersCount === 1 ? "" : "s"}
        </td>
        <td className="px-4 py-4 text-center align-middle text-sm text-slate-700 dark:text-slate-300">
          {(tournament as any).creatorSubscribers ?? 0}
        </td>
        <td className="px-4 py-4 text-center align-middle text-sm text-slate-700 dark:text-slate-300">{formatDateRange(startDate, endDate)}</td>
        <td className="px-4 py-4 text-center align-middle text-sm text-slate-700 dark:text-slate-300">{sectionsCount ?? "—"}</td>
        <td className="px-4 py-4 align-middle text-center">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setLocation(`/tournaments/${slugify(tournament.name)}`)}
            className="inline-flex items-center gap-2"
          >
            <Eye className="h-4 w-4" />
            View
          </Button>
        </td>
      </tr>
    );
  };

  const renderSection = (section: SectionData) => {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{section.label}</CardTitle>
          <CardDescription>{section.description}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {section.items.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-4 py-12 text-center">
              <Trophy className="h-12 w-12 text-gray-400" />
              <div className="space-y-2">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Nothing here yet</h3>
                <p className="text-gray-600 dark:text-gray-300">{section.empty}</p>
              </div>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-[960px] w-full border-collapse overflow-hidden rounded-xl">
                <thead className="bg-slate-50 dark:bg-slate-800/50">
                  <tr className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    <th className="px-4 py-3 text-center">Favorite</th>
                    <th className="px-4 py-3 text-left">Tournament Name</th>
                    <th className="px-4 py-3 text-center">State</th>
                    <th className="px-4 py-3 text-center">Players</th>
                    <th className="px-4 py-3 text-center">Organizer Subscribers</th>
                    <th className="px-4 py-3 text-center">Start Date – End Date</th>
                    <th className="px-4 py-3 text-center">Sections</th>
                    <th className="px-4 py-3 text-center">View</th>
                  </tr>
                </thead>
                <tbody>{section.items.map((entry) => renderTournamentRow(entry))}</tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    );
  };


  if (isLoading || statsLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading tournaments...</p>
        </div>
      </div>
    );
  }

  // Show tournament list (View button navigates to /tournaments/:id)
  return (
    <div className="min-h-screen bg-transparent">
      <div className="bg-white/80 dark:bg-gray-800/80 backdrop-blur-md shadow">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col md:flex-row md:items-center justify-between py-6 gap-6 text-center md:text-left">
            <div className="space-y-1">
              <h1 className="text-3xl font-bold text-gray-900 dark:text-white tracking-tight">Player Dashboard</h1>
              <p className="text-gray-600 dark:text-gray-300 text-sm">
                Welcome back, {user?.firstName} {user?.lastName}
              </p>
            </div>
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-center md:justify-end gap-3 w-full md:w-auto">
              <div className="flex items-center justify-center gap-2 sm:gap-4 pb-1 sm:pb-0">
                <Link href="/messages">
                  <Button variant="ghost" size="icon" className="rounded-full">
                    <MessageCircle className="h-5 w-5" />
                  </Button>
                </Link>
                <NotificationBell />
                <SettingsMenu />
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 pt-6 pb-10">

        {/* My Registrations Status section removed - now in Notification Bell */}

        {tournaments.length > 0 ? (
          <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-3 mb-6 shadow-sm space-y-3">
            {/* Top Bar: Always Visible */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
              <div className="relative w-full sm:w-72">
                <Input
                  placeholder="Search name or location..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="h-9 pr-8 text-sm rounded-lg"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery("")}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs"
                  >
                    ×
                  </button>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto justify-end">
                {/* Sort selector (always visible) */}
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-slate-500 hidden md:inline">Sort:</span>
                  <Select value={sortKey} onValueChange={(val) => setSortKey(val as any)}>
                    <SelectTrigger className="h-9 text-xs w-32 rounded-lg">
                      <SelectValue placeholder="Sort by" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="date">Start Date</SelectItem>
                      <SelectItem value="players">Players Count</SelectItem>
                      <SelectItem value="subscribers">Subscribers</SelectItem>
                      <SelectItem value="state">State</SelectItem>
                      <SelectItem value="name">Name</SelectItem>
                      <SelectItem value="format">Format</SelectItem>
                      <SelectItem value="rounds">Rounds</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setSortDirection(prev => prev === "asc" ? "desc" : "asc")}
                    className="h-9 w-9 rounded-lg border border-slate-200 dark:border-slate-800"
                  >
                    <span className="text-xs font-bold">{sortDirection === "asc" ? "↑" : "↓"}</span>
                  </Button>
                </div>

                {/* Advanced Filters Toggle */}
                <Button
                  variant={isFiltersOpen ? "secondary" : "outline"}
                  size="sm"
                  onClick={() => setIsFiltersOpen(!isFiltersOpen)}
                  className="h-9 gap-2 rounded-lg text-xs"
                >
                  <SlidersHorizontal className="h-3.5 w-3.5" />
                  <span>Filters</span>
                  {activeFiltersCount > 0 && (
                    <Badge className="ml-0.5 px-1.5 py-0.5 text-[10px] font-semibold bg-indigo-100 text-indigo-800 hover:bg-indigo-100 dark:bg-indigo-900/30 dark:text-indigo-300">
                      {activeFiltersCount}
                    </Badge>
                  )}
                  <span className="text-[10px] text-slate-400">
                    {isFiltersOpen ? "▲" : "▼"}
                  </span>
                </Button>

                {activeFiltersCount > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setSearchQuery("");
                      setFilterFormat("all");
                      setFilterState("all");
                      setFilterMinSubscribers("0");
                      setFilterOnlyFavorites(false);
                      setFilterOnlyFollowing(false);
                    }}
                    className="text-xs text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/20 h-9 px-2.5 rounded-lg"
                  >
                    Clear All
                  </Button>
                )}
              </div>
            </div>

            {/* Collapsible Panel */}
            {isFiltersOpen && (
              <div className="pt-3 border-t border-slate-100 dark:border-slate-800 grid grid-cols-1 sm:grid-cols-3 gap-4 animate-in fade-in slide-in-from-top-2 duration-200">
                {/* Format Filter */}
                <div className="space-y-1">
                  <Label className="text-[11px] font-medium text-slate-500">Format</Label>
                  <Select value={filterFormat} onValueChange={setFilterFormat}>
                    <SelectTrigger className="h-8.5 text-xs rounded-lg">
                      <SelectValue placeholder="All Formats" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Formats</SelectItem>
                      <SelectItem value="swiss">Swiss System</SelectItem>
                      <SelectItem value="roundrobin">Round Robin</SelectItem>
                      <SelectItem value="knockout">Knockout</SelectItem>
                      <SelectItem value="arena">Arena Mode</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* State Filter */}
                <div className="space-y-1">
                  <Label className="text-[11px] font-medium text-slate-500">State</Label>
                  <Select value={filterState} onValueChange={setFilterState}>
                    <SelectTrigger className="h-8.5 text-xs rounded-lg">
                      <SelectValue placeholder="All States" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All States</SelectItem>
                      {uniqueStates.map((st) => (
                        <SelectItem key={st} value={st}>{st}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Min Subscribers Filter */}
                <div className="space-y-1">
                  <Label className="text-[11px] font-medium text-slate-500">Min Organizer Followers</Label>
                  <Select value={filterMinSubscribers} onValueChange={setFilterMinSubscribers}>
                    <SelectTrigger className="h-8.5 text-xs rounded-lg">
                      <SelectValue placeholder="Any amount" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="0">Any amount</SelectItem>
                      <SelectItem value="1">1+ follower</SelectItem>
                      <SelectItem value="5">5+ followers</SelectItem>
                      <SelectItem value="10">10+ followers</SelectItem>
                      <SelectItem value="25">25+ followers</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Switches Row */}
                <div className="sm:col-span-3 flex flex-wrap items-center gap-6 pt-1">
                  <div className="flex items-center gap-2">
                    <Switch
                      id="favorites-filter"
                      checked={filterOnlyFavorites}
                      onCheckedChange={setFilterOnlyFavorites}
                      className="scale-90"
                    />
                    <Label htmlFor="favorites-filter" className="text-xs font-medium cursor-pointer text-slate-700 dark:text-slate-300">
                      Only Favorites
                    </Label>
                  </div>

                  <div className="flex items-center gap-2">
                    <Switch
                      id="following-filter"
                      checked={filterOnlyFollowing}
                      onCheckedChange={setFilterOnlyFollowing}
                      className="scale-90"
                    />
                    <Label htmlFor="following-filter" className="text-xs font-medium cursor-pointer text-slate-700 dark:text-slate-300">
                      Only Followed Organizers
                    </Label>
                  </div>
                </div>
              </div>
            )}
          </div>
        ) : null}

        <Tabs value={activeTab} onValueChange={(tab) => setLocation(`/dashboard/${tab}`)} className="w-full">
          <TabsList className="flex w-full min-h-[64px] flex-nowrap overflow-x-auto no-scrollbar items-center gap-3 bg-transparent mb-6">
            {sectionsData.map((section) => (
              <TabsTrigger
                key={section.key}
                value={section.key}
                className="flex-none md:flex-1 flex h-full min-w-[140px] flex-col items-center justify-center gap-1 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-center text-sm font-medium text-slate-600 shadow-sm transition whitespace-nowrap data-[state=active]:border-blue-200 data-[state=active]:bg-blue-50 data-[state=active]:text-blue-900"
              >
                <span className="leading-tight">{section.label}</span>
                <span className="text-xs text-slate-500 leading-tight">
                  {section.items.length} tournament{section.items.length === 1 ? "" : "s"}
                </span>
              </TabsTrigger>
            ))}
          </TabsList>

          {sectionsData.map((section) => (
            <TabsContent key={section.key} value={section.key} className="mt-8 space-y-6">
              {renderSection(section)}
            </TabsContent>
          ))}
        </Tabs>
      </div>
    </div>
  );
}
