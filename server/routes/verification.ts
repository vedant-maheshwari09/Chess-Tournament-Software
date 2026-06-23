import { Router } from "express";
import multer from "multer";
import path from "path";
import fs from "fs/promises";
import crypto from "crypto";
import { db } from "../db";
import { users, uscfChallengeCodes, uscfVerificationAttempts } from "@shared/schema";
import { eq, and, desc, gt, ne } from "drizzle-orm";
import { analyzeUscfVideo } from "../lib/video-analysis";
import { getLocalUSCFPlayerById } from "../lib/localRatings";
import { notificationService } from "../notifications";

const router = Router();

// Configure multer for video uploads
const uploadDir = path.join(process.cwd(), "uploads", "uscf-verifications");
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    await fs.mkdir(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage: storage,
  limits: { fileSize: 500 * 1024 * 1024 }, // 500 MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['video/mp4', 'video/webm', 'video/quicktime'];
    if (allowedTypes.includes(file.mimetype) || file.originalname.match(/\.(mp4|webm|mov)$/i)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only MP4, WebM, and MOV are allowed.'));
    }
  }
});

import { requireAuth } from "../auth";

// Generate a challenge code
router.post("/uscf/challenge", requireAuth, async (req, res) => {
  try {
    const userId = req.user!.id;

    // Enforce a 1-minute gap between verification attempts to cool down
    const [lastAttempt] = await db.select()
      .from(uscfVerificationAttempts)
      .where(eq(uscfVerificationAttempts.userId, userId))
      .orderBy(desc(uscfVerificationAttempts.createdAt))
      .limit(1);

    if (lastAttempt) {
      if (!lastAttempt.completedAt) {
        return res.status(429).json({
          message: "You have a verification attempt currently processing. Please wait for it to finish."
        });
      }

      const timeSinceDiff = Date.now() - new Date(lastAttempt.completedAt).getTime();
      const oneMinute = 60 * 1000;
      if (timeSinceDiff < oneMinute) {
        const secondsLeft = Math.ceil((oneMinute - timeSinceDiff) / 1000);
        return res.status(429).json({ 
          message: `Please wait ${secondsLeft} seconds before initiating a new verification attempt.` 
        });
      }
    }

    // Invalidate previous unused codes
    await db.update(uscfChallengeCodes)
      .set({ used: true })
      .where(and(eq(uscfChallengeCodes.userId, userId), eq(uscfChallengeCodes.used, false)));

    // Generate code CHESS-XXXX-XXXX
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // No I, O, 1, 0
    const randomString = (length: number) => Array.from({length}, () => chars[Math.floor(Math.random() * chars.length)]).join('');
    const code = `CHESS-${randomString(4)}-${randomString(4)}`;

    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + 10);

    const [challenge] = await db.insert(uscfChallengeCodes)
      .values({ userId, code, expiresAt })
      .returning();

    res.json({ id: challenge.id, code: challenge.code, expiresAt: challenge.expiresAt });
  } catch (error) {
    console.error("Error generating challenge:", error);
    res.status(500).json({ message: "Failed to generate challenge code" });
  }
});

// Submit a video
router.post("/uscf/submit", requireAuth, upload.single('video'), async (req, res) => {
  try {
    const userId = req.user!.id;
    const challengeCodeId = parseInt(req.body.challengeCodeId, 10);
    const file = req.file;

    if (!file) {
      return res.status(400).json({ message: "No video file provided." });
    }

    if (isNaN(challengeCodeId)) {
      await fs.rm(file.path, { force: true });
      return res.status(400).json({ message: "Invalid challenge code ID." });
    }

    // Verify challenge code
    const [challenge] = await db.select()
      .from(uscfChallengeCodes)
      .where(
        and(
          eq(uscfChallengeCodes.id, challengeCodeId),
          eq(uscfChallengeCodes.userId, userId),
          eq(uscfChallengeCodes.used, false)
        )
      );

    if (!challenge) {
      await fs.rm(file.path, { force: true });
      return res.status(400).json({ message: "Invalid or already used challenge code." });
    }

    if (new Date() > new Date(challenge.expiresAt)) {
      console.log(`[USCF Verification] Rejecting attempt: Challenge code expired for User ${userId}`);
      await db.update(uscfChallengeCodes).set({ used: true }).where(eq(uscfChallengeCodes.id, challenge.id));
      await fs.rm(file.path, { force: true });
      return res.status(400).json({ message: "Challenge code has expired. Please start over." });
    }

    // Mark as used
    console.log(`[USCF Verification] Challenge code validated and marked as used for User ${userId}`);
    await db.update(uscfChallengeCodes).set({ used: true }).where(eq(uscfChallengeCodes.id, challenge.id));

    // Create attempt
    const [attempt] = await db.insert(uscfVerificationAttempts)
      .values({
        userId,
        challengeCodeId: challenge.id,
        videoPath: file.path,
        status: 'processing'
      })
      .returning();

    console.log(`[USCF Verification] Attempt #${attempt.id} created. Video saved to ${file.path}. Dispatching background job...`);

    // Launch background processing
    analyzeUscfVideo(attempt.id, file.path, challenge.code, userId).catch(err => {
      console.error(`[USCF Verification] Background analysis failed for attempt ${attempt.id}:`, err);
    });

    res.json({ attemptId: attempt.id });
  } catch (error) {
    console.error("[USCF Verification] Error submitting video:", error);
    res.status(500).json({ message: "Failed to submit verification video" });
  }
});

// Check status
router.get("/uscf/status/:attemptId", requireAuth, async (req, res) => {
  try {
    const attemptId = parseInt(req.params.attemptId, 10);
    if (isNaN(attemptId)) return res.status(400).json({ message: "Invalid ID" });

    const [attempt] = await db.select()
      .from(uscfVerificationAttempts)
      .where(and(eq(uscfVerificationAttempts.id, attemptId), eq(uscfVerificationAttempts.userId, req.user!.id)));

    if (!attempt) return res.status(404).json({ message: "Not found" });

    res.json(attempt);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch status" });
  }
});

// Get my status
router.get("/uscf/me", requireAuth, async (req, res) => {
  try {
    const [user] = await db.select().from(users).where(eq(users.id, req.user!.id));
    res.json({
      status: user.uscfVerificationStatus,
      name: user.uscfName,
      uscfId: user.uscfId,
      ratingRegular: user.uscfRatingRegular,
      ratingQuick: user.uscfRatingQuick,
      ratingBlitz: user.uscfRatingBlitz,
      state: user.uscfState,
      fideId: user.uscfFideId,
      expiry: user.uscfMemberExpiry,
      verifiedAt: user.uscfVerifiedAt
    });
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch status" });
  }
});

// Disconnect USCF account
router.post("/uscf/disconnect", requireAuth, async (req, res) => {
  try {
    const userId = req.user!.id;
    await db.update(users)
      .set({
        uscfVerificationStatus: 'unverified',
        uscfVerifiedAt: null,
        uscfId: null,
        uscfName: null,
        uscfRatingRegular: null,
        uscfRatingQuick: null,
        uscfRatingBlitz: null,
        uscfState: null,
        uscfMemberExpiry: null,
        uscfFideId: null,
        uscfThinPhpLastFetched: null
      })
      .where(eq(users.id, userId));

    console.log(`[USCF Verification] User ${userId} disconnected their USCF account.`);
    res.json({ message: "USCF account disconnected successfully." });
  } catch (error) {
    console.error("Error disconnecting USCF account:", error);
    res.status(500).json({ message: "Failed to disconnect USCF account." });
  }
});

// In-memory rate limiting maps for USCF connection and reporting
const uscfConnectLimits = new Map<number, number[]>();
const uscfReportLimits = new Map<number, number[]>();

function isRateLimited(userId: number, limitsMap: Map<number, number[]>, maxAttempts: number, windowMs: number): boolean {
  const now = Date.now();
  const attempts = limitsMap.get(userId) || [];
  const activeAttempts = attempts.filter(t => now - t < windowMs);
  if (activeAttempts.length >= maxAttempts) {
    return true;
  }
  activeAttempts.push(now);
  limitsMap.set(userId, activeAttempts);
  return false;
}

// Connect USCF account immediately using ID & Name match
router.post("/uscf/connect", requireAuth, async (req, res) => {
  try {
    const userId = req.user!.id;
    const { uscfId } = req.body;

    if (!uscfId || typeof uscfId !== "string" || !uscfId.trim()) {
      return res.status(400).json({ message: "USCF ID is required." });
    }

    const trimmedId = uscfId.trim();

    if (!/^\d{8}$/.test(trimmedId)) {
      return res.status(400).json({ message: "Invalid USCF ID format. USCF ID must be exactly an 8-digit number." });
    }

    // Rate limiting: max 5 connection attempts per minute
    if (isRateLimited(userId, uscfConnectLimits, 5, 60 * 1000)) {
      return res.status(429).json({ message: "Too many connection attempts. Please wait a minute and try again." });
    }

    // Check if USCF ID is already connected to another user
    const existing = await db.select()
      .from(users)
      .where(and(eq(users.uscfId, trimmedId), ne(users.id, userId)))
      .limit(1);

    if (existing.length > 0) {
      return res.status(400).json({
        code: "ALREADY_CONNECTED",
        message: "This USCF ID is already connected with another account."
      });
    }

    // Look up player locally
    const player = await getLocalUSCFPlayerById(trimmedId);
    if (!player) {
      return res.status(400).json({ message: "USCF ID not found in database." });
    }

    // Name matching logic
    const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
    const normUscfName = normalize(player.name);
    const normUserFirst = normalize(req.user!.firstName);
    const normUserLast = normalize(req.user!.lastName);

    let isNameMatch = false;
    if (req.user!.role === 'player') {
      isNameMatch = normUscfName.includes(normUserFirst) && normUscfName.includes(normUserLast);
    } else {
      isNameMatch = true;
    }

    if (!isNameMatch) {
      return res.status(400).json({
        message: `Name mismatch. The USCF record name "${player.name}" does not match your account name "${req.user!.firstName} ${req.user!.lastName}".`
      });
    }

    // Connect and set to pending verification (waiting for TD verification)
    await db.update(users)
      .set({
        uscfId: player.id,
        uscfName: player.name,
        uscfVerificationStatus: 'pending',
        uscfVerifiedAt: null,
        uscfRatingRegular: player.rating?.value ? parseInt(player.rating.value) : null,
        uscfRatingQuick: player.quickRating?.value ? parseInt(player.quickRating.value) : null,
        uscfRatingBlitz: player.blitzRating?.value ? parseInt(player.blitzRating.value) : null,
        uscfState: player.location || null,
        uscfMemberExpiry: player.metadata?.expiration || null,
        uscfFideId: null,
        uscfThinPhpLastFetched: new Date()
      })
      .where(eq(users.id, userId));

    console.log(`[USCF Connect] User ${userId} connected USCF ID ${player.id}.`);
    res.json({
      message: "USCF account connected successfully. Awaiting Tournament Director verification.",
      uscfId: player.id,
      name: player.name,
      status: 'pending'
    });
  } catch (error) {
    console.error("Error connecting USCF:", error);
    res.status(500).json({ message: "Failed to connect USCF account." });
  }
});

// Report Identity Falsification
router.post("/uscf/report-falsification", requireAuth, async (req, res) => {
  try {
    const userId = req.user!.id;
    const { uscfId } = req.body;

    if (!uscfId || typeof uscfId !== "string" || !uscfId.trim()) {
      return res.status(400).json({ message: "USCF ID is required." });
    }

    const trimmedId = uscfId.trim();

    // Rate limiting: max 3 reports per day
    if (isRateLimited(userId, uscfReportLimits, 3, 24 * 60 * 60 * 1000)) {
      return res.status(429).json({ message: "Report limit reached. You can only submit 3 reports per day." });
    }

    const [connectedUser] = await db.select()
      .from(users)
      .where(eq(users.uscfId, trimmedId))
      .limit(1);

    const reporterName = `${req.user!.firstName} ${req.user!.lastName}`;
    const connectedDetails = connectedUser 
      ? `Username: ${connectedUser.username}, Name: ${connectedUser.firstName} ${connectedUser.lastName}, Email: ${connectedUser.email}`
      : "None";

    const subject = `[Security Alert] USCF Identity Falsification Report - ID ${trimmedId}`;
    const body = `
      Hello Antigravity Team,

      An identity falsification report has been filed on the platform.

      Reporter Details:
      - Username: ${req.user!.username}
      - Name: ${reporterName}
      - Email: ${req.user!.email}

      Reported USCF ID: ${trimmedId}

      Current Connected User on Platform:
      - ${connectedDetails}

      Please investigate this claim.
    `;

    if (notificationService.isEmailEnabled()) {
      await notificationService.sendEmail({
        to: "mathbymoves@gmail.com",
        subject,
        text: body
      });
      console.log(`[USCF Report] Sent falsification email for USCF ID ${trimmedId} to mathbymoves@gmail.com`);
    } else {
      console.warn(`[USCF Report] Email service disabled; logged falsification report for USCF ID ${trimmedId}`);
    }

    res.json({ message: "Identity falsification report submitted successfully. Administrators have been notified." });
  } catch (error) {
    console.error("Error reporting falsification:", error);
    res.status(500).json({ message: "Failed to submit falsification report." });
  }
});

// Verify player's USCF connection (TD only)
router.post("/uscf/verify-player-connection", requireAuth, async (req, res) => {
  try {
    if (req.user!.role !== "tournament_director") {
      return res.status(403).json({ message: "Access denied. Tournament Director role required." });
    }

    const { targetUserId, verified } = req.body;

    if (!targetUserId || typeof targetUserId !== "number") {
      return res.status(400).json({ message: "Invalid target user ID." });
    }

    const status = verified ? "verified" : "unverified";
    const verifiedAt = verified ? new Date() : null;

    const [updatedUser] = await db.update(users)
      .set({
        uscfVerificationStatus: status,
        uscfVerifiedAt: verifiedAt
      })
      .where(eq(users.id, targetUserId))
      .returning();

    if (!updatedUser) {
      return res.status(404).json({ message: "Target user not found." });
    }

    console.log(`[USCF Verify Connection] TD ${req.user!.id} set verification status of User ${targetUserId} to ${status}`);
    res.json({
      message: `User USCF connection set to ${status}.`,
      userId: targetUserId,
      status
    });
  } catch (error) {
    console.error("Error verifying player connection:", error);
    res.status(500).json({ message: "Failed to verify player connection." });
  }
});

export function applyVerificationRoutes(app: Router) {
  app.use("/api/verification", router);
}
