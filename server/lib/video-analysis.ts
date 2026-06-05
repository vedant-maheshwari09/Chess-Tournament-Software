import fs from "fs/promises";
import path from "path";
import { exec } from "child_process";
import util from "util";
import Tesseract from "tesseract.js";
import ffmpegPath from "ffmpeg-static";
import { db } from "../db";
import { uscfVerificationAttempts, users } from "@shared/schema";
import { eq } from "drizzle-orm";
import { load } from "cheerio"; // We might fetch thin.php

const execAsync = util.promisify(exec);

export async function analyzeUscfVideo(attemptId: number, videoPath: string, challengeCode: string, userId: number) {
  console.log(`[USCF Verification] Starting analysis for attempt #${attemptId} (User ID: ${userId})`);
  console.log(`[USCF Verification] Challenge Code to find: ${challengeCode}`);
  try {
    // 1. Create a temp directory for frames
    console.log(`[USCF Verification] Creating temp directory for frames...`);
    const framesDir = path.join(process.cwd(), "uploads", "frames", attemptId.toString());
    await fs.mkdir(framesDir, { recursive: true });

    // 2. Extract frames using ffmpeg (1 frame per second)
    const framesPattern = path.join(framesDir, "frame-%04d.jpg");
    // Ensure ffmpegPath is treated as a valid string
    if (!ffmpegPath) throw new Error("ffmpeg not found");
    
    console.log(`[USCF Verification] Extracting frames from video at 1 FPS using ffmpeg...`);
    const startTime = Date.now();
    await execAsync(`"${ffmpegPath}" -i "${videoPath}" -r 1 -q:v 2 "${framesPattern}"`);
    console.log(`[USCF Verification] Frame extraction completed in ${Date.now() - startTime}ms.`);

    // 3. Read extracted frames
    const files = await fs.readdir(framesDir);
    const frameFiles = files.filter(f => f.endsWith('.jpg')).sort();
    console.log(`[USCF Verification] Extracted ${frameFiles.length} total frames.`);

    let codeFound = false;
    let uscfUrlFound = false;
    let memberIdExtracted: string | null = null;
    let emailExtracted: string | null = null;
    let reloadDetected = false;
    let codeBeforeReload = false;

    let preReloadFrames = 0;
    
    // We'll just pick a few evenly spaced frames to speed up OCR since it can be slow
    // Limit to max 15 frames for analysis
    const framesToAnalyze = [];
    const step = Math.max(1, Math.floor(frameFiles.length / 15));
    for (let i = 0; i < frameFiles.length; i += step) {
      framesToAnalyze.push(frameFiles[i]);
    }
    // Also include the last 3 frames to ensure we catch the post-reload state
    for(let i = Math.max(0, frameFiles.length - 3); i < frameFiles.length; i++) {
        if(!framesToAnalyze.includes(frameFiles[i])) framesToAnalyze.push(frameFiles[i]);
    }

    framesToAnalyze.sort();
    console.log(`[USCF Verification] Selected ${framesToAnalyze.length} frames for OCR analysis to save processing time.`);

    // Initialize Tesseract worker
    console.log(`[USCF Verification] Initializing Tesseract OCR worker...`);
    const ocrStartTime = Date.now();
    const worker = await Tesseract.createWorker("eng");
    console.log(`[USCF Verification] Tesseract worker ready.`);
    
    for (let index = 0; index < framesToAnalyze.length; index++) {
      const frame = framesToAnalyze[index];
      const framePath = path.join(framesDir, frame);
      console.log(`[USCF Verification] Analyzing frame ${index + 1}/${framesToAnalyze.length} (${frame})...`);
      const { data: { text } } = await worker.recognize(framePath);

      // Check challenge code
      if (!codeFound && text.includes(challengeCode)) {
        codeFound = true;
      }

      // Check URL
      if (!uscfUrlFound && (text.includes("new.uschess.org") || text.includes("new.uschess.org/user"))) {
        uscfUrlFound = true;
      }

      // Check Member ID (7 or 8 digits)
      const idMatch = text.match(/\b\d{7,8}\b/);
      if (!memberIdExtracted && idMatch) {
         // rudimentary check if it's near "Member ID" or just pick the first valid looking one
         if(text.includes("Member ID") || text.includes("ID:")) {
            memberIdExtracted = idMatch[0];
         }
      }

      // Check Email
      const emailMatch = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
      if (!emailExtracted && emailMatch) {
        emailExtracted = emailMatch[0];
      }

      // Reload detection (very naive: if text suddenly loses "uschess" then regains it, or based on a "Loading" text)
      // Since this is a prototype, we'll simulate reload detection if we see the code first then the email later.
      if (codeFound && emailExtracted && !reloadDetected) {
         console.log(`[USCF Verification] Reload sequence simulated/detected.`);
         reloadDetected = true;
         codeBeforeReload = true;
      }
    }
    
    console.log(`[USCF Verification] OCR analysis complete in ${Date.now() - ocrStartTime}ms.`);
    console.log(`[USCF Verification] OCR Results -> Code Found: ${codeFound}, URL Found: ${uscfUrlFound}, Member ID: ${memberIdExtracted}, Email: ${emailExtracted}`);
    
    await worker.terminate();

    // Clean up frames
    await fs.rm(framesDir, { recursive: true, force: true });
    // Also remove the video to save space
    await fs.rm(videoPath, { force: true });

    // Compute score
    let confidenceScore = 0;
    let failureReason = null;

    if (codeFound) confidenceScore += 35;
    if (uscfUrlFound) confidenceScore += 25;
    if (memberIdExtracted) confidenceScore += 15;
    if (emailExtracted) confidenceScore += 15;
    if (reloadDetected) confidenceScore += 10;

    if (!codeFound) {
      failureReason = "Challenge code was not found in the video. Please make sure the code is visible at the start.";
    } else if (!uscfUrlFound) {
      failureReason = "Could not detect new.uschess.org in the browser address bar.";
    } else if (!emailExtracted || !memberIdExtracted) {
      failureReason = "Could not clearly read your Member ID or Email on the profile page.";
    }

    const isApproved = confidenceScore >= 75 && !failureReason;
    console.log(`[USCF Verification] Final Score: ${confidenceScore}/100. Status: ${isApproved ? 'APPROVED' : 'REJECTED'}`);
    if (failureReason) console.log(`[USCF Verification] Failure Reason: ${failureReason}`);
    
    // Update attempt record
    await db.update(uscfVerificationAttempts)
      .set({
        confidenceScore,
        codeFound,
        uscfUrlFound,
        memberIdExtracted: memberIdExtracted || null,
        emailExtracted: emailExtracted || null,
        reloadDetected,
        orderingCorrect: codeBeforeReload,
        status: isApproved ? 'approved' : 'rejected',
        failureReason,
        completedAt: new Date()
      })
      .where(eq(uscfVerificationAttempts.id, attemptId));

    if (isApproved && memberIdExtracted) {
      // We need to fetch thin.php data now
      console.log(`[USCF Verification] Verification passed! Fetching official USCF ratings from thin.php for Member ID: ${memberIdExtracted}...`);
      try {
        const response = await fetch(`https://www.uschess.org/msa/thin.php?${memberIdExtracted}`);
        const html = await response.text();
        const $ = load(html);
        
        // Very basic parsing based on the thin.php structure
        const name = $("input[name='memname']").val() as string;
        const regRatingStr = $("input[name='rating1']").val() as string;
        const quickRatingStr = $("input[name='rating2']").val() as string;
        const blitzRatingStr = $("input[name='rating3']").val() as string;
        const state = $("input[name='state_country']").val() as string;
        const fideIdStr = $("input[name='memfideid']").val() as string;
        const expiry = $("input[name='memexpdt']").val() as string;

        const parseRating = (r: string) => {
            if(!r || r === 'Unrated') return null;
            const match = r.match(/\d+/);
            return match ? parseInt(match[0], 10) : null;
        };

        await db.update(users)
          .set({
            uscfVerificationStatus: 'verified',
            uscfVerifiedAt: new Date(),
            uscfId: memberIdExtracted,
            uscfName: name || '',
            uscfRatingRegular: parseRating(regRatingStr),
            uscfRatingQuick: parseRating(quickRatingStr),
            uscfRatingBlitz: parseRating(blitzRatingStr),
            uscfState: state || '',
            uscfMemberExpiry: expiry || '',
            uscfFideId: fideIdStr ? fideIdStr.split(' - ')[0] : '',
            uscfThinPhpLastFetched: new Date()
          })
          .where(eq(users.id, userId));

        console.log(`[USCF Verification] Successfully populated user profile with official USCF data for ${name}.`);

      } catch (err) {
        console.error("[USCF Verification] Error fetching thin.php:", err);
      }
    }
    
  } catch (err) {
    console.error("[USCF Verification] Video analysis failed with error:", err);
    await db.update(uscfVerificationAttempts)
      .set({
        status: 'rejected',
        failureReason: "An internal error occurred during video analysis.",
        completedAt: new Date()
      })
      .where(eq(uscfVerificationAttempts.id, attemptId));
  }
}
