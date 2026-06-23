import React from "react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { TournamentConfig } from "@/lib/tournament-config";
import { ScoreInput } from "./helpers";

export function ArenaSettingsTab({ config, onConfigChange, onSave, saving }: { config: TournamentConfig; onConfigChange: (c: TournamentConfig) => void; onSave: () => void; saving: boolean }) {
  const arena = config.arena ?? {
    durationMinutes: 60,
    scoring: {
      winPoints: 2,
      drawPoints: 1,
      lossPoints: 0,
      streakThreshold: 2,
      onFireWinPoints: 4,
      onFireDrawPoints: 2,
    },
  };

  const updateArena = (updates: Partial<typeof arena>) => {
    onConfigChange({
      ...config,
      arena: { ...arena, ...updates },
    });
  };

  const updateScoring = (updates: Partial<typeof arena.scoring>) => {
    updateArena({
      scoring: { ...arena.scoring, ...updates },
    });
  };

  return (
    <div className="bg-white p-6 space-y-6">
      <div className="space-y-4">
        <h3 className="text-base font-medium text-black">Arena Timing</h3>
        <div className="grid gap-6 md:grid-cols-2">
          <div className="space-y-2">
            <Label>Duration (Minutes)</Label>
            <Input
              type="number"
              value={arena.durationMinutes}
              onChange={(e) => updateArena({ durationMinutes: parseInt(e.target.value) || 0 })}
            />
            <p className="text-xs text-muted-foreground">The arena will automatically conclude after this time.</p>
          </div>
          
          <div className="space-y-2">
            <Label>Cutoff Window (Minutes)</Label>
            <div className="flex items-center gap-2">
              <Input 
                type="number"
                value={arena.arenaCutoffMinutes || 2}
                onChange={(e) => updateArena({ arenaCutoffMinutes: parseInt(e.target.value) || 0 })}
                className="w-24"
              />
              <span className="text-sm font-medium">min</span>
            </div>
            <p className="text-xs text-muted-foreground">No new matches will start when less than this time remains.</p>
          </div>

          <div className="space-y-2">
            <Label>Startup Countdown</Label>
            <Select 
              value={String(arena.arenaCountdownSeconds || 10)}
              onValueChange={(val) => updateArena({ arenaCountdownSeconds: parseInt(val) })}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select Countdown" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="10">10 Seconds</SelectItem>
                <SelectItem value="30">30 Seconds</SelectItem>
                <SelectItem value="60">1 Minute</SelectItem>
                <SelectItem value="120">2 Minutes</SelectItem>
                <SelectItem value="300">5 Minutes</SelectItem>
                <SelectItem value="600">10 Minutes</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">Duration of the waiting period after clicking "Start".</p>
          </div>
        </div>

        <div className="grid gap-6 md:grid-cols-2 pt-4 border-t">
          <div className="space-y-4">
            <Label className="text-[15px] font-medium text-black flex items-center gap-2">
              End Strategy
            </Label>
            <RadioGroup 
              value={arena.arenaEndStrategy || "wait_for_ongoing"} 
              onValueChange={(val: 'wait_for_ongoing' | 'force_end') => updateArena({ arenaEndStrategy: val })}
              className="flex flex-col gap-4"
            >
              <div className="flex items-start space-x-3 border-2 border-slate-100 rounded-2xl p-4 hover:border-slate-200 hover:bg-slate-50/50 transition-all cursor-pointer">
                <RadioGroupItem value="wait_for_ongoing" id="builder-wait" className="mt-1" />
                <Label htmlFor="builder-wait" className="flex-1 cursor-pointer space-y-0.5">
                  <span className="block text-base font-semibold text-black leading-tight">Wait for Ongoing Games</span>
                  <span className="block text-xs text-slate-500 leading-tight">Timer stops pairings, finishes active matches.</span>
                </Label>
              </div>
              <div className="flex items-start space-x-3 border-2 border-slate-100 rounded-2xl p-4 hover:border-slate-200 hover:bg-slate-50/50 transition-all cursor-pointer">
                <RadioGroupItem value="force_end" id="builder-force" className="mt-1" />
                <Label htmlFor="builder-force" className="flex-1 cursor-pointer space-y-0.5">
                  <span className="block text-base font-semibold text-black leading-tight">Force End Immediately</span>
                  <span className="block text-xs text-slate-500 leading-tight">Tournament completes exactly at 0:00.</span>
                </Label>
              </div>
            </RadioGroup>
          </div>

          <div className="space-y-4">
            <div className="flex items-center justify-between border rounded-lg p-4 bg-slate-50/50">
              <div className="space-y-0.5">
                <p className="text-[15px] font-medium text-black">Auto-Pairing Engine</p>
                <p className="text-[10px] text-muted-foreground">Enable automated matching pool</p>
              </div>
              <Switch 
                checked={arena.arenaPairingMode === 'automatic'}
                onCheckedChange={(checked) => updateArena({ arenaPairingMode: checked ? 'automatic' : 'manual' })}
              />
            </div>

            <div className="flex items-center justify-between border rounded-lg p-4 bg-slate-50/50">
              <div className="space-y-0.5">
                <p className="text-[15px] font-medium text-black">Pre-pair Before Start</p>
                <p className="text-[10px] text-muted-foreground">Match all players in lobby immediately</p>
              </div>
              <Switch 
                checked={!!arena.arenaPrePairBeforeStart}
                onCheckedChange={(checked) => updateArena({ arenaPrePairBeforeStart: checked })}
              />
            </div>
          </div>
        </div>

        <div className="space-y-4 pt-4 border-t">
          <h3 className="text-base font-medium text-black">Arena Scoring & Streaks</h3>
          <div className="grid gap-4 md:grid-cols-3">
            <ScoreInput
              id="arena-win"
              label="Base Win"
              value={arena.scoring.winPoints}
              onChange={(v) => updateScoring({ winPoints: parseFloat(v) || 0 })}
            />
            <ScoreInput
              id="arena-draw"
              label="Base Draw"
              value={arena.scoring.drawPoints}
              onChange={(v) => updateScoring({ drawPoints: parseFloat(v) || 0 })}
            />
            <ScoreInput
              id="arena-loss"
              label="Base Loss"
              value={arena.scoring.lossPoints}
              onChange={(v) => updateScoring({ lossPoints: parseFloat(v) || 0 })}
            />
          </div>
          <div className="grid gap-4 md:grid-cols-3 pt-2">
            <div className="space-y-2">
              <Label>Streak Threshold</Label>
              <Input
                type="number"
                value={arena.scoring.streakThreshold}
                onChange={(e) => updateScoring({ streakThreshold: parseInt(e.target.value) || 0 })}
              />
              <p className="text-[10px] text-muted-foreground">Consecutive wins to become "On Fire".</p>
            </div>
            <ScoreInput
              id="arena-fire-win"
              label="Fire Win Bonus"
              value={arena.scoring.onFireWinPoints}
              onChange={(v) => updateScoring({ onFireWinPoints: parseFloat(v) || 0 })}
            />
            <ScoreInput
              id="arena-fire-draw"
              label="Fire Draw Bonus"
              value={arena.scoring.onFireDrawPoints}
              onChange={(v) => updateScoring({ onFireDrawPoints: parseFloat(v) || 0 })}
            />
          </div>
        </div>
      </div>

      <div className="flex justify-end pt-4 border-t">
        <Button onClick={onSave} disabled={saving}>
          {saving ? "Saving..." : "Save Configuration"}
        </Button>
      </div>
    </div>
  );
}

