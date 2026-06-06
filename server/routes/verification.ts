import { Router } from "express";
import multer from "multer";
import path from "path";
import fs from "fs/promises";
import crypto from "crypto";
import { db } from "../db";
import { users, uscfChallengeCodes, uscfVerificationAttempts } from "@shared/schema";
import { eq, and, desc, gt } from "drizzle-orm";
import { analyzeUscfVideo } from "../lib/video-analysis";

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

export function applyVerificationRoutes(app: Router) {
  app.use("/api/verification", router);
}
