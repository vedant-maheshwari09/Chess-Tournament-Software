import { insertMatchSchema } from '@shared/schema';
import type { Express } from "express";
import { z } from "zod";
import Stripe from "stripe";
import crypto from "crypto";

export function generateMatchToken(matchId: number): string {
  const secret = process.env.SESSION_SECRET || "chess-tournament-secret-key-12345";
  return crypto
    .createHmac("sha256", secret)
    .update(`match-${matchId}`)
    .digest("hex")
    .substring(0, 16);
}
import {
  lookupUSCF, lookupFide, mapLocalResult, extractQueryParam, normalizeSearchParams, parseLimitParam, getGeminiConfig, normalizeCurrency, computePaymentTotals, normalizeAccountPaymentSettings, formatCurrencyAmount, describeRatingWindow, generatePairings, groupPlayersByScore, pairUpperVsLowerHalf, determineSwissColors, generateSwissPairings, generateBoardNumberSequence, RatingSource, STRIPE_SECRET_KEY, STRIPE_PUBLISHABLE_KEY, STRIPE_WEBHOOK_SECRET, stripe, PAYMENT_STATUSES, PaymentStatus, RatingLookupResult, paymentProviderEnum, paymentScopeEnum, offlineMethodEnum, updateTournamentPaymentsSchema, accountPaymentSettingsSchema, geminiRefineSchema, updateNotificationPreferencesSchema, tournamentNotificationSchema, createPaymentIntentSchema, playerRegistrationSchema, BoardNumberingSettings,
  advanceKnockoutWinner, spawnNextMatchupGame
} from "./common";

import { storage } from '../storage';
import { requireAuth, requireRole, requireTournamentAccess } from '../auth';
import { notificationService } from '../notifications';
import { parseTournamentConfig, calculateMatchupScore, getMatchFormat, isMatchDecided } from "@shared/tournament-config";
import { generateFideTrf16Report } from '../lib/fideTrf';
import { lookupFideProfiles, searchFideDirectory } from '../lib/fideDirectory';
import { Player, Pairing, Match, PlayerRegistration } from "@shared/schema";


function slugify(text: string): string {
  return text
    .toString()
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')           // Replace spaces with -
    .replace(/[^\w\-]+/g, '')       // Remove all non-word chars
    .replace(/\-\-+/g, '-')         // Replace multiple - with single -
    .replace(/^-+/, '')             // Trim - from start of text
    .replace(/-+$/, '');            // Trim - from end of text
}

export function applyPairingsRoutes(app: Express) {
// Match routes
app.get("/api/tournaments/:tournamentId/matches", async (req, res) => {
    try {
      const tournamentId = parseInt(req.params.tournamentId);
      const round = req.query.round ? parseInt(req.query.round as string) : undefined;

      const matches = round
        ? await storage.getMatchesByRound(tournamentId, round)
        : await storage.getMatchesByTournament(tournamentId);

      res.json(matches);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch matches" });
    }
  });


app.post("/api/tournaments/:tournamentId/matches", requireAuth, requireRole('tournament_director'), requireTournamentAccess, async (req, res) => {
    try {
      const tournamentId = parseInt(req.params.tournamentId);
      const matchData = { ...req.body, tournamentId };
      const match = insertMatchSchema.parse(matchData);
      const newMatch = await storage.createMatch(match);

      // Notify players
      try {
        const whitePlayer = await storage.getPlayer(newMatch.whitePlayerId!);
        const blackPlayer = newMatch.blackPlayerId ? await storage.getPlayer(newMatch.blackPlayerId) : null;
        const tournament = await storage.getTournament(tournamentId);
        const tourneyName = tournament?.name || "Tournament";
        const tourneySlug = tournament ? slugify(tournament.name) : "";

        const sendManualMatchNotification = async (playerObj: any, opponentName: string, color: string) => {
          if (!playerObj || !playerObj.userId) return;

          const title = "New Match Created";
          const message = `Round ${newMatch.round}: A match has been manually created for you against ${opponentName} on Board ${newMatch.board}.`;

          // In-app notification
          await storage.createNotification({
            userId: playerObj.userId,
            title,
            message,
            type: "pairing",
            meta: { matchId: newMatch.id, tournamentId }
          });

          // Fetch user preferences
          const userObj = await storage.getUserById(playerObj.userId);
          if (!userObj) return;

          if (userObj.notifyPairings ?? true) {
            // Web Push notification
            await notificationService.sendWebPushNotificationToUser(
              playerObj.userId,
              title,
              message,
              `/tournaments/${tourneySlug}`
            ).catch(err => console.error("Web Push error:", err));

            // Email notification
            if ((userObj.notifyEmail ?? true) && userObj.email) {
              await notificationService.sendEmail({
                to: userObj.email,
                subject: `New Match Assigned: ${tourneyName}`,
                text: `Hi ${playerObj.firstName},\n\n${message}\n\nBest regards,\nChess Tournament Manager`
              }).catch(err => console.error("Email error:", err));
            }
          }
        };

        if (newMatch.whitePlayerId && whitePlayer) {
          const blackName = blackPlayer ? `${blackPlayer.firstName} ${blackPlayer.lastName}` : "Bye";
          await sendManualMatchNotification(whitePlayer, blackName, "white");
        }
        if (newMatch.blackPlayerId && blackPlayer) {
          const whiteName = whitePlayer ? `${whitePlayer.firstName} ${whitePlayer.lastName}` : "Unknown";
          await sendManualMatchNotification(blackPlayer, whiteName, "black");
        }
      } catch (notifErr) {
        console.error("Error creating manual match notification:", notifErr);
      }

      res.status(201).json(newMatch);
    } catch (error) {
      res.status(400).json({ message: "Invalid match data" });
    }
  });


  // Public mobile submission endpoints
  app.get("/api/matches/:id/details", async (req, res) => {
    try {
      const matchId = parseInt(req.params.id);
      const match = await storage.getMatch(matchId);
      if (!match) return res.status(404).json({ message: "Match not found" });

      const whitePlayer = match.whitePlayerId ? await storage.getPlayer(match.whitePlayerId) : null;
      const blackPlayer = match.blackPlayerId ? await storage.getPlayer(match.blackPlayerId) : null;

      res.json({
        id: match.id,
        board: match.board,
        whiteName: whitePlayer ? `${whitePlayer.firstName} ${whitePlayer.lastName}` : "T.B.D.",
        blackName: blackPlayer ? `${blackPlayer.firstName} ${blackPlayer.lastName}` : (match.blackPlayerId ? "T.B.D." : "Bye"),
      });
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch match details" });
    }
  });

  app.post("/api/matches/:id/submit-public", async (req, res) => {
    try {
      const matchId = parseInt(req.params.id);
      const { result } = req.body;
      if (!result) return res.status(400).json({ message: "Result required" });

      const match = await storage.getMatch(matchId);
      if (!match) return res.status(404).json({ message: "Match not found" });

      // Only allow public submit if match is pending
      if (match.status === "completed" || match.result) {
        return res.status(400).json({ message: "Match already completed. Please see TD." });
      }

      await storage.updateMatch(matchId, {
        result,
        status: "completed"
      });

      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: "Failed to submit result" });
    }
  });

// Pairing routes
app.get("/api/tournaments/:tournamentId/pairings", async (req, res) => {
    try {
      const tournamentId = parseInt(req.params.tournamentId);
      const round = req.query.round ? parseInt(req.query.round as string) : undefined;

      const pairings = round
        ? await storage.getPairingsByRound(tournamentId, round)
        : await storage.getPairingsByTournament(tournamentId);

      res.json(pairings);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch pairings" });
    }
  });

// Bye request routes
app.post("/api/tournaments/:tournamentId/bye-requests", async (req, res) => {
    try {
      const tournamentId = parseInt(req.params.tournamentId);
      const byeRequestData = {
        ...req.body,
        tournamentId,
      };

      const byeRequest = await storage.createByeRequest(byeRequestData);
      res.status(201).json(byeRequest);
    } catch (error) {
      res.status(500).json({ message: "Failed to create bye request" });
    }
  });


app.get("/api/tournaments/:tournamentId/bye-requests", async (req, res) => {
    try {
      const tournamentId = parseInt(req.params.tournamentId);
      const { round } = req.query;

      let byeRequests;
      if (round) {
        byeRequests = await storage.getByeRequestsByRound(tournamentId, parseInt(round as string));
      } else {
        byeRequests = await storage.getByeRequestsByTournament(tournamentId);
      }

      res.json(byeRequests);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch bye requests" });
    }
  });

  // Knockout specific match routes
  app.post("/api/tournaments/:tournamentId/matches/:matchId/confirm-winner", requireAuth, requireRole('tournament_director'), requireTournamentAccess, async (req, res) => {
    try {
      const tournamentId = parseInt(req.params.tournamentId);
      const matchId = parseInt(req.params.matchId);
      const { winnerId } = req.body;

      const match = await storage.getMatch(matchId);
      if (!match) return res.status(404).json({ message: "Match not found" });

      const tournament = await storage.getTournament(tournamentId);
      if (!tournament) return res.status(404).json({ message: "Tournament not found" });

      // Determine winner and loser
      const winnerIdNum = typeof winnerId === 'string' ? parseInt(winnerId) : winnerId;
      const loserId = winnerIdNum === match.whitePlayerId ? match.blackPlayerId : match.whitePlayerId;

      // Mark this match as completed and store winner
      const resultStr = (winnerIdNum === match.whitePlayerId) ? '1-0' : (winnerIdNum === match.blackPlayerId ? '0-1' : null);
      await storage.updateMatch(matchId, { 
        status: 'completed',
        winnerId: winnerIdNum,
        result: resultStr
      });

      console.log(`[KnockoutAdvancement] Match ${match.id} (R${match.round} B${match.board}) winner: ${winnerIdNum}, loser: ${loserId}`);

      // ADVANCE WINNER
      if (tournament.format === 'knockout') {
        await advanceKnockoutWinner(tournamentId, match, winnerIdNum);
      }

      res.json({ message: "Winner confirmed and advanced" });
    } catch (error) {
      console.error("Error confirming winner:", error);
      res.status(500).json({ message: "Failed to confirm winner" });
    }
  });

  app.post("/api/tournaments/:tournamentId/matches/:matchId/games", requireAuth, requireRole('tournament_director'), requireTournamentAccess, async (req, res) => {
    try {
      const tournamentId = parseInt(req.params.tournamentId);
      const matchId = parseInt(req.params.matchId);
      const { whitePlayerId, blackPlayerId } = req.body;

      const baseMatch = await storage.getMatch(matchId);
      if (!baseMatch) return res.status(404).json({ message: "Match not found" });

      // Find the highest game number for this matchup
      const allMatches = await storage.getMatchesByTournament(tournamentId);
      const matchupGames = allMatches.filter(m => 
        m.round === baseMatch.round && 
        m.board === baseMatch.board &&
        m.bracketType === baseMatch.bracketType &&
        m.sectionId === baseMatch.sectionId
      );
      const maxGameNum = Math.max(...matchupGames.map(m => m.gameNumber || 1));

      // Determine colors: alternate by default if not provided
      let finalWhiteId = whitePlayerId;
      let finalBlackId = blackPlayerId;

      if (!finalWhiteId || !finalBlackId) {
        const lastGame = matchupGames.find(m => m.gameNumber === maxGameNum) || baseMatch;
        finalWhiteId = lastGame.blackPlayerId;
        finalBlackId = lastGame.whitePlayerId;
      }

      const newGame = await storage.createMatch({
        tournamentId,
        round: baseMatch.round,
        board: baseMatch.board,
        whitePlayerId: finalWhiteId,
        blackPlayerId: finalBlackId,
        status: 'pending',
        gameNumber: maxGameNum + 1,
        bracketType: baseMatch.bracketType,
        sectionId: baseMatch.sectionId
      });

      res.status(201).json(newGame);
    } catch (error) {
      console.error("Error adding game:", error);
      res.status(500).json({ message: "Failed to add game" });
    }
  });

  app.post("/api/tournaments/:tournamentId/matches/:matchId/reset", requireAuth, requireRole('tournament_director'), requireTournamentAccess, async (req, res) => {
    try {
      const tournamentId = parseInt(req.params.tournamentId);
      const matchId = parseInt(req.params.matchId);

      const match = await storage.getMatch(matchId);
      if (!match) return res.status(404).json({ message: "Match not found" });

      const tournament = await storage.getTournament(tournamentId);

      // Reset this match
      await storage.updateMatch(matchId, { status: 'pending', result: null });

      // Remove winner from the next round
      const currentBracket = match.bracketType || 'winners';
      const nextRound = match.round + 1;
      const nextBoard = Math.ceil((match.board || 1) / 2);
      const isWhite = (match.board || 1) % 2 === 1;

      const allMatches = await storage.getMatchesByTournament(tournamentId);
      const nextMatch = allMatches.find(m => 
        m.round === nextRound && 
        m.board === nextBoard && 
        m.bracketType === currentBracket &&
        m.sectionId === match.sectionId
      );

      if (nextMatch) {
        if (isWhite) {
          await storage.updateMatch(nextMatch.id, { whitePlayerId: null });
        } else {
          await storage.updateMatch(nextMatch.id, { blackPlayerId: null });
        }
      }

      // Remove loser from LB if double elimination
      if (tournament?.isDoubleElimination && currentBracket === 'winners') {
        const lbMatch = allMatches.find(m => 
          m.round === match.round && 
          m.board === match.board && 
          m.bracketType === 'losers' &&
          m.sectionId === match.sectionId
        );
        if (lbMatch) {
          // We don't know who the loser was definitively without history, 
          // but we can clear slots that match the possible losers
          if (lbMatch.whitePlayerId === match.whitePlayerId || lbMatch.whitePlayerId === match.blackPlayerId) {
            await storage.updateMatch(lbMatch.id, { whitePlayerId: null });
          } else if (lbMatch.blackPlayerId === match.whitePlayerId || lbMatch.blackPlayerId === match.blackPlayerId) {
            await storage.updateMatch(lbMatch.id, { blackPlayerId: null });
          }
        }
      }

      res.json({ message: "Match reset and advancement cleared" });
    } catch (error) {
      console.error("Error resetting match:", error);
      res.status(500).json({ message: "Failed to reset match" });
    }
  });

  // Fetch match tokens map (TD only)
  app.get("/api/tournaments/:tournamentId/matches/tokens", requireAuth, requireRole('tournament_director'), requireTournamentAccess, async (req, res) => {
    try {
      const tournamentId = parseInt(req.params.tournamentId);
      const matches = await storage.getMatchesByTournament(tournamentId);
      
      const tokens: Record<number, string> = {};
      matches.forEach(m => {
        tokens[m.id] = generateMatchToken(m.id);
      });

      res.json(tokens);
    } catch (error) {
      console.error("Failed to generate match tokens:", error);
      res.status(500).json({ message: "Failed to generate match tokens" });
    }
  });

  // Public match details fetch endpoint for QR code submissions (unauthenticated)
  app.get("/api/public/matches/:matchId", async (req, res) => {
    try {
      const matchId = parseInt(req.params.matchId);
      const token = req.query.token as string;

      if (!token) {
        return res.status(400).json({ message: "Security token is required" });
      }

      const expectedToken = generateMatchToken(matchId);
      if (token !== expectedToken) {
        return res.status(403).json({ message: "Invalid security token" });
      }

      const match = await storage.getMatch(matchId);
      if (!match) {
        return res.status(404).json({ message: "Match not found" });
      }

      const tournament = await storage.getTournament(match.tournamentId);
      if (!tournament) {
        return res.status(404).json({ message: "Tournament not found" });
      }

      const whitePlayer = match.whitePlayerId ? await storage.getPlayer(match.whitePlayerId) : null;
      const blackPlayer = match.blackPlayerId ? await storage.getPlayer(match.blackPlayerId) : null;

      res.json({
        match,
        tournamentName: tournament.name,
        whitePlayerName: whitePlayer ? `${whitePlayer.firstName} ${whitePlayer.lastName}` : "Bye",
        blackPlayerName: blackPlayer ? `${blackPlayer.firstName} ${blackPlayer.lastName}` : "Bye",
      });
    } catch (error) {
      console.error("Public match fetch error:", error);
      res.status(500).json({ message: "Failed to fetch match details" });
    }
  });

  // Public match result submission endpoint (unauthenticated)
  app.post("/api/public/matches/:matchId/result", async (req, res) => {
    try {
      const matchId = parseInt(req.params.matchId);
      const { token, result } = req.body;

      if (!token) {
        return res.status(400).json({ message: "Security token is required" });
      }

      const expectedToken = generateMatchToken(matchId);
      if (token !== expectedToken) {
        return res.status(403).json({ message: "Invalid security token" });
      }

      const currentMatch = await storage.getMatch(matchId);
      if (!currentMatch) {
        return res.status(404).json({ message: "Match not found" });
      }

      if (currentMatch.status === "completed" || currentMatch.result) {
        return res.status(400).json({
          message: "Match result has already been reported. Please see the Tournament Director if you need to correct a mistake."
        });
      }

      const tournament = await storage.getTournament(currentMatch.tournamentId);
      if (!tournament) {
        return res.status(404).json({ message: "Tournament not found" });
      }

      const rawResult = result;
      const normalizedResult = (rawResult === "Pending" || rawResult === null || rawResult === undefined) ? null : rawResult;
      const normalizedStatus = normalizedResult ? "completed" : "pending";

      const updatedMatch = await storage.updateMatch(matchId, {
        result: normalizedResult,
        status: normalizedStatus,
      });

      if (!updatedMatch) {
        return res.status(404).json({ message: "Failed to update match" });
      }

      if (currentMatch.result !== updatedMatch.result) {
        const whitePlayerName = currentMatch.whitePlayerId
          ? await storage.getPlayer(currentMatch.whitePlayerId)
          : null;
        const blackPlayerName = currentMatch.blackPlayerId
          ? await storage.getPlayer(currentMatch.blackPlayerId)
          : null;

        const description = blackPlayerName
          ? `Result submitted via mobile scan for Round ${currentMatch.round}, Board ${currentMatch.board}: ${whitePlayerName?.firstName} ${whitePlayerName?.lastName} vs ${blackPlayerName.firstName} ${blackPlayerName.lastName} from "${currentMatch.result || 'Pending'}" to "${updatedMatch.result}"`
          : `Bye result submitted via mobile scan for Round ${currentMatch.round}: ${whitePlayerName?.firstName} ${whitePlayerName?.lastName} from "${currentMatch.result || 'Pending'}" to "${updatedMatch.result}"`;

        await storage.createHistoryEntry({
          tournamentId: currentMatch.tournamentId,
          action: 'result_change',
          description,
          changedBy: tournament.createdBy,
          previousState: JSON.stringify(currentMatch),
          newState: JSON.stringify(updatedMatch),
          round: currentMatch.round,
          matchId: currentMatch.id,
          canRevert: true
        });

        // Knockout Advancement Logic
        try {
          if (tournament.format === 'knockout') {
            const allMatches = await storage.getMatchesByTournament(tournament.id);
            const matchupGames = allMatches.filter(m => 
              m.round === currentMatch.round && 
              m.board === currentMatch.board &&
              (m.bracketType || 'winners') === (currentMatch.bracketType || 'winners') &&
              (m.sectionId || null) === (currentMatch.sectionId || null)
            );
            
            const score = calculateMatchupScore(matchupGames);
            const config = parseTournamentConfig(tournament);
            const format = getMatchFormat(config, currentMatch.round, (currentMatch.bracketType as string) || undefined);
            const decision = isMatchDecided(score, format, updatedMatch);
            
            if (decision.winnerId) {
              await advanceKnockoutWinner(tournament.id, updatedMatch, decision.winnerId);
            } else {
              await spawnNextMatchupGame(tournament.id, updatedMatch, matchupGames);
            }
          }
        } catch (advErr: any) {
          console.error("[ERROR] Public result knockout advancement error:", advErr.message);
        }

        // Send notifications
        try {
          const resultText = updatedMatch.result === '1-0' ? 'White won' : updatedMatch.result === '0-1' ? 'Black won' : updatedMatch.result === '1/2-1/2' ? 'Draw' : updatedMatch.result;
          const tourneySlug = tournament ? slugify(tournament.name) : "";

          if (whitePlayerName?.userId) {
            await storage.createNotification({
              userId: player.userId,
              title: "Match Result Updated",
              message: `The result for your Round ${currentMatch.round} match against ${opponentName} has been recorded: ${resultText}.`,
              type: "result_update",
              meta: { matchId: currentMatch.id, tournamentId: currentMatch.tournamentId }
            });

            const uObj = await storage.getUserById(whitePlayerName.userId);
            if (uObj && (uObj.notifyPairings ?? true)) {
              await notificationService.sendWebPushNotificationToUser(
                whitePlayerName.userId,
                "Match Result Updated",
                `The result for your Round ${currentMatch.round} match has been recorded: ${resultText}.`,
                `/tournaments/${tourneySlug}`
              ).catch(err => console.error("Push error:", err));
            }
          }
          if (blackPlayerName?.userId) {
            await storage.createNotification({
              userId: blackPlayerName.userId,
              title: "Match Result Updated",
              message: `The result for your Round ${currentMatch.round} match against ${whitePlayerName ? `${whitePlayerName.firstName} ${whitePlayerName.lastName}` : 'Bye'} has been recorded: ${resultText}.`,
              type: "result_update",
              meta: { matchId: currentMatch.id, tournamentId: currentMatch.tournamentId }
            });

            const uObj = await storage.getUserById(blackPlayerName.userId);
            if (uObj && (uObj.notifyPairings ?? true)) {
              await notificationService.sendWebPushNotificationToUser(
                blackPlayerName.userId,
                "Match Result Updated",
                `The result for your Round ${currentMatch.round} match has been recorded: ${resultText}.`,
                `/tournaments/${tourneySlug}`
              ).catch(err => console.error("Push error:", err));
            }
          }
        } catch (notifyErr) {
          console.error("Public result notify error:", notifyErr);
        }
      }

      res.json({ success: true, match: updatedMatch });
    } catch (error) {
      console.error("Public match result submission error:", error);
      res.status(500).json({ message: "Failed to submit result" });
    }
  });
}
