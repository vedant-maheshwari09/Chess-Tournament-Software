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

    const handleApplyCustomResult = (codeToApply?: string) => {
      const code = codeToApply || customResult;
      let normalized = normalizeMatchResult(code);
      if (!normalized) {
        toast({
          title: "Invalid Code",
          description: `"${code}" is not a recognized chess result code. Common codes: 1-0, 0-1, 1/2-1/2, 1F-0, 0-1F, 0F-0F, 1-bye, 1/2-bye.`,
          variant: "destructive"
        });
        return;
      }
      if (isUnrated && !normalized.endsWith("U")) {
        normalized = `${normalized}U`;
      }
      updateResultMutation.mutate({ matchId: match.id, result: normalized });
      setCustomResult(normalized);
      toast({
        title: "Result Recorded",
        description: `Result updated to ${normalized}`
      });
    };

    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-[500px] bg-gradient-to-b from-slate-900 to-slate-950 text-white border-slate-800 shadow-2xl p-0 rounded-2xl overflow-hidden font-sans">
          {/* Header Section */}
          <div className="p-6 bg-gradient-to-r from-indigo-950/40 via-purple-950/20 to-slate-950 border-b border-slate-800/60 relative">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-indigo-500 animate-pulse"></span>
                <span className="text-xs font-bold uppercase tracking-widest text-indigo-400">Match Management</span>
              </div>
              <Badge variant="outline" className="text-[10px] font-black uppercase tracking-wider bg-indigo-500/10 border-indigo-500/30 text-indigo-300">
                {isByeMatch ? 'Bye Round' : `Board ${match.board}`}
              </Badge>
            </div>
            <h3 className="text-xl font-extrabold tracking-tight mt-2 flex items-center gap-2 text-slate-100">
              {isByeMatch ? `Bye Details — Round ${match.round}` : `Matchup — Round ${match.round}`}
            </h3>
            <p className="text-xs text-slate-400 font-medium mt-1">
              {isByeMatch ? "Select the point value for this player's round bye." : "Select the result or record forfeit wins/losses."}
            </p>
          </div>

          <div className="p-6 space-y-6">
            {/* Player Broadcast Scoreboard */}
            {isByeMatch ? (
              <div className="p-4 rounded-xl bg-slate-900/50 border border-slate-800 flex items-center gap-4 hover:border-slate-700 transition-all">
                <div className="w-12 h-12 rounded-xl bg-indigo-500/10 text-indigo-400 flex items-center justify-center font-bold text-sm border border-indigo-500/20">
                  BYE
                </div>
                <div className="flex-1">
                  <div className="text-base font-extrabold text-slate-100">{whiteName}</div>
                  <div className="text-xs text-slate-400 font-semibold mt-0.5">Rating: {whiteRating} • Assigned 1.0 Pt Bye</div>
                </div>
              </div>
            ) : (
              <div className="relative rounded-2xl bg-slate-955/80 border border-slate-800/80 p-4 flex items-center justify-between gap-4">
                {/* White Player */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="w-3.5 h-3.5 rounded bg-white border border-slate-700 shadow-inner flex-shrink-0" />
                    <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">White</span>
                  </div>
                  <div className="text-sm font-black text-slate-100 truncate" title={whiteName}>{whiteName}</div>
                  <div className="text-[10px] text-slate-400 font-bold mt-0.5">Rtg: {whiteRating}</div>
                </div>

                {/* VS Badge */}
                <div className="w-10 h-10 rounded-full bg-slate-900 border border-slate-800 flex items-center justify-center flex-shrink-0 z-10 shadow-lg">
                  <Swords className="h-4 w-4 text-indigo-400" />
                </div>

                {/* Black Player */}
                <div className="flex-1 min-w-0 text-right">
                  <div className="flex items-center gap-2 mb-1.5 justify-end">
                    <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Black</span>
                    <span className="w-3.5 h-3.5 rounded bg-slate-800 border border-slate-950 shadow-inner flex-shrink-0" />
                  </div>
                  <div className="text-sm font-black text-slate-100 truncate" title={blackName}>{blackName}</div>
                  <div className="text-[10px] text-slate-400 font-bold mt-0.5">Rtg: {blackRating}</div>
                </div>
              </div>
            )}

            {/* Selection Options */}
            <div className="space-y-4">
              {isByeMatch ? (
                <div className="space-y-3">
                  <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Select Bye Points</h4>
                  <div className="grid grid-cols-3 gap-2.5">
                    {[
                      { val: '1-bye', label: '1.0 Pt Bye', desc: 'Full Point' },
                      { val: '1/2-bye', label: '½ Pt Bye', desc: 'Half Point' },
                      { val: '0-bye', label: '0 Pt Bye', desc: 'Zero Point' },
                    ].map((opt) => (
                      <button
                        key={opt.val}
                        type="button"
                        onClick={() => handleSelectResult(opt.val)}
                        className={cn(
                          "flex flex-col items-center justify-center p-3 rounded-xl border font-bold text-xs transition-all shadow-sm",
                          baseResult === opt.val
                            ? "bg-indigo-600/20 border-indigo-500 text-indigo-300 ring-1 ring-indigo-500/30"
                            : "bg-slate-900/30 border-slate-800 text-slate-300 hover:border-slate-700 hover:bg-slate-900/50"
                        )}
                      >
                        <span>{opt.label}</span>
                        <span className="text-[9px] font-semibold text-slate-400 mt-0.5">{opt.desc}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  {/* Match Result Segment */}
                  <div className="space-y-2.5">
                    <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Standard Match Result</h4>
                    <div className="grid grid-cols-3 gap-2.5">
                      {[
                        { val: '1-0', label: '1 - 0', desc: 'White Win', activeClass: 'bg-emerald-600/20 border-emerald-500 text-emerald-400 ring-1 ring-emerald-500/30' },
                        { val: '1/2-1/2', label: '½ - ½', desc: 'Draw Game', activeClass: 'bg-amber-600/20 border-amber-500 text-amber-400 ring-1 ring-amber-500/30' },
                        { val: '0-1', label: '0 - 1', desc: 'Black Win', activeClass: 'bg-indigo-600/20 border-indigo-500 text-indigo-400 ring-1 ring-indigo-500/30' },
                      ].map((opt) => (
                        <button
                          key={opt.val}
                          type="button"
                          onClick={() => handleSelectResult(opt.val)}
                          className={cn(
                            "flex flex-col items-center justify-center p-3 rounded-xl border font-extrabold text-sm transition-all shadow-sm",
                            baseResult === opt.val
                              ? opt.activeClass
                              : "bg-slate-900/30 border-slate-800 text-slate-300 hover:border-slate-700 hover:bg-slate-900/50"
                          )}
                        >
                          <span>{opt.label}</span>
                          <span className="text-[9px] font-semibold text-slate-400 mt-0.5">{opt.desc}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Forfeits Segment */}
                  <div className="space-y-2.5 pt-1">
                    <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Forfeits & Special Scoring</h4>
                    <div className="grid grid-cols-2 gap-2.5">
                      {[
                        { val: '1F-0F', label: '1F - 0', desc: 'White Forfeit Win' },
                        { val: '0F-1F', label: '0 - 1F', desc: 'Black Forfeit Win' },
                        { val: '0F-0F', label: '0F - 0F', desc: 'Double Forfeit (No Show)' },
                        { val: '1F-1F', label: '1F - 1F', desc: 'Forfeit Draw (Mutual)' },
                      ].map((opt) => (
                        <button
                          key={opt.val}
                          type="button"
                          onClick={() => handleSelectResult(opt.val)}
                          className={cn(
                            "flex items-center justify-between px-4 py-2.5 rounded-xl border font-bold text-xs transition-all shadow-sm text-left",
                            baseResult === opt.val
                              ? "bg-rose-955/20 border-rose-500 text-rose-300 ring-1 ring-rose-500/30"
                              : "bg-slate-900/30 border-slate-800 text-slate-300 hover:border-slate-700 hover:bg-slate-900/50"
                          )}
                        >
                          <div className="flex flex-col">
                            <span className="font-extrabold">{opt.label}</span>
                            <span className="text-[9px] font-semibold text-slate-400 mt-0.5">{opt.desc}</span>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Custom Result Code Input */}
              <div className="space-y-2.5 pt-4 border-t border-slate-800 mt-4">
                <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Or Enter Custom Code</h4>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <input
                      type="text"
                      value={customResult}
                      onChange={(e) => setCustomResult(e.target.value)}
                      placeholder={isByeMatch ? "e.g. 1/2-bye, 0-bye" : "e.g. 1F-0, 0-1F, 1/2-0"}
                      className="flex h-10 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-1.5 text-sm shadow-inner transition-colors placeholder:text-slate-500 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-indigo-500 text-slate-100"
                    />
                  </div>
                  <Button
                    type="button"
                    className="h-10 px-5 font-bold text-xs uppercase tracking-wider rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white shadow"
                    onClick={() => handleApplyCustomResult()}
                  >
                    Apply
                  </Button>
                </div>

                {/* Clickable Quick Suggestions */}
                <div className="flex flex-wrap items-center gap-1.5 mt-2">
                  <span className="text-[9px] text-slate-500 font-bold uppercase mr-1">Quick Codes:</span>
                  {(isByeMatch ? ['1-bye', '1/2-bye', '0-bye'] : ['1-0', '0-1', '1/2-1/2', '1F-0', '0-1F', '0F-0F']).map((code) => (
                    <button
                      key={code}
                      type="button"
                      onClick={() => {
                        setCustomResult(code);
                        handleApplyCustomResult(code);
                      }}
                      className="text-[10px] font-mono bg-slate-900 border border-slate-800 text-indigo-400 hover:text-indigo-300 hover:border-slate-700 px-2 py-0.5 rounded-md transition-all"
                    >
                      {code}
                    </button>
                  ))}
                </div>
              </div>

              {/* Options & Reset */}
              <div className="flex items-center justify-between pt-4 border-t border-slate-800 mt-6">
                <div className="flex items-center gap-3">
                  <div className="flex items-center">
                    <input
                      type="checkbox"
                      id="unrated-toggle"
                      checked={isUnrated}
                      onChange={handleToggleUnrated}
                      disabled={!currentResult || currentResult === 'Pending'}
                      className="h-4.5 w-4.5 rounded-lg border-slate-800 bg-slate-950 text-indigo-600 focus:ring-indigo-500 cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                    />
                  </div>
                  <label
                    htmlFor="unrated-toggle"
                    className="text-xs font-bold text-slate-300 cursor-pointer select-none disabled:opacity-30"
                  >
                    Unrated Match (e.g., unrated)
                  </label>
                </div>
                
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => handleSelectResult(null)}
                  disabled={!currentResult}
                  className="text-xs font-extrabold text-rose-400 hover:text-rose-300 hover:bg-rose-950/20 rounded-lg h-8 px-3 transition-colors"
                >
                  Reset Match
                </Button>
              </div>
            </div>
          </div>

          <DialogFooter className="p-4 bg-slate-950 border-t border-slate-800/60 flex justify-end items-center px-6">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
              className="h-9 px-6 text-xs font-bold uppercase tracking-wider text-slate-300 border-slate-800 hover:bg-slate-900 hover:text-white rounded-xl transition-all"
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
