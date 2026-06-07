import "dotenv/config";
import { db } from "./server/db";
import { users } from "@shared/schema";
import { eq } from "drizzle-orm";

async function main() {
  const result = await db.update(users).set({ isTournamentDirector: true }).where(eq(users.email, "mathbymoves@gmail.com"));
  console.log("Updated user mathbymoves@gmail.com to tournament director");
  process.exit(0);
}

main().catch(console.error);
