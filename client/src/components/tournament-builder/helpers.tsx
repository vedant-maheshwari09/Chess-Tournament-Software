import React from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { ChevronUp, ChevronDown, Trash2, X } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { ScheduleEvent, PrizeRule, SectionDefinition, EntryFeeRule, TournamentConfig } from "@/lib/tournament-config";
import { SCHEDULE_EVENT_OPTIONS } from "@/lib/tournament-config";
import { TIEBREAK_OPTIONS } from "./types";

export function fileToText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result?.toString() ?? "");
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

export function downloadJson(filename: string, data: unknown) {
  if (typeof window === "undefined") return;
  const payload = JSON.stringify(data, null, 2);
  const blob = new Blob([payload], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function cloneConfig(config: TournamentConfig): TournamentConfig {
  return JSON.parse(JSON.stringify(config)) as TournamentConfig;
}

export const templateLabelToRound = (label: string): number | null => {
  const match = label.match(/^Round\s+(\d+)/i);
  if (!match) return null;
  const value = parseInt(match[1] ?? "", 10);
  return Number.isFinite(value) ? value : null;
};

export const ensureRoundSchedule = (schedule: ScheduleEvent[], rounds: number): ScheduleEvent[] => {
  const roundEvents: ScheduleEvent[] = [];
  const nonRoundEvents: ScheduleEvent[] = [];
  const seenRounds = new Set<number>();

  schedule.forEach((event) => {
    if (event.round && event.round >= 1 && event.round <= rounds) {
      if (!seenRounds.has(event.round)) {
        seenRounds.add(event.round);
        roundEvents.push({
          ...event,
          label: event.label || `Round ${event.round}`,
          round: event.round,
        });
      }
    } else if (event.round && event.round > rounds) {
      // Intentionally drop rounds that exceed the current round count.
      // This prevents "ghost" rounds (e.g. Round 7-9 when only 6 are selected)
      // from showing up as unlinked events.
    } else {
      nonRoundEvents.push(event);
    }
  });

  for (let round = 1; round <= rounds; round++) {
    if (!seenRounds.has(round)) {
      roundEvents.push({
        id: `${Date.now()}-${round}-${Math.random()}`,
        date: null,
        time: null,
        label: SCHEDULE_EVENT_OPTIONS[round - 1] ?? `Round ${round}`,
        round,
      });
    }
  }

  roundEvents.sort((a, b) => (a.round ?? 0) - (b.round ?? 0));
  return [...roundEvents, ...nonRoundEvents];
};

export interface ScoreInputProps {
  id: string;
  label: string;
  value: number;
  onChange: (value: string) => void;
  description?: string;
}

export function ScoreInput({ id, label, value, onChange, description }: ScoreInputProps) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id} className="text-sm font-medium">{label}</Label>
      <Input
        id={id}
        type="number"
        step="0.5"
        value={Number.isFinite(value) ? value : 0}
        onChange={(event) => onChange(event.target.value)}
      />
      {description && <p className="text-[10px] text-muted-foreground">{description}</p>}
    </div>
  );
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

export function TiebreakRow({ index, total, value, onChange, onRemove, onMoveUp, onMoveDown }: TiebreakRowProps) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white p-3">
      <span className="w-6 text-center text-xs font-semibold text-slate-500">{index + 1}</span>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="flex-1 bg-white border-slate-200">
          <SelectValue placeholder="Select tiebreaker..." />
        </SelectTrigger>
        <SelectContent>
          {TIEBREAK_OPTIONS.map((opt) => (
            <SelectItem key={opt.value} value={opt.label}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Move up"
          disabled={index === 0}
          onClick={onMoveUp}
        >
          <ChevronUp className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Move down"
          disabled={index === total - 1}
          onClick={onMoveDown}
        >
          <ChevronDown className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Remove"
          onClick={onRemove}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

export function formatRatingRange(min: number | null, max: number | null): string {
  if (min !== null && max !== null) {
    return `Rating ${min}–${max}`;
  }
  if (min !== null) {
    return `Rating ${min}+`;
  }
  if (max !== null) {
    return `Rating ≤${max}`;
  }
  return "Open to all ratings";
}

export function createSectionDefinition(existingCount?: number): SectionDefinition {
  const index = typeof existingCount === "number" ? existingCount : 0;
  return {
    id: generateSectionId(),
    name: `Section ${index + 1}`,
    ratingMin: null,
    ratingMax: null,
    description: undefined,
  };
}

export function createEntryFeeRow(section?: SectionDefinition, defaultCurrency = "USD"): EntryFeeRule {
  return {
    id: generateEntryFeeId(),
    sectionId: section?.id,
    section: section?.name ?? "",
    ratingMin: null,
    ratingMax: null,
    amount: 0,
    currency: defaultCurrency,
    effectiveAfter: null,
  };
}

export function createPrizeRow(section?: SectionDefinition, defaultCurrency = "USD"): PrizeRule {
  return {
    id: generatePrizeId(),
    sectionId: section?.id,
    section: section?.name ?? "",
    ratingCap: section?.ratingMax ?? null,
    place: "",
    amount: 0,
    currency: defaultCurrency,
  };
}

export function generateEntryFeeId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `fee-${Math.random().toString(36).slice(2, 10)}`;
}

export function generatePrizeId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `prize-${Math.random().toString(36).slice(2, 10)}`;
}

export function generateSectionId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `section-${Math.random().toString(36).slice(2, 10)}`;
}

