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

  const registeredCount = useMemo(() => {
    if (activeSection === "all") return players.length;
    return players.filter(p => p.sectionId === activeSection || p.sectionName === activeSection).length;
  }, [players, activeSection]);

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

  const getPlayerEntryFee = useCallback((player: Player) => {
    const section = sections.find(s => s.id === player.sectionId || s.name === player.sectionName);
    const sectionFees = tournamentConfig.entryFees.filter(f => f.sectionId === section?.id || f.section === section?.name);
    if (sectionFees.length === 0) {
      if (tournamentConfig.entryFees.length === 0) return 0;
      const generalFee = tournamentConfig.entryFees.find(f => !f.sectionId && (!f.section || f.section.toLowerCase() === 'all'));
      return generalFee ? generalFee.amount : 0;
    }
    return sectionFees[0].amount;
  }, [sections, tournamentConfig.entryFees]);

  const handlePaymentDoubleClick = useCallback((player: Player) => {
    if (!isTD) return;
    const entryFee = getPlayerEntryFee(player);
    if (entryFee === 0) return; // N/A, do nothing
    
    const currentStatus = player.paymentStatus || "unpaid";
    const nextStatus = currentStatus === "paid" ? "unpaid" : "paid";
    
    updatePlayerPaymentStatusMutation.mutate({
      playerId: player.id,
      paymentStatus: nextStatus
    });
  }, [isTD, getPlayerEntryFee, updatePlayerPaymentStatusMutation]);

  const renderTable = (tablePlayers: Player[], onToggleSelectAll: (checked: boolean) => void, headerCheckboxStateValue: any) => {
    return (
      <Table className="min-w-[900px] md:min-w-full relative border-collapse table-fixed font-sans text-sm">
        <TableHeader className="bg-slate-50/50 sticky top-0 z-30 shadow-[0_1px_0_0_rgba(226,232,240,0.8)] font-sans">
          <TableRow className="hover:bg-transparent border-b border-slate-100 font-sans text-sm">
            {visibleColumns.includes("index") && (
              <TableHead className="w-10 px-2 py-2 text-center text-sm font-semibold text-slate-500 bg-slate-50/80 sticky left-0 z-20 font-sans">#</TableHead>
            )}
            {visibleColumns.includes("name") && (
              <TableHead className={cn(
                "w-44 px-2 py-2 text-sm font-semibold text-slate-500 bg-slate-50/80 sticky z-20 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.05)] font-sans",
                isIndexVisible ? "left-10" : "left-0"
              )}>
                <button onClick={() => handleSort('name')} className="flex items-center gap-1 hover:text-slate-800 transition-colors text-sm font-sans font-semibold">
                  Name
                  {sortKey === 'name' && <ArrowUpDown className="h-3 w-3 inline text-slate-500" />}
                </button>
              </TableHead>
            )}
            {visibleColumns.includes("uscfId") && (
              <TableHead className="w-28 px-2 py-2 text-sm font-semibold text-slate-500 bg-slate-50/80 font-sans">USCF ID</TableHead>
            )}
            {visibleColumns.includes("rating") && (
              <TableHead className="w-28 px-2 py-2 text-sm font-semibold text-slate-500 bg-slate-50/80 font-sans">
                <button onClick={() => handleSort('rating')} className="flex items-center gap-1 hover:text-slate-800 transition-colors text-sm font-sans font-semibold">
                  {tournamentConfig.details.primaryRatingSystem === 'fide' ? 'FIDE' : 'USCF'} Rating
                  {sortKey === 'rating' && <ArrowUpDown className="h-3 w-3 inline text-slate-500" />}
                </button>
              </TableHead>
            )}
            {visibleColumns.includes("uscfMembership") && (
              <TableHead className="w-44 px-2 py-2 text-sm font-semibold text-slate-500 bg-slate-50/80 whitespace-nowrap font-sans">USCF Membership</TableHead>
            )}
            {visibleColumns.includes("byes") && tournament.format !== 'arena' && (
              <TableHead className="w-44 pl-8 pr-2 py-2 text-sm font-semibold text-slate-500 bg-slate-50/80 font-sans">Byes</TableHead>
            )}
            {visibleColumns.includes("paymentStatus") && (
              <TableHead className="w-28 px-2 py-2 text-sm font-semibold text-slate-500 bg-slate-50/80 font-sans">
                <button onClick={() => handleSort('paymentStatus')} className="flex items-center gap-1 hover:text-slate-800 transition-colors text-sm font-sans font-semibold">
                  Payment
                  {sortKey === 'paymentStatus' && <ArrowUpDown className="h-3 w-3 inline text-slate-500" />}
                </button>
              </TableHead>
            )}
            {visibleColumns.includes("uscfRating") && (
              <TableHead className="w-28 px-2 py-2 text-sm font-semibold text-slate-500 bg-slate-50/80 font-sans">
                <button onClick={() => handleSort('uscfRating')} className="flex items-center gap-1 hover:text-slate-800 transition-colors text-sm font-sans font-semibold">
                  USCF Rating
                  {sortKey === 'uscfRating' && <ArrowUpDown className="h-3 w-3 inline text-slate-500" />}
                </button>
              </TableHead>
            )}
            {visibleColumns.includes("fideRating") && (
              <TableHead className="w-28 px-2 py-2 text-sm font-semibold text-slate-500 bg-slate-50/80 font-sans">FIDE Rating</TableHead>
            )}
            {visibleColumns.includes("fideId") && (
              <TableHead className="w-28 px-2 py-2 text-sm font-semibold text-slate-500 bg-slate-50/80 font-sans">FIDE ID</TableHead>
            )}
            {visibleColumns.includes("federation") && (
              <TableHead className="w-24 px-2 py-2 text-sm font-semibold text-slate-500 bg-slate-50/80 font-sans">Federation</TableHead>
            )}
            {visibleColumns.includes("section") && (
              <TableHead className="w-28 px-2 py-2 text-sm font-semibold text-slate-500 bg-slate-50/80 font-sans">
                <button onClick={() => handleSort('section')} className="flex items-center gap-1 hover:text-slate-800 transition-colors text-sm font-sans font-semibold">
                  Section
                  {sortKey === 'section' && <ArrowUpDown className="h-3 w-3 inline text-slate-500" />}
                </button>
              </TableHead>
            )}
            {visibleColumns.includes("club") && (
              <TableHead className="w-32 px-2 py-2 text-sm font-semibold text-slate-500 bg-slate-50/80 font-sans">Club</TableHead>
            )}
            {visibleColumns.includes("birthdate") && (
              <TableHead className="w-24 px-2 py-2 text-sm font-semibold text-slate-500 bg-slate-50/80 font-sans">Birthdate</TableHead>
            )}
            {visibleColumns.includes("createdAt") && (
              <TableHead className="w-28 px-2 py-2 text-sm font-semibold text-slate-500 bg-slate-50/80 font-sans">
                <button onClick={() => handleSort('createdAt')} className="flex items-center gap-1 hover:text-slate-800 transition-colors text-sm font-sans font-semibold">
                  Registered
                  {sortKey === 'createdAt' && <ArrowUpDown className="h-3 w-3 inline text-slate-500" />}
                </button>
              </TableHead>
            )}
            {visibleColumns.includes("seed") && tournament.format === 'knockout' && (
              <TableHead className="w-16 px-2 py-2 text-sm font-semibold text-slate-500 bg-slate-50/80 font-sans">Seed</TableHead>
            )}
            {visibleColumns.includes("status") && (
              <TableHead className="w-24 px-2 py-2 text-sm font-semibold text-slate-500 bg-slate-50/80 font-sans">Status</TableHead>
            )}
            {visibleColumns.includes("email") && (
              <TableHead className="w-32 px-2 py-2 text-sm font-semibold text-slate-500 bg-slate-50/80 font-sans">Email</TableHead>
            )}
            {visibleColumns.includes("actions") && (
              <TableHead className="w-32 pl-2 pr-2 py-2 text-right text-sm font-semibold text-slate-500 bg-slate-50/80 sticky right-0 z-20 shadow-[-2px_0_5px_-2px_rgba(0,0,0,0.05)] font-sans">
                <div className="flex items-center justify-end gap-2 font-sans text-sm pr-6">
                  <span>Select</span>
                  {isTD && (
                    <Checkbox
                      checked={headerCheckboxStateValue}
                      onCheckedChange={(value) => onToggleSelectAll(Boolean(value))}
                      aria-label="Select all players"
                      disabled={tablePlayers.length === 0}
                      className="h-3.5 w-3.5 rounded border-slate-300 text-indigo-650 focus:ring-indigo-500"
                    />
                  )}
                </div>
              </TableHead>
            )}
          </TableRow>
        </TableHeader>
        <TableBody className="font-sans text-sm">
          {tablePlayers.map((player, index) => {
            const isSelected = selectedIds.includes(player.id);
            const isConfirmed = Boolean(confirmedMap[player.id]);
            const playerByes = playerByeMap.get(player.id) ?? [];
            const rowClasses = isSelected
              ? "group border-b border-slate-100 cursor-pointer transition-colors bg-indigo-50/20 hover:bg-indigo-50/40 dark:bg-indigo-900/10 dark:hover:bg-indigo-900/20 h-11 font-sans text-sm"
              : "group border-b border-slate-100 cursor-pointer transition-colors hover:bg-slate-50/80 dark:bg-slate-800/40 dark:hover:bg-slate-700/40 h-11 font-sans text-sm";
            return (
              <TableRow
                key={player.id}
                className={rowClasses}
                onClick={() => setLocation(`/tournaments/${tournamentId}/players/${player.id}`)}
              >
                {visibleColumns.includes("index") && (
                  <TableCell className={cn(
                    "sticky left-0 transition-colors z-10 text-sm font-semibold text-slate-500 text-center px-2 py-2 font-sans",
                    isSelected
                      ? "bg-indigo-50/30"
                      : "bg-white group-hover:bg-slate-50/85"
                  )}>
                    <div className="font-sans">{index + 1}</div>
                  </TableCell>
                )}
                {visibleColumns.includes("name") && (
                  <TableCell className={cn(
                    "sticky transition-colors z-10 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.05)] px-2 py-2 overflow-hidden truncate font-sans text-sm",
                    isIndexVisible ? "left-10" : "left-0",
                    isSelected
                      ? "bg-indigo-50/30"
                      : "bg-white group-hover:bg-slate-50/85"
                  )}>
                    <div className="flex flex-col gap-0.5 font-sans text-sm">
                      <span className="text-sm font-semibold text-slate-850 hover:text-indigo-650 transition-colors truncate font-sans">
                        {player.localId || (player as any).userUscfId ? (
                          <a
                            href={
                              player.federation?.toLowerCase() === 'fide'
                                ? `https://ratings.fide.com/profile/${player.localId}`
                                : `https://ratings.uschess.org/player/${player.localId || (player as any).userUscfId}`
                            }
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-indigo-600 hover:text-indigo-850 hover:underline cursor-pointer font-sans"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {player.lastName}, {player.firstName}
                          </a>
                        ) : (
                          `${player.lastName}, ${player.firstName}`
                        )}
                      </span>
                      {!tournamentConfig.registers?.verifyUscfMembership && (player as any).userUscfId && (
                        <div className="flex items-center gap-1.5 mt-0.5 font-sans text-sm" onClick={(e) => e.stopPropagation()}>
                          <span className="text-sm font-sans text-slate-500 bg-slate-100 px-1.5 py-0.2 rounded border">
                            USCF: {(player as any).userUscfId}
                          </span>
                          {(player as any).userUscfVerificationStatus === "verified" ? (
                            <Badge className="bg-emerald-50 text-emerald-700 hover:bg-emerald-50 border-emerald-200/50 text-sm px-1.5 py-0 rounded-full font-medium shadow-none font-sans">
                              Verified
                            </Badge>
                          ) : (player as any).userUscfVerificationStatus === "pending" ? (
                            <div className="flex items-center gap-1 font-sans text-sm">
                              <Badge className="bg-amber-50 text-amber-700 hover:bg-amber-50 border-amber-200/50 text-sm px-1.5 py-0 rounded-full font-medium animate-pulse shadow-none font-sans">
                                Pending
                              </Badge>
                              {isTD && (
                                <button
                                  onClick={() => verifyUscfMutation.mutate({ targetUserId: (player as any).userId, verified: true })}
                                  disabled={verifyUscfMutation.isPending}
                                  className="text-sm text-indigo-650 hover:text-indigo-800 font-semibold hover:underline ml-1 font-sans"
                                >
                                  Verify
                                </button>
                              )}
                            </div>
                          ) : (
                            <Badge variant="secondary" className="text-sm px-1.5 py-0 rounded-full font-medium shadow-none bg-slate-100 text-slate-500 font-sans">
                              Unverified
                            </Badge>
                          )}
                        </div>
                      )}
                    </div>
                  </TableCell>
                )}
                {visibleColumns.includes("uscfId") && (
                  <TableCell className="px-2 py-2 overflow-hidden font-sans text-sm">
                    {(player as any).userUscfId || player.localId ? (
                      <span className="font-sans text-sm font-semibold text-slate-800 bg-slate-50 px-2 py-0.5 rounded border border-slate-200/60 shadow-sm whitespace-nowrap">
                        {(player as any).userUscfId || player.localId}
                      </span>
                    ) : (
                      <span className="text-sm text-slate-400 font-sans">—</span>
                    )}
                  </TableCell>
                )}
                {visibleColumns.includes("rating") && (
                  <TableCell className="px-2 py-2 text-sm font-medium text-slate-850 overflow-hidden font-sans">
                    {(() => {
                      const threshold = tournamentConfig?.registers?.uscfMinGamesThreshold ?? 4;
                      const uscfDisp = resolveDisplayRating((player as any).uscfRatingRaw, player.uscfRating, threshold, false);
                      const fideDisp = resolveDisplayRating((player as any).fideRatingRaw, player.fideRating, 0, true);
                      const display = tournamentConfig.details.primaryRatingSystem === 'fide'
                        ? (fideDisp !== "Unrated" ? fideDisp : uscfDisp)
                        : (uscfDisp !== "Unrated" ? uscfDisp : fideDisp);
                      const displayVal = display === "Unrated" ? "-" : display;
                      return displayVal === "-" ? (
                        <span className="text-sm text-slate-400 font-sans">—</span>
                      ) : (
                        <span className="font-sans text-sm font-semibold text-slate-800 bg-slate-50 px-2 py-0.5 rounded border border-slate-200/60 shadow-sm whitespace-nowrap">
                          {displayVal}
                        </span>
                      );
                    })()}
                  </TableCell>
                )}
                {visibleColumns.includes("uscfMembership") && (
                  <TableCell className="px-2 py-2 whitespace-nowrap overflow-hidden font-sans text-sm" onClick={(e) => e.stopPropagation()}>
                    {(() => {
                      const rawExpiry = player.uscfMemberExpiry || (player as any).userUscfMemberExpiry;
                      if (!rawExpiry) {
                        return (
                          <Badge className="whitespace-nowrap bg-slate-50 text-slate-400 hover:bg-slate-50 border border-slate-200/80 text-sm px-1.5 py-0.5 rounded-full font-semibold shadow-none font-sans">
                            No Expiry Info
                          </Badge>
                        );
                      }
                      try {
                        const expiryDate = new Date(rawExpiry);
                        if (isNaN(expiryDate.getTime())) {
                          return (
                            <Badge className="whitespace-nowrap bg-slate-50 text-slate-400 hover:bg-slate-50 border border-slate-200/80 text-sm px-1.5 py-0.5 rounded-full font-semibold shadow-none font-sans">
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
                            <Badge className="whitespace-nowrap bg-emerald-50 text-emerald-700 hover:bg-emerald-50 border border-emerald-250/30 text-sm px-2 py-0.5 rounded-full font-medium shadow-none font-sans">
                              Active (Exp: {formatted})
                            </Badge>
                          );
                        } else {
                          return (
                            <Badge className="whitespace-nowrap bg-rose-50 text-rose-700 hover:bg-rose-50 border border-rose-250/30 text-sm px-2 py-0.5 rounded-full font-medium shadow-none font-sans">
                              Expired (Exp: {formatted})
                            </Badge>
                          );
                        }
                      } catch (e) {
                        return (
                          <Badge className="whitespace-nowrap bg-slate-50 text-slate-400 hover:bg-slate-50 border border-slate-200/80 text-sm px-1.5 py-0.5 rounded-full font-semibold shadow-none font-sans">
                            No Expiry Info
                          </Badge>
                        );
                      }
                    })()}
                  </TableCell>
                )}
                {visibleColumns.includes("byes") && tournament.format !== 'arena' && (
                  <TableCell className="pl-8 pr-2 py-2 overflow-hidden font-sans text-sm">
                    {pairingsLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
                    ) : playerByes.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5 font-sans">
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
                          return (
                            <div
                              key={bye.id}
                              className={cn(
                                "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-sm font-medium transition-colors whitespace-nowrap shadow-none font-sans",
                                isRequested
                                  ? "border-orange-200 bg-orange-50 text-orange-850 hover:bg-orange-100/50"
                                  : "border-orange-100/70 bg-orange-50/40 text-orange-700/85 hover:bg-orange-100/30"
                              )}
                              title={isRequested ? "Manual bye" : "System-assigned"}
                            >
                              <span className="font-sans">Rd {bye.round}</span>
                              <span aria-hidden="true" className="opacity-40 font-sans">·</span>
                              <span className="font-sans">{byeLabel} pt</span>
                              {isRequested && isTD ? (
                                <button
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    handleRemoveBye(bye.id);
                                  }}
                                  className="ml-1 inline-flex h-3 w-3 items-center justify-center rounded-full text-orange-700 hover:bg-orange-100 hover:text-orange-950 transition-colors"
                                  disabled={isRemoving}
                                  aria-label={`Remove bye in round ${bye.round}`}
                                >
                                  {isRemoving ? (
                                    <Loader2 className="h-2 w-2 animate-spin" />
                                  ) : (
                                    <X className="h-2 w-2" />
                                  )}
                                </button>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <span className="text-sm text-slate-400 font-sans">—</span>
                    )}
                  </TableCell>
                )}
                {visibleColumns.includes("paymentStatus") && (
                  <TableCell
                    className="px-2 py-2 overflow-hidden font-sans text-sm select-none cursor-pointer"
                    onClick={(e) => e.stopPropagation()}
                    onDoubleClick={() => handlePaymentDoubleClick(player)}
                    title={isTD && getPlayerEntryFee(player) > 0 ? "Double-click to toggle Paid / Unpaid status" : undefined}
                  >
                    {(() => {
                      const entryFee = getPlayerEntryFee(player);
                      const isFree = entryFee === 0;
                      const status = isFree ? "N/A" : (player.paymentStatus === "paid" ? "Paid" : "Unpaid");
                      
                      let badgeColor = "bg-slate-50 text-slate-500 border-slate-200";
                      if (status === "Paid") {
                        badgeColor = "bg-emerald-50 text-emerald-700 border-emerald-200/50";
                      } else if (status === "Unpaid") {
                        badgeColor = "bg-rose-50 text-rose-700 border-rose-200/50";
                      }
                      
                      return (
                        <Badge className={`${badgeColor} border text-sm px-2.5 py-0.5 rounded-full font-medium shadow-none font-sans whitespace-nowrap`}>
                          {status}
                        </Badge>
                      );
                    })()}
                  </TableCell>
                )}
                {visibleColumns.includes("uscfRating") && (
                  <TableCell className="px-2 py-2 text-sm font-medium text-slate-850 overflow-hidden font-sans">
                    {player.uscfRating ? (
                      <span className="font-sans text-sm font-semibold text-slate-800 bg-slate-50 px-2 py-0.5 rounded border border-slate-200/60 shadow-sm whitespace-nowrap">
                        {player.uscfRating}{player.uscfRatingRaw?.toLowerCase().includes('p') ? 'p' : ''}
                      </span>
                    ) : (
                      <span className="text-sm text-slate-400 font-sans">—</span>
                    )}
                  </TableCell>
                )}
                {visibleColumns.includes("fideRating") && (
                  <TableCell className="px-2 py-2 text-sm font-medium text-slate-850 overflow-hidden font-sans">
                    {player.fideRating ? (
                      <span className="font-sans text-sm font-semibold text-slate-800 bg-slate-50 px-2 py-0.5 rounded border border-slate-200/60 shadow-sm whitespace-nowrap">
                        {player.fideRating}
                      </span>
                    ) : (
                      <span className="text-sm text-slate-400 font-sans">—</span>
                    )}
                  </TableCell>
                )}
                {visibleColumns.includes("fideId") && (
                  <TableCell className="px-2 py-2 font-sans text-sm">
                    {player.localId && player.federation?.toLowerCase() === 'fide' ? (
                      <span className="font-sans text-sm font-semibold bg-slate-100/80 px-1.5 py-0.5 rounded border border-slate-200/50">{player.localId}</span>
                    ) : (
                      <span className="text-sm text-slate-400 font-sans">—</span>
                    )}
                  </TableCell>
                )}
                {visibleColumns.includes("federation") && (
                  <TableCell className="px-2 py-2 font-sans text-sm">
                    <Badge variant="outline" className="text-sm font-medium text-slate-500 border-slate-200 bg-slate-50/20 font-sans">{player.federation || "USCF"}</Badge>
                  </TableCell>
                )}
                {visibleColumns.includes("section") && (
                  <TableCell className="px-2 py-2 text-sm font-medium text-slate-705 font-sans">
                    {player.sectionName || "Default"}
                  </TableCell>
                )}
                {visibleColumns.includes("club") && (
                  <TableCell className="px-2 py-2 text-sm text-slate-600 max-w-[150px] truncate font-sans">
                    {player.club || "—"}
                  </TableCell>
                )}
                {visibleColumns.includes("birthdate") && (
                  <TableCell className="px-2 py-2 text-sm font-normal text-slate-650 font-sans">
                    {player.birthdate || "—"}
                  </TableCell>
                )}
                {visibleColumns.includes("createdAt") && (
                  <TableCell className="px-2 py-2 text-sm text-slate-600 font-sans">
                    {new Date(player.createdAt).toLocaleDateString()}
                  </TableCell>
                )}
                {visibleColumns.includes("seed") && tournament.format === 'knockout' && (
                  <TableCell className="px-2 py-2 font-sans text-sm">
                    {isTD && editingSeedId === player.id ? (
                      <Input
                        type="number"
                        className="h-7 w-16 text-sm font-semibold font-sans"
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
                          "p-1 rounded text-sm font-semibold text-slate-700 min-w-[2rem] text-center transition-colors font-sans",
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
                  <TableCell className="px-2 py-2 font-sans text-sm">
                    <Badge variant={(player.status || 'active') === 'active' ? 'default' : 'secondary'} className="text-sm font-medium shadow-none font-sans">
                      {player.status || 'active'}
                    </Badge>
                  </TableCell>
                )}
                {visibleColumns.includes("email") && (
                  <TableCell className="px-2 py-2 text-sm font-normal truncate font-sans">
                    {player.email || "—"}
                  </TableCell>
                )}
                {visibleColumns.includes("actions") && (
                  <TableCell className={cn(
                    "text-right sticky right-0 z-10 transition-colors shadow-[-2px_0_5px_-2px_rgba(0,0,0,0.05)] pl-2 pr-2 py-2 w-32 font-sans text-sm",
                    isSelected
                      ? "bg-indigo-50/30"
                      : "bg-white group-hover:bg-slate-50/85"
                  )}>
                    <div className="flex items-center justify-end gap-2 font-sans text-sm pr-6" onClick={(e) => e.stopPropagation()}>
                      {isConfirmed ? (
                        <CheckCircle2 className="h-4 w-4 text-emerald-500" aria-label="Confirmed" />
                      ) : null}
                      {isTD && (
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={(value) => toggleSelectPlayer(player.id, Boolean(value))}
                          aria-label={`Select ${player.lastName}, ${player.firstName}`}
                          disabled={isDeleting || isProcessingStatus}
                          className="h-3.5 w-3.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                        />
                      )}
                    </div>
                  </TableCell>
                )}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    );
  };

  return (
    <div className="grid grid-cols-1 gap-4">
      <Tabs value={activeSection} onValueChange={setActiveSection} className="w-full">
        {sections.length > 1 && (
          <TabsList className="flex flex-nowrap overflow-x-auto no-scrollbar justify-start items-center bg-slate-100/50 p-1 mb-6 rounded-xl border border-slate-200/60 shadow-sm backdrop-blur-sm w-full sm:w-fit">
            <TabsTrigger value="all" className="flex-none sm:flex-1 data-[state=active]:bg-white data-[state=active]:shadow-md data-[state=active]:text-black transition-all font-semibold rounded-lg px-4 py-2.5 text-sm whitespace-nowrap">All</TabsTrigger>
            {sections.map(section => (
              <TabsTrigger key={section.id} value={section.id} className="flex-none sm:flex-1 data-[state=active]:bg-white data-[state=active]:shadow-md data-[state=active]:text-black transition-all font-semibold rounded-lg px-4 py-2.5 text-sm whitespace-nowrap">
                {section.name}
              </TabsTrigger>
            ))}
          </TabsList>
        )}
        <Card className="mt-4 border-slate-200/60 shadow-[0_8px_30px_rgba(0,0,0,0.04)] rounded-2xl overflow-hidden">
          <CardHeader className="flex flex-row items-center justify-between border-b border-slate-150 px-6 py-4 gap-4 bg-slate-50/40">
            <div className="flex items-baseline gap-2 min-w-0">
              <CardTitle className="text-xl font-bold text-slate-800 tracking-tight font-sans">Players</CardTitle>
              <span className="text-sm text-slate-500 font-medium shrink-0 font-sans">({registeredCount} registered)</span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {isTD && (
                <>
                  <Button 
                    variant="outline" 
                    size="default" 
                    className="h-10 text-sm font-semibold rounded-lg border-slate-200 hover:bg-slate-100/50 text-slate-600 shadow-sm transition-all px-4" 
                    onClick={handleSyncAllRatings} 
                    disabled={isSyncingRatings}
                  >
                    <RefreshCw className={cn("mr-2 h-4 w-4", isSyncingRatings && "animate-spin")} />
                    Sync Ratings
                  </Button>
                  <Button 
                    size="default" 
                    className="h-10 text-sm font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm transition-all px-4" 
                    onClick={() => setLocation(`/tournaments/${tournamentId}/players/new`)}
                  >
                    <Plus className="mr-2 h-4 w-4" />
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
                    size="default" 
                    className="h-10 mt-3 text-sm font-semibold bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg px-4"
                    onClick={() => setLocation(`/tournaments/${tournamentId}/players/new`)}
                  >
                    <Plus className="mr-2 h-4 w-4" /> Add Player
                  </Button>
                )}
              </div>
            ) : (
              <TooltipProvider>
                {/* Search & Filters Controls Row */}
                <div className="flex items-center gap-2 py-1">
                  <div className="relative flex-1 max-w-md">
                    <Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
                    <Input
                      placeholder="Search by name, ID, email, or club..."
                      className="pl-10 h-10 text-sm w-full bg-white border-slate-200 focus-visible:ring-indigo-500 focus-visible:border-indigo-500 rounded-lg shadow-sm"
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                    />
                  </div>

                  <div className="flex items-center gap-2 ml-auto shrink-0">
                    <Button
                      variant={showFilterPanel || filterStatus !== "all" || filterFederation !== "all" || filterRatingType !== "all" || filterVerification !== "all" ? "secondary" : "outline"}
                      size="default"
                      className={cn(
                        "h-10 text-sm font-semibold rounded-lg border-slate-200 text-slate-700 shadow-sm transition-all px-4",
                        (showFilterPanel || filterStatus !== "all" || filterFederation !== "all" || filterRatingType !== "all" || filterVerification !== "all")
                          ? "bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-100"
                          : "hover:bg-slate-50"
                      )}
                      onClick={() => setShowFilterPanel(!showFilterPanel)}
                    >
                      <SlidersHorizontal className="mr-2 h-4 w-4" />
                      Filters
                      {(filterStatus !== "all" || filterFederation !== "all" || filterRatingType !== "all" || filterVerification !== "all") && (
                        <span className="ml-2 bg-indigo-600 text-white rounded-full h-4 w-4 flex items-center justify-center p-0 text-[9px] font-bold">
                          {[filterStatus !== "all", filterFederation !== "all", filterRatingType !== "all", filterVerification !== "all"].filter(Boolean).length}
                        </span>
                      )}
                    </Button>

                    <Popover>
                      <PopoverTrigger asChild>
                        <Button variant="outline" size="default" className="h-10 text-sm font-semibold rounded-lg border-slate-200 hover:bg-slate-50 text-slate-700 shadow-sm transition-all px-4">
                          <Eye className="mr-2 h-4 w-4" />
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
                  <div className="flex items-center justify-between px-4 py-2 bg-indigo-50 border border-indigo-100 rounded-xl shadow-sm mb-3 animate-in fade-in slide-in-from-top-1 duration-150 font-sans">
                    <div className="flex items-center gap-2 font-sans">
                      <span className="text-xs font-bold text-indigo-700 bg-indigo-100 px-2 py-0.5 rounded-full font-sans shrink-0">
                        {selectionCount}
                      </span>
                      <span className="text-xs font-semibold text-indigo-850 font-sans">
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
                {processedPlayers.length === 0 ? (
                  <div className="overflow-x-auto no-scrollbar border border-slate-200/80 rounded-xl bg-white shadow-sm py-16 text-center bg-slate-50/30 w-full flex flex-col items-center justify-center">
                    <p className="text-sm font-semibold text-slate-605">No players match the applied filters.</p>
                    <p className="text-xs text-slate-405 mt-1">Try resetting some filters or modifying your search query.</p>
                    <Button
                      variant="link"
                      className="text-xs text-indigo-605 hover:text-indigo-800 mt-2 font-semibold"
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
                ) : activeSection === "all" && sections.length > 1 ? (
                  <div className="space-y-6">
                    {sections.map((section) => {
                      const sectionPlayers = processedPlayers.filter(
                        (p) => p.sectionId === section.id || p.sectionName === section.name
                      );
                      const sectionIds = sectionPlayers.map((p) => p.id);
                      const sectionSelectedCount = selectedIds.filter((id) => sectionIds.includes(id)).length;
                      const isSectionAllSelected = sectionSelectedCount > 0 && sectionSelectedCount === sectionIds.length;
                      const isSectionIndeterminate = sectionSelectedCount > 0 && sectionSelectedCount < sectionIds.length;
                      const sectionCheckboxState = isSectionAllSelected ? true : isSectionIndeterminate ? "indeterminate" : false;

                      const handleToggleSectionAll = (checked: boolean) => {
                        setSelectedIds((prev) => {
                          if (checked) {
                            const newIds = sectionIds.filter((id) => !prev.includes(id));
                            return [...prev, ...newIds];
                          } else {
                            return prev.filter((id) => !sectionIds.includes(id));
                          }
                        });
                      };

                      return (
                        <div key={section.id} className="rounded-2xl bg-white shadow-[0_8px_30px_rgba(0,0,0,0.04)] overflow-hidden border border-slate-100/50 animate-fade-in font-sans">
                          <div className="bg-slate-50/50 px-5 py-4 flex items-center justify-between border-b border-slate-100 font-sans">
                            <div className="flex items-baseline gap-2 font-sans">
                              <h3 className="font-sans text-sm font-bold text-slate-800 tracking-tight">
                                {section.name}
                              </h3>
                              <span className="font-sans text-xs text-slate-400 font-medium">
                                ({sectionPlayers.length} {sectionPlayers.length === 1 ? "player" : "players"} registered)
                              </span>
                            </div>
                          </div>
                          <div className="overflow-x-auto no-scrollbar font-sans">
                            {sectionPlayers.length === 0 ? (
                              <div className="py-8 text-center text-xs text-slate-400 font-medium bg-slate-50/10 font-sans">
                                No players in this section matching filters.
                              </div>
                            ) : (
                              renderTable(sectionPlayers, handleToggleSectionAll, sectionCheckboxState)
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="overflow-x-auto no-scrollbar rounded-2xl bg-white shadow-[0_8px_30px_rgba(0,0,0,0.04)] border border-slate-100/50">
                    {renderTable(processedPlayers, toggleSelectAll, headerCheckboxValue)}
                  </div>
                )}
              </TooltipProvider>
            )}
          </CardContent>
        </Card>
      </Tabs>

      {/* TD Dialog overlays */}
      {isTD && (
        <>
          <Dialog
            open={isStatusDialogOpen}
            onOpenChange={(open) => {
              setStatusDialogOpen(open);
              if (!open) {
                resetStatusForm();
              }
            }}
          >
            <DialogContent className="bg-white rounded-xl shadow-xl border border-slate-200">
              <DialogHeader>
                <DialogTitle className="text-base font-bold text-slate-800">Manage player availability</DialogTitle>
                <DialogDescription className="text-xs text-slate-500">
                  Withdraw selected players from upcoming rounds or assign custom byes.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-2">
                <div className="space-y-1.5">
                  <Label htmlFor="status-scope" className="text-xs font-semibold text-slate-600">Action</Label>
                  <Select
                    value={withdrawScope}
                    onValueChange={(value) => setWithdrawScope(value as typeof withdrawScope)}
                  >
                    <SelectTrigger id="status-scope" className="w-full text-xs h-9">
                      <SelectValue placeholder="Choose action" />
                    </SelectTrigger>
                    <SelectContent className="bg-white border text-xs">
                      <SelectItem value="all">Withdraw from all future rounds</SelectItem>
                      <SelectItem value="specific">Assign custom byes for specific rounds</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {withdrawScope === "specific" ? (
                  <div className="space-y-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs font-semibold text-slate-600">Rounds</Label>
                      {roundOptions.length ? (
                        <div className="flex flex-wrap gap-1.5">
                          {roundOptions.map((round) => {
                            const active = selectedRounds.includes(round);
                            return (
                              <Button
                                key={round}
                                type="button"
                                variant={active ? "default" : "outline"}
                                size="sm"
                                className={cn(
                                  "h-7 text-xs px-2.5 font-semibold rounded-md",
                                  active ? "bg-indigo-600 hover:bg-indigo-755 text-white" : "border-slate-200 hover:bg-slate-50"
                                )}
                                onClick={() => handleRoundToggle(round)}
                              >
                                Rd {round}
                              </Button>
                            );
                          })}
                        </div>
                      ) : (
                        <p className="text-xs text-slate-400">
                          No rounds scheduled yet. Update the tournament to enable bye assignments.
                        </p>
                      )}
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="bye-type" className="text-xs font-semibold text-slate-600">Bye result</Label>
                      <Select
                        value={byeType}
                        onValueChange={(value) => setByeType(value as typeof byeType)}
                      >
                        <SelectTrigger id="bye-type" className="w-full text-xs h-9">
                          <SelectValue placeholder="Select bye result" />
                        </SelectTrigger>
                        <SelectContent className="bg-white border text-xs">
                          <SelectItem value="zero_point">Zero-point bye</SelectItem>
                          <SelectItem value="half_point">Half-point bye</SelectItem>
                          <SelectItem value="full_point">Full-point bye</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-slate-400">
                    Confirming will issue zero-point byes for every remaining round and mark players as withdrawn.
                  </p>
                )}
              </div>
              <DialogFooter className="flex flex-col gap-1.5 sm:flex-row sm:justify-end">
                <Button
                  type="button"
                  variant="ghost"
                  className="h-9 text-xs font-semibold"
                  onClick={() => {
                    setStatusDialogOpen(false);
                    resetStatusForm();
                  }}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  className="h-9 text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg"
                  onClick={handleStatusSubmit}
                  disabled={
                    isProcessingStatus ||
                    !hasSelection ||
                    (withdrawScope === "specific" && (selectedRounds.length === 0 || roundOptions.length === 0))
                  }
                >
                  {isProcessingStatus ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
                  Apply
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Dialog open={isMessageDialogOpen} onOpenChange={setMessageDialogOpen}>
            <DialogContent className="bg-white rounded-xl shadow-xl border border-slate-200 max-w-lg">
              <DialogHeader>
                <DialogTitle className="text-base font-bold text-slate-800">Message selected players</DialogTitle>
                <DialogDescription className="text-xs text-slate-500">
                  Choose delivery channels, draft your note, then copy it into the tools you use.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-2">
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-slate-600">Recipients</Label>
                  <div className="max-h-[80px] overflow-y-auto rounded-lg border border-slate-150 bg-slate-50/50 p-2.5 text-xs text-slate-500 font-mono leading-relaxed">
                    {recipientsList || "Select at least one player to populate recipients."}
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs font-semibold border-slate-200 hover:bg-slate-50 text-slate-700"
                    onClick={handleCopyRecipients}
                    disabled={!recipientsList || isCopyingRecipients}
                  >
                    {isCopyingRecipients ? (
                      <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Copy className="mr-1.5 h-3.5 w-3.5" />
                    )}
                    Copy recipients
                  </Button>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="message-subject" className="text-xs font-semibold text-slate-600">Subject</Label>
                  <Input
                    id="message-subject"
                    className="text-xs h-9 border-slate-250 focus-visible:ring-indigo-500"
                    value={messageSubject}
                    onChange={(event) => setMessageSubject(event.target.value)}
                    placeholder="Message from tournament director"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="message-body" className="text-xs font-semibold text-slate-600">Message</Label>
                  <Textarea
                    id="message-body"
                    rows={5}
                    className="text-xs border-slate-250 focus-visible:ring-indigo-500"
                    value={messageBody}
                    onChange={(event) => setMessageBody(event.target.value)}
                    placeholder="Draft your message here…"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-slate-600">Send via</Label>
                  <div className="flex gap-4 pt-0.5">
                    <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer select-none">
                      <Checkbox
                        checked={messageChannels.email}
                        className="h-4 w-4 rounded text-indigo-650 focus:ring-indigo-500 border-slate-300"
                        onCheckedChange={(checked) =>
                          setMessageChannels((prev) => ({ ...prev, email: checked === true }))
                        }
                      />
                      <span>Email</span>
                    </label>

                    <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer select-none">
                      <Checkbox
                        checked={messageChannels.push}
                        className="h-4 w-4 rounded text-indigo-650 focus:ring-indigo-500 border-slate-300"
                        onCheckedChange={(checked) =>
                          setMessageChannels((prev) => ({ ...prev, push: checked === true }))
                        }
                      />
                      <span>Push Notification</span>
                    </label>
                  </div>
                  {!hasChannelSelected && (
                    <p className="text-[10px] text-rose-500 font-medium">Select at least one channel to continue.</p>
                  )}
                </div>
              </div>
              <DialogFooter className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between pt-2">
                <Button
                  type="button"
                  variant="outline"
                  className="h-9 text-xs font-semibold border-slate-200 hover:bg-slate-50 text-slate-700"
                  onClick={handleCopyMessage}
                  disabled={!messageBody || isCopyingMessage}
                >
                  {isCopyingMessage ? (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Copy className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  Copy message
                </Button>
                <div className="flex w-full justify-end gap-1.5 sm:w-auto">
                  <Button type="button" variant="ghost" className="h-9 text-xs font-semibold" onClick={() => setMessageDialogOpen(false)}>
                    Close
                  </Button>
                  <Button
                    type="button"
                    className="h-9 text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg"
                    onClick={handleSendMessage}
                    disabled={!messageBody || !hasChannelSelected || isSending}
                  >
                    {isSending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Mail className="mr-1.5 h-3.5 w-3.5" />}
                    Send Message
                  </Button>
                </div>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* Bulk USCF Sync Progress Dialog */}
          <Dialog open={syncDialogOpen} onOpenChange={(open) => { if (!isSyncingRatings) setSyncDialogOpen(open); }}>
            <DialogContent className="sm:max-w-[425px] bg-white rounded-xl shadow-xl border border-slate-200">
              <DialogHeader>
                <DialogTitle className="text-base font-bold text-slate-800">Syncing USCF Ratings</DialogTitle>
                <DialogDescription className="text-xs text-slate-500">
                  Checking US Chess database for live rating updates. This is done sequentially to prevent server blocks.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-3">
                <div className="flex justify-between text-xs font-semibold">
                  <span className="text-slate-500">Progress</span>
                  <span className="text-indigo-650 font-bold font-mono">{syncProgress} / {syncTotal}</span>
                </div>
                <div className="w-full bg-slate-100 rounded-full h-2.5 overflow-hidden border">
                  <div 
                    className="bg-indigo-600 h-full rounded-full transition-all duration-300"
                    style={{ width: `${(syncProgress / (syncTotal || 1)) * 100}%` }}
                  />
                </div>
                {isSyncingRatings ? (
                  <div className="flex items-center gap-2 text-xs text-slate-605 bg-slate-50 border border-slate-100 rounded-lg p-3 shadow-inner">
                    <Loader2 className="h-4 w-4 animate-spin text-indigo-500" />
                    <span>Checking <span className="font-semibold text-slate-800">{syncCurrentName}</span>...</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-xs text-emerald-605 bg-emerald-50 border border-emerald-100 rounded-lg p-3">
                    <CheckCircle2 className="h-4.5 w-4.5 text-emerald-500 shrink-0" />
                    <span className="font-semibold">Syncing completed successfully!</span>
                  </div>
                )}
              </div>
              <DialogFooter>
                <Button type="button" className="h-9 text-xs font-semibold" disabled={isSyncingRatings} onClick={() => setSyncDialogOpen(false)}>
                  Close
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </>
      )}
    </div>
  );
}
