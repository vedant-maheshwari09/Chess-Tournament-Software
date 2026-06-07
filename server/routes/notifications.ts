import type { Express } from "express";
import { z } from "zod";
import Stripe from "stripe";
import {
  lookupUSCF, lookupFide, mapLocalResult, extractQueryParam, normalizeSearchParams, parseLimitParam, getGeminiConfig, normalizeCurrency, computePaymentTotals, normalizeAccountPaymentSettings, formatCurrencyAmount, describeRatingWindow, generatePairings, groupPlayersByScore, pairUpperVsLowerHalf, determineSwissColors, generateSwissPairings, generateBoardNumberSequence, RatingSource, STRIPE_SECRET_KEY, STRIPE_PUBLISHABLE_KEY, STRIPE_WEBHOOK_SECRET, stripe, PAYMENT_STATUSES, PaymentStatus, RatingLookupResult, paymentProviderEnum, paymentScopeEnum, offlineMethodEnum, updateTournamentPaymentsSchema, accountPaymentSettingsSchema, geminiRefineSchema, updateNotificationPreferencesSchema, tournamentNotificationSchema, createPaymentIntentSchema, playerRegistrationSchema, BoardNumberingSettings
} from "./common";

import { storage } from '../storage';
import { requireAuth, requireRole, requireTournamentAccess } from '../auth';
import { notificationService } from '../notifications';
import { parseTournamentConfig } from "@shared/tournament-config";
import { generateFideTrf16Report } from '../lib/fideTrf';
import { lookupFideProfiles, searchFideDirectory } from '../lib/fideDirectory';
import { Player, Pairing, Match, PlayerRegistration } from "@shared/schema";


export function applyNotificationsRoutes(app: Express) {
// ── Notification endpoints ─────────────────────────────────────────────
// Get all notifications for current user
app.get("/api/notifications", requireAuth, async (req, res) => {
    try {
      const user = req.user;
      if (!user) return res.status(401).json({ error: "Unauthorized" });
      const notifications = await storage.getNotificationsByUser(user.id);
      const unreadCount = await storage.getUnreadNotificationCount(user.id);
      res.json({ notifications, unreadCount });
    } catch (error) {
      console.error("Error fetching notifications:", error);
      res.status(500).json({ error: "Failed to fetch notifications" });
    }
  });

// Mark a single notification as read
app.patch("/api/notifications/:id/read", requireAuth, async (req, res) => {
    try {
      const user = req.user;
      if (!user) return res.status(401).json({ error: "Unauthorized" });
      const notificationId = parseInt(req.params.id);
      if (isNaN(notificationId)) return res.status(400).json({ error: "Invalid notification ID" });
      const updated = await storage.markNotificationRead(notificationId, user.id);
      if (!updated) return res.status(404).json({ error: "Notification not found" });
      res.json(updated);
    } catch (error) {
      console.error("Error marking notification as read:", error);
      res.status(500).json({ error: "Failed to mark notification as read" });
    }
  });

// Mark all notifications as read
app.post("/api/notifications/read-all", requireAuth, async (req, res) => {
    try {
      const user = req.user;
      if (!user) return res.status(401).json({ error: "Unauthorized" });
      await storage.markAllNotificationsRead(user.id);
      res.json({ success: true });
    } catch (error) {
      console.error("Error marking all notifications as read:", error);
      res.status(500).json({ error: "Failed to mark all notifications as read" });
    }
  });

// Web Push Subscriptions
app.get("/api/notifications/vapid-public-key", (req, res) => {
    res.json({ publicKey: process.env.VAPID_PUBLIC_KEY || "BG2yHrGF3i0wdfshkoO0WmIj0vGiHs6WO67QyCzzR06quXpeHoZBxJrrJleLWce7LTcUlvzJm7KASQ1qDwPKFy0" });
  });

app.post("/api/notifications/subscribe", requireAuth, async (req, res) => {
    try {
      const user = req.user;
      if (!user) return res.status(401).json({ error: "Unauthorized" });

      const subscription = req.body;
      if (!subscription || !subscription.endpoint || !subscription.keys) {
        return res.status(400).json({ error: "Invalid subscription object" });
      }

      await storage.createPushSubscription({
        userId: user.id,
        endpoint: subscription.endpoint,
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
      });

      res.status(201).json({ success: true });
    } catch (error) {
      console.error("Error saving push subscription:", error);
      res.status(500).json({ error: "Failed to save push subscription" });
    }
  });

app.post("/api/notifications/unsubscribe", requireAuth, async (req, res) => {
    try {
      const { endpoint } = req.body;
      if (!endpoint) return res.status(400).json({ error: "Endpoint required" });

      await storage.deletePushSubscription(endpoint);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting push subscription:", error);
      res.status(500).json({ error: "Failed to delete push subscription" });
    }
  });

}
