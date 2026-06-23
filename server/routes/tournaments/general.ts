import type { Express } from "express";
import { storage } from '../../storage';
import { requireAuth } from '../../auth';
import {
  extractQueryParam,
  normalizeSearchParams,
  parseLimitParam,
  lookupUSCF,
  lookupFide,
  geminiRefineSchema,
  getGeminiConfig,
  formatCurrencyAmount,
  describeRatingWindow,
  RatingSource,
  RatingLookupResult
} from "../common";
import { searchFideDirectory } from '../../lib/fideDirectory';
import { db } from '../../db';

export function applyGeneralRoutes(app: Express) {
  // Database connection test endpoint (for debugging)
  app.get("/api/health/db", async (req, res) => {
    try {
      // Check if environment variables are set
      const supabaseUrl = process.env.SUPABASE_URL;
      const hasServiceKey = !!(
        process.env.SUPABASE_SERVICE_ROLE_KEY ||
        process.env.SUPABASE_SERVICE_ROLE ||
        process.env.SUPABASE_KEY
      );
      const hasAnonKey = !!process.env.SUPABASE_ANON_KEY;

      const envStatus = {
        hasSupabaseUrl: !!supabaseUrl,
        hasServiceKey: hasServiceKey,
        hasAnonKey: hasAnonKey,
        usingAnonKey: !hasServiceKey && hasAnonKey,
        supabaseUrlPreview: supabaseUrl ? `${supabaseUrl.substring(0, 30)}...` : 'not set',
      };

      if (!supabaseUrl) {
        return res.status(503).json({
          status: "misconfigured",
          message: "SUPABASE_URL is not set",
          env: envStatus,
          instructions: "Please set SUPABASE_URL in your .env file",
          timestamp: new Date().toISOString()
        });
      }

      if (!hasServiceKey && !hasAnonKey) {
        return res.status(503).json({
          status: "misconfigured",
          message: "Supabase key is not set",
          env: envStatus,
          instructions: "Please set SUPABASE_SERVICE_ROLE_KEY (recommended) or SUPABASE_ANON_KEY in your .env file. Note: SERVICE_ROLE_KEY is required for server-side operations.",
          timestamp: new Date().toISOString()
        });
      }

      if (hasAnonKey && !hasServiceKey) {
        // Warn but try to connect anyway
        console.warn("⚠️  Using SUPABASE_ANON_KEY instead of SUPABASE_SERVICE_ROLE_KEY. This may cause permission errors for server-side operations.");
      }

      // Try a simple query to test the connection
      await storage.getUserByUsername("__test_connection__");
      // If we get here, the connection works (even if user doesn't exist)
      res.json({
        status: "connected",
        message: "Database connection is working",
        env: envStatus,
        warning: hasAnonKey && !hasServiceKey ? "Using ANON_KEY - may have limited permissions" : undefined,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorObj = error as any;

      // Extract more detailed error information
      const originalError = errorObj?.originalError || errorObj;
      const errorCode = originalError?.code || errorObj?.code;
      const errorDetails = originalError?.details || errorObj?.details;
      const errorHint = originalError?.hint || errorObj?.hint;

      // Check if it's the Supabase client initialization error
      if (errorMessage.includes("Supabase environment variables are not set")) {
        return res.status(503).json({
          status: "misconfigured",
          message: "Supabase environment variables are not set",
          error: errorMessage,
          instructions: "Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in your .env file",
          timestamp: new Date().toISOString()
        });
      }

      // Check for common connection errors
      const isNetworkError = errorMessage.toLowerCase().includes('fetch failed') ||
        errorMessage.toLowerCase().includes('econnrefused') ||
        errorMessage.toLowerCase().includes('enotfound') ||
        errorCode === 'ECONNREFUSED' ||
        errorCode === 'ENOTFOUND';

      const isAuthError = errorMessage.toLowerCase().includes('jwt') ||
        errorMessage.toLowerCase().includes('invalid api key') ||
        errorCode === 'PGRST301' ||
        errorCode === '42501';

      let diagnosticMessage = "Database connection failed";
      let instructions = "Please check your Supabase credentials and ensure the project is active.";

      if (isNetworkError) {
        diagnosticMessage = "Cannot reach Supabase servers";
        instructions = "Check your internet connection and ensure your Supabase project is not paused. If it was paused, wait a few minutes after reactivating it.";
      } else if (isAuthError) {
        diagnosticMessage = "Supabase authentication failed";
        instructions = "Your API key may be invalid or expired. Please check SUPABASE_SERVICE_ROLE_KEY in your .env file. Note: You need SERVICE_ROLE_KEY, not ANON_KEY for server-side operations.";
      }

      res.status(503).json({
        status: "disconnected",
        message: diagnosticMessage,
        error: errorMessage,
        code: errorCode,
        details: errorDetails,
        hint: errorHint,
        instructions: instructions,
        timestamp: new Date().toISOString()
      });
    }
  });

  app.get("/api/rating-lookup", async (req, res) => {
    try {
      const params: any = {
        term: extractQueryParam(req.query.q),
        lastName: extractQueryParam(req.query.lastName),
        firstName: extractQueryParam(req.query.firstName),
        id: extractQueryParam(req.query.id),
      };

      const normalizedParams = normalizeSearchParams(params);
      const hasInput = Object.values(normalizedParams).some((value) => Boolean(value));
      if (!hasInput) {
        return res.status(400).json({ message: "At least one search parameter is required" });
      }

      const limit = parseLimitParam(req.query.limit, 30, 100);
      const errors: Partial<Record<RatingSource, string>> = {};

      const [uscf, fide] = await Promise.all(["uscf", "fide"].map(async (source) => {
        try {
          if (source === "uscf") return await lookupUSCF(normalizedParams, limit);
          if (source === "fide") return await lookupFide(normalizedParams, limit);
          return [] as RatingLookupResult[];
        } catch (error) {
          const message = error instanceof Error ? error.message : "Lookup failed";
          errors[source as RatingSource] = message;
          console.warn(`${source.toUpperCase()} lookup failed`, error);
          return [] as RatingLookupResult[];
        }
      }));

      res.json({ query: normalizedParams, uscf, fide, errors });
    } catch (error) {
      console.error("Rating lookup error:", error);
      res.status(500).json({ message: "Failed to retrieve rating data" });
    }
  });

  app.get("/api/officials/search", async (req, res) => {
    try {
      const nameQuery = extractQueryParam(req.query.q);
      if (!nameQuery) {
        return res.status(400).json({ message: "Search query 'q' is required" });
      }
      const limit = parseLimitParam(req.query.limit, 10, 50);
      const results = await searchFideDirectory(nameQuery, limit);
      res.json(results);
    } catch (error) {
      console.error("Official search error:", error);
      res.status(500).json({ message: "Failed to search for officials" });
    }
  });

  app.post("/api/tools/gemini-refine", requireAuth, async (req, res) => {
    const { apiKey, model } = getGeminiConfig();
    const resolvedModel = (() => {
      const raw = model && model.trim().length > 0 ? model.trim() : "gemini-1.5-flash";
      return raw.startsWith("models/") ? raw : `models/${raw}`;
    })();

    if (!apiKey) {
      return res.status(503).json({ message: "Gemini integration is not configured" });
    }

    const parsed = geminiRefineSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid payload for Gemini refinement" });
    }

    const { config } = parsed.data;
    const basic = (config.basic ?? {}) as Record<string, any>;
    const details = (config.details ?? {}) as Record<string, any>;
    const schedule = Array.isArray(config.schedule) ? config.schedule : [];
    const contacts = Array.isArray(config.contacts) ? config.contacts : [];
    const entryFees = Array.isArray((config as any)?.entryFees) ? (config as any).entryFees : [];
    const registers = (config as any)?.registers ?? {};
    const fide = (config as any)?.fide ?? {};

    const scheduleLines = schedule
      .filter((item: any) => item && (item.label || item.date || item.time))
      .map((item: any) => {
        const parts: string[] = [];
        if (item.date) parts.push(String(item.date));
        if (item.time) parts.push(String(item.time));
        const timing = parts.length > 0 ? ` – ${parts.join(" @ ")}` : "";
        return `• ${item.label ?? "Event"}${timing}`;
      })
      .join("\n");

    const contactLines = contacts
      .filter((contact: any) => contact && (contact.name || contact.role))
      .map((contact: any) => {
        const segments: string[] = [];
        if (contact.role) segments.push(contact.role);

        if (contact.email) segments.push(contact.email);
        return `• ${contact.name ?? "Contact"}${segments.length ? ` (${segments.join(" · ")})` : ""}`;
      })
      .join("\n");

    const entryFeeLines = entryFees
      .filter((fee: any) => fee && (fee.section || fee.amount))
      .map((fee: any) => {
        const amount = formatCurrencyAmount(fee.amount, fee.currency);
        const ratingWindow = describeRatingWindow(fee.ratingMin, fee.ratingMax);
        const ratingText = ratingWindow === "All ratings" ? "" : ` · ${ratingWindow}`;
        const note = fee.notes ? ` — ${fee.notes}` : "";
        const sectionName = fee.section ?? "Section";
        return `• ${sectionName}: ${amount}${ratingText}${note}`;
      })
      .join("\n");

    const highlightItems: string[] = [];
    if (typeof fide?.prizeFund === "string" && fide.prizeFund.trim().length > 0) {
      highlightItems.push(`Prize fund: ${fide.prizeFund.trim()}`);
    }
    if (typeof registers?.earlyBirdDetails === "string" && registers.earlyBirdDetails.trim().length > 0) {
      highlightItems.push(`Early entry: ${registers.earlyBirdDetails.trim()}`);
    }
    if (typeof registers?.paymentDetails === "string" && registers.paymentDetails.trim().length > 0) {
      highlightItems.push(`Payment info: ${registers.paymentDetails.trim()}`);
    }
    if (typeof registers?.playerLimit === "number" && Number.isFinite(registers.playerLimit) && registers.playerLimit > 0) {
      highlightItems.push(`Entry cap: ${registers.playerLimit} players`);
    }
    if (typeof registers?.byeLimit === "number" && Number.isFinite(registers.byeLimit) && registers.byeLimit > 0) {
      highlightItems.push(`Half-point byes available: up to ${registers.byeLimit}`);
    }
    const ratedTags: string[] = [];
    if (registers?.fideRated) ratedTags.push("FIDE");
    if (registers?.uscfRated) ratedTags.push("USCF");
    if (ratedTags.length > 0) {
      highlightItems.push(`Rated for ${ratedTags.join(" & ")}`);
    }
    if (registers?.allowSignup) {
      highlightItems.push("Online registration is open through the player portal.");
    }

    const highlightLines = highlightItems.map((item) => `• ${item}`).join("\n");

    const baseModel = (() => {
      const raw = model && model.trim().length > 0 ? model.trim() : "gemini-1.5-flash";
      return raw.replace(/^models\//, "");
    })();
    const primaryCandidates = [
      baseModel,
      baseModel.endsWith("-latest") ? baseModel : `${baseModel}-latest`,
      "gemini-1.5-flash",
      "gemini-1.5-flash-latest",
      "gemini-1.5-pro",
      "gemini-1.5-pro-latest",
      "gemini-pro",
      "gemini-pro-latest",
    ];

    const candidateModels = Array.from(
      new Set(
        primaryCandidates
          .filter(Boolean)
          .map((value) => value.replace(/^models\//, ""))
          .map((value) => `models/${value}`),
      ),
    );

    const instructions = (config as any).instructions ?? "";
    const currentContent = (config as any).tournamentPageContent ?? "";

    const prompt = `You are assisting a chess tournament director by ${currentContent ? "refining" : "drafting"} the public tournament page copy.
${currentContent ? `The current content is:\n"""\n${currentContent}\n"""\n\n` : ""}
${instructions ? `USER INSTRUCTIONS FOR REFINEMENT:\n${instructions}\n\n` : ""}
Use a professional but welcoming tone and produce concise Markdown with short headings and paragraphs.
Include an Overview, Schedule, and Highlights section referencing the data below.

FORMATTING GUIDELINES:
- Use H1, H2, or H3 for sections.
- Use bullet points for highlights.
- Use tables for structured data like schedules or prize funds if appropriate.
- You can use checklists for "What to bring" or "Registration requirements".
- Use bold/italic for emphasis.
- You can use strikethrough (~~text~~) or underline (<u>text</u>) if it adds clarity.
- For alignment, use custom tags: {{align-center:text}}, {{align-right:text}}, or {{align-justify:text}} where visually appropriate (e.g. headers or special notices).
- Use code blocks for any technical data or specific technical instructions.
- Ensure the result is clean, readable, and visually stunning.

Tournament data:
${basic.name ? `- Name: ${basic.name}` : ""}
${basic.city ? `- Location: ${basic.city}` : ""}
${(basic.startDate && basic.endDate) ? `- Dates: ${basic.startDate} to ${basic.endDate}` : ""}
${basic.federation ? `- Federation focus: ${basic.federation}` : ""}
${(config as any)?.format || details.pairingSystem ? `- Format: ${(config as any)?.format ?? details.pairingSystem}` : ""}
${details.rounds ? `- Rounds: ${details.rounds}` : ""}
${details.timeControl ? `- Time control: ${details.timeControl} (${details.ratingType ?? "standard"})` : ""}
${basic.description ? `- Description: ${basic.description}` : ""}

${fide?.prizeFund ? `Prize Fund: ${fide.prizeFund}` : ""}

${basic.city ? `Location: ${basic.city}` : ""}

${(config as any).hotelInfo ?? ""}

${(basic.startDate && basic.endDate) ? `Dates: ${basic.startDate} - ${basic.endDate}` : ""}

${entryFeeLines ? `Sections:
${entryFeeLines}` : ""}

${details.timeControl ? `Time control: ${details.timeControl}` : ""}

${(config as any).scheduleInfo ?? ""}

${(config as any).specialEntries ? `Special Entries:
${(config as any).specialEntries}` : ""}

${(config as any).entryFeesInfo ? `Entry Fees:
${(config as any).entryFeesInfo}` : ""}

${(config as any).notes ? `Notes:
${(config as any).notes}` : ""}

${(config as any).roundByes ? `Round Byes
${(config as any).roundByes}` : ""}

${(config as any).membershipInfo ? `${(config as any).membershipInfo}` : ""}

${(config as any).blitzInfo ? `${(config as any).blitzInfo}` : ""}

${(config as any).registrationInfo ? `Details and Registration:
${(config as any).registrationInfo}` : ""}

${contactLines ? `Contact:
${contactLines}` : ""}

${basic.city ? `Address:
${basic.city}` : ""}

${fide?.prizeFund ? `Prize Fund: ${fide.prizeFund}` : ""}
${(config as any)?.fideRated ? `FIDE Rated: Yes` : ""}
${(config as any)?.handicapAccessible ? `Handicap Accessible: Yes` : ""}
${(config as any)?.residencyRestriction ? `Residency Restriction: Yes` : ""}
${(config as any)?.onlineEvent ? `Online Event: Yes` : ""}
${(config as any).organizerInfo ? `Organizer Overview
${(config as any).organizerInfo}` : ""}
`;

    try {
      let lastError: { status: number; payload: any; rawBody: string; model: string } | null = null;

      for (const candidate of candidateModels) {
        const url = new URL(
          `https://generativelanguage.googleapis.com/v1beta/${candidate}:generateContent`,
        );
        console.log(`Calling Gemini API: ${url.toString()}`);
        url.searchParams.set("key", apiKey);

        const response = await fetch(url.toString(), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            contents: [
              {
                role: "user",
                parts: [{ text: prompt }],
              },
            ],
            generationConfig: {
              temperature: 0.7,
              maxOutputTokens: 800,
            },
          }),
        });

        const rawBody = await response.text();
        let payload: any = null;

        if (rawBody) {
          try {
            payload = JSON.parse(rawBody);
          } catch (parseError) {
            console.warn("Gemini response parsing failed", parseError);
            payload = rawBody;
          }
        }

        if (response.ok) {
          const data = payload ?? {};
          const content = (data?.candidates?.[0]?.content?.parts ?? [])
            .map((part: any) => part?.text ?? "")
            .join("\n")
            .trim();

          if (!content) {
            return res.status(502).json({ message: "Gemini returned no content" });
          }

          return res.json({ content });
        }

        console.error("Gemini API error:", payload ?? rawBody, "(model:", candidate, ")");
        lastError = { status: response.status, payload, rawBody, model: candidate };

        if (response.status !== 404) {
          break;
        }
      }

      if (lastError) {
        const { status, payload, rawBody } = lastError;
        const apiMessage =
          (payload && typeof payload === "object" && "error" in payload && (payload as any).error?.message) ||
          (payload && typeof payload === "object" && "message" in payload && (payload as any).message) ||
          (typeof payload === "string" && payload) ||
          rawBody ||
          "Gemini API request failed";

        return res.status(status || 502).json({ message: apiMessage });
      }

      return res.status(502).json({ message: "Gemini API request failed" });
    } catch (error) {
      console.error("Gemini draft error:", error);
      res.status(500).json({ message: "Failed to generate tournament copy" });
    }
  });
}
