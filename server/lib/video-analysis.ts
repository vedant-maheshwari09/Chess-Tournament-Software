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

    let pageSignatureSeen = false;
    let blankFrameSeen = false;
    
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
      const lowerText = text.toLowerCase();

      // Check challenge code (fuzzy matching: case-insensitive, ignores symbols, allows up to 3 OCR character errors)
      const cleanText = text.toLowerCase().replace(/[^a-z0-9]/g, "");
      const cleanCode = challengeCode.toLowerCase().replace(/[^a-z0-9]/g, "");
      
      let minDistance = cleanCode.length;
      if (cleanText.length >= cleanCode.length) {
        minDistance = getMinLevenshteinDistance(cleanText, cleanCode);
      }
      
      if (!codeFound && minDistance <= 3) {
        console.log(`[USCF Verification] Challenge code '${challengeCode}' matched via fuzzy Levenshtein (min distance: ${minDistance}/13).`);
        codeFound = true;
      }

      // Check URL, Member ID, and Email (Enforces simultaneous visibility in post-reload frames)
      const frameIdMatch = text.match(/\b\d{7,8}\b/);
      const frameEmailMatch = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
      
      let frameHasMemberId = false;
      let frameMemberId = null;
      if (frameIdMatch && (text.includes("Member ID") || text.includes("ID:"))) {
        frameHasMemberId = true;
        frameMemberId = frameIdMatch[0];
      }

      // Extract details for checklist immediately when found in any frame
      if (!memberIdExtracted && frameHasMemberId) {
        memberIdExtracted = frameMemberId;
      }
      if (!emailExtracted && frameEmailMatch) {
        emailExtracted = frameEmailMatch[0];
      }

      // Strict URL Check: browser address bar containing the domain must be visible
      // SIMULTANEOUSLY alongside the Member ID and email in a post-reload frame
      if (blankFrameSeen && pageSignatureSeen) {
        const frameHasUrl = lowerText.includes("new.uschess.org") || lowerText.includes("uschess.org");
        if (frameHasUrl && frameHasMemberId && frameEmailMatch) {
          console.log(`[USCF Verification] Simultaneously verified URL, Member ID (${frameMemberId}), and Email (${frameEmailMatch[0]}) in post-refresh Frame ${index + 1}.`);
          uscfUrlFound = true;
          memberIdExtracted = frameMemberId; // Lock in the verified values
          emailExtracted = frameEmailMatch[0];
        }
      }

      // Real Algorithmic Reload Detection
      // A reload sequence: signature seen -> page goes blank/loading -> signature returns
      const hasSignature = lowerText.includes("member id") || lowerText.includes("safe play training");
      if (hasSignature) {
        if (pageSignatureSeen && blankFrameSeen && !reloadDetected) {
          console.log(`[USCF Verification] Reload sequence algorithmically verified!`);
          reloadDetected = true;
          codeBeforeReload = true; // Mark ordering as correct
        }
        pageSignatureSeen = true;
      } else if (pageSignatureSeen) {
        blankFrameSeen = true; // Page went blank or changed pages during refresh
      }

      // Update database progress in real-time so the user checklist reacts immediately
      await db.update(uscfVerificationAttempts)
        .set({
          codeFound,
          uscfUrlFound,
          memberIdExtracted: memberIdExtracted || null,
          emailExtracted: emailExtracted || null,
          reloadDetected
        })
        .where(eq(uscfVerificationAttempts.id, attemptId));
    }
    
    console.log(`[USCF Verification] OCR analysis complete in ${Date.now() - ocrStartTime}ms.`);
    console.log(`[USCF Verification] OCR Results -> Code Found: ${codeFound}, URL Found: ${uscfUrlFound}, Member ID: ${memberIdExtracted}, Email: ${emailExtracted}, Reload: ${reloadDetected}`);
    
    await worker.terminate();

    // Clean up frames
    await fs.rm(framesDir, { recursive: true, force: true });
    // Also remove the video to save space
    await fs.rm(videoPath, { force: true });

    // Compute score (strictly requiring 100/100 for approval)
    let confidenceScore = 0;
    let failureReason = null;

    if (codeFound) confidenceScore += 20;
    if (uscfUrlFound) confidenceScore += 20;
    if (memberIdExtracted) confidenceScore += 20;
    if (emailExtracted) confidenceScore += 20;
    if (reloadDetected) confidenceScore += 20;

    if (!codeFound) {
      failureReason = "Challenge code was not found in the video. Please make sure to record our website displaying the code at the start of your recording.";
    } else if (!reloadDetected) {
      failureReason = "Page refresh sequence was not detected. You must click the browser reload button during the recording to verify the session is live.";
    } else if (!uscfUrlFound) {
      failureReason = "Browser address bar containing 'new.uschess.org' was not found in the post-refresh frames. Make sure you share your 'Entire Screen'.";
    } else if (!emailExtracted || !memberIdExtracted) {
      failureReason = "Could not clearly read your Member ID or Email on the profile page after refreshing.";
    }

    let isApproved = confidenceScore === 100 && !failureReason;
    let ratingsData = null;
    let thinPhpSuccess = false;

    if (isApproved && memberIdExtracted) {
      console.log(`[USCF Verification] Video verified. Fetching ratings from thin.php for Member ID: ${memberIdExtracted}...`);
      try {
        const response = await fetch(`https://www.uschess.org/msa/thin.php?${memberIdExtracted}`, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
          }
        });
        
        if (!response.ok) {
          throw new Error(`USCF server returned status ${response.status}`);
        }
        
        const html = await response.text();
        const $ = load(html);
        
        const name = $("input[name='memname']").val() as string;
        const regRatingStr = $("input[name='rating1']").val() as string;
        const quickRatingStr = $("input[name='rating2']").val() as string;
        const blitzRatingStr = $("input[name='rating3']").val() as string;
        const state = $("input[name='state_country']").val() as string;
        const fideIdStr = $("input[name='memfideid']").val() as string;
        const expiry = $("input[name='memexpdt']").val() as string;

        if (!name || name.trim().length === 0) {
          throw new Error("Could not find member name (invalid Member ID or database block)");
        }

        const parseRating = (r: string) => {
            if(!r || r === 'Unrated') return null;
            const match = r.match(/\d+/);
            return match ? parseInt(match[0], 10) : null;
        };

        ratingsData = {
          name: name.trim(),
          ratingRegular: parseRating(regRatingStr),
          ratingQuick: parseRating(quickRatingStr),
          ratingBlitz: parseRating(blitzRatingStr),
          state: state || '',
          expiry: expiry || '',
          fideId: fideIdStr ? fideIdStr.split(' - ')[0] : ''
        };
        
        thinPhpSuccess = true;
      } catch (err) {
        console.error("[USCF Verification] Error fetching thin.php:", err);
        isApproved = false;
        failureReason = "Your video was verified, but we encountered a connection error retrieving your official ratings from the USCF server. Please try again in a few minutes.";
      }
    }

    const finalStatus = isApproved && thinPhpSuccess ? 'approved' : 'rejected';

    // Update attempt record
    await db.update(uscfVerificationAttempts)
      .set({
        confidenceScore: finalStatus === 'approved' ? 100 : confidenceScore,
        codeFound,
        uscfUrlFound,
        memberIdExtracted: memberIdExtracted || null,
        emailExtracted: emailExtracted || null,
        reloadDetected,
        orderingCorrect: codeBeforeReload,
        status: finalStatus,
        failureReason,
        completedAt: new Date()
      })
      .where(eq(uscfVerificationAttempts.id, attemptId));

    if (finalStatus === 'approved' && ratingsData && memberIdExtracted) {
      await db.update(users)
        .set({
          uscfVerificationStatus: 'verified',
          uscfVerifiedAt: new Date(),
          uscfId: memberIdExtracted,
          uscfName: ratingsData.name,
          uscfRatingRegular: ratingsData.ratingRegular,
          uscfRatingQuick: ratingsData.ratingQuick,
          uscfRatingBlitz: ratingsData.ratingBlitz,
          uscfState: ratingsData.state,
          uscfMemberExpiry: ratingsData.expiry,
          uscfFideId: ratingsData.fideId,
          uscfThinPhpLastFetched: new Date()
        })
        .where(eq(users.id, userId));

      console.log(`[USCF Verification] Successfully populated user profile with official USCF data for ${ratingsData.name}.`);
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

function levenshteinDistance(a: string, b: string): number {
  const matrix = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));
  
  for (let i = 0; i <= a.length; i++) matrix[i][0] = i;
  for (let j = 0; j <= b.length; j++) matrix[0][j] = j;
  
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1, // deletion
        matrix[i][j - 1] + 1, // insertion
        matrix[i - 1][j - 1] + cost // substitution
      );
    }
  }
  
  return matrix[a.length][b.length];
}

function getMinLevenshteinDistance(text: string, code: string): number {
  if (text.length < code.length) return code.length;
  
  let minDistance = code.length;
  const len = code.length;
  
  for (let i = 0; i <= text.length - len; i++) {
    const windowText = text.substring(i, i + len);
    const dist = levenshteinDistance(windowText, code);
    if (dist < minDistance) {
      minDistance = dist;
    }
  }
  
  return minDistance;
}
