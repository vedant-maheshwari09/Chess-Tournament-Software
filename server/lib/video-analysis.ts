import fs from "fs/promises";
import fsSync from "fs";
import path from "path";
import { exec } from "child_process";
import util from "util";
import Tesseract from "tesseract.js";
import ffmpegPath from "ffmpeg-static";
import { db } from "../db";
import { uscfVerificationAttempts, users } from "@shared/schema";
import { eq } from "drizzle-orm";
import { load } from "cheerio";

const execAsync = util.promisify(exec);

// ─── Logging Helpers ────────────────────────────────────────────────────────

const TAG = "[USCF-Verify]";

function writeToLogFile(line: string) {
  try {
    const logDir = path.join(process.cwd(), "uploads");
    fsSync.mkdirSync(logDir, { recursive: true });
    const logFilePath = path.join(logDir, "video-analysis.log");
    fsSync.appendFileSync(logFilePath, line + "\n", "utf-8");
  } catch (e) {
    console.error("Failed to write to log file:", e);
  }
}

function log(section: string, message: string, data?: Record<string, unknown>) {
  const ts = new Date().toISOString();
  const prefix = `${ts} ${TAG}[${section}]`;
  let formatted = "";
  if (data && Object.keys(data).length > 0) {
    formatted = `${prefix} ${message} ${JSON.stringify(data, null, 2)}`;
  } else {
    formatted = `${prefix} ${message}`;
  }
  console.log(formatted);
  writeToLogFile(formatted);
}

function logWarn(section: string, message: string, data?: Record<string, unknown>) {
  const ts = new Date().toISOString();
  const prefix = `${ts} ${TAG}[${section}] ⚠️ WARNING:`;
  let formatted = "";
  if (data && Object.keys(data).length > 0) {
    formatted = `${prefix} ${message} ${JSON.stringify(data, null, 2)}`;
  } else {
    formatted = `${prefix} ${message}`;
  }
  console.log(formatted);
  writeToLogFile(formatted);
}

export function logError(section: string, message: string, err?: unknown) {
  const ts = new Date().toISOString();
  const formatted = `${ts} ${TAG}[${section}] ❌ ERROR: ${message} ${err ? String(err) : ""}`;
  console.error(formatted);
  writeToLogFile(formatted);
}

export function logSeparator(label: string) {
  const lineStr = "─".repeat(70);
  const sepFormatted = `\n${lineStr}\n${TAG} ${label}\n${lineStr}`;
  console.log(sepFormatted);
  writeToLogFile(sepFormatted);
}

// ─── Extraction Functions ────────────────────────────────────────────────────

/**
 * Checks whether the given OCR text (from the address-bar strip of a frame)
 * shows the USCF dashboard URL.
 *
 * SECURITY: We also check that no non-live URL scheme appears in the same strip.
 * This prevents screenshots (file:///...) or localhost pages from passing.
 * The text must come from a top-strip crop of the frame — NOT the full frame —
 * so we are reading the browser address bar, not page content.
 */
export async function isUscfDomain(addressBarText: string): Promise<boolean> {
  const clean = addressBarText.toLowerCase().replace(/\s+/g, "");

  // Strip screen sharing banner indicators (e.g. "localhost:5010/settings is sharing your screen.")
  // so they don't trigger false positives in the security checks below.
  // We match loca[l]?host to tolerate minor OCR character misses, and allow any path/port
  // characters before the sharing indicator to handle different initiating pages.
  const cleanWithoutBanner = clean
    .replace(/(?:https?:\/\/)?loca[l]?host(?::\d+)?(?:[a-z0-9_\-/]*)(?:issharing|sharing)[a-z]*/gi, "")
    .replace(/(?:issharing|sharing)your(?:screen|window|tab|page)[a-z]*/gi, "");

  // Reject non-live schemes that indicate a screenshot or local file.
  const REJECTED_SCHEMES = ["file:///", "file://", "localhost", "127.0.0.1", "chrome-extension://", "data:", "blob:"];
  for (const scheme of REJECTED_SCHEMES) {
    if (cleanWithoutBanner.includes(scheme.replace(/\s/g, ""))) {
      const msg = `[USCF-Verify][isUscfDomain] Rejecting due to non-live scheme "${scheme}" in "${cleanWithoutBanner}"`;
      console.log(msg);
      writeToLogFile(msg);
      return false;
    }
  }

  // Allow up to 3 character substitutions/omissions using mathematical edit-distance.
  // This handles common OCR errors on tiny address bar text (e.g., "newusdessorg").
  // We check for "newuschessorguser" since that's the base profile URL.
  const targetUrl = "newuschessorguser";
  const cleanForEditDistance = cleanWithoutBanner.replace(/[^a-z0-9]/g, "");
  const minDistance = getMinLevenshteinDistance(cleanForEditDistance, targetUrl);
  
  const matched = minDistance <= 3;

  const msg = `[USCF-Verify][isUscfDomain] Input: "${addressBarText.replace(/\r?\n/g, "\\n")}" | Cleaned: "${cleanForEditDistance}" | Distance to target: ${minDistance} | Matched: ${matched}`;
  console.log(msg);
  writeToLogFile(msg);

  return matched;
}

/**
 * Returns true if the full-frame OCR text contains a disqualifying non-live URL.
 * Used as an additional cross-check on the full frame text.
 */
export function hasNonLiveUrl(text: string): boolean {
  const clean = text.toLowerCase().replace(/\s+/g, "");
  
  // Strip screen sharing banner indicators
  const cleanWithoutBanner = clean
    .replace(/(?:https?:\/\/)?loca[l]?host(?::\d+)?(?:[a-z0-9_\-/]*)(?:issharing|sharing)[a-z]*/gi, "")
    .replace(/(?:issharing|sharing)your(?:screen|window|tab|page)[a-z]*/gi, "");

  const REJECTED_SCHEMES = ["file:///", "file://", "localhost:", "127.0.0.1", "chrome-extension://", "blob:http"];
  for (const scheme of REJECTED_SCHEMES) {
    if (cleanWithoutBanner.includes(scheme.replace(/\s/g, ""))) return true;
  }
  return false;
}

export function extractMemberId(text: string): string | null {
  // 1. Line-by-line search
  const lines = text.split(/\r?\n/);
  for (let line of lines) {
    const normalized = line.toLowerCase()
      .replace(/nnember/g, "member")
      .replace(/membler/g, "member")
      .replace(/memb/g, "member");
    const match = normalized.match(/(?:member\s*(?:id|num(?:ber)?)|id\b)[:\s#\-–—]*(\d{7,8})\b/);
    if (match) return match[1];
  }

  // 2. Global search on collapsed text
  const collapsed = text.toLowerCase()
    .replace(/[\r\n]+/g, " ")
    .replace(/nnember/g, "member")
    .replace(/membler/g, "member")
    .replace(/memb/g, "member");
  const globalMatch = collapsed.match(/(?:member\s*(?:id|num(?:ber)?)|id\b)[:\s#\-–—]*(\d{7,8})\b/);
  if (globalMatch) return globalMatch[1];

  return null;
}

/**
 * Extracts any email address found in the OCR text.
 * 
 * Important design decision: we do NOT compare against the user's platform email.
 * The USCF dashboard will show whatever email is linked to the user's USCF account,
 * which may differ from their Chess Tournament Manager registration email.
 * Our only requirement is that the SAME email appears before AND after the page reload
 * (proving the session was not swapped). The actual address is irrelevant.
 *
 * OCR can introduce spaces inside tokens, so we collapse whitespace per-line
 * and also try on the fully collapsed text as a fallback.
 */
export function extractAnyEmail(text: string): string | null {
  // Regex: standard email pattern with restricted TLD length and word boundary.
  const emailRegex = /[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,6}\b/;

  const lines = text.split(/\r?\n/);

  // Pass 0: Scan original raw lines. This prevents merging emails with adjacent text.
  for (const line of lines) {
    const rawLine = line.toLowerCase();
    const match = rawLine.match(emailRegex);
    if (match) return match[0];
  }

  // Pass 1: Scan line by line with intra-line spaces collapsed.
  // Useful if OCR inserted spaces inside the email (e.g. "my name @ gmail . com").
  for (const line of lines) {
    const condensed = line.replace(/\s+/g, "").toLowerCase();
    const match = condensed.match(emailRegex);
    if (match) return match[0];
  }

  // Pass 2: Collapse the entire text and scan.
  const collapsed = text.replace(/\s+/g, "").toLowerCase();
  const globalMatch = collapsed.match(emailRegex);
  if (globalMatch) return globalMatch[0];

  return null;
}

/** @deprecated Use extractAnyEmail instead. Retained only for reference. */
export function findMatchingEmail(text: string, targetEmail: string): string | null {
  const cleanText = text.replace(/\s+/g, "").toLowerCase();
  const cleanTarget = targetEmail.toLowerCase().replace(/[\s,;]/g, "");
  if (cleanTarget.length === 0) return null;
  const minDistance = getMinLevenshteinDistance(cleanText, cleanTarget);
  if (minDistance <= 2) return targetEmail;
  return null;
}


// ─── Main Analysis Function ──────────────────────────────────────────────────

export async function analyzeUscfVideo(
  attemptId: number,
  videoPath: string,
  challengeCode: string,
  userId: number
) {
  const analysisStartTime = Date.now();

  logSeparator(`ATTEMPT #${attemptId} — STARTING ANALYSIS`);
  log("Init", "Analysis started", {
    attemptId,
    userId,
    challengeCode,
    videoPath,
    startedAt: new Date().toISOString(),
  });

  try {
    // ── Step 1: Load User Record ────────────────────────────────────────────
    log("UserLookup", `Fetching user record from DB for User ID ${userId}...`);
    const [userRecord] = await db.select().from(users).where(eq(users.id, userId));
    const targetEmail = userRecord?.email?.toLowerCase().trim();

    if (!targetEmail) {
      logError("UserLookup", `No email found for User ID ${userId}. Aborting.`);
      throw new Error(`User email not found for User ID ${userId}`);
    }

    log("UserLookup", "User record loaded", {
      userId,
      email: targetEmail,
      username: userRecord?.username ?? "(unknown)",
    });

    // ── Step 2: Create Frames Directory ────────────────────────────────────
    const framesDir = path.join(process.cwd(), "uploads", "frames", attemptId.toString());
    log("Setup", `Creating frames directory: ${framesDir}`);
    await fs.mkdir(framesDir, { recursive: true });
    log("Setup", "Frames directory ready.");

    // ── Step 3: Video Metadata via ffmpeg ──────────────────────────────────
    if (!ffmpegPath) throw new Error("ffmpeg-static binary not found.");

    let videoDurationSeconds: number | null = null;
    try {
      log("FFmpeg", "Probing video duration...");
      const { stderr: probeOutput } = await execAsync(
        `"${ffmpegPath}" -i "${videoPath}" 2>&1`
      ).catch((e) => ({ stderr: e.stderr ?? "", stdout: "" }));

      const durationMatch = probeOutput.match(/Duration:\s*(\d+):(\d+):(\d+\.\d+)/);
      if (durationMatch) {
        const h = parseInt(durationMatch[1], 10);
        const m = parseInt(durationMatch[2], 10);
        const s = parseFloat(durationMatch[3]);
        videoDurationSeconds = h * 3600 + m * 60 + s;
        log("FFmpeg", `Video duration detected: ${videoDurationSeconds.toFixed(2)}s`, {
          hours: h, minutes: m, seconds: s,
        });
      } else {
        logWarn("FFmpeg", "Could not parse video duration from ffmpeg probe output.");
      }
    } catch (probeErr) {
      logWarn("FFmpeg", "ffmpeg probe failed (non-fatal); duration unknown.", {
        error: String(probeErr),
      });
    }

    // ── Step 4: Frame Extraction ────────────────────────────────────────────
    const framesPattern    = path.join(framesDir, "frame-%04d.jpg");
    const framesTopPattern = path.join(framesDir, "top-%04d.jpg");
    // 4 FPS gives us 250ms resolution. At 2 FPS we had 500ms per frame —
    // a fast reload (< 500ms blank) could go completely undetected because the
    // blank window fell entirely between two sample points.
    const EXTRACT_FPS = 4;
    const ffmpegFilter = "format=gray,eq=contrast=1.5:brightness=-0.05";
    const ffmpegCmd    = `"${ffmpegPath}" -i "${videoPath}" -vf "${ffmpegFilter}" -r ${EXTRACT_FPS} -q:v 2 "${framesPattern}"`;

    // Address-bar strip: Crop the top 15% AND the bottom 15% of the frame (catches mobile bottom address bars),
    // stack them vertically, and upscale the combined strip 4x using Lanczos filter for razor-sharp text.
    // Apply high contrast and unsharp mask to create a perfect OCR-ready image that prevents typos.
    const ffmpegTopFilter = "[0:v]crop=iw:ih*0.15:0:0[top];[0:v]crop=iw:ih*0.15:0:ih*0.85[bottom];[top][bottom]vstack,scale=iw*4:ih*4:flags=lanczos,unsharp=5:5:1.0:5:5:0.0,format=gray,eq=contrast=2.0:brightness=-0.05";
    const ffmpegTopCmd    = `"${ffmpegPath}" -i "${videoPath}" -filter_complex "${ffmpegTopFilter}" -r ${EXTRACT_FPS} -q:v 1 "${framesTopPattern}"`;

    log("FFmpeg", `Extracting frames at ${EXTRACT_FPS} FPS with high-quality OCR filter...`, {
      filter: ffmpegFilter,
      outputPattern: framesPattern,
      topStripOutputPattern: framesTopPattern,
      fps: EXTRACT_FPS,
      reason: "4 FPS = 250ms resolution — catches fast reloads that were invisible at 2 FPS",
      topStripReason: "Top 15% and Bottom 15% combined strip upscaled 4x to ensure razor-sharp address bar text capture on both desktop and mobile.",
    });

    const ffmpegStart = Date.now();
    // Run both extractions in parallel.
    await Promise.all([execAsync(ffmpegCmd), execAsync(ffmpegTopCmd)]);
    const ffmpegElapsed = Date.now() - ffmpegStart;

    const files = await fs.readdir(framesDir);
    const frameFiles    = files.filter((f) => f.startsWith("frame-") && f.endsWith(".jpg")).sort();
    const topFrameFiles = files.filter((f) => f.startsWith("top-")   && f.endsWith(".jpg")).sort();

    log("FFmpeg", `Frame extraction complete`, {
      elapsedMs: ffmpegElapsed,
      totalFrames: frameFiles.length,
      topStripFrames: topFrameFiles.length,
      estimatedVideoSeconds: videoDurationSeconds ?? "unknown",
    });

    if (frameFiles.length === 0) {
      logError("FFmpeg", "No frames were extracted — aborting. Video may be corrupt or empty.");
      throw new Error("No frames extracted from video.");
    }

    // ── Step 5: Initialise Tesseract ───────────────────────────────────────
    log("OCR", "Initialising Tesseract OCR worker (eng)...");
    const ocrInitStart = Date.now();
    const worker = await Tesseract.createWorker("eng");
    log("OCR", `Tesseract worker ready in ${Date.now() - ocrInitStart}ms.`);

    // ── Step 6: State Machine ──────────────────────────────────────────────
    const state = {
      codeFound: false,
      isReloading: false,
      hasReloaded: false,
      extractedBefore: { url: false, memberId: null as string | null, email: null as string | null },
      extractedAfter:  { url: false, memberId: null as string | null, email: null as string | null },
      maxTextLength: 0,
      //
      // Reload detection — dual-signal approach:
      //
      // Signal A: "member ID disappears" (primary)
      //   After we've established memberIdBefore, we track how many consecutive
      //   frames pass without seeing ANY member-ID-like value. If this reaches
      //   RELOAD_ABSENT_THRESHOLD we assume the page is mid-reload.
      //   This catches button clicks, CTRL+R, and any other reload method,
      //   even if the blank period was too short to land between sample points.
      //
      // Signal B: "blank frame" (secondary)
      //   Text drops to < 20% of the peak seen so far.
      //   Kept as an additional trigger for slower reloads.
      //
      consecutiveMissingMemberIdFrames: 0,
    };
    // Number of consecutive frames without member ID that triggers reload detection.
    // At 4 FPS, 2 frames = 500ms — long enough to exclude single-frame OCR misses.
    const RELOAD_ABSENT_THRESHOLD = 2;
    // Blank threshold: text < 20% of peak seen (was 35% — too strict, missed fast reloads)
    const BLANK_RATIO = 0.20;

    logSeparator(`ATTEMPT #${attemptId} — FRAME ANALYSIS (${frameFiles.length} frames)`);

    const ocrLoopStart = Date.now();

    for (let index = 0; index < frameFiles.length; index++) {
      const frame = frameFiles[index];
      const framePath = path.join(framesDir, frame);
      const frameNum = index + 1;

      const frameStart = Date.now();
      const { data: { text, confidence } } = await worker.recognize(framePath);

      // Also OCR the top-strip (address bar) frame if it exists.
      // This is what we use exclusively for URL detection — prevents page body
      // text (e.g. "new.uschess.org" in nav links) from falsely matching.
      const topFrameFile = topFrameFiles[index];
      let   topText      = "";
      if (topFrameFile) {
        const topFramePath = path.join(framesDir, topFrameFile);
        const { data: { text: tText } } = await worker.recognize(topFramePath);
        topText = tText;
      }

      const frameElapsed = Date.now() - frameStart;

      const textLength = text.replace(/\s+/g, "").length;
      // Signal B blank threshold: 20% of max seen (down from 35%)
      const blankThreshold = Math.max(50, state.maxTextLength * BLANK_RATIO);
      const isBlank = textLength < blankThreshold;
      if (textLength > state.maxTextLength) state.maxTextLength = textLength;

      // URL detection: use ONLY the top-strip OCR text (address bar region).
      // If the top strip is unavailable (extraction failed), fall back to full text but
      // apply hasNonLiveUrl as a disqualifier.
      // Primary check: try to find the URL in the address-bar top strip crop.
      let frameHasUrl = await isUscfDomain(topText);
      if (!frameHasUrl) {
        // Fallback: search full-frame text, but strictly reject if any non-live URL
        // (like file:/// or localhost) is visible anywhere on screen.
        frameHasUrl = (await isUscfDomain(text)) && !hasNonLiveUrl(text);
        if (frameHasUrl) {
          log(
            `Frame ${frameNum}/${frameFiles.length}`,
            `[URL-Fallback] URL not found in top-strip crop, but verified in full-frame text.`
          );
        }
      }
      let frameMemberId: string | null = null;
      let extractedEmail: string | null = null;

      if (frameHasUrl) {
        frameMemberId = extractMemberId(text);

        // Fallback: if the regex-based extraction missed the member ID but we
        // already know what it should be (from BEFORE_RELOAD), search for that
        // exact digit sequence directly in the raw OCR text. The post-reload
        // page may render the ID in a slightly different layout that the label-
        // anchored regex doesn't match, but the 7–8 digit number itself will
        // still be present somewhere in the text.
        if (!frameMemberId && state.extractedBefore.memberId) {
          const knownId = state.extractedBefore.memberId;
          // Collapse whitespace from text so "173 18177" becomes "17318177"
          const collapsed = text.replace(/\s+/g, "");
          if (collapsed.includes(knownId)) {
            frameMemberId = knownId;
            log(
              `Frame ${frameNum}/${frameFiles.length}`,
              `[MemberID-Fallback] Regex missed ID but digit string "${knownId}" found via direct text scan.`
            );
          }
        }

        // Extract any email visible on screen — no comparison against platform email.
        extractedEmail = extractAnyEmail(text);
      }

      const hasProfileInfo = frameMemberId !== null;

      // Challenge code check (only until found)
      let codeScanResult = "already found";
      let codeEditDistance: number | null = null;
      if (!state.codeFound) {
        const cleanText = text.toLowerCase().replace(/[^a-z0-9]/g, "");
        const cleanCode = challengeCode.toLowerCase().replace(/[^a-z0-9]/g, "");
        codeEditDistance = cleanText.length >= cleanCode.length
          ? getMinLevenshteinDistance(cleanText, cleanCode)
          : cleanCode.length;

        if (codeEditDistance <= 2) {
          state.codeFound = true;
          codeScanResult = `MATCHED (edit-distance=${codeEditDistance})`;
        } else {
          codeScanResult = `not found (best edit-distance=${codeEditDistance})`;
        }
      }

      // Determine current phase label
      const phase = state.hasReloaded   ? "AFTER_RELOAD"
                  : state.isReloading   ? "RELOADING"
                  : "BEFORE_RELOAD";

      log(
        `Frame ${frameNum}/${frameFiles.length}`,
        `[${phase}] OCR complete`,
        {
          file: frame,
          ocrMs: frameElapsed,
          ocrConfidence: `${confidence?.toFixed(1)}%`,
          textChars: textLength,
          isBlank,
          blankThreshold: blankThreshold.toFixed(0),
          maxTextSeen: state.maxTextLength,
          // Extractions
          urlFound: frameHasUrl,
          urlDetectionMethod: topText ? "top-strip-ocr" : "full-frame-fallback",
          topStripHasUscf: topText ? topText.toLowerCase().replace(/\s+/g, "").includes("new.uschess.org") : null,
          memberIdFound: frameMemberId ?? null,
          // Email: show what was found on screen (not the platform email)
          emailFound: extractedEmail !== null,
          emailExtractedFromScreen: extractedEmail ?? null,
          // Reload signals
          consecutiveMissingMemberIdFrames: state.consecutiveMissingMemberIdFrames,
          // Challenge code
          challengeCode: codeScanResult,
          // Raw strings (newlines formatted for single line logging)
          rawTopText: topText ? topText.replace(/\r?\n/g, "\\n") : null,
          rawFullText: text ? text.replace(/\r?\n/g, "\\n") : null,
        }
      );

      // ── State Machine Transitions ─────────────────────────────────────────
      if (!state.isReloading && !state.hasReloaded) {
        // ── BEFORE_RELOAD phase ───────────────────────────────────────────────
        let updates: string[] = [];
        if (frameHasUrl && !state.extractedBefore.url) {
          state.extractedBefore.url = true;
          updates.push("urlBefore=true");
        }
        if (frameMemberId && !state.extractedBefore.memberId) {
          state.extractedBefore.memberId = frameMemberId;
          updates.push(`memberIdBefore="${frameMemberId}"`);
        }
        if (extractedEmail && !state.extractedBefore.email) {
          state.extractedBefore.email = extractedEmail;
          updates.push(`emailBefore="${extractedEmail}"`);
        }
        if (updates.length > 0) {
          log(`Frame ${frameNum}/${frameFiles.length}`, `[BEFORE_RELOAD] State updated: ${updates.join(", ")}`);
        }

        // ── Reload detection: dual-signal ──────────────────────────────────
        // We only start watching for a reload once memberIdBefore is established.
        if (state.extractedBefore.memberId) {
          if (!hasProfileInfo) {
            // Member ID is gone from this frame — count it.
            state.consecutiveMissingMemberIdFrames++;
            log(
              `Frame ${frameNum}/${frameFiles.length}`,
              `[ReloadWatch] Member ID absent — consecutive missing frames: ${state.consecutiveMissingMemberIdFrames}/${RELOAD_ABSENT_THRESHOLD}`,
              { textLength, isBlank, blankThreshold: blankThreshold.toFixed(0) }
            );
          } else {
            // Member ID is still present — reset the consecutive counter.
            if (state.consecutiveMissingMemberIdFrames > 0) {
              log(
                `Frame ${frameNum}/${frameFiles.length}`,
                `[ReloadWatch] Member ID reappeared — resetting missing-frames counter (was ${state.consecutiveMissingMemberIdFrames}).`
              );
            }
            state.consecutiveMissingMemberIdFrames = 0;
          }

          // Signal A: member ID absent for RELOAD_ABSENT_THRESHOLD consecutive frames
          const signalA = state.consecutiveMissingMemberIdFrames >= RELOAD_ABSENT_THRESHOLD;
          // Signal B: text drops to less than BLANK_RATIO of peak
          const signalB = isBlank;

          if (signalA || signalB) {
            state.isReloading = true;
            state.consecutiveMissingMemberIdFrames = 0;
            log(
              `Frame ${frameNum}/${frameFiles.length}`,
              `🔄 TRANSITION → RELOADING detected`,
              {
                trigger: signalA && signalB ? "both-signals" : signalA ? "signal-A:member-id-disappeared" : "signal-B:blank-frame",
                memberIdBefore: state.extractedBefore.memberId,
                textLength,
                blankThreshold: blankThreshold.toFixed(0),
                consecutiveMissingMemberIdFrames: signalA ? RELOAD_ABSENT_THRESHOLD : state.consecutiveMissingMemberIdFrames,
              }
            );
          }
        }

      } else if (state.isReloading && !state.hasReloaded) {
        // ── RELOADING phase — wait for page to not be blank ──────────────────
        if (!isBlank) {
          state.hasReloaded = true;
          state.isReloading = false;
          state.consecutiveMissingMemberIdFrames = 0;
          log(`Frame ${frameNum}/${frameFiles.length}`, "✅ TRANSITION → AFTER_RELOAD detected (page is not blank)", {
            textLength,
          });
          
          // Apply extractions immediately to this first non-blank frame
          if (frameHasUrl && !state.extractedAfter.url) state.extractedAfter.url = true;
          if (frameMemberId && !state.extractedAfter.memberId) state.extractedAfter.memberId = frameMemberId;
          if (extractedEmail && !state.extractedAfter.email) state.extractedAfter.email = extractedEmail;
        } else {
          log(`Frame ${frameNum}/${frameFiles.length}`, `[RELOADING] Waiting for page to load (currently blank)...`, {
            textLength,
            isBlank,
          });
        }
      }

      if (state.hasReloaded) {
        // AFTER_RELOAD phase
        let afterUpdates: string[] = [];
        if (frameHasUrl && !state.extractedAfter.url) {
          state.extractedAfter.url = true;
          afterUpdates.push("urlAfter=true");
        }
        if (frameMemberId && !state.extractedAfter.memberId) {
          state.extractedAfter.memberId = frameMemberId;
          afterUpdates.push(`memberIdAfter="${frameMemberId}"`);
        }
        if (extractedEmail && !state.extractedAfter.email) {
          state.extractedAfter.email = extractedEmail;
          afterUpdates.push(`emailAfter="${extractedEmail}"`);
        }
        if (afterUpdates.length > 0) {
          log(`Frame ${frameNum}/${frameFiles.length}`, `[AFTER_RELOAD] State updated: ${afterUpdates.join(", ")}`);
        }
      }

      // ── Live DB Update ────────────────────────────────────────────────────
      const currentMemberId = state.hasReloaded ? state.extractedAfter.memberId : state.extractedBefore.memberId;
      const currentEmail    = state.hasReloaded ? state.extractedAfter.email    : state.extractedBefore.email;

      await db.update(uscfVerificationAttempts)
        .set({
          codeFound:      state.codeFound,
          uscfUrlFound:   state.extractedBefore.url && state.extractedAfter.url,
          urlBeforeReload: state.extractedBefore.url,
          memberIdBefore:  state.extractedBefore.memberId || null,
          emailBefore:     state.extractedBefore.email || null,
          reloadDetected:  state.hasReloaded,
          urlAfterReload:  state.extractedAfter.url,
          memberIdAfter:   state.extractedAfter.memberId || null,
          emailAfter:      state.extractedAfter.email || null,
          memberIdExtracted: currentMemberId || null,
          emailExtracted:    currentEmail || null,
        })
        .where(eq(uscfVerificationAttempts.id, attemptId));

      // ── Early Exit ────────────────────────────────────────────────────────
      if (
        state.codeFound &&
        state.hasReloaded &&
        state.extractedAfter.url &&
        state.extractedAfter.memberId &&
        state.extractedAfter.email &&
        state.extractedBefore.memberId === state.extractedAfter.memberId &&
        state.extractedBefore.email === state.extractedAfter.email
      ) {
        log(
          `Frame ${frameNum}/${frameFiles.length}`,
          `🏁 All verification constraints satisfied — exiting frame loop early (${frameFiles.length - frameNum} frames remaining).`
        );
        break;
      }
    }

    const ocrLoopElapsed = Date.now() - ocrLoopStart;

    // ── Step 7: OCR Complete — Print Full State Summary ────────────────────
    logSeparator(`ATTEMPT #${attemptId} — OCR COMPLETE (${ocrLoopElapsed}ms)`);
    log("Summary", "Final state machine snapshot", {
      codeFound:         state.codeFound,
      reloadDetected:    state.hasReloaded,
      // Before reload
      urlBeforeReload:   state.extractedBefore.url,
      memberIdBefore:    state.extractedBefore.memberId,
      emailBefore:       state.extractedBefore.email,
      // After reload
      urlAfterReload:    state.extractedAfter.url,
      memberIdAfter:     state.extractedAfter.memberId,
      emailAfter:        state.extractedAfter.email,
      // Continuity
      memberIdMatch: state.extractedBefore.memberId === state.extractedAfter.memberId,
      emailMatch:    state.extractedBefore.email    === state.extractedAfter.email,
    });

    await worker.terminate();
    log("Cleanup", "Tesseract worker terminated.");

    await fs.rm(framesDir, { recursive: true, force: true });
    log("Cleanup", `Frames directory deleted: ${framesDir}`);

    await fs.rm(videoPath, { force: true });
    log("Cleanup", `Video file deleted: ${videoPath}`);

    // ── Step 8: Continuity Validation ─────────────────────────────────────
    logSeparator(`ATTEMPT #${attemptId} — VALIDATION`);

    const memberIdMatch =
      state.extractedBefore.memberId &&
      state.extractedAfter.memberId &&
      state.extractedBefore.memberId === state.extractedAfter.memberId;

    const emailMatch =
      state.extractedBefore.email &&
      state.extractedAfter.email &&
      state.extractedBefore.email === state.extractedAfter.email;

    let confidenceScore = 0;
    if (state.codeFound)             { confidenceScore += 20; log("Validation", "✅ +20 — Challenge code found"); }
    else                             { log("Validation", "❌   0 — Challenge code NOT found"); }

    if (state.extractedBefore.url)   { confidenceScore += 10; log("Validation", "✅ +10 — USCF URL found before reload"); }
    else                             { log("Validation", "❌   0 — USCF URL NOT found before reload"); }

    if (state.extractedAfter.url)    { confidenceScore += 10; log("Validation", "✅ +10 — USCF URL found after reload"); }
    else                             { log("Validation", "❌   0 — USCF URL NOT found after reload"); }

    if (state.hasReloaded)           { confidenceScore += 20; log("Validation", "✅ +20 — Page reload detected"); }
    else                             { log("Validation", "❌   0 — Page reload NOT detected"); }

    if (memberIdMatch)               { confidenceScore += 20; log("Validation", `✅ +20 — Member ID matches before & after (${state.extractedBefore.memberId})`); }
    else {
      log("Validation", "❌   0 — Member ID mismatch or missing", {
        before: state.extractedBefore.memberId,
        after:  state.extractedAfter.memberId,
      });
    }

    if (emailMatch) { confidenceScore += 20; log("Validation", `✅ +20 — Email visible and consistent before & after (${state.extractedBefore.email})`); }
    else {
      log("Validation", "❌   0 — Email missing or inconsistent", {
        // Note: we do NOT compare against targetEmail (the platform email).
        // Both values must simply be non-null and equal to each other.
        emailBefore: state.extractedBefore.email,
        emailAfter:  state.extractedAfter.email,
        note: "Email extraction is independent of the platform registration email.",
      });
    }

    log("Validation", `Total confidence score: ${confidenceScore}/100`);

    // ── Step 9: Determine Failure Reason ──────────────────────────────────
    let failureReason: string | null = null;

    // IMPORTANT: The failure cascade must follow the SAME chronological order as
    // the 10-step UI. Steps 1–4 are BEFORE reload; step 5 IS the reload;
    // steps 6–9 are AFTER reload. Email (steps 4 & 8) must not fire before
    // the reload step (step 5) even though it is logically earlier, because
    // the reload is what gates whether the email could ever be seen post-reload.
    // Crucially, email check (step 4) must only fail if steps 1–3 passed AND
    // the reload also failed — the email and reload failures are independent.
    // We resolve the ordering precisely: if reload failed, that is the
    // primary reason even if email was also not found.
    if (!state.codeFound) {
      failureReason = "Challenge code was not found in the video. Please make sure to record our website displaying the code at the start of your recording.";
      log("Validation", `FAIL — Step 1 (challenge code): ${failureReason}`);
    } else if (!state.extractedBefore.url) {
      failureReason = "The address bar showing 'new.uschess.org/user/<id>' (e.g. new.uschess.org/user/290819) was not visible before the page reload. Navigate to your logged-in user page, and share your Entire Screen (not just a tab) so the address bar is captured.";
      log("Validation", `FAIL — Step 2 (URL before reload): ${failureReason}`);
    } else if (!state.extractedBefore.memberId) {
      failureReason = "Member ID could not be read before the page refresh. Make sure your USCF dashboard is fully loaded with your Member ID clearly visible before you hit reload.";
      log("Validation", `FAIL — Step 3 (member ID before reload): ${failureReason}`);
    } else if (!state.extractedBefore.email) {
      failureReason = "Email address could not be read before the page refresh. Ensure your email is fully visible on the USCF dashboard. If it's hidden in a dropdown menu, make sure you click your name to open the dropdown so the email is clearly readable.";
      log("Validation", `FAIL — Step 4 (email not found before reload): ${failureReason}`);
    } else if (!state.hasReloaded) {
      if (state.isReloading) {
        failureReason = "Page refresh was detected, but the video ended before the page finished reloading. Please ensure you keep recording until your profile fully loads after the refresh.";
      } else {
        failureReason = "Page refresh was not detected. You must click the browser reload button (↺) while recording — this proves the session is live and not a screenshot or recording replay.";
      }
      log("Validation", `FAIL — Step 5 (page reload not detected): ${failureReason}`);
    } else if (!state.extractedAfter.url) {
      failureReason = "The address bar showing 'new.uschess.org/user/<id>' (e.g. new.uschess.org/user/290819) was not visible after the page reload. Share your Entire Screen so the address bar is captured after the page reloads.";
      log("Validation", `FAIL — Step 6 (URL after reload): ${failureReason}`);
    } else if (!state.extractedAfter.memberId) {
      failureReason = "Member ID could not be read after the page refresh. Make sure your Member ID is clearly visible after the page finishes loading. If it's in a dropdown, you must open the dropdown after reloading so it can be verified.";
      log("Validation", `FAIL — Step 7 (member ID after reload): ${failureReason}`);
    } else if (!state.extractedAfter.email) {
      failureReason = "No email address was visible on the USCF dashboard after the page refresh. Make sure your account email is shown on the page after the refresh. If it's in a dropdown, you must open the dropdown after reloading so it can be verified.";
      log("Validation", `FAIL — Step 8 (email not found after reload): ${failureReason}`);
    } else if (!memberIdMatch || !emailMatch) {
      failureReason = "The Member ID or email address visible on the USCF dashboard changed between before and after the page refresh. The same account must appear throughout the recording.";
      log("Validation", `FAIL — Step 9 (continuity mismatch)`, {
        memberIdBefore: state.extractedBefore.memberId,
        memberIdAfter:  state.extractedAfter.memberId,
        emailBefore:    state.extractedBefore.email,
        emailAfter:     state.extractedAfter.email,
      });
    }

    let isApproved = confidenceScore === 100 && !failureReason;
    let ratingsData = null;
    let thinPhpSuccess = false;
    const finalMemberId = state.extractedAfter.memberId;

    // ── Step 10: Fetch USCF Ratings (thin.php) ────────────────────────────
    if (isApproved && finalMemberId) {
      logSeparator(`ATTEMPT #${attemptId} — USCF PROFILE FETCH`);
      log("ThinPHP", `Video OCR passed. Fetching USCF profile for Member ID: ${finalMemberId}...`, {
        url: `https://www.uschess.org/msa/thin.php?${finalMemberId}`,
      });

      try {
        const fetchStart = Date.now();
        const response = await fetch(`https://www.uschess.org/msa/thin.php?${finalMemberId}`, {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          },
        });

        log("ThinPHP", `HTTP response received in ${Date.now() - fetchStart}ms`, {
          status: response.status,
          ok: response.ok,
        });

        if (!response.ok) {
          throw new Error(`USCF server returned HTTP ${response.status}`);
        }

        const html = await response.text();
        log("ThinPHP", `Response body received`, { bytes: html.length });

        const $ = load(html);
        const name         = $("input[name='memname']").val() as string;
        const regRatingStr = $("input[name='rating1']").val() as string;
        const quickRatingStr = $("input[name='rating2']").val() as string;
        const blitzRatingStr = $("input[name='rating3']").val() as string;
        const stateStr     = $("input[name='state_country']").val() as string;
        const fideIdStr    = $("input[name='memfideid']").val() as string;
        const expiry       = $("input[name='memexpdt']").val() as string;

        log("ThinPHP", "Parsed fields from thin.php HTML", {
          name, regRatingStr, quickRatingStr, blitzRatingStr,
          state: stateStr, fideId: fideIdStr, expiry,
        });

        if (!name || name.trim().length === 0) {
          throw new Error("Member name field was empty — invalid Member ID or USCF database block.");
        }

        const parseRating = (r: string) => {
          if (!r || r === "Unrated") return null;
          const match = r.match(/\d+/);
          return match ? parseInt(match[0], 10) : null;
        };

        ratingsData = {
          name: name.trim(),
          ratingRegular: parseRating(regRatingStr),
          ratingQuick:   parseRating(quickRatingStr),
          ratingBlitz:   parseRating(blitzRatingStr),
          state: stateStr || "",
          expiry: expiry || "",
          fideId: fideIdStr ? fideIdStr.split(" - ")[0] : "",
        };

        thinPhpSuccess = true;
        log("ThinPHP", `✅ Profile fetched successfully`, {
          name: ratingsData.name,
          ratingRegular: ratingsData.ratingRegular,
          ratingQuick:   ratingsData.ratingQuick,
          ratingBlitz:   ratingsData.ratingBlitz,
          state: ratingsData.state,
          expiry: ratingsData.expiry,
          fideId: ratingsData.fideId,
        });

      } catch (fetchErr) {
        logError("ThinPHP", "thin.php fetch failed — attempting local SQLite ratings fallback.", fetchErr);

        try {
          log("LocalRatings", `Looking up Member ID ${finalMemberId} in local SQLite cache...`);
          const { getLocalUSCFPlayerById } = await import("./localRatings");
          const localPlayer = await getLocalUSCFPlayerById(finalMemberId);

          if (localPlayer) {
            log("LocalRatings", `✅ Found in local cache: ${localPlayer.name}`, {
              name: localPlayer.name,
              rating: localPlayer.rating?.value,
              quickRating: localPlayer.quickRating?.value,
              blitzRating: localPlayer.blitzRating?.value,
              location: localPlayer.location,
              expiry: localPlayer.metadata?.expiration,
            });
            ratingsData = {
              name: localPlayer.name,
              ratingRegular: localPlayer.rating?.value ? parseInt(localPlayer.rating.value, 10) : null,
              ratingQuick:   localPlayer.quickRating?.value ? parseInt(localPlayer.quickRating.value, 10) : null,
              ratingBlitz:   localPlayer.blitzRating?.value ? parseInt(localPlayer.blitzRating.value, 10) : null,
              state:  localPlayer.location || "",
              expiry: localPlayer.metadata?.expiration || "",
              fideId: "",
            };
            thinPhpSuccess = true;
          } else {
            throw new Error(`Member ID ${finalMemberId} not found in local SQLite database.`);
          }
        } catch (localErr) {
          logError("LocalRatings", "Local ratings fallback also failed. Rejecting attempt.", localErr);
          isApproved = false;
          failureReason =
            "Your video was verified, but we encountered a connection error retrieving your official ratings from the USCF server and could not locate your ID in our local offline ratings database. Please try again in a few minutes.";
        }
      }
    } else if (!isApproved) {
      log("ThinPHP", "Skipping USCF profile fetch — video verification failed.");
    }

    // ── Step 11: Final DB Write ────────────────────────────────────────────
    const finalStatus = isApproved && thinPhpSuccess ? "approved" : "rejected";

    logSeparator(`ATTEMPT #${attemptId} — OUTCOME: ${finalStatus.toUpperCase()}`);
    log("Outcome", "Writing final result to database", {
      finalStatus,
      confidenceScore: finalStatus === "approved" ? 100 : confidenceScore,
      failureReason,
      memberIdExtracted: finalMemberId,
      totalElapsedMs: Date.now() - analysisStartTime,
    });

    await db.update(uscfVerificationAttempts)
      .set({
        confidenceScore:  finalStatus === "approved" ? 100 : confidenceScore,
        codeFound:        state.codeFound,
        uscfUrlFound:     state.extractedBefore.url && state.extractedAfter.url,
        urlBeforeReload:  state.extractedBefore.url,
        memberIdBefore:   state.extractedBefore.memberId || null,
        emailBefore:      state.extractedBefore.email || null,
        reloadDetected:   state.hasReloaded,
        urlAfterReload:   state.extractedAfter.url,
        memberIdAfter:    state.extractedAfter.memberId || null,
        emailAfter:       state.extractedAfter.email || null,
        detailsMatch:     !!(memberIdMatch && emailMatch),
        memberIdExtracted: finalMemberId || null,
        emailExtracted:   state.extractedAfter.email || null,
        orderingCorrect:  state.hasReloaded,
        status:           finalStatus,
        failureReason,
        completedAt:      new Date(),
      })
      .where(eq(uscfVerificationAttempts.id, attemptId));

    log("Outcome", "✅ Attempt record updated in DB.");

    // ── Step 12: Update User Profile (if approved) ────────────────────────
    if (finalStatus === "approved" && ratingsData && finalMemberId) {
      log("UserUpdate", `Updating user ${userId} profile with verified USCF data...`, {
        name: ratingsData.name,
        uscfId: finalMemberId,
      });

      await db.update(users)
        .set({
          uscfVerificationStatus: "verified",
          uscfVerifiedAt:         new Date(),
          uscfId:                 finalMemberId,
          uscfName:               ratingsData.name,
          uscfRatingRegular:      ratingsData.ratingRegular,
          uscfRatingQuick:        ratingsData.ratingQuick,
          uscfRatingBlitz:        ratingsData.ratingBlitz,
          uscfState:              ratingsData.state,
          uscfMemberExpiry:       ratingsData.expiry,
          uscfFideId:             ratingsData.fideId,
          uscfThinPhpLastFetched: new Date(),
        })
        .where(eq(users.id, userId));

      log("UserUpdate", `✅ User profile updated for ${ratingsData.name} (${finalMemberId})`);
    }

    logSeparator(`ATTEMPT #${attemptId} — ANALYSIS DONE (total: ${Date.now() - analysisStartTime}ms)`);

  } catch (err) {
    const totalElapsed = Date.now() - analysisStartTime;
    logError("Fatal", `Unhandled exception during analysis — marking attempt as rejected (after ${totalElapsed}ms)`, err);

    await db.update(uscfVerificationAttempts)
      .set({
        status:        "rejected",
        failureReason: "An internal error occurred during video analysis.",
        completedAt:   new Date(),
      })
      .where(eq(uscfVerificationAttempts.id, attemptId));

    log("Fatal", "Attempt record marked as rejected in DB.");
  }
}

// ─── Levenshtein Helpers ─────────────────────────────────────────────────────

function levenshteinDistance(a: string, b: string): number {
  const matrix = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));

  for (let i = 0; i <= a.length; i++) matrix[i][0] = i;
  for (let j = 0; j <= b.length; j++) matrix[0][j] = j;

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,       // deletion
        matrix[i][j - 1] + 1,       // insertion
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
