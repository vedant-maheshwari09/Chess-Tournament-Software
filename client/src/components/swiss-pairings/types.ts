import type { Match, Player, Pairing, Tournament } from "@shared/schema";
import type { SectionDefinition } from "@shared/tournament-config";

export interface TournamentPairingsProps {
  tournamentId: number;
  activeSection: string;
  showExportControls?: boolean;
  isEditMode: boolean;
  setIsEditMode: (val: boolean) => void;
}

export type PendingResultsMap = Record<number, string>;
