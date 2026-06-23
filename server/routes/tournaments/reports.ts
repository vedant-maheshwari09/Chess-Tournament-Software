import type { Express } from "express";
import { eq } from 'drizzle-orm';
import { db } from '../../db';
import { storage } from '../../storage';
import { requireAuth, requireRole, requireTournamentAccess } from '../../auth';
import { parseTournamentConfig } from "@shared/tournament-config";
import { generateFideTrf16Report } from '../../lib/fideTrf';
import { generateUscfDbfZip } from '../../lib/uscfDbf';
import { lookupFideProfiles } from '../../lib/fideDirectory';

export function applyReportsRoutes(app: Express) {
  // Export FIDE TRF
  app.get(
    "/api/tournaments/:id/exports/fide-trf",
    requireAuth,
    requireRole("tournament_director"),
    requireTournamentAccess,
    async (req, res) => {
      try {
        const id = Number.parseInt(req.params.id, 10);
        if (!Number.isFinite(id)) {
          return res.status(400).json({ message: "Invalid tournament id" });
        }

        const tournament = await storage.getTournament(id);
        if (!tournament) {
          return res.status(404).json({ message: "Tournament not found" });
        }

        const [players, matches, pairings] = await Promise.all([
          storage.getPlayersByTournament(id),
          storage.getMatchesByTournament(id),
          storage.getPairingsByTournament(id),
        ]);

        const config = parseTournamentConfig(tournament);

        const sectionId = req.query.sectionId as string | undefined;
        let filteredPlayers = players;
        let filteredMatches = matches;
        let filteredPairings = pairings;

        if (sectionId && sectionId !== "all") {
          filteredPlayers = players.filter(
            (p) => p.sectionId === sectionId || p.sectionName === sectionId
          );
          const playerIds = new Set(filteredPlayers.map((p) => p.id));
          filteredMatches = matches.filter(
            (m) =>
              (m.whitePlayerId && playerIds.has(m.whitePlayerId)) ||
              (m.blackPlayerId && playerIds.has(m.blackPlayerId))
          );
          filteredPairings = pairings.filter((p) => playerIds.has(p.playerId));
        }

        const fideProfiles = await lookupFideProfiles(filteredPlayers);
        const director = await storage.getUserById(tournament.createdBy);
        
        if (director) {
          if (!config.fide) config.fide = {} as any;
          if (!(config.fide as any).chiefArbiterId && director.fideArbiterId) {
            (config.fide as any).chiefArbiterId = director.fideArbiterId;
          }
          if (!(config.fide as any).chiefArbiterTitle && director.fideArbiterTitle) {
            (config.fide as any).chiefArbiterTitle = director.fideArbiterTitle;
          }
        }

        const { content, warnings } = generateFideTrf16Report({
          tournament,
          config,
          players: filteredPlayers,
          matches: filteredMatches,
          pairings: filteredPairings,
          fideProfiles,
        });

        if (!content) {
          return res.status(400).json({ message: "Unable to generate TRF export" });
        }

        const filenameBase = tournament.name?.trim().length
          ? tournament.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")
          : `tournament-${id}`;
        const sectionSuffix = sectionId && sectionId !== "all" ? `-${sectionId.toLowerCase().replace(/[^a-z0-9]+/g, "-")}` : "";
        const filename = `${filenameBase || `tournament-${id}`}${sectionSuffix}-fide-trf16.trf`;

        if (warnings.length > 0) {
          res.setHeader("X-Export-Warnings", warnings.join(" | "));
        }

        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
        res.send(content);
      } catch (error) {
        console.error("TRF generation error", error);
        res.status(500).json({ message: "Failed to generate TRF export" });
      }
    },
  );

  // Export USCF DBF
  app.get(
    "/api/tournaments/:id/exports/uscf-dbf",
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

        const config = parseTournamentConfig(tournament);
        const director = await storage.getUserById(tournament.createdBy);
        if (director) {
          if (!config.uscf) config.uscf = {} as any;
          if (!config.uscf.affiliateId && director.uscfAffiliateId) {
            config.uscf.affiliateId = director.uscfAffiliateId;
          }
          if (!(config.uscf as any).chiefTdId && director.uscfId) {
            (config.uscf as any).chiefTdId = director.uscfId;
          }
        }

        const [players, matches, pairings] = await Promise.all([
          storage.getPlayersByTournament(id),
          storage.getMatchesByTournament(id),
          storage.getPairingsByTournament(id),
        ]);

        const zipBuffer = generateUscfDbfZip({
          tournament,
          config,
          players,
          matches,
          pairings,
        });

        res.setHeader("Content-Type", "application/zip");
        res.setHeader("Content-Disposition", `attachment; filename=uscf-export-${id}.zip`);
        res.send(zipBuffer);
      } catch (error: any) {
        console.error("USCF DBF Export error:", error);
        res.status(500).json({ message: "Failed to generate USCF DBF files: " + error.message });
      }
    }
  );

  // Export full JSON backup of tournament
  app.get(
    "/api/tournaments/:id/backup",
    requireAuth,
    requireTournamentAccess,
    async (req, res) => {
      try {
        const id = parseInt(req.params.id);
        const { tournamentHistory: histTable } = await import('@shared/schema');
        const [tournament, playersList, matchesList, pairingsList, historyList] = await Promise.all([
          storage.getTournament(id),
          storage.getPlayersByTournament(id),
          storage.getMatchesByTournament(id),
          storage.getPairingsByTournament(id),
          db.select().from(histTable).where(eq(histTable.tournamentId, id)),
        ]);

        if (!tournament) {
          return res.status(404).json({ message: "Tournament not found" });
        }

        res.json({
          version: "1.0",
          exportedAt: new Date().toISOString(),
          tournament,
          players: playersList,
          matches: matchesList,
          pairings: pairingsList,
          history: historyList,
        });
      } catch (error: any) {
        console.error("Backup export error:", error);
        res.status(500).json({ message: "Failed to generate JSON backup: " + error.message });
      }
    }
  );

  // Restore full JSON backup of tournament
  app.post(
    "/api/tournaments/:id/restore",
    requireAuth,
    requireTournamentAccess,
    async (req, res) => {
      try {
        const id = parseInt(req.params.id);
        const backupData = req.body;
        const { pairings: pairingsTable, matches: matchesTable, players: playersTable, tournaments: tournamentsTable, tournamentHistory: histTable } = await import('@shared/schema');

        if (!backupData || !backupData.tournament || !Array.isArray(backupData.players)) {
          return res.status(400).json({ message: "Invalid backup data format" });
        }

        const dbTournament = await storage.getTournament(id);
        if (!dbTournament) {
          return res.status(404).json({ message: "Tournament not found" });
        }

        await db.transaction(async (tx) => {
          await tx.delete(pairingsTable).where(eq(pairingsTable.tournamentId, id));
          await tx.delete(matchesTable).where(eq(matchesTable.tournamentId, id));
          await tx.delete(playersTable).where(eq(playersTable.tournamentId, id));
          await tx.delete(histTable).where(eq(histTable.tournamentId, id));

          if (backupData.players.length > 0) {
            const playerInserts = backupData.players.map((p: any) => ({
              id: p.id,
              tournamentId: id,
              userId: p.userId,
              firstName: p.firstName,
              lastName: p.lastName,
              rating: p.rating,
              uscfRating: p.uscfRating,
              fideRating: p.fideRating,
              federation: p.federation,
              seed: p.seed,
              halfPointByesUsed: p.halfPointByesUsed,
              fullPointByesReceived: p.fullPointByesReceived,
              forfeitWinsReceived: p.forfeitWinsReceived,
              isActiveTd: p.isActiveTd,
              sectionId: p.sectionId,
              sectionName: p.sectionName,
              status: p.status,
              email: p.email,
              club: p.club,
              title: p.title,
              birthdate: p.birthdate,
              sex: p.sex,
              localId: p.localId,
              ratingLocal: p.ratingLocal,
              ratingRapid: p.ratingRapid,
              ratingBlitz: p.ratingBlitz,
            }));
            await tx.insert(playersTable).values(playerInserts);
          }

          if (backupData.matches && backupData.matches.length > 0) {
            const matchInserts = backupData.matches.map((m: any) => ({
              id: m.id,
              tournamentId: id,
              round: m.round,
              board: m.board,
              whitePlayerId: m.whitePlayerId,
              blackPlayerId: m.blackPlayerId,
              result: m.result,
              status: m.status,
              isBye: m.isBye,
              whitePoints: m.whitePoints,
              blackPoints: m.blackPoints,
              gameNumber: m.gameNumber,
              bracketType: m.bracketType,
              sectionId: m.sectionId,
              gameType: m.gameType,
              winnerId: m.winnerId,
              isExtraGame: m.isExtraGame,
            }));
            await tx.insert(matchesTable).values(matchInserts);
          }

          if (backupData.pairings && backupData.pairings.length > 0) {
            const pairingInserts = backupData.pairings.map((p: any) => ({
              id: p.id,
              tournamentId: id,
              round: p.round,
              playerId: p.playerId,
              opponentId: p.opponentId,
              color: p.color,
              points: p.points,
              isBye: p.isBye,
              byeType: p.byeType,
              isRequested: p.isRequested,
            }));
            await tx.insert(pairingsTable).values(pairingInserts);
          }

          if (backupData.history && backupData.history.length > 0) {
            const historyInserts = backupData.history.map((h: any) => ({
              id: h.id,
              tournamentId: id,
              action: h.action,
              description: h.description,
              changedBy: h.changedBy,
              previousState: h.previousState,
              newState: h.newState,
              round: h.round,
              matchId: h.matchId,
              playerId: h.playerId,
              canRevert: h.canRevert,
              createdAt: h.createdAt ? new Date(h.createdAt) : new Date(),
            }));
            await tx.insert(histTable).values(historyInserts);
          }

          await tx.update(tournamentsTable)
            .set({
              name: backupData.tournament.name,
              format: backupData.tournament.format,
              status: backupData.tournament.status,
              rounds: backupData.tournament.rounds,
              timeControl: backupData.tournament.timeControl,
              currentRound: backupData.tournament.currentRound,
              isDoubleRoundRobin: backupData.tournament.isDoubleRoundRobin,
              playerCount: backupData.tournament.playerCount,
              useQuickSetup: backupData.tournament.useQuickSetup,
              tiebreakOrder: backupData.tournament.tiebreakOrder,
              location: backupData.tournament.location,
              directorEmail: backupData.tournament.directorEmail,
              roundTimings: backupData.tournament.roundTimings,
              publishOnCalendar: backupData.tournament.publishOnCalendar,
              allowOnlineRegistration: backupData.tournament.allowOnlineRegistration,
              enablePairingPredictor: backupData.tournament.enablePairingPredictor,
              chessResultsUrl: backupData.tournament.chessResultsUrl,
              boardNumberingSettings: backupData.tournament.boardNumberingSettings,
              seedingMethod: backupData.tournament.seedingMethod,
              seedingSource: backupData.tournament.seedingSource,
              matchWinConditions: backupData.tournament.matchWinConditions,
              knockoutMatchFormat: backupData.tournament.knockoutMatchFormat,
              primaryRatingSystem: backupData.tournament.primaryRatingSystem,
              isDoubleElimination: backupData.tournament.isDoubleElimination,
              arenaDuration: backupData.tournament.arenaDuration,
              arenaStartTime: backupData.tournament.arenaStartTime ? new Date(backupData.tournament.arenaStartTime) : null,
              arenaScoringConfig: backupData.tournament.arenaScoringConfig,
              arenaEndStrategy: backupData.tournament.arenaEndStrategy,
              arenaPairingMode: backupData.tournament.arenaPairingMode,
              arenaCutoffMinutes: backupData.tournament.arenaCutoffMinutes,
              arenaCountdownSeconds: backupData.tournament.arenaCountdownSeconds,
              arenaPrePairBeforeStart: backupData.tournament.arenaPrePairBeforeStart,
              startDate: backupData.tournament.startDate ? new Date(backupData.tournament.startDate) : null,
              endDate: backupData.tournament.endDate ? new Date(backupData.tournament.endDate) : null,
              updatedAt: new Date()
            })
            .where(eq(tournamentsTable.id, id));
        });

        await storage.createHistoryEntry({
          tournamentId: id,
          action: "restore_backup",
          description: `Tournament state successfully restored from JSON backup file`,
          changedBy: req.user!.id,
          canRevert: false,
        });

        res.json({ message: "Tournament restored successfully" });
      } catch (error: any) {
        console.error("Backup restore error:", error);
        res.status(500).json({ message: "Failed to restore JSON backup: " + error.message });
      }
    }
  );
}
