import "dotenv/config";
import { pool } from "./server/db";

async function main() {
  const res = await pool.query("UPDATE users SET role = 'tournament_director' WHERE email = $1", ["mathbymoves@gmail.com"]);
  console.log("Updated user mathbymoves@gmail.com to tournament director, rowCount:", res.rowCount);
  process.exit(0);
}

main().catch(console.error);
