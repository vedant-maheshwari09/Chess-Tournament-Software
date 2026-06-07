import { pool } from "./db";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@shared/schema";

// Compatibility shim — historically some code imported a "Supabase client".
// We now use plain Postgres via Drizzle; this module re-exports the same db
// instance and pool so callers can be updated incrementally.

export const db = drizzle(pool, { schema });

export function getSupabaseClient() {
  // Minimal shim: exposes a .from() method that delegates to the pool
  return {
    from: (table: string) => ({
      delete: () => ({
        eq: async (column: string, value: any) => {
          await pool.query(`DELETE FROM ${table} WHERE ${column} = $1`, [value]);
        },
      }),
    }),
  };
}
