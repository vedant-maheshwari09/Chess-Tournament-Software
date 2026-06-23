import { pool } from "./db";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@shared/schema";

import { getSupabaseClient as getRootSupabaseClient } from "../supabaseClient";

// Compatibility shim — historically some code imported a "Supabase client".
// We now use plain Postgres via Drizzle; this module re-exports the same db
// instance and pool so callers can be updated incrementally.

export const db = drizzle(pool, { schema });

export function getSupabaseClient() {
  return getRootSupabaseClient();
}
