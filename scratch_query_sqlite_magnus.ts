import { fetchLiveUscfRating } from './server/lib/uscf-live';

async function main() {
  const data = await fetchLiveUscfRating("15218438");
  console.log("LIVE USCF DATA FOR MAGNUS:", JSON.stringify(data, null, 2));
}

main().catch(console.error);
