import React, { useState, useEffect, useMemo, useCallback, useRef, forwardRef, useImperativeHandle } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { Play, RefreshCw, RotateCcw, Printer, Download, ChevronDown, ChevronUp, Camera, ScanLine } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Match, Player, Pairing, Tournament } from "@shared/schema";
import { parseTournamentConfig } from "@/lib/tournament-config";
import { calculateMatchupScore, type SectionDefinition, formatBoardNumber } from "@shared/tournament-config";
import { HEAD_TO_HEAD_RESULT_OPTIONS, BYE_RESULT_OPTIONS, getPointsForResult } from "@shared/match-results";
import { MatchManagementDialog } from "../match-management-dialog";
import { Swords, UserPlus, Settings } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";

import type { TournamentPairingsProps, PendingResultsMap } from "./types";
import { OCRScannerDialog } from "./ocr-scanner";
import { QuickRegistration } from "./registration-dialog";

const SwissPairings = forwardRef<any, TournamentPairingsProps>(
  ({ tournamentId, activeSection, showExportControls = true, isEditMode, setIsEditMode }, ref) => {
  const [currentRound, setCurrentRound] = useState(1);
  const [pendingResultChange, setPendingResultChange] = useState<{ matchId: number, result: string, isPastRound: boolean } | null>(null);
  const [selectedPlayers, setSelectedPlayers] = useState<{
    playerId: number;
    matchId: number;
    color: 'white' | 'black';
    playerName: string;
  }[]>([]);
  const [lastSwapState, setLastSwapState] = useState<{
    match1: { id: number; whitePlayerId: number | null; blackPlayerId: number | null };
    match2: { id: number; whitePlayerId: number | null; blackPlayerId: number | null };
    timestamp: number;
  } | null>(null);
  const [selectedMatchForManagement, setSelectedMatchForManagement] = useState<Match | null>(null);
  const [expandedSeries, setExpandedSeries] = useState<Set<number>>(new Set());
  const [collapsedRounds, setCollapsedRounds] = useState<Set<number>>(new Set());
  const [finishConfirmation, setFinishConfirmation] = useState("");
  const [pendingResults, setPendingResults] = useState<PendingResultsMap>({});
  // clickState tracks which sides have been single-clicked for a draw gesture
  // key: matchId, value: set of 'white' | 'black' that have been single-clicked
  const [clickState, setClickState] = useState<Record<number, Set<'white' | 'black'>>>({});

  // Webcam / OCR scan state
  const [scanDialogOpen, setScanDialogOpen] = useState(false);
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [isOcrProcessing, setIsOcrProcessing] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const { toast } = useToast();
  const { user } = useAuth();

  // Edit mode states
  const [drawClickState, setDrawClickState] = useState<{ matchId: number; side: 'white' | 'black' } | null>(null);
  const [isSavingResults, setIsSavingResults] = useState(false);

  // Guest and Houseplayer registration form state
  const [guestFirstName, setGuestFirstName] = useState("");
  const [guestLastName, setGuestLastName] = useState("");
  const [guestRating, setGuestRating] = useState("1000");
  const [guestUscfId, setGuestUscfId] = useState("");
  const [guestStatus, setGuestStatus] = useState<'guest' | 'houseplayer'>('guest');

  const toggleExpand = (matchId: number) => {
    setExpandedSeries(prev => {
      const next = new Set(prev);
      if (next.has(matchId)) next.delete(matchId);
      else next.add(matchId);
      return next;
    });
  };

  const toggleRoundCollapse = (round: number) => {
    setCollapsedRounds(prev => {
      const next = new Set(prev);
      if (next.has(round)) next.delete(round);
      else next.add(round);
      return next;
    });
  };

  const getPendingPlayerLabel = (round: number, board: number, color: 'white' | 'black') => {
    if (round === 1) return "T.B.D.";
    const prevRound = round - 1;
    const prevBoard = color === 'white' ? (board * 2) - 1 : (board * 2);
    return `Winner of ${prevRound}${String.fromCharCode(64 + prevBoard)}`;
  };

  // Get tournament data for planned rounds
  const { data: tournament } = useQuery<Tournament>({
    queryKey: [`/api/tournaments/${tournamentId}`],
  });

  const tournamentConfig = useMemo(() => (tournament ? parseTournamentConfig(tournament) : null), [tournament]);
  const sections = useMemo<SectionDefinition[]>(() => {
    if (!tournamentConfig) return [];
    return (tournamentConfig.sections ?? []).filter((section) => section.name.trim().length > 0);
  }, [tournamentConfig]);

  const selectedSectionLabel = useMemo(() => {
    if (activeSection === "all") return "All Sections";
    return sections.find((section) => section.id === activeSection)?.name ?? "All Sections";
  }, [sections, activeSection]);

  // Check if user is a tournament director and owns this tournament
  const isTournamentDirector = user?.role === 'tournament_director';
  const isOwner = isTournamentDirector && tournament && user && tournament.createdBy === user.id;

  // Debug log
  console.log('Drag debug:', {
    isOwner,
    isTournamentDirector,
    tournamentCreatedBy: tournament?.createdBy,
    userId: user?.id,
    userRole: user?.role
  });

  // Get all matches to determine the current round
  const { data: allMatches } = useQuery<Match[]>({
    queryKey: [`/api/tournaments/${tournamentId}/matches`],
    refetchInterval: 5000,
  });

  // Update current round based on latest matches
  useEffect(() => {
    if (allMatches && allMatches.length > 0) {
      const latestRound = Math.max(...allMatches.map(match => match.round));
      setCurrentRound(latestRound);
    }
  }, [allMatches]);


  // Auto-expire lastSwapState after 30 seconds
  useEffect(() => {
    if (lastSwapState) {
      const timer = setTimeout(() => {
        setLastSwapState(null);
      }, 30000); // 30 seconds

      return () => clearTimeout(timer);
    }
  }, [lastSwapState]);

  // For Round Robin or Knockout, show all matches. For Swiss show current round
  const { data: matches, isLoading } = useQuery<Match[]>({
    queryKey: [`/api/tournaments/${tournamentId}/matches`, { round: (tournament?.format === 'roundrobin' || tournament?.format === 'knockout') ? undefined : currentRound }],
    queryFn: async () => {
      if (tournament?.format === 'roundrobin' || tournament?.format === 'knockout') {
        return await apiRequest(`/api/tournaments/${tournamentId}/matches`);
      } else {
        return await apiRequest(`/api/tournaments/${tournamentId}/matches?round=${currentRound}`);
      }
    },
    refetchInterval: 5000,
  });

  const { data: players } = useQuery<Player[]>({
    queryKey: [`/api/tournaments/${tournamentId}/players`],
    refetchInterval: 5000,
  });

  const playerSectionMap = useMemo(() => {
    const map = new Map<number, SectionDefinition>();
    if (!players) return map;
    const sectionsByName = new Map<string, SectionDefinition>();
    sections.forEach((section) => {
      sectionsByName.set(section.name.trim().toLowerCase(), section);
    });
    players.forEach((player) => {
      let assigned: SectionDefinition | undefined;
      if (player.sectionId) {
        assigned = sections.find((section) => section.id === player.sectionId);
      }
      if (!assigned && player.sectionName) {
        assigned = sectionsByName.get(player.sectionName.trim().toLowerCase());
      }
      if (!assigned) {
        const rating = typeof player.rating === "number" ? player.rating : Number(player.rating);
        if (!Number.isNaN(rating)) {
          assigned = sections.find((section) => {
            const minOk = section.ratingMin === null || rating >= section.ratingMin;
            const maxOk = section.ratingMax === null || rating <= section.ratingMax;
            return minOk && maxOk;
          });
        }
      }
      if (!assigned && sections.length) {
        assigned = sections[0];
      }
      if (assigned) {
        map.set(player.id, assigned);
      }
    });
    return map;
  }, [players, sections]);

  const matchSectionFilter = useCallback(
    (match: Match, targetSectionId: string) => {
      if (targetSectionId === "all") return true;
      const whiteSectionId = match.whitePlayerId ? playerSectionMap.get(match.whitePlayerId)?.id : undefined;
      const blackSectionId = match.blackPlayerId ? playerSectionMap.get(match.blackPlayerId)?.id : undefined;
      if (!whiteSectionId && !blackSectionId) return false;
      return whiteSectionId === targetSectionId || blackSectionId === targetSectionId;
    },
    [playerSectionMap],
  );

  // Get pairings to check for byes (current round)
  const { data: pairings } = useQuery<Pairing[]>({
    queryKey: [`/api/tournaments/${tournamentId}/pairings`, { round: currentRound }],
    queryFn: async () => {
      return await apiRequest(`/api/tournaments/${tournamentId}/pairings?round=${currentRound}`);
    },
  });

  // Get all pairings for point calculation  
  const { data: allTournamentPairings } = useQuery<Pairing[]>({
    queryKey: [`/api/tournaments/${tournamentId}/pairings`],
  });

  const filteredMatches = useMemo(() => {
    if (!matches) return [] as Match[];
    if (activeSection === "extra_games") {
      return matches.filter((match) => match.isExtraGame);
    }
    if (activeSection === "all") {
      return matches.filter((match) => !match.isExtraGame);
    }
    return matches.filter((match) => !match.isExtraGame && matchSectionFilter(match, activeSection));
  }, [matches, matchSectionFilter, activeSection]);

  const roundRobinGroups = useMemo(() => {
    if (!matches || tournament?.format !== 'roundrobin') return [] as Array<{ round: number; matches: Match[] }>;
    const grouped = new Map<number, Match[]>();
    matches.forEach((match) => {
      if (!matchSectionFilter(match, activeSection)) return;
      const list = grouped.get(match.round) ?? [];
      list.push(match);
      grouped.set(match.round, list);
    });
    return Array.from(grouped.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([round, items]) => ({
        round,
        matches: [...items].sort((a, b) => (a.board || 0) - (b.board || 0)),
      }));
  }, [matches, matchSectionFilter, activeSection, tournament?.format]);

  const swissMatches = useMemo(() => {
    if (tournament?.format !== 'swiss') return [] as Match[];
    return [...filteredMatches].filter(m => !m.isExtraGame && !m.isBye).sort((a, b) => (a.board || 0) - (b.board || 0));
  }, [filteredMatches, tournament?.format]);

  const extraMatches = useMemo(() => {
    return [...filteredMatches].filter(m => m.isExtraGame).sort((a, b) => a.id - b.id);
  }, [filteredMatches]);

  const [selectedWhitePlayerId, setSelectedWhitePlayerId] = useState<string>("");
  const [selectedBlackPlayerId, setSelectedBlackPlayerId] = useState<string>("");

  const sectionPlayers = useMemo(() => {
    if (!players) return [];
    return players.filter((player) => {
      if (activeSection === "all") return true;
      const section = playerSectionMap.get(player.id);
      return section?.id === activeSection;
    });
  }, [players, playerSectionMap, activeSection]);

  const selectablePlayers = useMemo(() => {
    if (!players) return [];
    return players.filter(p => p.status !== 'withdrawn');
  }, [players]);

  const addExtraMatchMutation = useMutation({
    mutationFn: async ({ whitePlayerId, blackPlayerId }: { whitePlayerId: number; blackPlayerId: number }) => {
      return await apiRequest(`/api/tournaments/${tournamentId}/extra-matches`, {
        method: "POST",
        body: JSON.stringify({
          round: currentRound,
          whitePlayerId,
          blackPlayerId,
        }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/tournaments/${tournamentId}/matches`] });
      toast({
        title: "Extra Game Added",
        description: "The extra game has been successfully added to this round.",
      });
      setSelectedWhitePlayerId("");
      setSelectedBlackPlayerId("");
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to add extra game.",
        variant: "destructive",
      });
    },
  });

  const registerGuestMutation = useMutation({
    mutationFn: async (payload: {
      firstName: string;
      lastName: string;
      rating: number;
      status: 'guest' | 'houseplayer';
      localId?: string;
    }) => {
      return await apiRequest(`/api/tournaments/${tournamentId}/players`, {
        method: "POST",
        body: JSON.stringify({
          ...payload,
          sectionId: null,
          sectionName: null,
        }),
      });
    },
    onSuccess: () => {
      toast({
        title: "Player Registered",
        description: `Successfully registered ${guestFirstName} ${guestLastName} as a ${guestStatus}.`,
      });
      queryClient.invalidateQueries({ queryKey: [`/api/tournaments/${tournamentId}/players`] });
      setGuestFirstName("");
      setGuestLastName("");
      setGuestRating("1000");
      setGuestUscfId("");
    },
    onError: () => {
      toast({
        title: "Registration Failed",
        description: "Failed to register guest/houseplayer player.",
        variant: "destructive",
      });
    },
  });

  // Group knockout matches by round and board to handle series
  const knockoutGroups = useMemo(() => {
    if (!matches || tournament?.format !== 'knockout') return [] as Array<{ round: number; matches: Match[] }>;

    const roundGroups = new Map<number, Match[]>();

    const sourceMatches = allMatches || matches || [];
    sourceMatches.forEach(match => {
      if (!matchSectionFilter(match, activeSection)) return;
      if (tournament?.format === 'knockout' && !match.bracketType) return; // Ignore non-bracket matches if any
      const list = roundGroups.get(match.round) || [];
      list.push(match);
      roundGroups.set(match.round, list);
    });

    return Array.from(roundGroups.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([round, roundMatches]) => {
        // For knockout, we only want the unique pairs (round/board)
        const uniqueSeries = new Map<number, Match>();
        roundMatches.forEach(m => {
          if (m.board && !uniqueSeries.has(m.board)) {
            uniqueSeries.set(m.board, m);
          }
        });

        return {
          round,
          matches: Array.from(uniqueSeries.values()).sort((a, b) => (a.board || 0) - (b.board || 0))
        };
      });
  }, [matches, matchSectionFilter, activeSection, tournament?.format]);

  const filteredByes = useMemo(() => {
    if (!pairings) return [] as Pairing[];
    const byes = pairings.filter((pairing) => pairing.isBye && pairing.round === currentRound);
    const sectionByes = activeSection === "all" ? byes : byes.filter((pairing) => playerSectionMap.get(pairing.playerId)?.id === activeSection);
    return [...sectionByes].sort((a, b) => {
      const aReq = a.isRequested ? 1 : 0;
      const bReq = b.isRequested ? 1 : 0;
      if (aReq !== bReq) return aReq - bReq;
      return (a.playerId || 0) - (b.playerId || 0);
    });
  }, [pairings, playerSectionMap, activeSection, currentRound]);

  const pairingGroups = useMemo(() => {
    if (tournament?.format === 'roundrobin') {
      return roundRobinGroups;
    }
    if (tournament?.format === 'swiss') {
      return swissMatches.length ? [{ round: currentRound, matches: swissMatches }] : [];
    }
    if (tournament?.format === 'knockout') {
      return knockoutGroups;
    }
    return [] as Array<{ round: number; matches: Match[] }>;
  }, [currentRound, roundRobinGroups, swissMatches, knockoutGroups, tournament?.format]);

  const hasPrintableMatches = pairingGroups.some((group) => group.matches.length > 0);
  const hasDisplayData = activeSection === "extra_games" || hasPrintableMatches || (tournament?.format === 'swiss' && filteredByes.length > 0);

  const matchesForStatus = useMemo(() => {
    if (tournament?.format === 'roundrobin') {
      return roundRobinGroups.find((group) => group.round === currentRound)?.matches ?? [];
    }
    if (tournament?.format === 'swiss') {
      return swissMatches;
    }
    return filteredMatches;
  }, [currentRound, filteredMatches, roundRobinGroups, swissMatches, tournament?.format]);

  const maxRoundFromMatches = useMemo(() => {
    if (!allMatches || allMatches.length === 0) return 0;
    return Math.max(...allMatches.map((match) => match.round));
  }, [allMatches]);
  const plannedRounds = tournament?.rounds ?? 0;
  const totalRounds = Math.max(maxRoundFromMatches, plannedRounds, 1);
  const roundNumbers = useMemo(() => Array.from({ length: totalRounds }, (_, index) => index + 1), [totalRounds]);

  useEffect(() => {
    setCurrentRound((prev) => {
      if (prev < 1) return 1;
      if (prev > totalRounds) return totalRounds;
      return prev;
    });
  }, [totalRounds]);

  // Auto-collapse finished rounds
  useEffect(() => {
    if (!pairingGroups || pairingGroups.length === 0) return;

    pairingGroups.forEach(group => {
      const allMatchesCompleted = group.matches.length > 0 && group.matches.every(m => m.status === 'completed');
      if (allMatchesCompleted && !collapsedRounds.has(group.round)) {
        setCollapsedRounds(prev => {
          const next = new Set(prev);
          next.add(group.round);
          return next;
        });
      }
    });
  }, [pairingGroups]);

  const generatePairingsMutation = useMutation({
    mutationFn: async ({ regenerate = false }: { regenerate?: boolean } = {}) => {
      return await apiRequest(`/api/tournaments/${tournamentId}/generate-pairings`, {
        method: "POST",
        body: JSON.stringify({
          regenerate,
          targetRound: regenerate ? currentRound : undefined,
        }),
      });
    },
    onSuccess: (data, variables) => {
      toast({
        title: "Success",
        description: variables?.regenerate
          ? `Round ${currentRound} pairings have been repaired`
          : `Round ${currentRound + 1} pairings generated successfully`,
      });
      queryClient.invalidateQueries({ queryKey: [`/api/tournaments/${tournamentId}/matches`] });
      queryClient.invalidateQueries({ queryKey: [`/api/tournaments/${tournamentId}/pairings`] });
      queryClient.invalidateQueries({ queryKey: [`/api/tournaments/${tournamentId}/players`] });
      // Update current round if generating next round
      if (!variables?.regenerate) {
        setCurrentRound(prev => prev + 1);
      }
    },
    onError: (error: any) => {
      const errorMessage = error?.error || "Failed to generate pairings. Please try again.";
      toast({
        title: "Cannot Generate Pairings",
        description: errorMessage,
        variant: "destructive",
      });
    },
  });

  const finishTournamentMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest(`/api/tournaments/${tournamentId}/finish`, {
        method: "POST",
      });
    },
    onSuccess: () => {
      toast({
        title: "Tournament Completed",
        description: "Tournament has been finished. Final standings are now available.",
      });
      // Invalidate both the tournament details and the tournament list for the dashboard
      queryClient.invalidateQueries({ queryKey: [`/api/tournaments/${tournamentId}`] });
      queryClient.invalidateQueries({ queryKey: ["/api/my-tournaments"] });
    },
    onError: (error: any) => {
      const errorMessage = error?.error || "Failed to finish tournament.";
      toast({
        title: "Error",
        description: errorMessage,
        variant: "destructive",
      });
    },
  });

  const updateMatchMutation = useMutation({
    mutationFn: async ({ matchId, result }: { matchId: number; result: string }) => {
      const oldMatch = allMatches?.find(m => m.id === matchId);
      if (oldMatch) {
        const event = new CustomEvent("matchResultUpdated", {
          detail: {
            matchId,
            previousResult: oldMatch.result || null,
            previousStatus: oldMatch.status,
          }
        });
        window.dispatchEvent(event);
      }

      return await apiRequest(`/api/matches/${matchId}`, {
        method: "PUT",
        body: JSON.stringify({
          result,
          status: result === "Pending" ? "pending" : "completed",
        }),
      });
    },
    onSuccess: (updatedMatch, variables) => {
      queryClient.invalidateQueries({ queryKey: [`/api/tournaments/${tournamentId}/matches`] });
      queryClient.invalidateQueries({ queryKey: [`/api/tournaments/${tournamentId}/pairings`] });
      queryClient.invalidateQueries({ queryKey: [`/api/tournaments/${tournamentId}/players`] });
      queryClient.invalidateQueries({ queryKey: [`/api/standings/${tournamentId}`] });

      toast({
        title: "Result Updated",
        description: "Match result has been saved. Use 'Repair' to regenerate future rounds if needed.",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to update match result.",
        variant: "destructive",
      });
    },
  });

  const renderMatchActionsDropdown = (match: Match) => {
    const isByeMatch = !match.blackPlayerId;
    
    // Quick results options based on match type
    const options = isByeMatch
      ? [
          { value: "1-bye", label: "1-Point Bye (1-bye)" },
          { value: "1/2-bye", label: "1/2-Point Bye (1/2-bye)" },
          { value: "0-bye", label: "0-Point Bye (0-bye)" },
          { value: "1-byeU", label: "1-Point Bye, Unrated (1-byeU)" },
          { value: "1/2-byeU", label: "1/2-Point Bye, Unrated (1/2-byeU)" },
          { value: "0-byeU", label: "0-Point Bye, Unrated (0-byeU)" },
        ]
      : [
          { value: "1-0", label: "1-0 (White Win)", className: "text-emerald-600 dark:text-emerald-400 font-bold" },
          { value: "0-1", label: "0-1 (Black Win)", className: "text-blue-600 dark:text-blue-400 font-bold" },
          { value: "1/2-1/2", label: "½-½ (Draw)", className: "text-amber-600 dark:text-amber-450 font-bold" },
          { value: "1F-0F", label: "1F-0F (White Forfeit Win)", className: "text-emerald-500 font-medium" },
          { value: "0F-1F", label: "0F-1F (Black Forfeit Win)", className: "text-blue-500 font-medium" },
          { value: "1F-1F", label: "1F-1F (Double Forfeit)", className: "text-red-500" },
          { value: "0F-0F", label: "0F-0F (No Result)", className: "text-slate-500" },
          { value: "1-0U", label: "1-0U (White Win, Unrated)" },
          { value: "0-1U", label: "0-1U (Black Win, Unrated)" },
          { value: "1/2-1/2U", label: "½-½U (Draw, Unrated)" },
          { value: "1F-0FU", label: "1F-0FU (White Forfeit, Unrated)" },
          { value: "0F-1FU", label: "0F-1FU (Black Forfeit, Unrated)" },
        ];

    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-slate-500 hover:text-blue-600 hover:bg-slate-100 dark:hover:bg-slate-800"
            title="Manage Match Results"
          >
            <Settings className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 shadow-lg max-h-[300px] overflow-y-auto p-1 font-sans rounded-lg z-[100] w-64">
          <DropdownMenuLabel className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest px-2 py-1.5">
            {isByeMatch ? "Select Bye Points" : "Quick Results"}
          </DropdownMenuLabel>
          {options.map((opt) => (
            <DropdownMenuItem
              key={opt.value}
              className={opt.className || "text-slate-800 dark:text-slate-200"}
              onClick={() => {
                if (isEditMode) {
                  handleResultChange(match.id, opt.value);
                } else {
                  updateMatchMutation.mutate({ matchId: match.id, result: opt.value });
                }
              }}
            >
              {opt.label}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator className="border-slate-100 dark:border-slate-800" />
          <DropdownMenuItem
            className="text-red-600 dark:text-red-400 font-semibold"
            onClick={() => {
              if (isEditMode) {
                handleResultChange(match.id, "Pending");
              } else {
                updateMatchMutation.mutate({ matchId: match.id, result: "Pending" });
              }
            }}
          >
            Clear / Pending
          </DropdownMenuItem>
          <DropdownMenuSeparator className="border-slate-100 dark:border-slate-800" />
          <DropdownMenuItem
            className="text-slate-600 dark:text-slate-400 font-medium"
            onClick={() => setSelectedMatchForManagement(match)}
          >
            Advanced Match Management...
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  };

  const swapPlayersMutation = useMutation({
    mutationFn: async ({ match1Id, match2Id, player1Id, player2Id, color1, color2 }: {
      match1Id: number;
      match2Id: number;
      player1Id: number | null;
      player2Id: number | null;
      color1: 'white' | 'black';
      color2: 'white' | 'black';
    }) => {
      // Store the current state before swapping
      const currentMatches = matches || [];
      const match1 = currentMatches.find((m: Match) => m.id === match1Id);
      const match2 = currentMatches.find((m: Match) => m.id === match2Id);

      if (match1 && match2) {
        setLastSwapState({
          match1: { id: match1.id, whitePlayerId: match1.whitePlayerId, blackPlayerId: match1.blackPlayerId },
          match2: { id: match2.id, whitePlayerId: match2.whitePlayerId, blackPlayerId: match2.blackPlayerId },
          timestamp: Date.now()
        });
      }

      return await apiRequest(`/api/tournaments/${tournamentId}/swap-players`, {
        method: "POST",
        body: JSON.stringify({ match1Id, match2Id, player1Id, player2Id, color1, color2 }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/tournaments/${tournamentId}/matches`] });
      queryClient.invalidateQueries({ queryKey: [`/api/tournaments/${tournamentId}/pairings`] });
      setSelectedPlayers([]);
      toast({
        title: "Players swapped",
        description: "The pairing has been updated successfully. You can undo this swap within 30 seconds.",
      });
    },
    onError: (error) => {
      setSelectedPlayers([]);
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const undoSwapMutation = useMutation({
    mutationFn: async () => {
      if (!lastSwapState) return;

      // Restore the original pairing configuration
      await apiRequest(`/api/tournaments/${tournamentId}/swap-players`, {
        method: "POST",
        body: JSON.stringify({
          match1Id: lastSwapState.match1.id,
          match2Id: lastSwapState.match2.id,
          player1Id: lastSwapState.match1.whitePlayerId,
          player2Id: lastSwapState.match2.whitePlayerId,
          color1: 'white',
          color2: 'white'
        }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/tournaments/${tournamentId}/matches`] });
      queryClient.invalidateQueries({ queryKey: [`/api/tournaments/${tournamentId}/pairings`] });
      setLastSwapState(null);
      toast({
        title: "Swap undone",
        description: "The previous pairing swap has been undone.",
      });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: "Failed to undo the swap.",
        variant: "destructive",
      });
    },
  });

  // New mutation for regenerating future rounds after fixing results
  const regenerateFutureRoundsMutation = useMutation({
    mutationFn: async (options: { fromRound?: number } = {}) => {
      const fromRound = options.fromRound || currentRound + 1;
      return await apiRequest(`/api/tournaments/${tournamentId}/regenerate-future-rounds`, {
        method: "POST",
        body: JSON.stringify({
          fromRound
        }),
      });
    },
    onSuccess: (data) => {
      console.log('Regeneration response:', data);
      const message = data.roundsAffected > 0
        ? `Regenerated ${data.roundsAffected} rounds. ${data.matchesCreated} matches and ${data.pairingsCreated} pairings created.`
        : data.message || "No rounds were regenerated.";

      toast({
        title: data.roundsAffected > 0 ? "Success" : "No Action Needed",
        description: message,
        variant: data.roundsAffected > 0 ? "default" : "destructive",
      });
      queryClient.invalidateQueries({ queryKey: [`/api/tournaments/${tournamentId}/matches`] });
      queryClient.invalidateQueries({ queryKey: [`/api/tournaments/${tournamentId}/pairings`] });
      queryClient.invalidateQueries({ queryKey: [`/api/tournaments/${tournamentId}/players`] });
    },
    onError: (error: any) => {
      const errorMessage = error?.error || "Failed to regenerate future rounds.";
      toast({
        title: "Regeneration Failed",
        description: errorMessage,
        variant: "destructive",
      });
    },
  });

  const getPlayerName = useCallback(
    (playerId: number | null) => {
      if (!playerId || !players) return "BYE";
      const player = players.find((p) => p.id === playerId);
      if (!player) return "Unknown";

      const fullName = `${player.firstName} ${player.lastName}`;
      if (player.isActiveTd) {
        return `${fullName} (substitute player)`;
      }
      return fullName;
    },
    [players],
  );

  const getPlayerRating = useCallback(
    (playerId: number | null) => {
      if (!playerId || !players) return 0;
      const player = players.find((p) => p.id === playerId);
      if (!player) return 0;

      const isFide = tournamentConfig?.details.primaryRatingSystem === 'fide';
      const rating = isFide ? (player.fideRating ?? player.rating ?? 0) : (player.uscfRating ?? player.rating ?? 0);
      return typeof rating === 'number' ? rating : Number(rating) || 0;
    },
    [players, tournamentConfig],
  );

  const getPlayerObject = useCallback(
    (playerId: number | null) => {
      if (!playerId || !players) return null;
      return players.find((p) => p.id === playerId) ?? null;
    },
    [players],
  );

  const getPlayerPoints = useCallback(
    (playerId: number | null, beforeRound: number = 999) => {
      if (!playerId || !allMatches) return 0;

      let points = 0;

      for (let r = 1; r < beforeRound; r++) {
        const match = allMatches.find(m => (m.whitePlayerId === playerId || m.blackPlayerId === playerId) && m.round === r);
        if (match) {
          const color = match.whitePlayerId === playerId ? 'white' : 'black';
          points += getPointsForResult(match.result, color);
        } else if (allTournamentPairings) {
          const pairing = allTournamentPairings.find(p => p.playerId === playerId && p.isBye && p.round === r);
          if (pairing) {
            const byePoints = pairing.points === 1 ? 0.5 : pairing.points === 2 ? 1 : 0;
            points += byePoints;
          }
        }
      }

      return points;
    },
    [allMatches, allTournamentPairings],
  );

  const formatPointsWithFractions = (val: number): string => {
    if (val === 0) return "0";
    const integerPart = Math.floor(val);
    const fractionalPart = val - integerPart;
    if (fractionalPart === 0.5) {
      return integerPart > 0 ? `${integerPart}½` : "½";
    }
    return val.toString();
  };

  const handlePrintPairings = useCallback(async () => {
    if (!hasPrintableMatches || typeof window === "undefined") return;
    const headingSuffix = activeSection === "all" ? "" : ` – ${selectedSectionLabel}`;
    const title = `${tournament?.name ?? "Tournament"} Pairings${headingSuffix}`;
    const printWindow = window.open("", "_blank");
    if (!printWindow) return;

    const getFormattedPlayerLabel = (playerId: number | null, beforeRound: number) => {
      if (!playerId) return "";
      const p = getPlayerObject(playerId);
      if (!p) return "";
      const titleStr = p.title ? `${p.title} ` : "";
      const rating = getPlayerRating(playerId);
      const points = getPlayerPoints(playerId, beforeRound);
      const pointsStr = points.toFixed(1);
      return `${titleStr}${p.firstName} ${p.lastName} (${rating} ${pointsStr})`;
    };

    printWindow.document.write(
      `<html><head><title>${title}</title><style>
        @media print {
          @page { size: auto; margin: 0; }
          body { margin: 15mm; }
        }
        body { font-family: Arial, sans-serif; padding: 10px; color: #000; font-size: 13px; background-color: #fff; }
        .round-header { font-size: 13px; margin: 5px 0 10px 0; font-weight: normal; font-family: Arial, sans-serif; text-align: left; }
        table { width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 13px; }
        th { padding: 6px 8px; border: 1px solid #000; background-color: #fff; font-weight: normal; }
        td { padding: 6px 8px; border: 1px solid #000; vertical-align: middle; }
      </style></head><body>`,
    );

    for (const { round, matches } of pairingGroups) {
      if (!matches.length) continue;
      
      printWindow.document.write(
        `<div class="round-header">${tournament?.name || "Tournament"}: ${selectedSectionLabel} -- Round ${round}.</div>`
      );

      printWindow.document.write(
        `<table><thead><tr><th style="width: 45px; text-align: center;">Bd</th><th style="width: 55px; text-align: center;">Res</th><th style="text-align: left;">White</th><th style="width: 55px; text-align: center;">Res</th><th style="text-align: left;">Black</th></tr></thead><tbody>`,
      );

      for (const match of matches) {
        const whiteLabel = getFormattedPlayerLabel(match.whitePlayerId, round);
        const blackLabel = match.blackPlayerId ? getFormattedPlayerLabel(match.blackPlayerId, round) : "BYE";

        const isWhiteWin = match.result ? (match.result.startsWith("1-0") || match.result.startsWith("1F-0F")) : false;
        const isBlackWin = match.result ? (match.result.startsWith("0-1") || match.result.startsWith("0F-1F")) : false;
        const isDraw = match.result ? match.result.startsWith("1/2-1/2") : false;
        const wRes = isWhiteWin ? "1" : isDraw ? "½" : isBlackWin ? "0" : "";
        const bRes = isBlackWin ? "1" : isDraw ? "½" : isWhiteWin ? "0" : "";

        printWindow.document.write(
          `<tr>
            <td style="text-align: center;">${formatBoardNumber(match.board, tournamentConfig?.boardNumbering)}</td>
            <td style="text-align: center;">${wRes}</td>
            <td style="text-align: left;">${whiteLabel}</td>
            <td style="text-align: center;">${bRes}</td>
            <td style="text-align: left;">${blackLabel}</td>
          </tr>`,
        );
      }

      // Append byes directly into the same table (only for the active round)
      const roundByes = filteredByes.filter((b: any) => b.round === round);
      if (tournament?.format === 'swiss' && roundByes.length > 0) {
        roundByes.forEach((bye) => {
          const whiteLabel = getFormattedPlayerLabel(bye.playerId, round);
          const points = bye.points === 1 ? "½" : bye.points === 2 ? "1" : "0";
          printWindow.document.write(
            `<tr>
              <td style="text-align: center;"></td>
              <td style="text-align: center;">${points}</td>
              <td style="text-align: left;">${whiteLabel}</td>
              <td style="text-align: center;"></td>
              <td style="text-align: left;">BYE</td>
            </tr>`
          );
        });
      }

      printWindow.document.write(`</tbody></table>`);
    }

    printWindow.document.write(`</body></html>`);
    printWindow.document.close();
    
    setTimeout(() => {
      printWindow.focus();
      printWindow.print();
    }, 500);
  }, [filteredByes, getPlayerObject, getPlayerRating, getPlayerPoints, hasPrintableMatches, pairingGroups, activeSection, selectedSectionLabel, tournament]);

  const handleDownloadPairings = useCallback(() => {
    if (!hasPrintableMatches || typeof window === "undefined") return;
    const rows: string[][] = [["Round", "Board", "White", "Black", "Result"]];

    pairingGroups.forEach(({ round, matches }) => {
      matches.forEach((match) => {
        rows.push([
          String(round),
          formatBoardNumber(match.board, tournamentConfig?.boardNumbering),
          getPlayerName(match.whitePlayerId),
          match.blackPlayerId ? getPlayerName(match.blackPlayerId) : "Bye",
          match.result ?? "",
        ]);
      });
    });

    if (tournament?.format === 'swiss' && filteredByes.length > 0) {
      filteredByes.forEach((bye) => {
        rows.push([
          String(currentRound),
          "",
          getPlayerName(bye.playerId),
          "Bye",
          bye.byeType ?? "Bye",
        ]);
      });
    }

    const csv = rows
      .map((row) =>
        row
          .map((value) => {
            const safe = value.replace(/"/g, '""');
            return `"${safe}"`;
          })
          .join(","),
      )
      .join("\r\n");

    const sectionSlug = activeSection === "all"
      ? "all-sections"
      : selectedSectionLabel.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "section";
    const baseName = (tournament?.name ?? "tournament").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "event";
    const roundLabel = tournament?.format === 'swiss' ? `round-${currentRound}` : "all-rounds";
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${baseName}-pairings-${roundLabel}-${sectionSlug}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [currentRound, filteredByes, getPlayerName, hasPrintableMatches, pairingGroups, activeSection, selectedSectionLabel, tournament?.format, tournament?.name]);

  const handleResultChange = (matchId: number, result: string) => {
    if (!isEditMode) return;
    // In edit mode, store pending result locally
    setPendingResults(prev => ({ ...prev, [matchId]: result }));
  };

  // Get the effective result for a match (pending override or actual)
  const getEffectiveResult = (match: Match): string | null => {
    if (isEditMode && pendingResults[match.id] !== undefined) {
      return pendingResults[match.id];
    }
    return match.result ?? null;
  };

  // Handle single click on white or black cell (draw gesture: click both sides once)
  const handleResultCellClick = (matchId: number, side: 'white' | 'black') => {
    if (!isEditMode) return;
    setClickState(prev => {
      const current = new Set(prev[matchId] ?? []);
      if (current.has(side)) {
        // Clicking same side again - deselect
        current.delete(side);
        return { ...prev, [matchId]: current };
      }
      current.add(side);
      if (current.has('white') && current.has('black')) {
        // Both sides clicked - set draw
        handleResultChange(matchId, '1/2-1/2');
        return { ...prev, [matchId]: new Set() };
      }
      return { ...prev, [matchId]: current };
    });
  };

  // Handle double click on white or black cell (win/draw editing flow)
  const handleResultCellDoubleClick = (matchId: number, side: 'white' | 'black') => {
    if (!isEditMode) return;
    // Clear click state for this match
    setClickState(prev => ({ ...prev, [matchId]: new Set() }));
    const currentEffective = pendingResults[matchId] ?? allMatches?.find(m => m.id === matchId)?.result ?? null;

    if (side === 'white') {
      if (currentEffective === '1-0' || currentEffective === '1F-0F') {
        // Double-clicking the winning side again clears it back to Pending
        handleResultChange(matchId, 'Pending');
      } else if (currentEffective === '0-1' || currentEffective === '0F-1F') {
        // If it's currently a Black win, double-clicking the White box transitions it to a Draw
        handleResultChange(matchId, '1/2-1/2');
      } else {
        // If it is Pending or a Draw, double-clicking White sets it to a White Win
        handleResultChange(matchId, '1-0');
      }
    } else { // side === 'black'
      if (currentEffective === '0-1' || currentEffective === '0F-1F') {
        // Double-clicking the winning side again clears it back to Pending
        handleResultChange(matchId, 'Pending');
      } else if (currentEffective === '1-0' || currentEffective === '1F-0F') {
        // If it's currently a White win, double-clicking the Black box transitions it to a Draw
        handleResultChange(matchId, '1/2-1/2');
      } else {
        // If it is Pending or a Draw, double-clicking Black sets it to a Black Win
        handleResultChange(matchId, '0-1');
      }
    }
  };

  // Save all pending results to server
  const handleSaveResults = async () => {
    const entries = Object.entries(pendingResults);
    if (entries.length === 0) {
      setIsEditMode(false);
      return;
    }
    try {
      await Promise.all(entries.map(([matchId, result]) =>
        apiRequest(`/api/matches/${matchId}`, {
          method: 'PUT',
          body: JSON.stringify({
            result,
            status: result === 'Pending' ? 'pending' : 'completed',
          }),
        })
      ));
      queryClient.invalidateQueries({ queryKey: [`/api/tournaments/${tournamentId}`] });
      queryClient.invalidateQueries({ queryKey: [`/api/tournaments/${tournamentId}/matches`] });
      queryClient.invalidateQueries({ queryKey: [`/api/tournaments/${tournamentId}/pairings`] });
      queryClient.invalidateQueries({ queryKey: [`/api/tournaments/${tournamentId}/players`] });
      queryClient.invalidateQueries({ queryKey: [`/api/standings/${tournamentId}`] });
      toast({ title: 'Results Saved', description: `${entries.length} result(s) saved successfully.` });
      setPendingResults({});
      setClickState({});
      setIsEditMode(false);
    } catch {
      toast({ title: 'Error', description: 'Failed to save results.', variant: 'destructive' });
    }
  };

  const handleCancelEdit = () => {
    setPendingResults({});
    setClickState({});
    setIsEditMode(false);
  };

  useImperativeHandle(ref, () => ({
    save: handleSaveResults,
    cancel: handleCancelEdit,
    openScan: () => {
      setScanDialogOpen(true);
      startCamera();
    }
  }));

  // Webcam helpers
  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
      }
      setIsCameraActive(true);
      setCapturedImage(null);
    } catch (err) {
      toast({ title: 'Camera Error', description: 'Could not access camera. Please allow camera permission.', variant: 'destructive' });
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    setIsCameraActive(false);
  };

  const capturePhoto = () => {
    if (!videoRef.current || !canvasRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.95);
    setCapturedImage(dataUrl);
    stopCamera();
  };

  const handleCloseScanDialog = () => {
    stopCamera();
    setScanDialogOpen(false);
    setCapturedImage(null);
    setIsOcrProcessing(false);
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      if (event.target?.result) {
        setCapturedImage(event.target.result as string);
        stopCamera();
      }
    };
    reader.readAsDataURL(file);
  };

  // Normalize OCR character confusions
  const normalizeOcrChar = (ch: string): string => {
    const map: Record<string, string> = {
      'l': '1', 'I': '1', '|': '1', '!': '1',
      'O': '0', 'Q': '0', 'o': '0',
      'S': '5', 's': '5',
      'B': '8', 'Z': '2', 'z': '2',
    };
    return map[ch] ?? ch;
  };

  const normalizeResultToken = (token: string): string | null => {
    if (!token) return null;
    const t = token.trim().toLowerCase().replace(/^[^a-z0-9½]+|[^a-z0-9½]+$/g, '');
    if (t === '1' || t === 'l' || t === 'i' || t === '|' || t === '!') return '1';
    if (t === '0' || t === 'o' || t === 'q') return '0';
    if (t === '1/2' || t === '½' || t === '12' || t === '1/' || t === '/2' || t === 'draw' || t === '0.5' || t === '05') return '0.5';
    return null;
  };

  const parseOcrResults = (text: string): PendingResultsMap => {
    const results: PendingResultsMap = {};
    const roundMatches = matchesForStatus;
    if (!roundMatches || roundMatches.length === 0) return results;

    const lines = text.split(/\r?\n/);

    for (const line of lines) {
      // Split the line by the closing parenthesis of the White player
      const parts = line.split(')');
      if (parts.length < 2) continue;

      const tokens1 = parts[0].trim().split(/\s+/);
      if (tokens1.length < 2) continue;

      let boardNum: number | null = null;
      let whiteResult: string | null = null;
      let boardTokenIndex = -1;

      // Find the board number token
      for (let i = 0; i < tokens1.length; i++) {
        const token = tokens1[i];
        const parsedInt = parseInt(token);
        if (!isNaN(parsedInt) && parsedInt >= 1 && parsedInt <= roundMatches.length) {
          boardNum = parsedInt;
          boardTokenIndex = i;
          break;
        }
      }

      // If no board token was found directly, check if any token starts with the board number (e.g., "11" -> board 1, result 1)
      if (boardTokenIndex === -1) {
        for (let i = 0; i < tokens1.length; i++) {
          const token = tokens1[i];
          for (let b = 1; b <= roundMatches.length; b++) {
            const bStr = b.toString();
            if (token.startsWith(bStr)) {
              const rest = token.slice(bStr.length);
              const normRest = normalizeResultToken(rest);
              if (normRest !== null) {
                boardNum = b;
                whiteResult = normRest;
                boardTokenIndex = i;
                break;
              }
            }
          }
          if (boardNum !== null) break;
        }
      }

      // If we found a separate board number token, the next token is the result
      if (boardTokenIndex !== -1 && whiteResult === null && boardTokenIndex + 1 < tokens1.length) {
        whiteResult = normalizeResultToken(tokens1[boardTokenIndex + 1]);
      }

      // Parse the black result from the second part (after the White player)
      const tokens2 = parts[1].trim().split(/\s+/);
      let blackResult: string | null = null;
      for (let i = 0; i < Math.min(tokens2.length, 3); i++) {
        const norm = normalizeResultToken(tokens2[i]);
        if (norm !== null) {
          blackResult = norm;
          break;
        }
      }

      if (boardNum !== null && whiteResult !== null && blackResult !== null) {
        // Validate result pair consistency
        let finalResult: string | null = null;
        if (whiteResult === '1' && blackResult === '0') finalResult = '1-0';
        else if (whiteResult === '0' && blackResult === '1') finalResult = '0-1';
        else if (whiteResult === '0.5' && blackResult === '0.5') finalResult = '1/2-1/2';

        if (finalResult !== null) {
          const match = roundMatches.find(m => m.board === boardNum);
          if (match) {
            results[match.id] = finalResult;
          }
        }
      }
    }
    return results;
  };

  const handleOcrScan = async () => {
    if (!capturedImage) return;
    setIsOcrProcessing(true);
    try {
      // Dynamically load Tesseract.js
      const Tesseract = await import('tesseract.js');
      const { data: { text } } = await Tesseract.recognize(capturedImage, 'eng', {
        logger: () => {},
      });
      const parsed = parseOcrResults(text);
      if (Object.keys(parsed).length === 0) {
        toast({ title: 'No Results Found', description: 'Could not detect any results from the image. Try again with better lighting.', variant: 'destructive' });
      } else {
        setPendingResults(prev => ({ ...prev, ...parsed }));
        toast({ title: 'Scan Complete', description: `Detected ${Object.keys(parsed).length} result(s). Review and save.` });
        handleCloseScanDialog();
      }
    } catch (err) {
      toast({ title: 'OCR Error', description: 'Failed to process image.', variant: 'destructive' });
    } finally {
      setIsOcrProcessing(false);
    }
  };

  // Player selection handlers
  const handlePlayerClick = (playerId: number, matchId: number, color: 'white' | 'black', playerName: string) => {
    if (!isOwner || !playerId) return;

    const playerInfo = { playerId, matchId, color, playerName };

    // Check if this player is already selected
    const existingIndex = selectedPlayers.findIndex(p =>
      p.playerId === playerId && p.matchId === matchId && p.color === color
    );

    if (existingIndex >= 0) {
      // Deselect the player
      setSelectedPlayers(prev => prev.filter((_, i) => i !== existingIndex));
      return;
    }

    if (selectedPlayers.length === 0) {
      // First player selection
      setSelectedPlayers([playerInfo]);
    } else if (selectedPlayers.length === 1) {
      // Second player selection - execute swap
      const firstPlayer = selectedPlayers[0];

      // Don't swap with self
      if (firstPlayer.playerId === playerId && firstPlayer.matchId === matchId && firstPlayer.color === color) {
        return;
      }

      // Execute the swap
      swapPlayersMutation.mutate({
        match1Id: firstPlayer.matchId,
        match2Id: matchId,
        player1Id: firstPlayer.playerId,
        player2Id: playerId,
        color1: firstPlayer.color,
        color2: color,
      });

      // Clear selections
      setSelectedPlayers([]);
    } else {
      // Reset to just this player if somehow more than 2 are selected
      setSelectedPlayers([playerInfo]);
    }
  };

  const handleEditModePlayerClick = (matchId: number, side: 'white' | 'black') => {
    if (!isOwner) return;

    if (drawClickState === null) {
      setDrawClickState({ matchId, side });
    } else if (drawClickState.matchId === matchId) {
      if (drawClickState.side === side) {
        setDrawClickState(null); // Clicked same player - deselect
      } else {
        // Clicked other side of same match - enter draw!
        handleResultChange(matchId, "1/2-1/2");
        setDrawClickState(null);
      }
    } else {
      // Clicked player on different match - set as new draw selection
      setDrawClickState({ matchId, side });
    }
  };
  

  const confirmResultChange = () => {
    if (pendingResultChange) {
      setPendingResults(prev => ({
        ...prev,
        [pendingResultChange.matchId]: pendingResultChange.result
      }));
      setPendingResultChange(null);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'completed':
        return <Badge variant="default" className="bg-green-100 text-green-800">Completed</Badge>;
      case 'in_progress':
        return <Badge variant="default" className="bg-slate-100 text-slate-800">In Progress</Badge>;
      default:
        return <Badge variant="secondary">Pending</Badge>;
    }
  };

  // CaissaChess Player formatting helper
  const formatPlayerNameWithDetails = (playerId: number | null, beforeRound: number, alignRight: boolean = false) => {
    if (!playerId) return <span className="text-slate-400 dark:text-slate-500 italic">Bye</span>;
    const player = getPlayerObject(playerId);
    if (!player) return <span className="text-slate-400 dark:text-slate-500">Unknown</span>;
    
    const rating = getPlayerRating(playerId);
    const points = getPlayerPoints(playerId, beforeRound);
    const pointsStr = formatPointsWithFractions(points);
    
    const nameStr = player.lastName && player.firstName
      ? `${player.lastName}, ${player.firstName}`
      : `${player.firstName} ${player.lastName}`.trim();
      
    if (alignRight) {
      return (
        <div className="flex items-center justify-end gap-1.5 text-sm">
          <span className="text-sm text-slate-500 dark:text-slate-400 font-normal font-mono">
            ({rating})
          </span>
          <span className="text-sm text-indigo-600 dark:text-indigo-400 font-semibold font-mono">
            [{pointsStr}]
          </span>
          <span className="text-slate-800 dark:text-slate-100 font-semibold truncate max-w-[200px]" title={nameStr}>
            {nameStr}
          </span>
        </div>
      );
    } else {
      return (
        <div className="flex items-center justify-start gap-1.5 text-sm">
          <span className="text-slate-800 dark:text-slate-100 font-semibold truncate max-w-[200px]" title={nameStr}>
            {nameStr}
          </span>
          <span className="text-sm text-indigo-600 dark:text-indigo-400 font-semibold font-mono">
            [{pointsStr}]
          </span>
          <span className="text-sm text-slate-500 dark:text-slate-400 font-normal font-mono">
            ({rating})
          </span>
        </div>
      );
    }
  };

  // CaissaChess TD click-to-set result helper
  const renderTdResultCells = (match: Match) => {
    const currentRes = pendingResults[match.id] !== undefined ? pendingResults[match.id] : match.result;
    const isWhiteWin = currentRes ? (currentRes.startsWith("1-0") || currentRes.startsWith("1F-0F")) : false;
    const isBlackWin = currentRes ? (currentRes.startsWith("0-1") || currentRes.startsWith("0F-1F")) : false;
    const isDraw = currentRes ? currentRes.startsWith("1/2-1/2") : false;
    const isPending = !currentRes || currentRes === "Pending";
    const hasUnsavedChange = pendingResults[match.id] !== undefined;

    const whiteClicked = isEditMode && (clickState[match.id]?.has('white') ?? false);
    const blackClicked = isEditMode && (clickState[match.id]?.has('black') ?? false);

    const renderCell = (role: 'white' | 'black') => {
      const isWhite = role === 'white';
      const clicked = isWhite ? whiteClicked : blackClicked;
      const isWinner = isWhite ? isWhiteWin : isBlackWin;
      const isLoser = isWhite ? isBlackWin : isWhiteWin;

      let displayValue = "—";
      let textClass = hasUnsavedChange ? "text-amber-600" : "text-slate-300 dark:text-slate-600";

      if (isWinner) {
        displayValue = (currentRes === "1F-0F" && isWhite) || (currentRes === "0F-1F" && !isWhite) ? "1F" : "1";
        textClass = "text-emerald-600 dark:text-emerald-400 font-extrabold text-sm";
      } else if (isLoser) {
        displayValue = (currentRes === "1F-0F" && !isWhite) || (currentRes === "0F-1F" && isWhite) ? "0F" : "0";
        textClass = "text-slate-400 dark:text-slate-550 font-medium text-sm";
      } else if (isDraw) {
        displayValue = "½";
        textClass = "text-slate-600 dark:text-slate-400 font-extrabold text-sm";
      }

      if (isEditMode && isOwner) {
        let bgBorderClass = "border-slate-200 dark:border-slate-800";
        if (isWinner) {
          bgBorderClass = "bg-emerald-50 dark:bg-emerald-950/20 border-emerald-500";
        } else if (isLoser) {
          bgBorderClass = "border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/10";
        } else if (isDraw) {
          bgBorderClass = "bg-slate-50 dark:bg-slate-900/30 border-slate-300 dark:border-slate-700";
        }

        return (
          <button
            type="button"
            onClick={() => handleResultCellClick(match.id, role)}
            onDoubleClick={() => handleResultCellDoubleClick(match.id, role)}
            className={cn(
              "w-8 h-8 flex items-center justify-center rounded-lg border transition-all cursor-pointer hover:bg-indigo-50 dark:hover:bg-indigo-950/30",
              textClass,
              bgBorderClass,
              clicked && "bg-amber-100/60 dark:bg-amber-900/20 border-amber-500",
              hasUnsavedChange && !clicked && !isWinner && !isLoser && !isDraw && "bg-amber-50 dark:bg-amber-950/10 border-amber-350"
            )}
            title={isWhite ? "Double-click to set White Win; click both sides once for Draw" : "Double-click to set Black Win; click both sides once for Draw"}
          >
            {displayValue}
          </button>
        );
      } else {
        return (
          <span className={cn(
            isPending ? "font-bold text-base select-none px-1.5 py-0.5 rounded" : "text-sm font-black select-none px-1.5 py-0.5 rounded",
            textClass,
            hasUnsavedChange ? "bg-amber-100/60 dark:bg-amber-950/30 border border-amber-300/50" : ""
          )}>
            {displayValue}
          </span>
        );
      }
    };

    return {
      whiteResultCell: renderCell('white'),
      blackResultCell: renderCell('black')
    };
  };

  // CaissaChess pairing row renderer
  const renderPairingRow = (match: Match, isExtra: boolean = false) => {
    const whiteName = getPlayerName(match.whitePlayerId);
    const blackName = match.blackPlayerId ? getPlayerName(match.blackPlayerId) : "Bye";
    
    const currentRes = pendingResults[match.id] !== undefined ? pendingResults[match.id] : match.result;
    const isWhiteWin = currentRes ? (currentRes.startsWith("1-0") || currentRes.startsWith("1F-0F")) : false;
    const isBlackWin = currentRes ? (currentRes.startsWith("0-1") || currentRes.startsWith("0F-1F")) : false;
    const isDraw = currentRes ? currentRes.startsWith("1/2-1/2") : false;
    const hasUnsavedChange = pendingResults[match.id] !== undefined;

    const isWhiteSelected = selectedPlayers.some(p => p.playerId === match.whitePlayerId && p.matchId === match.id && p.color === 'white');
    const isBlackSelected = selectedPlayers.some(p => p.playerId === match.blackPlayerId && p.matchId === match.id && p.color === 'black');

    const isWhiteDrawSelected = drawClickState?.matchId === match.id && drawClickState?.side === 'white';
    const isBlackDrawSelected = drawClickState?.matchId === match.id && drawClickState?.side === 'black';

    const handleWhiteCellDoubleClick = () => {
      if (isEditMode && isOwner && match.whitePlayerId) {
        if (currentRes === "1-0") {
          handleResultChange(match.id, "Pending");
        } else {
          handleResultChange(match.id, "1-0");
        }
        setDrawClickState(null);
      }
    };

    const handleBlackCellDoubleClick = () => {
      if (isEditMode && isOwner && match.blackPlayerId) {
        if (currentRes === "0-1") {
          handleResultChange(match.id, "Pending");
        } else {
          handleResultChange(match.id, "0-1");
        }
        setDrawClickState(null);
      }
    };

    const handleWhiteCellClick = () => {
      if (isEditMode) {
        if (match.whitePlayerId && isOwner) {
          handleEditModePlayerClick(match.id, 'white');
        }
      } else {
        if (match.whitePlayerId && isOwner) {
          handlePlayerClick(match.whitePlayerId, match.id, 'white', whiteName);
        }
      }
    };

    const handleBlackCellClick = () => {
      if (isEditMode) {
        if (match.blackPlayerId && isOwner) {
          handleEditModePlayerClick(match.id, 'black');
        }
      } else {
        if (match.blackPlayerId && isOwner) {
          handlePlayerClick(match.blackPlayerId, match.id, 'black', blackName);
        }
      }
    };

    // TD View
    if (isTournamentDirector) {
      const { whiteResultCell, blackResultCell } = renderTdResultCells(match);
      return (
        <tr key={match.id} className={cn(
          "group hover:bg-indigo-50/25 dark:hover:bg-indigo-950/15 transition-colors border-b last:border-0",
          hasUnsavedChange ? "bg-amber-50/40 dark:bg-amber-950/10 border-amber-250 dark:border-amber-900" : "border-slate-200 dark:border-slate-800"
        )}>
          <td className="px-3 py-3 text-center border border-slate-200 dark:border-slate-800 font-mono text-sm font-bold text-slate-500 dark:text-slate-400 bg-slate-50/50 dark:bg-slate-900/20 w-14">
            {isExtra ? "Extra" : formatBoardNumber(match.board, tournamentConfig?.boardNumbering)}
          </td>
          <td className="px-2 py-2 border border-slate-200 dark:border-slate-800 text-center bg-slate-50/10 dark:bg-slate-900/5 w-16">
            {whiteResultCell}
          </td>
          <td 
            className={cn(
              "px-4 py-2 border border-slate-200 dark:border-slate-800 select-none text-left transition-all",
              (!isEditMode && isOwner && match.whitePlayerId) ? "cursor-pointer hover:bg-blue-50/30 dark:hover:bg-blue-950/10" : "",
              (!isEditMode && isWhiteSelected) ? "bg-blue-50 dark:bg-blue-950/30 border-blue-300" : "",
              (!isEditMode && isWhiteDrawSelected) ? "bg-violet-50 dark:bg-violet-950/30 border-violet-400 border-dashed" : ""
            )}
            onClick={!isEditMode ? handleWhiteCellClick : undefined}
            onDoubleClick={undefined}
            title={(!isEditMode && isOwner) ? "Click to select for swap" : ""}
          >
            {formatPlayerNameWithDetails(match.whitePlayerId, match.round, false)}
          </td>
          <td 
            className={cn(
              "px-4 py-2 border border-slate-200 dark:border-slate-800 select-none text-right transition-all",
              (!isEditMode && isOwner && match.blackPlayerId) ? "cursor-pointer hover:bg-blue-50/30 dark:hover:bg-blue-950/10" : "",
              (!isEditMode && isBlackSelected) ? "bg-blue-50 dark:bg-blue-950/30 border-blue-300" : "",
              (!isEditMode && isBlackDrawSelected) ? "bg-violet-50 dark:bg-violet-950/30 border-violet-400 border-dashed" : ""
            )}
            onClick={!isEditMode ? handleBlackCellClick : undefined}
            onDoubleClick={undefined}
            title={(!isEditMode && isOwner) ? "Click to select for swap" : ""}
          >
            {formatPlayerNameWithDetails(match.blackPlayerId, match.round, true)}
          </td>
          <td className="px-2 py-2 border border-slate-200 dark:border-slate-800 text-center bg-slate-50/10 dark:bg-slate-900/5 w-16">
            {blackResultCell}
          </td>
        </tr>
      );
    }

    // Player View
    const wRes = isWhiteWin ? "1" : isDraw ? "½" : isBlackWin ? "0" : "—";
    const bRes = isBlackWin ? "1" : isDraw ? "½" : isWhiteWin ? "0" : "—";
    const wResClass = isWhiteWin ? "text-emerald-600 dark:text-emerald-400 font-bold" : isDraw ? "text-slate-500" : "text-slate-400";
    const bResClass = isBlackWin ? "text-emerald-600 dark:text-emerald-400 font-bold" : isDraw ? "text-slate-500" : "text-slate-400";

    return (
      <tr key={match.id} className="group hover:bg-indigo-50/25 dark:hover:bg-indigo-950/15 transition-colors border-b border-slate-200 dark:border-slate-800 last:border-0">
        <td className="px-3 py-3 text-center border border-slate-200 dark:border-slate-800 font-mono text-sm font-bold text-slate-500 dark:text-slate-400 bg-slate-50/50 dark:bg-slate-900/20 w-14">
          {isExtra ? "Extra" : formatBoardNumber(match.board, tournamentConfig?.boardNumbering)}
        </td>
        <td className={cn("px-3 py-2 border border-slate-200 dark:border-slate-800 text-center bg-slate-50/10 dark:bg-slate-900/5 w-16 text-sm font-black select-none", wResClass)}>
          {wRes}
        </td>
        <td className="px-4 py-2 border border-slate-200 dark:border-slate-800 text-left">
          {formatPlayerNameWithDetails(match.whitePlayerId, match.round, false)}
        </td>
        <td className="px-4 py-2 border border-slate-200 dark:border-slate-800 text-right">
          {formatPlayerNameWithDetails(match.blackPlayerId, match.round, true)}
        </td>
        <td className={cn("px-3 py-2 border border-slate-200 dark:border-slate-800 text-center bg-slate-50/10 dark:bg-slate-900/5 w-16 text-sm font-black select-none", bResClass)}>
          {bRes}
        </td>
      </tr>
    );
  };

  // CaissaChess bye row renderer
  const renderByeRow = (bye: Pairing) => {
    const byePointsDisplay = bye.byeType === 'half_point' || bye.points === 1 ? '½' :
                             bye.byeType === 'zero_point' || bye.points === 0 ? '0' : '1';

    const byeLabel = bye.isRequested ? 'Requested Bye' : 'Unpaired';
    const byeTypeLabel = bye.byeType === 'half_point' ? '½ Pt Bye' :
                         bye.byeType === 'zero_point' ? '0 Pt Bye' : '1 Pt Bye';

    // TD View
    if (isTournamentDirector) {
      return (
        <tr key={`bye-${bye.id}`} className="group hover:bg-indigo-50/25 dark:hover:bg-indigo-950/15 transition-colors border-b border-slate-200 dark:border-slate-800 last:border-0">
          <td className="px-3 py-3 text-center border border-slate-200 dark:border-slate-800 font-mono text-sm font-bold text-slate-400 bg-slate-50/50 dark:bg-slate-900/20 w-14">
            —
          </td>
          <td className="px-2 py-2 border border-slate-200 dark:border-slate-800 text-center bg-slate-50/10 dark:bg-slate-900/5 w-16">
            <span className="text-sm font-bold text-indigo-650 dark:text-indigo-400 font-mono">
              {byePointsDisplay}
            </span>
          </td>
          <td className="px-4 py-2 border border-slate-200 dark:border-slate-800 text-left">
            {formatPlayerNameWithDetails(bye.playerId, bye.round, false)}
          </td>
          <td className="px-4 py-2 border border-slate-200 dark:border-slate-800 text-right italic text-slate-400 dark:text-slate-550 font-semibold text-sm">
            <span className="mr-2 text-xs font-mono bg-slate-100 dark:bg-slate-800 text-slate-650 dark:text-slate-400 px-1.5 py-0.5 rounded not-italic">{byeTypeLabel}</span>
            {byeLabel}
          </td>
          <td className="px-2 py-2 border border-slate-200 dark:border-slate-800 text-center bg-slate-50/10 dark:bg-slate-900/5 w-16">
            <span className="text-slate-350 dark:text-slate-700">—</span>
          </td>
        </tr>
      );
    }

    // Player View
    return (
      <tr key={`bye-${bye.id}`} className="group hover:bg-indigo-50/25 dark:hover:bg-indigo-950/15 transition-colors border-b border-slate-200 dark:border-slate-800 last:border-0">
        <td className="px-3 py-3 text-center border border-slate-200 dark:border-slate-800 font-mono text-sm font-bold text-slate-400 bg-slate-50/50 dark:bg-slate-900/20 w-14">
          —
        </td>
        <td className="px-3 py-2 border border-slate-200 dark:border-slate-800 text-center bg-slate-50/10 dark:bg-slate-900/5 w-16">
          <span className="text-sm font-bold text-indigo-650 dark:text-indigo-400 font-mono">
            {byePointsDisplay}
          </span>
        </td>
        <td className="px-4 py-2 border border-slate-200 dark:border-slate-800 text-left">
          {formatPlayerNameWithDetails(bye.playerId, bye.round, false)}
        </td>
        <td className="px-4 py-2 border border-slate-200 dark:border-slate-800 text-right italic text-slate-450 dark:text-slate-500 font-semibold text-sm">
          {byeLabel}
        </td>
        <td className="px-3 py-2 border border-slate-200 dark:border-slate-800 text-center bg-slate-50/10 dark:bg-slate-900/5 w-16">
          <span className="text-slate-350 dark:text-slate-700">—</span>
        </td>
      </tr>
    );
  };

  const renderPairingsTable = (tableMatches: Match[], tableByes: Pairing[], sectionLabel?: string) => {
    if (tableMatches.length === 0 && tableByes.length === 0) {
      return (
        <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          No pairings or byes {sectionLabel ? `for ${sectionLabel} ` : ""}in Round {currentRound}.
        </div>
      );
    }
    return (
      <div className="overflow-x-auto border border-black p-1 bg-white">
        <table style={{ borderCollapse: 'collapse', border: '1px solid black', width: '100%', fontFamily: 'Arial, sans-serif', fontSize: '14px', color: '#000', backgroundColor: '#fff' }}>
          <thead>
            <tr style={{ border: '1px solid black', backgroundColor: '#e8e8e8' }}>
              <th style={{ border: '1px solid black', padding: '6px 8px', color: '#000', backgroundColor: '#e8e8e8', fontWeight: 'bold', fontSize: '14px', textAlign: 'center', width: '56px' }}>Bd</th>
              <th style={{ border: '1px solid black', padding: '6px 8px', color: '#000', backgroundColor: '#e8e8e8', fontWeight: 'bold', fontSize: '14px', textAlign: 'center', width: '64px' }}>Res</th>
              <th style={{ border: '1px solid black', padding: '6px 8px', color: '#000', backgroundColor: '#e8e8e8', fontWeight: 'bold', fontSize: '14px', textAlign: 'left' }}>White</th>
              <th style={{ border: '1px solid black', padding: '6px 8px', color: '#000', backgroundColor: '#e8e8e8', fontWeight: 'bold', fontSize: '14px', textAlign: 'center', width: '64px' }}>Res</th>
              <th style={{ border: '1px solid black', padding: '6px 8px', color: '#000', backgroundColor: '#e8e8e8', fontWeight: 'bold', fontSize: '14px', textAlign: 'left' }}>Black</th>
              {isOwner && <th style={{ border: '1px solid black', padding: '6px 8px', color: '#000', backgroundColor: '#e8e8e8', fontWeight: 'bold', fontSize: '14px', textAlign: 'center', width: '60px' }}>Action</th>}
            </tr>
          </thead>
          <tbody>
            {tableMatches.map((match) => {
              const whiteName = getPlayerName(match.whitePlayerId);
              const whiteRating = getPlayerRating(match.whitePlayerId);
              const blackName = match.blackPlayerId ? getPlayerName(match.blackPlayerId) : "Bye";
              const blackRating = match.blackPlayerId ? getPlayerRating(match.blackPlayerId) : 0;
              
              const effectiveResult = getEffectiveResult(match);
              const isPending = pendingResults[match.id] !== undefined;
              const isWhiteWin = effectiveResult ? (effectiveResult.startsWith("1-0") || effectiveResult.startsWith("1F-0F")) : false;
              const isBlackWin = effectiveResult ? (effectiveResult.startsWith("0-1") || effectiveResult.startsWith("0F-1F")) : false;
              const isDraw = effectiveResult ? effectiveResult.startsWith("1/2-1/2") : false;
              
              const whitePoints = getPlayerPoints(match.whitePlayerId, currentRound);
              const whitePointsStr = formatPointsWithFractions(whitePoints);
              const blackPoints = match.blackPlayerId ? getPlayerPoints(match.blackPlayerId, currentRound) : 0;
              const blackPointsStr = formatPointsWithFractions(blackPoints);
              
              const whiteClicked = isEditMode && (clickState[match.id]?.has('white') ?? false);
              const blackClicked = isEditMode && (clickState[match.id]?.has('black') ?? false);

              const isWhiteSelected = selectedPlayers.some(p => p.playerId === match.whitePlayerId && p.matchId === match.id);
              const isBlackSelected = match.blackPlayerId ? selectedPlayers.some(p => p.playerId === match.blackPlayerId && p.matchId === match.id) : false;

              return (
                <tr
                  key={match.id}
                  style={{
                    border: '1px solid black',
                    backgroundColor: isPending ? '#fff9e6' : '#fff',
                    color: '#000'
                  }}
                >
                  <td style={{ border: '1px solid black', padding: '6px 8px', color: '#000', textAlign: 'center', fontWeight: 'bold', fontSize: '14px', width: '56px', backgroundColor: '#f5f5f5' }}>
                    {match.board}
                  </td>
                  <td
                    style={{
                      border: '1px solid black',
                      padding: '6px 8px',
                      color: whiteClicked ? '#854d0e' : '#000',
                      backgroundColor: whiteClicked ? '#fef3c7' : '#fff',
                      textAlign: 'center',
                      cursor: isEditMode ? 'pointer' : 'default',
                      fontWeight: 'bold',
                      fontSize: '14px',
                      width: '64px',
                      userSelect: 'none'
                    }}
                    onClick={() => isEditMode && handleResultCellClick(match.id, 'white')}
                    onDoubleClick={() => isEditMode && handleResultCellDoubleClick(match.id, 'white')}
                    title={isEditMode ? "Double-click to set White Win; click both sides once for Draw" : ""}
                  >
                    <div className="flex items-center justify-center">
                      {isWhiteWin ? "1" : isDraw ? "½" : isBlackWin ? "0" : ""}
                    </div>
                  </td>
                  <td
                    style={{
                      border: '1px solid black',
                      padding: '6px 8px',
                      color: isWhiteSelected ? '#1e3a8a' : '#000',
                      backgroundColor: isWhiteSelected ? '#dbeafe' : 'transparent',
                      textAlign: 'left',
                      cursor: (!isEditMode && match.whitePlayerId && isOwner) ? 'pointer' : 'default',
                      userSelect: 'none'
                    }}
                    onClick={() => {
                      if (!isEditMode && match.whitePlayerId && isOwner) {
                        handlePlayerClick(match.whitePlayerId, match.id, 'white', whiteName);
                      }
                    }}
                    title={(!isEditMode && isOwner) ? "Click to select for swap" : ""}
                  >
                    <span style={{ fontWeight: 'bold', fontSize: '14px', color: isWhiteSelected ? '#1e3a8a' : '#000' }}>
                      {whiteName} <span style={{ fontSize: '14px', color: '#555', fontWeight: 'normal' }}>({whiteRating} {whitePointsStr})</span>
                    </span>
                  </td>
                  <td
                    style={{
                      border: '1px solid black',
                      padding: '6px 8px',
                      color: blackClicked ? '#854d0e' : '#000',
                      backgroundColor: blackClicked ? '#fef3c7' : '#fff',
                      textAlign: 'center',
                      cursor: isEditMode ? 'pointer' : 'default',
                      fontWeight: 'bold',
                      fontSize: '14px',
                      width: '64px',
                      userSelect: 'none'
                    }}
                    onClick={() => isEditMode && handleResultCellClick(match.id, 'black')}
                    onDoubleClick={() => isEditMode && handleResultCellDoubleClick(match.id, 'black')}
                    title={isEditMode ? "Double-click to set Black Win; click both sides once for Draw" : ""}
                  >
                    <div className="flex items-center justify-center">
                      {isBlackWin ? "1" : isDraw ? "½" : isWhiteWin ? "0" : ""}
                    </div>
                  </td>
                  <td
                    style={{
                      border: '1px solid black',
                      padding: '6px 8px',
                      color: isBlackSelected ? '#1e3a8a' : '#000',
                      backgroundColor: isBlackSelected ? '#dbeafe' : 'transparent',
                      textAlign: 'left',
                      cursor: (!isEditMode && match.blackPlayerId && isOwner) ? 'pointer' : 'default',
                      userSelect: 'none'
                    }}
                    onClick={() => {
                      if (!isEditMode && match.blackPlayerId && isOwner) {
                        handlePlayerClick(match.blackPlayerId, match.id, 'black', blackName);
                      }
                    }}
                    title={(!isEditMode && isOwner) ? "Click to select for swap" : ""}
                  >
                    <span style={{ fontWeight: 'bold', fontSize: '14px', color: isBlackSelected ? '#1e3a8a' : '#000' }}>
                      {blackName} <span style={{ fontSize: '14px', color: '#555', fontWeight: 'normal' }}>({blackRating} {blackPointsStr})</span>
                    </span>
                  </td>
                  {isOwner && (
                    <td style={{ border: '1px solid black', padding: '4px', textAlign: 'center', width: '60px' }}>
                      {renderMatchActionsDropdown(match)}
                    </td>
                  )}
                </tr>
              );
            })}

            {tableByes.map((bye) => {
              const playerName = getPlayerName(bye.playerId);
              const playerRating = getPlayerRating(bye.playerId);
              const playerPoints = getPlayerPoints(bye.playerId, currentRound);
              const playerPointsStr = formatPointsWithFractions(playerPoints);
              const byePointsRaw = bye.points === 1 ? 0.5 : bye.points === 2 ? 1.0 : bye.points === 0 ? 0.0 : null;
              const byePointsDisplay = byePointsRaw !== null
                ? formatPointsWithFractions(byePointsRaw)
                : '';
              const byeLabel = bye.isRequested
                ? (bye.points === 0 ? 'Requested 0-Point Bye' : bye.points === 2 ? 'Requested 1-Point Bye' : 'Requested 1/2-Point Bye')
                : '1-Point Bye';

              return (
                <tr
                  key={`bye-${bye.id}`}
                  style={{
                    border: '1px solid black',
                    backgroundColor: '#fff',
                    color: '#000'
                  }}
                >
                  <td style={{ border: '1px solid black', padding: '6px 8px', color: '#000', textAlign: 'center', fontWeight: 'bold', fontSize: '14px', width: '56px', backgroundColor: '#f5f5f5' }}>
                    
                  </td>
                  <td style={{ border: '1px solid black', padding: '6px 8px', color: '#000', textAlign: 'center', fontWeight: 'bold', fontSize: '14px', width: '64px' }}>
                    <div className="flex items-center justify-center">
                      {byePointsDisplay}
                    </div>
                  </td>
                  <td style={{ border: '1px solid black', padding: '6px 8px', color: '#000', textAlign: 'left', fontWeight: 'bold', fontSize: '14px' }}>
                    <span>
                      {playerName} <span style={{ fontSize: '14px', color: '#555', fontWeight: 'normal' }}>({playerRating} {playerPointsStr})</span>
                    </span>
                  </td>
                  <td style={{ border: '1px solid black', padding: '6px 8px', color: '#000', textAlign: 'center', fontSize: '14px', width: '64px' }}>
                    
                  </td>
                  <td style={{ border: '1px solid black', padding: '6px 8px', color: '#555', textAlign: 'left', fontSize: '14px', fontStyle: 'italic' }}>
                    {byeLabel}
                  </td>
                  {isOwner && (
                    <td style={{ border: '1px solid black', padding: '6px 8px', width: '60px' }}>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h3 className="text-lg font-bold flex items-center gap-2 text-slate-900">
              <img src="/logo.png" alt="Logo" className="h-5 w-5 object-contain" />
              Round {currentRound} Pairings
            </h3>
            <p className="mt-1 text-sm text-gray-600">
              {tournament?.format === 'roundrobin' ? 'Round Robin - Complete Schedule' : 'Swiss System - USCF Tournament Rules'}
            </p>
          </div>
          <div className="flex flex-col items-end gap-3">
            {roundNumbers.length > 0 && (
              <div className="flex flex-col items-end gap-2">
                <div className="flex flex-wrap justify-end gap-2">
                  {roundNumbers.map((round) => {
                    const isCurrent = round === currentRound;
                    const isCompleted = round < currentRound;
                    const buttonClasses = `h-9 w-9 rounded-md border ${isCurrent
                      ? "bg-blue-50 text-blue-800 border-blue-200 hover:bg-blue-100"
                      : isCompleted
                        ? "bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100"
                        : "border-slate-200 text-slate-600 hover:bg-slate-50"
                      }`;
                    return (
                      <Button
                        key={`round-${round}`}
                        variant="outline"
                        size="icon"
                        className={buttonClasses}
                        onClick={() => setCurrentRound(round)}
                      >
                        {round}
                      </Button>
                    );
                  })}
                </div>
                <span className="text-xs text-muted-foreground">
                  Round {currentRound} of {roundNumbers[roundNumbers.length - 1]}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Controls Row */}
        <div className="flex flex-wrap items-center justify-between gap-4 border-t pt-4">
          <div className="flex items-center gap-2">
            {matchesForStatus.length > 0 ? (
              <>
                <div
                  className={`h-3 w-3 rounded-full ${matchesForStatus.every((m) => m.result && m.result !== 'Pending')
                    ? 'bg-green-500'
                    : matchesForStatus.some((m) => m.result && m.result !== 'Pending')
                      ? 'bg-slate-500'
                      : 'bg-red-500'
                    }`}
                />
                <span className="text-sm font-medium">
                  {matchesForStatus.filter((m) => m.result && m.result !== 'Pending').length} / {matchesForStatus.length} complete
                </span>
              </>
            ) : (
              <span className="text-sm text-gray-500">No pairings generated yet</span>
            )}
          </div>

          <div className="flex flex-wrap justify-end gap-2">
            {isOwner && isEditMode && (
              <span className="text-xs text-amber-600 font-semibold self-center bg-amber-50 border border-amber-200 px-2 py-1 rounded-md">
                Editing — double-click a result cell side to give them the win; click both sides once for a draw
              </span>
            )}
            {showExportControls ? (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handlePrintPairings}
                  disabled={!hasPrintableMatches}
                >
                  <Printer className="mr-2 h-4 w-4" />
                  Print
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleDownloadPairings}
                  disabled={!hasPrintableMatches}
                >
                  <Download className="mr-2 h-4 w-4" />
                  Download
                </Button>
              </>
            ) : null}

            {isOwner && (
              <>
                {tournament?.format === "roundrobin" && (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        variant="outline"
                        disabled={generatePairingsMutation.isPending}
                        className="border-purple-600 text-purple-600 hover:bg-purple-50"
                        size="sm"
                      >
                        <RefreshCw className="mr-1 h-4 w-4" />
                        {generatePairingsMutation.isPending ? "Regenerating..." : "Regenerate Schedule"}
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Regenerate Complete Round Robin Schedule?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This will delete and recreate all pairings for all rounds in the round-robin tournament. Existing match results will be lost.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => generatePairingsMutation.mutate({ regenerate: true })}
                          className="bg-purple-600 hover:bg-purple-700"
                        >
                          Regenerate All Rounds
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                )}

                {tournament?.format === "swiss" && (
                  <>
                    {tournament?.rounds && currentRound >= tournament.rounds ? (
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            disabled={generatePairingsMutation.isPending}
                            className="bg-green-600 hover:bg-green-700"
                            size="sm"
                          >
                            <Play className="mr-1 h-4 w-4" />
                            {generatePairingsMutation.isPending ? "Generating..." : `Generate Round ${currentRound + 1}`}
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Generate Round {currentRound + 1}?</AlertDialogTitle>
                            <AlertDialogDescription>
                              This will extend the tournament beyond the planned {tournament.rounds} rounds. Confirm all Round {currentRound} results first.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() => generatePairingsMutation.mutate({ regenerate: false })}
                              className="bg-green-600 hover:bg-green-700"
                            >
                              Generate Round {currentRound + 1}
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    ) : (
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            disabled={generatePairingsMutation.isPending}
                            className="bg-green-600 hover:bg-green-700"
                            size="sm"
                          >
                            <Play className="mr-1 h-4 w-4" />
                            {generatePairingsMutation.isPending ? "Generating..." : "Generate Next Round"}
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Generate Round {currentRound + 1}?</AlertDialogTitle>
                            <AlertDialogDescription>
                              This will create pairings for the next round. Ensure Round {currentRound} results are complete first.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() => generatePairingsMutation.mutate({ regenerate: false })}
                              className="bg-green-600 hover:bg-green-700"
                            >
                              Generate Round {currentRound + 1}
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    )}
                  </>
                )}

                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      variant="outline"
                      disabled={finishTournamentMutation.isPending}
                      className="border-blue-600 text-blue-600 hover:bg-blue-50"
                      size="sm"
                    >
                      <img src="/logo.png" alt="Logo" className="mr-1 h-4 w-4 object-contain" />
                      {finishTournamentMutation.isPending ? "Finishing..." : "Finish Tournament"}
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Finish Tournament Early?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Completing now will finalize standings through Round {currentRound}. This action cannot be undone.
                        <div className="mt-4 p-3 bg-slate-50 rounded-lg border border-slate-200">
                          <p className="text-sm font-bold text-slate-800 mb-2">Type "FINISH" to confirm:</p>
                          <input
                            type="text"
                            className="w-full h-10 px-3 rounded-md border border-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-black"
                            placeholder="Type FINISH"
                            onChange={(e) => setFinishConfirmation(e.target.value)}
                          />
                        </div>
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() => finishTournamentMutation.mutate()}
                        className="bg-blue-600 hover:bg-blue-700"
                        disabled={finishConfirmation !== "FINISH"}
                      >
                        Finish Tournament
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>

                {(tournament?.format === "swiss" || tournament?.format === "roundrobin") && (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        variant="outline"
                        disabled={generatePairingsMutation.isPending}
                        size="sm"
                      >
                        <RefreshCw className="mr-1 h-4 w-4" />
                        Repair
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Repair Round {currentRound} Pairings?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This will delete and recreate all pairings for Round {currentRound}. Any existing results will be cleared.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => generatePairingsMutation.mutate({ regenerate: true })}
                          className="bg-red-600 hover:bg-red-700"
                        >
                          Repair Round {currentRound}
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                )}

                {lastSwapState && (
                  <Button
                    variant="outline"
                    disabled={undoSwapMutation.isPending}
                    onClick={() => undoSwapMutation.mutate()}
                    size="sm"
                    className="border-blue-600 text-blue-600 hover:bg-blue-50"
                  >
                    <RotateCcw className="mr-1 h-4 w-4" />
                    {undoSwapMutation.isPending ? "Undoing..." : "Undo Swap"}
                  </Button>
                )}

                {false && (allMatches?.length || 0) > 0 && (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        variant="outline"
                        disabled={regenerateFutureRoundsMutation.isPending}
                        className="border-red-300 text-red-600 hover:bg-red-50"
                        size="sm"
                      >
                        <RefreshCw className="mr-1 h-4 w-4" />
                        {regenerateFutureRoundsMutation.isPending ? "Regenerating..." : `Regenerate Round ${currentRound + 1}+`}
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Regenerate Rounds {currentRound + 1}+?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This will rebuild future rounds based on results through Round {currentRound}. Existing future results will be lost.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => regenerateFutureRoundsMutation.mutate({ fromRound: currentRound + 1 })}
                          className="bg-red-600 hover:bg-red-700"
                        >
                          Regenerate Round {currentRound + 1}+
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                )}
              </>
            )}
          </div>
        </div>
      </div>
      <div>
        {isLoading ? (
          <div className="space-y-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="animate-pulse">
                <div className="h-16 bg-gray-200 rounded-lg"></div>
              </div>
            ))}
          </div>
        ) : !hasDisplayData ? (
          <div className="py-8 text-center">
            <p className="mb-4 text-gray-500">No pairings available for this selection yet.</p>
            {isOwner && (
              <Button onClick={() => generatePairingsMutation.mutate({ regenerate: false })}>
                Generate Pairings
              </Button>
            )}
          </div>
        ) : (
          <div className="space-y-6">
            {tournament?.format === 'roundrobin' ? (
              roundRobinGroups.length === 0 ? (
                <div className="py-8 text-center">
                  <p className="text-gray-500">No pairings generated yet</p>
                </div>
              ) : (
                <div className="space-y-8">
                  {roundRobinGroups.map(({ round, matches: roundMatches }) => {
                    const isCollapsed = collapsedRounds.has(round);
                    return (
                      <div key={round} className="rounded-lg border p-4">
                        <div className="mb-4 flex items-center justify-between">
                          <h3 className="flex items-center gap-3 text-lg font-semibold">
                            <span>Round {round}</span>
                            {(() => {
                              const isCurrent = round === currentRound;
                              const isCompleted = round < currentRound;
                              const badgeClass = isCurrent
                                ? "bg-blue-50 text-blue-800 border border-blue-200"
                                : isCompleted
                                  ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                                  : "bg-slate-100 text-slate-600 border border-transparent";
                              return (
                                <Badge variant="outline" className={badgeClass}>
                                  {isCurrent ? "In Progress" : isCompleted ? "Completed" : "Upcoming"}
                                </Badge>
                              );
                            })()}
                          </h3>
                        </div>
                        <div className="overflow-x-auto">
                          <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
                            <table className="min-w-full border-collapse font-sans">
                              <thead className="bg-slate-50 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300">
                                <tr>
                                  <th className="px-3 py-2 text-center text-xs font-bold w-14 border-b border-r border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 font-sans">Bd</th>
                                  <th className="px-3 py-2 text-center text-xs font-bold w-16 border-b border-r border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 font-sans">Res</th>
                                  <th className="px-4 py-2 text-left text-xs font-bold border-b border-r border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 font-sans">White</th>
                                  <th className="px-3 py-2 text-center text-xs font-bold w-16 border-b border-r border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 font-sans">Res</th>
                                  <th className="px-4 py-2 text-left text-xs font-bold border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 font-sans">Black</th>
                                  {isOwner && <th className="px-3 py-2 text-center text-xs font-bold w-16 border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 font-sans">Action</th>}
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                                {roundMatches.map((match) => {
                                  const whiteName = getPlayerName(match.whitePlayerId);
                                  const whiteRating = getPlayerRating(match.whitePlayerId);
                                  const blackName = match.blackPlayerId ? getPlayerName(match.blackPlayerId) : "Bye";
                                  const blackRating = match.blackPlayerId ? getPlayerRating(match.blackPlayerId) : 0;

                                  const effectiveResult = getEffectiveResult(match);
                                  const isPending = pendingResults[match.id] !== undefined;
                                  const isWhiteWin = effectiveResult ? (effectiveResult.startsWith("1-0") || effectiveResult.startsWith("1F-0F")) : false;
                                  const isBlackWin = effectiveResult ? (effectiveResult.startsWith("0-1") || effectiveResult.startsWith("0F-1F")) : false;
                                  const isDraw = effectiveResult ? effectiveResult.startsWith("1/2-1/2") : false;

                                  const whiteObj = getPlayerObject(match.whitePlayerId);
                                  const blackObj = getPlayerObject(match.blackPlayerId);

                                  const whitePoints = getPlayerPoints(match.whitePlayerId, round);
                                  const whitePointsStr = formatPointsWithFractions(whitePoints);
                                  const blackPoints = match.blackPlayerId ? getPlayerPoints(match.blackPlayerId, round) : 0;
                                  const blackPointsStr = formatPointsWithFractions(blackPoints);

                                  const whiteClicked = isEditMode && (clickState[match.id]?.has('white') ?? false);
                                  const blackClicked = isEditMode && (clickState[match.id]?.has('black') ?? false);

                                  const isWhiteSelected = selectedPlayers.some(p => p.playerId === match.whitePlayerId && p.matchId === match.id);
                                  const isBlackSelected = match.blackPlayerId ? selectedPlayers.some(p => p.playerId === match.blackPlayerId && p.matchId === match.id) : false;

                                  return (
                                    <tr key={match.id} className={cn("bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 border-b border-slate-200 dark:border-slate-800 last:border-b-0 hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors", isPending && "bg-amber-50/30 dark:bg-amber-950/10")}>
                                      <td className="px-3 py-3 text-center border-r border-slate-200 dark:border-slate-800 font-sans text-sm font-bold text-slate-500 dark:text-slate-400 bg-slate-50/50 dark:bg-slate-800/20 w-14">
                                        {match.board}
                                      </td>
                                      <td
                                        className={cn(
                                          "px-2 py-2 border-r border-slate-200 dark:border-slate-800 text-center select-none align-middle font-sans font-bold text-sm w-16 text-slate-700 dark:text-slate-300 bg-slate-50/10 dark:bg-slate-900/5 transition-all",
                                          isEditMode && "cursor-pointer hover:bg-amber-50 dark:hover:bg-amber-950/20",
                                          isEditMode && whiteClicked && "bg-amber-50 dark:bg-amber-950/20 border-r border-slate-200 dark:border-slate-800 text-amber-900 dark:text-amber-300"
                                        )}
                                        onClick={() => isEditMode && handleResultCellClick(match.id, 'white')}
                                        onDoubleClick={() => isEditMode && handleResultCellDoubleClick(match.id, 'white')}
                                        title={isEditMode ? "Double-click to set White Win; click both sides once for Draw" : ""}
                                      >
                                        <div className="flex items-center justify-center">
                                          {isWhiteWin ? "1" : isDraw ? "½" : isBlackWin ? "0" : ""}
                                        </div>
                                      </td>
                                      <td
                                        className={cn(
                                          "px-4 py-2 border-r border-slate-200 dark:border-slate-800 select-none text-left bg-transparent transition-all",
                                          (!isEditMode && isOwner && match.whitePlayerId) && "cursor-pointer hover:bg-blue-50/40 dark:hover:bg-blue-950/10",
                                          (!isEditMode && isWhiteSelected) && "bg-blue-50 dark:bg-blue-950/30 text-blue-900 dark:text-blue-300 border-r border-slate-200 dark:border-slate-800"
                                        )}
                                        onClick={() => {
                                          if (!isEditMode && match.whitePlayerId && isOwner) {
                                            handlePlayerClick(match.whitePlayerId, match.id, 'white', whiteName);
                                          }
                                        }}
                                        title={(!isEditMode && isOwner) ? "Click to select for swap" : ""}
                                      >
                                        <span className="font-bold text-sm text-slate-800 dark:text-slate-200">
                                          {whiteName} <span className="text-sm text-slate-500 dark:text-slate-400 font-normal">({whiteRating} {whitePointsStr})</span>
                                        </span>
                                      </td>
                                      <td
                                        className={cn(
                                          "px-2 py-2 border-r border-slate-200 dark:border-slate-800 text-center select-none align-middle font-sans font-bold text-sm w-16 text-slate-700 dark:text-slate-300 bg-slate-50/10 dark:bg-slate-900/5 transition-all",
                                          isEditMode && "cursor-pointer hover:bg-amber-50 dark:hover:bg-amber-950/20",
                                          isEditMode && blackClicked && "bg-amber-50 dark:bg-amber-950/20 border-r border-slate-200 dark:border-slate-800 text-amber-900 dark:text-amber-300"
                                        )}
                                        onClick={() => isEditMode && handleResultCellClick(match.id, 'black')}
                                        onDoubleClick={() => isEditMode && handleResultCellDoubleClick(match.id, 'black')}
                                        title={isEditMode ? "Double-click to set Black Win; click both sides once for Draw" : ""}
                                      >
                                        <div className="flex items-center justify-center">
                                          {isBlackWin ? "1" : isDraw ? "½" : isWhiteWin ? "0" : ""}
                                        </div>
                                      </td>
                                      <td
                                        className={cn(
                                          "px-4 py-2 border-r border-slate-200 dark:border-slate-800 select-none text-left bg-transparent transition-all",
                                          (!isEditMode && isOwner && match.blackPlayerId) && "cursor-pointer hover:bg-blue-50/40 dark:hover:bg-blue-950/10",
                                          (!isEditMode && isBlackSelected) && "bg-blue-50 dark:bg-blue-950/30 text-blue-900 dark:text-blue-300 border-r border-slate-200 dark:border-slate-800"
                                        )}
                                        onClick={() => {
                                          if (!isEditMode && match.blackPlayerId && isOwner) {
                                            handlePlayerClick(match.blackPlayerId, match.id, 'black', blackName);
                                          }
                                        }}
                                        title={(!isEditMode && isOwner) ? "Click to select for swap" : ""}
                                      >
                                        <span className="font-bold text-sm text-slate-800 dark:text-slate-200">
                                          {blackName} <span className="text-sm text-slate-500 dark:text-slate-400 font-normal">({blackRating} {blackPointsStr})</span>
                                        </span>
                                      </td>
                                      {isOwner && (
                                        <td className="px-3 py-2 text-center border-slate-200 dark:border-slate-800 w-16">
                                          {renderMatchActionsDropdown(match)}
                                        </td>
                                      )}
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )) : tournament?.format === 'knockout' ? (
                <div className="space-y-8">
                  {knockoutGroups.map(({ round, matches: roundMatches }) => {
                    const isCollapsed = collapsedRounds.has(round);
                    return (
                      <div key={round} className="rounded-lg border border-slate-200 p-4 bg-white shadow-sm overflow-hidden">
                        <div className={cn(
                          "flex items-center justify-between",
                          !isCollapsed && "border-b border-slate-100 pb-4 mb-4"
                        )}>
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center font-bold text-xs ring-1 ring-blue-100">
                              {round}
                            </div>
                            <h3 className="text-lg font-bold text-slate-900 tracking-tight">
                              {round === (tournament.rounds || 0) ? 'Finals' :
                                round === (tournament.rounds || 0) - 1 ? 'Semifinals' :
                                  round === (tournament.rounds || 0) - 2 ? 'Quarterfinals' :
                                    `Round ${round}`}
                            </h3>
                          </div>
                          {round === currentRound && (
                            <Badge className="bg-blue-500 hover:bg-blue-600 text-white font-bold px-3 py-1 text-[10px] uppercase tracking-wider">Active Round</Badge>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => toggleRoundCollapse(round)}
                            className="h-8 px-2 text-slate-500 hover:text-slate-900 ml-auto"
                          >
                            {isCollapsed ? (
                              <div className="flex items-center gap-1.5">
                                <span className="text-xs font-medium">Expand</span>
                                <ChevronDown className="h-4 w-4" />
                              </div>
                            ) : (
                              <div className="flex items-center gap-1.5">
                                <span className="text-xs font-medium">Collapse</span>
                                <ChevronUp className="h-4 w-4" />
                              </div>
                            )}
                          </Button>
                        </div>

                        {!isCollapsed && (
                          <div className="overflow-x-auto">
                            <table className="min-w-full divide-y divide-gray-200">
                              <thead className="bg-gray-50">
                                <tr>
                                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 w-8"></th>
                                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500">Board</th>
                                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500">Players</th>
                                  <th className="px-6 py-3 text-center text-xs font-medium text-gray-500">Score</th>
                                  {isTournamentDirector && (
                                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500">Actions</th>
                                  )}
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-gray-200 bg-white">
                                {roundMatches.map((match) => {
                                  const seriesGames = (allMatches || []).filter(m =>
                                    m.round === match.round &&
                                    m.board === match.board &&
                                    m.bracketType === match.bracketType &&
                                    m.sectionId === match.sectionId
                                  ).sort((a, b) => (a.gameNumber || 0) - (b.gameNumber || 0));

                                  const { p1Score, p2Score, p1Id, p2Id } = calculateMatchupScore(seriesGames);

                                  const formatScore = (num: number) => {
                                    if (num % 1 === 0) return num.toString();
                                    return (Math.floor(num) === 0 ? "" : Math.floor(num)) + "½";
                                  };
                                  const isExpanded = expandedSeries.has(match.id);

                                  return (
                                    <React.Fragment key={match.id}>
                                      <tr className="hover:bg-slate-50 transition-colors">
                                        <td className="px-6 py-4 whitespace-nowrap text-center">
                                          <Button variant="ghost" size="icon" className="h-6 w-6 p-0 hover:bg-slate-200" onClick={() => toggleExpand(match.id)}>
                                            {isExpanded ? <ChevronUp className="h-4 w-4 text-slate-500" /> : <ChevronDown className="h-4 w-4 text-slate-500" />}
                                          </Button>
                                        </td>
                                        <td className="whitespace-nowrap px-6 py-4">
                                          <div className="text-sm font-medium text-gray-900">{round}{String.fromCharCode(64 + (match.board || 1))}</div>
                                        </td>
                                        <td className="whitespace-nowrap px-6 py-4">
                                          <div className="flex flex-col gap-1.5">
                                            <div className="flex items-center gap-2">
                                              <div className={`w-1.5 h-1.5 rounded-full ${p1Score > p2Score ? 'bg-green-500' : 'bg-slate-200'}`} />
                                              <span className={`text-sm ${p1Score > p2Score ? 'text-slate-900 font-bold' : 'text-slate-700'}`}>
                                                {p1Id ? getPlayerName(p1Id) : getPendingPlayerLabel(match.round, match.board || 1, 'white')}
                                              </span>
                                            </div>
                                            <div className="flex items-center gap-2">
                                              <div className={`w-1.5 h-1.5 rounded-full ${p2Score > p1Score ? 'bg-green-500' : 'bg-slate-200'}`} />
                                              <span className={`text-sm ${p2Score > p1Score ? 'text-slate-900 font-bold' : 'text-slate-700'}`}>
                                                {p2Id ? getPlayerName(p2Id) : getPendingPlayerLabel(match.round, match.board || 1, 'black')}
                                              </span>
                                            </div>
                                          </div>
                                        </td>
                                        <td className="whitespace-nowrap px-6 py-4 text-center">
                                          <div className="inline-flex items-center justify-center h-10 px-4 rounded bg-[#f1f1f1] border border-[#e1e1e1] shadow-sm">
                                            <span className="text-base font-bold text-slate-900 tracking-tight">
                                              {formatScore(p1Score)} - {formatScore(p2Score)}
                                            </span>
                                          </div>
                                          <div className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-1">Games: {seriesGames.length}</div>
                                        </td>
                                        {isTournamentDirector && (
                                          <td className="whitespace-nowrap px-6 py-4 text-right">
                                            <Button
                                              variant="outline"
                                              size="sm"
                                              className="h-8 border-slate-200 text-slate-600 hover:text-blue-600"
                                              onClick={() => setSelectedMatchForManagement(match)}
                                            >
                                              <Swords className="h-3 w-3 mr-2" />
                                              MANAGE SERIES
                                            </Button>
                                          </td>
                                        )}
                                      </tr>
                                      {isExpanded && (
                                        <tr>
                                          <td colSpan={isTournamentDirector ? 5 : 4} className="p-0 border-b border-t border-slate-100 bg-slate-50/50">
                                            <div className="px-14 py-4 space-y-3 shadow-inner">
                                              <h4 className="text-xs font-semibold text-slate-500">Series History</h4>
                                              {seriesGames.length === 0 ? (
                                                <div className="text-sm text-slate-400 italic">No games played yet.</div>
                                              ) : (
                                                <div className="grid gap-2">
                                                  {seriesGames.map((game, i) => (
                                                    <div key={game.id} className="flex items-center justify-between bg-white px-4 py-2 rounded border border-slate-100 shadow-sm text-sm">
                                                      <div className="flex items-center gap-4">
                                                        <Badge variant="outline" className="w-16 justify-center">Game {i + 1}</Badge>
                                                        <div className="flex items-center gap-2 w-40">
                                                          <div className="w-3 h-3 border border-slate-300 bg-white" title="White Pieces" />
                                                          <span className="truncate">{game.whitePlayerId ? getPlayerName(game.whitePlayerId) : "T.B.D."}</span>
                                                        </div>
                                                        <span className="text-slate-400 text-xs">vs</span>
                                                        <div className="flex items-center gap-2 w-40">
                                                          <div className="w-3 h-3 border border-slate-400 bg-slate-900" title="Black Pieces" />
                                                          <span className="truncate">{game.blackPlayerId ? getPlayerName(game.blackPlayerId) : "T.B.D."}</span>
                                                        </div>
                                                      </div>
                                                      <Badge
                                                        variant={game.result ? "default" : "secondary"}
                                                        className={cn(game.result && "bg-[#81b64c] hover:bg-[#72a344] border-0")}
                                                      >
                                                        {game.result || "Ongoing"}
                                                      </Badge>
                                                    </div>
                                                  ))}
                                                </div>
                                              )}
                                            </div>
                                          </td>
                                        </tr>
                                      )}
                                    </React.Fragment>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <>
                  {activeSection !== "extra_games" && (
                    <div className="space-y-6">
                      <div className="flex items-center justify-between mb-2">
                        <h3 className="text-sm font-semibold text-slate-500">
                          Matches
                        </h3>
                      </div>
                      <div className="overflow-x-auto">
                        {activeSection === "all" ? (
                          <div className="space-y-8">
                            {sections.map((section) => {
                              const sectionMatches = swissMatches.filter(m => matchSectionFilter(m, section.id));
                              const sectionByes = filteredByes.filter(b => playerSectionMap.get(b.playerId)?.id === section.id);
                              return (
                                <div key={section.id} className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-sm space-y-4">
                                  <h4 className="text-md font-semibold text-slate-800 dark:text-slate-100 border-b dark:border-slate-800 pb-2 flex items-center justify-between font-sans">
                                    <span>{section.name} Section</span>
                                    <Badge variant="secondary" className="text-xs font-semibold font-sans">
                                      {sectionMatches.length} Boards
                                    </Badge>
                                  </h4>
                                  {renderPairingsTable(sectionMatches, sectionByes, section.name)}
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          renderPairingsTable(swissMatches, filteredByes)
                        )}
                      </div>
                    </div>
                  )}
                </>
              )}

                {/* Extra Games Section */}
                {tournament?.format === 'swiss' && tournamentConfig?.registers?.allowExtraGames && activeSection === "extra_games" && (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="text-sm font-semibold text-slate-500">
                        Extra Games This Round (Rated • Excluded from Standings)
                      </h3>
                    </div>
                    {extraMatches.length > 0 ? (
                      <div className="overflow-x-auto border border-black p-1 bg-white">
                        <table style={{ borderCollapse: 'collapse', border: '1px solid black', width: '100%', fontFamily: 'Arial, sans-serif', fontSize: '14px', color: '#000', backgroundColor: '#fff' }}>
                          <thead>
                            <tr style={{ border: '1px solid black', backgroundColor: '#e8e8e8' }}>
                              <th style={{ border: '1px solid black', padding: '6px 8px', color: '#000', backgroundColor: '#e8e8e8', fontWeight: 'bold', fontSize: '14px', textAlign: 'center', width: '56px' }}>Bd</th>
                              <th style={{ border: '1px solid black', padding: '6px 8px', color: '#000', backgroundColor: '#e8e8e8', fontWeight: 'bold', fontSize: '14px', textAlign: 'center', width: '64px' }}>Res</th>
                              <th style={{ border: '1px solid black', padding: '6px 8px', color: '#000', backgroundColor: '#e8e8e8', fontWeight: 'bold', fontSize: '14px', textAlign: 'left' }}>White</th>
                              <th style={{ border: '1px solid black', padding: '6px 8px', color: '#000', backgroundColor: '#e8e8e8', fontWeight: 'bold', fontSize: '14px', textAlign: 'center', width: '64px' }}>Res</th>
                              <th style={{ border: '1px solid black', padding: '6px 8px', color: '#000', backgroundColor: '#e8e8e8', fontWeight: 'bold', fontSize: '14px', textAlign: 'left' }}>Black</th>
                              {isOwner && <th style={{ border: '1px solid black', padding: '6px 8px', color: '#000', backgroundColor: '#e8e8e8', fontWeight: 'bold', fontSize: '14px', textAlign: 'center', width: '60px' }}>Action</th>}
                            </tr>
                          </thead>
                          <tbody>
                            {extraMatches.map((match) => {
                              const whiteName = getPlayerName(match.whitePlayerId);
                              const whiteRating = getPlayerRating(match.whitePlayerId);
                              const blackName = match.blackPlayerId ? getPlayerName(match.blackPlayerId) : "Bye";
                              const blackRating = match.blackPlayerId ? getPlayerRating(match.blackPlayerId) : 0;
                              
                              const effectiveResult = getEffectiveResult(match);
                              const isPending = pendingResults[match.id] !== undefined;
                              const isWhiteWin = effectiveResult ? (effectiveResult.startsWith("1-0") || effectiveResult.startsWith("1F-0F")) : false;
                              const isBlackWin = effectiveResult ? (effectiveResult.startsWith("0-1") || effectiveResult.startsWith("0F-1F")) : false;
                              const isDraw = effectiveResult ? effectiveResult.startsWith("1/2-1/2") : false;
                              
                              const whiteObj = getPlayerObject(match.whitePlayerId);
                              const blackObj = getPlayerObject(match.blackPlayerId);

                              const whitePoints = getPlayerPoints(match.whitePlayerId, currentRound);
                              const whitePointsStr = formatPointsWithFractions(whitePoints);
                              const blackPoints = match.blackPlayerId ? getPlayerPoints(match.blackPlayerId, currentRound) : 0;
                              const blackPointsStr = formatPointsWithFractions(blackPoints);
                              
                              const whiteClicked = isEditMode && (clickState[match.id]?.has('white') ?? false);
                              const blackClicked = isEditMode && (clickState[match.id]?.has('black') ?? false);

                              const isWhiteSelected = selectedPlayers.some(p => p.playerId === match.whitePlayerId && p.matchId === match.id);
                              const isBlackSelected = match.blackPlayerId ? selectedPlayers.some(p => p.playerId === match.blackPlayerId && p.matchId === match.id) : false;

                              return (
                                <tr
                                  key={match.id}
                                  style={{
                                    border: '1px solid black',
                                    backgroundColor: isPending ? '#fff9e6' : '#fff',
                                    color: '#000'
                                  }}
                                >
                                  <td style={{ border: '1px solid black', padding: '6px 8px', color: '#000', textAlign: 'center', fontWeight: 'bold', fontSize: '14px', width: '56px', backgroundColor: '#f5f5f5' }}>
                                    Extra
                                  </td>
                                  <td
                                    style={{
                                      border: '1px solid black',
                                      padding: '6px 8px',
                                      color: whiteClicked ? '#854d0e' : '#000',
                                      backgroundColor: whiteClicked ? '#fef3c7' : '#fff',
                                      textAlign: 'center',
                                      cursor: isEditMode ? 'pointer' : 'default',
                                      fontWeight: 'bold',
                                      fontSize: '14px',
                                      width: '64px',
                                      userSelect: 'none'
                                    }}
                                    onClick={() => isEditMode && handleResultCellClick(match.id, 'white')}
                                    onDoubleClick={() => isEditMode && handleResultCellDoubleClick(match.id, 'white')}
                                    title={isEditMode ? "Double-click to set White Win; click both sides once for Draw" : ""}
                                  >
                                    <div className="flex items-center justify-center">
                                      {isWhiteWin ? "1" : isDraw ? "½" : isBlackWin ? "0" : ""}
                                    </div>
                                  </td>
                                  <td 
                                    style={{
                                      border: '1px solid black',
                                      padding: '6px 8px',
                                      color: isWhiteSelected ? '#1e3a8a' : '#000',
                                      backgroundColor: isWhiteSelected ? '#dbeafe' : 'transparent',
                                      textAlign: 'left',
                                      cursor: (!isEditMode && match.whitePlayerId && isOwner) ? 'pointer' : 'default',
                                      userSelect: 'none'
                                    }}
                                    onClick={() => {
                                      if (!isEditMode && match.whitePlayerId && isOwner) {
                                        handlePlayerClick(match.whitePlayerId, match.id, 'white', whiteName);
                                      }
                                    }}
                                    title={(!isEditMode && isOwner) ? "Click to select for swap" : ""}
                                  >
                                    <span style={{ fontWeight: 'bold', fontSize: '14px', color: isWhiteSelected ? '#1e3a8a' : '#000' }}>
                                      {whiteName} <span style={{ fontSize: '14px', color: '#555', fontWeight: 'normal' }}>({whiteRating} {whitePointsStr})</span>
                                    </span>
                                  </td>
                                  <td
                                    style={{
                                      border: '1px solid black',
                                      padding: '6px 8px',
                                      color: blackClicked ? '#854d0e' : '#000',
                                      backgroundColor: blackClicked ? '#fef3c7' : '#fff',
                                      textAlign: 'center',
                                      cursor: isEditMode ? 'pointer' : 'default',
                                      fontWeight: 'bold',
                                      fontSize: '14px',
                                      width: '64px',
                                      userSelect: 'none'
                                    }}
                                    onClick={() => isEditMode && handleResultCellClick(match.id, 'black')}
                                    onDoubleClick={() => isEditMode && handleResultCellDoubleClick(match.id, 'black')}
                                    title={isEditMode ? "Double-click to set Black Win; click both sides once for Draw" : ""}
                                  >
                                    <div className="flex items-center justify-center">
                                      {isBlackWin ? "1" : isDraw ? "½" : isWhiteWin ? "0" : ""}
                                    </div>
                                  </td>
                                  <td 
                                    style={{
                                      border: '1px solid black',
                                      padding: '6px 8px',
                                      color: isBlackSelected ? '#1e3a8a' : '#000',
                                      backgroundColor: isBlackSelected ? '#dbeafe' : 'transparent',
                                      textAlign: 'left',
                                      cursor: (!isEditMode && match.blackPlayerId && isOwner) ? 'pointer' : 'default',
                                      userSelect: 'none'
                                    }}
                                    onClick={() => {
                                      if (!isEditMode && match.blackPlayerId && isOwner) {
                                        handlePlayerClick(match.blackPlayerId, match.id, 'black', blackName);
                                      }
                                    }}
                                    title={(!isEditMode && isOwner) ? "Click to select for swap" : ""}
                                  >
                                    <span style={{ fontWeight: 'bold', fontSize: '14px', color: isBlackSelected ? '#1e3a8a' : '#000' }}>
                                      {blackName} <span style={{ fontSize: '14px', color: '#555', fontWeight: 'normal' }}>({blackRating} {blackPointsStr})</span>
                                    </span>
                                  </td>
                                  {isOwner && (
                                    <td style={{ border: '1px solid black', padding: '4px', textAlign: 'center', width: '60px' }}>
                                      {renderMatchActionsDropdown(match)}
                                    </td>
                                  )}
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <p className="text-sm text-slate-500 dark:text-slate-400 italic">
                        No extra games added for this round.
                      </p>
                    )}

                    {/* TD Controls for Adding Extra Games */}
                    {isOwner && (
                      <div className="pt-6 border-t border-slate-200 dark:border-slate-800">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                          {/* Column 1: Pair Players */}
                          <div className="space-y-4 p-5 bg-slate-50 dark:bg-slate-900/40 rounded-2xl border border-slate-100 dark:border-slate-850">
                            <div className="flex items-center gap-2 mb-1">
                              <Swords className="h-5 w-5 text-indigo-500" />
                              <h4 className="text-sm font-bold text-slate-800 dark:text-slate-100 font-sans">Create Extra Game</h4>
                            </div>
                            <p className="text-xs text-slate-500 font-sans leading-relaxed">
                              Pair any two active players (including guests and houseplayers) for a rated extra game.
                            </p>
                            
                            <div className="space-y-3 pt-2">
                              <div className="space-y-1.5">
                                <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 font-sans">White Player</label>
                                <Select value={selectedWhitePlayerId} onValueChange={setSelectedWhitePlayerId}>
                                  <SelectTrigger className="w-full bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 rounded-xl">
                                    <SelectValue placeholder="Select White..." />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {selectablePlayers
                                      .filter(p => p.id.toString() !== selectedBlackPlayerId)
                                      .map(p => (
                                        <SelectItem key={p.id} value={p.id.toString()}>
                                          {p.firstName} {p.lastName} ({p.rating ?? 1000}){p.status === 'guest' ? ' [GUEST]' : p.status === 'houseplayer' ? ' [HOUSEPLAYER]' : ''}
                                        </SelectItem>
                                      ))}
                                  </SelectContent>
                                </Select>
                              </div>

                              <div className="space-y-1.5">
                                <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 font-sans">Black Player</label>
                                <Select value={selectedBlackPlayerId} onValueChange={setSelectedBlackPlayerId}>
                                  <SelectTrigger className="w-full bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 rounded-xl">
                                    <SelectValue placeholder="Select Black..." />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {selectablePlayers
                                      .filter(p => p.id.toString() !== selectedWhitePlayerId)
                                      .map(p => (
                                        <SelectItem key={p.id} value={p.id.toString()}>
                                          {p.firstName} {p.lastName} ({p.rating ?? 1000}){p.status === 'guest' ? ' [GUEST]' : p.status === 'houseplayer' ? ' [HOUSEPLAYER]' : ''}
                                        </SelectItem>
                                      ))}
                                  </SelectContent>
                                </Select>
                              </div>

                              <Button
                                type="button"
                                onClick={() => {
                                  if (!selectedWhitePlayerId || !selectedBlackPlayerId) {
                                    toast({
                                      title: "Error",
                                      description: "Please select both a White and a Black player.",
                                      variant: "destructive",
                                    });
                                    return;
                                  }
                                  addExtraMatchMutation.mutate({
                                    whitePlayerId: parseInt(selectedWhitePlayerId),
                                    blackPlayerId: parseInt(selectedBlackPlayerId),
                                  });
                                }}
                                disabled={addExtraMatchMutation.isPending || !selectedWhitePlayerId || !selectedBlackPlayerId}
                                className="w-full bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-medium h-10 gap-2 mt-2"
                              >
                                {addExtraMatchMutation.isPending ? "Adding..." : "Add Extra Game"}
                              </Button>
                            </div>
                          </div>

                          <QuickRegistration tournamentId={tournamentId} />
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* Webcam / OCR Scan Dialog */}
      <OCRScannerDialog
        open={scanDialogOpen}
        onOpenChange={setScanDialogOpen}
        onScanComplete={(parsed) => setPendingResults(prev => ({ ...prev, ...parsed }))}
        matchesForStatus={matchesForStatus}
      />

      {/* Match Management Dialog for Knockout */}
      <MatchManagementDialog
        match={selectedMatchForManagement}
        open={!!selectedMatchForManagement}
        onOpenChange={(open) => !open && setSelectedMatchForManagement(null)}
        players={players || []}
        allMatches={allMatches || []}
        isTD={isTournamentDirector}
        tournamentId={tournamentId}
        format={tournament?.format}
        onMatchUpdated={() => {
          queryClient.invalidateQueries({ queryKey: [`/api/tournaments/${tournamentId}/matches`] });
          queryClient.invalidateQueries({ queryKey: [`/api/tournaments/${tournamentId}/players`] });
        }}
      />

          </div>
  );
}
);


SwissPairings.displayName = "SwissPairings";

export default SwissPairings;
