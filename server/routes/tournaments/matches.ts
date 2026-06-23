import type { Express, Request, Response } from "express";
import { db } from '../../db';
import { storage } from '../../storage';
import { requireAuth, requireRole, requireTournamentAccess } from '../../auth';
import { matches, Match } from '@shared/schema';
import { calculateMatchupScore, getMatchFormat, isMatchDecided, parseTournamentConfig } from "@shared/tournament-config";
import { advanceKnockoutWinner, spawnNextMatchupGame } from "../common";

export function applyMatchesRoutes(app: Express) {
  app.post(
    "/api/tournaments/:id/swap-players",
    requireAuth,
    requireRole('tournament_director'),
    requireTournamentAccess,
    async (req: Request, res: Response) => {
      try {
        const tournamentId = parseInt(req.params.id);
        const { match1Id, match2Id, player1Id, player2Id, color1, color2 } = req.body;

        if (!match1Id || !match2Id) {
          return res.status(400).json({ message: "Invalid match IDs provided." });
        }

        const match1 = await storage.getMatch(match1Id);
        const match2 = await storage.getMatch(match2Id);

        if (!match1 || !match2) {
          return res.status(404).json({ message: "Match not found." });
        }

        const round = match1.round;

        const previousState = {
          match1: { ...match1 },
          match2: { ...match2 },
        };

        const match1Updates: Partial<Match> = {};
        const match2Updates: Partial<Match> = {};

        if (color1 === 'white') {
          match1Updates.whitePlayerId = player2Id;
        } else {
          match1Updates.blackPlayerId = player2Id;
        }

        if (color2 === 'white') {
          match2Updates.whitePlayerId = player1Id;
        } else {
          match2Updates.blackPlayerId = player1Id;
        }

        const updatedMatch1 = await storage.updateMatch(match1Id, match1Updates);
        const updatedMatch2 = await storage.updateMatch(match2Id, match2Updates);

        if (!updatedMatch1 || !updatedMatch2) {
          return res.status(500).json({ message: "Failed to update match records." });
        }

        const roundPairings = await storage.getPairingsByRound(tournamentId, round);

        const updatePlayerPairing = async (playerId: number, opponentId: number | null, color: string | null, isBye: boolean, points: number) => {
          const pair = roundPairings.find(p => p.playerId === playerId);
          if (pair) {
            await storage.updatePairing(pair.id, {
              opponentId,
              color,
              isBye,
              points,
            });
          } else {
            await storage.createPairing({
              tournamentId,
              round,
              playerId,
              opponentId,
              color,
              isBye,
              points,
            });
          }
        };

        const syncPairingsForMatch = async (match: Match) => {
          if (match.isBye || match.blackPlayerId === null) {
            if (match.whitePlayerId) {
              await updatePlayerPairing(match.whitePlayerId, null, null, true, 2);
            }
          } else {
            if (match.whitePlayerId && match.blackPlayerId) {
              await updatePlayerPairing(match.whitePlayerId, match.blackPlayerId, 'white', false, 0);
              await updatePlayerPairing(match.blackPlayerId, match.whitePlayerId, 'black', false, 0);
            }
          }
        };

        await syncPairingsForMatch(updatedMatch1);
        await syncPairingsForMatch(updatedMatch2);

        const p1 = player1Id ? await storage.getPlayer(player1Id) : null;
        const p2 = player2Id ? await storage.getPlayer(player2Id) : null;
        const p1Name = p1 ? `${p1.firstName} ${p1.lastName}` : "Bye";
        const p2Name = p2 ? `${p2.firstName} ${p2.lastName}` : "Bye";

        await storage.createHistoryEntry({
          tournamentId,
          action: 'manual_swap',
          description: `Swapped player ${p1Name} (from Match ${match1Id}) with ${p2Name} (from Match ${match2Id}) in Round ${round}`,
          changedBy: req.user!.id,
          previousState: JSON.stringify(previousState),
          newState: JSON.stringify({ match1: updatedMatch1, match2: updatedMatch2 }),
          round,
          canRevert: true,
        });

        res.json({ message: "Players swapped successfully." });
      } catch (error: any) {
        console.error("Error swapping players:", error);
        res.status(500).json({ message: "Failed to swap players: " + error.message });
      }
    }
  );

  app.post("/api/tournaments/:id/extra-matches", requireAuth, requireRole('tournament_director'), requireTournamentAccess, async (req, res) => {
    try {
      const tournamentId = parseInt(req.params.id);
      const { round, whitePlayerId, blackPlayerId } = req.body;
      
      if (!round || !whitePlayerId || !blackPlayerId) {
        return res.status(400).json({ message: "Round, White Player ID, and Black Player ID are required." });
      }

      const [newMatch] = await db.insert(matches)
        .values({
          tournamentId,
          round,
          whitePlayerId,
          blackPlayerId,
          board: 99,
          status: "pending",
          isExtraGame: true
        })
        .returning();

      res.status(201).json(newMatch);
    } catch (error) {
      console.error("Error creating extra match:", error);
      res.status(500).json({ message: "Failed to create extra match." });
    }
  });

  app.put("/api/matches/:id", requireAuth, requireRole('tournament_director'), async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const user = req.user;
      if (!user) {
        return res.status(401).json({ message: "User not found" });
      }

      const currentMatch = await storage.getMatch(id);
      if (!currentMatch) {
        return res.status(404).json({ message: "Match not found" });
      }

      const rawResult = req.body.result;
      const normalizedResult = (rawResult === "Pending" || rawResult === null || rawResult === undefined) ? null : rawResult;
      const normalizedStatus = normalizedResult ? "completed" : "pending";
      const updateBody = { ...req.body, result: normalizedResult, status: normalizedStatus };

      const updatedMatch = await storage.updateMatch(id, updateBody);
      if (!updatedMatch) {
        return res.status(404).json({ message: "Match not found" });
      }

      if (currentMatch.result !== updatedMatch.result) {
        const whitePlayerName = currentMatch.whitePlayerId
          ? await storage.getPlayer(currentMatch.whitePlayerId)
          : null;
        const blackPlayerName = currentMatch.blackPlayerId
          ? await storage.getPlayer(currentMatch.blackPlayerId)
          : null;

        const description = blackPlayerName
          ? `Result changed for Round ${currentMatch.round}, Board ${currentMatch.board}: ${whitePlayerName?.firstName} ${whitePlayerName?.lastName} vs ${blackPlayerName.firstName} ${blackPlayerName.lastName} from "${currentMatch.result || 'Pending'}" to "${updatedMatch.result}"`
          : `Bye result changed for Round ${currentMatch.round}: ${whitePlayerName?.firstName} ${whitePlayerName?.lastName} from "${currentMatch.result || 'Pending'}" to "${updatedMatch.result}"`;

        await storage.createHistoryEntry({
          tournamentId: currentMatch.tournamentId,
          action: 'result_change',
          description,
          changedBy: user.id,
          previousState: JSON.stringify(currentMatch),
          newState: JSON.stringify(updatedMatch),
          round: currentMatch.round,
          matchId: currentMatch.id,
          canRevert: true
        });

        try {
          const tournament = await storage.getTournament(currentMatch.tournamentId);
          if (tournament && tournament.format === 'knockout') {
            const t = tournament;
            console.log(`[DEBUG] Handling Knockout Advancement for Tournament ${t.id}, Round ${currentMatch.round}, Board ${currentMatch.board}`);
            
            const allMatches = await storage.getMatchesByTournament(t.id);
            const matchupGames = allMatches.filter(m => 
              m.round === currentMatch.round && 
              m.board === currentMatch.board &&
              (m.bracketType || 'winners') === (currentMatch.bracketType || 'winners') &&
              (m.sectionId || null) === (currentMatch.sectionId || null)
            );
            
            console.log(`[DEBUG] Found ${matchupGames.length} total games for this matchup.`);
            
            const score = calculateMatchupScore(matchupGames);
            const config = parseTournamentConfig(t);
            const format = getMatchFormat(config, currentMatch.round, (currentMatch.bracketType as string) || undefined);
            
            console.log(`[DEBUG] Series Score: P1(${score.p1Id})=${score.p1Score}, P2(${score.p2Id})=${score.p2Score}`);
            console.log(`[DEBUG] Checking thresholds: ${JSON.stringify(format.thresholds)}`);
            
            const decision = isMatchDecided(score, format, updatedMatch);
            console.log(`[DEBUG] Decision result: ${JSON.stringify(decision)}`);
            
            if (decision.winnerId) {
              console.log(`[DEBUG] Match series DECIDED. Winner: ${decision.winnerId}. Advancing...`);
              await advanceKnockoutWinner(t.id, updatedMatch, decision.winnerId);
            } else {
              console.log(`[DEBUG] Match series NOT DECIDED. Current games: ${matchupGames.length}/${format.games || 2}. Checking for Game ${matchupGames.length + 1} spawning...`);
              await spawnNextMatchupGame(t.id, updatedMatch, matchupGames);
            }
          }
        } catch (error: any) {
          console.error(`[ERROR] Knockout Advancement Logic encountered an error:`, error.message);
        }

        try {
          const resultText = updatedMatch.result === '1-0' ? 'White won' : updatedMatch.result === '0-1' ? 'Black won' : updatedMatch.result === '1/2-1/2' ? 'Draw' : updatedMatch.result;
          
          if (whitePlayerName?.userId) {
            await storage.createNotification({
              userId: whitePlayerName.userId,
              title: "Match Result Updated",
              message: `The result for your Round ${currentMatch.round} match against ${blackPlayerName ? `${blackPlayerName.firstName} ${blackPlayerName.lastName}` : 'Bye'} has been recorded: ${resultText}.`,
              type: "result_update",
              meta: { matchId: currentMatch.id, tournamentId: currentMatch.tournamentId }
            });
          }
          if (blackPlayerName?.userId) {
            await storage.createNotification({
              userId: blackPlayerName.userId,
              title: "Match Result Updated",
              message: `The result for your Round ${currentMatch.round} match against ${whitePlayerName ? `${whitePlayerName.firstName} ${whitePlayerName.lastName}` : 'Bye'} has been recorded: ${resultText}.`,
              type: "result_update",
              meta: { matchId: currentMatch.id, tournamentId: currentMatch.tournamentId }
            });
          }
        } catch (notifyErr) {
          console.error(`[ERROR] Post-update notification failed:`, notifyErr);
        }
      }

      res.json(updatedMatch);
    } catch (error) {
      console.error('Update match error:', error);
      res.status(500).json({ message: "Failed to update match" });
    }
  });
}
