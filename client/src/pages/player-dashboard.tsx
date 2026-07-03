import React, { useEffect, useMemo, useState, useRef } from "react";
import type { ComponentType } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useRoute, Link } from "wouter";
import {
  Trophy, Users, Eye, Medal, Info, Calculator, PauseCircle, Star,
  Loader2, MessageCircle, SlidersHorizontal, X, ChevronUp, ChevronDown,
  ChevronsUpDown, CalendarDays, CheckSquare, Square,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import SettingsMenu from "@/components/settings-menu";

import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import type { Tournament, Player, PlayerRegistration as PlayerRegistrationType, TournamentStar } from "@shared/schema";
import Standings from "@/components/standings";
import SwissStandings from "@/components/swiss-standings";
import SwissPairings from "@/components/swiss-pairings";
import RoundRobinCrosstable from "@/components/round-robin-crosstable";
import KnockoutBracket from "@/components/knockout-bracket";
import PairingPredictor from "@/components/pairing-predictor";
import PlayerRegistration from "@/components/player-registration";
import TournamentByes from "@/components/tournament-byes";
import { parseTournamentConfig } from "@/lib/tournament-config";
import { apiRequest } from "@/lib/queryClient";
import { requestFirebaseToken } from "@/lib/firebase";
import { RegistrationStatusCard } from "@/components/registration-status-card";
import NotificationBell from "@/components/notification-bell";
import { slugify } from "@/lib/utils";

// ΓöÇΓöÇΓöÇ Types ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
type SortKey = "players" | "date" | "state" | "name" | "format" | "rounds" | "following";
type FormatFilter = "swiss" | "roundrobin" | "knockout" | "arena";
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

interface FilterState {
  formats: FormatFilter[];
  states: string[];
  minPlayers: number | null;
  maxPlayers: number | null;
  startAfter: string;
  startBefore: string;
  showStarredOnly: boolean;
  searchText: string;
  minFollowers: number;
  showFollowingOnly: boolean;
}

const DEFAULT_FILTERS: FilterState = {
  formats: [],
  states: [],
  minPlayers: null,
  maxPlayers: null,
  startAfter: "",
  startBefore: "",
  showStarredOnly: false,
  searchText: "",
  minFollowers: 0,
  showFollowingOnly: false,
};

const DETAIL_TAB_META: Array<{ key: DetailTabKey; label: string; icon: ComponentType<{ className?: string }> }> = [
  { key: "pairings", label: "Pairings", icon: Users },
  { key: "standings", label: "Standings", icon: Medal },
  { key: "byes", label: "Byes", icon: PauseCircle },
  { key: "predictor", label: "Pairing Predictor", icon: Calculator },
  { key: "info", label: "Info", icon: Info },
];

const FORMAT_OPTIONS: { value: FormatFilter; label: string }[] = [
  { value: "swiss", label: "Swiss System" },
  { value: "roundrobin", label: "Round Robin" },
  { value: "knockout", label: "Knockout" },
  { value: "arena", label: "Arena" },
];

// ΓöÇΓöÇΓöÇ Helper Components ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
function MultiCheckbox({
  options,
  value,
  onChange,
}: {
  options: { value: string; label: string }[];
  value: string[];
  onChange: (newVal: string[]) => void;
}) {
  const toggle = (v: string) => {
    if (value.includes(v)) onChange(value.filter((x) => x !== v));
    else onChange([...value, v]);
  };
  return (
    <div className="flex flex-col gap-1.5">
      {options.map((opt) => {
        const checked = value.includes(opt.value);
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => toggle(opt.value)}
            className="flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm text-left hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            {checked ? (
              <CheckSquare className="h-4 w-4 text-blue-600 shrink-0" />
            ) : (
              <Square className="h-4 w-4 text-slate-400 shrink-0" />
            )}
            <span className={checked ? "text-slate-900 dark:text-slate-100 font-medium" : "text-slate-600 dark:text-slate-400"}>
              {opt.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function FilterPanel({
  filters,
  setFilters,
  activeCount,
  onReset,
  isOpen,
  onClose,
  uniqueStates,
}: {
  filters: FilterState;
  setFilters: React.Dispatch<React.SetStateAction<FilterState>>;
  activeCount: number;
  onReset: () => void;
  isOpen: boolean;
  onClose: () => void;
  uniqueStates: string[];
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40 bg-black/20 backdrop-blur-[1px]" />

      {/* Panel */}
      <div
        ref={panelRef}
        className="fixed right-0 top-0 bottom-0 z-50 w-80 bg-white dark:bg-slate-900 shadow-2xl border-l border-slate-200 dark:border-slate-700 flex flex-col animate-in slide-in-from-right duration-200"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-700">
          <div className="flex items-center gap-2">
            <SlidersHorizontal className="h-4 w-4 text-slate-500" />
            <span className="font-semibold text-slate-900 dark:text-slate-100">Filters & Sort</span>
            {activeCount > 0 && (
              <span className="inline-flex items-center justify-center h-5 w-5 rounded-full bg-blue-600 text-white text-[10px] font-bold">
                {activeCount}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {activeCount > 0 && (
              <button
                onClick={onReset}
                className="text-xs text-blue-600 hover:text-blue-700 font-medium"
              >
                Reset all
              </button>
            )}
            <button
              onClick={onClose}
              className="rounded-full p-1 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              <X className="h-4 w-4 text-slate-500" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-6">

          {/* Search */}
          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Search</Label>
            <Input
              placeholder="Search name, director, org..."
              value={filters.searchText}
              onChange={(e) => setFilters((f) => ({ ...f, searchText: e.target.value }))}
              className="h-8 text-sm"
            />
          </div>

          {/* Format */}
          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Format</Label>
            <MultiCheckbox
              options={FORMAT_OPTIONS}
              value={filters.formats}
              onChange={(v) => setFilters((f) => ({ ...f, formats: v as FormatFilter[] }))}
            />
          </div>

          {/* State */}
          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase tracking-wide text-slate-500">States</Label>
            {uniqueStates.length === 0 ? (
              <p className="text-xs text-slate-400">No states available</p>
            ) : (
              <div className="max-h-32 overflow-y-auto pr-1 border border-slate-100 dark:border-slate-800 rounded-md p-1.5 space-y-1">
                <MultiCheckbox
                  options={uniqueStates.map(s => ({ value: s, label: s }))}
                  value={filters.states}
                  onChange={(v) => setFilters((f) => ({ ...f, states: v }))}
                />
              </div>
            )}
          </div>

          {/* Players range */}
          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Player Count</Label>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min={0}
                placeholder="Min"
                value={filters.minPlayers ?? ""}
                onChange={(e) =>
                  setFilters((f) => ({
                    ...f,
                    minPlayers: e.target.value !== "" ? parseInt(e.target.value) : null,
                  }))
                }
                className="h-8 text-sm w-full"
              />
              <span className="text-slate-400 text-sm shrink-0">ΓÇô</span>
              <Input
                type="number"
                min={0}
                placeholder="Max"
                value={filters.maxPlayers ?? ""}
                onChange={(e) =>
                  setFilters((f) => ({
                    ...f,
                    maxPlayers: e.target.value !== "" ? parseInt(e.target.value) : null,
                  }))
                }
                className="h-8 text-sm w-full"
              />
            </div>
          </div>

          {/* Date range */}
          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase tracking-wide text-slate-500 flex items-center gap-1">
              <CalendarDays className="h-3 w-3" /> Start Date Range
            </Label>
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400 w-10 shrink-0">From</span>
                <Input
                  type="date"
                  value={filters.startAfter}
                  onChange={(e) => setFilters((f) => ({ ...f, startAfter: e.target.value }))}
                  className="h-8 text-sm flex-1"
                />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400 w-10 shrink-0">To</span>
                <Input
                  type="date"
                  value={filters.startBefore}
                  onChange={(e) => setFilters((f) => ({ ...f, startBefore: e.target.value }))}
                  className="h-8 text-sm flex-1"
                />
              </div>
            </div>
          </div>

          {/* Starred only */}
          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Favorites & Following</Label>
            <div className="space-y-1">
              <button
                type="button"
                onClick={() => setFilters((f) => ({ ...f, showStarredOnly: !f.showStarredOnly }))}
                className="flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm text-left hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors w-full"
              >
                {filters.showStarredOnly ? (
                  <CheckSquare className="h-4 w-4 text-blue-600 shrink-0" />
                ) : (
                  <Square className="h-4 w-4 text-slate-400 shrink-0" />
                )}
                <span className={filters.showStarredOnly ? "text-slate-900 dark:text-slate-100 font-medium" : "text-slate-600 dark:text-slate-400"}>
                  Show starred only
                </span>
              </button>
              <button
                type="button"
                onClick={() => setFilters((f) => ({ ...f, showFollowingOnly: !f.showFollowingOnly }))}
                className="flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm text-left hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors w-full"
              >
                {filters.showFollowingOnly ? (
                  <CheckSquare className="h-4 w-4 text-blue-600 shrink-0" />
                ) : (
                  <Square className="h-4 w-4 text-slate-400 shrink-0" />
                )}
                <span className={filters.showFollowingOnly ? "text-slate-900 dark:text-slate-100 font-medium" : "text-slate-600 dark:text-slate-400"}>
                  Followed organizers only
                </span>
              </button>
            </div>
          </div>

          {/* Min Followers */}
          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Min Organizer Followers</Label>
            <Select
              value={String(filters.minFollowers)}
              onValueChange={(val: string) => setFilters((f) => ({ ...f, minFollowers: parseInt(val) }))}
            >
              <SelectTrigger className="h-8 text-xs">
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
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-slate-200 dark:border-slate-700">
          <Button onClick={onClose} className="w-full" size="sm">
            Apply Filters
          </Button>
        </div>
      </div>
    </>
  );
}

// ΓöÇΓöÇΓöÇ Main Component ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
export default function PlayerDashboard() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [, dashboardParams] = useRoute("/dashboard/:tab");
  const activeTab = dashboardParams?.tab ?? "ongoing";
  const queryClient = useQueryClient();
  const isPlayer = user?.role === "player";
  const [pendingStarId, setPendingStarId] = useState<number | null>(null);

  // Filter & sort state
  const [filterOpen, setFilterOpen] = useState(false);
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [sortKey, setSortKey] = useState<SortKey>("date");

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (filters.formats.length > 0) count++;
    if (filters.states.length > 0) count++;
    if (filters.minPlayers !== null || filters.maxPlayers !== null) count++;
    if (filters.startAfter) count++;
    if (filters.startBefore) count++;
    if (filters.showStarredOnly) count++;
    if (filters.searchText.trim()) count++;
    if (filters.minFollowers > 0) count++;
    if (filters.showFollowingOnly) count++;
    return count;
  }, [filters]);

  const validTabs = ["ongoing", "upcoming", "past"];
  React.useEffect(() => {
    if (!validTabs.includes(activeTab)) {
      setLocation("/dashboard/ongoing", { replace: true });
    }
  }, [activeTab, setLocation]);

  useEffect(() => {
    if (isPlayer) {
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
      if (!isPlayer) return {};
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
        if (starred) return current.filter((entry) => entry.tournamentId !== tournamentId);
        const normalized =
          result && typeof result === "object" && "tournamentId" in result
            ? (result as TournamentStar)
            : { id: Date.now(), tournamentId, userId: user?.id ?? 0, createdAt: new Date() };
        return [...current.filter((e) => e.tournamentId !== tournamentId), normalized];
      });
    },
    onSettled: () => {
      setPendingStarId(null);
      if (isPlayer) queryClient.invalidateQueries({ queryKey: ["/api/tournaments/starred"] });
    },
  });

  const handleToggleStar = (tournamentId: number, currentlyStarred: boolean) => {
    if (!isPlayer) return;
    toggleStar.mutate({ tournamentId, starred: currentlyStarred });
  };

  const registrationMap = useMemo(() => {
    const map = new Map<number, PlayerRegistrationType>();
    myRegistrations.forEach((r) => map.set(r.tournamentId, r));
    return map;
  }, [myRegistrations]);

  const { data: statsData = [], isLoading: statsLoading } = useQuery<TournamentRow[]>({
    queryKey: ["tournament-stats", tournaments.map((t) => t.id)],
    enabled: tournaments.length > 0,
    queryFn: async () => {
      return Promise.all(
        tournaments.map(async (tournament) => {
          let players: Player[] = [];
          try {
            players = (await apiRequest(`/api/tournaments/${tournament.id}/players`)) as Player[];
          } catch {}
          const config = parseTournamentConfig(tournament);
          const sectionsCandidate = (config as any)?.sections ?? (config as any)?.sectionDefinitions;
          const sectionsCount = Array.isArray(sectionsCandidate) ? sectionsCandidate.length : null;
          const state = (config.uscf?.state?.trim() || tournament.location?.split(",").pop()?.trim() || "") || "N/A";
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
    if (statsData.length === tournaments.length && statsData.length > 0) return statsData;
    return tournaments.map((tournament) => {
      const config = parseTournamentConfig(tournament);
      const state = (config.uscf?.state?.trim() || tournament.location?.split(",").pop()?.trim() || "") || "N/A";
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

  // Apply filters
  const filteredRows = useMemo(() => {
    return statsRows.filter((entry) => {
      const t = entry.tournament;
      if (filters.formats.length > 0 && !filters.formats.includes(t.format as FormatFilter)) return false;
      if (filters.states.length > 0 && !filters.states.includes(entry.state)) return false;
      if (filters.minPlayers !== null && entry.playersCount < filters.minPlayers) return false;
      if (filters.maxPlayers !== null && entry.playersCount > filters.maxPlayers) return false;
      if (filters.startAfter && entry.startDate) {
        const after = new Date(filters.startAfter);
        if (entry.startDate < after) return false;
      }
      if (filters.startBefore && entry.startDate) {
        const before = new Date(filters.startBefore);
        if (entry.startDate > before) return false;
      }
      if (filters.showStarredOnly && !starredIds.has(t.id)) return false;
      if (filters.showFollowingOnly && !followingIds.has(t.createdBy)) return false;
      if (filters.minFollowers > 0) {
        const creatorSubs = (t as any).creatorSubscribers ?? 0;
        if (creatorSubs < filters.minFollowers) return false;
      }
      if (filters.searchText.trim()) {
        const q = filters.searchText.trim().toLowerCase();
        const nameMatch = t.name.toLowerCase().includes(q);
        const locationMatch = (t.location || "").toLowerCase().includes(q);
        const creatorMatch = ((t as any).creatorName || "").toLowerCase().includes(q);
        const orgMatch = ((t as any).creatorOrganization || "").toLowerCase().includes(q);
        if (!nameMatch && !locationMatch && !creatorMatch && !orgMatch) return false;
      }
      return true;
    });
  }, [statsRows, filters, starredIds, followingIds]);

  const sectionsRaw = useMemo(() => ({
    past: filteredRows.filter((e) => e.tournament.status === "completed"),
    upcoming: filteredRows.filter((e) => e.tournament.status === "upcoming"),
    ongoing: filteredRows.filter((e) => e.tournament.status === "active"),
  }), [filteredRows]);

  const comparator = useMemo(() => {
    return (a: TournamentRow, b: TournamentRow) => {
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
          comparison = bRounds - aRounds;
          break;
        }
        case "players":
          comparison = b.playersCount - a.playersCount;
          break;
        case "state":
          comparison = (a.state || "").localeCompare(b.state || "");
          break;
        case "following":
        case "date":
        default: {
          const aTime = a.startDate ? a.startDate.getTime() : Number.POSITIVE_INFINITY;
          const bTime = b.startDate ? b.startDate.getTime() : Number.POSITIVE_INFINITY;
          comparison = aTime - bTime;
          break;
        }
      }

      if (comparison === 0 && isPlayer) {
        const aStar = starredIds.has(a.tournament.id);
        const bStar = starredIds.has(b.tournament.id);
        if (aStar !== bStar) {
          return aStar ? -1 : 1;
        }
      }

      return comparison;
    };
  }, [sortKey, isPlayer, starredIds]);

  const sectionsData = useMemo<SectionData[]>(
    () => {
      const filterFn = (items: TournamentRow[]) => {
        if (sortKey === "following") {
          return items.filter((entry) => followingIds.has(entry.tournament.createdBy));
        }
        return items;
      };

      return [
        {
          key: "ongoing",
          label: "Ongoing Tournaments",
          description: "Live events happening right now.",
          items: filterFn([...sectionsRaw.ongoing]).sort(comparator),
          empty: sortKey === "following" 
            ? "No live tournaments from organizers you follow." 
            : "No tournaments are currently live.",
        },
        {
          key: "upcoming",
          label: "Upcoming Tournaments",
          description: "Events that are scheduled to start soon.",
          items: filterFn([...sectionsRaw.upcoming]).sort(comparator),
          empty: sortKey === "following"
            ? "No upcoming tournaments from organizers you follow."
            : "No upcoming tournaments are available right now.",
        },
        {
          key: "past",
          label: "Past Tournaments",
          description: "Completed events you can revisit.",
          items: filterFn([...sectionsRaw.past]).sort(comparator),
          empty: sortKey === "following"
            ? "No completed tournaments from organizers you follow."
            : "You haven't viewed any completed tournaments yet.",
        },
      ];
    },
    [sectionsRaw, comparator, sortKey, followingIds]
  );

  const getFormatName = (format: string) => {
    switch (format) {
      case 'swiss': return 'Swiss System';
      case 'roundrobin': return 'Round Robin';
      case 'knockout': return 'Knockout';
      case 'arena': return 'Arena';
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
            <span className="text-xs text-slate-400">ΓÇö</span>
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
        <td className="px-4 py-4 text-center align-middle text-sm text-slate-700 dark:text-slate-300">{formatDateRange(startDate, endDate)}</td>
        <td className="px-4 py-4 text-center align-middle text-sm text-slate-700 dark:text-slate-300">{sectionsCount ?? "ΓÇö"}</td>
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
                <p className="text-gray-600 dark:text-gray-300">
                  {activeFilterCount > 0 ? "Try adjusting your filters." : section.empty}
                </p>
              </div>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-[960px] w-full border-collapse overflow-hidden rounded-xl">
                <thead className="bg-slate-50 dark:bg-slate-800/50">
                  <tr className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    {/* Favorite column - sortable */}
                    <th className="px-4 py-3 text-center">
                      <button
                        onClick={() => setSortKey(sortKey === "following" ? "date" : "following")}
                        className="inline-flex items-center gap-1 hover:text-slate-800 dark:hover:text-slate-200 transition-colors cursor-pointer"
                        title="Sort by favorites"
                      >
                        Favorite
                        {sortKey === "following" ? <ChevronUp className="h-3 w-3" /> : <ChevronsUpDown className="h-3 w-3 opacity-40" />}
                      </button>
                    </th>
                    {/* Tournament Name column - sortable */}
                    <th className="px-4 py-3 text-left">
                      <button
                        onClick={() => setSortKey("name")}
                        className="inline-flex items-center gap-1 hover:text-slate-800 dark:hover:text-slate-200 transition-colors cursor-pointer"
                      >
                        Tournament Name
                        {sortKey === "name" ? <ChevronUp className="h-3 w-3" /> : <ChevronsUpDown className="h-3 w-3 opacity-40" />}
                      </button>
                    </th>
                    {/* State column - sortable */}
                    <th className="px-4 py-3 text-center">
                      <button
                        onClick={() => setSortKey("state")}
                        className="inline-flex items-center gap-1 hover:text-slate-800 dark:hover:text-slate-200 transition-colors cursor-pointer"
                      >
                        State
                        {sortKey === "state" ? <ChevronUp className="h-3 w-3" /> : <ChevronsUpDown className="h-3 w-3 opacity-40" />}
                      </button>
                    </th>
                    {/* Players column - sortable */}
                    <th className="px-4 py-3 text-center">
                      <button
                        onClick={() => setSortKey("players")}
                        className="inline-flex items-center gap-1 hover:text-slate-800 dark:hover:text-slate-200 transition-colors cursor-pointer"
                      >
                        Players
                        {sortKey === "players" ? <ChevronDown className="h-3 w-3" /> : <ChevronsUpDown className="h-3 w-3 opacity-40" />}
                      </button>
                    </th>
                    {/* Date column - sortable */}
                    <th className="px-4 py-3 text-center">
                      <button
                        onClick={() => setSortKey("date")}
                        className="inline-flex items-center gap-1 hover:text-slate-800 dark:hover:text-slate-200 transition-colors cursor-pointer"
                      >
                        Start Date – End Date
                        {sortKey === "date" ? <ChevronUp className="h-3 w-3" /> : <ChevronsUpDown className="h-3 w-3 opacity-40" />}
                      </button>
                    </th>
                    {/* Sections column - not sortable (no sort key) */}
                    <th className="px-4 py-3 text-center">Sections</th>
                    {/* View column - not sortable */}
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

  return (
    <div className="min-h-screen bg-transparent">
      {/* Header */}
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

        {/* Filter button + active filter chips & Sort selector */}
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant={activeFilterCount > 0 ? "default" : "outline"}
              size="sm"
              onClick={() => setFilterOpen(true)}
              className="h-9 gap-1.5 text-sm rounded-lg"
            >
              <SlidersHorizontal className="h-4 w-4" />
              Filters
              {activeFilterCount > 0 && (
                <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-white/25 text-[10px] font-bold">
                  {activeFilterCount}
                </span>
              )}
            </Button>

            {/* Active filter chips */}
            {filters.formats.length > 0 && (
              <Badge variant="secondary" className="gap-1 text-xs cursor-pointer rounded-lg" onClick={() => setFilters(f => ({ ...f, formats: [] }))}>
                Format: {filters.formats.map(getFormatName).join(", ")}
                <X className="h-3 w-3" />
              </Badge>
            )}
            {filters.states.length > 0 && (
              <Badge variant="secondary" className="gap-1 text-xs cursor-pointer rounded-lg" onClick={() => setFilters(f => ({ ...f, states: [] }))}>
                State: {filters.states.join(", ")}
                <X className="h-3 w-3" />
              </Badge>
            )}
            {(filters.minPlayers !== null || filters.maxPlayers !== null) && (
              <Badge variant="secondary" className="gap-1 text-xs cursor-pointer rounded-lg" onClick={() => setFilters(f => ({ ...f, minPlayers: null, maxPlayers: null }))}>
                Players: {filters.minPlayers ?? "0"}ΓÇô{filters.maxPlayers ?? "Γê₧"}
                <X className="h-3 w-3" />
              </Badge>
            )}
            {(filters.startAfter || filters.startBefore) && (
              <Badge variant="secondary" className="gap-1 text-xs cursor-pointer rounded-lg" onClick={() => setFilters(f => ({ ...f, startAfter: "", startBefore: "" }))}>
                <CalendarDays className="h-3 w-3" />
                {filters.startAfter || "ΓÇª"} ΓÇô {filters.startBefore || "ΓÇª"}
                <X className="h-3 w-3" />
              </Badge>
            )}
            {filters.showStarredOnly && (
              <Badge variant="secondary" className="gap-1 text-xs cursor-pointer rounded-lg" onClick={() => setFilters(f => ({ ...f, showStarredOnly: false }))}>
                <Star className="h-3 w-3" /> Starred only
                <X className="h-3 w-3" />
              </Badge>
            )}
            {filters.showFollowingOnly && (
              <Badge variant="secondary" className="gap-1 text-xs cursor-pointer rounded-lg" onClick={() => setFilters(f => ({ ...f, showFollowingOnly: false }))}>
                Followed organizers only
                <X className="h-3 w-3" />
              </Badge>
            )}
            {filters.minFollowers > 0 && (
              <Badge variant="secondary" className="gap-1 text-xs cursor-pointer rounded-lg" onClick={() => setFilters(f => ({ ...f, minFollowers: 0 }))}>
                Followers: {filters.minFollowers}+
                <X className="h-3 w-3" />
              </Badge>
            )}
            {filters.searchText.trim() && (
              <Badge variant="secondary" className="gap-1 text-xs cursor-pointer rounded-lg" onClick={() => setFilters(f => ({ ...f, searchText: "" }))}>
                "{filters.searchText.trim()}"
                <X className="h-3 w-3" />
              </Badge>
            )}
            {activeFilterCount > 0 && (
              <button
                className="text-xs text-slate-400 hover:text-slate-600 underline-offset-2 hover:underline"
                onClick={() => setFilters(DEFAULT_FILTERS)}
              >
                Clear all
              </button>
            )}
          </div>

          {sortKey !== "date" && (
            <button
              className="text-xs text-slate-400 hover:text-slate-600 underline-offset-2 hover:underline flex items-center gap-1"
              onClick={() => setSortKey("date")}
            >
              <X className="h-3 w-3" />
              Clear sort
            </button>
          )}
        </div>

        {/* Tabs */}
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

      {/* Filter panel */}
      <FilterPanel
        filters={filters}
        setFilters={setFilters}
        activeCount={activeFilterCount}
        onReset={() => setFilters(DEFAULT_FILTERS)}
        isOpen={filterOpen}
        onClose={() => setFilterOpen(false)}
        uniqueStates={uniqueStates}
      />
    </div>
  );
}
