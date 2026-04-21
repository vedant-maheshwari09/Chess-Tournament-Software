import { storage } from '../storage';
import { Match, Player, Tournament } from '@shared/schema';

// Configuration constants for matchmaking
const SCORE_GAP_COST = 1000;
const REPEAT_PENALTY_BASE = 50000;
const PAIRING_LOOP_INTERVAL = 2000; // 2 seconds

// Global singleton to track active loops and pairing state
declare global {
  var arenaRunningLoops: Set<number>;
  var arenaEntryTimes: Map<number, Map<number, number>>;
}

if (!global.arenaRunningLoops) {
  global.arenaRunningLoops = new Set<number>();
}
if (!global.arenaEntryTimes) {
  global.arenaEntryTimes = new Map<number, Map<number, number>>();
}

const log = (msg: string, scope: string = "info") => {
  if (process.env.DEBUG_ARENA === 'true' || scope === 'error') {
    console.log(`[ArenaPairing] ${msg}`);
  }
};

/**
 * Bootstrap: Resume pairing loops for all active automated arenas
 */
export async function bootstrapArenaPairing() {
  log("Bootstrapping active arena loops...");
  try {
    const tournaments = await storage.getAllTournaments();
    const activeArenas = tournaments.filter(t => 
      t.format === 'arena' && 
      t.status === 'active' && 
      t.arenaPairingMode === 'automatic'
    );

    log(`Found ${activeArenas.length} active automated arenas to resume.`);
    for (const t of activeArenas) {
      if (!global.arenaRunningLoops.has(t.id)) {
        startAutoPairingLoop(t.id);
      }
    }
  } catch (err) {
    console.error("[ArenaPairing] Bootstrap error:", err);
  }
}

/**
 * Starts the self-recursive pairing loop for a tournament
 */
export function startAutoPairingLoop(tournamentId: number) {
  if (global.arenaRunningLoops.has(tournamentId)) {
    log(`T${tournamentId}: Loop already active. skipping restart.`);
    return;
  }

  global.arenaRunningLoops.add(tournamentId);
  if (!global.arenaEntryTimes.has(tournamentId)) {
    global.arenaEntryTimes.set(tournamentId, new Map<number, number>());
  }

  log(`T${tournamentId}: Loop initialized.`);

  const tick = async () => {
    // Check if we should still be running
    if (!global.arenaRunningLoops.has(tournamentId)) return;

    try {
      const tournament = await storage.getTournament(tournamentId);
      if (!tournament || tournament.status !== 'active') {
        log(`T${tournamentId}: Tournament no longer active or exists. Stopping loop.`);
        global.arenaRunningLoops.delete(tournamentId);
        return;
      }

      await pairPool(tournamentId, tournament);
    } catch (err) {
      console.error(`[ArenaPairing] T${tournamentId} Loop Error:`, err);
    }

    // Schedule next tick
    if (global.arenaRunningLoops.has(tournamentId)) {
        setTimeout(tick, PAIRING_LOOP_INTERVAL);
    }
  };

  // Start first tick
  tick();
}

/**
 * Stops the pairing loop for a tournament
 */
export function stopAutoPairingLoop(tournamentId: number) {
  global.arenaRunningLoops.delete(tournamentId);
  log(`T${tournamentId}: Loop flagged for termination.`);
}

const pairingInProgress = new Set<number>();

/**
 * Core pairing logic for a single tournament
 */
export async function pairPool(tournamentId: number, tournamentOverride?: Tournament) {
  if (pairingInProgress.has(tournamentId)) return;
  pairingInProgress.add(tournamentId);

  try {
    const tournament = tournamentOverride || await storage.getTournament(tournamentId);
    if (!tournament || tournament.status !== 'active' || tournament.arenaPairingMode !== 'automatic') {
      return;
    }

    // Initialize/Fix entry times map
    if (!global.arenaEntryTimes.has(tournamentId)) {
        global.arenaEntryTimes.set(tournamentId, new Map<number, number>());
    }
    const entryTimeMap = global.arenaEntryTimes.get(tournamentId)!;

    // Cutoff logic
    if (tournament.arenaStartTime && tournament.arenaDuration) {
      const start = new Date(tournament.arenaStartTime);
      const end = new Date(start.getTime() + tournament.arenaDuration * 60000);
      const cutoffTime = new Date(end.getTime() - (tournament.arenaCutoffMinutes || 2) * 60000);
      if (Date.now() > cutoffTime.getTime()) {
        log(`T${tournamentId}: Past cutoff.`, "debug");
        return;
      }
    }

    // 1. Fetch Current State
    const allMatches = await storage.getMatchesByTournament(tournamentId);
    const allPlayers = await storage.getPlayersByTournament(tournamentId);

    // 2. Identify Lobby vs Playing
    const alreadyPlaying = new Set<number>();
    let maxBoard = 0;
    
    // Find active matches and highest board number
    for (const m of allMatches) {
        if (m.status === 'playing' || m.status === 'pending') {
            if (m.whitePlayerId) alreadyPlaying.add(m.whitePlayerId);
            if (m.blackPlayerId) alreadyPlaying.add(m.blackPlayerId);
        }
        if (m.board && m.board > maxBoard) maxBoard = m.board;
    }

    const lobbyPlayers = allPlayers.filter(p => 
      p.arenaStatus === 'lobby' && !alreadyPlaying.has(p.id)
    );

    // Update entry times for new lobby arrivals
    const now = Date.now();
    for (const p of lobbyPlayers) {
        if (!entryTimeMap.has(p.id)) {
            entryTimeMap.set(p.id, now);
        }
    }
    // Clean up entry times for players who left
    for (const pid of Array.from(entryTimeMap.keys())) {
        if (!allPlayers.find(p => p.id === pid)) {
            entryTimeMap.delete(pid);
        }
    }

    if (lobbyPlayers.length < 2) return;

    // 3. Prepare Pairing Pool
    const playersWithWait = lobbyPlayers.map(p => ({
        ...p,
        waitTimeSec: Math.floor((now - (entryTimeMap.get(p.id) || now)) / 1000),
        pointsNum: parseFloat(p.arenaPoints || "0")
    })).sort((a,b) => b.pointsNum - a.pointsNum || b.waitTimeSec - a.waitTimeSec);

    // 4. Index Match History (Optimized)
    const sortedMatches = [...allMatches].sort((a, b) => b.id - a.id);
    const matchHistory = new Map<number, number[]>();
    for (const p of lobbyPlayers) {
        const hist: number[] = [];
        for (const m of sortedMatches) {
            if (m.whitePlayerId === p.id) hist.push(m.blackPlayerId!);
            else if (m.blackPlayerId === p.id) hist.push(m.whitePlayerId!);
            if (hist.length >= 5) break; 
        }
        matchHistory.set(p.id, hist);
    }

    // 5. Greedy Pairing with Cost Function
    const repeatMultiplier = Math.max(0, Math.min(1.0, (playersWithWait.length - 2) / 10.0));
    const pairedThisTick = new Set<number>();

    for (let i = 0; i < playersWithWait.length; i++) {
        const playerA = playersWithWait[i];
        if (pairedThisTick.has(playerA.id)) continue;

        let bestOpponent: any = null;
        let bestCost = Infinity;
        // Exponentially increase acceptable cost as wait time grows
        const maxAcceptableCost = 5000 * Math.exp(0.02 * playerA.waitTimeSec);

        for (let j = i + 1; j < playersWithWait.length; j++) {
            const playerB = playersWithWait[j];
            if (pairedThisTick.has(playerB.id)) continue;

            const scoreDiff = Math.abs(playerA.pointsNum - playerB.pointsNum);
            const ratingDiff = Math.abs((playerA.rating || 1200) - (playerB.rating || 1200));
            
            let cost = (scoreDiff * SCORE_GAP_COST) + (ratingDiff * 0.1);

            // History Penalty
            const aHist = matchHistory.get(playerA.id) || [];
            const repIdx = aHist.indexOf(playerB.id);
            if (repIdx !== -1) {
                cost += (REPEAT_PENALTY_BASE / (repIdx + 1)) * repeatMultiplier;
            }

            // Simple Color Balance
            cost += calculateColorPenalty(playerA, playerB);

            if (cost < bestCost) {
                bestCost = cost;
                bestOpponent = playerB;
            }
        }

        if (bestOpponent && bestCost <= maxAcceptableCost) {
            const colors = determineColors(playerA, bestOpponent);
            if (!colors) continue;

            const [whiteId, blackId] = colors;
            maxBoard++;

            // ATOMIC COMMIT
            const match = await storage.createMatch({
                tournamentId,
                round: 1, // Arena always uses round 1 or flat structure
                board: maxBoard,
                whitePlayerId: whiteId,
                blackPlayerId: blackId,
                status: 'playing',
            });

            // Update both players
            for (const p of [playerA, bestOpponent]) {
                const isWhite = (p.id === whiteId);
                const char = isWhite ? 'W' : 'B';
                const newDelta = p.colorDelta + (isWhite ? 1 : -1);
                const newConsecutive = (p.consecutiveColor?.startsWith(char) ? p.consecutiveColor + char : char).slice(-2);
                
                await storage.updatePlayer(p.id, {
                    arenaStatus: 'playing',
                    lastOpponentId: p.id === playerA.id ? bestOpponent.id : playerA.id,
                    colorDelta: newDelta,
                    consecutiveColor: newConsecutive
                });
            }

            pairedThisTick.add(playerA.id);
            pairedThisTick.add(bestOpponent.id);
            
            console.log(`[ArenaPairing] T${tournamentId}: Match Created - ${playerA.firstName} vs ${bestOpponent.firstName} (Cost: ${Math.round(bestCost)})`);
        }
    }
  } catch (error) {
    console.error(`[ArenaPairing] Error in T${tournamentId}:`, error);
  } finally {
    pairingInProgress.delete(tournamentId);
  }
}

function calculateColorPenalty(a: any, b: any): number {
    // If one is heavily positive and other heavily negative, they are good matches (cost 0)
    // If both have same signs, add penalty
    if (Math.sign(a.colorDelta) === Math.sign(b.colorDelta) && a.colorDelta !== 0) {
        return Math.abs(a.colorDelta + b.colorDelta) * 50;
    }
    return 0;
}

function determineColors(a: any, b: any): [number, number] | null {
    // Return [whiteId, blackId]
    if (a.colorDelta < b.colorDelta) return [a.id, b.id];
    if (b.colorDelta < a.colorDelta) return [b.id, a.id];
    return Math.random() > 0.5 ? [a.id, b.id] : [b.id, a.id];
}
