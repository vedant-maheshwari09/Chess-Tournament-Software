import type { Express, Request, Response } from "express";
import { z } from "zod";
import { eq, and } from 'drizzle-orm';
import { db } from '../../db';
import { storage } from '../../storage';
import { requireAuth, requireRole, requireTournamentAccess } from '../../auth';
import { notificationService } from '../../notifications';
import { parseTournamentConfig } from "@shared/tournament-config";
import { Tournament, Player, Pairing, Match, PlayerRegistration } from "@shared/schema";
import { generateKnockoutPairings, generateDoubleEliminationPairings } from '../../knockout';
import {
  generateBoardNumberSequence,
  generatePairings,
  generateSwissPairings,
  BoardNumberingSettings
} from "../common";

async function notifyRoundPairings(tournamentId: number, round: number) {
  try {
    const tournament = await storage.getTournament(tournamentId);
    if (!tournament) return;

    const players = await storage.getPlayersByTournament(tournamentId);
    if (players.length === 0) return;

    const playerMap = new Map(players.map(p => [p.id, p]));
    const userIds = Array.from(new Set(players.map(p => p.userId).filter(Boolean))) as number[];
    const usersList = await storage.listUsersByIds(userIds);
    const userMap = new Map(usersList.map(u => [u.id, u]));

    const matches = await storage.getMatchesByRound(tournamentId, round);
    const pairings = await storage.getPairingsByRound(tournamentId, round);

    const sendRealNotification = async (userId: number, title: string, message: string, preferenceKey: 'notifyPairings' | 'notifyTournamentStatus') => {
      const userObj = userMap.get(userId) as any;
      if (!userObj || !(userObj[preferenceKey] ?? true)) return;

      // In-app notification (awaited since it is a fast local DB insert)
      await storage.createNotification({
        userId,
        title,
        message,
        type: preferenceKey === 'notifyPairings' ? 'pairing' : 'tournament_status',
        meta: { tournamentId }
      }).catch(err => console.error("Failed to create in-app notification:", err));

      // Email notification (run in background, not awaited)
      if ((userObj.notifyEmail ?? true) && userObj.email) {
        notificationService.sendEmail({ to: userObj.email, subject: title, text: message }).catch((err: any) => console.error(`Failed to send email to ${userObj.email}:`, err));
      }

      // Web Push notification (run in background, not awaited)
      notificationService.sendWebPushNotificationToUser(userId, title, message).catch((err: any) => console.error(`Failed to send push to ${userObj.username}:`, err));
    };

    for (const pairing of pairings) {
      const player = playerMap.get(pairing.playerId);
      if (!player || !player.userId) continue;

      const title = `Round ${round} Pairings`;

      if (pairing.isBye) {
        const message = `Round ${round}: You have a bye for this round.`;
        await sendRealNotification(player.userId, title, message, 'notifyPairings');
      } else {
        const opponent = playerMap.get(pairing.opponentId!);
        const opponentName = opponent ? `${opponent.firstName} ${opponent.lastName}` : "Unknown";
        const color = pairing.color || "white";
        
        const match = matches.find(m => 
          (m.whitePlayerId === player.id && m.blackPlayerId === opponent?.id) || 
          (m.blackPlayerId === player.id && m.whitePlayerId === opponent?.id)
        );
        const boardText = match ? ` on Board ${match.board}` : "";
        const message = `Round ${round}: You are playing ${color === 'white' ? 'White' : 'Black'} against ${opponentName}${boardText}.`;
        await sendRealNotification(player.userId, title, message, 'notifyPairings');
      }
    }
  } catch (error) {
    console.error("Failed to run notifyRoundPairings:", error);
  }
}

export function applyPairingsRoutes(app: Express) {
  // Generate Knockout Bracket
  app.post("/api/tournaments/:id/generate-knockout", requireAuth, requireRole('tournament_director'), requireTournamentAccess, async (req, res) => {
      try {
          const tournamentId = parseInt(req.params.id);
          const tournament = await storage.getTournament(tournamentId);

          if (!tournament) {
              return res.status(404).json({ message: "Tournament not found" });
          }

          if (tournament.status !== "draft" && tournament.status !== "upcoming" && tournament.status !== "registration") {
              return res.status(400).json({ message: "Bracket can only be generated for draft, registration or upcoming tournaments" });
          }

          // Cleanup existing matches and pairings atomically
          console.log(`Resetting tournament ${tournamentId} before knockout generation`);
          await storage.resetTournament(tournamentId);

          const players = await storage.getPlayersByTournament(tournamentId);
          console.log(`Knockout generation: Current player count for tournament ${tournamentId} is ${players.length}`);

          if (players.length < 2) {
              return res.status(400).json({ message: "At least 2 players are required to generate a bracket" });
          }

          console.log(`[ROUTE-DEBUG] Initializing grouping for ${players.length} total players...`);

          const config = parseTournamentConfig(tournament);
          const configSections = config.sections || [];
          const mainSectionId = configSections.length > 0 ? configSections[0].id : null;
          const mainSectionName = configSections.length > 0 ? configSections[0].name : null;
          
          console.log(`[ROUTE-DEBUG] Tournament config has ${configSections.length} sections. Main section: ${mainSectionName} (${mainSectionId})`);

          const playersBySection: Record<string, Player[]> = {};
          const nameToIdMap: Record<string, string> = {};
          const sectionNames: Record<string, string> = {};
          configSections.forEach(s => {
            if (s.id && s.name) {
              nameToIdMap[s.name.toLowerCase().trim()] = s.id;
              sectionNames[s.id] = s.name;
            }
          });
          players.forEach(p => {
            if (p.sectionId && p.sectionName) {
              nameToIdMap[p.sectionName.toLowerCase().trim()] = p.sectionId;
              sectionNames[p.sectionId] = p.sectionName;
            }
          });

          players.forEach(player => {
              let sKey: string;
              const pSectionNameNormalized = player.sectionName?.toLowerCase().trim();
              
              console.log(`[DRIVE-SYNC] Mapping Player: ${player.firstName} ${player.lastName} (ID: ${player.id}) | SectionID: ${player.sectionId} | SectionName: ${player.sectionName}`);

              if (configSections.length === 1 && mainSectionId) {
                  sKey = mainSectionId;
                  console.log(`  -> FORCED to single main section: ${sKey}`);
              } else if (player.sectionId) {
                  sKey = player.sectionId;
                  console.log(`  -> Found existing sectionId: ${sKey}`);
              } else if (pSectionNameNormalized && nameToIdMap[pSectionNameNormalized]) {
                  sKey = nameToIdMap[pSectionNameNormalized];
                  console.log(`  -> Normalized name match: ${pSectionNameNormalized} maps to ${sKey}`);
              } else if (mainSectionId) {
                  sKey = mainSectionId;
                  console.log(`  -> Fallback to mainSectionId: ${sKey}`);
              } else {
                  const anyValidId = players.find(p => p.sectionId)?.sectionId;
                  sKey = anyValidId || player.sectionId || player.sectionName || 'default';
                  console.log(`  -> Ultimate fallback: ${sKey}`);
              }
              
              if (!sectionNames[sKey]) {
                  sectionNames[sKey] = player.sectionName || sKey;
              }
              
              if (!playersBySection[sKey]) {
                  playersBySection[sKey] = [];
              }
              playersBySection[sKey].push(player);
          });

          const sectionKeys = Object.keys(playersBySection);
          console.log(`[ROUTE-DEBUG] Found ${sectionKeys.length} sections: ${sectionKeys.join(', ')}`);
          for (const key of sectionKeys) {
              console.log(`[ROUTE-DEBUG] Section [${key}] has ${playersBySection[key].length} players`);
          }

          let globalMaxRound = 0;
          for (const sectionKey in playersBySection) {
              const sectionPlayers = playersBySection[sectionKey];
              console.log(`[ROUTE-DEBUG] PROCESSING SECTION [${sectionKey}] with ${sectionPlayers.length} players.`);
              if (sectionPlayers.length < 2) {
                console.log(`[ROUTE-DEBUG] Skipping section [${sectionKey}] because it only has ${sectionPlayers.length} players.`);
                continue;
              }

              console.log(`Generating Knockout bracket for ${sectionPlayers.length} players in section ${sectionKey}`);
              
              let sortedPlayers;
              const config = parseTournamentConfig(tournament);
              let seedingMethod: "rating" | "random" | "slaughter" | "manual" | "fide_world_cup" | "standard" = "fide_world_cup";
              const seedingMethodInput = req.body.seedingMethod || tournament.seedingMethod || "Standard Knockout System(Default)";
              
              const inputLower = seedingMethodInput.toLowerCase();
              if (inputLower.includes('slaughter')) {
                seedingMethod = 'slaughter';
              } else if (inputLower.includes('random')) {
                seedingMethod = 'random';
              } else if (inputLower.includes('manual')) {
                seedingMethod = 'manual';
              } else {
                seedingMethod = 'fide_world_cup';
              }
              console.log(`[ROUTE-DEBUG] Resolved Seeding Method: ${seedingMethod} (from input: "${seedingMethodInput}")`);
              
              const isDoubleElim = tournament.isDoubleElimination || config.registers?.isDoubleElimination || false;
              const seedingSource = config.seedingSource || 'rating';

              if (seedingMethod === 'random') {
                sortedPlayers = [...sectionPlayers].sort(() => Math.random() - 0.5);
              } else if (seedingMethod === 'manual') {
                sortedPlayers = [...sectionPlayers].sort((a, b) => {
                  const seedA = Number(a.seed) || 999999;
                  const seedB = Number(b.seed) || 999999;
                  if (seedA !== seedB) return seedA - seedB;
                  return (b.rating || 0) - (a.rating || 0);
                });
              } else {
                sortedPlayers = [...sectionPlayers].sort((a, b) => {
                  let ratingA = 0;
                  let ratingB = 0;
                  switch (seedingSource) {
                    case 'uscf':
                      ratingA = a.uscfRating || a.rating || 0;
                      ratingB = b.uscfRating || b.rating || 0;
                      break;
                    case 'fide':
                      ratingA = a.fideRating || a.rating || 0;
                      ratingB = b.fideRating || b.rating || 0;
                      break;
                    default:
                      ratingA = a.rating || 0;
                      ratingB = b.rating || 0;
                  }
                  return ratingB - ratingA;
                });
              }
              
              console.log(`[ENGINE-V4] Input to generateKnockoutPairings: ${sortedPlayers.length} players, method: ${seedingMethod}`);
              const knockoutPairings = isDoubleElim 
                ? await generateDoubleEliminationPairings(sortedPlayers, seedingMethod as any)
                : await generateKnockoutPairings(sortedPlayers, seedingMethod as any);

              console.log(`[ENGINE-V4] Generated ${knockoutPairings.length} total objects for section ${sectionKey}`);
              
              if (knockoutPairings.length === 0) {
                console.warn(`[ENGINE-V4] WARNING: No pairings generated for ${sortedPlayers.length} players!`);
              }

              console.log(`[DRIVE-SYNC] STARTING INSERTION: ${knockoutPairings.length} pairings for section ${sectionKey}`);
              let sectionMatchesCreated = 0;
              for (const pairing of knockoutPairings) {
                  try {
                      if (pairing.round > globalMaxRound) globalMaxRound = pairing.round;

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
                          await storage.createMatch({
                              tournamentId,
                              round: pairing.round,
                              whitePlayerId: pairing.whitePlayerId!,
                              blackPlayerId: null,
                              board: pairing.board,
                              result: "1-0",
                              status: "completed",
                              bracketType: pairing.bracketType,
                              sectionId: sectionKey === 'default' ? null : sectionKey,
                          });
                      } else {
                          if (pairing.whitePlayerId && pairing.blackPlayerId) {
                              await storage.createPairing({
                                  tournamentId,
                                  round: pairing.round,
                                  playerId: pairing.whitePlayerId,
                                  opponentId: pairing.blackPlayerId,
                                  color: "white",
                                  points: 0,
                                  isBye: false,
                              });
                              await storage.createPairing({
                                  tournamentId,
                                  round: pairing.round,
                                  playerId: pairing.blackPlayerId,
                                  opponentId: pairing.whitePlayerId,
                                  color: "black",
                                  points: 0,
                                  isBye: false,
                              });
                          }
                          await storage.createMatch({
                              tournamentId,
                              round: pairing.round,
                              whitePlayerId: pairing.whitePlayerId,
                              blackPlayerId: pairing.blackPlayerId,
                              board: pairing.board,
                              result: null,
                              status: "pending",
                              bracketType: pairing.bracketType,
                              sectionId: sectionKey === 'default' ? null : sectionKey,
                          });
                      }
                      sectionMatchesCreated++;
                  } catch (err: any) {
                      console.error(`[DRIVE-SYNC] ERROR creating match for round ${pairing.round} board ${pairing.board}:`, err.message);
                      throw err; 
                  }
              }
              console.log(`[DRIVE-SYNC] INSERTED ${sectionMatchesCreated} matches for section ${sectionKey}`);
          }
          const finalRoundsCount = Math.max(globalMaxRound, 1);
          console.log(`[DRIVE-SYNC] FINALIZING TOURNAMENT: rounds=${finalRoundsCount}, status=active`);
          
          await storage.updateTournament(tournamentId, { 
              rounds: finalRoundsCount,
              currentRound: 1
          });

          // Trigger round 1 pairings notifications
          await notifyRoundPairings(tournamentId, 1);

          res.json({ 
              message: "Knockout bracket generated successfully",
              rounds: finalRoundsCount,
              status: 'active'
          });
      } catch (error) {
          console.error("Generate knockout error:", error);
          res.status(500).json({ message: "Failed to generate knockout bracket" });
      }
  });

  // Generate next round
  app.post("/api/tournaments/:id/next-round", requireAuth, requireRole('tournament_director'), requireTournamentAccess, async (req, res) => {
    try {
      const tournamentId = parseInt(req.params.id);
      const tournament = await storage.getTournament(tournamentId);

      if (!tournament) {
        return res.status(404).json({ message: "Tournament not found" });
      }

      if (tournament.status !== 'active') {
        return res.status(400).json({ message: "Tournament is not active" });
      }

      const nextRound = (tournament.currentRound || 0) + 1;

      if (tournament.rounds && nextRound > tournament.rounds) {
        return res.status(400).json({ message: "Tournament is complete" });
      }

      const players = await storage.getPlayersByTournament(tournamentId);
      const matches = await storage.getMatchesByTournament(tournamentId);

      const currentRoundMatches = matches.filter((m: any) => m.round === tournament.currentRound && !m.isExtraGame);
      const incompleteMatches = currentRoundMatches.filter(m => !m.result);

      if (incompleteMatches.length > 0) {
        return res.status(400).json({
          message: `Please complete all matches in round ${tournament.currentRound} before generating next round`
        });
      }

      const updatedTournament = await storage.updateTournament(tournamentId, {
        currentRound: nextRound
      });

      if (tournament.format === 'roundrobin' || tournament.format === 'knockout') {
        console.log(`${tournament.format} tournament - advanced to round ${nextRound}. Pairings already exist.`);
      } else {
        const pairings = await storage.getPairingsByTournament(tournament.id);
        const playerMap = new Map(players.map((p: any) => [p.id, p]));
        const playersBySection = players.reduce((acc: any, player: any) => {
          const sectionKey = player.sectionId || 'default';
          if (!acc[sectionKey]) {
            acc[sectionKey] = [];
          }
          acc[sectionKey].push(player);
          return acc;
        }, {} as Record<string, Player[]>);

        const matchesBySection = matches.filter((m: any) => !m.isExtraGame).reduce((acc: any, match: any) => {
          const player = playerMap.get(match.whitePlayerId!) ?? playerMap.get(match.blackPlayerId!);
          if (player) {
            const sectionKey = player.sectionId || 'default';
            if (!acc[sectionKey]) {
              acc[sectionKey] = [];
            }
            acc[sectionKey].push(match);
          }
          return acc;
        }, {} as Record<string, any[]>);

        const pairingsBySection = pairings.reduce((acc, pairing: any) => {
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

        let totalMatches = 0;
        for (const sectionKey in playersBySection) {
          const sectionPlayers = playersBySection[sectionKey];
          const sectionPairings = pairingsBySection[sectionKey] || [];
          const isWithdrawn = (playerId: number) => sectionPairings.some((p: any) => p.playerId === playerId && p.isBye && p.byeType === 'zero_point' && p.round < nextRound);
          const activePlayers = sectionPlayers.filter((p: any) => !isWithdrawn(p.id));
          if (activePlayers.length < 1) continue;

          totalMatches += Math.floor(activePlayers.length / 2);
          if (activePlayers.length % 2 === 1) {
            totalMatches++;
          }
        }

        const allBoardNumbers = generateBoardNumberSequence(tournament.boardNumberingSettings as BoardNumberingSettings, totalMatches);
        let boardNumberOffset = 0;

        for (const sectionKey in playersBySection) {
          const sectionPlayers = playersBySection[sectionKey];
          const sectionMatches = matchesBySection[sectionKey] || [];
          const sectionPairings = pairingsBySection[sectionKey] || [];
          const isWithdrawn = (playerId: number) => sectionPairings.some((p: any) => p.playerId === playerId && p.isBye && p.byeType === 'zero_point' && p.round < nextRound);
          const activePlayers = sectionPlayers.filter((p: any) => !isWithdrawn(p.id));
          if (activePlayers.length < 1) continue;

          const numSectionMatches = Math.floor(activePlayers.length / 2) + (activePlayers.length % 2);
          const boardNumbersForSection = allBoardNumbers.slice(boardNumberOffset, boardNumberOffset + numSectionMatches);
          boardNumberOffset += numSectionMatches;

          await generatePairings(tournament, activePlayers, sectionMatches, sectionPairings, nextRound, boardNumbersForSection);
        }
      }

      // Trigger notifications for the next round's pairings
      await notifyRoundPairings(tournamentId, nextRound);

      res.json(updatedTournament);
    } catch (error) {
      console.error('Next round error:', error);
      res.status(500).json({ message: "Failed to generate next round" });
    }
  });

  // Generate pairings
  app.post("/api/tournaments/:tournamentId/generate-pairings", requireAuth, requireRole('tournament_director'), requireTournamentAccess, async (req, res) => {
    try {
      const user = req.user;
      if (!user) {
        return res.status(401).json({ message: "User not found" });
      }
      const tournamentId = parseInt(req.params.tournamentId);
      const { regenerate = false, targetRound } = req.body;

      const tournament = await storage.getTournament(tournamentId);
      if (!tournament) {
        return res.status(404).json({ message: "Tournament not found" });
      }

      const players = await storage.getPlayersByTournament(tournamentId);
      if (players.length < 2) {
        return res.status(400).json({ message: "At least 2 players required to generate pairings" });
      }

      console.log(`Pairing generation: regenerate=${regenerate}, targetRound=${targetRound}`);

      if (tournament.format === 'roundrobin') {
        const allPairings = await storage.getPairingsByTournament(tournamentId);
        const allMatches = await storage.getMatchesByTournament(tournamentId);

        const playersBySection = players.reduce((acc: any, player: any) => {
          const sectionKey = player.sectionId || 'default';
          if (!acc[sectionKey]) {
            acc[sectionKey] = [];
          }
          acc[sectionKey].push(player);
          return acc;
        }, {} as Record<string, Player[]>);

        // Order section keys based on configured sections order
        const config = parseTournamentConfig(tournament);
        const configuredSections = config.sections ?? [];
        const actualSectionKeys = Object.keys(playersBySection);
        const orderedSectionKeys: string[] = [];
        for (const section of configuredSections) {
          if (actualSectionKeys.includes(section.id)) {
            orderedSectionKeys.push(section.id);
          }
        }
        for (const key of actualSectionKeys) {
          if (!orderedSectionKeys.includes(key)) {
            orderedSectionKeys.push(key);
          }
        }

        const combinedResults = {
          pairings: [] as Pairing[],
          matches: [] as Match[],
          message: "",
        };

        for (const sectionKey of orderedSectionKeys) {
          const sectionPlayers = playersBySection[sectionKey];
          if (sectionPlayers.length < 2) continue;

          console.log(`Processing Round Robin for section ${sectionKey} with ${sectionPlayers.length} players`);

          const { generateRoundRobinSchedule, validateRoundRobinSchedule } = await import('../../round-robin');
          const roundRobinPairings = generateRoundRobinSchedule(sectionPlayers);
          const numRounds = sectionPlayers.length % 2 === 0 ? sectionPlayers.length - 1 : sectionPlayers.length;

          console.log(`Generating schedule for section ${sectionKey}: ${sectionPlayers.length} players, ${numRounds} rounds, ${roundRobinPairings.length} total pairings`);

          const playerIds = sectionPlayers.map((p: any) => p.id);
          if (!validateRoundRobinSchedule(roundRobinPairings, playerIds)) {
            throw new Error(`Invalid Round Robin schedule generated for section ${sectionKey}`);
          }

          const userIds = Array.from(new Set(sectionPlayers.map((p: any) => p.userId).filter(Boolean))) as number[];
          const usersList = await storage.listUsersByIds(userIds);
          const userMap = new Map(usersList.map((u: any) => [u.id, u]));

          const sendRealNotification = async (userId: number, title: string, message: string, preferenceKey: 'notifyPairings' | 'notifyTournamentStatus') => {
            const userObj = userMap.get(userId) as any;
            if (!userObj || !(userObj[preferenceKey] ?? true)) return;

            // Email notification (run in background, not awaited)
            if ((userObj.notifyEmail ?? true) && userObj.email) {
              notificationService.sendEmail({ to: userObj.email, subject: title, text: message }).catch((err: any) => console.error(`Failed to send email to ${userObj.email}:`, err));
            }
            // Web Push notification (run in background, not awaited)
            if ((userObj as any).id) {
              notificationService.sendWebPushNotificationToUser(userObj.id, title, message).catch((err: any) => console.error(`Failed to send push to ${userObj.username}:`, err));
            }
          };

          for (const player of sectionPlayers) {
            if (player.userId) {
              const title = "Tournament Started";
              const message = `The tournament "${tournament.name}" has officially started! Round Robin pairings are now available.`;
              await storage.createNotification({
                userId: player.userId,
                title,
                message,
                type: "tournament_status",
                meta: { tournamentId }
              });
              await sendRealNotification(player.userId, title, message, 'notifyTournamentStatus');
            }
          }

          for (const pairing of roundRobinPairings) {
            if (pairing.isBye) {
              const savedPairing = await storage.createPairing({
                tournamentId, round: pairing.round, playerId: pairing.whitePlayerId!,
                opponentId: null, color: null, points: 2, isBye: true
              });
              combinedResults.pairings.push(savedPairing);

              const player = sectionPlayers.find((p: any) => p.id === pairing.whitePlayerId);
              if (player?.userId) {
                const title = "Round Bye";
                const message = `Round ${pairing.round}: You have a bye for this round.`;
                await storage.createNotification({
                  userId: player.userId,
                  title,
                  message,
                  type: "pairing",
                   meta: { tournamentId }
                });
                await sendRealNotification(player.userId, title, message, 'notifyPairings');
              }
            } else {
              const whitePairing = await storage.createPairing({
                tournamentId, round: pairing.round, playerId: pairing.whitePlayerId!,
                opponentId: pairing.blackPlayerId!, color: 'white', points: 0, isBye: false
              });
              const blackPairing = await storage.createPairing({
                tournamentId, round: pairing.round, playerId: pairing.blackPlayerId!,
                opponentId: pairing.whitePlayerId!, color: 'black', points: 0, isBye: false
              });
              combinedResults.pairings.push(whitePairing, blackPairing);

              const match = await storage.createMatch({
                tournamentId, round: pairing.round, whitePlayerId: pairing.whitePlayerId!,
                blackPlayerId: pairing.blackPlayerId!, board: pairing.board, result: null, status: 'pending'
              });
              combinedResults.matches.push(match);

              const whitePlayer = sectionPlayers.find((p: any) => p.id === pairing.whitePlayerId);
              const blackPlayer = sectionPlayers.find((p: any) => p.id === pairing.blackPlayerId);
              const title = "New Pairing Assigned";

              if (whitePlayer?.userId) {
                const message = `Round ${pairing.round}: You are playing White against ${blackPlayer?.firstName || 'Unknown'} on Board ${pairing.board}.`;
                await storage.createNotification({
                  userId: whitePlayer.userId,
                  title,
                  message,
                  type: "pairing",
                  meta: { matchId: match.id, tournamentId }
                });
                await sendRealNotification(whitePlayer.userId, title, message, 'notifyPairings');
              }
              if (blackPlayer?.userId) {
                const message = `Round ${pairing.round}: You are playing Black against ${whitePlayer?.firstName || 'Unknown'} on Board ${pairing.board}.`;
                await storage.createNotification({
                  userId: blackPlayer.userId,
                  title,
                  message,
                  type: "pairing",
                  meta: { matchId: match.id, tournamentId }
                });
                await sendRealNotification(blackPlayer.userId, title, message, 'notifyPairings');
              }
            }
          }
        }

        if (regenerate) {
          console.log('Regenerating Round Robin tournament - clearing existing data');
          for (const pairing of allPairings) {
            await storage.deletePairing(pairing.id);
          }
          for (const match of allMatches) {
            await storage.deleteMatch(match.id);
          }
          await storage.createHistoryEntry({
            tournamentId, action: 'regenerate_all_rounds', description: `Round Robin tournament regenerated`,
            changedBy: user.id, previousState: JSON.stringify({ pairingsCount: allPairings.length, matchesCount: allMatches.length }),
            newState: JSON.stringify({ regenerated: true }), round: null, canRevert: false
          });
        }

        await storage.updateTournament(tournamentId, { status: "active" });
        combinedResults.message = `Round Robin tournament started/regenerated! Generated pairings for ${Object.keys(playersBySection).length} sections.`;
        return res.json(combinedResults);
      }

      const allPlayers = await storage.getPlayersByTournament(tournamentId);
      const allMatches = await storage.getMatchesByTournament(tournamentId);
      const allPairings = await storage.getPairingsByTournament(tournamentId);

      const playerMap = new Map(allPlayers.map((p: any) => [p.id, p]));

      let currentRound: number;
      if (regenerate && targetRound) {
        currentRound = targetRound;
      } else {
        currentRound = (tournament.currentRound || 0) + 1;
      }

      let filteredMatches = [...allMatches];
      let filteredPairings = [...allPairings];

      if (regenerate && currentRound) {
        console.log(`Regenerating Swiss pairings for round ${currentRound} - clearing existing round pairings/matches and subsequent rounds`);
        const pairingsToDelete = allPairings.filter((p: any) => p.round >= currentRound && !p.isRequested);
        for (const pairing of pairingsToDelete) {
          await storage.deletePairing(pairing.id);
        }
        filteredPairings = allPairings.filter((p: any) => p.round < currentRound || p.isRequested);

        const matchesToDelete = allMatches.filter((m: any) => m.round >= currentRound);
        for (const match of matchesToDelete) {
          await storage.deleteMatch(match.id);
        }
        filteredMatches = allMatches.filter((m: any) => m.round < currentRound);

        await storage.updateTournament(tournamentId, {
          currentRound: currentRound
        });

        await storage.createHistoryEntry({
          tournamentId,
          action: 'repair_round',
          description: `Round ${currentRound} pairings repaired/regenerated, subsequent rounds wiped`,
          changedBy: user.id,
          previousState: JSON.stringify({ pairings: pairingsToDelete, matches: matchesToDelete }),
          newState: JSON.stringify({ regeneratedRound: currentRound, currentRoundSetTo: currentRound }),
          round: currentRound,
          canRevert: true
        });
      }

      const playersBySection = allPlayers.reduce((acc: any, player: any) => {
        const sectionKey = player.sectionId || 'default';
        if (!acc[sectionKey]) acc[sectionKey] = [];
        acc[sectionKey].push(player);
        return acc;
      }, {} as Record<string, any[]>);

      // Order section keys based on configured sections order
      const tournamentConfig = parseTournamentConfig(tournament);
      const configuredSections = tournamentConfig.sections ?? [];
      const actualSectionKeys = Object.keys(playersBySection);
      const orderedSectionKeys: string[] = [];
      for (const section of configuredSections) {
        if (actualSectionKeys.includes(section.id)) {
          orderedSectionKeys.push(section.id);
        }
      }
      for (const key of actualSectionKeys) {
        if (!orderedSectionKeys.includes(key)) {
          orderedSectionKeys.push(key);
        }
      }

      const matchesBySection = filteredMatches.filter((m: any) => !m.isExtraGame).reduce((acc: any, match: any) => {
        const player = playerMap.get(match.whitePlayerId!) ?? playerMap.get(match.blackPlayerId!);
        if (player) {
          const sectionKey = player.sectionId || 'default';
          if (!acc[sectionKey]) acc[sectionKey] = [];
          acc[sectionKey].push(match);
        }
        return acc;
      }, {} as Record<string, any[]>);

      const pairingsBySection = filteredPairings.reduce((acc: any, pairing: any) => {
        const player: any = playerMap.get(pairing.playerId);
        if (player) {
          const sectionKey = player.sectionId || 'default';
          if (!acc[sectionKey]) acc[sectionKey] = [];
          acc[sectionKey].push(pairing);
        }
        return acc;
      }, {} as Record<string, any[]>);

      const finalResults = {
        pairings: [] as any[],
        matches: [] as any[],
        message: "Pairings generated successfully for all sections.",
      };

      let totalMatches = 0;
      for (const sectionKey of orderedSectionKeys) {
        const sectionPlayers = playersBySection[sectionKey];
        const sectionPairings = pairingsBySection[sectionKey] || [];
        const isWithdrawn = (playerId: number) => sectionPairings.some((p: any) => p.playerId === playerId && p.isBye && p.byeType === 'zero_point' && p.round < currentRound);
        const activePlayers = sectionPlayers.filter((p: any) => !isWithdrawn(p.id));
        if (activePlayers.length < 2) continue;
        totalMatches += Math.floor(activePlayers.length / 2);
        if (activePlayers.length % 2 === 1) {
          totalMatches++;
        }
      }

      const allBoardNumbers = generateBoardNumberSequence(tournament.boardNumberingSettings as BoardNumberingSettings, totalMatches);
      let boardNumberOffset = 0;

      for (const sectionKey of orderedSectionKeys) {
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

              await storage.createMatch({
                tournamentId,
                round: pairing.round,
                whitePlayerId: pairing.whitePlayerId!,
                blackPlayerId: null,
                board: pairing.board,
                result: "1-0",
                status: "completed",
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
        } else if (tournament.format === "knockout" && sectionPlayers.length >= 2) {
          console.log(`Generating Knockout bracket for ${sectionPlayers.length} players in section ${sectionKey}`);
          
          let sortedPlayers;
          if (tournament.seedingMethod === 'random') {
            sortedPlayers = [...sectionPlayers].sort(() => Math.random() - 0.5);
          } else {
            sortedPlayers = [...sectionPlayers].sort((a, b) => {
              const getRating = (p: any) => tournament.tiebreakOrder === 'uscf' ? (p.uscfRating || p.rating) : p.rating;
              return getRating(b) - getRating(a);
            });
          }

          const knockoutPairings = await generateKnockoutPairings(sortedPlayers);

          for (const pairing of knockoutPairings) {
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

              await storage.createMatch({
                tournamentId,
                round: pairing.round,
                whitePlayerId: pairing.whitePlayerId!,
                blackPlayerId: null,
                board: pairing.board,
                result: "1-0",
                status: "completed",
              });
            } else {
              if (pairing.whitePlayerId && pairing.blackPlayerId) {
                await storage.createPairing({
                  tournamentId,
                  round: pairing.round,
                  playerId: pairing.whitePlayerId,
                  opponentId: pairing.blackPlayerId,
                  color: "white",
                  points: 0,
                  isBye: false,
                });
                await storage.createPairing({
                  tournamentId,
                  round: pairing.round,
                  playerId: pairing.blackPlayerId,
                  opponentId: pairing.whitePlayerId,
                  color: "black",
                  points: 0,
                  isBye: false,
                });

                await storage.createMatch({
                  tournamentId,
                  round: pairing.round,
                  whitePlayerId: pairing.whitePlayerId,
                  blackPlayerId: pairing.blackPlayerId,
                  board: pairing.board,
                  result: null,
                  status: "pending",
                });
              }
            }
          }
        } else if (sectionPlayers.length >= 1) {
          const numSectionMatches = Math.floor(sectionPlayers.length / 2) + (sectionPlayers.length % 2);
          const boardNumbersForSection = allBoardNumbers.slice(boardNumberOffset, boardNumberOffset + numSectionMatches);
          boardNumberOffset += numSectionMatches;

          const sectionMatches = matchesBySection[sectionKey] || [];
          const sectionPairings = pairingsBySection[sectionKey] || [];

          await generatePairings(
            tournament,
            sectionPlayers,
            sectionMatches,
            sectionPairings,
            currentRound,
            boardNumbersForSection
          );
        }
      }

      if (!regenerate) {
        await storage.updateTournament(tournamentId, {
          status: "active",
          currentRound: currentRound
        });
      }

      if (tournament.format !== 'roundrobin') {
        const generatedPairings = await storage.getPairingsByRound(tournamentId, currentRound);
        const generatedMatches = await storage.getMatchesByRound(tournamentId, currentRound);
        
        await storage.createHistoryEntry({
          tournamentId,
          action: 'pairing_generation',
          description: `Generated pairings for Round ${currentRound}`,
          changedBy: user.id,
          previousState: null,
          newState: JSON.stringify({ pairings: generatedPairings, matches: generatedMatches }),
          round: currentRound,
          canRevert: true
        });
      }

      // Trigger notifications for the generated round's pairings
      await notifyRoundPairings(tournamentId, currentRound);

      finalResults.message = `Pairings generated for round ${currentRound}.`;
      res.json(finalResults);

    } catch (error) {
      console.error('Pairing generation error:', error);
      res.status(500).json({ error: "Failed to generate pairings" });
    }
  });

  // Predict pairings
  app.post(
    "/api/tournaments/:id/predict-pairings",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const tournamentId = parseInt(req.params.id);
        const tournament = await storage.getTournament(tournamentId);
        if (!tournament) {
          return res.status(404).json({ message: "Tournament not found" });
        }

        if (tournament.format !== 'swiss') {
          return res.status(400).json({ message: "Pairing predictor is only available for Swiss events" });
        }

        const currentRound = tournament.currentRound || 0;
        if (currentRound === 0) {
          return res.status(400).json({ message: "Tournament has not started yet" });
        }

        const totalRounds = tournament.rounds || 0;
        if (currentRound >= totalRounds) {
          return res.status(400).json({ message: "All rounds are already completed" });
        }

        const [players, matches, pairings] = await Promise.all([
          storage.getPlayersByTournament(tournamentId),
          storage.getMatchesByTournament(tournamentId),
          storage.getPairingsByTournament(tournamentId),
        ]);

        const simulatedResultsList = req.body.simulatedResults || [];
        const simMap = new Map<number, string>();
        for (const item of simulatedResultsList) {
          let dbRes = item.result;
          if (item.result === 'white-win') dbRes = '1-0';
          else if (item.result === 'black-win') dbRes = '0-1';
          else if (item.result === 'draw') dbRes = '1/2-1/2';
          simMap.set(Number(item.matchId), dbRes);
        }

        const simulatedMatches = matches.map(match => {
          if (match.round === currentRound) {
            if (match.result) return match;

            const simRes = simMap.get(match.id);
            if (simRes && simRes !== 'unplayed') {
              return {
                ...match,
                result: simRes,
                status: 'completed'
              };
            }

            return {
              ...match,
              result: '1/2-1/2',
              status: 'completed'
            };
          }
          return match;
        });

        const nextRound = currentRound + 1;
        const playerMap = new Map(players.map((p: any) => [p.id, p]));
        const playersBySection = players.reduce((acc: any, player: any) => {
          const sectionKey = player.sectionId || 'default';
          if (!acc[sectionKey]) {
            acc[sectionKey] = [];
          }
          acc[sectionKey].push(player);
          return acc;
        }, {} as Record<string, Player[]>);

        const matchesBySection = simulatedMatches.reduce((acc: any, match: any) => {
          const player = playerMap.get(match.whitePlayerId!) ?? playerMap.get(match.blackPlayerId!);
          if (player) {
            const sectionKey = player.sectionId || 'default';
            if (!acc[sectionKey]) {
              acc[sectionKey] = [];
            }
            acc[sectionKey].push(match);
          }
          return acc;
        }, {} as Record<string, any[]>);

        const pairingsBySection = pairings.reduce((acc, pairing: any) => {
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

        let allPredictedPairings: any[] = [];

        let totalMatchesSim = 0;
        for (const sectionKey in playersBySection) {
          const sectionPlayers = playersBySection[sectionKey];
          const sectionPairings = pairingsBySection[sectionKey] || [];
          const isWithdrawn = (playerId: number) => sectionPairings.some((p: any) => p.playerId === playerId && p.isBye && p.byeType === 'zero_point' && p.round < nextRound);
          const activePlayers = sectionPlayers.filter((p: any) => !isWithdrawn(p.id));
          if (activePlayers.length < 1) continue;
          totalMatchesSim += Math.floor(activePlayers.length / 2) + (activePlayers.length % 2 === 1 ? 1 : 0);
        }

        const allBoardNumbers = generateBoardNumberSequence(tournament.boardNumberingSettings as BoardNumberingSettings, totalMatchesSim);
        let boardNumberOffset = 0;

        for (const sectionKey in playersBySection) {
          const sectionPlayers = playersBySection[sectionKey];
          const sectionMatches = matchesBySection[sectionKey] || [];
          const sectionPairings = pairingsBySection[sectionKey] || [];
          const isWithdrawn = (playerId: number) => sectionPairings.some((p: any) => p.playerId === playerId && p.isBye && p.byeType === 'zero_point' && p.round < nextRound);
          const activePlayers = sectionPlayers.filter((p: any) => !isWithdrawn(p.id));
          if (activePlayers.length < 1) continue;

          const numSectionMatches = Math.floor(activePlayers.length / 2) + (activePlayers.length % 2 === 1 ? 1 : 0);
          const boardNumbersForSection = allBoardNumbers.slice(boardNumberOffset, boardNumberOffset + numSectionMatches);
          boardNumberOffset += numSectionMatches;

          const predictedSectionPairings = await generateSwissPairings(
            tournament,
            activePlayers,
            sectionMatches,
            nextRound,
            sectionPairings,
            boardNumbersForSection
          );

          const pairingsWithSection = predictedSectionPairings.map(p => ({
            ...p,
            sectionId: sectionKey === 'default' ? null : sectionKey
          }));

          allPredictedPairings.push(...pairingsWithSection);
        }

        res.json({ pairings: allPredictedPairings });
      } catch (error) {
        console.error("Predict pairings error:", error);
        res.status(500).json({ message: "Failed to predict next round pairings" });
      }
    }
  );

  // Delete individual pairing (for removing specific bye requests)
  app.delete("/api/pairings/:id", requireAuth, requireRole('tournament_director'), async (req, res) => {
    try {
      const pairingId = parseInt(req.params.id);

      const user = req.user;
      if (!user) {
        return res.status(401).json({ message: "User not found" });
      }
      const tournaments = await storage.getTournamentsByUser(user.id);
      let targetPairing = null;

      for (const tournament of tournaments) {
        const tournamentPairings = await storage.getPairingsByTournament(tournament.id);
        targetPairing = tournamentPairings.find((p: any) => p.id === pairingId);
        if (targetPairing) break;
      }

      if (!targetPairing) {
        return res.status(404).json({ message: "Pairing not found or access denied" });
      }

      const deleted = await storage.deletePairing(pairingId);
      if (!deleted) {
        return res.status(404).json({ message: "Failed to delete pairing" });
      }

      res.json({ message: "Bye request removed successfully" });
    } catch (error) {
      console.error('Pairing deletion error:', error);
      res.status(500).json({ message: "Failed to remove bye request" });
    }
  });
}
