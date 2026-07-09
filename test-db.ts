import { db } from "./server/db";
import { users } from "./shared/schema";

async function main() {
  console.log("Testing database connection...");
  const result = await db.select().from(users).limit(1);
  console.log("Database connection SUCCESS! First user ID:", result[0]?.id ?? "none");
  process.exit(0);
}

main().catch(err => {
  console.error("Database connection FAILED:", err);
  process.exit(1);
});
