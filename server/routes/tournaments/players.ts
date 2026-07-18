import type { Express, Request, Response } from "express";
import { storage } from '../../storage';
import { requireAuth, requireRole, requireTournamentAccess } from '../../auth';
import { Player, insertPlayerSchema } from '@shared/schema';
import { getLocalUSCFPlayerById } from "../../lib/localRatings";
import { fetchLiveUscfRating } from "../../lib/uscf-live";

export function applyPlayersRoutes(app: Express) {
  // Player routes
  app.get("/api/tournaments/:tournamentId/players", async (req, res) => {
    try {
      const tournamentId = parseInt(req.params.tournamentId);
      const players = await storage.getPlayersByTournament(tournamentId);
      res.json(players);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch players" });
    }
  });

  app.post("/api/tournaments/:tournamentId/players", requireAuth, requireRole('tournament_director'), requireTournamentAccess, async (req, res) => {
    try {
      const tournamentId = parseInt(req.params.tournamentId);
      const { byeConfiguration, ...playerFields } = req.body;
      const playerData = { ...playerFields, tournamentId };

      if (playerData.rating === "") {
        delete playerData.rating;
      }
      if (playerData.uscfRating === "") {
        playerData.uscfRating = null;
      }
      if (playerData.fideRating === "") {
        playerData.fideRating = null;
      }

      if (playerData.localId) {
        const localPlayer = await getLocalUSCFPlayerById(playerData.localId);
        if (localPlayer) {
          if (!playerData.uscfMemberExpiry && localPlayer.metadata?.expiration) {
            playerData.uscfMemberExpiry = localPlayer.metadata.expiration;
          }
          if (!playerData.uscfRatingRaw && localPlayer.rating?.raw) {
            playerData.uscfRatingRaw = localPlayer.rating.raw;
          }
          if ((playerData.uscfRating === undefined || playerData.uscfRating === null) && localPlayer.rating?.value) {
            playerData.uscfRating = parseInt(localPlayer.rating.value, 10) || null;
          }
          if ((playerData.rating === undefined || playerData.rating === null) && localPlayer.rating?.value) {
            playerData.rating = parseInt(localPlayer.rating.value, 10) || 0;
          }
        }
      }

      const player = insertPlayerSchema.parse(playerData);

      // If this player is being set as houseplayer, deactivate any existing houseplayer
      if (player.isActiveTd) {
        const existingPlayers = await storage.getPlayersByTournament(tournamentId);
        for (const existingPlayer of existingPlayers) {
          if (existingPlayer.isActiveTd) {
            await storage.updatePlayer(existingPlayer.id, { isActiveTd: false });
          }
        }
      }

      const newPlayer = await storage.createPlayer(player);

      // Create bye pairings if specified
      if (byeConfiguration && Array.isArray(byeConfiguration) && byeConfiguration.length > 0) {
        for (const byeEntry of byeConfiguration) {
          const pointsPerBye = byeEntry.type === "half_point" ? 1 : 0;

          await storage.createPairing({
            tournamentId,
            round: byeEntry.round,
            playerId: newPlayer.id,
            opponentId: null,
            color: null,
            points: pointsPerBye,
            isBye: true,
            byeType: byeEntry.type
          });
        }
      }

      res.status(201).json(newPlayer);
    } catch (error) {
      console.error('Player creation error:', error);
      res.status(400).json({ message: "Invalid player data" });
    }
  });

  app.get(
    "/api/tournaments/:tournamentId/players/:playerId",
    requireAuth,
    requireRole('tournament_director'),
    requireTournamentAccess,
    async (req, res) => {
      try {
        const tournamentId = parseInt(req.params.tournamentId);
        const playerId = parseInt(req.params.playerId);
        const player = await storage.getPlayer(playerId);
        if (!player || player.tournamentId !== tournamentId) {
          return res.status(404).json({ message: "Player not found" });
        }
        res.json(player);
      } catch (error) {
        console.error("Fetch player error:", error);
        res.status(500).json({ message: "Failed to fetch player" });
      }
    },
  );

  app.put(
    "/api/tournaments/:tournamentId/players/:playerId",
    requireAuth,
    requireRole('tournament_director'),
    requireTournamentAccess,
    async (req, res) => {
      try {
        const tournamentId = parseInt(req.params.tournamentId);
        const playerId = parseInt(req.params.playerId);
        const existing = await storage.getPlayer(playerId);
        if (!existing || existing.tournamentId !== tournamentId) {
          return res.status(404).json({ message: "Player not found" });
        }

        const updates: Partial<Player> = {};
        if (typeof req.body?.firstName === "string" && req.body.firstName.trim()) {
          updates.firstName = req.body.firstName.trim();
        }
        if (typeof req.body?.lastName === "string" && req.body.lastName.trim()) {
          updates.lastName = req.body.lastName.trim();
        }
        if (req.body?.rating !== undefined && req.body?.rating !== null) {
          const numericRating = Number(req.body.rating);
          if (Number.isFinite(numericRating)) {
            updates.rating = Math.max(0, Math.round(numericRating));
          }
        }
        if (req.body?.uscfRating !== undefined && req.body?.uscfRating !== null) {
          const numeric = Number(req.body.uscfRating);
          if (Number.isFinite(numeric)) {
            updates.uscfRating = Math.max(0, Math.round(numeric));
          }
        }
        if (req.body?.fideRating !== undefined && req.body?.fideRating !== null) {
          const numeric = Number(req.body.fideRating);
          if (Number.isFinite(numeric)) {
            updates.fideRating = Math.max(0, Math.round(numeric));
          }
        }
        if (req.body?.uscfRatingRaw !== undefined) {
          updates.uscfRatingRaw = req.body.uscfRatingRaw;
        }
        if (req.body?.fideRatingRaw !== undefined) {
          updates.fideRatingRaw = req.body.fideRatingRaw;
        }
        if (typeof req.body?.federation === "string" && req.body.federation.trim()) {
          updates.federation = req.body.federation.trim();
        }
        if (req.body?.sectionId === null) {
          updates.sectionId = null;
        } else if (typeof req.body?.sectionId === "string") {
          const trimmed = req.body.sectionId.trim();
          updates.sectionId = trimmed.length > 0 ? trimmed : null;
        }
        if (req.body?.sectionName === null) {
          updates.sectionName = null;
        } else if (typeof req.body?.sectionName === "string") {
          const trimmed = req.body.sectionName.trim();
          updates.sectionName = trimmed.length > 0 ? trimmed : null;
        }

        if (req.body?.paymentStatus !== undefined) {
          updates.paymentStatus = req.body.paymentStatus;
        }
        if (req.body?.uscfMemberExpiry !== undefined) {
          updates.uscfMemberExpiry = req.body.uscfMemberExpiry;
        }
        if (req.body?.club !== undefined) {
          updates.club = req.body.club;
        }
        if (req.body?.email !== undefined) {
          updates.email = req.body.email;
        }
        if (req.body?.birthdate !== undefined) {
          updates.birthdate = req.body.birthdate;
        }
        if (req.body?.localId !== undefined) {
          updates.localId = req.body.localId;
          if (req.body.localId && req.body.localId !== existing.localId) {
            const localPlayer = await getLocalUSCFPlayerById(req.body.localId);
            if (localPlayer) {
              if (localPlayer.metadata?.expiration && req.body.uscfMemberExpiry === undefined) {
                updates.uscfMemberExpiry = localPlayer.metadata.expiration;
              }
              if (localPlayer.rating?.raw && req.body.uscfRatingRaw === undefined) {
                updates.uscfRatingRaw = localPlayer.rating.raw;
              }
              if (localPlayer.rating?.value) {
                if (req.body.uscfRating === undefined) {
                  updates.uscfRating = parseInt(localPlayer.rating.value, 10) || null;
                }
                if (req.body.rating === undefined) {
                  updates.rating = parseInt(localPlayer.rating.value, 10) || 0;
                }
              }
            }
          }
        }

        if (Object.keys(updates).length === 0) {
          return res.status(400).json({ message: "No changes provided" });
        }

        const updated = await storage.updatePlayer(playerId, updates);
        res.json(updated);
      } catch (error) {
        console.error("Update player error:", error);
        res.status(500).json({ message: "Failed to update player" });
      }
    },
  );

  app.delete("/api/players/:id", requireAuth, requireRole('tournament_director'), async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const user = req.user;
      if (!user) {
        return res.status(401).json({ message: "User not found" });
      }

      const player = await storage.getPlayer(id);
      if (!player) {
        return res.status(404).json({ message: "Player not found" });
      }

      const tournament = await storage.getTournament(player.tournamentId);
      if (!tournament || tournament.createdBy !== user.id) {
        return res.status(403).json({ message: "Access denied to this tournament" });
      }

      await storage.deletePlayer(id);
      res.status(200).json({ message: "Player deleted successfully" });
    } catch (error) {
      res.status(500).json({ message: "Failed to delete player" });
    }
  });

  // Update player status (for mid-tournament withdrawals and bye requests)
  app.put("/api/players/:id/status", requireAuth, requireRole('tournament_director'), async (req, res) => {
    try {
      const playerId = parseInt(req.params.id);
      const { status, byeRounds } = req.body;
      console.log(`Player ${playerId} status update request:`, { status, byeRounds });

      const user = req.user;
      if (!user) {
        return res.status(401).json({ message: "User not found" });
      }

      const player = await storage.getPlayer(playerId);
      if (!player) {
        return res.status(404).json({ message: "Player not found" });
      }

      const tournament = await storage.getTournament(player.tournamentId);
      if (!tournament || tournament.createdBy !== user.id) {
        return res.status(403).json({ message: "Access denied" });
      }

      const currentMatches = await storage.getMatchesByTournament(player.tournamentId);
      const currentRound = currentMatches.length > 0 ? Math.max(...currentMatches.map((m: any) => m.round)) : 0;

      const allPairings = await storage.getPairingsByTournament(player.tournamentId);
      const currentPlayerByes = allPairings.filter((p: any) => p.playerId === playerId && p.isBye);
      const currentWithdrawnByes = currentPlayerByes.filter((p: any) =>
        p.byeType === "zero_point" && !p.isRequested
      );
      const currentPlayerStatus = currentWithdrawnByes.length > 0 ? "withdrawn" : "active";

      if (status !== currentPlayerStatus) {
        if (status === "withdrawn") {
          const tournament = await storage.getTournament(player.tournamentId);
          if (tournament && tournament.rounds) {
            for (let round = currentRound + 1; round <= tournament.rounds; round++) {
              const existingByes = await storage.getPairingsByRound(player.tournamentId, round);
              const existingBye = existingByes.find((p: any) => p.playerId === playerId && p.isBye);

              if (!existingBye) {
                await storage.createPairing({
                  tournamentId: player.tournamentId,
                  round: round,
                  playerId: playerId,
                  opponentId: null,
                  color: null,
                  points: 0,
                  isBye: true,
                  byeType: "zero_point",
                  isRequested: false
                });
              }
            }
          }
        } else if (status === "active") {
          const futureWithdrawnByes = allPairings.filter((p: any) =>
            p.playerId === playerId &&
            p.isBye &&
            p.byeType === "zero_point" &&
            p.round > currentRound &&
            !p.isRequested
          );

          for (const bye of futureWithdrawnByes) {
            await storage.deletePairing(bye.id);
          }
        }
      }

      if (byeRounds && Array.isArray(byeRounds) && byeRounds.length > 0) {
        for (const byeEntry of byeRounds) {
          const pointsPerBye = byeEntry.type === "half_point" ? 1 :
            byeEntry.type === "zero_point" ? 0 : 2;

          const existingByes = await storage.getPairingsByRound(player.tournamentId, byeEntry.round);
          const existingBye = existingByes.find((p: any) => p.playerId === playerId && p.isBye);

          if (!existingBye) {
            await storage.createPairing({
              tournamentId: player.tournamentId,
              round: byeEntry.round,
              playerId: playerId,
              opponentId: null,
              color: null,
              points: pointsPerBye,
              isBye: true,
              byeType: byeEntry.type,
              isRequested: true
            });
          }
        }
      }

      const finalPairings = await storage.getPairingsByTournament(player.tournamentId);
      const finalPlayerByes = finalPairings.filter((p: any) => p.playerId === playerId && p.isBye);
      const finalWithdrawnByes = finalPlayerByes.filter((p: any) =>
        p.byeType === "zero_point" && !p.isRequested
      );
      const finalStatus = finalWithdrawnByes.length > 0 ? "withdrawn" : "active";

      console.log(`Player ${playerId} final status calculation:`, {
        totalByes: finalPlayerByes.length,
        withdrawnByes: finalWithdrawnByes.length,
        finalStatus,
        byeDetails: finalPlayerByes.map(b => ({ round: b.round, type: b.byeType, requested: b.isRequested }))
      });

      res.json({
        message: `Player ${finalStatus === "withdrawn" ? "withdrawn" : "status updated"} successfully`,
        status: finalStatus,
        byeRounds,
        addedByes: byeRounds?.length || 0
      });
    } catch (error) {
      console.error('Player status update error:', error);
      res.status(500).json({ message: "Failed to update player status" });
    }
  });

  // Update player seed manually
  app.patch("/api/players/:id/seed", requireAuth, requireRole('tournament_director'), async (req, res) => {
    try {
      const playerId = parseInt(req.params.id);
      const { seed } = req.body;

      const user = req.user;
      if (!user) {
        return res.status(401).json({ message: "User not found" });
      }

      const player = await storage.getPlayer(playerId);
      if (!player) {
        return res.status(404).json({ message: "Player not found" });
      }

      const tournament = await storage.getTournament(player.tournamentId);
      if (!tournament || tournament.createdBy !== user.id) {
        return res.status(403).json({ message: "Access denied" });
      }

      const updated = await storage.updatePlayer(playerId, { seed: seed === null || seed === "" ? null : parseInt(seed) });
      res.json(updated);
    } catch (error) {
      console.error('Player seed update error:', error);
      res.status(500).json({ message: "Failed to update player seed" });
    }
  });

  app.post(
    "/api/tournaments/:id/import-players",
    requireAuth,
    requireRole('tournament_director'),
    requireTournamentAccess,
    async (req: Request, res: Response) => {
      try {
        const targetTournamentId = parseInt(req.params.id);
        const { sourceTournamentId, playerIds } = req.body;

        if (!sourceTournamentId || !Array.isArray(playerIds) || playerIds.length === 0) {
          return res.status(400).json({ message: "Source tournament and player IDs are required" });
        }

        const sourcePlayers = await storage.getPlayersByTournament(sourceTournamentId);
        const playersToClone = sourcePlayers.filter(p => playerIds.includes(p.id));

        if (playersToClone.length === 0) {
          return res.status(400).json({ message: "No players found to clone" });
        }

        const clonedPlayers = [];
        for (const p of playersToClone) {
          const clonedPlayer = await storage.createPlayer({
            tournamentId: targetTournamentId,
            userId: p.userId,
            firstName: p.firstName,
            lastName: p.lastName,
            rating: p.rating,
            uscfRating: p.uscfRating,
            fideRating: p.fideRating,
            uscfRatingRaw: p.uscfRatingRaw,
            fideRatingRaw: p.fideRatingRaw,
            federation: p.federation || 'USCF',
            email: p.email,
            club: p.club,
            title: p.title,
            birthdate: p.birthdate,
            sex: p.sex,
            localId: p.localId,
            ratingLocal: p.ratingLocal,
            ratingRapid: p.ratingRapid,
            ratingBlitz: p.ratingBlitz,
            isActiveTd: false,
            sectionId: p.sectionId,
            sectionName: p.sectionName,
            status: 'active'
          });
          clonedPlayers.push(clonedPlayer);
        }

        res.json({ message: `Successfully imported ${clonedPlayers.length} players`, players: clonedPlayers });
      } catch (error) {
        console.error("Import players error:", error);
        res.status(500).json({ message: "Failed to import players" });
      }
    }
  );

  // Bulk-create players from a template file (no source tournament needed)
  app.post(
    "/api/tournaments/:id/bulk-create-players",
    requireAuth,
    requireRole('tournament_director'),
    requireTournamentAccess,
    async (req: Request, res: Response) => {
      try {
        const targetTournamentId = parseInt(req.params.id);
        const { players } = req.body as { players: any[] };

        if (!Array.isArray(players) || players.length === 0) {
          return res.status(400).json({ message: "players array is required and must not be empty" });
        }

        const created = [];
        for (const p of players) {
          if (!p.firstName || !p.lastName) continue;
          const newPlayer = await storage.createPlayer({
            tournamentId: targetTournamentId,
            userId: null,
            firstName: String(p.firstName),
            lastName: String(p.lastName),
            rating: typeof p.rating === "number" ? p.rating : null,
            uscfRating: typeof p.uscfRating === "number" ? p.uscfRating : null,
            fideRating: typeof p.fideRating === "number" ? p.fideRating : null,
            federation: p.federation ? String(p.federation) : "USCF",
            email: p.email ? String(p.email) : null,
            club: p.club ? String(p.club) : null,
            title: p.title ? String(p.title) : null,
            birthdate: p.birthdate ? String(p.birthdate) : null,
            sex: p.sex ? String(p.sex) : null,
            localId: p.localId ? String(p.localId) : null,
            ratingLocal: typeof p.ratingLocal === "number" ? p.ratingLocal : null,
            ratingRapid: typeof p.ratingRapid === "number" ? p.ratingRapid : null,
            ratingBlitz: typeof p.ratingBlitz === "number" ? p.ratingBlitz : null,
            isActiveTd: false,
            sectionId: p.sectionId ? String(p.sectionId) : null,
            sectionName: p.sectionName ? String(p.sectionName) : null,
            status: "active",
          });
          created.push(newPlayer);
        }

        res.json({ message: `Successfully imported ${created.length} players from template`, players: created });
      } catch (error) {
        console.error("Bulk create players error:", error);
        res.status(500).json({ message: "Failed to bulk-create players from template" });
      }
    }
  );

  app.post(
    "/api/tournaments/:tournamentId/players/:playerId/sync-rating",
    requireAuth,
    requireRole('tournament_director'),
    requireTournamentAccess,
    async (req, res) => {
      try {
        const tournamentId = parseInt(req.params.tournamentId, 10);
        const playerId = parseInt(req.params.playerId, 10);

        const player = await storage.getPlayer(playerId);
        if (!player) {
          return res.status(404).json({ message: "Player not found" });
        }

        if (player.tournamentId !== tournamentId) {
          return res.status(400).json({ message: "Player does not belong to this tournament" });
        }

        const isUscf = player.federation === "USCF" || player.federation === "United States" || player.federation === "US Chess" || !player.federation;
        const uscfId = player.localId;
        if (!isUscf || !uscfId || !/^\d{7,8}$/.test(uscfId.trim())) {
          return res.status(400).json({
            message: "Player does not have a valid 7 or 8-digit USCF ID configured."
          });
        }

        console.log(`[USCF Rating Sync] Fetching live USCF rating for Player ${player.firstName} ${player.lastName} (ID: ${uscfId.trim()})`);
        const latest = await fetchLiveUscfRating(uscfId.trim());

        const updatedFields: Partial<typeof player> = {
          uscfRating: latest.ratingRegular,
          uscfRatingRaw: latest.ratingRegular ? `${latest.ratingRegular}/${latest.expiry}` : player.uscfRatingRaw,
          uscfMemberExpiry: latest.expiry || player.uscfMemberExpiry,
          ratingLocal: latest.ratingRegular,
          ratingRapid: latest.ratingQuick,
          ratingBlitz: latest.ratingBlitz,
        };

        if (latest.ratingRegular !== null) {
          updatedFields.rating = latest.ratingRegular;
        }

        const updatedPlayer = await storage.updatePlayer(playerId, updatedFields);
        res.json({
          message: `Successfully synced rating for ${player.firstName} ${player.lastName}.`,
          player: updatedPlayer
        });
      } catch (error) {
        console.error("[USCF Rating Sync Endpoint] Error:", error);
        const msg = error instanceof Error ? error.message : "Failed to sync player rating";
        res.status(500).json({ message: msg });
      }
    }
  );
}
