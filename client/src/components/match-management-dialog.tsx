import { useState, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus, Swords, History, CheckCircle2, RotateCcw } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Match, Player } from "@shared/schema";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeftRight } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { calculateMatchupScore, getMatchFormat, parseTournamentConfig } from "@shared/tournament-config";
import { cn } from "@/lib/utils";
import { HEAD_TO_HEAD_RESULT_OPTIONS, normalizeMatchResult } from "@shared/match-results";

interface MatchManagementDialogProps {
  match: Match | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  players: Player[];
  allMatches: Match[];
  isTD: boolean;
  tournamentId: number;
  format?: string;
  onMatchUpdated: () => void;
}

export function MatchManagementDialog({
  match,
  open,
  onOpenChange,
  players,
  allMatches,
  isTD,
  tournamentId,
  format,
  onMatchUpdated
}: MatchManagementDialogProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [customResult, setCustomResult] = useState("");
  useEffect(() => {
    if (match) {
      setCustomResult(match.result || "");
    }
  }, [match]);

  const addGameMutation = useMutation({
    mutationFn: async () => {
      if (!match) return;
      const seriesGames = allMatches
        .filter(m =>
          m.round === match.round &&
          m.board === match.board &&
          m.bracketType === match.bracketType &&
          m.sectionId === match.sectionId
        )
        .sort((a, b) => (a.gameNumber || 0) - (b.gameNumber || 0));
      const lastGame = seriesGames.length > 0 ? seriesGames[seriesGames.length - 1] : null;
      const nextWhite = lastGame ? lastGame.blackPlayerId : match.whitePlayerId;
      const nextBlack = lastGame ? lastGame.whitePlayerId : match.blackPlayerId;

      return apiRequest(`/api/tournaments/${tournamentId}/matches/${match.id}/games`, {
        method: "POST",
        body: JSON.stringify({
          whitePlayerId: nextWhite,
          blackPlayerId: nextBlack,
        })
      });
    },
    onSuccess: () => {
      toast({ title: "Game Added", description: "A new game was added to the series." });
      onMatchUpdated();
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  });

  const confirmWinnerMutation = useMutation({
    mutationFn: async (winnerId: number) => {
      if (!match) return;
      await apiRequest(`/api/tournaments/${tournamentId}/matches/${match.id}/confirm-winner`, {
        method: "POST",
        body: JSON.stringify({ winnerId })
      });
    },
    onSuccess: () => {
      toast({ title: "Winner Confirmed", description: "The winner has advanced to the next round." });
      onOpenChange(false);
      onMatchUpdated();
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  });

  const resetMatchMutation = useMutation({
    mutationFn: async () => {
      if (!match) return;
      await apiRequest(`/api/tournaments/${tournamentId}/matches/${match.id}/reset`, {
        method: "POST"
      });
    },
    onSuccess: () => {
      toast({ title: "Match Reset", description: "The results and advancement have been cleared." });
      onMatchUpdated();
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  });

  const updateResultMutation = useMutation({
    mutationFn: async ({ matchId, result }: { matchId: number, result: string | null }) => {
      await apiRequest(`/api/matches/${matchId}`, {
        method: "PUT",
        body: JSON.stringify({ result, status: result ? "completed" : "pending" })
      });
    },
    onSuccess: () => {
      toast({ title: "Result Recorded", description: "The game result has been updated." });
      queryClient.invalidateQueries({ queryKey: [`/api/tournaments/${tournamentId}/matches`] });
      onMatchUpdated();
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  });

  const swapColorsMutation = useMutation({
    mutationFn: async (game: Match) => {
      await apiRequest(`/api/matches/${game.id}`, {
        method: "PUT",
        body: JSON.stringify({
          whitePlayerId: game.blackPlayerId,
          blackPlayerId: game.whitePlayerId
        })
      });
    },
    onSuccess: () => {
      toast({ title: "Colors Swapped", description: "White and Black players have been reversed." });
      queryClient.invalidateQueries({ queryKey: [`/api/tournaments/${tournamentId}/matches`] });
      onMatchUpdated();
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  });

  if (!match) return null;

  const isKnockout = format === 'knockout';

  if (!isKnockout) {
    const currentResult = match.result; // '1-0', '1F-0F', '1-0U', etc.
    const isUnrated = currentResult ? currentResult.endsWith('U') : false;
    const baseResult = currentResult 
      ? (isUnrated ? currentResult.slice(0, -1) : currentResult) 
      : null;

    const whitePlayer = players.find(p => p.id === match.whitePlayerId);
    const blackPlayer = players.find(p => p.id === match.blackPlayerId);
    const whiteName = whitePlayer ? `${whitePlayer.firstName} ${whitePlayer.lastName}` : "Bye";
    const blackName = blackPlayer ? `${blackPlayer.firstName} ${blackPlayer.lastName}` : "Bye";
    const whiteRating = whitePlayer ? (whitePlayer.uscfRating ?? whitePlayer.rating ?? "unrated") : "unrated";
    const blackRating = blackPlayer ? (blackPlayer.uscfRating ?? blackPlayer.rating ?? "unrated") : "unrated";

    const isByeMatch = match.isBye || !match.blackPlayerId;

    const handleSelectResult = (baseRes: string | null) => {
      if (!baseRes) {
        updateResultMutation.mutate({ matchId: match.id, result: null });
        setCustomResult("");
        return;
      }
      const finalResult = isUnrated ? `${baseRes}U` : baseRes;
      updateResultMutation.mutate({ matchId: match.id, result: finalResult });
      setCustomResult(finalResult);
    };

    const handleToggleUnrated = () => {
      if (!currentResult || currentResult === 'Pending') return;
      let newResult: string;
      if (isUnrated) {
        newResult = currentResult.slice(0, -1);
      } else {
        newResult = `${currentResult}U`;
      }
      updateResultMutation.mutate({ matchId: match.id, result: newResult });
      setCustomResult(newResult);
    };

    const handleApplyCustomResult = () => {
      let normalized = normalizeMatchResult(customResult);
      if (!normalized) {
        toast({
          title: "Invalid Code",
          description: `"${customResult}" is not a recognized chess result code. Common codes: 1-0, 0-1, 1/2-1/2, 1F-0, 0-1F, 0F-0F, 1-bye, 1/2-bye.`,
          variant: "destructive"
        });
        return;
      }
      if (isUnrated && !normalized.endsWith("U")) {
        normalized = `${normalized}U`;
      }
      updateResultMutation.mutate({ matchId: match.id, result: normalized });
      toast({
        title: "Result Recorded",
        description: `Result updated to ${normalized}`
      });
    };

    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-[480px] bg-card border-border text-card-foreground shadow-2xl overflow-hidden p-0 rounded-2xl">
          <DialogHeader className="p-6 bg-muted/20 border-b border-border">
            <DialogTitle className="text-xl font-black tracking-tight flex items-center justify-between">
              <span>{isByeMatch ? `Bye Details — Round ${match.round}` : `Board ${match.board} — Round ${match.round}`}</span>
              <Badge variant="outline" className="text-[10px] font-bold uppercase tracking-wider bg-primary/5 border-primary/20 text-primary">
                {format === 'roundrobin' ? 'Round Robin' : 'Swiss System'}
              </Badge>
            </DialogTitle>
            <DialogDescription className="text-muted-foreground font-medium mt-1">
              {isByeMatch ? "Record the point value for this player's bye." : "Select the outcome or enter a custom result code."}
            </DialogDescription>
          </DialogHeader>

          <div className="p-6 space-y-6">
            {/* Player Info Card */}
            {isByeMatch ? (
              <div className="p-4 rounded-xl bg-muted/30 border border-border flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary font-bold text-sm">
                  BYE
                </div>
                <div>
                  <div className="text-sm font-bold text-foreground">{whiteName}</div>
                  <div className="text-[10px] text-muted-foreground font-semibold mt-0.5">Rating: {whiteRating} • Assigned a Bye</div>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between p-4 rounded-xl bg-muted/30 border border-border">
                <div className="flex-1 text-left">
                  <div className="flex items-center gap-2">
                    <span className="w-3.5 h-3.5 rounded bg-foreground border border-border inline-block shadow-sm"></span>
                    <span className="text-sm font-bold truncate max-w-[150px]" title={whiteName}>{whiteName}</span>
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-1 font-semibold">White • Rating: {whiteRating}</div>
                </div>
                <span className="text-[10px] font-black text-muted-foreground/40 px-3 uppercase">vs</span>
                <div className="flex-1 text-right">
                  <div className="flex items-center gap-2 justify-end">
                    <span className="text-sm font-bold truncate max-w-[150px]" title={blackName}>{blackName}</span>
                    <span className="w-3.5 h-3.5 rounded bg-background border border-border inline-block shadow-sm"></span>
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-1 font-semibold">Black • Rating: {blackRating}</div>
                </div>
              </div>
            )}

            {/* Selection Options */}
            <div className="space-y-4">
              {isByeMatch ? (
                <>
                  <h4 className="text-[10px] font-black text-muted-foreground uppercase tracking-widest">Select Bye Points</h4>
                  <div className="grid grid-cols-3 gap-2">
                    <Button
                      variant={baseResult === '1-bye' ? 'default' : 'outline'}
                      className="h-11 font-bold text-xs"
                      onClick={() => handleSelectResult('1-bye')}
                    >
                      1.0 Pt Bye
                    </Button>
                    <Button
                      variant={baseResult === '1/2-bye' ? 'default' : 'outline'}
                      className="h-11 font-bold text-xs"
                      onClick={() => handleSelectResult('1/2-bye')}
                    >
                      ½ Pt Bye
                    </Button>
                    <Button
                      variant={baseResult === '0-bye' ? 'default' : 'outline'}
                      className="h-11 font-bold text-xs"
                      onClick={() => handleSelectResult('0-bye')}
                    >
                      0 Pt Bye
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <h4 className="text-[10px] font-black text-muted-foreground uppercase tracking-widest">Match Result</h4>
                  <div className="grid grid-cols-3 gap-2">
                    <Button
                      variant={baseResult === '1-0' ? 'default' : 'outline'}
                      className="h-11 font-bold text-xs"
                      onClick={() => handleSelectResult('1-0')}
                    >
                      1 - 0 (White Win)
                    </Button>
                    <Button
                      variant={baseResult === '0-1' ? 'default' : 'outline'}
                      className="h-11 font-bold text-xs"
                      onClick={() => handleSelectResult('0-1')}
                    >
                      0 - 1 (Black Win)
                    </Button>
                    <Button
                      variant={baseResult === '1/2-1/2' ? 'default' : 'outline'}
                      className="h-11 font-bold text-xs"
                      onClick={() => handleSelectResult('1/2-1/2')}
                    >
                      ½ - ½ (Draw)
                    </Button>
                  </div>

                  <h4 className="text-[10px] font-black text-muted-foreground uppercase tracking-widest pt-2">Forfeits & Special Results</h4>
                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      variant={baseResult === '1F-0F' ? 'default' : 'outline'}
                      className="h-11 font-bold text-xs"
                      onClick={() => handleSelectResult('1F-0F')}
                    >
                      1F - 0 (White Forfeit)
                    </Button>
                    <Button
                      variant={baseResult === '0F-1F' ? 'default' : 'outline'}
                      className="h-11 font-bold text-xs"
                      onClick={() => handleSelectResult('0F-1F')}
                    >
                      0 - 1F (Black Forfeit)
                    </Button>
                    <Button
                      variant={baseResult === '0F-0F' ? 'default' : 'outline'}
                      className="h-11 font-bold text-xs"
                      onClick={() => handleSelectResult('0F-0F')}
                    >
                      0F - 0F (Double Forfeit)
                    </Button>
                    <Button
                      variant={baseResult === '1F-1F' ? 'default' : 'outline'}
                      className="h-11 font-bold text-xs"
                      onClick={() => handleSelectResult('1F-1F')}
                    >
                      1F - 1F (Forfeit Draw)
                    </Button>
                  </div>
                </>
              )}

              {/* Custom Result Code Field */}
              <div className="space-y-2 pt-3 border-t border-border mt-4">
                <h4 className="text-[10px] font-black text-muted-foreground uppercase tracking-widest">Custom Result Code</h4>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={customResult}
                    onChange={(e) => setCustomResult(e.target.value)}
                    placeholder={isByeMatch ? "e.g. 1/2-bye, 0-bye" : "e.g. 1F-0, 0-1F, 1/2-0"}
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                  />
                  <Button
                    type="button"
                    size="sm"
                    className="h-9 px-4 font-bold text-xs uppercase"
                    onClick={handleApplyCustomResult}
                  >
                    Apply Code
                  </Button>
                </div>
                <p className="text-[10px] text-muted-foreground mt-1 font-semibold leading-relaxed">
                  Type any code (e.g. <span className="font-mono bg-muted px-1 rounded text-foreground">1F-0</span> or <span className="font-mono bg-muted px-1 rounded text-foreground">0-1F</span>) and the system will normalize it.
                </p>
              </div>

              {/* Options & Reset */}
              <div className="flex items-center justify-between pt-4 border-t border-border mt-6">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="unrated-toggle"
                    checked={isUnrated}
                    onChange={handleToggleUnrated}
                    disabled={!currentResult || currentResult === 'Pending'}
                    className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary cursor-pointer disabled:opacity-50"
                  />
                  <label
                    htmlFor="unrated-toggle"
                    className="text-xs font-bold text-foreground cursor-pointer select-none disabled:opacity-50"
                  >
                    Unrated Match (e.g., unrated)
                  </label>
                </div>
                
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleSelectResult(null)}
                  disabled={!currentResult}
                  className="text-xs font-bold text-destructive hover:text-destructive hover:bg-destructive/10"
                >
                  Reset to Pending
                </Button>
              </div>
            </div>
          </div>

          <DialogFooter className="p-4 bg-muted/20 border-t border-border flex justify-end items-center px-6">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
              className="h-9 px-6 text-xs font-bold uppercase tracking-wider text-muted-foreground border-border hover:bg-muted"
            >
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  const seriesGames = allMatches
    .filter(m =>
      m.round === match.round &&
      m.board === match.board &&
      m.bracketType === match.bracketType &&
      m.sectionId === match.sectionId
    )
    .sort((a, b) => (a.gameNumber || 0) - (b.gameNumber || 0));

  // Consistently define P1 and P2 based on the FIRST game of the series
  // This ensures they match the Top/Bottom slots in the bracket UI
  const { p1Id, p2Id, p1Score, p2Score } = calculateMatchupScore(seriesGames);

  const p1Player = players.find(p => p.id === p1Id);
  const p2Player = players.find(p => p.id === p2Id);

  const formatScore = (score: number) => {
    if (score % 1 === 0) return score.toString();
    return (Math.floor(score) === 0 ? "" : Math.floor(score)) + "\u00BD";
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[550px] bg-card border-border text-card-foreground shadow-2xl overflow-hidden p-0">
        <DialogHeader className="p-6 bg-muted/30 border-b border-border">
          <div className="flex items-center gap-4 mb-4">
            <div className="p-3 rounded-2xl bg-primary/10 text-primary ring-1 ring-primary/20">
              <Swords className="h-6 w-6" />
            </div>
            <div>
              <DialogTitle className="text-xl font-black tracking-tight flex items-center gap-2">
                Match {match.round}{match.board ? String.fromCharCode(64 + match.board) : ''}
                <Badge variant="outline" className="text-[10px] font-bold border-border text-muted-foreground">
                  ROUND {match.round}
                </Badge>
              </DialogTitle>
              <DialogDescription className="text-muted-foreground font-medium">
                Manage the series and confirm the advancing player.
              </DialogDescription>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 mt-6">
            <div className="p-4 rounded-xl bg-muted/50 border border-border flex flex-col items-center text-center relative group">
              <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center text-xs font-bold mb-3 border border-border">P1</div>
              <span className="text-sm font-bold text-foreground">{p1Player ? `${p1Player.firstName} ${p1Player.lastName}` : "TBD"}</span>
              <span className="text-[10px] font-black text-muted-foreground uppercase tracking-widest mt-1">PLAYER 1</span>
              <div className="mt-3 text-2xl font-black text-primary">{formatScore(p1Score)}</div>
            </div>
            <div className="p-4 rounded-xl bg-muted/50 border border-border flex flex-col items-center text-center relative group">
              <div className="w-10 h-10 rounded-full bg-background flex items-center justify-center text-xs font-bold mb-3 border border-border">P2</div>
              <span className="text-sm font-bold text-foreground">{p2Player ? `${p2Player.firstName} ${p2Player.lastName}` : "TBD"}</span>
              <span className="text-[10px] font-black text-muted-foreground uppercase tracking-widest mt-1">PLAYER 2</span>
              <div className="mt-3 text-2xl font-black text-primary">{formatScore(p2Score)}</div>
            </div>
          </div>
        </DialogHeader>

        <div className="p-6 space-y-6">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-black text-muted-foreground uppercase tracking-[0.2em] flex items-center gap-2">
                <History className="h-3 w-3" />
                Series History
              </h4>
              {isTD && format !== 'knockout' && (
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 text-[10px] font-black uppercase tracking-widest text-primary hover:text-primary hover:bg-primary/10"
                    onClick={() => addGameMutation.mutate()}
                    disabled={addGameMutation.isPending}
                  >
                    <Plus className="h-3 w-3 mr-1" />
                    Add Game
                  </Button>
                </div>
              )}
            </div>

            <div className="space-y-2 max-h-[220px] overflow-y-auto pr-2 custom-scrollbar">
              {seriesGames.map((g, idx) => (
                <div key={g.id} className="p-4 rounded-xl bg-muted/50 border border-border flex items-center justify-between group/game hover:bg-muted/70 transition-colors relative">
                  <div className="flex items-center gap-3">
                    <span className="text-[10px] font-bold text-muted-foreground w-4">G{idx + 1}</span>
                    <div className="flex flex-col gap-1 pr-4">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-foreground w-[120px] truncate">
                          <span className="inline-block w-3 h-3 bg-foreground/90 rounded-sm border border-border mr-2 opacity-80 shadow-sm align-text-bottom"></span>
                          {players.find(p => p.id === g.whitePlayerId)?.lastName || 'W'}
                        </span>
                        <span className="text-[9px] font-black text-muted-foreground/50 uppercase">vs</span>
                        <span className="text-xs font-bold text-foreground w-[120px] truncate">
                          <span className="inline-block w-3 h-3 bg-background rounded-sm border border-border mr-2 opacity-80 shadow-sm align-text-bottom"></span>
                          {players.find(p => p.id === g.blackPlayerId)?.lastName || 'B'}
                        </span>
                      </div>
                      {isTD && (
                        <button
                          onClick={() => swapColorsMutation.mutate(g)}
                          className="text-[9px] text-primary/70 hover:text-primary font-bold uppercase tracking-wider flex items-center gap-1 w-fit mt-1 opacity-0 group-hover/game:opacity-100 transition-opacity"
                          disabled={swapColorsMutation.isPending}
                        >
                          <ArrowLeftRight className="h-2.5 w-2.5" />
                          Swap Colors
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    {isTD ? (
                      <Select
                        value={g.result || "pending"}
                        onValueChange={(val) => {
                          updateResultMutation.mutate({
                            matchId: g.id,
                            result: val === "pending" ? null : val
                          });
                        }}
                      >
                        <SelectTrigger className="h-8 text-xs bg-background border-border w-[110px] font-bold text-center justify-center">
                          <SelectValue placeholder="Result" />
                        </SelectTrigger>
                        <SelectContent className="max-h-[300px]">
                          <SelectItem value="pending">Pending</SelectItem>
                          {HEAD_TO_HEAD_RESULT_OPTIONS.map((opt) => (
                            <SelectItem key={opt.value} value={opt.value}>
                              {opt.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Badge variant="outline" className="bg-background border-border text-xs font-bold">
                        {g.result || 'Pending'}
                      </Badge>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {isTD && !match.result && p1Id && p2Id && (
            <div className="space-y-3 pt-4 border-t border-border">
              <h4 className="text-[10px] font-black text-muted-foreground uppercase tracking-[0.2em] text-center mb-4">Advance Player</h4>
              <div className="grid grid-cols-2 gap-3">
                <Button
                  variant="outline"
                  className="h-12 border-border bg-muted/50 hover:bg-primary/10 hover:border-primary/50 text-foreground group/btn"
                  onClick={() => confirmWinnerMutation.mutate(p1Id)}
                  disabled={confirmWinnerMutation.isPending}
                >
                  <CheckCircle2 className="h-4 w-4 mr-2 text-muted-foreground group-hover/btn:text-primary" />
                  P1 Wins
                </Button>
                <Button
                  variant="outline"
                  className="h-12 border-border bg-muted/50 hover:bg-primary/10 hover:border-primary/50 text-foreground group/btn"
                  onClick={() => confirmWinnerMutation.mutate(p2Id)}
                  disabled={confirmWinnerMutation.isPending}
                >
                  <CheckCircle2 className="h-4 w-4 mr-2 text-muted-foreground group-hover/btn:text-primary" />
                  P2 Wins
                </Button>
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="p-4 bg-muted/20 border-t border-border flex sm:justify-between items-center px-6">
          {isTD && format !== 'knockout' && (
            <Button
              variant="ghost"
              size="sm"
              className="h-9 px-4 text-xs font-black uppercase tracking-widest text-destructive hover:text-destructive hover:bg-destructive/10"
              onClick={() => resetMatchMutation.mutate()}
              disabled={resetMatchMutation.isPending}
            >
              <RotateCcw className="h-3 w-3 mr-2" />
              Reset Match
            </Button>
          )}
          <Button variant="ghost" onClick={() => onOpenChange(false)} className="h-9 px-6 text-xs font-black uppercase tracking-widest text-muted-foreground hover:text-foreground hover:bg-muted">
            Dismiss
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
