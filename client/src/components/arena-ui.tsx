import React, { useState, useEffect, useRef, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Flame, Swords, Trophy, User, Clock, Users, Zap, ChevronLeft, ChevronRight, Crown } from "lucide-react";
import type { Player, Match, Tournament } from "@shared/schema";
import { cn } from "@/lib/utils";
import { Label } from "@/components/ui/label";

/**
 * Reconstructs the Lichess-style performance sequence for a player.
 */
function calculatePerformanceSequence(playerId: number, matches: Match[], scoringConfig?: any) {
  if (!matches) return [];
  const playerMatches = matches
    .filter(m => (m.whitePlayerId === playerId || m.blackPlayerId === playerId) && m.status === 'completed')
    .sort((a, b) => a.id - b.id);

  const sequence: number[] = [];
  let streak = 0;
  const config = scoringConfig || { winPoints: 2, drawPoints: 1, lossPoints: 0, streakThreshold: 2, onFireWinPoints: 4, onFireDrawPoints: 2 };
  const threshold = config.streakThreshold || 2;

  playerMatches.forEach(match => {
    const isWhite = match.whitePlayerId === playerId;
    const result = match.result;
    let score = 0;
    if (result === '1-0') score = isWhite ? 1 : 0;
    else if (result === '0-1') score = isWhite ? 0 : 1;
    else if (result === '1/2-1/2') score = 0.5;
    const onFire = streak >= threshold;
    if (score === 1) { sequence.push(onFire ? (config.onFireWinPoints || 4) : (config.winPoints || 2)); streak++; }
    else if (score === 0.5) { sequence.push(onFire ? (config.onFireDrawPoints || 2) : (config.drawPoints || 1)); streak = 0; }
    else { sequence.push(config.lossPoints || 0); streak = 0; }
  });
  return sequence;
}

function PerformanceBar({ sequence }: { sequence: number[] }) {
  if (sequence.length === 0) return <span className="text-[10px] text-slate-300 italic">—</span>;
  return (
    <div className="flex items-center gap-px">
      {sequence.slice(-10).map((points, i) => {
        let cls = "w-2 h-3 rounded-sm opacity-60";
        if (points >= 4) cls += " bg-orange-500 opacity-100";
        else if (points >= 2) cls += " bg-green-500";
        else if (points === 1) cls += " bg-blue-400";
        else cls += " bg-slate-300";
        return <div key={i} className={cls} />;
      })}
    </div>
  );
}

// ─── Compact live timer ──────────────────────────────────────────────────────
function useLiveTimer(startTime: Date | null, durationMinutes: number) {
  const [timeLeft, setTimeLeft] = useState<number | null>(null);
  const [phase, setPhase] = useState<'countdown' | 'live' | 'ended'>('live');

  useEffect(() => {
    if (!startTime || !durationMinutes) return;
    const rawStart = startTime as any;
    let startTs: number;
    if (typeof rawStart === 'string') {
      const iso = rawStart.includes('T') ? rawStart : (rawStart as string).replace(' ', 'T');
      startTs = new Date(iso.endsWith('Z') ? iso : `${iso}Z`).getTime();
    } else if (rawStart instanceof Date) {
      startTs = rawStart.getTime();
    } else {
      startTs = new Date(String(rawStart)).getTime();
    }
    const durationMs = durationMinutes * 60000;

    const tick = () => {
      const now = Date.now();
      if (now < startTs) {
        setPhase('countdown');
        setTimeLeft(Math.floor((startTs - now) / 1000));
      } else {
        const end = startTs + durationMs;
        const rem = Math.max(0, end - now);
        setPhase(rem === 0 ? 'ended' : 'live');
        setTimeLeft(Math.floor(rem / 1000));
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [startTime, durationMinutes]);

  return { timeLeft, phase };
}

function formatTime(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

// ─── Arena Header (inline timer, Lichess-style) ──────────────────────────────
export function ArenaHeader({
  tournament,
  playerCount,
  isTD,
  onPause,
}: {
  tournament: Tournament;
  playerCount: number;
  isTD: boolean;
  onPause?: () => void;
}) {
  const startTime = useMemo(() => {
    if (!tournament.arenaStartTime) return null;
    const raw = tournament.arenaStartTime as unknown as string;
    if (raw instanceof Date) return raw as unknown as Date;
    const iso = typeof raw === 'string' && raw.includes('T') ? raw : String(raw).replace(' ', 'T');
    return new Date(iso.endsWith('Z') ? iso : `${iso}Z`);
  }, [tournament.arenaStartTime]);

  const { timeLeft, phase } = useLiveTimer(startTime, tournament.arenaDuration || 10);

  const isLastMinute = phase === 'live' && timeLeft !== null && timeLeft < 60 && timeLeft > 0;

  // Status banner content
  const bannerText = useMemo(() => {
    if (tournament.status === 'registration') return 'Waiting for tournament to start — players registering';
    if (tournament.status === 'completed') return 'Tournament concluded — final standings below';
    if (phase === 'countdown') return 'Tournament starting soon — pairing players, get ready!';
    if (phase === 'ended') return tournament.arenaEndStrategy === 'wait_for_ongoing' ? 'Time expired — waiting for ongoing matches to finish' : 'Time expired — calculating final results';
    if (isLastMinute) return 'Final minute — last pairings in progress!';
    return `Arena live — ${playerCount} players competing`;
  }, [tournament.status, phase, isLastMinute, playerCount, tournament.arenaEndStrategy]);

  const bannerColor = useMemo(() => {
    if (tournament.status === 'completed') return 'bg-slate-100 text-slate-600';
    if (tournament.status === 'registration') return 'bg-blue-50 text-blue-700';
    if (phase === 'countdown') return 'bg-amber-400 text-amber-900';
    if (phase === 'ended') return 'bg-orange-100 text-orange-700';
    if (isLastMinute) return 'bg-red-500 text-white';
    return 'bg-green-500 text-white';
  }, [tournament.status, phase, isLastMinute]);

  return (
    <div className="rounded-xl overflow-hidden border border-slate-200 shadow-sm bg-white">
      {/* Title row */}
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100">
        <div className="flex items-center gap-2.5">
          <Trophy className="h-5 w-5 text-amber-500" />
          <span className="text-lg font-bold text-slate-800 tracking-tight">
            {tournament.name}
          </span>
          {tournament.arenaDuration && (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 border-slate-200 text-slate-500 font-medium">
              {tournament.arenaDuration}min Arena
            </Badge>
          )}
        </div>

        <div className="flex items-center gap-3">
          {timeLeft !== null && tournament.status === 'active' && (
            <span className={cn(
              "font-mono font-bold text-xl tabular-nums tracking-tight",
              phase === 'countdown' ? "text-amber-600" :
              isLastMinute ? "text-red-600 animate-pulse" :
              phase === 'ended' ? "text-slate-400" : "text-slate-700"
            )}>
              {formatTime(timeLeft)}
            </span>
          )}
          {isTD && tournament.status === 'active' && onPause && (
            <Button
              size="sm"
              variant="outline"
              onClick={onPause}
              className="h-8 px-3 text-xs font-bold uppercase tracking-wider border-slate-300 hover:bg-slate-50"
            >
              ⏸ Pause
            </Button>
          )}
        </div>
      </div>

      {/* Status banner */}
      <div className={cn("px-5 py-2 text-center text-xs font-semibold tracking-wide", bannerColor)}>
        {bannerText}
      </div>
    </div>
  );
}

// Keep ArenaTimer for backward compatibility (used in tournament-management)
export function ArenaTimer({ tournament }: { tournament: Tournament }) {
  return null; // Timer is now embedded in ArenaHeader inside ArenaLobby
}

// ─── Compact standings row ──────────────────────────────────────────────────
function StandingsRow({
  player,
  rank,
  isTD,
  onSelectWhite,
  onSelectBlack,
  selectedWhite,
  selectedBlack,
  currentUser,
  matches,
}: {
  player: Player;
  rank: number;
  isTD: boolean;
  onSelectWhite: (id: number) => void;
  onSelectBlack: (id: number) => void;
  selectedWhite: number | null;
  selectedBlack: number | null;
  currentUser?: boolean;
  matches: Match[];
}) {
  const sequence = calculatePerformanceSequence(player.id, matches);
  const points = parseFloat(player.arenaPoints || "0");
  const isPlaying = player.arenaStatus === 'playing';
  const isSelected = selectedWhite === player.id || selectedBlack === player.id;

  return (
    <TableRow
      className={cn(
        "group transition-colors border-b border-slate-100 last:border-0 h-10",
        currentUser && "bg-green-50/60 hover:bg-green-50",
        !currentUser && "hover:bg-slate-50/80",
        isSelected && "bg-blue-50",
        isPlaying && "opacity-75"
      )}
      style={currentUser ? { borderLeft: '3px solid #22c55e' } : {}}
    >
      {/* Rank */}
      <TableCell className="w-10 pl-4 py-0 text-center">
        {rank === 1 ? (
          <Crown className="h-3.5 w-3.5 text-amber-500 mx-auto" />
        ) : rank === 2 ? (
          <span className="text-sm font-bold text-slate-400">2</span>
        ) : rank === 3 ? (
          <span className="text-sm font-bold text-slate-400">3</span>
        ) : (
          <span className="text-xs text-slate-400 tabular-nums">{rank}</span>
        )}
      </TableCell>

      {/* Player */}
      <TableCell className="py-0 pl-1">
        <div className="flex items-center gap-1.5">
          {player.onFire && (
            <Flame className="h-3.5 w-3.5 text-orange-500 fill-orange-400 shrink-0" />
          )}
          <span className={cn("text-sm font-semibold truncate max-w-[140px]", currentUser ? "text-green-700" : "text-slate-800")}>
            {player.firstName} {player.lastName}
          </span>
          <span className="text-[11px] text-slate-400 font-medium shrink-0">{player.rating}</span>
          {isPlaying && (
            <span className="text-[9px] font-bold text-blue-500 uppercase tracking-wider">●</span>
          )}
          {player.arenaStatus === 'paused' && (
            <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">–</span>
          )}
        </div>
      </TableCell>

      {/* Performance bar */}
      <TableCell className="py-0 hidden md:table-cell">
        <PerformanceBar sequence={sequence} />
      </TableCell>

      {/* Score */}
      <TableCell className="py-0 text-right pr-3 w-16">
        <div className="flex items-center justify-end gap-1">
          {player.arenaStreak >= 2 && (
            <span className="text-[10px] font-black text-orange-500">🔥{player.arenaStreak}</span>
          )}
          <span className={cn(
            "text-sm font-black tabular-nums",
            points > 0 ? "text-green-600" : "text-slate-400"
          )}>
            {points % 1 === 0 ? points : points.toFixed(1)}
          </span>
        </div>
      </TableCell>

      {/* TD actions */}
      {isTD && (
        <TableCell className="py-0 pr-3 w-28 text-right">
          {isPlaying ? (
            <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">In Match</span>
          ) : (
            <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                onClick={() => onSelectWhite(player.id)}
                className={cn(
                  "h-6 px-2 text-[9px] font-bold uppercase rounded border transition-colors",
                  selectedWhite === player.id
                    ? "bg-slate-800 text-white border-slate-800"
                    : "bg-white text-slate-600 border-slate-300 hover:border-slate-600"
                )}
                disabled={player.arenaStatus !== 'lobby'}
              >
                W
              </button>
              <button
                onClick={() => onSelectBlack(player.id)}
                className={cn(
                  "h-6 px-2 text-[9px] font-bold uppercase rounded border transition-colors",
                  selectedBlack === player.id
                    ? "bg-slate-800 text-white border-slate-800"
                    : "bg-white text-slate-600 border-slate-300 hover:border-slate-600"
                )}
                disabled={player.arenaStatus !== 'lobby'}
              >
                B
              </button>
            </div>
          )}
        </TableCell>
      )}
    </TableRow>
  );
}

// ─── Arena Lobby ─────────────────────────────────────────────────────────────
interface ArenaUIProps {
  tournamentId: number;
  isTD: boolean;
  userId?: number;
  onArenaStart?: () => void;
}

const PAGE_SIZE = 15;

export function ArenaLobby({ tournamentId, isTD, userId, onArenaStart }: ArenaUIProps) {
  const { toast } = useToast();
  const { data: tournament } = useQuery<Tournament>({
    queryKey: [`/api/tournaments/${tournamentId}`],
    refetchInterval: 2000,
  });

  const { data: players, isLoading } = useQuery<Player[]>({
    queryKey: [`/api/tournaments/${tournamentId}/players`],
    refetchInterval: 2000,
  });

  const { data: matches } = useQuery<Match[]>({
    queryKey: [`/api/tournaments/${tournamentId}/matches`],
    refetchInterval: 2000,
  });

  const [whitePlayerId, setWhitePlayerId] = useState<number | null>(null);
  const [blackPlayerId, setBlackPlayerId] = useState<number | null>(null);
  const [page, setPage] = useState(0);

  const isExpired = useMemo(() => {
    if (!tournament?.arenaStartTime || !tournament?.arenaDuration) return false;
    const rawStart = tournament.arenaStartTime as any;
    let utcStr = rawStart;
    if (typeof rawStart === 'string') {
      const iso = rawStart.includes('T') ? rawStart : rawStart.replace(' ', 'T');
      utcStr = iso.endsWith('Z') ? iso : `${iso}Z`;
    }
    return Date.now() > new Date(utcStr).getTime() + tournament.arenaDuration * 60000;
  }, [tournament]);

  const sortedPlayers = useMemo(() => {
    if (!players) return [];
    return [...players].sort((a, b) => parseFloat(b.arenaPoints || "0") - parseFloat(a.arenaPoints || "0"));
  }, [players]);

  const totalPages = Math.ceil(sortedPlayers.length / PAGE_SIZE);
  const pagePlayers = sortedPlayers.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const lobbyCount = players?.filter(p => p.arenaStatus === 'lobby').length || 0;
  const playingCount = players?.filter(p => p.arenaStatus === 'playing').length || 0;

  const pairMutation = useMutation({
    mutationFn: async () => apiRequest(`/api/tournaments/${tournamentId}/arena/pair`, {
      method: "POST",
      body: JSON.stringify({ whitePlayerId, blackPlayerId }),
    }),
    onSuccess: () => {
      toast({ title: "Match dispatched" });
      setWhitePlayerId(null);
      setBlackPlayerId(null);
      queryClient.invalidateQueries({ queryKey: [`/api/tournaments/${tournamentId}/arena/lobby`] });
    },
    onError: (error: any) => toast({ title: "Error", description: error.message, variant: "destructive" }),
  });

  const startArenaMutation = useMutation({
    mutationFn: async () => apiRequest(`/api/tournaments/${tournamentId}/arena/start`, { method: "POST" }),
    onSuccess: () => {
      toast({ title: "Arena activated!" });
      queryClient.invalidateQueries({ queryKey: [`/api/tournaments/${tournamentId}`] });
      onArenaStart?.();
    },
    onError: (error: any) => toast({ title: "Error", description: error.message, variant: "destructive" }),
  });

  if (isLoading) return (
    <div className="flex justify-center py-20">
      <div className="animate-spin h-8 w-8 border-2 border-slate-300 border-t-slate-700 rounded-full" />
    </div>
  );

  if (tournament?.status === 'completed') return <ArenaPodium players={players || []} />;

  return (
    <div className="space-y-4 animate-in fade-in duration-500">

      {/* Arena Header with inline timer */}
      {tournament && (
        <ArenaHeader
          tournament={tournament}
          playerCount={players?.length || 0}
          isTD={isTD}
          onPause={() => toast({ title: "Pause not yet implemented" })}
        />
      )}

      {/* Time expired banner */}
      {isExpired && tournament?.status === 'active' && (
        <div className="flex items-center justify-between bg-amber-50 border border-amber-200 rounded-lg px-4 py-2.5">
          <div className="flex items-center gap-2 text-amber-700">
            <Clock className="h-4 w-4" />
            <span className="text-sm font-semibold">Arena time expired</span>
            <span className="text-xs text-amber-600">
              {tournament.arenaEndStrategy === 'wait_for_ongoing' ? '— waiting for ongoing matches' : '— concluding now'}
            </span>
          </div>
          {isTD && (
            <Button
              size="sm"
              className="h-7 px-3 text-xs bg-amber-600 hover:bg-amber-700 text-white"
              onClick={() => {
                apiRequest(`/api/tournaments/${tournamentId}/arena/conclude`, { method: "POST" })
                  .then(() => queryClient.invalidateQueries({ queryKey: [`/api/tournaments/${tournamentId}`] }));
              }}
            >
              Conclude
            </Button>
          )}
        </div>
      )}

      {/* Start Tournament CTA (registration state) */}
      {isTD && tournament?.status === 'registration' && (
        <div className="flex items-center justify-between bg-slate-900 text-white rounded-xl px-5 py-4">
          <div>
            <p className="font-bold text-base">Start Arena Tournament</p>
            <p className="text-slate-400 text-xs mt-0.5">Players are waiting — activate the arena pool to begin pairing</p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <Select
              value={String(tournament?.arenaDuration || 10)}
              onValueChange={(val) => {
                apiRequest(`/api/tournaments/${tournamentId}`, {
                  method: "PATCH",
                  body: JSON.stringify({ arenaDuration: parseInt(val) })
                }).then(() => queryClient.invalidateQueries({ queryKey: [`/api/tournaments/${tournamentId}`] }));
              }}
            >
              <SelectTrigger className="w-32 h-8 bg-white/10 border-white/20 text-white text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[5,10,15,20,30,45,60,90,120].map(m => (
                  <SelectItem key={m} value={String(m)}>{m < 60 ? `${m} min` : `${m/60}h`}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => startArenaMutation.mutate()}
              disabled={startArenaMutation.isPending}
              className="h-8 px-5 font-bold"
            >
              {startArenaMutation.isPending ? "Starting…" : "Start"}
            </Button>
          </div>
        </div>
      )}

      {/* Manual pairing panel (TD only, manual mode) */}
      {isTD && tournament?.status === 'active' && tournament?.arenaPairingMode === 'manual' && (
        <div className="border border-slate-200 rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2.5 bg-slate-50 border-b border-slate-200">
            <div className="flex items-center gap-2">
              <Swords className="h-4 w-4 text-slate-600" />
              <span className="text-sm font-bold text-slate-700">Manual Pairing</span>
            </div>
            <Button
              size="sm"
              disabled={!whitePlayerId || !blackPlayerId || pairMutation.isPending || isExpired}
              onClick={() => pairMutation.mutate()}
              className="h-7 px-4 text-xs font-bold"
            >
              {pairMutation.isPending ? "Pairing…" : "Confirm Pair"}
            </Button>
          </div>
          <div className="flex items-center gap-0 divide-x divide-slate-200">
            <div className={cn("flex-1 px-4 py-3 text-center transition-colors", whitePlayerId ? "bg-white" : "bg-slate-50/50")}>
              <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400 mb-0.5">White</p>
              <p className={cn("text-sm font-bold truncate", whitePlayerId ? "text-slate-800" : "text-slate-300 italic")}>
                {whitePlayerId ? players?.find(p => p.id === whitePlayerId)?.firstName + ' ' + players?.find(p => p.id === whitePlayerId)?.lastName : "Select from table ↓"}
              </p>
            </div>
            <div className="px-3 py-3 shrink-0 bg-slate-50">
              <span className="text-[10px] font-black text-slate-400">VS</span>
            </div>
            <div className={cn("flex-1 px-4 py-3 text-center transition-colors", blackPlayerId ? "bg-slate-900" : "bg-slate-50/50")}>
              <p className={cn("text-[9px] font-bold uppercase tracking-widest mb-0.5", blackPlayerId ? "text-slate-500" : "text-slate-400")}>Black</p>
              <p className={cn("text-sm font-bold truncate", blackPlayerId ? "text-white" : "text-slate-300 italic")}>
                {blackPlayerId ? players?.find(p => p.id === blackPlayerId)?.firstName + ' ' + players?.find(p => p.id === blackPlayerId)?.lastName : "Select from table ↓"}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Standings table */}
      <div className="border border-slate-200 rounded-xl overflow-hidden bg-white shadow-sm">
        {/* Table header bar */}
        <div className="flex items-center justify-between px-4 py-2 border-b border-slate-100 bg-slate-50/50">
          <div className="flex items-center gap-3 text-[10px] font-bold uppercase tracking-wider text-slate-400">
            <div className="flex items-center gap-1">
              <div className="w-2 h-2 rounded-full bg-green-500" />
              <span>{lobbyCount} ready</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
              <span>{playingCount} playing</span>
            </div>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-slate-500 tabular-nums">
                {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, sortedPlayers.length)} / {sortedPlayers.length}
              </span>
              <button
                onClick={() => setPage(p => Math.max(0, p - 1))}
                disabled={page === 0}
                className="h-6 w-6 flex items-center justify-center rounded border border-slate-200 text-slate-500 hover:bg-slate-100 disabled:opacity-30 transition-colors"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
                className="h-6 w-6 flex items-center justify-center rounded border border-slate-200 text-slate-500 hover:bg-slate-100 disabled:opacity-30 transition-colors"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </div>

        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent border-none bg-slate-50/30">
                <TableHead className="w-10 pl-4 h-8 text-[9px] font-black uppercase tracking-wider text-slate-400">#</TableHead>
                <TableHead className="h-8 text-[9px] font-black uppercase tracking-wider text-slate-400">Player</TableHead>
                <TableHead className="h-8 text-[9px] font-black uppercase tracking-wider text-slate-400 hidden md:table-cell">Performance</TableHead>
                <TableHead className="h-8 pr-3 text-right text-[9px] font-black uppercase tracking-wider text-slate-400 w-16">Score</TableHead>
                {isTD && tournament?.arenaPairingMode === 'manual' && (
                  <TableHead className="h-8 pr-3 text-right text-[9px] font-black uppercase tracking-wider text-slate-400 w-28">Pair</TableHead>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {pagePlayers.map((player, idx) => (
                <StandingsRow
                  key={player.id}
                  player={player}
                  rank={page * PAGE_SIZE + idx + 1}
                  isTD={isTD && tournament?.arenaPairingMode === 'manual'}
                  matches={matches || []}
                  onSelectWhite={(id) => setWhitePlayerId(id === whitePlayerId ? null : id)}
                  onSelectBlack={(id) => setBlackPlayerId(id === blackPlayerId ? null : id)}
                  selectedWhite={whitePlayerId}
                  selectedBlack={blackPlayerId}
                  currentUser={player.userId === userId}
                />
              ))}
            </TableBody>
          </Table>
        </div>

        {sortedPlayers.length === 0 && (
          <div className="py-16 flex flex-col items-center text-center opacity-40">
            <Users className="h-10 w-10 mb-3 text-slate-400" />
            <p className="text-sm text-slate-500">No players registered yet</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Active Matches (compact board list) ─────────────────────────────────────
export function ArenaActiveMatches({ tournamentId, isTD, userId }: ArenaUIProps) {
  const { toast } = useToast();
  const { data: matches, isLoading } = useQuery<Match[]>({
    queryKey: [`/api/tournaments/${tournamentId}/matches`],
    refetchInterval: 3000,
  });
  const { data: players } = useQuery<Player[]>({
    queryKey: [`/api/tournaments/${tournamentId}/players`],
  });

  const resultMutation = useMutation({
    mutationFn: async ({ matchId, result }: { matchId: number; result: string }) =>
      apiRequest(`/api/tournaments/${tournamentId}/arena/results`, {
        method: "POST",
        body: JSON.stringify({ matchId, result }),
      }),
    onSuccess: () => {
      toast({ title: "Result recorded" });
      queryClient.invalidateQueries({ queryKey: [`/api/tournaments/${tournamentId}/matches`] });
      queryClient.invalidateQueries({ queryKey: [`/api/tournaments/${tournamentId}/players`] });
    },
  });

  const activeMatches = matches?.filter(m =>
    ['pending', 'in_progress', 'playing', 'scheduled'].includes(m.status)
  );

  if (isLoading) return (
    <div className="flex justify-center py-16">
      <div className="animate-spin h-7 w-7 border-2 border-slate-300 border-t-slate-700 rounded-full" />
    </div>
  );

  if (!activeMatches || activeMatches.length === 0) return (
    <div className="border border-slate-200 rounded-xl py-16 flex flex-col items-center text-center bg-white">
      <Swords className="h-10 w-10 mb-3 text-slate-300" />
      <p className="text-sm font-semibold text-slate-500">No active matches</p>
      <p className="text-xs text-slate-400 mt-1">Pair players in the Lobby tab to see boards here</p>
    </div>
  );

  return (
    <div className="border border-slate-200 rounded-xl overflow-hidden bg-white shadow-sm">
      <div className="px-4 py-2 border-b border-slate-100 bg-slate-50/50">
        <span className="text-[10px] font-black uppercase tracking-wider text-slate-500">
          {activeMatches.length} Active Board{activeMatches.length !== 1 ? 's' : ''}
        </span>
      </div>
      <div className="divide-y divide-slate-100">
        {activeMatches.map((match, idx) => {
          const white = players?.find(p => p.id === match.whitePlayerId);
          const black = players?.find(p => p.id === match.blackPlayerId);
          return (
            <div key={match.id} className="flex items-center gap-4 px-4 py-2.5 hover:bg-slate-50/60 transition-colors">
              {/* Board number */}
              <div className="shrink-0 w-10 text-center">
                <span className="text-[10px] text-slate-400 block leading-none">Board</span>
                <span className="text-base font-black text-slate-700 tabular-nums leading-tight">
                  {(match.board || idx + 1).toString().padStart(2, '0')}
                </span>
              </div>

              {/* Players */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  {/* White */}
                  <div className="flex items-center gap-1.5">
                    <div className="w-4 h-4 rounded-sm bg-white border border-slate-300 shrink-0" />
                    <span className="text-sm font-semibold text-slate-800 truncate max-w-[120px]">
                      {white?.firstName} {white?.lastName}
                    </span>
                    <span className="text-[10px] text-slate-400">{white?.rating}</span>
                  </div>
                  <span className="text-xs font-bold text-slate-400">vs</span>
                  {/* Black */}
                  <div className="flex items-center gap-1.5">
                    <div className="w-4 h-4 rounded-sm bg-slate-800 border border-slate-600 shrink-0" />
                    <span className="text-sm font-semibold text-slate-800 truncate max-w-[120px]">
                      {black?.firstName} {black?.lastName}
                    </span>
                    <span className="text-[10px] text-slate-400">{black?.rating}</span>
                  </div>
                </div>
              </div>

              {/* Result buttons / status */}
              <div className="shrink-0">
                {isTD ? (
                  <div className="flex items-center gap-1">
                    {[
                      { label: '1-0', result: '1-0' },
                      { label: '0-1', result: '0-1' },
                      { label: '½-½', result: '1/2-1/2' },
                    ].map(({ label, result }) => (
                      <button
                        key={result}
                        onClick={() => resultMutation.mutate({ matchId: match.id, result })}
                        className="h-7 px-2.5 text-xs font-bold rounded border border-slate-200 bg-white text-slate-600 hover:bg-slate-800 hover:text-white hover:border-slate-800 transition-colors"
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                ) : (
                  <span className="text-xs font-semibold text-blue-500 animate-pulse">Playing</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Arena Standings (standalone, used elsewhere) ────────────────────────────
export function ArenaStandings({
  tournamentId,
  userId,
  isTD = false,
  tournament,
  whitePlayerId = null,
  blackPlayerId = null,
  setWhitePlayerId,
  setBlackPlayerId,
}: {
  tournamentId: number;
  userId?: number;
  isTD?: boolean;
  tournament?: Tournament;
  whitePlayerId?: number | null;
  blackPlayerId?: number | null;
  setWhitePlayerId?: (id: number | null) => void;
  setBlackPlayerId?: (id: number | null) => void;
}) {
  const { data: standings, isLoading } = useQuery<Player[]>({
    queryKey: [`/api/tournaments/${tournamentId}/arena/standings`],
    refetchInterval: 5000,
  });
  const { data: matches } = useQuery<Match[]>({
    queryKey: [`/api/tournaments/${tournamentId}/matches`],
  });
  const [page, setPage] = useState(0);
  const totalPages = Math.ceil((standings?.length || 0) / PAGE_SIZE);
  const pagePlayers = (standings || []).slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  if (isLoading) return (
    <div className="flex justify-center py-16">
      <div className="animate-spin h-8 w-8 border-2 border-slate-300 border-t-slate-700 rounded-full" />
    </div>
  );

  return (
    <div className="border border-slate-200 rounded-xl overflow-hidden bg-white shadow-sm">
      {totalPages > 1 && (
        <div className="flex items-center justify-end gap-2 px-4 py-2 border-b border-slate-100 bg-slate-50/50">
          <span className="text-[10px] text-slate-500 tabular-nums">
            {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, standings?.length || 0)} / {standings?.length || 0}
          </span>
          <button onClick={() => setPage(p => Math.max(0, p-1))} disabled={page === 0} className="h-6 w-6 flex items-center justify-center rounded border border-slate-200 hover:bg-slate-100 disabled:opacity-30">
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <button onClick={() => setPage(p => Math.min(totalPages-1, p+1))} disabled={page >= totalPages-1} className="h-6 w-6 flex items-center justify-center rounded border border-slate-200 hover:bg-slate-100 disabled:opacity-30">
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent bg-slate-50/30 border-none">
            <TableHead className="w-10 pl-4 h-8 text-[9px] font-black uppercase tracking-wider text-slate-400">#</TableHead>
            <TableHead className="h-8 text-[9px] font-black uppercase tracking-wider text-slate-400">Player</TableHead>
            <TableHead className="h-8 text-[9px] font-black uppercase tracking-wider text-slate-400 hidden md:table-cell">Performance</TableHead>
            <TableHead className="h-8 pr-6 text-right text-[9px] font-black uppercase tracking-wider text-slate-400">Score</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {pagePlayers.map((player, idx) => (
            <StandingsRow
              key={player.id}
              player={player}
              rank={page * PAGE_SIZE + idx + 1}
              isTD={isTD && tournament?.arenaPairingMode === 'manual'}
              matches={matches || []}
              onSelectWhite={(id) => setWhitePlayerId?.(id)}
              onSelectBlack={(id) => setBlackPlayerId?.(id)}
              selectedWhite={whitePlayerId}
              selectedBlack={blackPlayerId}
              currentUser={player.userId === userId}
            />
          ))}
        </TableBody>
      </Table>
      {(!standings || standings.length === 0) && (
        <div className="py-16 flex flex-col items-center opacity-30">
          <Trophy className="h-10 w-10 mb-3" />
          <p className="text-sm">No standings yet</p>
        </div>
      )}
    </div>
  );
}

// ─── Podium ──────────────────────────────────────────────────────────────────
export function ArenaPodium({ players }: { players: Player[] }) {
  const top3 = [...players]
    .sort((a, b) => parseFloat(b.arenaPoints || "0") - parseFloat(a.arenaPoints || "0"))
    .slice(0, 3);

  if (top3.length === 0) return null;

  const podiumOrder = [top3[1], top3[0], top3[2]].filter(Boolean);
  const heights = [top3[1] ? 'h-28' : 'h-0', 'h-40', top3[2] ? 'h-20' : 'h-0'];
  const medals = ['🥈', '🥇', '🥉'];
  const labels = ['2nd Place', '1st Place', '3rd Place'];

  return (
    <div className="py-16 flex flex-col items-center animate-in fade-in duration-700">
      <h2 className="text-3xl font-black text-center mb-10 bg-gradient-to-r from-amber-500 to-yellow-400 bg-clip-text text-transparent">
        Tournament Podium
      </h2>
      <div className="flex items-end justify-center gap-3 w-full max-w-xl px-4">
        {podiumOrder.map((player, i) => (
          <div key={player?.id} className="flex flex-col items-center flex-1">
            <span className="text-2xl mb-2">{medals[i]}</span>
            <p className="text-xs font-bold text-slate-600 truncate w-full text-center mb-1">{player?.firstName} {player?.lastName}</p>
            <p className="text-lg font-black text-slate-800 mb-2">{player?.arenaPoints}</p>
            <div className={cn("w-full rounded-t-lg flex items-end justify-center pb-2 shadow-inner",
              i === 1 ? "bg-gradient-to-b from-amber-300 to-amber-500 " + heights[i] :
              i === 0 ? "bg-slate-300 dark:bg-slate-600 " + heights[i] :
              "bg-orange-200 dark:bg-orange-800 " + heights[i]
            )}>
              <span className="text-[10px] font-black uppercase tracking-wider opacity-60">{labels[i]}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
