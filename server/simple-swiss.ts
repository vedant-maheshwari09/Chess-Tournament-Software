// Simple Swiss pairing algorithm that prioritizes avoiding repeat pairings
export async function generateSimpleSwissPairings(players: any[], matches: any[], round: number) {
  console.log('=== SIMPLE SWISS PAIRING: NO REPEAT PAIRINGS PRIORITY ===');
  const pairings: any[] = [];
  
  if (round === 1) {
    // Round 1: Simple rating-based pairing
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
    // Subsequent rounds: Simple greedy approach
    // Calculate player stats based on matches
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
      
      return { player, points };
    });
    
    // Sort by points (highest first), then by rating
    const sortedPlayers = [...playerStats].sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      return (b.player.rating || 0) - (a.player.rating || 0);
    });
    
    const unpaired = [...sortedPlayers];
    let boardNumber = 1;
    
    // Simple greedy pairing: For each player, find first opponent they haven't played
    while (unpaired.length > 1) {
      const player1 = unpaired.shift()!;
      let bestOpponent = null;
      let bestOpponentIndex = -1;
      
      console.log(`Finding opponent for ${player1.player.firstName} (${player1.points}pts)`);
      
      // Search for first opponent they haven't played
      for (let i = 0; i < unpaired.length; i++) {
        const candidate = unpaired[i];
        
        // Check if they've played before
        const hasPlayed = matches.some(m => 
          (m.whitePlayerId === player1.player.id && m.blackPlayerId === candidate.player.id) ||
          (m.whitePlayerId === candidate.player.id && m.blackPlayerId === player1.player.id)
        );
        
        console.log(`  vs ${candidate.player.firstName} (${candidate.points}pts): hasPlayed=${hasPlayed}`);
        
        if (!hasPlayed) {
          bestOpponent = candidate;
          bestOpponentIndex = i;
          console.log(`  ✓ PAIRED: ${player1.player.firstName} vs ${candidate.player.firstName}`);
          break;
        }
      }
      
      if (bestOpponent) {
        // Remove opponent from list
        unpaired.splice(bestOpponentIndex, 1);
        
        // Simple color assignment (can be improved later)
        const whitePlayer = Math.random() < 0.5 ? player1.player : bestOpponent.player;
        const blackPlayer = whitePlayer === player1.player ? bestOpponent.player : player1.player;
        
        pairings.push({
          whitePlayerId: whitePlayer.id,
          blackPlayerId: blackPlayer.id,
          board: boardNumber++,
          isBye: false,
        });
      } else {
        console.log(`  No new opponent for ${player1.player.firstName} - giving bye`);
        pairings.push({
          whitePlayerId: player1.player.id,
          blackPlayerId: null,
          board: 0,
          isBye: true,
          byeType: 'half_point',
        });
      }
    }
    
    // Handle final player with bye if needed
    if (unpaired.length === 1) {
      const finalPlayer = unpaired[0];
      console.log(`Final bye: ${finalPlayer.player.firstName}`);
      pairings.push({
        whitePlayerId: finalPlayer.player.id,
        blackPlayerId: null,
        board: 0,
        isBye: true,
        byeType: 'half_point',
      });
    }
  }
  
  return pairings;
}