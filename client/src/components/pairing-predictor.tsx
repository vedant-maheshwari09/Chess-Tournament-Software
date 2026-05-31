import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { 
  Calculator, 
  Play, 
  RotateCcw, 
  AlertCircle, 
  Search, 
  User, 
  TrendingUp, 
  Sparkles,
  ShieldAlert,
  Loader2
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { Tournament, Player, Match } from "@shared/schema";

interface PairingPredictorProps {
  tournamentId: number;
  tournament: Tournament;
}

type MatchResult = "unplayed" | "white-win" | "black-win" | "draw";

interface PredictedPairing {
  board: number;
  whitePlayerId: number | null;
  blackPlayerId: number | null;
  isBye?: boolean;
  byeType?: string | null;
}

export default function PairingPredictor({ tournamentId, tournament }: PairingPredictorProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedPlayerId, setSelectedPlayerId] = useState<number | null>(null);
  const [predictedResults, setPredictedResults] = useState<Record<number, MatchResult>>({});
  const [predictedPairings, setPredictedPairings] = useState<PredictedPairing[]>([]);
  const [showPredictedPairings, setShowPredictedPairings] = useState(false);
  const { toast } = useToast();

  // Fetch matches
  const { data: matches = [], isLoading: matchesLoading } = useQuery<Match[]>({
    queryKey: [`/api/tournaments/${tournamentId}/matches`],
  });

  // Fetch players
  const { data: players = [], isLoading: playersLoading } = useQuery<Player[]>({
    queryKey: [`/api/tournaments/${tournamentId}/players`],
  });

  const currentRound = tournament.currentRound || 0;

  const selectedPlayer = useMemo(() => {
    if (!selectedPlayerId) return null;
    return players.find(p => p.id === selectedPlayerId) || null;
  }, [players, selectedPlayerId]);

  const hasMultipleSections = useMemo(() => {
    const secSet = new Set<string>();
    players.forEach(p => {
      secSet.add(p.sectionId || p.sectionName || 'default');
    });
    return secSet.size > 1;
  }, [players]);

  const currentRoundMatches = useMemo(() => {
    const roundMatches = matches.filter(match => match.round === currentRound);
    let filtered: Match[];
    if (!selectedPlayer) {
      filtered = roundMatches;
    } else {
      filtered = roundMatches.filter(match => {
        const whitePlayer = players.find(p => p.id === match.whitePlayerId);
        const blackPlayer = players.find(p => p.id === match.blackPlayerId);
        const playerSection = selectedPlayer.sectionId || selectedPlayer.sectionName || 'default';
        const whiteSection = whitePlayer ? (whitePlayer.sectionId || whitePlayer.sectionName || 'default') : 'default';
        const blackSection = blackPlayer ? (blackPlayer.sectionId || blackPlayer.sectionName || 'default') : 'default';
        return whiteSection === playerSection || blackSection === playerSection;
      });
    }
    // Sort by board number so Live Standings shows in correct board order
    return [...filtered].sort((a, b) => (a.board ?? 9999) - (b.board ?? 9999));
  }, [matches, currentRound, selectedPlayer, players]);

  // Autocomplete suggestions
  const playerSuggestions = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const query = searchQuery.toLowerCase();
    return players.filter(
      p => 
        p.firstName.toLowerCase().includes(query) || 
        p.lastName.toLowerCase().includes(query)
    ).slice(0, 5);
  }, [players, searchQuery]);

  const getPlayerName = (playerId: number | null) => {
    if (!playerId) return "BYE";
    const player = players.find(p => p.id === playerId);
    if (!player) return "Unknown";
    return `${player.firstName} ${player.lastName}`;
  };

  const handleResultChange = (matchId: number, result: MatchResult) => {
    setPredictedResults(prev => ({
      ...prev,
      [matchId]: result
    }));
  };

  const predictMutation = useMutation({
    mutationFn: async (simulatedResults: { matchId: number; result: string }[]) => {
      const response = await apiRequest(`/api/tournaments/${tournamentId}/predict-pairings`, {
        method: "POST",
        body: JSON.stringify({ simulatedResults }),
      });
      return response;
    },
    onSuccess: (data: { pairings: PredictedPairing[] }) => {
      setPredictedPairings(data.pairings || []);
      setShowPredictedPairings(true);
      toast({
        title: "Prediction Generated",
        description: `Successfully computed predicted matchups for Round ${currentRound + 1}`,
      });
    },
    onError: (error: any) => {
      toast({
        title: "Prediction Failed",
        description: error?.message ?? "Make sure the tournament is active and has started.",
        variant: "destructive",
      });
    },
  });

  const handlePredict = () => {
    if (!selectedPlayerId) {
      toast({
        title: "Player Selection Required",
        description: "Please select your name first to find your predicted pairing.",
        variant: "destructive",
      });
      return;
    }

    const hasUnplayed = currentRoundMatches.some(match => {
      const resVal = predictedResults[match.id];
      return !match.result && (!resVal || resVal === 'unplayed');
    });

    if (hasUnplayed) {
      const sectionName = selectedPlayer?.sectionName || "your";
      const confirmMessage = `Are you sure? Some results were left unset in ${sectionName} section. They will be set to 1/2-1/2.`;
      if (!window.confirm(confirmMessage)) {
        return;
      }
    }

    // Prepare simulated results list.
    const simulatedResults = currentRoundMatches.map(match => {
      let resultVal = predictedResults[match.id];
      if (!resultVal || resultVal === 'unplayed') {
        if (match.result) {
          resultVal = match.result === "1-0" ? "white-win" : match.result === "0-1" ? "black-win" : "draw";
        } else {
          resultVal = "draw"; // default unset pending matches to draw
        }
      }
      return {
        matchId: match.id,
        result: resultVal
      };
    });

    predictMutation.mutate(simulatedResults);
  };

  const handleReset = () => {
    setPredictedResults({});
    setShowPredictedPairings(false);
    setPredictedPairings([]);
    setSelectedPlayerId(null);
    setSearchQuery("");
  };

  // Find the selected player's predicted pairing
  const myPredictedPairing = useMemo(() => {
    if (!selectedPlayerId || predictedPairings.length === 0) return null;
    return predictedPairings.find(
      p => p.whitePlayerId === selectedPlayerId || p.blackPlayerId === selectedPlayerId
    );
  }, [predictedPairings, selectedPlayerId]);

  if (tournament.format !== 'swiss') {
    return (
      <Card className="border-indigo-100 bg-white/50 backdrop-blur">
        <CardContent className="pt-8 text-center space-y-4">
          <div className="mx-auto w-12 h-12 rounded-full bg-indigo-50 flex items-center justify-center">
            <Calculator className="h-6 w-6 text-indigo-500" />
          </div>
          <div className="space-y-2">
            <h3 className="text-lg font-semibold text-indigo-900">Pairing Predictor</h3>
            <p className="text-slate-500 max-w-md mx-auto text-sm">
              Pairing prediction is only available for Swiss events.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (tournament.status !== 'active' || currentRound === 0) {
    return (
      <Card className="border-indigo-100 bg-white/50 backdrop-blur">
        <CardContent className="pt-8 text-center space-y-4">
          <div className="mx-auto w-12 h-12 rounded-full bg-indigo-50 flex items-center justify-center">
            <Calculator className="h-6 w-6 text-indigo-500" />
          </div>
          <div className="space-y-2">
            <h3 className="text-lg font-semibold text-indigo-900">Pairing Predictor</h3>
            <p className="text-slate-500 max-w-md mx-auto text-sm">
              Pairing predictor is available once the Swiss tournament starts and is active.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-6 md:grid-cols-3">
        {/* Left Side: Controls & Player Search */}
        <Card className="md:col-span-1 border-indigo-100 bg-white/70 backdrop-blur shadow-sm">
          <CardHeader>
            <CardTitle className="text-lg font-bold text-indigo-900 flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-indigo-600" />
              <span>Select Player</span>
            </CardTitle>
            <CardDescription>
              Select the player to find their predicted next opponent.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2 relative">
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Search Player Name</label>
              <div className="relative">
                <Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
                <Input
                  placeholder="Type player name..."
                  className="pl-9 border-indigo-100 focus:border-indigo-500 focus:ring-indigo-500"
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    if (selectedPlayerId) setSelectedPlayerId(null);
                  }}
                />
              </div>

              {/* Suggestions dropdown */}
              {playerSuggestions.length > 0 && (
                <div className="absolute z-10 w-full bg-white border border-indigo-100 rounded-lg shadow-lg mt-1 divide-y">
                  {playerSuggestions.map(p => (
                    <button
                      key={p.id}
                      className="w-full text-left px-4 py-2.5 text-sm hover:bg-indigo-50 transition-colors flex items-center gap-2"
                      onClick={() => {
                        setSelectedPlayerId(p.id);
                        setSearchQuery(`${p.firstName} ${p.lastName}`);
                      }}
                    >
                      <User className="h-4 w-4 text-indigo-400" />
                      <span className="font-medium text-slate-800">{p.firstName} {p.lastName}</span>
                      {hasMultipleSections && p.sectionName && (
                        <Badge variant="outline" className="border-indigo-100 text-indigo-700 bg-indigo-50/50 text-[10px] ml-2">
                          {p.sectionName}
                        </Badge>
                      )}
                      <span className="text-xs text-slate-400 ml-auto">Rating: {p.rating ?? "1000"}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {selectedPlayerId && (
              <div className="p-3 bg-indigo-50/70 border border-indigo-100 rounded-lg flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center font-bold text-sm">
                  {getPlayerName(selectedPlayerId).split(" ").map(n => n[0]).join("")}
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-indigo-900">{getPlayerName(selectedPlayerId)}</h4>
                  <p className="text-xs text-slate-500">
                    Active Player {selectedPlayer?.sectionName ? `• ${selectedPlayer.sectionName}` : ''}
                  </p>
                </div>
              </div>
            )}

            <div className="pt-4 space-y-2 border-t border-slate-100">
              <Button
                onClick={handlePredict}
                disabled={!selectedPlayerId || predictMutation.isPending}
                className="w-full bg-indigo-600 hover:bg-indigo-700 text-white flex items-center justify-center gap-2"
              >
                {predictMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin text-white" />
                ) : (
                  <Play className="h-4 w-4" />
                )}
                <span>Predict Matchup</span>
              </Button>
              <Button
                variant="outline"
                onClick={handleReset}
                className="w-full border-slate-200 text-slate-600 hover:bg-slate-50 flex items-center justify-center gap-2"
              >
                <RotateCcw className="h-4 w-4" />
                <span>Reset</span>
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Right Side: Current Round Match Table */}
        <Card className="md:col-span-2 border-indigo-100 bg-white/70 backdrop-blur shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-lg font-bold text-indigo-900">
                Round {currentRound} Live Standings & Simulation
                {selectedPlayer?.sectionName && ` (${selectedPlayer.sectionName})`}
              </CardTitle>
              <CardDescription>
                Simulate pending matches. Unset matches default to Draw (½-½).
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            {matchesLoading || playersLoading ? (
              <div className="flex flex-col items-center justify-center py-12 text-slate-500 text-sm gap-2">
                <Loader2 className="h-8 w-8 animate-spin text-indigo-500" />
                <span>Loading round matches...</span>
              </div>
            ) : currentRoundMatches.length === 0 ? (
              <div className="text-center py-12 border border-dashed rounded-xl">
                <AlertCircle className="h-10 w-10 text-slate-400 mx-auto mb-3" />
                <p className="text-slate-500 text-sm">
                  {selectedPlayerId ? "No pairings exist for this player's section in the current round." : "No pairings exist for the current round."}
                </p>
              </div>
            ) : (
              <div className="space-y-3 max-h-[400px] overflow-y-auto pr-1">
                {currentRoundMatches.map((match) => {
                  const dbResult = match.result;
                  // A match is "completed" if it has a real non-Pending result
                  const isCompleted = !!dbResult && dbResult !== 'Pending';
                  // Determine current sim value: user override → DB result (converted) → unplayed
                  const currentSimVal: MatchResult = predictedResults[match.id] !== undefined
                    ? predictedResults[match.id]
                    : (dbResult && dbResult !== 'Pending')
                      ? (dbResult === '1-0' ? 'white-win' : dbResult === '0-1' ? 'black-win' : 'draw')
                      : 'unplayed';

                  return (
                    <div 
                      key={match.id} 
                      className={cn(
                        "flex flex-col sm:flex-row items-stretch sm:items-center justify-between border rounded-xl p-4 gap-4 bg-white/50 transition-colors",
                        isCompleted && "bg-slate-50/50 border-slate-100"
                      )}
                    >
                      <div className="flex items-center gap-3">
                        <Badge variant="outline" className="border-indigo-200 text-indigo-700 bg-indigo-50 font-semibold h-6">
                          Board {match.board ?? "?"}
                        </Badge>
                        <div className="text-sm font-medium text-slate-700 flex items-center gap-2">
                          <span className="font-semibold text-slate-900">{getPlayerName(match.whitePlayerId)}</span>
                          <span className="text-slate-400 text-xs px-1 py-0.5 bg-slate-100 rounded">W</span>
                          <span className="text-slate-400 font-normal">vs</span>
                          <span className="font-semibold text-slate-900">{getPlayerName(match.blackPlayerId)}</span>
                          <span className="text-slate-400 text-xs px-1 py-0.5 bg-slate-100 rounded">B</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 justify-end self-end sm:self-center">
                        <span className="text-xs font-semibold text-slate-500">Result:</span>
                        <Select
                          value={currentSimVal}
                          onValueChange={(value: MatchResult) => handleResultChange(match.id, value)}
                        >
                          <SelectTrigger className={cn(
                            "w-28 h-9 focus:ring-indigo-500",
                            isCompleted ? "border-emerald-200 bg-emerald-50/50" : "border-indigo-100"
                          )}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="unplayed">Pending</SelectItem>
                            <SelectItem value="draw">½-½ (Draw)</SelectItem>
                            <SelectItem value="white-win">1-0 (White Win)</SelectItem>
                            <SelectItem value="black-win">0-1 (Black Win)</SelectItem>
                          </SelectContent>
                        </Select>
                        {isCompleted && currentSimVal !== (dbResult === '1-0' ? 'white-win' : dbResult === '0-1' ? 'black-win' : 'draw') && (
                          <span className="text-[10px] text-amber-600 font-semibold">Simulated</span>
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

      {/* Results and predicted pairings */}
      {showPredictedPairings && (
        <Card className="border-indigo-200 bg-indigo-50/20 backdrop-blur shadow-md">
          <CardHeader>
            <CardTitle className="text-xl font-bold text-indigo-900 flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-indigo-500 animate-pulse" />
              <span>Simulation Results: Round {currentRound + 1} Predictions</span>
            </CardTitle>
            <CardDescription>
              Predicted matchups generated in-memory using Chess Backtracking Swiss Pairing algorithm.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Highlighted Selected Player Matching */}
            {selectedPlayerId && (
              <div className="p-6 bg-gradient-to-r from-indigo-500 to-indigo-600 text-white rounded-2xl shadow-lg border border-indigo-400">
                <div className="flex flex-col md:flex-row items-center justify-between gap-6">
                  <div className="space-y-1">
                    <span className="text-xs font-bold uppercase tracking-wider text-indigo-200">Your Predicted Pairing</span>
                    <h3 className="text-2xl font-black">{getPlayerName(selectedPlayerId)}</h3>
                  </div>

                  {myPredictedPairing ? (
                    myPredictedPairing.isBye ? (
                      <div className="bg-white/20 backdrop-blur border border-white/30 rounded-xl px-6 py-3 text-center">
                        <span className="text-sm font-bold block text-indigo-100">Round {currentRound + 1} Pairing</span>
                        <span className="text-xl font-black tracking-wide uppercase">BYE (1.0 Point)</span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-4 bg-white/10 backdrop-blur border border-white/20 rounded-xl p-4">
                        <div className="text-center">
                          <span className="text-xs text-indigo-200 font-semibold block uppercase">Board</span>
                          <span className="text-lg font-bold">{myPredictedPairing.board}</span>
                        </div>
                        <div className="h-8 w-px bg-white/20" />
                        <div>
                          <span className="text-xs text-indigo-200 font-semibold block uppercase">Opponent</span>
                          <span className="text-lg font-bold">
                            {myPredictedPairing.whitePlayerId === selectedPlayerId
                              ? getPlayerName(myPredictedPairing.blackPlayerId)
                              : getPlayerName(myPredictedPairing.whitePlayerId)}
                          </span>
                        </div>
                        <div className="h-8 w-px bg-white/20" />
                        <div className="text-center">
                          <span className="text-xs text-indigo-200 font-semibold block uppercase">Color</span>
                          <span className="text-lg font-bold">
                            {myPredictedPairing.whitePlayerId === selectedPlayerId ? "White" : "Black"}
                          </span>
                        </div>
                      </div>
                    )
                  ) : (
                    <div className="bg-red-500/20 backdrop-blur border border-red-500/30 rounded-xl px-6 py-3 text-center flex items-center gap-2">
                      <ShieldAlert className="h-5 w-5 text-red-100" />
                      <span className="text-sm font-bold text-red-100">Not Paired (Withdrawn or Bye request)</span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
