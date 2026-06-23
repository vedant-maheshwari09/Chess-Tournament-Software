import { preloadRatingData } from "../server/lib/localRatings";
import { unlinkSync, existsSync } from "fs";
import path from "path";

async function main() {
  console.log("-----------------------------------------------------------------");
  console.log("🚀 STARTING BUILD-TIME RATINGS CACHE PRELOAD...");
  console.log("-----------------------------------------------------------------");
  
  // Note: we let preloadRatingData handle checking if the DB is already valid.
  // However, during a fresh deploy, it won't be valid, so it will download and build.
  // We call it here to run the build-time download and build.
  await preloadRatingData();
  
  // Clean up large raw text files to keep slug size small
  const filesToDelete = [
    "GDB2510T.TXT",
    "GDQ2510T.TXT",
    "players_list-fide-oct-2025.txt",
    "GDB2510T.TXT.tmp",
    "GDQ2510T.TXT.tmp",
    "players_list-fide-oct-2025.txt.tmp"
  ];
  
  console.log("-----------------------------------------------------------------");
  console.log("🧹 CLEANING UP LARGE RAW RATINGS FILES...");
  console.log("-----------------------------------------------------------------");
  for (const file of filesToDelete) {
    const filePath = path.resolve(process.cwd(), file);
    if (existsSync(filePath)) {
      console.log(`Cleaning up: ${file}`);
      try {
        unlinkSync(filePath);
      } catch (err) {
        console.error(`Failed to delete ${file}:`, err);
      }
    }
  }
  console.log("✅ Ratings cache build-time preload complete!");
}

main().catch(err => {
  console.error("❌ Ratings cache build failed:", err);
  process.exit(1);
});
