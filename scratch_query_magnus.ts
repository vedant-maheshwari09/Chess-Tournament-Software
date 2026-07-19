import { db } from './server/db';
import { players } from './shared/schema';
import { like, or } from 'drizzle-orm';

async function main() {
  const matched = await db.select().from(players).where(
    or(
      like(players.firstName, '%Magnus%'),
      like(players.lastName, '%Carlsen%')
    )
  );
  console.log("MATCHED PLAYERS:", JSON.stringify(matched, null, 2));
}

main().catch(console.error);
