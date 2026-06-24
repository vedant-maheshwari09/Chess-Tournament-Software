import type { Express } from "express";
import { z } from "zod";
import { eq, sql } from 'drizzle-orm';
import { storage } from '../../storage';
import { requireAuth, requireRole, requireTournamentAccess } from '../../auth';
import { notificationService } from '../../notifications';
import { db } from '../../db';
import { insertTournamentSchema, follows, users, Tournament, Player } from '@shared/schema';
import { parseTournamentConfig } from "@shared/tournament-config";
import { updateWebhookScheduler, testWebhookConnection, syncWebhook } from '../../services/webhookSync';
import {
  generateBoardNumberSequence,
  generatePairings,
  tournamentNotificationSchema,
  BoardNumberingSettings
} from "../common";

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

export function applyCoreRoutes(app: Express) {
  // Get all live tournaments (for players to view)
  app.get("/api/tournaments", async (req, res) => {
    try {
      const tournaments = await storage.getAllTournaments();
      const visibleTournaments = tournaments.filter((tournament) => {
        if (!["active", "upcoming", "completed"].includes(tournament.status)) {
          return false;
        }
        try {
          const config = parseTournamentConfig(tournament);
          return config.registers.showOnCalendar;
        } catch (error) {
          console.error(`Failed to parse config for tournament ${tournament.id}`, error);
          return false;
        }
      });

      const followerCounts = await db.select({
        followingId: follows.followingId,
        count: sql<number>`count(*)::int`
      })
      .from(follows)
      .groupBy(follows.followingId);

      const followerMap = new Map<number, number>(followerCounts.map(f => [f.followingId, f.count]));

      const enrichedTournaments = visibleTournaments.map(t => ({
        ...t,
        creatorSubscribers: followerMap.get(t.createdBy) || 0
      }));

      res.json(enrichedTournaments);
    } catch (error) {
      console.error("Failed to fetch tournaments:", error);
      res.status(500).json({ message: "Failed to fetch tournaments" });
    }
  });

  app.get("/api/tournaments/by-name/:name", async (req, res) => {
    try {
      const nameParam = req.params.name;
      
      // First check if it's a numeric ID
      const possibleId = parseInt(nameParam, 10);
      if (!isNaN(possibleId)) {
        const tournament = await storage.getTournament(possibleId);
        if (tournament) {
          return res.json(tournament);
        }
      }

      // Otherwise, retrieve all tournaments and find a match by slugified name
      const tournaments = await storage.getAllTournaments();
      const targetSlug = slugify(nameParam);
      
      const matched = tournaments.find(t => slugify(t.name) === targetSlug);
      if (matched) {
        return res.json(matched);
      }

      return res.status(404).json({ message: "Tournament not found" });
    } catch (error) {
      res.status(500).json({ message: "Failed to resolve tournament slug" });
    }
  });

  app.get("/api/tournaments/starred", requireAuth, async (req, res) => {
    try {
      const user = req.user;
      if (!user) {
        return res.status(401).json({ message: "User not found" });
      }
      const stars = await storage.getTournamentStarsByUser(user.id);
      res.json(stars);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch starred tournaments" });
    }
  });

  app.post("/api/tournaments/:id/star", requireAuth, requireRole('player'), async (req, res) => {
    try {
      const user = req.user;
      if (!user) {
        return res.status(401).json({ message: "User not found" });
      }
      const tournamentId = Number.parseInt(req.params.id, 10);
      if (!Number.isFinite(tournamentId)) {
        return res.status(400).json({ message: "Invalid tournament id" });
      }
      const tournament = await storage.getTournament(tournamentId);
      if (!tournament) {
        return res.status(404).json({ message: "Tournament not found" });
      }
      const star = await storage.createTournamentStar(user.id, tournamentId);
      res.status(201).json(star);
    } catch (error) {
      res.status(500).json({ message: "Failed to star tournament" });
    }
  });

  app.delete("/api/tournaments/:id/star", requireAuth, requireRole('player'), async (req, res) => {
    try {
      const user = req.user;
      if (!user) {
        return res.status(401).json({ message: "User not found" });
      }
      const tournamentId = Number.parseInt(req.params.id, 10);
      if (!Number.isFinite(tournamentId)) {
        return res.status(400).json({ message: "Invalid tournament id" });
      }
      await storage.deleteTournamentStar(user.id, tournamentId);
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ message: "Failed to unstar tournament" });
    }
  });

  app.post(
    "/api/tournaments/:id/notifications",
    requireAuth,
    requireRole('tournament_director'),
    requireTournamentAccess,
    async (req, res) => {
      try {
        if (!notificationService.isEnabled()) {
          return res.status(503).json({ message: "Notification service is not configured" });
        }

        const payload = tournamentNotificationSchema.parse(req.body ?? {});
        const sendEmail = payload.sendEmail !== false;
        const sendPush = payload.sendPush === true;

        if (!sendEmail && !sendPush) {
          return res.status(400).json({ message: "Select at least one delivery channel" });
        }

        const tournamentId = parseInt(req.params.id);
        const emailRecipients = new Set<string>();
        const userIdsToPush = new Set<number>();

        if (payload.playerIds && payload.playerIds.length > 0) {
          const allPlayers = await storage.getPlayersByTournament(tournamentId);
          const targetedPlayers = allPlayers.filter((p: any) => payload.playerIds!.includes(p.id));

          for (const player of targetedPlayers) {
            if (sendEmail) {
              const playerEmail = (player.email ?? "").trim();
              if (playerEmail) {
                emailRecipients.add(playerEmail);
              } else if (player.userId) {
                const usersList = await storage.listUsersByIds([player.userId]);
                const u = usersList[0];
                if (u?.email && (u.notifyEmail ?? true)) {
                  emailRecipients.add(u.email);
                }
              }
            }

            if (sendPush && player.userId) {
              userIdsToPush.add(player.userId);
            }
          }
        } else {
          const registrations = await storage.getPlayerRegistrationsByTournament(tournamentId);
          const approvedRegistrations = registrations.filter((registration: any) => registration.status === "approved");

          const userIds = Array.from(new Set(approvedRegistrations.map((registration: any) => registration.userId)));
          const usersList = await storage.listUsersByIds(userIds);
          const userMap = new Map(usersList.map((user: any) => [user.id, user]));

          for (const registration of approvedRegistrations) {
            const user = userMap.get(registration.userId) as any;

            if (sendEmail) {
              const wantsEmail = user?.notifyEmail ?? true;
              const email = (registration.email ?? user?.email ?? "").trim();
              if (wantsEmail && email) {
                emailRecipients.add(email);
              }
            }

            if (sendPush && user?.id) {
              userIdsToPush.add(user.id);
            }
          }
        }

        let emailCount = 0;
        let pushCount = 0;

        if (sendEmail && emailRecipients.size > 0) {
          await notificationService.sendEmail({
            to: Array.from(emailRecipients),
            subject: payload.subject,
            text: payload.message,
          });
          emailCount = emailRecipients.size;
        }

        if (sendPush && userIdsToPush.size > 0) {
          const ids = Array.from(userIdsToPush);
          for (const uid of ids) {
            await notificationService.sendWebPushNotificationToUser(uid, payload.subject, payload.message);
          }
          pushCount = userIdsToPush.size;
        }

        res.json({
          message: "Notifications dispatched",
          emails: emailCount,
          push: pushCount,
          targeted: !!payload.playerIds,
        });
      } catch (error) {
        console.error("Tournament notification error:", error);
        if (error instanceof z.ZodError) {
          return res.status(400).json({ message: "Invalid notification payload" });
        }
        res.status(500).json({ message: "Failed to send notifications" });
      }
    },
  );

  // Get tournaments for a specific tournament director (protected)
  app.get("/api/my-tournaments", requireAuth, requireRole('tournament_director'), async (req, res) => {
    try {
      const user = req.user;
      if (!user) {
        return res.status(401).json({ message: "User not found" });
      }
      const tournaments = await storage.getTournamentsByUser(user.id);
      res.json(tournaments);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch your tournaments" });
    }
  });

  // Create tournament (tournament directors only)
  app.post("/api/tournaments", requireAuth, requireRole('tournament_director'), async (req, res) => {
    try {
      const user = req.user;
      if (!user) {
        return res.status(401).json({ message: "User not found" });
      }
      console.log('Creating tournament - user:', user.id);
      console.log('Tournament data received:', req.body);

      const tournamentData = insertTournamentSchema.parse(req.body);
      console.log('Parsed tournament data:', tournamentData);

      const tournamentWithCreator = {
        ...tournamentData,
        createdBy: user.id,
      };
      console.log('Tournament with creator:', tournamentWithCreator);

      const newTournament = await storage.createTournament(tournamentWithCreator);
      console.log('Created tournament:', newTournament);

      // Broadcast notifications to followers
      try {
        const followerList = await db.select({
          id: users.id,
          email: users.email,
          notifyEmail: users.notifyEmail,
          notifyTournamentStatus: users.notifyTournamentStatus
        })
        .from(follows)
        .innerJoin(users, eq(follows.followerId, users.id))
        .where(eq(follows.followingId, user.id));

        const organizationOrName = user.organizationName || `${user.firstName} ${user.lastName}`;
        for (const follower of followerList) {
          // Only notify if user has not explicitly disabled tournament status notifications
          if (follower.notifyTournamentStatus !== false) {
            await storage.createNotification({
              userId: follower.id,
              title: "New Tournament",
              message: `${organizationOrName} has created a new tournament: "${newTournament.name}".`,
              type: "info",
              meta: { tournamentId: newTournament.id },
              read: false,
            }).catch((err: any) => console.error("In-app notification failed:", err));

            await notificationService.sendWebPushNotificationToUser(
              follower.id,
              "New Tournament",
              `${organizationOrName} has created a new tournament: "${newTournament.name}".`,
              `/tournaments/${newTournament.id}`
            ).catch((err: any) => console.error("Web push notification failed:", err));
          }

          if (follower.notifyEmail && follower.email) {
            await notificationService.sendEmail({
              to: follower.email,
              subject: `New Chess Tournament: ${newTournament.name}`,
              text: `Hello,

${organizationOrName} has just created a new tournament: "${newTournament.name}".

Details:
- Format: ${newTournament.format}
- Time Control: ${newTournament.timeControl || 'TBD'}
- Location: ${newTournament.location || 'TBD'}

You can view and register for the tournament here:
${process.env.VITE_APP_URL || process.env.RENDER_EXTERNAL_URL || (req.headers.host ? `${req.secure || req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http'}://${req.headers.host}` : 'https://chesstournamentmanager.onrender.com')}/tournaments/${newTournament.id}

Best regards,
Chess Tournament Manager`
            }).catch((err: any) => console.error("Email notification failed:", err));
          }
        }
      } catch (notifErr) {
        console.error("Failed to broadcast follower notifications:", notifErr);
      }

      res.status(201).json(newTournament);
    } catch (error) {
      console.error('Tournament creation error:', error);
      res.status(400).json({
        message: "Failed to create tournament. Please try again.",
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  app.get("/api/tournaments/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const tournament = await storage.getTournament(id);
      if (!tournament) {
        return res.status(404).json({ message: "Tournament not found" });
      }
      res.json(tournament);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch tournament" });
    }
  });

  app.post("/api/tournaments/:id/reset", requireAuth, requireRole('tournament_director'), requireTournamentAccess, async (req, res) => {
    try {
      const tournamentId = parseInt(req.params.id);
      await storage.resetTournament(tournamentId);
      res.json({ message: "Tournament reset successfully" });
    } catch (error) {
      console.error("[ResetTournament] Error:", error);
      res.status(500).json({ message: "Failed to reset tournament" });
    }
  });

  // Start tournament
  app.post("/api/tournaments/:id/start", requireAuth, requireRole('tournament_director'), requireTournamentAccess, async (req, res) => {
    try {
      const tournamentId = Number.parseInt(req.params.id, 10);
      const tournament = await storage.getTournament(tournamentId);

      if (!tournament) {
        return res.status(404).json({ message: "Tournament not found" });
      }

      if (tournament.status !== "draft" && tournament.status !== "upcoming") {
        return res.status(400).json({ message: "Tournament cannot be started" });
      }

      const forceStart = req.body?.force === true;
      const players = await storage.getPlayersByTournament(tournamentId);
      if (players.length < 2 && !forceStart) {
        return res.status(400).json({ message: "Need at least 2 players to start tournament" });
      }

      let rounds = tournament.rounds;
      if (tournament.format === "roundrobin" && players.length >= 2) {
        rounds = players.length % 2 === 0 ? players.length - 1 : players.length;
      }

      const existingMatches = await storage.getMatchesByTournament(tournamentId);
      if (tournament.format === 'knockout') {
        if (existingMatches.length === 0) {
          return res.status(400).json({ message: "Please generate the knockout bracket before starting the tournament." });
        }
        console.log(`[StartTournament] Knockout pairings already exist, skipping cleanup`);
      } else {
        console.log(`[StartTournament] Clearing existing data for tournament ${tournamentId}`);
        try {
          for (const m of existingMatches) {
            await storage.deleteMatch(m.id);
          }
          const existingPairings = await storage.getPairingsByTournament(tournamentId);
          for (const p of existingPairings) {
            if (!p.isRequested) {
              await storage.deletePairing(p.id);
            }
          }
        } catch (err) {
          console.error(`[StartTournament] Error during cleanup:`, err);
        }
      }

      const updateData: any = {
        status: "active",
        rounds,
        currentRound: 1,
      };

      if (tournament.format === 'arena') {
        const config = parseTournamentConfig(tournament);
        const countdownSeconds = config.arena?.arenaCountdownSeconds || 0;
        const startTimeISO = new Date();
        if (countdownSeconds > 0) {
          startTimeISO.setSeconds(startTimeISO.getSeconds() + countdownSeconds);
        }
        
        updateData.arenaStartTime = startTimeISO.toISOString().replace('Z', '');
        updateData.arenaDuration = tournament.arenaDuration || 90;
        updateData.arenaScoringConfig = tournament.arenaScoringConfig || {
          streakThreshold: 2,
          winBonus: 2,
          drawBonus: 1,
          lossBonus: 0
        };
        updateData.arenaPrePairBeforeStart = config.arena?.arenaPrePairBeforeStart ?? false;

        try {
          await storage.initializeArenaPlayers(tournamentId);
        } catch (err) {
          console.error(`[StartTournament] Error initializing arena players:`, err);
        }

        if (updateData.arenaPrePairBeforeStart) {
          const { pairPool } = await import("../../lib/arenaPairing");
          const activeTournament = await storage.updateTournament(tournamentId, { ...updateData, status: 'active' });
          if (activeTournament) {
            await pairPool(tournamentId, activeTournament);
          }
        }
      }

      const updatedTournament = await storage.updateTournament(tournamentId, updateData);

      const remainingPairings = await storage.getPairingsByTournament(tournamentId);
      const playerMap = new Map(players.map((p: any) => [p.id, p]));

      const pairingsBySection = remainingPairings.reduce((acc: any, pairing: any) => {
        const player = playerMap.get(pairing.playerId);
        if (player) {
          const sectionKey = player.sectionId || 'default';
          if (!acc[sectionKey]) {
            acc[sectionKey] = [];
          }
          acc[sectionKey].push(pairing);
        }
        return acc;
      }, {} as Record<string, any[]>);

      const playersBySection = players.reduce((acc: any, player: any) => {
        const sectionKey = player.sectionId || 'default';
        if (!acc[sectionKey]) {
          acc[sectionKey] = [];
        }
        acc[sectionKey].push(player);
        return acc;
      }, {} as Record<string, Player[]>);

      let totalMatches = 0;
      for (const sectionKey in playersBySection) {
        const sectionPlayers = playersBySection[sectionKey];
        if (sectionPlayers.length < 1) continue;
        if (tournament.format === 'swiss') {
          totalMatches += Math.floor(sectionPlayers.length / 2);
          if (sectionPlayers.length % 2 === 1) {
            totalMatches++;
          }
        }
      }

      const allBoardNumbers = generateBoardNumberSequence(tournament.boardNumberingSettings as BoardNumberingSettings, totalMatches);
      let boardNumberOffset = 0;

      for (const sectionKey in playersBySection) {
        const sectionPlayers = playersBySection[sectionKey];
        if (sectionPlayers.length < 1) continue;

        if (tournament.format === "roundrobin" && sectionPlayers.length >= 2) {
          const { generateRoundRobinSchedule, validateRoundRobinSchedule } = await import('../../round-robin');
          console.log(`Generating Round Robin schedule for ${sectionPlayers.length} players in section ${sectionKey}`);
          const roundRobinPairings = generateRoundRobinSchedule(sectionPlayers);
          const playerIds = sectionPlayers.map((p: any) => p.id);

          if (!validateRoundRobinSchedule(roundRobinPairings, playerIds)) {
            throw new Error(`Invalid Round Robin schedule generated for section ${sectionKey}`);
          }

          for (const pairing of roundRobinPairings) {
            if (pairing.isBye) {
              await storage.createPairing({
                tournamentId,
                round: pairing.round,
                playerId: pairing.whitePlayerId!,
                opponentId: null,
                color: null,
                points: 1,
                isBye: true,
              });
            } else {
              await storage.createPairing({
                tournamentId,
                round: pairing.round,
                playerId: pairing.whitePlayerId!,
                opponentId: pairing.blackPlayerId!,
                color: "white",
                points: 0,
                isBye: false,
              });
              await storage.createPairing({
                tournamentId,
                round: pairing.round,
                playerId: pairing.blackPlayerId!,
                opponentId: pairing.whitePlayerId!,
                color: "black",
                points: 0,
                isBye: false,
              });

              await storage.createMatch({
                tournamentId,
                round: pairing.round,
                whitePlayerId: pairing.whitePlayerId!,
                blackPlayerId: pairing.blackPlayerId!,
                board: pairing.board,
                result: null,
                status: "pending",
              });
            }
          }
        } else if (tournament.format !== 'knockout' && tournament.format !== 'arena' && sectionPlayers.length >= 1) {
          const numSectionMatches = Math.floor(sectionPlayers.length / 2) + (sectionPlayers.length % 2);
          const boardNumbersForSection = allBoardNumbers.slice(boardNumberOffset, boardNumberOffset + numSectionMatches);
          boardNumberOffset += numSectionMatches;
          const sectionPairings = pairingsBySection[sectionKey] || [];
          await generatePairings(tournament, sectionPlayers, [], sectionPairings, 1, boardNumbersForSection);
        }
      }

      res.json(updatedTournament);
    } catch (error) {
      console.error("Start tournament error:", error);
      res.status(500).json({ message: "Failed to start tournament" });
    }
  });

  // Mark tournament as upcoming
  app.post(
    "/api/tournaments/:id/upcoming",
    requireAuth,
    requireRole('tournament_director'),
    requireTournamentAccess,
    async (req, res) => {
      try {
        const tournamentId = parseInt(req.params.id);
        const tournament = await storage.getTournament(tournamentId);

        if (!tournament) {
          return res.status(404).json({ message: "Tournament not found" });
        }

        if (tournament.status === "active") {
          return res.status(400).json({ message: "Tournament already started" });
        }

        if (tournament.status === "completed") {
          return res.status(400).json({ message: "Tournament already completed" });
        }

        const autoStartMode = req.body?.autoStartMode === "auto" ? "auto" : "manual";

        const updatedTournament = await storage.updateTournament(tournamentId, {
          status: "upcoming",
          currentRound: tournament.currentRound ?? 0,
          updatedAt: new Date(),
        });

        if (!updatedTournament) {
          return res.status(404).json({ message: "Tournament not found" });
        }

        if (req.user) {
          await storage.createHistoryEntry({
            tournamentId,
            action: "status_change",
            description:
              autoStartMode === "auto"
                ? "Marked tournament as upcoming with automatic go-live scheduling"
                : "Marked tournament as upcoming for manual start",
            changedBy: req.user.id,
            previousState: JSON.stringify({ status: tournament.status }),
            newState: JSON.stringify({ status: "upcoming", autoStartMode }),
          });
        }

        res.json(updatedTournament);
      } catch (error) {
        console.error("Set upcoming tournament error:", error);
        res.status(500).json({ message: "Failed to mark tournament as upcoming" });
      }
    }
  );

  // Revert history
  app.post("/api/tournaments/:id/history/:historyId/revert", requireAuth, requireRole('tournament_director'), requireTournamentAccess, async (req, res) => {
    try {
      const tournamentId = parseInt(req.params.id);
      const historyId = parseInt(req.params.historyId);

      const history = await storage.getHistoryEntry(historyId);
      if (!history || history.tournamentId !== tournamentId) {
        return res.status(404).json({ message: "History entry not found" });
      }

      if (!history.canRevert) {
        return res.status(400).json({ message: "This change cannot be reverted" });
      }

      if (history.action === 'pairing_generation') {
        const newState = JSON.parse(history.newState || '{}');
        const pairings = newState.pairings || [];
        const matches = newState.matches || [];
        
        for (const p of pairings) {
          await storage.deletePairing(p.id);
        }
        for (const m of matches) {
          await storage.deleteMatch(m.id);
        }
      } else if (history.action === 'repair_round') {
        const previousState = JSON.parse(history.previousState || '{}');
        const pairingsToRestore = previousState.pairings || [];
        const matchesToRestore = previousState.matches || [];

        for (const p of pairingsToRestore) {
          await storage.createPairing(p);
        }
        for (const m of matchesToRestore) {
          await storage.createMatch(m);
        }
      } else if (history.action === 'manual_swap') {
        const previousState = JSON.parse(history.previousState || '{}');
        if (previousState.match1) await storage.updateMatch(previousState.match1.id, previousState.match1);
        if (previousState.match2) await storage.updateMatch(previousState.match2.id, previousState.match2);
      } else if (history.action === 'result_change') {
        const previousMatch = JSON.parse(history.previousState || '{}');
        if (previousMatch.id) {
          await storage.updateMatch(previousMatch.id, previousMatch);
        }
      }

      const { getSupabaseClient } = await import('../../supabaseClient');
      await getSupabaseClient().from('tournament_history').delete().eq('id', history.id);

      res.json({ message: "Reverted successfully" });
    } catch (error: any) {
      console.error("Revert error:", error);
      res.status(500).json({ message: "Failed to revert: " + error.message });
    }
  });

  app.post(
    "/api/tournaments/:id/webhook-sync",
    requireAuth,
    requireRole('tournament_director'),
    requireTournamentAccess,
    async (req, res) => {
      try {
        const id = parseInt(req.params.id);
        const tournament = await storage.getTournament(id);
        if (!tournament) {
          return res.status(404).json({ message: "Tournament not found" });
        }

        const config = req.body.config ? req.body.config : parseTournamentConfig(tournament);
        const result = await syncWebhook({ storage, tournament, config, reason: "manual" });
        await updateWebhookScheduler(storage, tournament.id, result.config);

        if (!result.success) {
          return res.status(result.status).json({ message: result.message, config: result.config });
        }

        res.json(result);
      } catch (error) {
        console.error("Webhook sync error:", error);
        res.status(500).json({ message: "Failed to synchronize with Webhook" });
      }
    }
  );

  app.post(
    "/api/tournaments/:id/webhook-sync/test",
    requireAuth,
    requireRole('tournament_director'),
    requireTournamentAccess,
    async (req, res) => {
      try {
        const id = parseInt(req.params.id);
        const tournament = await storage.getTournament(id);
        if (!tournament) {
          return res.status(404).json({ message: "Tournament not found" });
        }

        const config = req.body.config ? req.body.config : parseTournamentConfig(tournament);
        const result = await testWebhookConnection({ storage, tournament, config });

        res.json(result);
      } catch (error) {
        console.error("Webhook connection test error:", error);
        res.status(500).json({ message: "Failed to test connection to Webhook" });
      }
    }
  );

  // Update tournament (tournament directors only)
  app.put("/api/tournaments/:id", requireAuth, requireRole('tournament_director'), async (req, res) => {
    try {
      const tournamentId = parseInt(req.params.id);
      const tournament = await storage.getTournament(tournamentId);

      if (!tournament) {
        return res.status(404).json({ message: "Tournament not found" });
      }

      if (tournament.createdBy !== req.user!.id && req.user!.role !== 'admin') {
        return res.status(403).json({ message: "Unauthorized to update this tournament" });
      }

      console.log(`[DEBUG] Updating tournament ${tournamentId}. Payload keys:`, Object.keys(req.body));
      if (req.body.roundTimings) {
        console.log(`[DEBUG] roundTimings keys:`, Object.keys(req.body.roundTimings));
      }

      const tournamentData = insertTournamentSchema.partial().parse(req.body);
      const updatedTournament = await storage.updateTournament(tournamentId, tournamentData);

      console.log(`[DEBUG] Tournament ${tournamentId} updated successfully.`);
      res.json(updatedTournament);
    } catch (error) {
      console.error('Tournament update error:', error);
      res.status(400).json({
        message: "Failed to update tournament",
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // Patch tournament config (e.g. for autosaves)
  app.patch("/api/tournaments/:id", requireAuth, requireRole('tournament_director'), async (req, res) => {
    try {
      const tournamentId = parseInt(req.params.id);
      const tournament = await storage.getTournament(tournamentId);

      if (!tournament) {
        return res.status(404).json({ message: "Tournament not found" });
      }

      if (tournament.createdBy !== req.user!.id && req.user!.role !== 'admin') {
        return res.status(403).json({ message: "Unauthorized to update this tournament" });
      }

      const updateData: Partial<Tournament> = {};

      if (req.body.config) {
        const parsedConfig = typeof req.body.config === 'string' ? JSON.parse(req.body.config) : req.body.config;
        updateData.roundTimings = parsedConfig;
        if (parsedConfig.boardNumbering) {
          updateData.boardNumberingSettings = parsedConfig.boardNumbering;
        }
      }

      const otherFields = insertTournamentSchema.partial().safeParse(req.body);
      if (otherFields.success) {
        Object.assign(updateData, otherFields.data);
      }

      const updatedTournament = await storage.updateTournament(tournamentId, updateData);
      res.json(updatedTournament);
    } catch (error) {
      console.error('Tournament patch error:', error);
      res.status(400).json({
        message: "Failed to update tournament config via patch",
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // Delete tournament
  app.delete("/api/tournaments/:id", requireAuth, requireRole('tournament_director'), requireTournamentAccess, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const deleted = await storage.deleteTournament(id);
      if (!deleted) {
        return res.status(404).json({ message: "Tournament not found" });
      }
      res.status(200).json({ message: "Tournament deleted successfully" });
    } catch (error) {
      res.status(500).json({ message: "Failed to delete tournament" });
    }
  });

  // Finish tournament (tournament directors only)
  app.post("/api/tournaments/:id/finish", requireAuth, requireRole('tournament_director'), requireTournamentAccess, async (req, res) => {
    try {
      const id = parseInt(req.params.id);

      const completedTournament = await storage.updateTournament(id, {
        status: 'completed',
        updatedAt: new Date()
      });

      if (!completedTournament) {
        return res.status(404).json({ message: "Tournament not found" });
      }

      res.json({
        message: "Tournament finished successfully",
        tournament: completedTournament
      });
    } catch (error) {
      console.error('Finish tournament error:', error);
      res.status(500).json({ message: "Failed to finish tournament" });
    }
  });

  // Tournament history routes (tournament directors only)
  app.get("/api/tournaments/:id/history", requireAuth, requireRole('tournament_director'), requireTournamentAccess, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const history = await storage.getTournamentHistory(id);
      res.json(history);
    } catch (error) {
      console.error('Get tournament history error:', error);
      res.status(500).json({ message: "Failed to fetch tournament history" });
    }
  });
}
