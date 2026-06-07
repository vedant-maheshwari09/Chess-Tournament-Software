import React, { useState, useEffect, useMemo, useRef } from "react";
import { useLocation, useRoute } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { apiRequest } from "@/lib/queryClient";
import { 
  ChevronLeft, Printer, RotateCcw, Check, Lock, Unlock, Keyboard, QrCode, 
  Sparkles, CheckCircle2, Loader2, Info
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import type { Tournament, Player, Match } from "@shared/schema";
import { parseTournamentConfig } from "@/lib/tournament-config";

export default function ResultsEntry() {
  const [, params] = useRoute("/tournaments/:id/results-entry");
  const tournamentId = parseInt(params?.id || "0");
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Selected Round and Section filters
  const [selectedRound, setSelectedRound] = useState<number>(1);
  const [selectedSection, setSelectedSection] = useState<string>("all");

  // Track which match rows are currently editable/unlocked (override mode)
  const [unlockedMatches, setUnlockedMatches] = useState<Set<number>>(new Set());

  // Input states per match and side: { [matchId]: { white: string, black: string } }
  const [inputValues, setInputValues] = useState<Record<number, { white: string; black: string }>>({});

  // Local savings status per match: 'idle' | 'saving' | 'saved' | 'error'
  const [saveStatus, setSaveStatus] = useState<Record<number, 'idle' | 'saving' | 'saved' | 'error'>>({});

  // Click gesture tracking: { matchId, side, timestamp }
  const [lastClick, setLastClick] = useState<{ matchId: number; side: 'white' | 'black'; timestamp: number } | null>(null);

  // References to input elements for keyboard focus traversal
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  // Fetch tournament details
  const { data: tournament, isLoading: tournamentLoading } = useQuery<Tournament>({
    queryKey: [`/api/tournaments/${tournamentId}`],
  });

  // Fetch players list
  const { data: players = [], isLoading: playersLoading } = useQuery<Player[]>({
    queryKey: [`/api/tournaments/${tournamentId}/players`],
  });

  // Fetch matches list
  const { data: matches = [], isLoading: matchesLoading } = useQuery<Match[]>({
    queryKey: [`/api/tournaments/${tournamentId}/matches`],
  });

  // Fetch public match submission tokens
  const { data: matchTokens = {} } = useQuery<Record<number, string>>({
    queryKey: [`/api/tournaments/${tournamentId}/matches/tokens`],
    enabled: !!user && user.role === 'tournament_director',
  });

  const tournamentConfig = useMemo(() => tournament ? parseTournamentConfig(tournament) : null, [tournament]);
  const sections = useMemo(() => tournamentConfig?.sections ?? [], [tournamentConfig]);

  // Set default round once tournament data is available
  useEffect(() => {
    if (tournament && tournament.currentRound) {
      setSelectedRound(tournament.currentRound);
    }
  }, [tournament]);

  // Map players by ID for fast lookup
  const playerMap = useMemo(() => {
    const map = new Map<number, Player>();
    players.forEach(p => map.set(p.id, p));
    return map;
  }, [players]);

  // Filter matches based on selected round and section
  const filteredMatches = useMemo(() => {
    return matches.filter(match => {
      if (match.round !== selectedRound) return false;
      if (match.isBye) return false; // fast result entry is for active board matchups

      if (selectedSection !== "all") {
        const whitePlayer = match.whitePlayerId ? playerMap.get(match.whitePlayerId) : null;
        const blackPlayer = match.blackPlayerId ? playerMap.get(match.blackPlayerId) : null;
        const whiteSection = whitePlayer?.sectionId || "default";
        const blackSection = blackPlayer?.sectionId || "default";
        return whiteSection === selectedSection || blackSection === selectedSection;
      }
      return true;
    }).sort((a, b) => (a.board || 0) - (b.board || 0));
  }, [matches, selectedRound, selectedSection, playerMap]);

  // Sync matches to inputs when round/section changes
  useEffect(() => {
    const newInputs: Record<number, { white: string; black: string }> = {};
    filteredMatches.forEach(match => {
      const res = match.result;
      if (res === '1-0') {
        newInputs[match.id] = { white: '1', black: '0' };
      } else if (res === '0-1') {
        newInputs[match.id] = { white: '0', black: '1' };
      } else if (res === '1/2-1/2') {
        newInputs[match.id] = { white: '1/2', black: '1/2' };
      } else if (res === '1F-0F') {
        newInputs[match.id] = { white: '1F', black: '0F' };
      } else if (res === '0F-1F') {
        newInputs[match.id] = { white: '0F', black: '1F' };
      } else if (res === '0F-0F') {
        newInputs[match.id] = { white: '0F', black: '0F' };
      } else {
        newInputs[match.id] = { white: '', black: '' };
      }
    });
    setInputValues(newInputs);
  }, [filteredMatches]);

  // Auto-focus the first board's input box when round changes
  useEffect(() => {
    if (filteredMatches.length > 0) {
      setTimeout(() => {
        const firstMatchId = filteredMatches[0].id;
        const refKey = `${firstMatchId}-white`;
        const firstInput = inputRefs.current[refKey];
        if (firstInput) {
          firstInput.focus();
          firstInput.select();
        }
      }, 100);
    }
  }, [selectedRound, selectedSection, filteredMatches]);

  // Mutation to update match result
  const updateResultMutation = useMutation({
    mutationFn: async ({ matchId, result }: { matchId: number; result: string | null }) => {
      setSaveStatus(prev => ({ ...prev, [matchId]: 'saving' }));
      const response = await apiRequest(`/api/matches/${matchId}`, {
        method: "PUT",
        body: JSON.stringify({
          result,
          status: result ? "completed" : "pending",
        }),
      });
      return { matchId, data: response };
    },
    onSuccess: (data) => {
      setSaveStatus(prev => ({ ...prev, [data.matchId]: 'saved' }));
      queryClient.invalidateQueries({ queryKey: [`/api/tournaments/${tournamentId}/matches`] });
      
      // Auto-lock again on successful save
      setUnlockedMatches(prev => {
        const next = new Set(prev);
        next.delete(data.matchId);
        return next;
      });

      // Clear save badge animation after a second
      setTimeout(() => {
        setSaveStatus(prev => {
          if (prev[data.matchId] === 'saved') {
            return { ...prev, [data.matchId]: 'idle' };
          }
          return prev;
        });
      }, 1500);
    },
    onError: (_err, variables) => {
      setSaveStatus(prev => ({ ...prev, [variables.matchId]: 'error' }));
      toast({
        title: "Failed to save result",
        description: "An error occurred while transmitting scores to the database.",
        variant: "destructive"
      });
    }
  });

  // Process score input values into the backend result format string
  const saveMatchResult = (matchId: number, whiteVal: string, blackVal: string) => {
    let resultStr: string | null = null;
    const w = whiteVal.trim().toLowerCase();
    const b = blackVal.trim().toLowerCase();

    // Map common aliases
    if (w === '1' || w === '1-0' || b === '0') {
      resultStr = '1-0';
    } else if (w === '0' || w === '0-1' || b === '1') {
      resultStr = '0-1';
    } else if (w === '1/2' || w === '0.5' || w === 'draw' || w === 'd' || b === '1/2' || b === '0.5') {
      resultStr = '1/2-1/2';
    } else if (w === '1f' || w === 'xf' || b === '0f') {
      resultStr = '1F-0F';
    } else if (w === '0f' || b === '1f' || b === 'xf') {
      resultStr = '0F-1F';
    } else if (w === 'ff' || (w === '0f' && b === '0f')) {
      resultStr = '0F-0F';
    } else if (w === '' && b === '') {
      resultStr = null; // cleared
    } else {
      // Unrecognized format, don't submit yet
      return false;
    }

    updateResultMutation.mutate({ matchId, result: resultStr });
    return true;
  };

  // Keyboard navigation & quick shortcuts
  const handleKeyDown = (
    e: React.KeyboardEvent<HTMLInputElement>, 
    matchId: number, 
    side: 'white' | 'black', 
    index: number
  ) => {
    const value = e.currentTarget.value.trim().toLowerCase();

    // Fast-entry single keys
    if (e.key === '1') {
      e.preventDefault();
      const newWhite = side === 'white' ? '1' : '0';
      const newBlack = side === 'white' ? '0' : '1';
      setInputValues(prev => ({ ...prev, [matchId]: { white: newWhite, black: newBlack } }));
      const saved = saveMatchResult(matchId, newWhite, newBlack);
      if (saved) advanceFocus(index);
    } else if (e.key === '0') {
      e.preventDefault();
      const newWhite = side === 'white' ? '0' : '1';
      const newBlack = side === 'white' ? '1' : '0';
      setInputValues(prev => ({ ...prev, [matchId]: { white: newWhite, black: newBlack } }));
      const saved = saveMatchResult(matchId, newWhite, newBlack);
      if (saved) advanceFocus(index);
    } else if (e.key === '/' || e.key === 'd' || e.key === 'D') {
      e.preventDefault();
      setInputValues(prev => ({ ...prev, [matchId]: { white: '1/2', black: '1/2' } }));
      const saved = saveMatchResult(matchId, '1/2', '1/2');
      if (saved) advanceFocus(index);
    }

    // Standard arrow key / Enter navigation
    if (e.key === 'Enter') {
      e.preventDefault();
      const curVal = inputValues[matchId] || { white: '', black: '' };
      const saved = saveMatchResult(matchId, curVal.white, curVal.black);
      if (saved) {
        advanceFocus(index);
      } else {
        toast({
          title: "Invalid Score",
          description: "Enter a valid shortcut (1, 0, 1/2, 1F, 0F, FF)",
          variant: "destructive"
        });
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      advanceFocus(index);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      retreatFocus(index);
    }
  };

  const advanceFocus = (currentIndex: number) => {
    const nextMatch = filteredMatches[currentIndex + 1];
    if (nextMatch) {
      const nextRef = inputRefs.current[`${nextMatch.id}-white`];
      if (nextRef) {
        nextRef.focus();
        nextRef.select();
      }
    }
  };

  const retreatFocus = (currentIndex: number) => {
    const prevMatch = filteredMatches[currentIndex - 1];
    if (prevMatch) {
      const prevRef = inputRefs.current[`${prevMatch.id}-white`];
      if (prevRef) {
        prevRef.focus();
        prevRef.select();
      }
    }
  };

  // Click & Double-Click Gesture Implementation
  const handlePlayerClick = (matchId: number, side: 'white' | 'black', isMatchLocked: boolean) => {
    if (isMatchLocked) return;

    const now = Date.now();
    
    // Check if double click on same player -> Win
    if (lastClick && lastClick.matchId === matchId && lastClick.side === side && (now - lastClick.timestamp) < 300) {
      const newWhite = side === 'white' ? '1' : '0';
      const newBlack = side === 'white' ? '0' : '1';
      setInputValues(prev => ({ ...prev, [matchId]: { white: newWhite, black: newBlack } }));
      saveMatchResult(matchId, newWhite, newBlack);
      setLastClick(null);
      return;
    }

    // Check if click opposite sides of the same matchup -> Draw
    if (lastClick && lastClick.matchId === matchId && lastClick.side !== side && (now - lastClick.timestamp) < 2000) {
      setInputValues(prev => ({ ...prev, [matchId]: { white: '1/2', black: '1/2' } }));
      saveMatchResult(matchId, '1/2', '1/2');
      setLastClick(null);
      return;
    }

    // Otherwise record click
    setLastClick({ matchId, side, timestamp: now });
  };

  // Toggle Override/Edit lock
  const toggleLock = (matchId: number) => {
    setUnlockedMatches(prev => {
      const next = new Set(prev);
      if (next.has(matchId)) {
        next.delete(matchId);
      } else {
        next.add(matchId);
        // Focus White input of unlocked board
        setTimeout(() => {
          const input = inputRefs.current[`${matchId}-white`];
          if (input) {
            input.focus();
            input.select();
          }
        }, 50);
      }
      return next;
    });
  };

  // Renders the correct visual color styling per match result state
  const getMatchRowColor = (match: Match) => {
    if (!match.result) return "bg-white dark:bg-slate-900 border-slate-100 hover:bg-slate-50/50";
    if (match.result === '1/2-1/2') return "bg-slate-50/40 dark:bg-slate-900/40 border-slate-100/60";
    if (match.result === '1-0') return "bg-emerald-50/10 dark:bg-emerald-950/10 border-emerald-100/20";
    if (match.result === '0-1') return "bg-indigo-50/10 dark:bg-indigo-950/10 border-indigo-100/20";
    return "bg-amber-50/10 dark:bg-amber-950/10 border-amber-100/20";
  };

  if (tournamentLoading || playersLoading || matchesLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-50/50">
        <div className="text-center space-y-3">
          <Loader2 className="h-8 w-8 text-primary animate-spin mx-auto" />
          <p className="text-slate-500 font-medium">Loading match dashboard...</p>
        </div>
      </div>
    );
  }

  if (!tournament) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-slate-600">Tournament not found.</p>
      </div>
    );
  }

  const roundsArray = Array.from({ length: tournament.rounds || 5 }, (_, i) => i + 1);

  return (
    <>
      {/* PRINT-ONLY VIEW: pairing sheets with QR codes */}
      <div className="hidden print:block font-sans p-6 bg-white text-black min-h-screen w-full">
        <div className="border-b-2 border-black pb-4 mb-6 flex justify-between items-end">
          <div>
            <h1 className="text-2xl font-bold uppercase tracking-tight">{tournament.name}</h1>
            <p className="text-lg font-medium text-slate-700">Official Pairing Sheet — Round {selectedRound}</p>
            {selectedSection !== "all" && (
              <p className="text-sm font-semibold">Section: {sections.find(s => s.id === selectedSection)?.name || selectedSection}</p>
            )}
          </div>
          <div className="text-right text-xs text-slate-500">
            <p>Printed on: {new Date().toLocaleDateString()}</p>
            <p>Scan Match QR codes to record results digitally</p>
          </div>
        </div>

        <table className="w-full text-left border-collapse border border-slate-300">
          <thead>
            <tr className="bg-slate-100 border-b border-slate-300 text-xs font-bold uppercase">
              <th className="p-3 border-r border-slate-300 text-center w-16">Board</th>
              <th className="p-3 border-r border-slate-300 w-2/5">White Player</th>
              <th className="p-3 border-r border-slate-300 text-center w-24">Result</th>
              <th className="p-3 border-r border-slate-300 w-2/5">Black Player</th>
              <th className="p-3 text-center w-24">QR Code</th>
            </tr>
          </thead>
          <tbody>
            {filteredMatches.map(match => {
              const whitePlayer = match.whitePlayerId ? playerMap.get(match.whitePlayerId) : null;
              const blackPlayer = match.blackPlayerId ? playerMap.get(match.blackPlayerId) : null;
              const token = matchTokens[match.id] || "";
              
              const qrUrl = `${window.location.origin}/submit-result?m=${match.id}&token=${token}`;

              return (
                <tr key={match.id} className="border-b border-slate-300 text-sm">
                  <td className="p-3 border-r border-slate-300 font-bold text-center">{match.board}</td>
                  <td className="p-3 border-r border-slate-300">
                    <div className="font-semibold">
                      {whitePlayer ? `${whitePlayer.lastName}, ${whitePlayer.firstName}` : "Bye"}
                    </div>
                    {whitePlayer && (
                      <div className="text-xs text-slate-600">
                        Rating: {whitePlayer.rating || "Unrated"} | ID: {whitePlayer.localId || "N/A"}
                      </div>
                    )}
                  </td>
                  <td className="p-3 border-r border-slate-300 text-center font-bold text-slate-400">
                    [ &nbsp; &nbsp; ] - [ &nbsp; &nbsp; ]
                  </td>
                  <td className="p-3 border-r border-slate-300">
                    <div className="font-semibold">
                      {blackPlayer ? `${blackPlayer.lastName}, ${blackPlayer.firstName}` : "Bye"}
                    </div>
                    {blackPlayer && (
                      <div className="text-xs text-slate-600">
                        Rating: {blackPlayer.rating || "Unrated"} | ID: {blackPlayer.localId || "N/A"}
                      </div>
                    )}
                  </td>
                  <td className="p-2 text-center flex justify-center items-center">
                    {token ? (
                      <QRCodeSVG value={qrUrl} size={55} level="M" />
                    ) : (
                      <span className="text-[10px] text-slate-400">QR Code Error</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* SCREEN VIEW: TD dashboard and entry console */}
      <div className="print:hidden min-h-screen bg-slate-50/50 dark:bg-slate-950 pb-16">
        <header className="sticky top-0 z-40 bg-white/85 dark:bg-slate-900/85 backdrop-blur-md border-b border-slate-200/60 dark:border-slate-800/60">
          <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Button 
                variant="ghost" 
                size="icon" 
                onClick={() => setLocation(`/tournaments/${tournamentId}/manage/rounds`)}
                className="hover:bg-slate-100 rounded-xl"
              >
                <ChevronLeft className="h-5 w-5" />
              </Button>
              <div>
                <h1 className="text-base font-bold text-slate-900 dark:text-slate-100 leading-tight">
                  Fast Results Entry
                </h1>
                <p className="text-xs text-slate-500 font-medium">
                  {tournament.name}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Button 
                variant="outline" 
                size="sm" 
                onClick={() => window.print()}
                className="h-9 px-4 border-slate-200 dark:border-slate-800 font-semibold rounded-lg flex items-center gap-2"
              >
                <Printer className="h-4 w-4" />
                Print QR Pairing Sheets
              </Button>
            </div>
          </div>
        </header>

        <main className="max-w-7xl mx-auto px-6 mt-8">
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
            {/* Filter and settings panel */}
            <div className="space-y-6 lg:col-span-1">
              <Card className="shadow-sm border-slate-200/60">
                <CardHeader>
                  <CardTitle className="text-sm font-bold flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-violet-500" />
                    Console Filters
                  </CardTitle>
                  <CardDescription className="text-xs">
                    Choose the target round and section.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-xs font-semibold text-slate-500">Round</label>
                    <Select 
                      value={selectedRound.toString()} 
                      onValueChange={(val) => setSelectedRound(parseInt(val))}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Select Round" />
                      </SelectTrigger>
                      <SelectContent>
                        {roundsArray.map(r => (
                          <SelectItem key={r} value={r.toString()}>Round {r}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {sections.length > 0 && (
                    <div className="space-y-2">
                      <label className="text-xs font-semibold text-slate-500">Section</label>
                      <Select 
                        value={selectedSection} 
                        onValueChange={setSelectedSection}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Select Section" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All Sections</SelectItem>
                          {sections.map(s => (
                            <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Keyboard shortcuts legend */}
              <Card className="shadow-sm border-slate-200/60">
                <CardHeader>
                  <CardTitle className="text-sm font-bold flex items-center gap-2">
                    <Keyboard className="h-4 w-4 text-primary" />
                    Fast-Key Entry
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-xs space-y-3">
                  <p className="text-slate-500">Focus any box and press a key to set results immediately:</p>
                  <div className="grid grid-cols-2 gap-2 font-mono">
                    <div className="flex items-center gap-1.5 bg-slate-100 p-1.5 rounded border">
                      <span className="font-bold text-violet-600 bg-white px-1 border rounded shadow-sm">1</span>
                      <span>Win (1-0)</span>
                    </div>
                    <div className="flex items-center gap-1.5 bg-slate-100 p-1.5 rounded border">
                      <span className="font-bold text-violet-600 bg-white px-1 border rounded shadow-sm">0</span>
                      <span>Loss (0-1)</span>
                    </div>
                    <div className="flex items-center gap-1.5 bg-slate-100 p-1.5 rounded border col-span-2">
                      <span className="font-bold text-violet-600 bg-white px-1 border rounded shadow-sm">/</span>
                      <span>Draw (1/2-1/2)</span>
                    </div>
                    <div className="flex items-center gap-1.5 bg-slate-100 p-1.5 rounded border">
                      <span className="font-bold text-violet-600 bg-white px-1 border rounded shadow-sm">1F</span>
                      <span>Forfeit Win</span>
                    </div>
                    <div className="flex items-center gap-1.5 bg-slate-100 p-1.5 rounded border">
                      <span className="font-bold text-violet-600 bg-white px-1 border rounded shadow-sm">0F</span>
                      <span>Forfeit Loss</span>
                    </div>
                  </div>
                  <div className="border-t pt-3 mt-3 space-y-1.5 text-slate-500">
                    <div className="flex items-start gap-1">
                      <span className="font-bold text-violet-600">• Double click:</span>
                      <span>Set win for player</span>
                    </div>
                    <div className="flex items-start gap-1">
                      <span className="font-bold text-violet-600">• Click + Click:</span>
                      <span>Click both players to set draw</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Dashboard of matches */}
            <div className="lg:col-span-3">
              <Card className="shadow-sm border-slate-200/60 overflow-hidden">
                <CardHeader className="bg-slate-50/50 dark:bg-slate-900/30 border-b border-slate-100 dark:border-slate-900 py-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-base font-bold">Matches & Results Entry</CardTitle>
                      <CardDescription className="text-xs">
                        Enter outcomes for active pairings in Round {selectedRound}.
                      </CardDescription>
                    </div>
                    <Badge variant="outline" className="text-slate-500 font-semibold bg-white border-slate-200">
                      {filteredMatches.length} Board Matches
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  {filteredMatches.length === 0 ? (
                    <div className="py-12 text-center text-slate-500 space-y-2">
                      <QrCode className="h-10 w-10 text-slate-300 mx-auto" />
                      <p className="font-medium text-sm">No matchups found for this filters combination.</p>
                      <p className="text-xs text-slate-400">Ensure pairings have been generated for Round {selectedRound}.</p>
                    </div>
                  ) : (
                    <div className="divide-y divide-slate-100 dark:divide-slate-900">
                      {filteredMatches.map((match, index) => {
                        const whitePlayer = match.whitePlayerId ? playerMap.get(match.whitePlayerId) : null;
                        const blackPlayer = match.blackPlayerId ? playerMap.get(match.blackPlayerId) : null;

                        const isCompleted = match.status === 'completed';
                        const isUnlocked = unlockedMatches.has(match.id);
                        const isEditable = !isCompleted || isUnlocked;

                        const curValues = inputValues[match.id] || { white: '', black: '' };
                        const curStatus = saveStatus[match.id] || 'idle';

                        return (
                          <div 
                            key={match.id}
                            className={`flex flex-col sm:flex-row sm:items-center justify-between p-4 gap-4 transition-colors duration-200 border-l-2 ${getMatchRowColor(match)}`}
                          >
                            {/* Board Number */}
                            <div className="flex items-center gap-3 min-w-[70px]">
                              <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs font-bold font-mono shadow-inner border border-slate-200/50">
                                {match.board}
                              </div>
                              <span className="text-[10px] uppercase font-bold text-slate-400 sm:hidden">Board</span>
                            </div>

                            {/* Matchup Entry Grid */}
                            <div className="flex-1 grid grid-cols-5 items-center gap-2">
                              {/* White Player */}
                              <div 
                                onClick={() => handlePlayerClick(match.id, 'white', !isEditable)}
                                className={`col-span-2 text-right cursor-pointer select-none group transition-all duration-200 ${
                                  isEditable ? "hover:translate-x-[-2px]" : ""
                                }`}
                              >
                                <div className="font-bold text-slate-900 dark:text-slate-100 text-sm group-hover:text-primary leading-tight">
                                  {whitePlayer ? `${whitePlayer.firstName} ${whitePlayer.lastName}` : "Bye"}
                                </div>
                                <div className="text-[10px] text-slate-500 font-semibold mt-0.5">
                                  White {whitePlayer?.rating ? `(${whitePlayer.rating})` : ""}
                                </div>
                              </div>

                              {/* Inputs Columns */}
                              <div className="col-span-1 flex items-center justify-center gap-1">
                                <Input
                                  ref={(el) => { inputRefs.current[`${match.id}-white`] = el; }}
                                  value={curValues.white}
                                  placeholder="-"
                                  disabled={!isEditable}
                                  onChange={(e) => {
                                    const val = e.target.value;
                                    setInputValues(prev => ({
                                      ...prev,
                                      [match.id]: { ...prev[match.id], white: val }
                                    }));
                                  }}
                                  onKeyDown={(e) => handleKeyDown(e, match.id, 'white', index)}
                                  className="w-10 h-8 text-center p-0 font-bold font-mono text-sm shadow-sm border-slate-200 rounded-lg focus-visible:ring-1 focus-visible:ring-primary focus-visible:border-primary disabled:bg-slate-50/50 disabled:border-transparent disabled:shadow-none"
                                />
                                <span className="text-xs text-slate-400 font-bold">:</span>
                                <Input
                                  ref={(el) => { inputRefs.current[`${match.id}-black`] = el; }}
                                  value={curValues.black}
                                  placeholder="-"
                                  disabled={!isEditable}
                                  onChange={(e) => {
                                    const val = e.target.value;
                                    setInputValues(prev => ({
                                      ...prev,
                                      [match.id]: { ...prev[match.id], black: val }
                                    }));
                                  }}
                                  onKeyDown={(e) => handleKeyDown(e, match.id, 'black', index)}
                                  className="w-10 h-8 text-center p-0 font-bold font-mono text-sm shadow-sm border-slate-200 rounded-lg focus-visible:ring-1 focus-visible:ring-primary focus-visible:border-primary disabled:bg-slate-50/50 disabled:border-transparent disabled:shadow-none"
                                />
                              </div>

                              {/* Black Player */}
                              <div 
                                onClick={() => handlePlayerClick(match.id, 'black', !isEditable)}
                                className={`col-span-2 text-left cursor-pointer select-none group transition-all duration-200 ${
                                  isEditable ? "hover:translate-x-[2px]" : ""
                                }`}
                              >
                                <div className="font-bold text-slate-900 dark:text-slate-100 text-sm group-hover:text-primary leading-tight">
                                  {blackPlayer ? `${blackPlayer.firstName} ${blackPlayer.lastName}` : "Bye"}
                                </div>
                                <div className="text-[10px] text-slate-500 font-semibold mt-0.5">
                                  Black {blackPlayer?.rating ? `(${blackPlayer.rating})` : ""}
                                </div>
                              </div>
                            </div>

                            {/* Saving Status & Lock / Override actions */}
                            <div className="flex items-center justify-end gap-3 min-w-[110px]">
                              {/* Status Indicators */}
                              {curStatus === 'saving' && (
                                <Loader2 className="h-4 w-4 text-primary animate-spin" />
                              )}
                              {curStatus === 'saved' && (
                                <div className="flex items-center text-xs font-bold text-emerald-600 animate-fade-in gap-1">
                                  <CheckCircle2 className="h-3.5 w-3.5" />
                                  <span>Saved</span>
                                </div>
                              )}
                              {curStatus === 'error' && (
                                <Badge variant="destructive" className="text-[10px] font-bold py-0.5">Error</Badge>
                              )}
                              {curStatus === 'idle' && isCompleted && !isUnlocked && (
                                <div className="flex items-center text-xs font-bold text-slate-500 gap-1">
                                  <Check className="h-3.5 w-3.5" />
                                  <span>Completed</span>
                                </div>
                              )}

                              {/* Override Button */}
                              {isCompleted ? (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => toggleLock(match.id)}
                                  className={`h-8 px-2.5 rounded-lg border text-xs font-semibold ${
                                    isUnlocked 
                                      ? "border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100" 
                                      : "border-slate-200 text-slate-600 hover:text-slate-900"
                                  }`}
                                >
                                  {isUnlocked ? (
                                    <>
                                      <Unlock className="h-3.5 w-3.5 mr-1" />
                                      Locking
                                    </>
                                  ) : (
                                    <>
                                      <Lock className="h-3.5 w-3.5 mr-1" />
                                      Override
                                    </>
                                  )}
                                </Button>
                              ) : (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => {
                                    const saved = saveMatchResult(match.id, curValues.white, curValues.black);
                                    if (!saved) {
                                      toast({
                                        title: "Invalid result",
                                        description: "Enter a result (1, 0, or 1/2) first.",
                                        variant: "destructive"
                                      });
                                    }
                                  }}
                                  className="h-8 px-3 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 text-xs font-bold"
                                >
                                  Save Result
                                </Button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        </main>
      </div>
    </>
  );
}
