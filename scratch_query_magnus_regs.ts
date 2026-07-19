import { db } from './server/db';
import { playerRegistrations } from './shared/schema';
import { like, or } from 'drizzle-orm';

async function main() {
  const regs = await db.select().from(playerRegistrations).where(
    or(
      like(playerRegistrations.playerName, '%Magnus%'),
      like(playerRegistrations.playerName, '%Carlsen%')
    )
  );
  console.log("MATCHED REGISTRATIONS:", JSON.stringify(regs, null, 2));
}

main().catch(console.error);
