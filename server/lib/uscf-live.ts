import { load } from "cheerio";

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
        console.warn(`[USCF Live Fetch] Fetch returned ${response.status}. Retrying (attempt ${attempt}/${retries})...`);
      } else {
        throw new Error(`Server returned status code: ${response.status}`);
      }
    } catch (err) {
      if (attempt === retries) {
        throw err;
      }
    }
    delay *= 2; // Exponential backoff
  }
  throw new Error("Maximum retries reached without success");
}

export interface LiveUscfRating {
  name: string;
  ratingRegular: number | null;
  ratingQuick: number | null;
  ratingBlitz: number | null;
  state: string;
  expiry: string;
  fideId: string;
}

export async function fetchLiveUscfRating(memberId: string): Promise<LiveUscfRating> {
  const url = `https://www.uschess.org/msa/thin.php?${memberId}`;
  
  try {
    const response = await fetchWithBotMitigation(url);
    if (!response.ok) {
      throw new Error(`USCF server returned HTTP ${response.status}`);
    }

    const html = await response.text();
    const $ = load(html);
    const name = $("input[name='memname']").val() as string;
    const regRatingStr = $("input[name='rating1']").val() as string;
    const quickRatingStr = $("input[name='rating2']").val() as string;
    const blitzRatingStr = $("input[name='rating3']").val() as string;
    const stateStr = $("input[name='state_country']").val() as string;
    const fideIdStr = $("input[name='memfideid']").val() as string;
    const expiry = $("input[name='memexpdt']").val() as string;

    if (!name || name.trim().length === 0) {
      throw new Error("Member name field was empty — invalid Member ID or USCF database block.");
    }

    const parseRating = (r: string) => {
      if (!r || r === "Unrated") return null;
      const match = r.match(/\d+/);
      return match ? parseInt(match[0], 10) : null;
    };

    return {
      name: name.trim(),
      ratingRegular: parseRating(regRatingStr),
      ratingQuick: parseRating(quickRatingStr),
      ratingBlitz: parseRating(blitzRatingStr),
      state: stateStr || "",
      expiry: expiry || "",
      fideId: fideIdStr ? fideIdStr.split(" - ")[0] : "",
    };
  } catch (error) {
    console.error(`[USCF Live Fetch] Error loading live USCF data for ID ${memberId}:`, error);
    throw error;
  }
}
