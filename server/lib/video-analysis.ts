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

// ─── Bot Mitigation Config and Helpers ──────────────────────────────────────

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2.1 Safari/605.1.15",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0"
];

function getRandomUserAgent() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

async function fetchWithBotMitigation(url: string, retries = 3, initialDelay = 1000): Promise<Response> {
  let delay = initialDelay;
  const userAgent = getRandomUserAgent();
  const headers = {
    "User-Agent": userAgent,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    "Connection": "keep-alive",
    "Upgrade-Insecure-Requests": "1",
    "Sec-Ch-Ua": '"Not A(Brand";v="99", "Google Chrome";v="121", "Chromium";v="121"',
    "Sec-Ch-Ua-Mobile": "?0",
    "Sec-Ch-Ua-Platform": '"Windows"',
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
    "Cache-Control": "max-age=0"
  };

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const jitter = Math.random() * 500;
      await new Promise(resolve => setTimeout(resolve, delay + jitter));

      const response = await fetch(url, { headers, method: "GET" });
      if (response.ok) {
        return response;
      }
      if (response.status === 429 || (response.status >= 500 && response.status < 600)) {
        console.warn(`Fetch returned ${response.status}. Retrying (attempt ${attempt}/${retries})...`);
      } else {
        return response;
      }
    } catch (error) {
      console.warn(`Fetch error: ${error instanceof Error ? error.message : error}. Retrying (attempt ${attempt}/${retries})...`);
    }
    delay *= 2;
  }
  throw new Error(`Failed to fetch ${url} after ${retries} attempts.`);
}

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

// Reject non-live schemes that indicate a screenshot or local file.
const REJECTED_SCHEMES = [
  "file:///", "file://", "localhost", "127.0.0.1", "chrome-extension://", 
  "data:", "blob:", "c:/", "d:/", "filec:", "filed:", "users/"
];

// Screen sharing banners (Chrome, Edge, Firefox) float at the bottom of the screen
// and contain localhost:5010 in local dev mode. We must discard these lines to
// avoid false-positives/rejections in development.
const BANNER_REGEX = /(?:sharing|shari|stop\s*shari|hide|hlde|1ssharing)/i;

/**
 * Checks whether the given OCR text (from the address-bar strip of a frame)
 * shows ANY new.uschess.org domain page (e.g., the dashboard).
 *
 * SECURITY: We also check that no non-live URL scheme appears in the same strip.
 * This prevents screenshots (file:///...) or localhost pages from passing.
 */
export async function isUscfBaseDomain(addressBarText: string): Promise<boolean> {
  const lines = addressBarText.split(/\r?\n/);
  let hasValidDomain = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Discard lines that contain screen sharing banner elements
    if (BANNER_REGEX.test(trimmed)) {
      continue;
    }

    const clean = trimmed.toLowerCase().replace(/\s+/g, "");

    // Check for rejected schemes on the remaining active lines
    for (const scheme of REJECTED_SCHEMES) {
      if (clean.includes(scheme.replace(/\s/g, ""))) return false;
    }

    // Check for the base domain specifically
    const targetUrl = "newuschessorg";
    const cleanForEditDistance = clean.replace(/[^a-z0-9]/g, "");
    const minDistance = getMinLevenshteinDistance(cleanForEditDistance, targetUrl);
    if (minDistance <= 2) {
      hasValidDomain = true;
    }
  }

  return hasValidDomain;
}

/**
 * Checks whether the given OCR text strictly shows the user profile URL (new.uschess.org/user/...).
 */
export async function isUscfProfileUrl(addressBarText: string): Promise<boolean> {
  const lines = addressBarText.split(/\r?\n/);
  let hasValidDomain = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Discard lines that contain screen sharing banner elements
    if (BANNER_REGEX.test(trimmed)) {
      continue;
    }

    const clean = trimmed.toLowerCase().replace(/\s+/g, "");

    // Check for rejected schemes on the remaining active lines
    for (const scheme of REJECTED_SCHEMES) {
      if (clean.includes(scheme.replace(/\s/g, ""))) return false;
    }

    const targetUrl = "newuschessorguser";
    const cleanForEditDistance = clean.replace(/[^a-z0-9]/g, "");
    const minDistance = getMinLevenshteinDistance(cleanForEditDistance, targetUrl);
    
    // Ensure it's not a false positive on just the base domain by checking length
    if (cleanForEditDistance.length < 14) continue;
    
    if (minDistance <= 3) {
      hasValidDomain = true;
    }
  }

  return hasValidDomain;
}

/**
 * Returns true if the full-frame OCR text contains a disqualifying non-live URL.
 * Used as an additional cross-check on the full frame text.
 */
export function hasNonLiveUrl(text: string): boolean {
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (BANNER_REGEX.test(trimmed)) continue; // ignore sharing banner
    
    const clean = trimmed.toLowerCase().replace(/\s+/g, "");
    for (const scheme of REJECTED_SCHEMES) {
      if (clean.includes(scheme.replace(/\s/g, ""))) return true;
    }
  }
  return false;
}

export function extractMemberId(text: string): string | null {
  // Relaxed regex to account for OCR noise (e.g., "Member 0:", "ID:", "MembIer lD:")
  // We look for 'member' or 'id', followed by up to 15 characters of noise, followed by 6-8 digits.
  const regex = /(?:member|id\b).{0,15}?(\d{6,8})\b/i;
  
  // 1. Line-by-line search
  const lines = text.split(/\r?\n/);
  for (let line of lines) {
    const match = line.match(regex);
    if (match) return match[1];
  }

  // 2. Global search on collapsed text
  const collapsed = text.replace(/[\r\n]+/g, " ");
  const globalMatch = collapsed.match(regex);
  if (globalMatch) return globalMatch[1];

  return null;
}

/**
 * Extracts any email address found in the OCR text.
 * 
 * Important design decision: we do NOT compare against the user's platform email.
 * The USCF dashboard will show whatever email is linked to the user's USCF account,
 * which may differ from their Chess Tournament Manager registration email.
 * We extract this email address to verify that a valid email was found on the profile page.
 *
 * OCR can introduce spaces inside tokens, so we collapse whitespace per-line
 * and also try on the fully collapsed text as a fallback.
 */
export function extractAnyEmail(text: string): string | null {
  // Regex: relaxed email pattern to handle OCR noise like apostrophes in domain (e.g. gma'l.com)
  const emailRegex = /[a-z0-9._%+\-]+@[^\s@]+?\.[a-z]{2,6}\b/i;

  const normalizedText = text.replace(/[’‘]/g, "'");
  const lines = normalizedText.split(/\r?\n/);

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
  const collapsed = normalizedText.replace(/\s+/g, "").toLowerCase();
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

  let framesDir: string | undefined;

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
    framesDir = path.join(process.cwd(), "uploads", "frames", attemptId.toString());
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
    // 4 FPS gives us 250ms resolution. This is fast enough to catch
    // transient address bar states during the navigation flow.
    const EXTRACT_FPS = 4;
    const ffmpegFilter = "format=gray,eq=contrast=1.5:brightness=-0.05";
    const ffmpegCmd    = `"${ffmpegPath}" -i "${videoPath}" -t 60 -vf "${ffmpegFilter}" -r ${EXTRACT_FPS} -q:v 2 "${framesPattern}"`;

    // Address-bar strip: Crop the top 15% AND the bottom 15% of the frame (catches mobile bottom address bars),
    // stack them vertically, and upscale the combined strip 4x using Lanczos filter for razor-sharp text.
    // Apply high contrast and unsharp mask to create a perfect OCR-ready image that prevents typos.
    const ffmpegTopFilter = "[0:v]crop=iw:ih*0.15:0:0[top];[0:v]crop=iw:ih*0.15:0:ih*0.85[bottom];[top][bottom]vstack,scale=iw*4:ih*4:flags=lanczos,unsharp=5:5:1.0:5:5:0.0,format=gray,eq=contrast=2.0:brightness=-0.05";
    const ffmpegTopCmd    = `"${ffmpegPath}" -i "${videoPath}" -t 60 -filter_complex "${ffmpegTopFilter}" -r ${EXTRACT_FPS} -q:v 1 "${framesTopPattern}"`;

    log("FFmpeg", `Extracting frames at ${EXTRACT_FPS} FPS with high-quality OCR filter...`, {
      filter: ffmpegFilter,
      outputPattern: framesPattern,
      topStripOutputPattern: framesTopPattern,
      fps: EXTRACT_FPS,
      reason: "4 FPS = 250ms resolution — captures fast navigation transitions",
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
      hasStartedOffProfile: false,
      hasNavigatedToProfile: false,
      extracted: { url: false, memberId: null as string | null, email: null as string | null },
    };

    logSeparator(`ATTEMPT #${attemptId} — FRAME ANALYSIS (${frameFiles.length} frames)`);

    const ocrLoopStart = Date.now();

    for (let index = 0; index < frameFiles.length; index++) {
      const frame = frameFiles[index];
      const framePath = path.join(framesDir, frame);
      const frameNum = index + 1;

      const frameStart = Date.now();
      const { data: { text, confidence } } = await worker.recognize(framePath);

      // Also OCR the top-strip (address bar) frame if it exists.
      const topFrameFile = topFrameFiles[index];
      let   topText      = "";
      if (topFrameFile) {
        const topFramePath = path.join(framesDir, topFrameFile);
        const { data: { text: tText } } = await worker.recognize(topFramePath);
        topText = tText;
      }

      const frameElapsed = Date.now() - frameStart;

      // Primary check: strictly find the URLs in the address-bar top strip crop.
      // We do NOT fall back to checking the full frame text because that would allow
      // fullscreen screenshots or arbitrary text on the page to spoof the address bar.
      let frameHasBaseDomain = await isUscfBaseDomain(topText);
      let frameHasProfileUrl = await isUscfProfileUrl(topText);

      let frameMemberId: string | null = null;
      let extractedEmail: string | null = null;

      // Only attempt to extract sensitive data if they are on the profile page
      if (frameHasProfileUrl) {
        frameMemberId = extractMemberId(text);
        
        // Fallback: if the regex-based extraction missed the member ID but we
        // already know what it should be (from a previous frame), search for that
        // exact digit sequence directly in the raw OCR text.
        if (!frameMemberId && state.extracted.memberId) {
          const knownId = state.extracted.memberId;
          const collapsed = text.replace(/\s+/g, "");
          if (collapsed.includes(knownId)) {
            frameMemberId = knownId;
          }
        }

        extractedEmail = extractAnyEmail(text);
      }

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
      const phase = state.hasNavigatedToProfile ? "PROFILE_LOADED"
                  : state.hasStartedOffProfile  ? "NAVIGATING"
                  : "START";

      log(
        `Frame ${frameNum}/${frameFiles.length}`,
        `[${phase}] OCR complete`,
        {
          file: frame,
          ocrMs: frameElapsed,
          ocrConfidence: `${confidence?.toFixed(1)}%`,
          urlFound: frameHasProfileUrl ? "Profile" : frameHasBaseDomain ? "Base" : "None",
          memberIdFound: frameMemberId ?? null,
          emailFound: extractedEmail !== null,
          challengeCode: codeScanResult,
          rawTopText: topText.trim().replace(/\r?\n/g, " | "),
        }
      );

      // ── State Machine Transitions ─────────────────────────────────────────
      if (!state.hasStartedOffProfile) {
        // We are waiting for the user to be on a base USCF page (NOT the profile page)
        // This ensures they didn't just start the recording already on the profile page
        // (which would allow Inspect Element spoofing).
        if (frameHasBaseDomain && !frameHasProfileUrl) {
          state.hasStartedOffProfile = true;
          log(`Frame ${frameNum}/${frameFiles.length}`, `✅ TRANSITION → Started Off-Profile (on base domain)`);
        }
      } else if (!state.hasNavigatedToProfile) {
        // We are waiting for the user to navigate TO the profile page
        if (frameHasProfileUrl) {
          state.hasNavigatedToProfile = true;
          state.extracted.url = true;
          log(`Frame ${frameNum}/${frameFiles.length}`, `✅ TRANSITION → Navigated to Profile URL detected`);
          
          if (frameMemberId) state.extracted.memberId = frameMemberId;
          if (extractedEmail) state.extracted.email = extractedEmail;
        }
      } else {
        // We are ON the profile page. Extract data.
        if (frameMemberId && !state.extracted.memberId) {
          state.extracted.memberId = frameMemberId;
        }
        if (extractedEmail && !state.extracted.email) {
          state.extracted.email = extractedEmail;
        }
      }

      // ── Live DB Update ────────────────────────────────────────────────────
      await db.update(uscfVerificationAttempts)
        .set({
          codeFound: state.codeFound,
          uscfUrlFound: state.extracted.url,
          startedOffProfile: state.hasStartedOffProfile,
          navigatedToProfile: state.hasNavigatedToProfile,
          memberIdExtracted: state.extracted.memberId || null,
          emailExtracted: state.extracted.email || null,
        })
        .where(eq(uscfVerificationAttempts.id, attemptId));

      // ── Early Exit ────────────────────────────────────────────────────────
      if (
        state.codeFound &&
        state.hasStartedOffProfile &&
        state.hasNavigatedToProfile &&
        state.extracted.url &&
        state.extracted.memberId &&
        state.extracted.email
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
      codeFound:            state.codeFound,
      startedOffProfile:    state.hasStartedOffProfile,
      navigatedToProfile:   state.hasNavigatedToProfile,
      urlExtracted:         state.extracted.url,
      memberIdExtracted:    state.extracted.memberId,
      emailExtracted:       state.extracted.email,
    });

    await worker.terminate();
    log("Cleanup", "Tesseract worker terminated.");

    // ── Step 8: Continuity Validation ─────────────────────────────────────
    logSeparator(`ATTEMPT #${attemptId} — VALIDATION`);

    let confidenceScore = 0;
    if (state.codeFound)             { confidenceScore += 20; log("Validation", "✅ +20 — Challenge code found"); }
    else                             { log("Validation", "❌   0 — Challenge code NOT found"); }

    if (state.hasStartedOffProfile)  { confidenceScore += 20; log("Validation", "✅ +20 — Video started off-profile (proven fresh DOM)"); }
    else                             { log("Validation", "❌   0 — Video did not start on non-profile USCF page"); }

    if (state.hasNavigatedToProfile) { confidenceScore += 20; log("Validation", "✅ +20 — Profile navigation transition detected"); }
    else                             { log("Validation", "❌   0 — Did not navigate to profile URL"); }

    if (state.extracted.url)         { confidenceScore += 10; log("Validation", "✅ +10 — Profile URL verified"); }
    else                             { log("Validation", "❌   0 — Profile URL NOT verified"); }

    if (state.extracted.memberId)    { confidenceScore += 15; log("Validation", `✅ +15 — Member ID extracted (${state.extracted.memberId})`); }
    else                             { log("Validation", "❌   0 — Member ID missing"); }

    if (state.extracted.email)       { confidenceScore += 15; log("Validation", `✅ +15 — Email extracted (${state.extracted.email})`); }
    else                             { log("Validation", "❌   0 — Email missing"); }

    const isSuccess =
      state.codeFound &&
      state.hasStartedOffProfile &&
      state.hasNavigatedToProfile &&
      state.extracted.memberId &&
      state.extracted.email;

    let failureReason = null;
    if (!state.codeFound) {
      failureReason = "Challenge code was not found in the video. Please make sure to record our website displaying the code at the start of your recording.";
      log("Validation", `FAIL — Step 1 (challenge code): ${failureReason}`);
    } else if (!state.hasStartedOffProfile) {
      failureReason = "Video did not start on a non-profile USCF page (e.g. Dashboard). You must navigate TO your profile during the recording so we can verify the profile loads fresh.";
      log("Validation", `FAIL — Step 2 (started off profile): ${failureReason}`);
    } else if (!state.hasNavigatedToProfile) {
      failureReason = "Navigation to the user profile URL (new.uschess.org/user/...) was not detected.";
      log("Validation", `FAIL — Step 3 (navigated to profile): ${failureReason}`);
    } else if (!state.extracted.url) {
      failureReason = "The profile address bar was not clearly visible. Share your Entire Screen so the URL is captured.";
      log("Validation", `FAIL — Step 4 (profile url): ${failureReason}`);
    } else if (!state.extracted.memberId) {
      failureReason = "Member ID could not be clearly read from the profile page. Make sure it is fully visible.";
      log("Validation", `FAIL — Step 5 (member id): ${failureReason}`);
    } else if (!state.extracted.email) {
      failureReason = "Email address could not be clearly read from the profile page. Ensure your email is fully visible on the USCF dashboard.";
      log("Validation", `FAIL — Step 6 (email): ${failureReason}`);
    }

    let isApproved = confidenceScore === 100 && !failureReason;
    let ratingsData = null;
    let thinPhpSuccess = false;
    const finalMemberId = state.extracted.memberId;

    // ── Step 10: Fetch USCF Ratings (thin.php) ────────────────────────────
    if (isApproved && finalMemberId) {
      logSeparator(`ATTEMPT #${attemptId} — USCF PROFILE FETCH`);
      log("ThinPHP", `Video OCR passed. Fetching USCF profile for Member ID: ${finalMemberId}...`, {
        url: `https://www.uschess.org/msa/thin.php?${finalMemberId}`,
      });

      try {
        const fetchStart = Date.now();
        const response = await fetchWithBotMitigation(`https://www.uschess.org/msa/thin.php?${finalMemberId}`);

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
        uscfUrlFound:     state.extracted.url,
        startedOffProfile: state.hasStartedOffProfile,
        navigatedToProfile: state.hasNavigatedToProfile,
        memberIdExtracted: finalMemberId || null,
        emailExtracted:   state.extracted.email || null,
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
  } finally {
    // ── Cleanup (Always run) ────────────────────────────────────────────────
    try {
      if (typeof framesDir !== 'undefined') {
        await fs.rm(framesDir, { recursive: true, force: true }).catch(() => {});
        log("Cleanup", `Frames directory deleted: ${framesDir}`);
      }
    } catch (e) {}

    try {
      if (videoPath) {
        await fs.rm(videoPath, { force: true }).catch(() => {});
        log("Cleanup", `Video file deleted: ${videoPath}`);
      }
    } catch (e) {}
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
