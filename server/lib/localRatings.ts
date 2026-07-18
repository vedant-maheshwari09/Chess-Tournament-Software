import { createReadStream, existsSync, statSync, createWriteStream, unlink, unlinkSync, renameSync } from "fs";
import path from "path";
import readline from "readline";
import { fileURLToPath } from "url";
import Database from "better-sqlite3";
import https from "https";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT_CANDIDATES = Array.from(
  new Set(
    [
      process.env.RATINGS_DATA_ROOT?.trim() ?? undefined,
      process.cwd(),
      path.resolve(process.cwd(), "dist"),
      path.resolve(process.cwd(), ".."),
      MODULE_DIR,
      path.resolve(MODULE_DIR, ".."),
      path.resolve(MODULE_DIR, "..", ".."),
    ].filter((value): value is string => Boolean(value)),
  ),
);

// Helper to yield event loop during long-running sync tasks
const yieldLoop = () => new Promise(resolve => setImmediate(resolve));

function resolveDataPath(relativePath: string, envKey?: string) {
  const envValue = envKey ? process.env[envKey]?.trim() : undefined;
  if (envValue) {
    return path.resolve(envValue);
  }

  for (const root of DEFAULT_ROOT_CANDIDATES) {
    const candidate = path.resolve(root, relativePath);
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  const distPath = path.resolve(process.cwd(), "dist");
  const fallbackRoot = existsSync(distPath)
    ? distPath
    : (DEFAULT_ROOT_CANDIDATES[0] ?? process.cwd());
  return path.resolve(fallbackRoot, relativePath);
}

const USCF_ALL_RATINGS_FILE = resolveDataPath("Uscf-2026-08-AllRatings.tsv", "USCF_ALL_RATINGS_FILE");
const FIDE_FILE = resolveDataPath("players_list-fide-oct-2025.txt", "FIDE_PLAYER_LIST_FILE");
const DB_PATH = resolveDataPath("ratings_cache.sqlite", "RATINGS_CACHE_DB_FILE");

const FALLBACK_FIDE_URL = "https://www.dropbox.com/scl/fo/xn3nhh02v84s59kyu8vrc/APaSiTcLdUmspGzGQMZuFMU/players_list-fide-oct-2025.txt?rlkey=n759qued6usclg7qqrm16163c&dl=1";

let db: Database.Database | null = null;
let initPromise: Promise<void> | null = null;

export interface RatingField {
  value?: string;
  raw: string;
}

export interface LocalSearchParams {
  id?: string;
  lastName?: string;
  firstName?: string;
  term?: string;
}

export interface LocalRatingResult {
  id: string;
  name: string;
  rating?: RatingField;
  quickRating?: RatingField;
  blitzRating?: RatingField;
  rapidRating?: RatingField;
  location?: string;
  federation?: string;
  title?: string;
  sex?: string;
  birthYear?: string;
  metadata?: Record<string, any>;
}

function log(message: string, context: string = "system") {
  console.log(`${new Date().toISOString()} [localRatings] [${context}] ${message}`);
}

async function downloadFile(url: string, dest: string, redirects = 5): Promise<void> {
  const tempDest = `${dest}.tmp`;
  return new Promise((resolve, reject) => {
    if (redirects < 0) {
      reject(new Error("Too many redirects"));
      return;
    }

    https.get(url, (response) => {
      const { statusCode } = response;
      const contentType = response.headers["content-type"];
      
      // Handle redirects (301, 302, 307, 308)
      if (statusCode && statusCode >= 300 && statusCode < 400 && response.headers.location) {
        log(`Following redirect to ${response.headers.location}...`);
        downloadFile(response.headers.location, dest, redirects - 1)
          .then(resolve)
          .catch(reject);
        return;
      }

      if (statusCode !== 200) {
        reject(new Error(`Failed to download: ${statusCode} ${response.statusMessage}`));
        return;
      }

      log(`Downloading to temp file: ${tempDest} (Type: ${contentType})`);
      const file = createWriteStream(tempDest);
      response.pipe(file);
      file.on("finish", () => {
        file.close();
        try {
          if (statSync(tempDest).size === 0) {
            unlinkSync(tempDest);
            reject(new Error("Downloaded file is empty"));
            return;
          }
          // Atomic rename
          renameSync(tempDest, dest);
          log(`Download complete and verified: ${dest}`);
          resolve();
        } catch (err) {
          reject(err);
        }
      });
      file.on("error", (err) => {
        if (existsSync(tempDest)) unlinkSync(tempDest);
        reject(err);
      });
    }).on("error", (err) => {
      if (existsSync(tempDest)) unlinkSync(tempDest);
      reject(err);
    });
  });
}

export async function ensureDataFiles(): Promise<void> {
  // 1. Verify FIDE file (download if missing)
  if (!existsSync(FIDE_FILE)) {
    const url = process.env.FIDE_PLAYER_LIST_URL || FALLBACK_FIDE_URL;
    if (url) {
      try {
        await downloadFile(url, FIDE_FILE);
      } catch (error) {
        log(`Error downloading FIDE file: ${error instanceof Error ? error.message : String(error)}`);
        throw error;
      }
    } else {
      throw new Error(`Missing required FIDE file: ${FIDE_FILE}`);
    }
  }

  // 2. Verify USCF TSV file (user provides locally or via env path)
  if (!existsSync(USCF_ALL_RATINGS_FILE)) {
    log(`Warning: USCF ratings TSV file is missing at: ${USCF_ALL_RATINGS_FILE}`);
    throw new Error(`Missing required USCF ratings file: ${USCF_ALL_RATINGS_FILE}`);
  }
}

function isDbValid(): boolean {
  if (!existsSync(DB_PATH)) return false;
  try {
    const checkDb = new Database(DB_PATH, { readonly: true });
    
    // Check if the tables exist
    const tables = checkDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('meta', 'uscf', 'fide')").all() as any[];
    if (tables.length < 3) {
      checkDb.close();
      return false;
    }
    
    // Check if we have meta keys
    const metaUscf = checkDb.prepare("SELECT value FROM meta WHERE key = 'uscf_mtime'").get() as { value: string } | undefined;
    const metaFide = checkDb.prepare("SELECT value FROM meta WHERE key = 'fide_mtime'").get() as { value: string } | undefined;
    
    if (!metaUscf?.value || !metaFide?.value) {
      checkDb.close();
      return false;
    }
    
    // Check if there are actually records in the tables
    const uscfCount = checkDb.prepare("SELECT count(*) as count FROM uscf").get() as { count: number };
    const fideCount = checkDb.prepare("SELECT count(*) as count FROM fide").get() as { count: number };
    
    checkDb.close();
    
    return uscfCount.count > 0 && fideCount.count > 0;
  } catch (err) {
    return false;
  }
}

export async function preloadRatingData() {
  if (!initPromise) {
    initPromise = (async () => {
      try {
        if (isDbValid()) {
          log("Existing valid ratings database cache found. Skipping download and rebuild.", "system");
          db = new Database(DB_PATH);
          db.pragma('journal_mode = WAL');
          db.pragma('synchronous = NORMAL');
          return;
        }
        
        log("No valid ratings database cache found. Starting download and database rebuild...", "system");
        await ensureDataFiles();
        await initializeDb();
        log("Rating data preloaded successfully.", "system");
      } catch (err) {
        log(`Failed to preload rating data: ${err instanceof Error ? err.message : String(err)}`, "system");
      }
    })();
  }
  return initPromise;
}

function getMtime(fileName: string) {
  const filePath = path.resolve(process.cwd(), fileName);
  if (!existsSync(filePath)) return null;
  return statSync(filePath).mtimeMs;
}

async function initializeDb() {
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  
  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE IF NOT EXISTS uscf (
      id TEXT PRIMARY KEY,
      name TEXT,
      state TEXT,
      expiration TEXT,
      rating_value TEXT,
      rating_raw TEXT,
      quick_rating_value TEXT,
      quick_rating_raw TEXT,
      blitz_rating_value TEXT,
      blitz_rating_raw TEXT,
      search_vector TEXT,
      normalized_full_name TEXT,
      normalized_last_first TEXT
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS uscf_idx USING fts5(
      search_vector
    );
    CREATE TABLE IF NOT EXISTS fide (
      id TEXT PRIMARY KEY,
      name TEXT,
      federation TEXT,
      sex TEXT,
      title TEXT,
      rating_value TEXT,
      rating_raw TEXT,
      rapid_rating_value TEXT,
      rapid_rating_raw TEXT,
      blitz_rating_value TEXT,
      blitz_rating_raw TEXT,
      birth_year TEXT,
      search_vector TEXT,
      normalized_full_name TEXT,
      normalized_last_first TEXT
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS fide_idx USING fts5(
      search_vector
    );
  `);

  const uscfMtime = getMtime(USCF_ALL_RATINGS_FILE);
  const fideMtime = getMtime(FIDE_FILE);

  const getMeta = db.prepare(`SELECT value FROM meta WHERE key = ?`);
  const setMeta = db.prepare(`INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)`);

  const currentUscfMeta = getMeta.get('uscf_mtime') as {value: string} | undefined;
  const currentFideMeta = getMeta.get('fide_mtime') as {value: string} | undefined;

  const expectedUscfMeta = `${uscfMtime}`;
  const expectedFideMeta = `${fideMtime}`;

  if (currentUscfMeta?.value !== expectedUscfMeta) {
    if (uscfMtime) {
      log("Rebuilding USCF database index from TSV...", "ratings");
      try {
        await buildUscfIndex();
        setMeta.run('uscf_mtime', expectedUscfMeta);
        log("USCF index build complete.", "ratings");
      } catch (err) {
        log(`USCF index build failed: ${err instanceof Error ? err.message : String(err)}`, "ratings");
        throw err;
      }
    }
  }

  if (currentFideMeta?.value !== expectedFideMeta) {
    if (fideMtime) {
      log("Rebuilding FIDE database index...", "ratings");
      try {
        await buildFideIndex();
        setMeta.run('fide_mtime', expectedFideMeta);
        log("FIDE index build complete.", "ratings");
      } catch (err) {
        log(`FIDE index build failed: ${err instanceof Error ? err.message : String(err)}`, "ratings");
        throw err;
      }
    }
  }
}

async function buildUscfIndex() {
  assertFileExists(USCF_ALL_RATINGS_FILE, "USCF ratings TSV file not found");

  db!.exec('BEGIN TRANSACTION');
  db!.exec('DELETE FROM uscf');
  db!.exec('DELETE FROM uscf_idx');
  db!.exec('COMMIT');

  await streamUSCFTSVIntoDb(USCF_ALL_RATINGS_FILE);

  log("Building USCF FTS index in bulk...", "ratings");
  db!.exec('BEGIN TRANSACTION');
  db!.exec('INSERT INTO uscf_idx (rowid, search_vector) SELECT rowid, search_vector FROM uscf');
  db!.exec('COMMIT');
  log("USCF FTS index build complete.", "ratings");
}

async function streamUSCFTSVIntoDb(filePath: string) {
  const reader = readline.createInterface({
    input: createReadStream(filePath),
    crlfDelay: Infinity,
  });

  const upsert = db!.prepare(`
    INSERT INTO uscf (
      id, name, state, expiration, 
      rating_value, rating_raw, 
      quick_rating_value, quick_rating_raw, 
      blitz_rating_value, blitz_rating_raw,
      search_vector, normalized_full_name, normalized_last_first
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      state = excluded.state,
      expiration = excluded.expiration,
      rating_value = excluded.rating_value,
      rating_raw = excluded.rating_raw,
      quick_rating_value = excluded.quick_rating_value,
      quick_rating_raw = excluded.quick_rating_raw,
      blitz_rating_value = excluded.blitz_rating_value,
      blitz_rating_raw = excluded.blitz_rating_raw,
      search_vector = excluded.search_vector,
      normalized_full_name = excluded.normalized_full_name,
      normalized_last_first = excluded.normalized_last_first
  `);

  db!.exec('BEGIN TRANSACTION');
  let count = 0;
  let isFirstLine = true;

  for await (const rawLine of reader) {
    const line = rawLine.replace(/\r/g, "");
    if (!line.trim()) continue;

    if (isFirstLine) {
      isFirstLine = false;
      if (line.startsWith("#id") || line.startsWith("id")) {
        continue;
      }
    }

    const parts = line.split("\t");
    if (parts.length < 10) continue;

    const id = parts[0].trim();
    const name = parts[1]?.trim() || "";
    const state = parts[2]?.trim() || null;
    const expiration = parts[4]?.trim() || null;

    const ratingValRaw = parts[9]?.trim() || null;
    const gamesReg = parts[10]?.trim() || "";
    const ratingVal = ratingValRaw ? (ratingValRaw.match(/\d+/) ? ratingValRaw.match(/\d+/)?.[0] : null) : null;
    const ratingRaw = ratingValRaw ? (gamesReg ? `${ratingValRaw}/${gamesReg}` : ratingValRaw) : null;

    const quickValRaw = parts[11]?.trim() || null;
    const gamesQuick = parts[12]?.trim() || "";
    const quickVal = quickValRaw ? (quickValRaw.match(/\d+/) ? quickValRaw.match(/\d+/)?.[0] : null) : null;
    const quickRaw = quickValRaw ? (gamesQuick ? `${quickValRaw}/${gamesQuick}` : quickValRaw) : null;

    const blitzValRaw = parts[13]?.trim() || null;
    const gamesBlitz = parts[14]?.trim() || "";
    const blitzVal = blitzValRaw ? (blitzValRaw.match(/\d+/) ? blitzValRaw.match(/\d+/)?.[0] : null) : null;
    const blitzRaw = blitzValRaw ? (gamesBlitz ? `${blitzValRaw}/${gamesBlitz}` : blitzValRaw) : null;

    if (!id || !name) continue;

    const normalizedFullName = normalizeForSearch(toFirstLast(name));
    const normalizedLastFirst = normalizeForSearch(name.replace(",", " "));
    const tokenSet = new Set<string>();
    addTokens(tokenSet, normalizedFullName);
    addTokens(tokenSet, normalizedLastFirst);
    addTokens(tokenSet, id);
    if (state) addTokens(tokenSet, state);

    const searchVector = Array.from(tokenSet).join(" ");

    upsert.run(
      id, name, state, expiration,
      ratingVal, ratingRaw,
      quickVal, quickRaw,
      blitzVal, blitzRaw,
      searchVector, normalizedFullName, normalizedLastFirst
    );

    count++;
    if (count % 5000 === 0) {
      db!.exec('COMMIT');
      log(`Processed ${count} USCF records...`, "ratings");
      await yieldLoop();
      db!.exec('BEGIN TRANSACTION');
    }
  }
  db!.exec('COMMIT');
  if (count === 0) {
    throw new Error(`No records processed for USCF TSV file: ${filePath}`);
  }
  log(`Finished USCF indexing. ${count} records processed.`, "ratings");
}


async function buildFideIndex() {
  assertFileExists(FIDE_FILE, "FIDE player list file not found");
  
  db!.exec('BEGIN TRANSACTION');
  db!.exec('DELETE FROM fide');
  db!.exec('DELETE FROM fide_idx');
  const insert = db!.prepare(`
    INSERT INTO fide (
      id, name, federation, sex, title, 
      rating_value, rating_raw, 
      rapid_rating_value, rapid_rating_raw, 
      blitz_rating_value, blitz_rating_raw, 
      birth_year, search_vector, normalized_full_name, normalized_last_first
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const reader = readline.createInterface({
    input: createReadStream(FIDE_FILE),
    crlfDelay: Infinity,
  });

  let count = 0;
  let isFirstLine = true;
  for await (const rawLine of reader) {
    if (isFirstLine) {
      isFirstLine = false;
      continue;
    }
    const line = rawLine.replace(/\r/g, "");
    if (!line.trim()) continue;
    const parsed = parseFideLine(line);
    if (!parsed) continue;

    const normalizedFullName = normalizeForSearch(toNameFirstLast(parsed.name));
    const normalizedLastFirst = normalizeForSearch(parsed.name.replace(",", " "));
    const tokenSet = new Set<string>();
    addTokens(tokenSet, normalizedFullName);
    addTokens(tokenSet, normalizedLastFirst);
    addTokens(tokenSet, parsed.id);
    if (parsed.federation) addTokens(tokenSet, parsed.federation);
    if (parsed.title) addTokens(tokenSet, parsed.title);

    const searchVector = Array.from(tokenSet).join(" ");

    insert.run(
      parsed.id, parsed.name, parsed.federation || null, parsed.sex || null, parsed.title || null,
      parsed.rating?.value || null, parsed.rating?.raw || null,
      parsed.rapidRating?.value || null, parsed.rapidRating?.raw || null,
      parsed.blitzRating?.value || null, parsed.blitzRating?.raw || null,
      parsed.birthYear || null, searchVector, normalizedFullName, normalizedLastFirst
    );

    count++;
    if (count % 5000 === 0) {
      db!.exec('COMMIT');
      log(`Processed ${count} FIDE records...`, "ratings");
      await yieldLoop();
      db!.exec('BEGIN TRANSACTION');
    }
  }
  db!.exec('COMMIT');
  if (count === 0) {
    throw new Error(`No records processed for FIDE file`);
  }
  
  log("Building FIDE FTS index in bulk...", "ratings");
  db!.exec('BEGIN TRANSACTION');
  db!.exec('INSERT INTO fide_idx (rowid, search_vector) SELECT rowid, search_vector FROM fide');
  db!.exec('COMMIT');
  log(`Finished FIDE indexing. ${count} records processed.`, "ratings");
}


function parseFideLine(line: string) {
  const id = line.slice(0, 12).trim();
  if (!id) return null;
  const name = line.slice(12, 73).trim();
  if (!name) return null;

  const federation = line.slice(76, 79).trim() || undefined;
  const sex = line.slice(79, 81).trim() || undefined;
  const title = line.slice(81, 85).trim() || undefined;
  const rating = parseFideRating(line.slice(105, 118));
  const rapidRating = parseFideRating(line.slice(117, 130));
  const blitzRating = parseFideRating(line.slice(129, 142));
  const birthYear = line.slice(144, 149).trim() || undefined;

  return {
    id,
    name,
    federation,
    sex,
    title,
    rating,
    rapidRating,
    blitzRating,
    birthYear,
  };
}

function parseFideRating(segment: string): RatingField | undefined {
  const ratingValue = extractPrimaryNumber(segment);
  if (!ratingValue || ratingValue === "0") return undefined;
  return { value: ratingValue, raw: ratingValue };
}

function extractPrimaryNumber(segment: string): string | undefined {
  const matches = segment.match(/\d+/g);
  if (!matches) return undefined;
  const preferred = matches.find((value) => value.length >= 3);
  return preferred ?? matches[0];
}

type SearchInput = string | LocalSearchParams;

export async function searchUSCF(input: SearchInput, limit = 25): Promise<LocalRatingResult[]> {
  await preloadRatingData();
  const { query, tokens } = resolveSearchInput(input);
  if (!hasSufficientInput(query) || !tokens.length) return [];
  
  const ftsMatch = tokens.map(t => `${t}*`).join(' AND ');
  log(`[search] USCF query: "${query}", ftsMatch: "${ftsMatch}"`, "search");
  
  const sql = `
    SELECT u.* FROM uscf u
    JOIN uscf_idx f ON u.rowid = f.rowid
    WHERE f.search_vector MATCH ?
    LIMIT 200
  `;
  
  const stmt = db!.prepare(sql);
  const rows = stmt.all(ftsMatch) as any[];
  log(`[search] USCF found ${rows.length} raw results`, "search");
  
  const queryNormalized = normalizeForSearch(query);
  const matches = rows.map(row => ({
    entry: row,
    score: computeScore(row, tokens, queryNormalized)
  }));
  
  matches.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.entry.normalized_full_name.localeCompare(b.entry.normalized_full_name);
  });
  
  return matches.slice(0, limit).map((match) => {
    const entry = match.entry;
    return {
      id: entry.id,
      name: entry.name,
      rating: entry.rating_value ? { value: entry.rating_value, raw: entry.rating_raw } : undefined,
      quickRating: entry.quick_rating_value ? { value: entry.quick_rating_value, raw: entry.quick_rating_raw } : undefined,
      blitzRating: entry.blitz_rating_value ? { value: entry.blitz_rating_value, raw: entry.blitz_rating_raw } : undefined,
      location: entry.state,
      metadata: entry.expiration ? { expiration: entry.expiration } : undefined,
    };
  });
}

export async function searchFide(input: SearchInput, limit = 25): Promise<LocalRatingResult[]> {
  await preloadRatingData();
  const { query, tokens } = resolveSearchInput(input);
  if (!hasSufficientInput(query) || !tokens.length) return [];
  
  const ftsMatch = tokens.map(t => `${t}*`).join(' AND ');
  log(`[search] FIDE query: "${query}", ftsMatch: "${ftsMatch}"`, "search");
  
  const sql = `
    SELECT f.* FROM fide f
    JOIN fide_idx fts ON f.rowid = fts.rowid
    WHERE fts.search_vector MATCH ?
    LIMIT 200
  `;
  
  const stmt = db!.prepare(sql);
  const rows = stmt.all(ftsMatch) as any[];
  log(`[search] FIDE found ${rows.length} raw results`, "search");
  
  const queryNormalized = normalizeForSearch(query);
  const matches = rows.map(row => ({
    entry: row,
    score: computeScore(row, tokens, queryNormalized)
  }));
  
  matches.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.entry.normalized_full_name.localeCompare(b.entry.normalized_full_name);
  });
  
  return matches.slice(0, limit).map((match) => {
    const entry = match.entry;
    return {
      id: entry.id,
      name: entry.name,
      rating: entry.rating_value ? { value: entry.rating_value, raw: entry.rating_raw } : undefined,
      rapidRating: entry.rapid_rating_value ? { value: entry.rapid_rating_value, raw: entry.rapid_rating_raw } : undefined,
      blitzRating: entry.blitz_rating_value ? { value: entry.blitz_rating_value, raw: entry.blitz_rating_raw } : undefined,
      federation: entry.federation,
      title: entry.title,
      sex: entry.sex,
      birthYear: entry.birth_year,
    };
  });
}

function resolveSearchInput(input: SearchInput) {
  if (typeof input === "string") {
    const trimmed = input.trim();
    return { query: trimmed, tokens: tokensFromQuery(trimmed) };
  }

  const parts = [input.id, input.lastName, input.firstName, input.term]
    .map((value) => (value ?? "").trim())
    .filter((value) => value.length > 0);

  const combined = parts.join(" ").trim();
  return { query: combined, tokens: tokensFromQuery(combined) };
}

function computeScore(
  entry: { normalized_full_name: string; normalized_last_first: string; id: string },
  tokens: string[],
  fullQuery: string,
): number {
  let score = 0;
  if (fullQuery && entry.normalized_full_name.startsWith(fullQuery)) score += 6;
  if (fullQuery && entry.normalized_last_first.startsWith(fullQuery)) score += 4;

  for (const token of tokens) {
    if (!token) continue;
    if (entry.normalized_full_name.startsWith(token)) score += 3;
    else if (entry.normalized_full_name.includes(` ${token}`)) score += 2;
    if (entry.normalized_last_first.startsWith(token)) score += 3;
    else if (entry.normalized_last_first.includes(` ${token}`)) score += 1;
    if (entry.id.startsWith(token)) score += 8;
    else if (entry.id.includes(token)) score += 3;
  }

  return score;
}

function normalizeForSearch(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function tokensFromQuery(query: string) {
  return normalizeForSearch(query)
    .split(" ")
    .filter((token) => token && (token.length >= 2 || /^\d+$/.test(token)));
}

function addTokens(target: Set<string>, value: string) {
  const normalized = normalizeForSearch(value);
  if (!normalized) return;
  for (const token of normalized.split(" ")) {
    if (token) target.add(token);
  }
}

function toFirstLast(name: string) {
  const [last, first] = name.split(",");
  return [first?.trim() ?? "", last?.trim() ?? ""].filter(Boolean).join(" ");
}

function toNameFirstLast(name: string) {
  const [last, first] = name.split(",");
  const trimmedFirst = first?.trim() ?? "";
  const trimmedLast = last?.trim() ?? "";
  return trimmedFirst && trimmedLast ? `${trimmedFirst} ${trimmedLast}` : name.trim();
}

function assertFileExists(filePath: string, message: string) {
  if (!existsSync(filePath)) {
    throw new Error(`${message}: ${filePath}`);
  }
}

function hasSufficientInput(query: string) {
  const trimmed = query.trim();
  if (trimmed.length >= 2) return true;
  return /^\d+$/.test(trimmed) && trimmed.length > 0;
}

export async function getLocalUSCFPlayerById(id: string): Promise<LocalRatingResult | null> {
  await preloadRatingData();
  if (!db) return null;
  try {
    const stmt = db.prepare(`SELECT * FROM uscf WHERE id = ?`);
    const row = stmt.get(id) as any;
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      rating: row.rating_value ? { value: row.rating_value, raw: row.rating_raw } : undefined,
      quickRating: row.quick_rating_value ? { value: row.quick_rating_value, raw: row.quick_rating_raw } : undefined,
      blitzRating: row.blitz_rating_value ? { value: row.blitz_rating_value, raw: row.blitz_rating_raw } : undefined,
      location: row.state,
      metadata: row.expiration ? { expiration: row.expiration } : undefined,
    };
  } catch (error) {
    console.error(`[localRatings] Error looking up player ${id} locally:`, error);
    return null;
  }
}

export async function getLocalFidePlayerById(id: string): Promise<LocalRatingResult | null> {
  await preloadRatingData();
  if (!db) return null;
  try {
    const stmt = db.prepare(`SELECT * FROM fide WHERE id = ?`);
    const row = stmt.get(id) as any;
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      rating: row.rating_value ? { value: row.rating_value, raw: row.rating_raw } : undefined,
      quickRating: row.rapid_rating_value ? { value: row.rapid_rating_value, raw: row.rapid_rating_raw } : undefined,
      blitzRating: row.blitz_rating_value ? { value: row.blitz_rating_value, raw: row.blitz_rating_raw } : undefined,
      federation: row.federation,
      title: row.title,
      sex: row.sex,
      birthYear: row.birth_year,
    };
  } catch (error) {
    console.error(`[localRatings] Error looking up FIDE player ${id} locally:`, error);
    return null;
  }
}

preloadRatingData().catch((err: unknown) => {
  log(`Failed to initialize ratings database: ${err instanceof Error ? err.message : String(err)}`, 'ratings');
});
