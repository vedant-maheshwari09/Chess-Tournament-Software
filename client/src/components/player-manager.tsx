import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Input } from "@/components/ui/input";
import {
  Trash2,
  CheckSquare,
  Check,
  PauseCircle,
  Mail,
  Loader2,
  Copy,
  CheckCircle2,
  X,
  ArrowUpDown,
  Plus,
  CreditCard,
  FilePlus2,
  SlidersHorizontal,
  Search,
  Eye,
  Filter,
  RefreshCw,
} from "lucide-react";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { parseTournamentConfig } from "@/lib/tournament-config";
import type { Tournament, Player, Pairing } from "@shared/schema";
import { cn } from "@/lib/utils";
import { resolveDisplayRating } from "@shared/tournament-config";

type SortKey = "name" | "rating" | "uscfRating" | "section" | "createdAt" | "paymentStatus";
type SortDirection = "asc" | "desc";

interface PlayerManagerProps {
  tournament: Tournament;
  tournamentId: number;
  isTD?: boolean;
}

export default function PlayerManager({ tournament, tournamentId, isTD = true }: PlayerManagerProps) {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [editingSeedId, setEditingSeedId] = useState<number | null>(null);
  const [seedValue, setSeedValue] = useState<string>("");

  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [confirmedMap, setConfirmedMap] = useState<Record<number, boolean>>({});
  const [isDeleting, setIsDeleting] = useState(false);
  const [isStatusDialogOpen, setStatusDialogOpen] = useState(false);
  const [withdrawScope, setWithdrawScope] = useState<"all" | "specific">("all");
  const [selectedRounds, setSelectedRounds] = useState<number[]>([]);
  const [byeType, setByeType] = useState<"zero_point" | "half_point" | "full_point">("zero_point");
  const [isProcessingStatus, setProcessingStatus] = useState(false);
  const [isMessageDialogOpen, setMessageDialogOpen] = useState(false);
  const [messageBody, setMessageBody] = useState("");
  const [isCopyingRecipients, setIsCopyingRecipients] = useState(false);
  const [isCopyingMessage, setIsCopyingMessage] = useState(false);
  const [removingByeIds, setRemovingByeIds] = useState<number[]>([]);
  const [messageChannels, setMessageChannels] = useState({ email: true, push: true });
  const hasChannelSelected = messageChannels.email || messageChannels.push;
  const [activeSection, setActiveSection] = useState("all");
  const [messageSubject, setMessageSubject] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");

  const [searchTerm, setSearchTerm] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterFederation, setFilterFederation] = useState("all");
  const [filterRatingType, setFilterRatingType] = useState("all");
  const [filterVerification, setFilterVerification] = useState("all");
  const [showFilterPanel, setShowFilterPanel] = useState(false);

  const [syncDialogOpen, setSyncDialogOpen] = useState(false);
  const [syncProgress, setSyncProgress] = useState(0);
  const [syncTotal, setSyncTotal] = useState(0);
  const [syncCurrentName, setSyncCurrentName] = useState("");
  const [isSyncingRatings, setIsSyncingRatings] = useState(false);

  const handleSyncAllRatings = async () => {
    const uscfPlayers = players.filter(p => {
      const isUscf = p.federation === "USCF" || p.federation === "United States" || p.federation === "US Chess" || !p.federation;
      const uscfId = p.localId;
      return isUscf && uscfId && /^\d{7,8}$/.test(uscfId.trim());
    });

    if (uscfPlayers.length === 0) {
      toast({
        title: "No Eligible Players",
        description: "There are no players in this tournament with valid 7 or 8-digit USCF IDs configured.",
        variant: "destructive"
      });
      return;
    }

    setSyncTotal(uscfPlayers.length);
    setSyncProgress(0);
    setSyncCurrentName("");
    setSyncDialogOpen(true);
    setIsSyncingRatings(true);

    try {
      for (let i = 0; i < uscfPlayers.length; i++) {
        const player = uscfPlayers[i];
        setSyncCurrentName(`${player.firstName} ${player.lastName}`);
        
        await new Promise(resolve => setTimeout(resolve, 1500));

        try {
          await apiRequest(`/api/tournaments/${tournamentId}/players/${player.id}/sync-rating`, {
            method: "POST"
          });
        } catch (err) {
          console.error(`Failed to sync player ${player.id}:`, err);
        }

        setSyncProgress(prev => prev + 1);
      }

      toast({
        title: "Ratings Sync Complete",
        description: `Successfully finished checking live ratings for all ${uscfPlayers.length} USCF players.`
      });
      queryClient.invalidateQueries({ queryKey: [`/api/tournaments/${tournamentId}/players`] });
    } catch (err) {
      console.error("Bulk sync ratings failed:", err);
      toast({
        title: "Sync Error",
        description: "An unexpected error occurred during ratings sync.",
        variant: "destructive"
      });
    } finally {
      setIsSyncingRatings(false);
    }
  };

  const [visibleColumns, setVisibleColumns] = useState<string[]>(() => {
    if (typeof window !== "undefined") {
      const stored = window.localStorage.getItem(`tournament-${tournamentId}-visible-columns`);
      if (stored) {
        try {
          const parsed = JSON.parse(stored);
          if (Array.isArray(parsed) && !parsed.includes("uscfMembership")) {
            // Upgrade legacy stored layout to the new defaults
            return ["index", "uscfId", "name", "rating", "uscfMembership", "byes", "paymentStatus", "actions"];
          }
          return parsed;
        } catch (e) {
          // ignore
        }
      }
    }
    return ["index", "uscfId", "name", "rating", "uscfMembership", "byes", "paymentStatus", "actions"];
  });

  const isIndexVisible = visibleColumns.includes("index");

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(`tournament-${tournamentId}-visible-columns`, JSON.stringify(visibleColumns));
    }
  }, [visibleColumns, tournamentId]);

  const tournamentConfig = useMemo(() => parseTournamentConfig(tournament), [tournament]);
  const sections = tournamentConfig.sections;

  const { data: players = [], isLoading } = useQuery<Player[]>({
    queryKey: [`/api/tournaments/${tournamentId}/players`],
  });

  const verifyUscfMutation = useMutation({
    mutationFn: async ({ targetUserId, verified }: { targetUserId: number; verified: boolean }) => {
      return apiRequest("/api/verification/uscf/verify-player-connection", {
        method: "POST",
        body: JSON.stringify({ targetUserId, verified })
      });
    },
    onSuccess: () => {
      toast({ title: "Player USCF verified successfully" });
      queryClient.invalidateQueries({ queryKey: [`/api/tournaments/${tournamentId}/players`] });
    },
    onError: (error: any) => {
      toast({
        title: "Verification failed",
        description: error?.message ?? "Unable to verify player USCF connection.",
        variant: "destructive",
      });
    }
  });
 
  const updatePlayerPaymentStatusMutation = useMutation({
    mutationFn: async ({ playerId, paymentStatus }: { playerId: number; paymentStatus: string }) => {
      return apiRequest(`/api/tournaments/${tournamentId}/players/${playerId}`, {
        method: "PUT",
        body: JSON.stringify({ paymentStatus })
      });
    },
    onSuccess: () => {
      toast({ title: "Payment status updated successfully" });
      queryClient.invalidateQueries({ queryKey: [`/api/tournaments/${tournamentId}/players`] });
    },
    onError: (error: any) => {
      toast({
        title: "Update failed",
        description: error?.message ?? "Unable to update player payment status.",
        variant: "destructive",
      });
    }
  });

  const processedPlayers = useMemo(() => {
    let processed = [...players];

    if (activeSection !== "all") {
      processed = processed.filter(p => p.sectionId === activeSection || p.sectionName === activeSection);
    }

    if (searchTerm.trim() !== "") {
      const q = searchTerm.toLowerCase().trim();
      processed = processed.filter(p => {
        const fullName = `${p.firstName} ${p.lastName}`.toLowerCase();
        const email = (p.email || '').toLowerCase();
        const club = (p.club || '').toLowerCase();
        const localId = (p.localId || '').toLowerCase();
        const userUscfId = ((p as any).userUscfId || '').toLowerCase();
        return fullName.includes(q) || email.includes(q) || club.includes(q) || localId.includes(q) || userUscfId.includes(q);
      });
    }

    if (filterStatus !== "all") {
      processed = processed.filter(p => (p.status || 'active') === filterStatus);
    }

    if (filterFederation !== "all") {
      processed = processed.filter(p => {
        const fed = (p.federation || 'uscf').toLowerCase();
        if (filterFederation === "uscf") return fed === "uscf";
        if (filterFederation === "fide") return fed === "fide";
        return fed !== "uscf" && fed !== "fide";
      });
    }

    if (filterRatingType !== "all") {
      processed = processed.filter(p => {
        const ratingVal = p.rating ?? 0;
        const rawRating = (p as any).uscfRatingRaw || '';
        const isProvisional = rawRating.toLowerCase().includes('p');
        const isUnrated = ratingVal === 0 || ratingVal === 1000 && !p.uscfRating && !p.fideRating;

        if (filterRatingType === "unrated") return isUnrated;
        if (filterRatingType === "provisional") return !isUnrated && isProvisional;
        if (filterRatingType === "rated") return !isUnrated && !isProvisional;
        return true;
      });
    }

    if (filterVerification !== "all") {
      processed = processed.filter(p => {
        const status = ((p as any).userUscfVerificationStatus || 'unverified').toLowerCase();
        return status === filterVerification;
      });
    }

    processed.sort((a, b) => {
      if (sortKey === 'name') {
        const nameA = `${a.lastName}, ${a.firstName}`;
        const nameB = `${b.lastName}, ${b.firstName}`;
        return sortDirection === 'asc' ? nameA.localeCompare(nameB) : nameB.localeCompare(nameA);
      }
      if (sortKey === 'rating') {
        const isFide = tournamentConfig.details.primaryRatingSystem === 'fide';
        const ratingA = isFide ? (a.fideRating ?? a.rating ?? 0) : (a.uscfRating ?? a.rating ?? 0);
        const ratingB = isFide ? (b.fideRating ?? b.rating ?? 0) : (b.uscfRating ?? b.rating ?? 0);
        return sortDirection === 'asc' ? ratingA - ratingB : ratingB - ratingA;
      }
      if (sortKey === 'uscfRating') {
        const ratingA = a.uscfRating ?? a.rating ?? 0;
        const ratingB = b.uscfRating ?? b.rating ?? 0;
        return sortDirection === 'asc' ? ratingA - ratingB : ratingB - ratingA;
      }
      if (sortKey === 'section') {
        const secA = a.sectionName || "Default";
        const secB = b.sectionName || "Default";
        return sortDirection === 'asc' ? secA.localeCompare(secB) : secB.localeCompare(secA);
      }
      if (sortKey === 'createdAt') {
        const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return sortDirection === 'asc' ? timeA - timeB : timeB - timeA;
      }
      if (sortKey === 'paymentStatus') {
        const statusA = a.paymentStatus || "N/A";
        const statusB = b.paymentStatus || "N/A";
        return sortDirection === 'asc' ? statusA.localeCompare(statusB) : statusB.localeCompare(statusA);
      }
      return 0;
    });

    return processed;
  }, [players, activeSection, searchTerm, filterStatus, filterFederation, filterRatingType, filterVerification, sortKey, sortDirection, tournamentConfig]);

  const { data: pairings = [], isLoading: pairingsLoading } = useQuery<Pairing[]>({
    queryKey: [`/api/tournaments/${tournamentId}/pairings`],
  });

  const storageKey = useMemo(() => `tournament-${tournamentId}-confirmed-players`, [tournamentId]);

  const playerByeMap = useMemo(() => {
    const map = new Map<number, Pairing[]>();
    pairings.forEach((pairing) => {
      if (!pairing.isBye) return;
      const entries = map.get(pairing.playerId) ?? [];
      entries.push(pairing);
      map.set(pairing.playerId, entries);
    });
    map.forEach((entries) => {
      entries.sort((a, b) => (a.round ?? 0) - (b.round ?? 0));
    });
    return map;
  }, [pairings]);


  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const stored = window.localStorage.getItem(storageKey);
      if (stored) {
        const parsed = JSON.parse(stored) as Record<number, boolean>;
        setConfirmedMap(parsed);
      } else {
        setConfirmedMap({});
      }
    } catch (error) {
      console.warn("Failed to parse confirmed players from storage", error);
      setConfirmedMap({});
    }
  }, [storageKey]);

  useEffect(() => {
    if (!players.length) {
      setSelectedIds([]);
      return;
    }
    setSelectedIds((prev) => prev.filter((id) => players.some((player) => player.id === id)));
    setConfirmedMap((prev) => {
      const next: Record<number, boolean> = {};
      players.forEach((player) => {
        if (prev[player.id]) {
          next[player.id] = true;
        }
      });
      return next;
    });
  }, [players]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(confirmedMap));
    } catch (error) {
      console.warn("Failed to persist confirmed players", error);
    }
  }, [confirmedMap, storageKey]);

  const selectionCount = selectedIds.length;
  const allIds = useMemo(() => players.map((player) => player.id), [players]);
  const allSelected = selectionCount > 0 && selectionCount === allIds.length && allIds.length > 0;
  const hasSelection = selectionCount > 0;
  const headerCheckboxValue = allSelected ? true : hasSelection ? "indeterminate" : false;
  const allConfirmed = hasSelection && selectedIds.every((id) => confirmedMap[id]);
  const selectionSummary = hasSelection ? `${selectionCount} selected` : "No players selected";

  const totalRounds = useMemo(() => {
    if (!tournament) return 0;
    const planned = tournament.rounds ?? 0;
    const current = tournament.currentRound ?? 0;
    return Math.max(planned, current, 0);
  }, [tournament]);

  const roundOptions = useMemo(() => {
    const rounds = totalRounds > 0 ? totalRounds : 5;
    return Array.from({ length: rounds }, (_, index) => index + 1);
  }, [totalRounds]);

  const selectedPlayers = useMemo(
    () => players.filter((p) => selectedIds.includes(p.id)),
    [players, selectedIds],
  );

  const handleUpdateSeed = async (playerId: number, newSeed: string) => {
    try {
      await apiRequest(`/api/players/${playerId}/seed`, {
        method: "PATCH",
        body: JSON.stringify({ seed: newSeed || null }),
      });
      queryClient.invalidateQueries({ queryKey: [`/api/tournaments/${tournamentId}/players`] });
      setEditingSeedId(null);
    } catch (error: any) {
      toast({
        title: "Failed to update seed",
        description: error?.message ?? "Please try again.",
        variant: "destructive",
      });
    }
  };

  const toggleSelectAll = useCallback(
    (checked: boolean) => {
      setSelectedIds(checked ? allIds : []);
    },
    [allIds],
  );

  const toggleSelectPlayer = useCallback((playerId: number, checked: boolean) => {
    setSelectedIds((prev) => {
      if (checked) {
        if (prev.includes(playerId)) return prev;
        return [...prev, playerId];
      }
      return prev.filter((id) => id !== playerId);
    });
  }, []);

  const handleToggleConfirm = useCallback(() => {
    if (!hasSelection) return;
    setConfirmedMap((prev) => {
      const next = { ...prev };
      if (allConfirmed) {
        selectedIds.forEach((id) => {
          delete next[id];
        });
      } else {
        selectedIds.forEach((id) => {
          next[id] = true;
        });
      }
      return next;
    });

    toast({
      title: allConfirmed ? "Players unconfirmed" : "Players confirmed",
      description: `${selectionCount} player${selectionCount === 1 ? "" : "s"} updated.`,
    });
  }, [allConfirmed, hasSelection, selectedIds, selectionCount, toast]);

  const handleDeleteSelected = useCallback(async () => {
    if (!hasSelection) return;
    setIsDeleting(true);
    try {
      await Promise.all(
        selectedIds.map((id) =>
          apiRequest(`/api/players/${id}`, {
            method: "DELETE",
          }),
        ),
      );
      toast({
        title: "Players removed",
        description: `${selectionCount} player${selectionCount === 1 ? "" : "s"} deleted from the roster.`,
      });
      setSelectedIds([]);
      queryClient.invalidateQueries({ queryKey: [`/api/tournaments/${tournamentId}/players`] });
      queryClient.invalidateQueries({ queryKey: [`/api/tournaments/${tournamentId}/pairings`] });
      queryClient.invalidateQueries({ queryKey: [`/api/tournaments/${tournamentId}/matches`] });
    } catch (error: any) {
      toast({
        title: "Unable to delete players",
        description: error?.message ?? "Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsDeleting(false);
    }
  }, [hasSelection, queryClient, selectedIds, selectionCount, toast, tournamentId]);

  const handleRemoveBye = useCallback(
    async (pairingId: number) => {
      setRemovingByeIds((prev) => (prev.includes(pairingId) ? prev : [...prev, pairingId]));
      try {
        await apiRequest(`/api/pairings/${pairingId}`, {
          method: "DELETE",
        });
        toast({ title: "Bye removed" });
        queryClient.invalidateQueries({ queryKey: [`/api/tournaments/${tournamentId}/pairings`] });
        queryClient.invalidateQueries({ queryKey: [`/api/tournaments/${tournamentId}/players`] });
        queryClient.invalidateQueries({ queryKey: [`/api/tournaments/${tournamentId}/matches`] });
      } catch (error: any) {
        toast({
          title: "Unable to remove bye",
          description: error?.message ?? "Please try again.",
          variant: "destructive",
        });
      } finally {
        setRemovingByeIds((prev) => prev.filter((id) => id !== pairingId));
      }
    },
    [queryClient, toast, tournamentId],
  );

  const handleRoundToggle = useCallback((round: number) => {
    setSelectedRounds((prev) => {
      if (prev.includes(round)) {
        return prev.filter((value) => value !== round);
      }
      return [...prev, round].sort((a, b) => a - b);
    });
  }, []);

  const resetStatusForm = useCallback(() => {
    setWithdrawScope("all");
    setSelectedRounds([]);
    setByeType("zero_point");
  }, []);

  const handleStatusSubmit = useCallback(async () => {
    if (!hasSelection) return;
    if (withdrawScope === "specific" && selectedRounds.length === 0) {
      toast({
        title: "Select rounds",
        description: "Choose at least one round when assigning custom byes.",
        variant: "destructive",
      });
      return;
    }

    setProcessingStatus(true);
    try {
      if (withdrawScope === "all") {
        await Promise.all(
          selectedIds.map((id) =>
            apiRequest(`/api/players/${id}/status`, {
              method: "PUT",
              body: JSON.stringify({ status: "withdrawn" }),
            }),
          ),
        );
        toast({
          title: "Players withdrawn",
          description: `${selectionCount} player${selectionCount === 1 ? " was" : "s were"} withdrawn from future rounds.`,
        });
      } else {
        const byePayload = selectedRounds.map((round) => ({ round, type: byeType }));
        await Promise.all(
          selectedIds.map((id) =>
            apiRequest(`/api/players/${id}/status`, {
              method: "PUT",
              body: JSON.stringify({ status: "active", byeRounds: byePayload }),
            }),
          ),
        );
        toast({
          title: "Byes recorded",
          description: `Scheduled ${byePayload.length} round${byePayload.length === 1 ? "" : "s"} for ${selectionCount} player${selectionCount === 1 ? "" : "s"}.`,
        });
      }

      queryClient.invalidateQueries({ queryKey: [`/api/tournaments/${tournamentId}/players`] });
      queryClient.invalidateQueries({ queryKey: [`/api/tournaments/${tournamentId}/pairings`] });
      queryClient.invalidateQueries({ queryKey: [`/api/tournaments/${tournamentId}/matches`] });
      setSelectedIds([]);
      resetStatusForm();
      setStatusDialogOpen(false);
    } catch (error: any) {
      toast({
        title: "Unable to update player status",
        description: error?.message ?? "Please try again.",
        variant: "destructive",
      });
    } finally {
      setProcessingStatus(false);
    }
  }, [
    byeType,
    hasSelection,
    queryClient,
    resetStatusForm,
    selectedIds,
    selectedRounds,
    selectionCount,
    toast,
    tournamentId,
    withdrawScope,
  ]);

  const recipientsList = useMemo(
    () =>
      selectedPlayers
        .map((player) => `${player.firstName ?? ""} ${player.lastName ?? ""}`.trim())
        .filter((name) => name.length > 0)
        .join(", "),
    [selectedPlayers],
  );

  const handleCopyRecipients = useCallback(async () => {
    if (!recipientsList) return;
    try {
      setIsCopyingRecipients(true);
      await navigator.clipboard.writeText(recipientsList);
      toast({ title: "Recipients copied" });
    } catch (error: any) {
      toast({
        title: "Clipboard error",
        description: error?.message ?? "Unable to copy recipients.",
        variant: "destructive",
      });
    } finally {
      setIsCopyingRecipients(false);
    }
  }, [recipientsList, toast]);

  const handleCopyMessage = useCallback(async () => {
    if (!messageBody) return;
    try {
      setIsCopyingMessage(true);
      await navigator.clipboard.writeText(messageBody);
      toast({ title: "Message copied" });
    } catch (error: any) {
      toast({
        title: "Clipboard error",
        description: error?.message ?? "Unable to copy message.",
        variant: "destructive",
      });
    } finally {
      setIsCopyingMessage(false);
    }
  }, [messageBody, toast]);

  const handleSendMessage = useCallback(async () => {
    if (!messageBody || !hasChannelSelected || selectedIds.length === 0) return;

    const subject = messageSubject.trim() || `Message from tournament director`;

    setIsSending(true);
    try {
      const data = await apiRequest(`/api/tournaments/${tournamentId}/notifications`, {
        method: "POST",
        body: JSON.stringify({
          subject,
          message: messageBody,
          sendEmail: messageChannels.email,
          sendPush: messageChannels.push,
          playerIds: selectedIds,
        }),
      });

      setMessageDialogOpen(false);
      setMessageBody("");
      setMessageSubject("");

      const channels = [
        messageChannels.email ? "Email" : null,
        messageChannels.push ? "Push" : null,
      ].filter(Boolean);

      toast({
        title: "Message sent",
        description: `Dispatched via ${channels.join(" & ")} to ${Math.max(data.emails ?? 0, data.push ?? 0)} recipient(s).`,
      });
    } catch (error: any) {
      // If the notification service is not configured (503), fall back to copy mode
      if (error?.message?.includes("503") || error?.message?.includes("not configured")) {
        toast({
          title: "Notification service unavailable",
          description: "Use the copy buttons to manually send your message.",
          variant: "destructive",
        });
      } else {
        toast({
          title: "Failed to send message",
          description: error?.message ?? "Please try again or use the copy buttons.",
          variant: "destructive",
        });
      }
    } finally {
      setIsSending(false);
    }
  }, [messageBody, messageSubject, messageChannels, hasChannelSelected, selectedIds, tournamentId, toast]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDirection('asc');
    }
  };

  return (
    <div className="grid grid-cols-1 gap-4">
      <Tabs value={activeSection} onValueChange={setActiveSection} className="w-full">
        {sections.length > 1 && (
          <TabsList className="flex flex-nowrap overflow-x-auto no-scrollbar justify-start items-center bg-slate-100/50 p-1 mb-6 rounded-xl border border-slate-200/60 shadow-sm backdrop-blur-sm w-full sm:w-fit">
            <TabsTrigger value="all" className="flex-none sm:flex-1 data-[state=active]:bg-white data-[state=active]:shadow-md data-[state=active]:text-black transition-all font-medium rounded-lg px-4 py-2 text-xs xl:text-sm whitespace-nowrap">All</TabsTrigger>
            {sections.map(section => (
              <TabsTrigger key={section.id} value={section.id} className="flex-none sm:flex-1 data-[state=active]:bg-white data-[state=active]:shadow-md data-[state=active]:text-black transition-all font-medium rounded-lg px-4 py-2 text-xs xl:text-sm whitespace-nowrap">
                {section.name}
              </TabsTrigger>
            ))}
          </TabsList>
        )}
        <Card className="mt-4 border-slate-200/60 shadow-sm rounded-xl overflow-hidden">
          <CardHeader className="flex flex-row items-center justify-between border-b border-slate-150 px-6 py-4 gap-4 bg-slate-50/40">
            <div className="flex items-baseline gap-2 min-w-0">
              <CardTitle className="text-base font-bold text-slate-800 tracking-tight">Players</CardTitle>
              <span className="text-xs text-slate-400 font-medium font-mono shrink-0">({players.length} registered)</span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {isTD && (
                <>
                  <Button 
                    variant="outline" 
                    size="sm" 
                    className="h-8 text-xs font-semibold rounded-lg border-slate-200 hover:bg-slate-100/50 text-slate-600 shadow-sm transition-all" 
                    onClick={handleSyncAllRatings} 
                    disabled={isSyncingRatings}
                  >
                    <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", isSyncingRatings && "animate-spin")} />
                    Sync Ratings
                  </Button>
                  <Button 
                    size="sm" 
                    className="h-8 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm transition-all" 
                    onClick={() => setLocation(`/tournaments/${tournamentId}/players/new`)}
                  >
                    <Plus className="mr-1.5 h-3.5 w-3.5" />
                    Add Player
                  </Button>
                </>
              )}
            </div>
          </CardHeader>
          <CardContent className="p-6 space-y-4">
            {isLoading ? (
              <div className="py-8 flex items-center justify-center gap-2 text-sm text-slate-500 font-medium">
                <Loader2 className="h-4 w-4 animate-spin text-indigo-650" />
                Loading players...
              </div>
            ) : players.length === 0 ? (
              <div className="py-12 text-center border border-dashed rounded-xl border-slate-200 bg-slate-50/50 flex flex-col items-center justify-center">
                <p className="text-sm font-semibold text-slate-605">No players registered yet.</p>
                <p className="text-xs text-slate-400 mt-1">Start by adding players to this event.</p>
                {isTD && (
                  <Button 
                    size="sm" 
                    className="h-8 mt-3 text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg"
                    onClick={() => setLocation(`/tournaments/${tournamentId}/players/new`)}
                  >
                    <Plus className="mr-1.5 h-3.5 w-3.5" /> Add Player
                  </Button>
                )}
              </div>
            ) : (
              <TooltipProvider>
                {/* Search & Filters Controls Row */}
                <div className="flex items-center gap-2 py-1">
                  <div className="relative flex-1 max-w-md">
                    <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
                    <Input
                      placeholder="Search by name, ID, email, or club..."
                      className="pl-9 h-9 text-xs w-full bg-white border-slate-200 focus-visible:ring-indigo-500 focus-visible:border-indigo-500 rounded-lg shadow-sm"
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                    />
                  </div>

                  <div className="flex items-center gap-2 ml-auto shrink-0">
                    <Button
                      variant={showFilterPanel || filterStatus !== "all" || filterFederation !== "all" || filterRatingType !== "all" || filterVerification !== "all" ? "secondary" : "outline"}
                      size="sm"
                      className={cn(
                        "h-9 text-xs font-semibold rounded-lg border-slate-200 text-slate-700 shadow-sm transition-all",
                        (showFilterPanel || filterStatus !== "all" || filterFederation !== "all" || filterRatingType !== "all" || filterVerification !== "all")
                          ? "bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-100"
                          : "hover:bg-slate-50"
                      )}
                      onClick={() => setShowFilterPanel(!showFilterPanel)}
                    >
                      <SlidersHorizontal className="mr-1.5 h-3.5 w-3.5" />
                      Filters
                      {(filterStatus !== "all" || filterFederation !== "all" || filterRatingType !== "all" || filterVerification !== "all") && (
                        <span className="ml-1.5 bg-indigo-600 text-white rounded-full h-4 w-4 flex items-center justify-center p-0 text-[9px] font-bold">
                          {[filterStatus !== "all", filterFederation !== "all", filterRatingType !== "all", filterVerification !== "all"].filter(Boolean).length}
                        </span>
                      )}
                    </Button>

                    <Popover>
                      <PopoverTrigger asChild>
                        <Button variant="outline" size="sm" className="h-9 text-xs font-semibold rounded-lg border-slate-200 hover:bg-slate-50 text-slate-700 shadow-sm transition-all">
                          <Eye className="mr-1.5 h-3.5 w-3.5" />
                          Columns
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-56 p-3 space-y-2 bg-white shadow-xl border border-slate-200 rounded-xl" align="end">
                        <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1 px-1">Visible Columns</div>
                        <div className="space-y-1 max-h-[300px] overflow-y-auto no-scrollbar">
                          {[
                            { id: "index", label: "# Number" },
                            { id: "uscfId", label: "USCF ID" },
                            { id: "name", label: "Surname, Name" },
                            { id: "rating", label: "Unified Rating" },
                            { id: "uscfMembership", label: "USCF Membership" },
                            { id: "byes", label: "Byes List" },
                            { id: "paymentStatus", label: "Payment Status" },
                            { id: "actions", label: "Confirm & Select" },
                            { id: "uscfRating", label: "USCF Rating" },
                            { id: "fideRating", label: "FIDE Rating" },
                            { id: "fideId", label: "FIDE ID" },
                            { id: "federation", label: "Federation" },
                            { id: "section", label: "Section Name" },
                            { id: "club", label: "Chess Club" },
                            { id: "birthdate", label: "Birthdate" },
                            { id: "createdAt", label: "Date Registered" },
                            { id: "seed", label: "Tournament Seed" },
                            { id: "status", label: "Roster Status" },
                            { id: "email", label: "Email Address" },
                          ].map((col) => (
                            <label key={col.id} className="flex items-center gap-2 px-1.5 py-1 text-xs text-slate-650 font-medium cursor-pointer hover:bg-slate-50 rounded-lg transition-colors">
                              <Checkbox
                                id={`col-${col.id}`}
                                checked={visibleColumns.includes(col.id)}
                                className="h-3.5 w-3.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                                onCheckedChange={(checked) => {
                                  if (checked) {
                                    setVisibleColumns([...visibleColumns, col.id]);
                                  } else {
                                    setVisibleColumns(visibleColumns.filter((id) => id !== col.id));
                                  }
                                }}
                              />
                              <span>{col.label}</span>
                            </label>
                          ))}
                        </div>
                      </PopoverContent>
                    </Popover>
                  </div>
                </div>

                {/* Advanced Filter Panel */}
                {showFilterPanel && (
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 bg-slate-50/80 border border-slate-200/60 p-4 rounded-xl shadow-inner mb-3">
                    <div className="space-y-1.5">
                      <Label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Roster Status</Label>
                      <Select value={filterStatus} onValueChange={setFilterStatus}>
                        <SelectTrigger className="bg-white h-8 text-xs border-slate-200">
                          <SelectValue placeholder="All" />
                        </SelectTrigger>
                        <SelectContent className="bg-white shadow-lg border border-slate-200 rounded-lg text-xs">
                          <SelectItem value="all">All Statuses</SelectItem>
                          <SelectItem value="active">Active Only</SelectItem>
                          <SelectItem value="withdrawn">Withdrawn Only</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Representing Federation</Label>
                      <Select value={filterFederation} onValueChange={setFilterFederation}>
                        <SelectTrigger className="bg-white h-8 text-xs border-slate-200">
                          <SelectValue placeholder="All" />
                        </SelectTrigger>
                        <SelectContent className="bg-white shadow-lg border border-slate-200 rounded-lg text-xs">
                          <SelectItem value="all">All Federations</SelectItem>
                          <SelectItem value="uscf">USCF Representing</SelectItem>
                          <SelectItem value="fide">FIDE Representing</SelectItem>
                          <SelectItem value="other">Other Federation</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Rating Type</Label>
                      <Select value={filterRatingType} onValueChange={setFilterRatingType}>
                        <SelectTrigger className="bg-white h-8 text-xs border-slate-200">
                          <SelectValue placeholder="All" />
                        </SelectTrigger>
                        <SelectContent className="bg-white shadow-lg border border-slate-200 rounded-lg text-xs">
                          <SelectItem value="all">All Rating Types</SelectItem>
                          <SelectItem value="rated">Fully Rated</SelectItem>
                          <SelectItem value="provisional">Provisional (p)</SelectItem>
                          <SelectItem value="unrated">Unrated Only</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">USCF ID Verification</Label>
                      <Select value={filterVerification} onValueChange={setFilterVerification}>
                        <SelectTrigger className="bg-white h-8 text-xs border-slate-200">
                          <SelectValue placeholder="All" />
                        </SelectTrigger>
                        <SelectContent className="bg-white shadow-lg border border-slate-200 rounded-lg text-xs">
                          <SelectItem value="all">All Verification</SelectItem>
                          <SelectItem value="verified">Verified Members</SelectItem>
                          <SelectItem value="pending">Pending Status</SelectItem>
                          <SelectItem value="unverified">Unverified Members</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                )}

                {/* Floating Contextual Action Bar when players are selected */}
                {hasSelection && isTD && (
                  <div className="flex items-center justify-between px-4 py-2 bg-indigo-50 border border-indigo-100 rounded-xl shadow-sm mb-3 animate-in fade-in slide-in-from-top-1 duration-150">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-indigo-700 bg-indigo-100 px-2 py-0.5 rounded-full font-mono shrink-0">
                        {selectionCount}
                      </span>
                      <span className="text-xs font-semibold text-indigo-850">
                        {selectionCount === 1 ? "player" : "players"} selected
                      </span>
                    </div>

                    <div className="flex items-center gap-1">
                      <AlertDialog>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <AlertDialogTrigger asChild>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 rounded-lg text-rose-605 hover:bg-rose-100/50 hover:text-rose-700 transition-colors"
                                disabled={isDeleting || isProcessingStatus}
                                aria-label="Delete selected players"
                              >
                                {isDeleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                              </Button>
                            </AlertDialogTrigger>
                          </TooltipTrigger>
                          <TooltipContent className="bg-slate-800 text-white text-[11px] rounded-md px-2 py-1 shadow-md border-0">Delete selected</TooltipContent>
                        </Tooltip>
                        <AlertDialogContent className="bg-white rounded-xl shadow-xl border border-slate-200">
                          <AlertDialogHeader>
                            <AlertDialogTitle className="text-base font-bold text-slate-800">Remove players from this tournament?</AlertDialogTitle>
                            <AlertDialogDescription className="text-sm text-slate-500">
                              This action can&apos;t be undone. The selected player(s) and any matches involving them will be deleted permanently.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel className="h-9 text-xs font-semibold rounded-lg">Cancel</AlertDialogCancel>
                            <AlertDialogAction
                              className="h-9 text-xs font-semibold bg-rose-650 hover:bg-rose-700 text-white rounded-lg"
                              onClick={(event) => {
                                event.preventDefault();
                                void handleDeleteSelected();
                              }}
                            >
                              Confirm removal
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>

                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 rounded-lg text-indigo-600 hover:bg-indigo-100/50 hover:text-indigo-700 transition-colors"
                            onClick={handleToggleConfirm}
                            disabled={isDeleting || isProcessingStatus}
                            aria-label={allConfirmed ? "Unconfirm selected players" : "Confirm selected players"}
                          >
                            {allConfirmed ? <Check className="h-3.5 w-3.5" /> : <CheckSquare className="h-3.5 w-3.5" />}
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent className="bg-slate-800 text-white text-[11px] rounded-md px-2 py-1 shadow-md border-0">{allConfirmed ? "Unconfirm" : "Confirm"}</TooltipContent>
                      </Tooltip>

                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 rounded-lg text-indigo-600 hover:bg-indigo-100/50 hover:text-indigo-700 transition-colors"
                            onClick={() => setStatusDialogOpen(true)}
                            disabled={isProcessingStatus || isDeleting}
                            aria-label="Set byes or withdraw"
                          >
                            <PauseCircle className="h-3.5 w-3.5" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent className="bg-slate-800 text-white text-[11px] rounded-md px-2 py-1 shadow-md border-0">Set byes / withdraw</TooltipContent>
                      </Tooltip>

                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 rounded-lg text-indigo-650 hover:bg-indigo-100/50 hover:text-indigo-700 transition-colors"
                            onClick={() => setMessageDialogOpen(true)}
                            aria-label="Compose message"
                          >
                            <Mail className="h-3.5 w-3.5" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent className="bg-slate-800 text-white text-[11px] rounded-md px-2 py-1 shadow-md border-0">Message selected</TooltipContent>
                      </Tooltip>

                      <div className="h-4 w-px bg-indigo-200 mx-1 shrink-0" />

                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 text-[11px] font-semibold text-slate-500 hover:bg-indigo-100/30 hover:text-indigo-700 rounded-lg px-2 shrink-0 transition-colors"
                        onClick={() => setSelectedIds([])}
                      >
                        Clear
                      </Button>
                    </div>
                  </div>
                )}

                <div className="overflow-x-auto no-scrollbar border border-slate-200/80 rounded-xl bg-white shadow-sm">
                  {processedPlayers.length === 0 ? (
                    <div className="py-16 text-center bg-slate-50/30 w-full flex flex-col items-center justify-center">
                      <p className="text-sm font-semibold text-slate-600">No players match the applied filters.</p>
                      <p className="text-xs text-slate-400 mt-1">Try resetting some filters or modifying your search query.</p>
                      <Button
                        variant="link"
                        className="text-xs text-indigo-600 hover:text-indigo-800 mt-2 font-semibold"
                        onClick={() => {
                          setSearchTerm("");
                          setFilterStatus("all");
                          setFilterFederation("all");
                          setFilterRatingType("all");
                          setFilterVerification("all");
                        }}
                      >
                        Reset Filters
                      </Button>
                    </div>
                  ) : (
                    <Table className="min-w-[900px] md:min-w-full relative border-collapse">
                      <TableHeader className="bg-slate-50/50 sticky top-0 z-30 shadow-[0_1px_0_0_rgba(226,232,240,0.8)]">
                        <TableRow className="hover:bg-transparent border-b border-slate-200/80">
                          {visibleColumns.includes("index") && (
                            <TableHead className="w-12 text-xs font-bold text-slate-600 bg-slate-50/80 sticky left-0 z-20">#</TableHead>
                          )}
                          {visibleColumns.includes("uscfId") && (
                            <TableHead className="w-28 text-xs font-bold text-slate-600 bg-slate-50/80">USCF ID</TableHead>
                          )}
                          {visibleColumns.includes("name") && (
                            <TableHead className={cn(
                              "text-xs font-bold text-slate-600 bg-slate-50/80 sticky z-20 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.05)]",
                              isIndexVisible ? "left-12" : "left-0"
                            )}>
                              <button onClick={() => handleSort('name')} className="flex items-center gap-1 hover:text-slate-800 transition-colors uppercase tracking-wider text-[10px]">
                                Name
                                {sortKey === 'name' && <ArrowUpDown className="h-3 w-3 inline text-slate-500" />}
                              </button>
                            </TableHead>
                          )}
                          {visibleColumns.includes("rating") && (
                            <TableHead className="text-xs font-bold text-slate-600 bg-slate-50/80">
                              <button onClick={() => handleSort('rating')} className="flex items-center gap-1 hover:text-slate-800 transition-colors uppercase tracking-wider text-[10px]">
                                {tournamentConfig.details.primaryRatingSystem === 'fide' ? 'FIDE' : 'USCF'} Rating
                                {sortKey === 'rating' && <ArrowUpDown className="h-3 w-3 inline text-slate-500" />}
                              </button>
                            </TableHead>
                          )}
                          {visibleColumns.includes("uscfMembership") && (
                            <TableHead className="w-36 text-xs font-bold text-slate-600 bg-slate-50/80 uppercase tracking-wider text-[10px]">USCF Membership</TableHead>
                          )}
                          {visibleColumns.includes("byes") && tournament.format !== 'arena' && (
                            <TableHead className="text-xs font-bold text-slate-600 bg-slate-50/80 uppercase tracking-wider text-[10px]">Byes</TableHead>
                          )}
                          {visibleColumns.includes("paymentStatus") && (
                            <TableHead className="text-xs font-bold text-slate-600 bg-slate-50/80">
                              <button onClick={() => handleSort('paymentStatus')} className="flex items-center gap-1 hover:text-slate-800 transition-colors uppercase tracking-wider text-[10px]">
                                Payment
                                {sortKey === 'paymentStatus' && <ArrowUpDown className="h-3 w-3 inline text-slate-500" />}
                              </button>
                            </TableHead>
                          )}
                          {/* Optional columns */}
                          {visibleColumns.includes("uscfRating") && (
                            <TableHead className="text-xs font-bold text-slate-600 bg-slate-50/80">
                              <button onClick={() => handleSort('uscfRating')} className="flex items-center gap-1 hover:text-slate-800 transition-colors uppercase tracking-wider text-[10px]">
                                USCF Rating
                                {sortKey === 'uscfRating' && <ArrowUpDown className="h-3 w-3 inline text-slate-500" />}
                              </button>
                            </TableHead>
                          )}
                          {visibleColumns.includes("fideRating") && (
                            <TableHead className="text-xs font-bold text-slate-600 bg-slate-50/80 uppercase tracking-wider text-[10px]">FIDE Rating</TableHead>
                          )}
                          {visibleColumns.includes("fideId") && (
                            <TableHead className="text-xs font-bold text-slate-600 bg-slate-50/80 uppercase tracking-wider text-[10px]">FIDE ID</TableHead>
                          )}
                          {visibleColumns.includes("federation") && (
                            <TableHead className="text-xs font-bold text-slate-600 bg-slate-50/80 uppercase tracking-wider text-[10px]">Federation</TableHead>
                          )}
                          {visibleColumns.includes("section") && (
                            <TableHead className="text-xs font-bold text-slate-600 bg-slate-50/80">
                              <button onClick={() => handleSort('section')} className="flex items-center gap-1 hover:text-slate-800 transition-colors uppercase tracking-wider text-[10px]">
                                Section
                                {sortKey === 'section' && <ArrowUpDown className="h-3 w-3 inline text-slate-500" />}
                              </button>
                            </TableHead>
                          )}
                          {visibleColumns.includes("club") && (
                            <TableHead className="text-xs font-bold text-slate-600 bg-slate-50/80 uppercase tracking-wider text-[10px]">Club</TableHead>
                          )}
                          {visibleColumns.includes("birthdate") && (
                            <TableHead className="text-xs font-bold text-slate-600 bg-slate-50/80 uppercase tracking-wider text-[10px]">Birthdate</TableHead>
                          )}
                          {visibleColumns.includes("createdAt") && (
                            <TableHead className="text-xs font-bold text-slate-600 bg-slate-50/80">
                              <button onClick={() => handleSort('createdAt')} className="flex items-center gap-1 hover:text-slate-800 transition-colors uppercase tracking-wider text-[10px]">
                                Registered
                                {sortKey === 'createdAt' && <ArrowUpDown className="h-3 w-3 inline text-slate-500" />}
                              </button>
                            </TableHead>
                          )}
                          {visibleColumns.includes("seed") && tournament.format === 'knockout' && (
                            <TableHead className="w-20 text-xs font-bold text-slate-600 bg-slate-50/80 uppercase tracking-wider text-[10px]">Seed</TableHead>
                          )}
                          {visibleColumns.includes("status") && (
                            <TableHead className="text-xs font-bold text-slate-600 bg-slate-50/80 uppercase tracking-wider text-[10px]">Status</TableHead>
                          )}
                          {visibleColumns.includes("email") && (
                            <TableHead className="text-xs font-bold text-slate-600 bg-slate-50/80 uppercase tracking-wider text-[10px]">Email</TableHead>
                          )}
                          {visibleColumns.includes("actions") && (
                            <TableHead className="text-right text-xs font-bold text-slate-600 bg-slate-50/80 uppercase tracking-wider text-[10px] sticky right-0 z-20 shadow-[-2px_0_5px_-2px_rgba(0,0,0,0.05)]">
                              <div className="flex items-center justify-end gap-2">
                                <span>Confirm / Select</span>
                                {isTD && (
                                  <Checkbox
                                    checked={headerCheckboxValue}
                                    onCheckedChange={(value) => toggleSelectAll(Boolean(value))}
                                    aria-label="Select all players"
                                    disabled={players.length === 0}
                                    className="h-3.5 w-3.5 rounded border-slate-350 text-indigo-600 focus:ring-indigo-500"
                                  />
                                )}
                              </div>
                            </TableHead>
                          )}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {processedPlayers.map((player, index) => {
                          const isSelected = selectedIds.includes(player.id);
                          const isConfirmed = Boolean(confirmedMap[player.id]);
                          const playerByes = playerByeMap.get(player.id) ?? [];
                          const rowClasses = isSelected
                            ? "group border-b border-slate-100 cursor-pointer transition-colors bg-indigo-50/20 hover:bg-indigo-50/40 dark:bg-indigo-900/10 dark:hover:bg-indigo-900/20 h-11"
                            : "group border-b border-slate-100 cursor-pointer transition-colors hover:bg-slate-50/80 dark:bg-slate-800/40 dark:hover:bg-slate-700/40 h-11";
                          return (
                            <TableRow
                              key={player.id}
                              className={rowClasses}
                              onClick={() => setLocation(`/tournaments/${tournamentId}/players/${player.id}`)}
                            >
                              {visibleColumns.includes("index") && (
                                <TableCell className={cn(
                                  "sticky left-0 transition-colors z-10 text-xs font-semibold text-slate-500",
                                  isSelected
                                    ? "bg-indigo-50/30"
                                    : "bg-white group-hover:bg-slate-50/85"
                                )}>
                                  <div>{index + 1}</div>
                                </TableCell>
                              )}
                              {visibleColumns.includes("uscfId") && (
                                <TableCell>
                                  {(player as any).userUscfId || player.localId ? (
                                    <span className="font-mono text-xs font-semibold text-slate-700 bg-slate-100/80 px-1.5 py-0.5 rounded border border-slate-200/50">
                                      {(player as any).userUscfId || player.localId}
                                    </span>
                                  ) : (
                                    <span className="text-xs text-slate-400">—</span>
                                  )}
                                </TableCell>
                              )}
                              {visibleColumns.includes("name") && (
                                <TableCell className={cn(
                                  "sticky transition-colors z-10 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.05)]",
                                  isIndexVisible ? "left-12" : "left-0",
                                  isSelected
                                    ? "bg-indigo-50/30"
                                    : "bg-white group-hover:bg-slate-50/85"
                                )}>
                                  <div className="flex flex-col gap-0.5">
                                    <span className="text-sm font-semibold text-slate-850">
                                      {player.localId || (player as any).userUscfId ? (
                                        <a
                                          href={
                                            player.federation?.toLowerCase() === 'fide'
                                              ? `https://ratings.fide.com/profile/${player.localId}`
                                              : `https://ratings.uschess.org/player/${player.localId || (player as any).userUscfId}`
                                          }
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="text-indigo-600 hover:text-indigo-800 hover:underline cursor-pointer"
                                          onClick={(e) => e.stopPropagation()}
                                        >
                                          {player.lastName}, {player.firstName}
                                        </a>
                                      ) : (
                                        `${player.lastName}, ${player.firstName}`
                                      )}
                                    </span>
                                    {!tournamentConfig.registers?.verifyUscfMembership && (player as any).userUscfId && (
                                      <div className="flex items-center gap-1.5 mt-0.5" onClick={(e) => e.stopPropagation()}>
                                        <span className="text-[10px] font-mono text-slate-500 bg-slate-100 px-1.5 py-0.2 rounded border">
                                          USCF: {(player as any).userUscfId}
                                        </span>
                                        {(player as any).userUscfVerificationStatus === "verified" ? (
                                          <Badge className="bg-emerald-50 text-emerald-700 hover:bg-emerald-50 border-emerald-200/50 text-[9px] px-1.5 py-0 rounded-full font-bold shadow-none">
                                            Verified
                                          </Badge>
                                        ) : (player as any).userUscfVerificationStatus === "pending" ? (
                                          <div className="flex items-center gap-1">
                                            <Badge className="bg-amber-50 text-amber-700 hover:bg-amber-50 border-amber-200/50 text-[9px] px-1.5 py-0 rounded-full font-bold animate-pulse shadow-none">
                                              Pending
                                            </Badge>
                                            {isTD && (
                                              <button
                                                onClick={() => verifyUscfMutation.mutate({ targetUserId: (player as any).userId, verified: true })}
                                                disabled={verifyUscfMutation.isPending}
                                                className="text-[9px] text-indigo-650 hover:text-indigo-800 font-bold hover:underline ml-1"
                                              >
                                                Verify
                                              </button>
                                            )}
                                          </div>
                                        ) : (
                                          <Badge variant="secondary" className="text-[9px] px-1.5 py-0 rounded-full font-bold shadow-none bg-slate-100 text-slate-500">
                                            Unverified
                                          </Badge>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                </TableCell>
                              )}
                              {visibleColumns.includes("rating") && (
                                <TableCell className="text-xs font-semibold text-slate-700">
                                  {(() => {
                                    const threshold = tournamentConfig?.registers?.uscfMinGamesThreshold ?? 4;
                                    const uscfDisp = resolveDisplayRating((player as any).uscfRatingRaw, player.uscfRating, threshold, false);
                                    const fideDisp = resolveDisplayRating((player as any).fideRatingRaw, player.fideRating, 0, true);
                                    const display = tournamentConfig.details.primaryRatingSystem === 'fide'
                                      ? (fideDisp !== "Unrated" ? fideDisp : uscfDisp)
                                      : (uscfDisp !== "Unrated" ? uscfDisp : fideDisp);
                                    return display === "Unrated" ? "-" : display;
                                  })()}
                                </TableCell>
                              )}
                              {visibleColumns.includes("uscfMembership") && (
                                <TableCell onClick={(e) => e.stopPropagation()}>
                                  {(() => {
                                    const rawExpiry = player.uscfMemberExpiry || (player as any).userUscfMemberExpiry;
                                    if (!rawExpiry) {
                                      return (
                                        <Badge className="bg-slate-50 text-slate-400 hover:bg-slate-50 border-slate-200/80 text-[10px] px-1.5 py-0.5 rounded-full font-semibold shadow-none">
                                          No Expiry Info
                                        </Badge>
                                      );
                                    }
                                    try {
                                      const expiryDate = new Date(rawExpiry);
                                      if (isNaN(expiryDate.getTime())) {
                                        return (
                                          <Badge className="bg-slate-50 text-slate-400 hover:bg-slate-50 border-slate-200/80 text-[10px] px-1.5 py-0.5 rounded-full font-semibold shadow-none">
                                            No Expiry Info
                                          </Badge>
                                        );
                                      }
                                      const now = new Date();
                                      now.setHours(0, 0, 0, 0);
                                      expiryDate.setHours(0, 0, 0, 0);
                                      const formatted = `${expiryDate.getMonth() + 1}/${expiryDate.getDate()}/${expiryDate.getFullYear()}`;
                                      if (expiryDate >= now) {
                                        return (
                                          <Badge className="bg-emerald-50 text-emerald-700 hover:bg-emerald-50 border-emerald-200/40 text-[10px] px-2 py-0.5 rounded-full font-bold shadow-none">
                                            Active (Exp: {formatted})
                                          </Badge>
                                        );
                                      } else {
                                        return (
                                          <Badge className="bg-rose-50 text-rose-700 hover:bg-rose-50 border-rose-200/40 text-[10px] px-2 py-0.5 rounded-full font-bold shadow-none">
                                            Expired (Exp: {formatted})
                                          </Badge>
                                        );
                                      }
                                    } catch (e) {
                                      return (
                                        <Badge className="bg-slate-50 text-slate-400 hover:bg-slate-50 border-slate-200/80 text-[10px] px-1.5 py-0.5 rounded-full font-semibold shadow-none">
                                          No Expiry Info
                                        </Badge>
                                      );
                                    }
                                  })()}
                                </TableCell>
                              )}
                              {visibleColumns.includes("byes") && tournament.format !== 'arena' && (
                                <TableCell>
                                  {pairingsLoading ? (
                                    <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
                                  ) : playerByes.length > 0 ? (
                                    <div className="flex flex-wrap gap-1.5 max-w-[220px]">
                                      {playerByes.map((bye) => {
                                        const isRequested = Boolean(bye.isRequested);
                                        const isRemoving = removingByeIds.includes(bye.id);
                                        const byeLabel = bye.byeType === "half_point"
                                          ? "½"
                                          : bye.byeType === "full_point"
                                          ? "1"
                                          : bye.byeType === "zero_point"
                                          ? "0"
                                          : bye.points === 1
                                          ? "½"
                                          : bye.points === 2
                                          ? "1"
                                          : "0";
                                        const toneClass = isRequested
                                          ? "border-emerald-205 bg-emerald-55/70 text-emerald-700 hover:bg-emerald-100/50"
                                          : "border-slate-200 bg-slate-105 text-slate-600";
                                        return (
                                          <div
                                            key={bye.id}
                                            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold transition-colors ${toneClass}`}
                                            title={isRequested ? "Manual bye" : "System-assigned"}
                                          >
                                            <span>Rd {bye.round}</span>
                                            <span aria-hidden="true" className="opacity-50">·</span>
                                            <span>{byeLabel} pt</span>
                                            {isRequested && isTD ? (
                                              <button
                                                type="button"
                                                onClick={(event) => {
                                                  event.stopPropagation();
                                                  handleRemoveBye(bye.id);
                                                }}
                                                className="ml-1 inline-flex h-3.5 w-3.5 items-center justify-center rounded-full text-emerald-750 transition hover:bg-emerald-100 hover:text-emerald-900"
                                                disabled={isRemoving}
                                                aria-label={`Remove bye in round ${bye.round}`}
                                              >
                                                {isRemoving ? (
                                                  <Loader2 className="h-2.5 w-2.5 animate-spin" />
                                                ) : (
                                                  <X className="h-2.5 w-2.5" />
                                                )}
                                              </button>
                                            ) : null}
                                          </div>
                                        );
                                      })}
                                    </div>
                                  ) : (
                                    <span className="text-xs text-muted-foreground">—</span>
                                  )}
                                </TableCell>
                              )}
                              {visibleColumns.includes("paymentStatus") && (
                                <TableCell onClick={(e) => e.stopPropagation()}>
                                  {isTD ? (
                                    <Select
                                      value={player.paymentStatus || "N/A"}
                                      onValueChange={(newVal) => {
                                        updatePlayerPaymentStatusMutation.mutate({
                                          playerId: player.id,
                                          paymentStatus: newVal,
                                        });
                                      }}
                                    >
                                      <SelectTrigger className="h-7 w-[100px] text-xs font-semibold bg-white border-slate-200 focus:ring-1 focus:ring-indigo-500 rounded-md">
                                        <SelectValue />
                                      </SelectTrigger>
                                      <SelectContent className="bg-white shadow-lg border border-slate-200">
                                        <SelectItem value="N/A">N/A</SelectItem>
                                        <SelectItem value="paid">Paid</SelectItem>
                                        <SelectItem value="unpaid">Unpaid</SelectItem>
                                        <SelectItem value="processing">Processing</SelectItem>
                                        <SelectItem value="refunded">Refunded</SelectItem>
                                        <SelectItem value="failed">Failed</SelectItem>
                                      </SelectContent>
                                    </Select>
                                  ) : (
                                    (() => {
                                      const status = player.paymentStatus || "N/A";
                                      let badgeColor = "bg-slate-50 text-slate-500 border-slate-200";
                                      if (status === "paid") {
                                        badgeColor = "bg-emerald-50 text-emerald-700 border-emerald-200/50";
                                      } else if (status === "unpaid" || status === "failed") {
                                        badgeColor = "bg-rose-50 text-rose-700 border-rose-200/50";
                                      } else if (status === "processing") {
                                        badgeColor = "bg-amber-50 text-amber-700 border-amber-200/50";
                                      } else if (status === "refunded") {
                                        badgeColor = "bg-indigo-50 text-indigo-700 border-indigo-200/50";
                                      }
                                      return (
                                        <Badge className={`${badgeColor} border text-[9px] px-2 py-0.5 rounded-full font-bold shadow-none uppercase tracking-wider`}>
                                          {status}
                                        </Badge>
                                      );
                                    })()
                                  )}
                                </TableCell>
                              )}
                              {visibleColumns.includes("uscfRating") && (
                                <TableCell className="text-xs font-semibold text-slate-700">
                                  {player.uscfRating ? `${player.uscfRating}${player.uscfRatingRaw?.toLowerCase().includes('p') ? 'p' : ''}` : "Unrated"}
                                </TableCell>
                              )}
                              {visibleColumns.includes("fideRating") && (
                                <TableCell className="text-xs font-semibold text-slate-700">
                                  {player.fideRating || "Unrated"}
                                </TableCell>
                              )}
                              {visibleColumns.includes("fideId") && (
                                <TableCell>
                                  {player.localId && player.federation?.toLowerCase() === 'fide' ? (
                                    <span className="font-mono text-xs font-semibold bg-slate-100/80 px-1.5 py-0.5 rounded border border-slate-200/50">{player.localId}</span>
                                  ) : (
                                    <span className="text-xs text-slate-400">—</span>
                                  )}
                                </TableCell>
                              )}
                              {visibleColumns.includes("federation") && (
                                <TableCell>
                                  <Badge variant="outline" className="text-[9px] uppercase font-bold text-slate-500 border-slate-200 bg-slate-50/20">{player.federation || "USCF"}</Badge>
                                </TableCell>
                              )}
                              {visibleColumns.includes("section") && (
                                <TableCell className="text-xs font-medium text-slate-700">
                                  {player.sectionName || "Default"}
                                </TableCell>
                              )}
                              {visibleColumns.includes("club") && (
                                <TableCell className="text-xs text-slate-600 max-w-[150px] truncate">
                                  {player.club || "—"}
                                </TableCell>
                              )}
                              {visibleColumns.includes("birthdate") && (
                                <TableCell className="text-xs text-slate-600 font-mono">
                                  {player.birthdate || "—"}
                                </TableCell>
                              )}
                              {visibleColumns.includes("createdAt") && (
                                <TableCell className="text-xs text-slate-600">
                                  {new Date(player.createdAt).toLocaleDateString()}
                                </TableCell>
                              )}
                              {visibleColumns.includes("seed") && tournament.format === 'knockout' && (
                                <TableCell>
                                  {isTD && editingSeedId === player.id ? (
                                    <Input
                                      type="number"
                                      className="h-7 w-16 text-xs font-semibold"
                                      value={seedValue}
                                      onChange={(e) => setSeedValue(e.target.value)}
                                      onBlur={() => handleUpdateSeed(player.id, seedValue)}
                                      onKeyDown={(e) => {
                                        if (e.key === 'Enter') handleUpdateSeed(player.id, seedValue);
                                        if (e.key === 'Escape') setEditingSeedId(null);
                                      }}
                                      onClick={(e) => e.stopPropagation()}
                                      autoFocus
                                    />
                                  ) : (
                                    <div 
                                      className={cn(
                                        "p-1 rounded text-xs font-semibold text-slate-700 min-w-[2rem] text-center transition-colors",
                                        isTD && "cursor-pointer hover:bg-slate-100"
                                      )}
                                      onClick={(e) => {
                                        if (!isTD) return;
                                        e.stopPropagation();
                                        setEditingSeedId(player.id);
                                        setSeedValue(player.seed?.toString() || "");
                                      }}
                                    >
                                      {player.seed ?? "-"}
                                    </div>
                                  )}
                                </TableCell>
                              )}
                              {visibleColumns.includes("status") && (
                                <TableCell>
                                  <Badge variant={(player.status || 'active') === 'active' ? 'default' : 'secondary'} className="text-[10px] font-bold uppercase tracking-wider shadow-none">
                                    {player.status || 'active'}
                                  </Badge>
                                </TableCell>
                              )}
                              {visibleColumns.includes("email") && (
                                <TableCell className="text-xs text-slate-600 font-mono">
                                  {player.email || "—"}
                                </TableCell>
                              )}
                              {visibleColumns.includes("actions") && (
                                <TableCell className={cn(
                                  "text-right sticky right-0 z-10 transition-colors shadow-[-2px_0_5px_-2px_rgba(0,0,0,0.05)]",
                                  isSelected
                                    ? "bg-indigo-50/30"
                                    : "bg-white group-hover:bg-slate-50/85"
                                )}>
                                  <div className="flex items-center justify-end gap-2" onClick={(e) => e.stopPropagation()}>
                                    {isConfirmed ? (
                                      <CheckCircle2 className="h-4 w-4 text-emerald-500" aria-label="Confirmed" />
                                    ) : null}
                                    {isTD && (
                                      <Checkbox
                                        checked={isSelected}
                                        onCheckedChange={(value) => toggleSelectPlayer(player.id, Boolean(value))}
                                        aria-label={`Select ${player.lastName}, ${player.firstName}`}
                                        disabled={isDeleting || isProcessingStatus}
                                        className="h-3.5 w-3.5 rounded border-slate-350 text-indigo-650 focus:ring-indigo-500"
                                      />
                    onOpenChange={(open) => {
                      setStatusDialogOpen(open);
                      if (!open) {
                        resetStatusForm();
                      }
                    }}
                  >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Manage player availability</DialogTitle>
            <DialogDescription>
              Withdraw selected players from upcoming rounds or assign custom byes.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="status-scope">Action</Label>
              <Select
                value={withdrawScope}
                onValueChange={(value) => setWithdrawScope(value as typeof withdrawScope)}
              >
                <SelectTrigger id="status-scope" className="w-full">
                  <SelectValue placeholder="Choose action" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Withdraw from all future rounds</SelectItem>
                  <SelectItem value="specific">Assign custom byes for specific rounds</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {withdrawScope === "specific" ? (
              <div className="space-y-3">
                <div className="space-y-2">
                  <Label>Rounds</Label>
                  {roundOptions.length ? (
                    <div className="flex flex-wrap gap-2">
                      {roundOptions.map((round) => {
                        const active = selectedRounds.includes(round);
                        return (
                          <Button
                            key={round}
                            type="button"
                            variant={active ? "default" : "outline"}
                            size="sm"
                            onClick={() => handleRoundToggle(round)}
                          >
                            Rd {round}
                          </Button>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      No rounds scheduled yet. Update the tournament to enable bye assignments.
                    </p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="bye-type">Bye result</Label>
                  <Select
                    value={byeType}
                    onValueChange={(value) => setByeType(value as typeof byeType)}
                  >
                    <SelectTrigger id="bye-type" className="w-full">
                      <SelectValue placeholder="Select bye result" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="zero_point">Zero-point bye</SelectItem>
                      <SelectItem value="half_point">Half-point bye</SelectItem>
                      <SelectItem value="full_point">Full-point bye</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Confirming will issue zero-point byes for every remaining round and mark players as withdrawn.
              </p>
            )}
          </div>
          <DialogFooter className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setStatusDialogOpen(false);
                resetStatusForm();
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleStatusSubmit}
              disabled={
                isProcessingStatus ||
                !hasSelection ||
                (withdrawScope === "specific" && (selectedRounds.length === 0 || roundOptions.length === 0))
              }
            >
              {isProcessingStatus ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Apply
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isMessageDialogOpen} onOpenChange={setMessageDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Message selected players</DialogTitle>
            <DialogDescription>
              Choose delivery channels, draft your note, then copy it into the tools you use.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Recipients</Label>
              <div className="min-h-[48px] rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">
                {recipientsList || "Select at least one player to populate recipients."}
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleCopyRecipients}
                disabled={!recipientsList || isCopyingRecipients}
              >
                {isCopyingRecipients ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Copy className="mr-2 h-4 w-4" />
                )}
                Copy recipients
              </Button>
            </div>
            <div className="space-y-2">
              <Label htmlFor="message-subject">Subject</Label>
              <Input
                id="message-subject"
                value={messageSubject}
                onChange={(event) => setMessageSubject(event.target.value)}
                placeholder="Message from tournament director"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="message-body">Message</Label>
              <Textarea
                id="message-body"
                rows={6}
                value={messageBody}
                onChange={(event) => setMessageBody(event.target.value)}
                placeholder="Draft your message here…"
              />
            </div>
            <div className="space-y-2">
              <Label>Send via</Label>
              <div className="flex flex-col gap-2 pt-1">
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <Checkbox
                    checked={messageChannels.email}
                    onCheckedChange={(checked) =>
                      setMessageChannels((prev) => ({ ...prev, email: checked === true }))
                    }
                  />
                  <span>Email</span>
                </label>

                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <Checkbox
                    checked={messageChannels.push}
                    onCheckedChange={(checked) =>
                      setMessageChannels((prev) => ({ ...prev, push: checked === true }))
                    }
                  />
                  <span>Push Notification</span>
                </label>
                {!hasChannelSelected && (
                  <p className="text-xs text-destructive">Select at least one channel to continue.</p>
                )}
              </div>
            </div>
          </div>
          <DialogFooter className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <Button
              type="button"
              variant="outline"
              onClick={handleCopyMessage}
              disabled={!messageBody || isCopyingMessage}
            >
              {isCopyingMessage ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Copy className="mr-2 h-4 w-4" />
              )}
              Copy message
            </Button>
            <div className="flex w-full justify-end gap-2 sm:w-auto">
              <Button type="button" variant="ghost" onClick={() => setMessageDialogOpen(false)}>
                Close
              </Button>
              <Button
                type="button"
                onClick={handleSendMessage}
                disabled={!messageBody || !hasChannelSelected || isSending}
              >
                {isSending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Mail className="mr-2 h-4 w-4" />}
                Done
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
        </Dialog>

        {/* Bulk USCF Sync Progress Dialog */}
        <Dialog open={syncDialogOpen} onOpenChange={(open) => { if (!isSyncingRatings) setSyncDialogOpen(open); }}>
          <DialogContent className="sm:max-w-[425px] bg-white">
            <DialogHeader>
              <DialogTitle>Syncing USCF Ratings</DialogTitle>
              <DialogDescription>
                Checking US Chess database for live rating updates. This is done sequentially to prevent server blocks.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="flex justify-between text-sm font-medium">
                <span className="text-slate-600">Progress</span>
                <span className="text-blue-600 font-bold">{syncProgress} / {syncTotal}</span>
              </div>
              <div className="w-full bg-slate-100 rounded-full h-3 overflow-hidden">
                <div 
                  className="bg-blue-600 h-full rounded-full transition-all duration-300"
                  style={{ width: `${(syncProgress / (syncTotal || 1)) * 100}%` }}
                />
              </div>
              {isSyncingRatings ? (
                <div className="flex items-center gap-2 text-sm text-slate-500 bg-slate-50 border border-slate-100 rounded-md p-3">
                  <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
                  <span>Checking <span className="font-semibold text-slate-700">{syncCurrentName}</span>...</span>
                </div>
              ) : (
                <div className="flex items-center gap-2 text-sm text-green-600 bg-green-50 border border-green-100 rounded-md p-3">
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                  <span>Syncing completed successfully!</span>
                </div>
              )}
            </div>
            <DialogFooter>
              <Button type="button" disabled={isSyncingRatings} onClick={() => setSyncDialogOpen(false)}>
                Close
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
                      </>
                    )}
                  </div>
                </TooltipProvider>
              )}
            </CardContent>
          </Card>
        </Tabs>
      </div>
    );
}
