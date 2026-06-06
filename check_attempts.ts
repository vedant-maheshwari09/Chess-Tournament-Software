import { db } from "./server/db.ts";
import { uscfVerificationAttempts } from "./shared/schema.ts";
import { desc } from "drizzle-orm";

async function check() {
  try {
    const attempts = await db.select()
      .from(uscfVerificationAttempts)
      .orderBy(desc(uscfVerificationAttempts.id))
      .limit(3);

    console.log("=== Recent Attempts ===");
    for (const attempt of attempts) {
      console.log(`\nAttempt ID: ${attempt.id}`);
      console.log(`Status: ${attempt.status}`);
      console.log(`Confidence Score: ${attempt.confidenceScore}`);
      console.log(`Code Found: ${attempt.codeFound}`);
      console.log(`URL Found: ${attempt.uscfUrlFound}`);
      console.log(`Started Off Profile: ${attempt.startedOffProfile}`);
      console.log(`Navigated To Profile: ${attempt.navigatedToProfile}`);
      console.log(`Member ID: ${attempt.memberIdExtracted}`);
      console.log(`Email: ${attempt.emailExtracted}`);
      console.log(`Failure Reason: ${attempt.failureReason}`);
      console.log(`Created At: ${attempt.createdAt}`);
      console.log(`Completed At: ${attempt.completedAt}`);
    }
  } catch (error) {
    console.error("Error checking attempts:", error);
  } finally {
    process.exit(0);
  }
}

check();
