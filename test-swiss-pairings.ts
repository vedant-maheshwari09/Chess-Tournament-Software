import { generateSwissPairings } from './server/routes/common';

// Define the 9 players matching the sheet
const players = [
  { id: 1, firstName: 'ALPHA', lastName: '', uscfRating: 2200, rating: 2200, status: 'active' },
  { id: 2, firstName: 'BRAVO', lastName: '', uscfRating: 2000, rating: 2000, status: 'active' },
  { id: 3, firstName: 'CHARLEY', lastName: '', uscfRating: 1800, rating: 1800, status: 'active' },
  { id: 4, firstName: 'DELTA', lastName: '', uscfRating: 1600, rating: 1600, status: 'active' },
  { id: 5, firstName: 'ECHO', lastName: '', uscfRating: 1400, rating: 1400, status: 'active' },
  { id: 6, firstName: 'FOXTROT', lastName: '', uscfRating: 1200, rating: 1200, status: 'active' },
  { id: 7, firstName: 'GOLF', lastName: '', uscfRating: 1000, rating: 1000, status: 'active' },
  { id: 8, firstName: 'HOTEL', lastName: '', uscfRating: 800, rating: 800, status: 'active' },
  { id: 9, firstName: 'INDIA', lastName: '', uscfRating: 0, rating: 0, status: 'active', federation: 'unrated' } // Unrated
];

const playerMap = new Map(players.map(p => [p.id, p]));
const getPlayerName = (id: number | null) => id ? playerMap.get(id)?.firstName : 'Bye';

const tournament = {
  id: 1,
  format: 'swiss',
  config: JSON.stringify({
    details: {
      primaryRatingSystem: 'uscf'
    }
  })
};

async function runTests() {
  console.log("=== STARTING SWISS PAIRING ENGINE VERIFICATION ===");

  // --- ROUND 1 ---
  console.log("\n--- Round 1 Generation ---");
  const round1Pairings = await generateSwissPairings(tournament, players, [], 1, []);
  console.log("Round 1 Pairings generated:");
  for (const p of round1Pairings) {
    console.log(`Board ${p.board}: ${getPlayerName(p.whitePlayerId)} (W) vs ${getPlayerName(p.blackPlayerId)} (B) ${p.isBye ? '[BYE]' : ''}`);
  }

  // Verify Round 1 rules: HOTEL got the bye, INDIA played DELTA
  const round1Bye = round1Pairings.find(p => p.isBye);
  if (round1Bye && round1Bye.whitePlayerId === 8) {
    console.log("✅ SUCCESS: HOTEL (lowest rated rated player) received the bye. Unrated INDIA played.");
  } else {
    console.error("❌ FAILURE: Wrong Round 1 bye recipient.", round1Bye);
  }

  // --- ROUND 2 ---
  console.log("\n--- Round 2 Generation ---");
  const round1Matches = [
    { id: 101, tournamentId: 1, round: 1, board: 1, whitePlayerId: 5, blackPlayerId: 1, result: '0-1', status: 'completed' }, // ECHO vs ALPHA -> ALPHA won
    { id: 102, tournamentId: 1, round: 1, board: 2, whitePlayerId: 2, blackPlayerId: 6, result: '1/2-1/2', status: 'completed' }, // BRAVO vs FOXTROT -> DRAW
    { id: 103, tournamentId: 1, round: 1, board: 3, whitePlayerId: 7, blackPlayerId: 3, result: '0-1', status: 'completed' }, // GOLF vs CHARLEY -> CHARLEY won
    { id: 104, tournamentId: 1, round: 1, board: 4, whitePlayerId: 4, blackPlayerId: 9, result: '1-0', status: 'completed' }  // DELTA vs INDIA -> DELTA won
  ];

  const round1PairingsDb = [
    { tournamentId: 1, round: 1, playerId: 5, opponentId: 1, color: 'white', points: 0, isBye: false },
    { tournamentId: 1, round: 1, playerId: 1, opponentId: 5, color: 'black', points: 0, isBye: false },
    { tournamentId: 1, round: 1, playerId: 2, opponentId: 6, color: 'white', points: 0, isBye: false },
    { tournamentId: 1, round: 1, playerId: 6, opponentId: 2, color: 'black', points: 0, isBye: false },
    { tournamentId: 1, round: 1, playerId: 7, opponentId: 3, color: 'white', points: 0, isBye: false },
    { tournamentId: 1, round: 1, playerId: 3, opponentId: 7, color: 'black', points: 0, isBye: false },
    { tournamentId: 1, round: 1, playerId: 4, opponentId: 9, color: 'white', points: 0, isBye: false },
    { tournamentId: 1, round: 1, playerId: 9, opponentId: 4, color: 'black', points: 0, isBye: false },
    { tournamentId: 1, round: 1, playerId: 8, opponentId: null, color: null, points: 2, isBye: true } // HOTEL bye
  ];

  const round2Pairings = await generateSwissPairings(tournament, players, round1Matches, 2, round1PairingsDb);
  console.log("Round 2 Pairings generated:");
  for (const p of round2Pairings) {
    console.log(`Board ${p.board}: ${getPlayerName(p.whitePlayerId)} (W) vs ${getPlayerName(p.blackPlayerId)} (B) ${p.isBye ? '[BYE]' : ''}`);
  }

  const round2Bye = round2Pairings.find(p => p.isBye);
  if (round2Bye && round2Bye.whitePlayerId === 7) {
    console.log("✅ SUCCESS: GOLF received the bye.");
  } else {
    console.error("❌ FAILURE: Wrong Round 2 bye recipient.", round2Bye);
  }

  // --- ROUND 3 ---
  console.log("\n--- Round 3 Generation ---");
  const round2Matches = [
    { id: 201, tournamentId: 1, round: 2, board: 1, whitePlayerId: 1, blackPlayerId: 4, result: '1/2-1/2', status: 'completed' }, // ALPHA vs DELTA
    { id: 202, tournamentId: 1, round: 2, board: 2, whitePlayerId: 3, blackPlayerId: 8, result: '1-0', status: 'completed' }, // CHARLEY vs HOTEL
    { id: 203, tournamentId: 1, round: 2, board: 3, whitePlayerId: 6, blackPlayerId: 5, result: '1/2-1/2', status: 'completed' }, // FOXTROT vs ECHO
    { id: 204, tournamentId: 1, round: 2, board: 4, whitePlayerId: 9, blackPlayerId: 2, result: '1/2-1/2', status: 'completed' }  // INDIA vs BRAVO
  ];

  const round2PairingsDb = [
    ...round1PairingsDb,
    { tournamentId: 1, round: 2, playerId: 1, opponentId: 4, color: 'white', points: 1, isBye: false },
    { tournamentId: 1, round: 2, playerId: 4, opponentId: 1, color: 'black', points: 1, isBye: false },
    { tournamentId: 1, round: 2, playerId: 3, opponentId: 8, color: 'white', points: 2, isBye: false },
    { tournamentId: 1, round: 2, playerId: 8, opponentId: 3, color: 'black', points: 0, isBye: false },
    { tournamentId: 1, round: 2, playerId: 6, opponentId: 5, color: 'white', points: 1, isBye: false },
    { tournamentId: 1, round: 2, playerId: 5, opponentId: 6, color: 'black', points: 1, isBye: false },
    { tournamentId: 1, round: 2, playerId: 9, opponentId: 2, color: 'white', points: 1, isBye: false },
    { tournamentId: 1, round: 2, playerId: 2, opponentId: 9, color: 'black', points: 1, isBye: false },
    { tournamentId: 1, round: 2, playerId: 7, opponentId: null, color: null, points: 2, isBye: true } // GOLF bye
  ];

  const allMatches = [...round1Matches, ...round2Matches];
  const allPairings = [...round1PairingsDb, ...round2PairingsDb];

  const round3Pairings = await generateSwissPairings(tournament, players, allMatches, 3, allPairings);
  console.log("Round 3 Pairings generated:");
  for (const p of round3Pairings) {
    console.log(`Board ${p.board}: ${getPlayerName(p.whitePlayerId)} (W) vs ${getPlayerName(p.blackPlayerId)} (B) ${p.isBye ? '[BYE]' : ''}`);
  }

  // --- ROUND 4 ---
  console.log("\n--- Round 4 Generation ---");
  const round3Matches = [
    { id: 301, tournamentId: 1, round: 3, board: 1, whitePlayerId: 4, blackPlayerId: 3, result: '0-1', status: 'completed' }, // DELTA vs CHARLEY
    { id: 302, tournamentId: 1, round: 3, board: 2, whitePlayerId: 8, blackPlayerId: 1, result: '0-1', status: 'completed' }, // HOTEL vs ALPHA
    { id: 303, tournamentId: 1, round: 3, board: 3, whitePlayerId: 2, blackPlayerId: 7, result: '1-0', status: 'completed' }, // BRAVO vs GOLF
    { id: 304, tournamentId: 1, round: 3, board: 4, whitePlayerId: 5, blackPlayerId: 6, result: '1-0', status: 'completed' }  // ECHO vs FOXTROT
  ];

  const round3PairingsDb = [
    ...round2PairingsDb,
    { tournamentId: 1, round: 3, playerId: 4, opponentId: 3, color: 'white', points: 0, isBye: false },
    { tournamentId: 1, round: 3, playerId: 3, opponentId: 4, color: 'black', points: 2, isBye: false },
    { tournamentId: 1, round: 3, playerId: 8, opponentId: 1, color: 'white', points: 0, isBye: false },
    { tournamentId: 1, round: 3, playerId: 1, opponentId: 8, color: 'black', points: 2, isBye: false },
    { tournamentId: 1, round: 3, playerId: 2, opponentId: 7, color: 'white', points: 2, isBye: false },
    { tournamentId: 1, round: 3, playerId: 7, opponentId: 2, color: 'black', points: 0, isBye: false },
    { tournamentId: 1, round: 3, playerId: 5, opponentId: 6, color: 'white', points: 2, isBye: false },
    { tournamentId: 1, round: 3, playerId: 6, opponentId: 5, color: 'black', points: 0, isBye: false }
  ];

  const allMatchesR4 = [...allMatches, ...round3Matches];
  const allPairingsR4 = [...allPairings, ...round3PairingsDb];

  const round4Pairings = await generateSwissPairings(tournament, players, allMatchesR4, 4, allPairingsR4);
  console.log("Round 4 Pairings generated:");
  for (const p of round4Pairings) {
    console.log(`Board ${p.board}: ${getPlayerName(p.whitePlayerId)} (W) vs ${getPlayerName(p.blackPlayerId)} (B) ${p.isBye ? '[BYE]' : ''}`);
  }

  const round4Bye = round4Pairings.find(p => p.isBye);
  if (round4Bye && round4Bye.whitePlayerId === 6) {
    console.log("✅ SUCCESS: Backtracking chose FOXTROT for the bye (avoiding duplicate bye for GOLF/HOTEL and unrated INDIA).");
  } else {
    console.error("❌ FAILURE: Wrong Round 4 bye recipient.", round4Bye);
  }

  const golfPlayEcho = round4Pairings.some(p =>
    (p.whitePlayerId === 7 && p.blackPlayerId === 5) || (p.whitePlayerId === 5 && p.blackPlayerId === 7)
  );
  if (golfPlayEcho) {
    console.log("✅ SUCCESS: GOLF plays ECHO.");
  } else {
    console.error("❌ FAILURE: GOLF did not play ECHO.");
  }

  const bravoPlayDelta = round4Pairings.some(p =>
    (p.whitePlayerId === 2 && p.blackPlayerId === 4) || (p.whitePlayerId === 4 && p.blackPlayerId === 2)
  );
  if (bravoPlayDelta) {
    console.log("✅ SUCCESS: BRAVO plays DELTA.");
  } else {
    console.error("❌ FAILURE: BRAVO did not play DELTA.");
  }

  console.log("\n=== SWISS PAIRING ENGINE VERIFICATION COMPLETE ===");
}

runTests().catch(console.error);
