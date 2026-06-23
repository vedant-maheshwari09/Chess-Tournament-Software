import type { Tournament } from "@shared/schema";
import type {
  TournamentConfig,
  TournamentMode,
  EntryFeeRule,
  PrizeRule,
  SectionDefinition,
  OfflinePaymentMethod,
  ScoringRules,
} from "@/lib/tournament-config";

export type BuilderMode = "create" | "edit";
export type SettingsShortcutTab = "rate-tournament" | "fide" | "uscf" | "webhook-sync";

export interface TournamentBuilderProps {
  mode: BuilderMode;
  format: Tournament["format"];
  tournament?: Tournament;
  onCancel?: () => void;
  onComplete?: (tournament: Tournament) => void;
  activeSubTab?: string;
  onSubTabChange?: (tab: string) => void;
}

export interface BasicInformationFieldsProps {
  config: TournamentConfig;
  onConfigChange: (config: TournamentConfig) => void;
  variant?: "minimal" | "full";
}

export interface StepTwoProps {
  format: Tournament["format"];
  mode: TournamentMode;
  builderMode: BuilderMode;
  config: TournamentConfig;
  onConfigChange: (config: TournamentConfig) => void;
  onBack: () => void;
  onCancel?: () => void;
  onSave: () => void;
  saving: boolean;
  tournament?: Tournament;
  activeSubTab?: string;
  onSubTabChange?: (tab: string) => void;
}

export interface PaymentsConfigResponse {
  payments: TournamentConfig["payments"];
  publishableKey: string | null;
  onlineConfigured: boolean;
}

export interface ScoreInputProps {
  id: string;
  label: string;
  value: number;
  onChange: (value: string) => void;
  description?: string;
}

export interface TiebreakRowProps {
  index: number;
  total: number;
  value: string;
  onChange: (value: string) => void;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}

export const FORMAT_CARDS: Array<{ 
  id: Tournament["format"];
  title: string;
  description: string;
  features: string[];
}> = [
  {
    id: "swiss",
    title: "Swiss System",
    description:
      "Players are paired by score each round. Best for medium to large events with limited rounds.",
    features: ["Flexible number of rounds", "Smart pairings", "No elimination"],
  },
  {
    id: "roundrobin",
    title: "Round Robin",
    description: "Every player faces each opponent. Ideal for invitational or elite groups.",
    features: ["Balanced schedule", "Single or double round", "Fair pairings"],
  },
  {
    id: "knockout",
    title: "Knockout",
    description: "Elimination brackets with finals. Perfect for playoffs and quick championships.",
    features: ["Brackets", "Automatic advancement", "Supports seeding"],
  },
  {
    id: "arena",
    title: "Arena",
    description: "Players are continuously paired in a time-based format. Ideal for quick, high-volume events.",
    features: ["Time-based pairings", "Continuous play", "High volume"],
  },
];

export const MODE_OPTIONS: Array<{ id: TournamentMode; label: string; description: string }> = [
  {
    id: "online",
    label: "Online Event",
    description: "Optimized for virtual tournaments with quick registration links and remote play workflows.",
  },
  {
    id: "rated",
    label: "Standard Event",
    description: "Includes federation reporting, USCF/ FIDE forms, and official compliance steps.",
  },
];

export const FEDERATION_OPTIONS = [
  { code: "United States", label: "United States" },
  { code: "Canada", label: "Canada" },
  { code: "United Kingdom", label: "United Kingdom" },
  { code: "Germany", label: "Germany" },
  { code: "France", label: "France" },
  { code: "Spain", label: "Spain" },
  { code: "India", label: "India" },
  { code: "China", label: "China" },
  { code: "Australia", label: "Australia" },
];

export const TIME_CONTROL_OPTIONS = [
  { value: "standard", label: "Standard" },
  { value: "rapid", label: "Rapid" },
  { value: "blitz", label: "Blitz" },
];

export const TIEBREAK_OPTIONS = [
  { value: "Points", label: "Points" },
  { value: "Modified Median", label: "Modified Median" },
  { value: "Solkoff", label: "Solkoff" },
  { value: "Buchholz", label: "Buchholz" },
  { value: "Median", label: "Median" },
  { value: "Cumulative", label: "Cumulative" },
  { value: "Sonneborn-Berger", label: "Sonneborn-Berger" },
  { value: "Kashdan", label: "Kashdan" },
  { value: "Opponent's Cumulative", label: "Opponent's Cumulative" },
  { value: "Opponent Average Rating", label: "Opponent Average Rating" },
  { value: "Number of Wins", label: "Number of Wins" },
];

export const RATING_TYPE_OPTIONS = [
  { value: "standard", label: "Standard" },
  { value: "rapid", label: "Rapid" },
  { value: "blitz", label: "Blitz" },
];

export const ENTRY_FEE_CURRENCY_OPTIONS = ["USD", "CAD", "EUR"] as const;

export const OFFLINE_METHOD_OPTIONS: Array<{ id: OfflinePaymentMethod; label: string; hint?: string }> = [
  { id: "cash", label: "Cash" },
  { id: "check", label: "Check" },
  { id: "venmo", label: "Venmo" },
  { id: "zelle", label: "Zelle" },
  { id: "paypal", label: "PayPal" },
  { id: "other", label: "Other" },
];
