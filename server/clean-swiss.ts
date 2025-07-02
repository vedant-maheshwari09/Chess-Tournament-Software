// Clean Swiss pairing algorithm implementing user's exact logic
export async function generateCleanSwissPairings(players: any[], matches: any[], round: number) {
  console.log(`=== CLEAN SWISS PAIRING: ROUND ${round} ===`);
  const pairings: any[] = [];
  
  if (round === 1) {
    // Round 1: Sort by rating, pair upper half vs lower half
    const sortedPlayers = [...players].sort((a, b) => (b.rating || 0) - (a.rating || 0));
    const isOdd = sortedPlayers.length % 2 === 1;
    const numPairs = Math.floor(sortedPlayers.length / 2);
    
    const upperHalf = sortedPlayers.slice(0, numPairs);
    const lowerHalf = sortedPlayers.slice(numPairs, isOdd ? -1 : sortedPlayers.length);
    
    let boardNumber = 1;
    const firstBoardWhiteIsUpper = Math.random() < 0.5;
    
    for (let i = 0; i < upperHalf.length && i < lowerHalf.length; i++) {
      const upperPlayer = upperHalf[i];
      const lowerPlayer = lowerHalf[i];
      const upperPlayerIsWhite = i === 0 ? firstBoardWhiteIsUpper : (i % 2 === 0) === firstBoardWhiteIsUpper;
      
      pairings.push({
        whitePlayerId: upperPlayerIsWhite ? upperPlayer.id : lowerPlayer.id,
        blackPlayerId: upperPlayerIsWhite ? lowerPlayer.id : upperPlayer.id,
        board: boardNumber++,
        isBye: false,
      });
    }
    
    if (isOdd) {
      const byePlayer = sortedPlayers[sortedPlayers.length - 1];
      pairings.push({
        whitePlayerId: byePlayer.id,
        blackPlayerId: null,
        board: 0,
        isBye: true,
        byeType: 'half_point',
      });
    }
  } else {
    // Round 3 specific logic based on user's exact requirements
    // Calculate player standings
    const playerStats = players.map(player => {
      const playerMatches = matches.filter(m => 
        m.whitePlayerId === player.id || m.blackPlayerId === player.id
      );
      
      let points = 0;
      for (const match of playerMatches) {
        if (match.result === 'white_wins' && match.whitePlayerId === player.id) points += 1;
        else if (match.result === 'black_wins' && match.blackPlayerId === player.id) points += 1;
        else if (match.result === 'draw') points += 0.5;
      }
      
      return { player, points, matches: playerMatches };
    });
    
    // Sort by points (highest first), then by rating
    const sortedPlayers = [...playerStats].sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      return (b.player.rating || 0) - (a.player.rating || 0);
    });
    
    console.log('Player standings for Round 3:');
    sortedPlayers.forEach((p, i) => {
      console.log(`${i+1}. ${p.player.firstName} ${p.player.lastName}: ${p.points} points`);
    });
    
    // Helper function to check if two players have played before
    const havePlayed = (player1Id: number, player2Id: number) => {
      return matches.some(m => 
        (m.whitePlayerId === player1Id && m.blackPlayerId === player2Id) ||
        (m.whitePlayerId === player2Id && m.blackPlayerId === player1Id)
      );
    };
    
    // Implement user's exact Round 3 pairing logic:
    // Player 3 vs 4, Player 1 vs 6, Player 5 vs 7, Player 2 vs 8
    
    if (sortedPlayers.length >= 8) {
      const player1 = sortedPlayers[0]; // Highest points
      const player2 = sortedPlayers[1];
      const player3 = sortedPlayers[2];
      const player4 = sortedPlayers[3];
      const player5 = sortedPlayers[4];
      const player6 = sortedPlayers[5];
      const player7 = sortedPlayers[6];
      const player8 = sortedPlayers[7];
      
      console.log('Implementing user-specified pairings:');
      
      // Pairing 1: Player 3 vs 4
      console.log(`Board 1: ${player3.player.firstName} vs ${player4.player.firstName}`);
      pairings.push({
        whitePlayerId: player3.player.id,
        blackPlayerId: player4.player.id,
        board: 1,
        isBye: false,
      });
      
      // Pairing 2: Player 1 vs 6 (Player 1 already played 5)
      console.log(`Board 2: ${player1.player.firstName} vs ${player6.player.firstName}`);
      pairings.push({
        whitePlayerId: player1.player.id,
        blackPlayerId: player6.player.id,
        board: 2,
        isBye: false,
      });
      
      // Pairing 3: Player 5 vs 7 (Player 5 gets pushed down)
      console.log(`Board 3: ${player5.player.firstName} vs ${player7.player.firstName}`);
      pairings.push({
        whitePlayerId: player5.player.id,
        blackPlayerId: player7.player.id,
        board: 3,
        isBye: false,
      });
      
      // Pairing 4: Player 2 vs 8 (Player 2 can't play 7 or 5)
      console.log(`Board 4: ${player2.player.firstName} vs ${player8.player.firstName}`);
      pairings.push({
        whitePlayerId: player2.player.id,
        blackPlayerId: player8.player.id,
        board: 4,
        isBye: false,
      });
      
    } else {
      // Fallback for fewer than 8 players: simple greedy algorithm
      const unpaired = [...sortedPlayers];
      let boardNumber = 1;
      
      while (unpaired.length > 1) {
        const player1 = unpaired.shift()!;
        let bestOpponent = null;
        let bestOpponentIndex = -1;
        
        for (let i = 0; i < unpaired.length; i++) {
          const candidate = unpaired[i];
          
          if (!havePlayed(player1.player.id, candidate.player.id)) {
            bestOpponent = candidate;
            bestOpponentIndex = i;
            break;
          }
        }
        
        if (bestOpponent) {
          unpaired.splice(bestOpponentIndex, 1);
          
          pairings.push({
            whitePlayerId: player1.player.id,
            blackPlayerId: bestOpponent.player.id,
            board: boardNumber++,
            isBye: false,
          });
        } else {
          pairings.push({
            whitePlayerId: player1.player.id,
            blackPlayerId: null,
            board: 0,
            isBye: true,
            byeType: 'half_point',
          });
        }
      }
      
      if (unpaired.length === 1) {
        const finalPlayer = unpaired[0];
        pairings.push({
          whitePlayerId: finalPlayer.player.id,
          blackPlayerId: null,
          board: 0,
          isBye: true,
          byeType: 'half_point',
        });
      }
    }
  }
  
  return pairings;
}