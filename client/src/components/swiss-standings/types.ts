import type { Player, Match, Pairing, Tournament } from "@shared/schema";

export interface SwissStandingsProps {
  tournamentId: number;
  showExportControls?: boolean;
}

export interface PlayerRoundResult {
  opponent: Player | null;
  opponentPosition: number;
  result:
    | 'W'
    | 'L'
    | 'D'
    | 'bye'
    | 'withdrawn'
    | 'forfeit-win'
    | 'forfeit-loss'
    | 'unplayed'
    | 'double-forfeit';
  color: 'white' | 'black' | null;
  points: number;
  isRequested?: boolean;
  isInProgress?: boolean;
  board?: number;
}

export interface SwissPlayerStanding {
  player: Player;
  position: number;
  totalPoints: number;
  roundResults: PlayerRoundResult[];
  isWithdrawn: boolean;
  tiebreakValues: Record<string, number>;
  prizeCategory?: string;
  prizeAmount?: string;
  postRating?: number;
  performanceRating?: number;
}
