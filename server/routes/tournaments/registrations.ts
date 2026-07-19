import type { Express } from "express";
import { z } from "zod";
import { and, eq } from 'drizzle-orm';
import Stripe from "stripe";
import { db } from '../../db';
import { blocks, PlayerRegistration } from '@shared/schema';
import { storage } from '../../storage';
import { requireAuth, requireTournamentAccess } from '../../auth';
import { notificationService } from '../../notifications';
import { parseTournamentConfig } from "@shared/tournament-config";
import {
  stripe,
  PAYMENT_STATUSES,
  PaymentStatus,
  computePaymentTotals,
  normalizeCurrency,
  playerRegistrationSchema
} from "../common";
import { normalizePlayerName } from "../util";
import { getLocalUSCFPlayerById } from "../../lib/localRatings";

export function applyRegistrationsRoutes(app: Express) {
  // Create player registration batch (for multi-player cart checkout)
  app.post("/api/tournaments/:id/register-batch", requireAuth, async (req, res) => {
    try {
      const tournamentId = Number.parseInt(req.params.id, 10);
      if (!Number.isFinite(tournamentId)) {
        return res.status(400).json({ error: "Invalid tournament id" });
      }
      const user = req.user;
      if (!user) {
        return res.status(401).json({ error: "User not found" });
      }
      // Check if tournament exists
      const tournament = await storage.getTournament(tournamentId);
      if (!tournament) {
        return res.status(404).json({ error: "Tournament not found" });
      }

      const config = parseTournamentConfig(tournament);

      // Check if user is blocked by the tournament director
      const blockExists = await db.select()
        .from(blocks)
        .where(and(eq(blocks.blockerId, tournament.createdBy), eq(blocks.blockedId, user.id)))
        .limit(1);

      if (blockExists.length > 0) {
        console.warn(`[BATCH_REG] Registration blocked: User ${user.id} is blocked by director ${tournament.createdBy}`);
        return res.status(403).json({ error: "Your account has been blocked by the tournament director." });
      }

      if (!config.registers.allowPlayerToJoin) {
        return res.status(403).json({ error: "Player registration is not allowed for this tournament" });
      }

      const multiPlayerAllowed = Boolean(config.registers.allowMultiPlayerSignup);
      if (!multiPlayerAllowed) {
        return res.status(400).json({ error: "Multi-player registration is not allowed" });
      }

      const payments = config.payments;
      const offlineAllowed = (payments.acceptedOfflineMethods ?? []).length > 0;
      const mustCompletePayment = payments.onlineEnabled && (payments.requirePaymentOnRegistration || !offlineAllowed);

      // Parse payload as array
      if (!Array.isArray(req.body) || req.body.length === 0) {
        return res.status(400).json({ error: "Empty registration payload" });
      }
      const payloadArray = z.array(playerRegistrationSchema).parse(req.body);

      // Validate requested byes against tournament configurations
      for (const payload of payloadArray) {
        if (payload.byePreference === "yes" && payload.byeRounds && payload.byeRounds.length > 0) {
          const limit = config.registers.byeLimit ?? 2;
          if (payload.byeRounds.length > limit) {
            return res.status(400).json({ error: `Player ${payload.playerName} cannot request more than ${limit} bye(s).` });
          }
          if (config.registers.allowLastRoundBye === false) {
            const totalRounds = config.details.rounds ?? 0;
            const lastRoundLabel = `Round ${totalRounds}`;
            if (payload.byeRounds.includes(lastRoundLabel)) {
              return res.status(400).json({ error: `Player ${payload.playerName} cannot request a half-point bye for the final round.` });
            }
          }
        }
      }

      // Check payment intent for the whole batch based on the first item since the cart shares it
      const sampleItem = payloadArray[0];
      const results: any[] = [];
      let amountDue = Number.isFinite(sampleItem.amountDue) ? Number(sampleItem.amountDue) : 0;
      let amountPaid = Number.isFinite(sampleItem.amountPaid) ? Number(sampleItem.amountPaid) : 0;
      let currency = normalizeCurrency(sampleItem.currency, payments.defaultCurrency ?? "USD");
      let paymentMethod = sampleItem.paymentMethod ?? null;
      let paymentStatus: PaymentStatus = sampleItem.paymentStatus ?? "unpaid";
      if (paymentMethod && ["offline", "cash", "check", "manual", "none"].includes(String(paymentMethod).toLowerCase())) {
        paymentStatus = "N/A" as any;
      }
      let paymentReceiptUrl = sampleItem.paymentReceiptUrl ?? null;
      let paidAt: Date | null = null;
      let notes = sampleItem.paymentNotes ?? null;

      const isFree = amountDue <= 0;
      const actualMustCompletePayment = mustCompletePayment && !isFree;

      if (isFree) {
        paymentStatus = "paid";
        paymentMethod = "none";
      }

      if (payments.onlineEnabled && sampleItem.paymentIntentId && !isFree) {
        if (!stripe) {
          return res.status(503).json({ error: "Online payments are not available" });
        }

        const paymentIntentRaw = await stripe.paymentIntents.retrieve(sampleItem.paymentIntentId, {
          expand: ["latest_charge"],
        });
        const paymentIntent = paymentIntentRaw as Stripe.PaymentIntent & {
          latest_charge?: string | Stripe.Charge;
          charges?: Stripe.ApiList<Stripe.Charge>;
        };

        amountDue = Number(((paymentIntent.amount ?? amountDue * 100) / 100).toFixed(2));
        amountPaid = Number(((paymentIntent.amount_received ?? 0) / 100).toFixed(2));
        currency = paymentIntent.currency ? paymentIntent.currency.toUpperCase() : currency;

        const latestCharge = ((): Stripe.Charge | null => {
          if (paymentIntent.latest_charge && typeof paymentIntent.latest_charge !== "string") {
            return paymentIntent.latest_charge;
          }
          const charges = paymentIntent.charges?.data ?? [];
          return charges[0] ?? null;
        })();

        if (latestCharge?.receipt_url && !paymentReceiptUrl) {
          paymentReceiptUrl = latestCharge.receipt_url;
        }
        if (latestCharge?.payment_method_details?.type && !paymentMethod) {
          paymentMethod = latestCharge.payment_method_details.type;
        }

        switch (paymentIntent.status) {
          case "succeeded":
            paymentStatus = "paid";
            paidAt = latestCharge?.created ? new Date(latestCharge.created * 1000) : new Date();
            break;
          case "processing":
          case "requires_capture":
            paymentStatus = "processing";
            break;
          case "requires_payment_method":
          case "requires_confirmation":
          case "requires_action":
            paymentStatus = "unpaid";
            break;
          default:
            paymentStatus = paymentStatus ?? "unpaid";
        }

        const validStatuses = ["succeeded", "processing", "requires_payment_method", "requires_confirmation", "requires_action", "requires_capture"];
        if (actualMustCompletePayment && !validStatuses.includes(paymentIntent.status)) {
          console.warn(`[BATCH_REG] Payment verification failed: Required but status is ${paymentIntent.status}`);
          return res.status(400).json({ error: "Payment must be completed before submitting registration" });
        }
        console.log(`[BATCH_REG] Payment intent ${sampleItem.paymentIntentId} verified: ${paymentIntent.status}`);
      }

      // Process insertions and logging sequentially
      console.log(`[BATCH_REG] Processing batch registration for tournament ${tournamentId} by user ${user.id}`);
      console.log(`[BATCH_REG] Payload count: ${payloadArray.length}`);

      console.log(`[BATCH_REG] Deleting prior registrations for user ${user.id} in tournament ${tournamentId}`);
      const userRegistrationsBatch = await storage.getPlayerRegistrationsByTournament(tournamentId);
      const existingForUserBatch = userRegistrationsBatch.filter((r: any) => r.userId === user.id);
      
      for (const reg of existingForUserBatch) {
        if (reg.status === "approved" && reg.playerName) {
          const nameParts = reg.playerName.trim().split(/\s+/);
          const firstName = nameParts[0] || "";
          const lastName = nameParts.length > 1 ? nameParts.slice(1).join(" ") : "";
          const players = await storage.getPlayersByTournament(tournamentId);
          const playerToRemove = players.find((p: any) => p.firstName === firstName && p.lastName === lastName);
          if (playerToRemove) {
            console.log(`[BATCH_REG] Removing associated player record: ${firstName} ${lastName} (ID: ${playerToRemove.id})`);
            await storage.deletePlayer(playerToRemove.id);
          }
        }
        await storage.deletePlayerRegistration(reg.id);
      }

      const targetStatus = config.registers.autoAcceptRegistrations ? "approved" : "pending";

      for (const payload of payloadArray) {
        console.log(`[BATCH_REG] Processing player entry: ${payload.playerName}`);
        let localNotes = payload.paymentNotes ?? null;
        if (notes && !localNotes) {
          localNotes = notes;
        }

        let finalUscfRatingRaw = payload.uscfRatingRaw;
        if (payload.uscfId) {
          const localPlayer = await getLocalUSCFPlayerById(payload.uscfId);
          if (localPlayer && localPlayer.rating?.raw) {
            finalUscfRatingRaw = localPlayer.rating.raw;
          }
        }

        const newRegistration = await storage.createPlayerRegistration({
          tournamentId,
          userId: user.id,
          playerName: payload.playerName,
          uscfRating: payload.uscfRating,
          fideRating: payload.fideRating,
          uscfRatingRaw: finalUscfRatingRaw,
          fideRatingRaw: payload.fideRatingRaw,
          ratingProvider: payload.ratingProvider,
          uscfId: payload.uscfId,
          fideId: payload.fideId,

          email: payload.email,
          address1: payload.address1,
          address2: payload.address2,
          city: payload.city,
          state: payload.state,
          postalCode: payload.postalCode,
          country: payload.country,
          pairingNotifications: payload.pairingNotifications,
          newsletter: payload.newsletter,
          sectionChoice: payload.sectionChoice,
          entryFeeId: payload.entryFeeId,
          processingContribution: payload.processingContribution?.toString() || "0",
          byePreference: payload.byePreference,
          byeRounds: payload.byePreference === "yes" ? (payload.byeRounds ?? []) : [],
          arrivalTime: payload.arrivalTime,
          notes: payload.notes,
          paymentIntentId: sampleItem.paymentIntentId ?? null,
          paymentStatus: paymentStatus,
          paymentMethod: paymentMethod,
          paymentReceiptUrl: paymentReceiptUrl,
          paymentNotes: localNotes,
          amountDue: amountDue.toFixed(2),
          amountPaid: amountPaid.toFixed(2),
          currency: currency,
          paidAt: paidAt,
          customAnswers: payload.customAnswers ?? {},
          status: targetStatus,
        });

        if (config.registers.autoAcceptRegistrations) {
          await handleApproveOrDecline(tournamentId, newRegistration.id, "approved");
          const updated = await storage.getPlayerRegistration(newRegistration.id);
          results.push(updated);
        } else {
          results.push(newRegistration);
        }
      }
      
      try {
        const relatedTournament = await storage.getTournament(tournamentId);
        if (user && relatedTournament && (user.notifyRegistration ?? true)) {
          const subject = `Registration Confirmation: ${relatedTournament.name}`;
          const message = `Thank you for registering for ${relatedTournament.name}. We have received your ${results.length > 1 ? 'batch registration for ' + results.length + ' players' : 'registration'}. Your entry is currently pending review.`;
          
          await storage.createNotification({
            userId: user.id,
            title: subject,
            message,
            type: 'registration_status',
            read: false,
            meta: { tournamentId },
          });

          if ((user.notifyEmail ?? true) && user.email) {
            await notificationService.sendEmail({ to: user.email, subject, text: message });
          }
          if ((user as any).id) {
            await notificationService.sendWebPushNotificationToUser((user as any).id, subject, message);
          }
        }
      } catch (confirmErr) {
        console.error("Error sending registration confirmation:", confirmErr);
      }

      res.status(201).json(results);
    } catch (error) {
      console.error("Player batch registration error:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Invalid registration data", issues: error.flatten() });
      }
      res.status(500).json({ error: "Failed to submit batch registration" });
    }
  });

  // Create player registration (for players to register for tournaments)
  app.post("/api/tournaments/:id/register", requireAuth, async (req, res) => {
    try {
      const tournamentId = Number.parseInt(req.params.id, 10);
      if (!Number.isFinite(tournamentId)) {
        return res.status(400).json({ error: "Invalid tournament id" });
      }
      const user = req.user;
      if (!user) {
        return res.status(401).json({ error: "User not found" });
      }
      const tournament = await storage.getTournament(tournamentId);
      if (!tournament) {
        return res.status(404).json({ error: "Tournament not found" });
      }

      const config = parseTournamentConfig(tournament);
      console.log(`[REG_FLOW] Processing single registration for tournament ${tournamentId} (User: ${user.id})`);

      const blockExists = await db.select()
        .from(blocks)
        .where(and(eq(blocks.blockerId, tournament.createdBy), eq(blocks.blockedId, user.id)))
        .limit(1);

      if (blockExists.length > 0) {
        console.warn(`[REG_FLOW] Registration blocked: User ${user.id} is blocked by director ${tournament.createdBy}`);
        return res.status(403).json({ error: "Your account has been blocked by the tournament director." });
      }

      if (!config.registers.allowPlayerToJoin) {
        console.warn(`[REG_FLOW] Registration blocked: Joined disabled in config for tournament ${tournamentId}`);
        return res.status(403).json({ error: "Player registration is not allowed for this tournament" });
      }

      const registrations = await storage.getPlayerRegistrationsByTournament(tournamentId);
      const userRegistrations = registrations.filter((r) => r.userId === user.id);
      const multiPlayerAllowed = Boolean(config.registers.allowMultiPlayerSignup);
      const allowEdit = Boolean(config.registers.allowEditRegistration);

      let existingToUpdate: PlayerRegistration | undefined;

      if (userRegistrations.length > 0 && !multiPlayerAllowed) {
        if (!allowEdit) {
          return res.status(400).json({ error: "You are already registered for this tournament" });
        }
        existingToUpdate = userRegistrations[0];
      }

      const payments = config.payments;
      const payload = playerRegistrationSchema.parse(req.body ?? {});

      // Validate requested byes against tournament configurations
      if (payload.byePreference === "yes" && payload.byeRounds && payload.byeRounds.length > 0) {
        const limit = config.registers.byeLimit ?? 2;
        if (payload.byeRounds.length > limit) {
          return res.status(400).json({ error: `You cannot request more than ${limit} bye(s).` });
        }
        if (config.registers.allowLastRoundBye === false) {
          const totalRounds = config.details.rounds ?? 0;
          const lastRoundLabel = `Round ${totalRounds}`;
          if (payload.byeRounds.includes(lastRoundLabel)) {
            return res.status(400).json({ error: "Half-point byes for the final round are not allowed." });
          }
        }
      }

      const offlineAllowed = (payments.acceptedOfflineMethods ?? []).length > 0;
      const mustCompletePayment = payments.onlineEnabled && (payments.requirePaymentOnRegistration || !offlineAllowed);

      const entryFee = payload.entryFeeId
        ? config.entryFees.find((fee) => fee.id === payload.entryFeeId) ?? null
        : null;
      const contribution = Number.isFinite(payload.processingContribution) ? Number(payload.processingContribution) : 0;
      const totals = computePaymentTotals(
        entryFee,
        contribution,
        payments,
        payload.customAnswers || {},
        config.registrationFormConfig?.fields || [],
        config.sections || [],
        payload.sectionChoice || undefined,
        payload.ratingProvider || undefined,
        payload.uscfId ? (payload.uscfRatingRaw || String(payload.uscfRating) || undefined) as string | undefined : undefined,
        payload.fideId ? (payload.fideRatingRaw || String(payload.fideRating) || undefined) as string | undefined : undefined,
        config.details.primaryRatingSystem as any
      );

      let amountDue = Number.isFinite(payload.amountDue) ? Number(payload.amountDue) : totals.total;
      if (!Number.isFinite(amountDue)) {
        amountDue = totals.total || entryFee?.amount || 0;
      }
      amountDue = Number(amountDue.toFixed(2));

      let amountPaid = Number.isFinite(payload.amountPaid) ? Number(payload.amountPaid) : 0;
      amountPaid = Number(amountPaid.toFixed(2));

      let paymentMethod = payload.paymentMethod ?? null;
      let paymentStatus: PaymentStatus = payload.paymentStatus ?? "unpaid";
      if (paymentMethod && ["offline", "cash", "check", "manual", "none"].includes(String(paymentMethod).toLowerCase())) {
        paymentStatus = "N/A" as any;
      }
      let paymentReceiptUrl = payload.paymentReceiptUrl ?? null;
      let currency = normalizeCurrency(payload.currency ?? entryFee?.currency, payments.defaultCurrency ?? "USD");
      let paidAt: Date | null = null;
      let notes = payload.paymentNotes ?? null;

      const isFree = amountDue <= 0;
      const actualMustCompletePayment = mustCompletePayment && !isFree;

      if (isFree) {
        paymentStatus = "paid";
        paymentMethod = "none";
      }

      if (payments.onlineEnabled && payload.paymentIntentId && !isFree) {
        if (!stripe) {
          return res.status(503).json({ error: "Online payments are not available" });
        }

        const paymentIntentRaw = await stripe.paymentIntents.retrieve(payload.paymentIntentId, {
          expand: ["latest_charge"],
        });
        const paymentIntent = paymentIntentRaw as Stripe.PaymentIntent & {
          latest_charge?: string | Stripe.Charge;
          charges?: Stripe.ApiList<Stripe.Charge>;
        };
        amountDue = Number(((paymentIntent.amount ?? amountDue * 100) / 100).toFixed(2));
        amountPaid = Number(((paymentIntent.amount_received ?? 0) / 100).toFixed(2));
        currency = paymentIntent.currency ? paymentIntent.currency.toUpperCase() : currency;

        const latestCharge = ((): Stripe.Charge | null => {
          if (paymentIntent.latest_charge && typeof paymentIntent.latest_charge !== "string") {
            return paymentIntent.latest_charge;
          }
          const charges = paymentIntent.charges?.data ?? [];
          return charges[0] ?? null;
        })();

        if (latestCharge?.receipt_url && !paymentReceiptUrl) {
          paymentReceiptUrl = latestCharge.receipt_url;
        }
        if (latestCharge?.payment_method_details?.type && !paymentMethod) {
          paymentMethod = latestCharge.payment_method_details.type;
        }

        switch (paymentIntent.status) {
          case "succeeded":
            paymentStatus = "paid";
            paidAt = latestCharge?.created ? new Date(latestCharge.created * 1000) : new Date();
            break;
          case "processing":
          case "requires_capture":
            paymentStatus = "processing";
            break;
          case "requires_payment_method":
          case "requires_confirmation":
          case "requires_action":
            paymentStatus = "unpaid";
            break;
          default:
            paymentStatus = paymentStatus ?? "unpaid";
        }

        const validStatuses = ["succeeded", "processing", "requires_payment_method", "requires_confirmation", "requires_action", "requires_capture"];
        if (actualMustCompletePayment && !validStatuses.includes(paymentIntent.status)) {
          return res.status(400).json({ error: "Payment must be completed before submitting registration" });
        }
      } else if (actualMustCompletePayment) {
        return res.status(400).json({ error: "Online payment is required for this tournament" });
      }

      let finalUscfRatingRaw = payload.uscfRatingRaw ?? null;
      if (payload.uscfId) {
        const localPlayer = await getLocalUSCFPlayerById(payload.uscfId);
        if (localPlayer && localPlayer.rating?.raw) {
          finalUscfRatingRaw = localPlayer.rating.raw;
        }
      }

      const registrationData = {
        tournamentId,
        userId: user.id,
        playerName: payload.playerName,
        uscfRating: payload.uscfRating ?? null,
        fideRating: payload.fideRating ?? null,
        uscfRatingRaw: finalUscfRatingRaw,
        fideRatingRaw: payload.fideRatingRaw ?? null,
        ratingProvider: payload.ratingProvider ?? null,
        uscfId: payload.uscfId ?? null,
        fideId: payload.fideId ?? null,

        email: payload.email ?? user.email ?? null,
        address1: payload.address1 ?? null,
        address2: payload.address2 ?? null,
        city: payload.city ?? null,
        state: payload.state ?? null,
        postalCode: payload.postalCode ?? null,
        country: payload.country ?? null,
        pairingNotifications: payload.pairingNotifications ?? null,
        newsletter: payload.newsletter ?? false,
        sectionChoice: payload.sectionChoice ?? null,
        entryFeeId: payload.entryFeeId ?? null,
        processingContribution: payload.processingContribution?.toString() || "0",
        byePreference: payload.byePreference ?? null,
        byeRounds: payload.byePreference === "yes" ? (payload.byeRounds ?? []) : [],
        arrivalTime: payload.arrivalTime ?? "",
        notes: payload.notes ?? null,
        paymentStatus,
        paymentIntentId: payload.paymentIntentId ?? null,
        paymentMethod,
        paymentReceiptUrl,
        paymentNotes: notes,
        amountDue,
        amountPaid,
        currency,
        paidAt,
        customAnswers: payload.customAnswers ?? {},
      };

      console.log(`[REG_SERVER] Final registration data for user ${user.id}:`, JSON.stringify(registrationData, null, 2));

      const targetStatus = config.registers.autoAcceptRegistrations ? "approved" : "pending";
      let result: any;

      if (existingToUpdate) {
        if (existingToUpdate.status === "approved" && existingToUpdate.playerName) {
          const nameParts = existingToUpdate.playerName.trim().split(/\s+/);
          const firstName = nameParts[0] || "";
          const lastName = nameParts.length > 1 ? nameParts.slice(1).join(" ") : "";
          const players = await storage.getPlayersByTournament(tournamentId);
          const playerToRemove = players.find((p: any) => p.firstName === firstName && p.lastName === lastName);
          if (playerToRemove) {
            await storage.deletePlayer(playerToRemove.id);
          }
        }
        
        result = await storage.updatePlayerRegistration(existingToUpdate.id, {
          ...registrationData,
          status: targetStatus,
        } as any);
      } else {
        result = await storage.createPlayerRegistration({
          ...registrationData,
          status: targetStatus,
        } as any);
      }

      if (config.registers.autoAcceptRegistrations) {
        await handleApproveOrDecline(tournamentId, result.id, "approved");
        result = await storage.getPlayerRegistration(result.id);
      }

      try {
        const u = req.user!;
        const tour = await storage.getTournament(tournamentId);
        if (u && tour && (u.notifyRegistration ?? true)) {
          const subject = `Registration Received: ${tour.name}`;
          const message = `Thank you for registering for ${tour.name}. Your registration is currently pending review by the tournament director.`;
          
          await storage.createNotification({
            userId: u.id,
            title: subject,
            message,
            type: 'registration_status',
            read: false,
            meta: { tournamentId, registrationId: result.id },
          });

          if ((u.notifyEmail ?? true) && u.email) {
            await notificationService.sendEmail({ to: u.email, subject, text: message });
          }
          if ((u as any).id) {
            await notificationService.sendWebPushNotificationToUser((u as any).id, subject, message);
          }
        }
      } catch (notifErr) {
        console.error("Error sending registration confirmation:", notifErr);
      }

      if (result) {
        res.json(result);
      } else {
        res.status(500).json({ error: "Failed to create registration result" });
      }
    } catch (error) {
      console.error("Error creating player registration:", error);
      res.status(500).json({ error: "Failed to register for tournament" });
    }
  });

  // Player editing their own registration
  app.patch("/api/tournaments/:id/registrations/my", requireAuth, async (req, res) => {
    try {
      const tournamentId = Number.parseInt(req.params.id, 10);
      if (!Number.isFinite(tournamentId)) {
        return res.status(400).json({ error: "Invalid tournament id" });
      }
      const user = req.user!;

      const tournament = await storage.getTournament(tournamentId);
      if (!tournament) {
        return res.status(404).json({ error: "Tournament not found" });
      }

      const config = parseTournamentConfig(tournament);
      if (!config.registers.allowEditRegistration) {
        return res.status(403).json({ error: "Registration editing is not allowed for this tournament" });
      }

      const registrations = await storage.getPlayerRegistrationsByTournament(tournamentId);
      const registration = registrations.find((r: any) => r.userId === user.id);
      if (!registration) {
        return res.status(404).json({ error: "Registration not found" });
      }

      const payload = playerRegistrationSchema.partial().parse(req.body ?? {});

      const updateData: any = {
        status: "pending",
        updatedAt: new Date()
      };
      const editableFields = [
        'playerName', 'uscfRating', 'fideRating', 'uscfId', 'fideId', 
        'email', 'address1', 'address2', 'city', 'state', 
        'postalCode', 'country', 'pairingNotifications', 'newsletter',
        'sectionChoice', 'entryFeeId', 'processingContribution',
        'byePreference', 'byeRounds', 'arrivalTime', 'notes', 'paymentNotes'
      ];

      for (const field of editableFields) {
        if ((payload as any)[field] !== undefined) {
          updateData[field] = (payload as any)[field];
        }
      }

      const finalByePref = updateData.byePreference !== undefined ? updateData.byePreference : registration.byePreference;
      if (finalByePref !== "yes") {
        updateData.byeRounds = [];
      }

      const updated = await storage.updatePlayerRegistration(registration.id, updateData);
      if (!updated) {
        return res.status(500).json({ error: "Failed to update registration" });
      }

      try {
        const director = await storage.getUserById(tournament.createdBy);
        if (director && director.email && notificationService.isEnabled()) {
          await notificationService.sendEmail({
            to: director.email,
            subject: `Registration Updated: ${tournament.name}`,
            text: `Player ${updated.playerName || user.username} has updated their registration for ${tournament.name}.\n\nView details in your dashboard.`
          });
        }
      } catch (notifyError) {
        console.error("Failed to notify director about registration update:", notifyError);
      }

      res.json(updated);
    } catch (error) {
      console.error("Error updating registration:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Invalid registration data", issues: error.flatten() });
      }
      res.status(500).json({ error: "Failed to update registration" });
    }
  });

  // Delete individual registration (for players to cancel entries in a group)
  app.delete("/api/registrations/:id", requireAuth, async (req, res) => {
    try {
      const registrationId = parseInt(req.params.id);
      const user = req.user!;
 
      const registration = await storage.getPlayerRegistration(registrationId);
      if (!registration) {
        return res.status(404).json({ error: "Registration not found" });
      }
 
      const tournament = await storage.getTournament(registration.tournamentId);
      const isOwner = registration.userId === user.id;
      const isTD = user.role === 'tournament_director' && tournament?.createdBy === user.id;
 
      if (!isOwner && !isTD) {
        return res.status(403).json({ error: "You don't have permission to remove this registration" });
      }
 
      if (registration.status === 'approved' && registration.playerName) {
        const nameParts = registration.playerName.trim().split(/\s+/);
        const firstName = nameParts[0] || "";
        const lastName = nameParts.length > 1 ? nameParts.slice(1).join(" ") : "";
        
        const players = await storage.getPlayersByTournament(registration.tournamentId);
        const playerToRemove = players.find((p: any) => p.firstName === firstName && p.lastName === lastName);
        
        if (playerToRemove) {
          console.log(`[REG_DEL] Removing associated player record for approved registration: ${playerToRemove.id}`);
          await storage.deletePlayer(playerToRemove.id);
        }
      }
 
      const deleted = await storage.deletePlayerRegistration(registrationId);
      if (!deleted) {
        return res.status(500).json({ error: "Failed to delete registration" });
      }
 
      res.status(200).json({ message: "Registration removed successfully" });
    } catch (error) {
      console.error("Error deleting registration:", error);
      res.status(500).json({ error: "Failed to remove registration" });
    }
  });

  // Get player registrations for a tournament (for tournament directors)
  app.get("/api/tournaments/:id/registrations", requireAuth, requireTournamentAccess, async (req, res) => {
    try {
      const tournamentId = parseInt(req.params.id);
      const registrations = await storage.getPlayerRegistrationsByTournament(tournamentId);
      res.json(registrations);
    } catch (error) {
      console.error("Error fetching player registrations:", error);
      res.status(500).json({ error: "Failed to fetch player registrations" });
    }
  });

  // Approve/decline player registration (for tournament directors)
  async function handleApproveOrDecline(tournamentId: number, registrationId: number, status: "approved" | "declined") {
    const updatedRegistration = await storage.updatePlayerRegistration(registrationId, { status });

    if (status === "approved" && updatedRegistration) {
      const user = await storage.getUserById(updatedRegistration.userId);
      if (user) {
        const fullName = normalizePlayerName(updatedRegistration.playerName || `${user.firstName} ${user.lastName}`);
        const nameParts = fullName.split(/\s+/);
        const firstName = nameParts[0] || "";
        const lastName = nameParts.length > 1 ? nameParts.slice(1).join(" ") : "";

        const tournament = await storage.getTournament(tournamentId);
        if (!tournament) {
          throw new Error("Tournament not found");
        }
        const regConfig = parseTournamentConfig(tournament);
        const primarySystem = regConfig.details.primaryRatingSystem || 'uscf';
        
        let rating: number | null = null;
        const provider = (updatedRegistration as any).ratingProvider;
        
        console.log(`[APPROVAL_LOG] Processing approval for ${updatedRegistration.playerName}`);
        if (provider === "fide") {
          rating = updatedRegistration.fideRating ?? updatedRegistration.uscfRating ?? null;
        } else if (provider === "uscf") {
          rating = updatedRegistration.uscfRating ?? updatedRegistration.fideRating ?? null;
        } else if (provider === "manual") {
          rating = updatedRegistration.uscfRating ?? updatedRegistration.fideRating ?? null;
        } else {
          rating = primarySystem === 'fide' 
            ? (updatedRegistration.fideRating ?? updatedRegistration.uscfRating ?? null)
            : (updatedRegistration.uscfRating ?? updatedRegistration.fideRating ?? null);
        }

        const federation = provider === 'fide' ? 'FIDE' : (provider === 'uscf' ? 'USCF' : (primarySystem === 'fide' ? 'FIDE' : 'USCF'));
        const players = await storage.getPlayersByTournament(tournamentId);
        const existingPlayer = players.find((p: any) => 
          p.firstName.trim().toLowerCase() === firstName.toLowerCase() && 
          p.lastName.trim().toLowerCase() === lastName.toLowerCase()
        );

        let sectionId: string | null = null;
        let sectionName: string | null = null;
        if (updatedRegistration.sectionChoice) {
          const matchedSection = regConfig.sections?.find(
            (s: any) =>
              s.id === updatedRegistration.sectionChoice ||
              s.name?.trim().toLowerCase() === updatedRegistration.sectionChoice!.trim().toLowerCase()
          );
          if (matchedSection) {
            sectionId = matchedSection.id;
            sectionName = matchedSection.name;
          } else {
            sectionId = updatedRegistration.sectionChoice;
            sectionName = updatedRegistration.sectionChoice;
          }
        }

        // Parse custom answers for club, birthdate, sex
        let club: string | null = null;
        let birthdate: string | null = null;
        let sex: string | null = null;
        const answers = updatedRegistration.customAnswers;
        if (answers && typeof answers === 'object') {
          for (const key of Object.keys(answers)) {
            const lowerKey = key.toLowerCase();
            const val = String((answers as any)[key] || '').trim();
            if (!val) continue;

            if (lowerKey.includes('club') || lowerKey.includes('school') || lowerKey.includes('team')) {
              club = val;
            } else if (lowerKey.includes('birthdate') || lowerKey.includes('dob') || lowerKey.includes('birth')) {
              birthdate = val;
            } else if (lowerKey.includes('sex') || lowerKey.includes('gender')) {
              sex = val;
            }
          }
        }

        let uscfMemberExpiry = (updatedRegistration.customAnswers as any)?.uscfExpiration || null;
        let uscfRatingRaw = updatedRegistration.uscfRatingRaw || null;

        if (updatedRegistration.uscfId) {
          const localPlayer = await getLocalUSCFPlayerById(updatedRegistration.uscfId);
          if (localPlayer) {
            if (localPlayer.metadata?.expiration) {
              uscfMemberExpiry = localPlayer.metadata.expiration;
            }
            if (localPlayer.rating?.raw) {
              uscfRatingRaw = localPlayer.rating.raw;
            }
          }
        }

        if (!uscfMemberExpiry) {
          uscfMemberExpiry = user?.uscfMemberExpiry || null;
        }

        const playerUpdatePayload = {
          rating: rating,
          uscfRating: updatedRegistration.uscfRating,
          fideRating: updatedRegistration.fideRating,
          uscfRatingRaw: uscfRatingRaw,
          fideRatingRaw: updatedRegistration.fideRatingRaw,
          localId: updatedRegistration.uscfId || updatedRegistration.fideId || null,
          federation: federation,
          userId: updatedRegistration.userId,
          sectionId: sectionId,
          sectionName: sectionName,
          email: updatedRegistration.email || null,
          club: club,
          birthdate: birthdate,
          sex: sex,
          paymentStatus: updatedRegistration.paymentStatus || 'unpaid',
          uscfMemberExpiry: uscfMemberExpiry,
        };

        let createdOrUpdatedPlayerId: number;
        if (existingPlayer) {
          await storage.updatePlayer(existingPlayer.id, playerUpdatePayload);
          createdOrUpdatedPlayerId = existingPlayer.id;
        } else {
          const created = await storage.createPlayer({
            ...playerUpdatePayload,
            tournamentId,
            firstName,
            lastName,
          });
          createdOrUpdatedPlayerId = created.id;
        }

        const byeRounds = updatedRegistration.byeRounds;
        if (updatedRegistration.byePreference === "yes" && Array.isArray(byeRounds)) {
          for (const roundStr of byeRounds) {
            if (typeof roundStr === 'string' || typeof roundStr === 'number') {
              const matchResult = String(roundStr).match(/\d+/);
              if (matchResult) {
                const roundNum = parseInt(matchResult[0], 10);
                await storage.createPairing({
                  tournamentId,
                  round: roundNum,
                  playerId: createdOrUpdatedPlayerId,
                  opponentId: null,
                  color: null,
                  points: 1,
                  isBye: true,
                  byeType: 'half_point',
                  isRequested: true,
                });
              }
            }
          }
        }
      }
    }

    if (updatedRegistration) {
      try {
        const userForNotification = await storage.getUserById(updatedRegistration.userId);
        const relatedTournament = await storage.getTournament(tournamentId);
        if (userForNotification && relatedTournament) {
          const subject = `Tournament Registration ${status.charAt(0).toUpperCase() + status.slice(1)}`;
          let message = '';
          if (status === 'approved') {
            message = `Great news! Your registration for ${relatedTournament.name} has been approved.`;
          } else if (status === 'declined') {
            message = `Your registration for ${relatedTournament.name} has been declined. Please contact the organizer for details.`;
          }
          
          if (message) {
            try {
              await storage.createNotification({
                userId: updatedRegistration.userId,
                title: subject,
                message,
                type: 'registration_status',
                read: false,
                meta: { tournamentId, registrationId, status },
              });
            } catch (dbNotifErr) {
              console.error("Error persisting in-app notification:", dbNotifErr);
            }

            if (userForNotification.notifyRegistration ?? true) {
              if (userForNotification.email && (userForNotification.notifyEmail ?? true)) {
                await notificationService.sendEmail({ 
                  to: userForNotification.email, 
                  subject, 
                  text: message 
                });
              }
              if ((userForNotification as any).id) {
                await notificationService.sendWebPushNotificationToUser((userForNotification as any).id, subject, message);
              }
            }
          }
        }
      } catch (notifErr) {
        console.error("Error sending status notification:", notifErr);
      }
    }
    return updatedRegistration;
  }

  app.patch("/api/tournaments/:id/registrations/:registrationId", requireAuth, requireTournamentAccess, async (req, res) => {
    try {
      const tournamentId = parseInt(req.params.id);
      const registrationId = parseInt(req.params.registrationId);
      const { status } = req.body;

      if (!["approved", "declined"].includes(status)) {
        return res.status(400).json({ error: "Invalid status. Must be 'approved' or 'declined'" });
      }

      const registration = await storage.getPlayerRegistration(registrationId);
      if (!registration || registration.tournamentId !== tournamentId) {
        return res.status(404).json({ error: "Registration not found" });
      }

      const result = await handleApproveOrDecline(tournamentId, registrationId, status);
      res.json(result);
    } catch (error) {
      console.error("Error updating player registration:", error);
      res.status(500).json({ error: "Failed to update player registration" });
    }
  });

  // Get player's own registrations
  app.get("/api/my-registrations", requireAuth, async (req, res) => {
    try {
      const user = req.user;
      if (!user) {
        return res.status(401).json({ error: "User not found" });
      }
      const userId = user.id;
      const registrations = await storage.getPlayerRegistrationsByUser(userId);
      res.json(registrations);
    } catch (error) {
      console.error("Error fetching player registrations:", error);
      res.status(500).json({ error: "Failed to fetch your registrations" });
    }
  });
}
