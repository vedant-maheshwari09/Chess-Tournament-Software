import { motion, AnimatePresence } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Trophy, Info, ChevronRight, Plus, Minus, RotateCcw, Search, Medal, UserX, X, Maximize2 } from "lucide-react";
import type { Player, Match, Tournament } from "@shared/schema";
import { TransformWrapper, TransformComponent, useTransformContext } from "react-zoom-pan-pinch";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useAuth } from "@/hooks/useAuth";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { apiRequest } from "@/lib/queryClient";
import { useMemo, useState, useRef, useEffect } from "react";
import { MatchManagementDialog } from "./match-management-dialog";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { calculateMatchupScore, getMatchFormat, isMatchDecided, parseTournamentConfig } from "@shared/tournament-config";
import { Input } from "@/components/ui/input";

const BASE_CELL_HEIGHT = 160;

interface KnockoutBracketProps {
  tournamentId: number;
  sectionId?: string;
}

// Utility to calculate scoring and winner for a series of games
const getMatchupScoring = (boardMatches: Match[], tournament?: Tournament) => {
  if (boardMatches.length === 0 || !tournament) {
    return { player1Id: null, player2Id: null, p1Score: 0, p2Score: 0, winnerId: null, isCompleted: false, isBye: false };
  }

  const firstMatch = boardMatches[0];
  const bracketType = firstMatch.bracketType || 'winners';
  const config = parseTournamentConfig(tournament);
  const format = getMatchFormat(config, firstMatch.round, bracketType as any);

  const score = calculateMatchupScore(boardMatches);
  const decision = isMatchDecided(score, format, boardMatches[boardMatches.length - 1]);
  const winnerId = decision.winnerId;

  const isCompleted = decision.decided;
  const isBye = firstMatch.isBye || (!score.p2Id && score.p1Id && boardMatches.some(m => m.status === 'completed'));

  return {
    player1Id: score.p1Id,
    player2Id: score.p2Id,
    p1Score: score.p1Score,
    p2Score: score.p2Score,
    winnerId,
    isCompleted,
    isBye
  };
};

export default function KnockoutBracket({ tournamentId, sectionId }: KnockoutBracketProps) {
  const { user } = useAuth();
  const isTD = user?.role === 'tournament_director';

  const getRoundCellHeight = (round: number, isLosers: boolean = false) => {
    if (isLosers) {
      // Loser's bracket rounds increment height every 2 rounds
      const p = Math.floor((round - 1) / 2);
      return Math.pow(2, p) * BASE_CELL_HEIGHT;
    }
    // Winner's bracket rounds double height each time
    return Math.pow(2, round - 1) * BASE_CELL_HEIGHT;
  };


  const { data: players, isLoading: playersLoading, error: playersError } = useQuery<Player[]>({
    queryKey: [`/api/tournaments/${tournamentId}/players`],
    refetchInterval: 5000,
  });


  const { data: matches, isLoading: matchesLoading, refetch: refetchMatches } = useQuery<Match[]>({
    queryKey: [`/api/tournaments/${tournamentId}/matches`],
    refetchInterval: 5000,
  });

  const filteredMatches = useMemo(() => {
    if (!matches) return [];
    return matches.filter(m => {
      if (!sectionId) return true;
      return m.sectionId === sectionId;
    });
  }, [matches, sectionId]);

  const { data: tournament, isLoading: tournamentLoading, refetch: refetchTournament } = useQuery<Tournament>({
    queryKey: [`/api/tournaments/${tournamentId}`],
    refetchInterval: 5000,
  });

  const [selectedMatch, setSelectedMatch] = useState<Match | null>(null);
  const [isManagementOpen, setIsManagementOpen] = useState(false);
  const [hoveredMatchId, setHoveredMatchId] = useState<string | null>(null);

  const queryClient = useQueryClient();
  const utilsRef = useRef<any>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [isSearchExpanded, setIsSearchExpanded] = useState(false);

  // Calculate bracket dimensions
  const playersCount = players?.length || 0;
  const mainRoundSize = Math.pow(2, Math.floor(Math.log2(Math.max(playersCount, 2))));
  const hasPrelim = playersCount > mainRoundSize;
  const bracketSize = hasPrelim ? mainRoundSize * 2 : mainRoundSize;
  const totalRoundsCount = Math.log2(bracketSize);
  const TOTAL_BRACKET_HEIGHT = (bracketSize / 2) * BASE_CELL_HEIGHT;
  const roundIndices = Array.from({ length: totalRoundsCount }, (_, i) => i + 1);

  // Always exclude the final round from the loop since the final-col handles it
  const winnersLoopRounds = roundIndices.slice(0, -1);
  const maxRound = totalRoundsCount;

  const calculateMatchNumber = (round: number, board: number, isLosers: boolean = false) => {
    if (isLosers) return `L${round}-${getBoardLetter(board)}`;
    return `${round}${getBoardLetter(board)}`;
  };

  const matchesByRoundAndBoard = useMemo(() => {
    const grouped: Record<string, Record<number, Record<number, Match[]>>> = {};

    filteredMatches.forEach((match: Match) => {
      const type = (match.bracketType || 'winners') as 'winners' | 'losers' | 'grand_final' | 'bronze';
      const r = match.round;
      const b = match.board || 1;

      if (!grouped[type]) grouped[type] = {};
      if (!grouped[type][r]) grouped[type][r] = {};
      if (!grouped[type][r][b]) grouped[type][r][b] = [];
      grouped[type][r][b].push(match);
    });

    // Sort games
    Object.keys(grouped).forEach(type => {
      Object.values(grouped[type as keyof typeof grouped]).forEach(boards => {
        Object.values(boards).forEach(games => {
          games.sort((a, b) => (a.gameNumber || 1) - (b.gameNumber || 1));
        });
      });
    });

    return grouped;
  }, [filteredMatches]);

  const [searchQuery, setSearchQuery] = useState("");

  const tournamentConfig = useMemo(() => tournament ? parseTournamentConfig(tournament) : null, [tournament]);

  // Helper to get board letter (1 -> A, 2 -> B, etc.)
  const getBoardLetter = (board: number) => {
    return String.fromCharCode(64 + board);
  };

  const getRoundName = (roundNum: number, totalRounds: number) => {
    if (roundNum === totalRounds) return "Finals";
    if (roundNum === totalRounds - 1) return "Semifinals";
    if (roundNum === totalRounds - 2) return "Quarterfinals";
    return `Round ${roundNum}`;
  };

  const getPlayer = (id: number | null) => {
    if (!id || !players) return null;
    return players.find(p => p.id === id);
  };

  const getPlayerName = (id: number | null, r: number, b: number, pos: 'white' | 'black', bracketType: string = 'winners') => {
    const p = getPlayer(id);
    if (p) return `${p.firstName} ${p.lastName}`;
    return "TBD";
  };

  const getPlayerRating = (id: number | null): number | string | null => {
    const p = getPlayer(id);
    return p?.rating ?? null;
  };






  const filteredPlayers = useMemo(() => {
    if (!searchQuery || !players) return [];

    const search = searchQuery.toLowerCase().trim();
    if (!search) return [];

    return players.filter(p => {
      const first = (p.firstName || "").toLowerCase();
      const last = (p.lastName || "").toLowerCase();
      const full = `${first} ${last}`;
      const user = ((p as any).username || "").toLowerCase();
      
      return first.includes(search) || 
             last.includes(search) || 
             full.includes(search) || 
             user.includes(search);
    }).slice(0, 20);
  }, [searchQuery, players]);

  const handlePlayerSelect = (player: any) => {
    setSearchQuery("");
    const playerMatches = matches?.filter(m =>
      m.whitePlayerId === player.id || m.blackPlayerId === player.id
    ) || [];

    if (playerMatches.length > 0) {
      // Prioritize uncompleted matches, then highest round
      const targetMatch = playerMatches.sort((a, b) => {
        if (a.status !== 'completed' && b.status === 'completed') return -1;
        if (a.status === 'completed' && b.status !== 'completed') return 1;
        return b.round - a.round;
      })[0];

      const type = targetMatch.bracketType || 'winners';
      let matchId = `${type}-match-${targetMatch.round}-${getBoardLetter(targetMatch.board || 1)}`;

      // Map grand_final back to winners-match for the final round ID if needed
      if (type === 'grand_final' || (type === 'winners' && targetMatch.round === totalRoundsCount)) {
        matchId = `winners-match-${totalRoundsCount}-A`;
      }

      setHoveredMatchId(matchId);

      setTimeout(() => {
        const element = document.getElementById(matchId);
        const utils = utilsRef.current;
        if (element && utils) {
          utils.zoomToElement(element, 1.8, 800);

          // Flash highlight - Subtle Slate
          element.classList.add('ring-4', 'ring-slate-400/30', 'ring-offset-2', 'z-50', 'scale-110', 'transition-all', 'duration-500');
          setTimeout(() => {
            element.classList.remove('ring-4', 'ring-slate-400/30', 'ring-offset-2', 'z-50', 'scale-110');
          }, 3000);
        }
      }, 100);
    }
  };



  // Function to get the path of matches leading to a specific match
  const getMatchPath = useMemo(() => {
    const path = new Set<string>();
    if (!hoveredMatchId) return path;

    const traverse = (matchId: string) => {
      path.add(matchId);
      const parts = matchId.split('-');
      if (parts.length < 4) return;

      const type = parts[0]; // winners/losers
      const round = parseInt(parts[2]);
      const board = parts[3].charCodeAt(0) - 64;

      if (round > 1) {
        const prevRound = round - 1;
        const board1 = board * 2 - 1;
        const board2 = board * 2;
        traverse(`${type}-match-${prevRound}-${String.fromCharCode(64 + board1)}`);
        traverse(`${type}-match-${prevRound}-${String.fromCharCode(64 + board2)}`);
      }
    };

    traverse(hoveredMatchId);
    return path;
  }, [hoveredMatchId]);

  if (playersLoading || matchesLoading || tournamentLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Knockout Bracket</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="animate-pulse space-y-4">
            <div className="h-12 bg-muted rounded w-1/4"></div>
            <div className="h-64 bg-muted/50 rounded-lg"></div>
          </div>
        </CardContent>
      </Card>
    );
  }



  const finalScoring = getMatchupScoring(
    tournament?.isDoubleElimination
      ? (matchesByRoundAndBoard.grand_final?.[1]?.[1] || [])
      : ((maxRound > 0) ? (matchesByRoundAndBoard.winners?.[maxRound]?.[1] || []) : []),
    tournament || undefined
  );

  const isTournamentCompleted = finalScoring.isCompleted && finalScoring.winnerId !== null;
  const winnerId = finalScoring.winnerId;

  if (totalRoundsCount === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <Info className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium">No Bracket Generated</h3>
          <p className="text-muted-foreground mt-2">Generate the knockout bracket to begin.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="w-full h-[800px] bg-slate-50 relative rounded-3xl border-2 border-slate-200">
      <div className="absolute top-6 left-6 z-[100]">
        <div className="relative">
          <motion.div
            initial={false}
            animate={{ 
              width: isSearchExpanded || searchQuery ? 320 : 44,
              boxShadow: isSearchExpanded ? "0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)" : "0 4px 6px -1px rgba(0, 0, 0, 0.1)"
            }}
            className={cn(
              "relative h-11 bg-white border rounded-2xl flex items-center transition-all duration-300",
              isSearchExpanded ? "border-primary/30 ring-4 ring-primary/5" : "border-slate-200"
            )}
          >
            <button
              onClick={() => {
                const next = !isSearchExpanded;
                setIsSearchExpanded(next);
                if (next) {
                  setTimeout(() => inputRef.current?.focus(), 50);
                }
              }}
              className="w-11 h-11 flex items-center justify-center shrink-0 hover:bg-slate-50 transition-colors rounded-l-2xl"
            >
              <Search className={cn("h-5 w-5 transition-colors", isSearchExpanded || searchQuery ? "text-primary" : "text-slate-500")} />
            </button>
            <Input
              ref={inputRef}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onFocus={() => setIsSearchExpanded(true)}
              placeholder="Search players..."
              className={cn(
                "border-0 focus-visible:ring-0 bg-transparent p-0 placeholder:text-slate-400 text-sm font-medium h-full w-full",
                !isSearchExpanded && !searchQuery && "hidden"
              )}
            />
            {searchQuery && (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-slate-400 hover:text-slate-600 rounded-full mr-2 shrink-0"
                onClick={(e) => {
                  e.stopPropagation();
                  setSearchQuery("");
                  inputRef.current?.focus();
                }}
              >
                <X className="h-4 w-4" />
              </Button>
            )}
          </motion.div>

          <AnimatePresence>
            {searchQuery.length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: 8, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 8, scale: 0.95 }}
                className="absolute top-full left-0 right-0 mt-3 bg-white border-2 border-primary/20 rounded-2xl z-[200] shadow-2xl overflow-hidden min-w-[320px]"
              >
                <div className="max-h-[400px] overflow-y-auto custom-scrollbar">
                  {playersLoading ? (
                    <div className="px-5 py-12 text-center">
                      <div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full mx-auto mb-3" />
                      <p className="text-xs font-bold text-slate-400 uppercase tracking-widest animate-pulse">Searching Tournament...</p>
                    </div>
                  ) : filteredPlayers.length > 0 ? (
                    <div className="py-2">
                      <div className="px-4 py-2 text-[10px] font-bold text-slate-400 uppercase tracking-wider border-b border-slate-50 mb-1">
                        Results ({filteredPlayers.length})
                      </div>
                      {filteredPlayers.map(player => {
                        const playerMatch = matches?.find(m => 
                          (m.whitePlayerId === player.id || m.blackPlayerId === player.id) && 
                          m.status !== 'completed'
                        ) || matches?.filter(m => 
                          m.whitePlayerId === player.id || m.blackPlayerId === player.id
                        ).sort((a, b) => b.round - a.round)[0];

                        return (
                          <button
                            key={player.id}
                            className="w-full px-4 py-3 text-left hover:bg-primary/[0.03] flex items-center justify-between group/item transition-all"
                            onMouseDown={(e) => {
                              e.preventDefault();
                              handlePlayerSelect(player);
                              setIsSearchExpanded(false);
                            }}
                          >
                            <div className="flex flex-col gap-0.5">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-bold text-slate-900 group-hover/item:text-primary transition-colors">
                                  {player.firstName} {player.lastName}
                                </span>
                                {(player as any).username && (
                                  <span className="text-[10px] text-slate-400 font-medium bg-slate-100 px-1.5 py-0.5 rounded">
                                    @{(player as any).username}
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Rating: {player.rating || 1000}</span>
                                {playerMatch && (
                                  <>
                                    <span className="text-[10px] text-slate-300">•</span>
                                    <span className="text-[10px] font-bold text-primary/70">
                                      {getRoundName(playerMatch.round, totalRoundsCount)} • {getBoardLetter(playerMatch.board || 1)}
                                    </span>
                                  </>
                                )}
                              </div>
                            </div>
                            <div className="w-8 h-8 rounded-full bg-slate-50 flex items-center justify-center group-hover/item:bg-primary group-hover/item:text-white transition-all">
                              <ChevronRight className="h-4 w-4" />
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="px-5 py-12 text-center">
                      <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-4">
                        <UserX className="h-8 w-8 text-slate-300" />
                      </div>
                      <h4 className="text-sm font-bold text-slate-900 mb-1">No players found</h4>
                      <p className="text-xs text-slate-400 max-w-[200px] mx-auto">We couldn't find any players matching "{searchQuery}"</p>
                    </div>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      <TransformWrapper
        ref={utilsRef}
        initialScale={0.7}
        minScale={0.3}
        maxScale={2.5}
        centerOnInit
        limitToBounds={false}
        panning={{ velocityDisabled: true }}
        wheel={{ step: 0.01 }}
      >
        <div className="absolute top-6 right-6 z-20">
          <ZoomControls />
        </div>
        <TransformComponent
          wrapperClass="!w-full !h-full cursor-grab active:cursor-grabbing"
          contentClass="flex items-center justify-center min-h-full py-40 px-60"
        >
          <div className="flex flex-col gap-y-32">
            <div className="flex items-start relative">
              <div className="flex flex-col gap-y-32">
                {/* Winners Bracket Tree */}
                <div className="flex flex-col gap-y-12">
                  {tournament?.isDoubleElimination && (
                    <div className="px-8 flex items-center gap-4 mb-8">
                      <div className="flex items-center gap-3 bg-primary/10 px-4 py-2 rounded-full border border-primary/20">
                        <Trophy className="h-4 w-4 text-primary" />
                        <span className="text-[11px] font-medium text-primary uppercase tracking-[0.15em]">Winners Bracket</span>
                      </div>
                      <div className="h-px flex-1 bg-gradient-to-r from-primary/20 to-transparent" />
                    </div>
                  )}

                  <div className="flex items-start">
                    {Array.from({ length: totalRoundsCount - 1 }, (_, i) => i + 1).map((roundNum) => {
                      const roundId = `winners-${roundNum}`;
                      const numMatchesInRound = bracketSize / Math.pow(2, roundNum);
                      const boardIndices = Array.from({ length: numMatchesInRound }, (_, i) => i + 1);
                      const cellHeight = getRoundCellHeight(roundNum);

                      return (
                        <div key={roundId} id={roundId} className="flex flex-col shrink-0 transition-all duration-500 ease-in-out overflow-hidden" style={{ width: 360 }}>
                          <div className="text-center mb-8 h-10 flex items-center justify-center gap-2 group/header">
                            <Badge variant="outline" className="text-sm font-semibold text-muted-foreground border-border uppercase tracking-wider bg-muted/50 px-4 py-1">
                              {getRoundName(roundNum, totalRoundsCount)}
                            </Badge>
                          </div>
                          <div className="flex flex-col relative" style={{ height: TOTAL_BRACKET_HEIGHT }}>
                            {boardIndices.map((boardNum) => {
                              const boardMatches = (matchesByRoundAndBoard.winners?.[roundNum]?.[boardNum] || []);
                              return (
                                <div key={`slot-${roundNum}-${boardNum}`} style={{ height: cellHeight }} className="flex items-center justify-center relative">
                                  <MatchCard
                                    id={`winners-match-${roundNum}-${getBoardLetter(boardNum)}`}
                                    boardMatches={boardMatches}
                                    roundNum={roundNum}
                                    boardNum={boardNum}
                                    matchNumber={calculateMatchNumber(roundNum, boardNum)}
                                    isLastRound={roundNum === totalRoundsCount && !tournament?.isDoubleElimination}
                                    getBoardLetter={getBoardLetter}
                                    getPlayerName={getPlayerName}
                                    getPlayerRating={getPlayerRating}
                                    cellHeight={cellHeight}
                                    tournament={tournament}
                                    isHighlighted={getMatchPath.has(`winners-match-${roundNum}-${getBoardLetter(boardNum)}`)}
                                    isPathHighlighted={getMatchPath.has(`winners-match-${roundNum}-${getBoardLetter(boardNum)}`)}
                                    isNextPathHighlighted={roundNum < totalRoundsCount && getMatchPath.has(`winners-match-${roundNum + 1}-${getBoardLetter(Math.ceil(boardNum / 2))}`)}
                                    onMouseEnter={() => setHoveredMatchId(`winners-match-${roundNum}-${getBoardLetter(boardNum)}`)}
                                    onMouseLeave={() => setHoveredMatchId(null)}
                                  />
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}

                    {/* Finals & Bronze Match Column */}
                    {(() => {
                      const roundId = 'finals-col';

                      return (
                        <div id={roundId} className="flex flex-col shrink-0 ml-32 transition-all duration-500 ease-in-out overflow-hidden" style={{ width: 360 }}>
                          <div className="text-center mb-8 h-10 flex items-center justify-center gap-2 group/header">
                            <Badge variant="outline" className="text-sm font-semibold text-muted-foreground border-border uppercase tracking-wider bg-muted/50 px-4 py-1">
                              Finals
                            </Badge>
                          </div>
                          <div className="flex flex-col relative" style={{ height: TOTAL_BRACKET_HEIGHT }}>
                            <div className="flex-1 flex flex-col items-center justify-center gap-y-32">
                              {/* Grand Final */}
                              <div className="flex flex-col gap-y-4 relative">
                                <div className="absolute -top-12 left-0 right-0 flex flex-col items-center gap-1">
                                  <Trophy className="h-6 w-6 text-amber-500 animate-bounce" />
                                  <span className="text-[10px] font-black text-slate-900 uppercase tracking-[0.3em]">Grand Final</span>
                                </div>
                                <MatchCard
                                  id={`winners-match-${totalRoundsCount}-A`}
                                  boardMatches={matchesByRoundAndBoard.winners?.[totalRoundsCount]?.[1] || []}
                                  roundNum={totalRoundsCount}
                                  boardNum={1}
                                  matchNumber={calculateMatchNumber(totalRoundsCount, 1)}
                                  isLastRound={true}
                                  isWinners={true}
                                  getBoardLetter={getBoardLetter}
                                  getPlayerName={getPlayerName}
                                  getPlayerRating={getPlayerRating}
                                  cellHeight={getRoundCellHeight(totalRoundsCount)}
                                  tournament={tournament}
                                  isHighlighted={hoveredMatchId === `winners-match-${totalRoundsCount}-A` || hoveredMatchId === `grand_final-match-${totalRoundsCount}-A`}
                                  isPathHighlighted={getMatchPath.has(`winners-match-${totalRoundsCount}-A`)}
                                  onMouseEnter={() => setHoveredMatchId(`winners-match-${totalRoundsCount}-A`)}
                                  onMouseLeave={() => setHoveredMatchId(null)}
                                />
                              </div>

                              {/* Bronze Match */}
                              {tournamentConfig?.details?.thirdPlaceMatch && (
                                <div className="flex flex-col gap-y-4 relative">
                                  <div className="absolute -top-10 left-0 right-0 flex items-center justify-center gap-3">
                                    <Medal className="h-4 w-4 text-slate-400" />
                                    <span className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em]">Bronze Final</span>
                                  </div>
                                  <MatchCard
                                    id={`bronze-match-1-A`}
                                    boardMatches={matchesByRoundAndBoard.bronze?.[1]?.[1] || []}
                                    roundNum={1}
                                    boardNum={1}
                                    matchNumber={`${totalRoundsCount}B`}
                                    isLastRound={true}
                                    isWinners={false}
                                    getBoardLetter={getBoardLetter}
                                    getPlayerName={getPlayerName}
                                    getPlayerRating={getPlayerRating}
                                    cellHeight={getRoundCellHeight(totalRoundsCount)}
                                    tournament={tournament}
                                    isHighlighted={hoveredMatchId === `bronze-match-1-A`}
                                    isPathHighlighted={getMatchPath.has(`bronze-match-1-A`)}
                                    onMouseEnter={() => setHoveredMatchId(`bronze-match-1-A`)}
                                    onMouseLeave={() => setHoveredMatchId(null)}
                                  />
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                </div>

                {/* Losers Bracket Tree */}
                {tournament?.isDoubleElimination && (
                  <div className="flex flex-col gap-y-12">
                    <div className="px-8 flex items-center gap-4 mb-8">
                      <div className="flex items-center gap-3 bg-blue-500/10 px-4 py-2 rounded-full border border-blue-500/20">
                        <RotateCcw className="h-4 w-4 text-blue-500" />
                        <span className="text-[11px] font-medium text-blue-500 uppercase tracking-[0.15em]">Losers Bracket</span>
                      </div>
                      <div className="h-px flex-1 bg-gradient-to-r from-blue-500/20 to-transparent" />
                    </div>
                    <div className="flex items-start gap-x-0">
                      {Array.from({ length: (totalRoundsCount - 1) * 2 }, (_, i) => i + 1).map((roundNum) => {
                        const roundId = `losers-${roundNum}`;
                        const roundBoards = matchesByRoundAndBoard.losers?.[roundNum] || {};
                        const maxBoard = Math.max(...Object.keys(roundBoards).map(Number), 0);
                        const cellHeight = getRoundCellHeight(roundNum, true);

                        const p = Math.floor((roundNum - 1) / 2);
                        const numMatchesInRound = (bracketSize / 4) / Math.pow(2, p);
                        const boardIndices = Array.from({ length: Math.max(numMatchesInRound, maxBoard) }, (_, i) => i + 1);

                        return (
                          <div key={roundId} id={roundId} className="flex flex-col shrink-0 transition-all duration-500 ease-in-out overflow-hidden" style={{ width: 360 }}>
                            <div className="text-center mb-8 h-10 flex items-center justify-center gap-2 group/header">
                              <Badge variant="outline" className="text-sm font-semibold text-muted-foreground border-border uppercase tracking-wider bg-muted/50 px-4 py-1">
                                LB Round {roundNum}
                              </Badge>
                            </div>
                            <div className="flex flex-col relative" style={{ height: TOTAL_BRACKET_HEIGHT }}>
                              {boardIndices.map((boardNum) => (
                                <div key={`loser-slot-${roundNum}-${boardNum}`} style={{ height: cellHeight }} className="flex items-center justify-center relative">
                                  {matchesByRoundAndBoard?.losers?.[roundNum]?.[boardNum] && (
                                    <MatchCard
                                      id={`losers-match-${roundNum}-${getBoardLetter(boardNum)}`}
                                      boardMatches={matchesByRoundAndBoard.losers?.[roundNum]?.[boardNum]}
                                      roundNum={roundNum}
                                      boardNum={boardNum}
                                      matchNumber={calculateMatchNumber(roundNum, boardNum, true)}
                                      isLastRound={roundNum === (totalRoundsCount - 1) * 2}
                                      getBoardLetter={getBoardLetter}
                                      getPlayerName={getPlayerName}
                                      getPlayerRating={getPlayerRating}
                                      isLosers={true}
                                      cellHeight={cellHeight}
                                      tournament={tournament}
                                      isHighlighted={getMatchPath.has(`losers-match-${roundNum}-${getBoardLetter(boardNum)}`)}
                                      onMouseEnter={() => setHoveredMatchId(`losers-match-${roundNum}-${getBoardLetter(boardNum)}`)}
                                      onMouseLeave={() => setHoveredMatchId(null)}
                                    />
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              {/* Tournament Winner Card */}
              <div className="flex flex-col items-center gap-y-20">
                <div className="w-px h-12 bg-gradient-to-b from-primary/40 to-transparent" />
                <div className="relative">
                  <div className="absolute -inset-4 bg-primary/5 rounded-full blur-2xl animate-pulse" />
                  <Card className={cn(
                    "relative w-96 overflow-hidden border-4 transition-all duration-1000",
                    isTournamentCompleted ? "border-primary shadow-[0_0_40px_rgba(var(--primary),0.2)]" : "border-slate-200 opacity-50"
                  )}>
                    <div className="p-8 flex flex-col items-center text-center bg-white">
                      <div className={cn(
                        "w-20 h-20 rounded-2xl flex items-center justify-center mb-6 transition-all transform",
                        isTournamentCompleted ? "bg-primary text-primary-foreground rotate-0 scale-110 shadow-xl" : "bg-slate-100 text-slate-300 -rotate-12"
                      )}>
                        <Trophy className={cn("h-10 w-10", isTournamentCompleted && "animate-bounce")} />
                      </div>
                      <div className="space-y-2">
                        <span className="text-[12px] font-black text-primary uppercase tracking-[0.3em]">Tournament Champion</span>
                        <h2 className="text-3xl font-black tracking-tight text-slate-900">
                          {isTournamentCompleted ? getPlayer(winnerId)?.firstName + ' ' + getPlayer(winnerId)?.lastName : "Awaiting Result"}
                        </h2>
                        {isTournamentCompleted && (
                          <div className="pt-4 flex items-center justify-center gap-2">
                            <Badge className="bg-amber-100 text-amber-700 border-amber-200">1st Place</Badge>
                            <Badge variant="outline" className="text-slate-500">Knockout Winner</Badge>
                          </div>
                        )}
                      </div>
                    </div>
                  </Card>
                </div>
              </div>
            </div>
          </div>
        </TransformComponent>
      </TransformWrapper>

      <MatchManagementDialog
        open={isManagementOpen}
        onOpenChange={setIsManagementOpen}
        match={selectedMatch}
        players={players || []}
        allMatches={filteredMatches}
        isTD={isTD}
        tournamentId={tournamentId}
        onMatchUpdated={refetchMatches}
      />
    </div>
  );
}


function MatchCard({
  boardMatches,
  roundNum,
  boardNum,
  matchNumber,
  isLastRound,
  getBoardLetter,
  getPlayerName,
  getPlayerRating,
  tournament,
  isLosers = false,
  cellHeight,
  className,
  onMouseEnter,
  onMouseLeave,
  isHighlighted,
  isPathHighlighted,
  isNextPathHighlighted,
  isWinners,
  id
}: {
  boardMatches: Match[],
  roundNum: number,
  boardNum: number,
  matchNumber?: string | number,
  isLastRound: boolean,
  getBoardLetter: (b: number) => string,
  getPlayerName: (id: number | null, r: number, b: number, pos: 'white' | 'black', bracketType?: string) => string,
  getPlayerRating: (id: number | null) => number | string | null,
  tournament?: Tournament,
  isLosers?: boolean,
  isWinners?: boolean,
  cellHeight: number,
  className?: string,
  onMouseEnter?: () => void,
  onMouseLeave?: () => void,
  isHighlighted?: boolean,
  isPathHighlighted?: boolean,
  isNextPathHighlighted?: boolean,
  id: string
}) {
  const { setTransform } = useTransformContext() as any;

  const {
    player1Id,
    player2Id,
    p1Score,
    p2Score,
    winnerId,
    isCompleted,
    isBye
  } = getMatchupScoring(boardMatches, tournament);


  const formatScore = (score: number) => {
    if (score % 1 === 0) return score.toString();
    return (Math.floor(score) === 0 ? "" : Math.floor(score)) + "\u00BD";
  };

  const p1Won = winnerId === player1Id && player1Id !== null;
  const p2Won = winnerId === player2Id && player2Id !== null;

  return (
    <div className={cn("relative flex items-center group/match-wrapper h-[112px]", className)}>
      <div className="absolute left-0 -translate-x-full pr-1.5 top-1/2 -translate-y-1/2 flex items-center">
        <div className="flex items-center">
          <div className="w-8 h-[2px] bg-slate-200 group-hover/match-wrapper:bg-primary/30 transition-colors rounded-full" />
          <div className="w-2 h-2 border-t-2 border-r-2 border-slate-200 group-hover/match-wrapper:border-primary/30 rotate-45 -ml-1.5 transition-colors" />
        </div>
        <div className="flex items-center justify-center bg-slate-800 text-white px-2 py-1 rounded-md shadow-lg shadow-slate-200/50 -ml-0.5 border border-slate-700 min-w-[34px] h-7">
          <span className="text-[11px] font-black tracking-tighter tabular-nums">
            {matchNumber || `${roundNum}${getBoardLetter(boardNum)}`}
          </span>
        </div>
      </div>

      <TooltipProvider delayDuration={0}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Card
              id={id}
              onMouseEnter={onMouseEnter}
              onMouseLeave={onMouseLeave}
              className={cn(
                "relative w-72 h-[112px] bg-card transition-all duration-200 overflow-visible",
                isHighlighted
                  ? "border-slate-900 z-10 shadow-md"
                  : "border-slate-200 shadow-sm",
                isCompleted && !isHighlighted && (isLosers ? "border-blue-500/20" : "border-slate-400/20"),
                boardMatches.length === 0 && "opacity-40"
              )}
            >
              <div className="flex flex-col h-full">
                <PlayerRow
                  name={isBye && !player1Id ? "BYE" : getPlayerName(player1Id, roundNum, boardNum, 'white', isLosers ? 'losers' : 'winners')}
                  rating={getPlayerRating(player1Id)}
                  score={isBye && !player1Id ? "-" : formatScore(p1Score)}
                  won={p1Won}
                  isPlaceholder={!player1Id}
                  isByeSlot={isBye && !player1Id}
                />

                <div className="h-px bg-border w-full" />

                <PlayerRow
                  name={isBye && !player2Id ? "BYE" : getPlayerName(player2Id, roundNum, boardNum, 'black', isLosers ? 'losers' : 'winners')}
                  rating={getPlayerRating(player2Id)}
                  score={isBye && !player2Id ? "-" : formatScore(p2Score)}
                  won={p2Won}
                  isPlaceholder={!player2Id}
                  isByeSlot={isBye && !player2Id}
                />
              </div>
            </Card>
          </TooltipTrigger>
          <TooltipContent side="right" className="bg-popover border-border p-0 overflow-hidden shadow-xl w-72 rounded-lg z-50">
            <div className="bg-muted/50 px-4 py-2 border-b border-border text-[10px] font-bold text-muted-foreground uppercase tracking-widest flex items-center justify-between">
              <span>Match Details</span>
            </div>
            <div className="p-4">
              <div className="space-y-4">
                {[
                  { id: player1Id, originalPos: 'white', score: p1Score },
                  { id: player2Id, originalPos: 'black', score: p2Score }
                ].map((pInfo) => (
                  <div key={pInfo.originalPos} className="space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 max-w-[70%]">
                        <div className={cn(
                          "w-2 h-2 rounded-full shrink-0",
                          pInfo.id ? (pInfo.originalPos === 'white' ? "bg-foreground" : "bg-muted-foreground/40") : "bg-muted"
                        )} />
                        <span className="text-sm font-bold truncate">
                          {getPlayerName(pInfo.id, roundNum, boardNum, pInfo.originalPos as any)}
                        </span>
                      </div>
                      <span className="text-sm font-black text-primary tabular-nums">{formatScore(pInfo.score)}</span>
                    </div>
                    <div className="grid grid-cols-5 gap-1.5">
                      {boardMatches.map((g, i) => {
                        let res = null;
                        const isWhite = g.whitePlayerId === pInfo.id;
                        const isBlack = g.blackPlayerId === pInfo.id;

                        if (isWhite) {
                          if (g.result === "1-0" || g.result === "1-0F") res = "1";
                          else if (g.result === "0-1" || g.result === "0-1F") res = "0";
                          else if (g.result === "1/2-1/2") res = "\u00BD";
                        } else if (isBlack) {
                          if (g.result === "0-1" || g.result === "0-1F") res = "1";
                          else if (g.result === "1-0" || g.result === "1-0F") res = "0";
                          else if (g.result === "1/2-1/2") res = "\u00BD";
                        }

                        return (
                          <div key={i} className="flex flex-col items-center gap-1">
                            <span className="text-[7px] font-bold text-muted-foreground uppercase">G{g.gameNumber || i + 1}</span>
                            <div className={cn(
                              "w-8 h-8 rounded-md flex items-center justify-center text-[11px] font-bold transition-colors border",
                              res === "1" ? "bg-primary text-primary-foreground border-primary" :
                                res === "0" ? "bg-destructive/10 text-destructive border-destructive/20" :
                                  res === "\u00BD" ? "bg-muted text-muted-foreground border-border" :
                                    "bg-muted/30 text-muted-foreground/40 border-border/50"
                            )}>
                              {res || "-"}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      {/* Connector lines to next round */}
      {!isLastRound && (
        <div className="absolute top-1/2 left-[288px] w-[72px] h-0 overflow-visible pointer-events-none z-0">
          {(() => {
            const isMergeRound = !isLosers || roundNum % 2 === 0;
            const lineThickness = 3;
            const verticalDist = cellHeight / 2;

            if (!isMergeRound) {
              return (
                <div className={cn("absolute top-0 left-0 w-full h-[3px] rounded-full transition-colors", isPathHighlighted ? "bg-slate-400" : "bg-slate-200")} />
              );
            }

            const isTopMatch = boardNum % 2 !== 0;

            return (
              <>
                {!isLastRound && (
                  <>
                    {/* Horizontal exit line */}
                    <div
                      className={cn("absolute transition-all duration-300", isPathHighlighted ? "bg-slate-400 z-10" : "bg-slate-200")}
                      style={{
                        left: 0,
                        top: '50%',
                        transform: 'translateY(-50%)',
                        width: 36,
                        height: 2
                      }}
                    />

                    {/* Vertical segment */}
                    <div
                      className={cn("absolute transition-all duration-300", isPathHighlighted ? "bg-slate-400 z-10" : "bg-slate-200")}
                      style={{
                        left: 36,
                        top: isTopMatch ? '50%' : `calc(50% - ${verticalDist}px)`,
                        transform: 'translateX(-50%)',
                        width: 2,
                        height: verticalDist + 1
                      }}
                    />

                    {/* Horizontal entry line (connecting to next round card) */}
                    <div
                      className={cn("absolute transition-all duration-300", isPathHighlighted ? "bg-slate-400 z-10" : "bg-slate-200")}
                      style={{
                        left: 36,
                        top: isTopMatch ? `calc(50% + ${verticalDist}px)` : `calc(50% - ${verticalDist}px)`,
                        transform: 'translateY(-50%)',
                        width: 36,
                        height: 2
                      }}
                    />
                  </>
                )}
              </>
            );
          })()}
        </div>
      )}
    </div>
  );
}

function PlayerRow({ name, rating, score, won, isPlaceholder, isByeSlot }: {
  name: string;
  rating: number | string | null;
  score: string;
  won: boolean;
  isPlaceholder?: boolean;
  isByeSlot?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between transition-all duration-200 relative flex-1 group/row overflow-hidden",
        won && "bg-primary/5",
        isByeSlot && "bg-muted/30"
      )}
    >
      <div className="flex items-center gap-3 px-4 py-2 min-w-0 flex-1 h-full">
        <div className={cn(
          "w-1 h-10 rounded-full shrink-0 transition-all",
          won ? "bg-primary shadow-sm" : "bg-muted/60",
          isByeSlot && "opacity-0"
        )} />
        <div className="flex flex-col min-w-0">
          <span className={cn(
            "text-base font-medium text-black leading-tight truncate",
            won && "font-semibold",
            isPlaceholder && "text-slate-400 italic",
            isByeSlot && "text-slate-400 italic text-xs uppercase tracking-wider"
          )}>
            {name}
          </span>
          {rating !== null && !isByeSlot && (
            <span className="text-[11px] text-slate-500 font-medium leading-none mt-0.5">
              {rating}
            </span>
          )}
        </div>
      </div>

      <div className={cn(
        "w-16 flex items-center justify-center text-lg font-bold self-stretch transition-all shrink-0 tabular-nums h-full",
        won ? "bg-primary text-primary-foreground" : "bg-muted/40 text-muted-foreground border-l border-border"
      )}>
        {score}
      </div>
    </div>
  );
}



function ZoomControls() {
  const { zoomIn, zoomOut, resetTransform, centerView } = useTransformContext() as any;

  return (
    <div className="flex items-center gap-1 bg-white/90 backdrop-blur-xl border border-slate-200 rounded-2xl p-1 shadow-sm">
      <Button
        variant="ghost"
        size="icon"
        className="h-10 w-10 text-slate-600 hover:text-primary hover:bg-primary/10 rounded-xl"
        onClick={() => zoomIn()}
        title="Zoom In"
      >
        <Plus className="h-5 w-5" />
      </Button>
      <div className="w-px h-4 bg-slate-200 mx-1" />
      <Button
        variant="ghost"
        size="icon"
        className="h-10 w-10 text-slate-600 hover:text-primary hover:bg-primary/10 rounded-xl"
        onClick={() => zoomOut()}
        title="Zoom Out"
      >
        <Minus className="h-5 w-5" />
      </Button>
      <div className="w-px h-4 bg-slate-200 mx-1" />
      <Button
        variant="ghost"
        size="icon"
        className="h-10 w-10 text-slate-600 hover:text-primary hover:bg-primary/10 rounded-xl"
        onClick={() => {
          resetTransform();
          setTimeout(() => centerView(0.7, 500), 10);
        }}
        title="Recenter"
      >
        <Maximize2 className="h-5 w-5" />
      </Button>
    </div>
  );
}

