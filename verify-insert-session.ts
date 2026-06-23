import { storage } from "./server/storage";

async function run() {
  console.log("Testing storage.createSession...");
  try {
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);
    const session = await storage.createSession(68, "test_verification_token_" + Date.now(), expiresAt);
    console.log("Success! Created session:", session);
    process.exit(0);
  } catch (err: any) {
    console.error("Failed to create session with error:", err.message);
    if (err.originalError) {
      console.error("Original error details:", err.originalError);
    }
    process.exit(1);
  }
}

run();
