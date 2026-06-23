import React, { useEffect, useMemo, useRef } from "react";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DatePicker } from "@/components/ui/date-picker";
import { TimePicker } from "@/components/ui/time-picker";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Check, ChevronRight, Upload } from "lucide-react";
import { parseISO, format as formatDateFn } from "date-fns";
import { cn } from "@/lib/utils";
import type { Tournament } from "@shared/schema";
import { useToast } from "@/hooks/use-toast";
import {
  type TournamentConfig,
  type TournamentMode,
  createDefaultConfig,
  parseTournamentConfig,
} from "@/lib/tournament-config";
import {
  isTournamentTemplateSnapshot,
  applyTournamentTemplateSnapshot,
  type TournamentTemplateSnapshot,
  type TemplateSectionKey,
  TOURNAMENT_TEMPLATE_OPTIONS,
} from "@/lib/tournament-templates";
import {
  FORMAT_CARDS,
  MODE_OPTIONS,
  FEDERATION_OPTIONS,
  TIME_CONTROL_OPTIONS,
  type BuilderMode,
  type BasicInformationFieldsProps,
} from "./types";
import { ensureRoundSchedule, fileToText } from "./helpers";

export function BasicInformationFields({ config, onConfigChange, variant = "full" }: BasicInformationFieldsProps) {
  const updateBasic = (updates: Partial<TournamentConfig["basic"]>) => {
    onConfigChange({
      ...config,
      basic: { ...config.basic, ...updates },
    });
  };
  const updateRegisters = (updates: Partial<TournamentConfig["registers"]>) => {
    onConfigChange({
      ...config,
      registers: { ...config.registers, ...updates },
    });
  };
  const handleCityStateChange = (raw: string) => {
    // Allows letters, numbers, spaces, commas, hyphens, and periods
    const sanitized = raw.replace(/[^0-9a-zA-Z\s.,-]+/g, "");
    updateBasic({ state: sanitized });
  };

  const openMaps = (provider: "google" | "apple") => {
    const query = config.basic.city.trim();
    if (!query) return;
    const url =
      provider === "google"
        ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}` 
        : `https://maps.apple.com/?q=${encodeURIComponent(query)}`;
    window.open(url, "_blank");
  };

  const updateDetails = (updates: Partial<TournamentConfig["details"]>) => {
    onConfigChange({
      ...config,
      details: { ...config.details, ...updates },
    });
  };

  const handleRoundsChange = (val: number) => {
    const nextRounds = Number.isFinite(val) && val > 0 ? val : 1;
    // When rounds change in basic info, immediately sync the schedule
    // This ensures that the schedule tab is pre-populated with the correct number of rows
    onConfigChange({
      ...config,
      details: { ...config.details, rounds: nextRounds },
      schedule: ensureRoundSchedule(config.schedule, nextRounds),
    });
  };

  if (variant === "minimal") {
    return (
      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="tournament-name">Tournament Name</Label>
          <Input
            id="tournament-name"
            value={config.basic.name}
            onChange={(event) => updateBasic({ name: event.target.value })}
            placeholder="e.g., San Diego Fall Open"
          />
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          {config.format !== 'arena' && config.format !== 'knockout' && (
            <div className="space-y-2">
              <Label htmlFor="basic-rounds">Rounds</Label>
              <Input
                id="basic-rounds"
                type="number"
                min={1}
                value={config.details.rounds}
                onChange={(event) => handleRoundsChange(parseInt(event.target.value, 10))}
              />
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="basic-city-state">City &amp; State (2-letter)</Label>
            <Input
              id="basic-city-state"
              value={config.basic.state}
              onChange={(event) => handleCityStateChange(event.target.value)}
              placeholder="e.g., San Diego, CA"
            />
            <p className="text-xs text-muted-foreground">Example: San Diego, CA</p>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="basic-start-date">Start Date</Label>
            <DatePicker
              date={config.basic.startDate ? parseISO(config.basic.startDate) : null}
              setDate={(date) => updateBasic({ startDate: date ? formatDateFn(date, "yyyy-MM-dd") : null })}
              placeholder="Select start date"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="basic-end-date">End Date</Label>
            <DatePicker
              date={config.basic.endDate ? parseISO(config.basic.endDate) : null}
              setDate={(date) => updateBasic({ endDate: date ? formatDateFn(date, "yyyy-MM-dd") : null })}
              placeholder="Select end date"
            />
          </div>
        </div>
        {config.format !== 'knockout' && (
          <div className="flex items-center space-x-2 opacity-50 cursor-not-allowed">
            <Switch
              id="team-event"
              checked={false}
              disabled={true}
              onCheckedChange={() => {}}
            />
            <Label htmlFor="team-event" className="flex items-center gap-2">
              Team Event
              <Badge variant="secondary" className="text-[10px] uppercase tracking-wider h-5 bg-slate-100 text-slate-500 border-none">
                Coming Soon
              </Badge>
            </Label>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="tournament-name">Tournament Name</Label>
        <Input
          id="tournament-name"
          value={config.basic.name}
          onChange={(event) => updateBasic({ name: event.target.value })}
          placeholder="e.g., San Diego Fall Open"
        />
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="space-y-2 md:col-span-2">
          <Label htmlFor="basic-address">Address</Label>
          <Input
            id="basic-address"
            value={config.basic.city}
            onChange={(event) => updateBasic({ city: event.target.value })}
            placeholder="e.g., 111 W Harbor Dr, San Diego"
          />
          <div className="flex gap-2 pt-1">
            <Button
              type="button"
              variant="outline"
              disabled={!config.basic.city.trim()}
              onClick={() => openMaps("google")}
            >
              Open in Google Maps
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={!config.basic.city.trim()}
              onClick={() => openMaps("apple")}
            >
              Open in Apple Maps
            </Button>
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="basic-city-state">City &amp; State</Label>
          <Input
            id="basic-city-state"
            value={config.basic.state}
            onChange={(event) => handleCityStateChange(event.target.value)}
            placeholder="e.g., San Diego, CA"
          />
          <p className="text-xs text-muted-foreground">Example: San Diego, CA</p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label>Federation</Label>
          <Select
            value={config.basic.federation}
            onValueChange={(value) => updateBasic({ federation: value })}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select federation" />
            </SelectTrigger>
            <SelectContent>
              {FEDERATION_OPTIONS.map((option) => (
                <SelectItem key={option.code} value={option.code}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {config.format !== 'arena' && config.format !== 'knockout' && (
          <div className="space-y-2">
            <Label htmlFor="basic-rounds">Rounds</Label>
            <Input
              id="basic-rounds"
              type="number"
              min={1}
              value={config.details.rounds}
              onChange={(event) => {
                const val = parseInt(event.target.value, 10);
                const nextRounds = Number.isFinite(val) && val > 0 ? val : 1;
                onConfigChange({
                  ...config,
                  details: { ...config.details, rounds: nextRounds },
                });
              }}
            />
          </div>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="basic-start-date">Start Date</Label>
          <DatePicker
            date={config.basic.startDate ? parseISO(config.basic.startDate) : null}
            setDate={(date) => updateBasic({ startDate: date ? formatDateFn(date, "yyyy-MM-dd") : null })}
            placeholder="Select start date"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="basic-end-date">End Date</Label>
          <DatePicker
            date={config.basic.endDate ? parseISO(config.basic.endDate) : null}
            setDate={(date) => updateBasic({ endDate: date ? formatDateFn(date, "yyyy-MM-dd") : null })}
            placeholder="Select end date"
          />
        </div>
      </div>
    </div>
  );
}

interface StepOneProps {
  format: Tournament["format"];
  mode: TournamentMode;
  builderMode: BuilderMode;
  config: TournamentConfig;
  onFormatChange: (format: Tournament["format"]) => void;
  onModeChange: (mode: TournamentMode) => void;
  onConfigChange: (config: TournamentConfig) => void;
  onContinue: () => void;
  onCancel?: () => void;
  isProcessing?: boolean;
  continueLabel?: string;
  processingLabel?: string;
}


export function StepOne({
  format,
  mode,
  builderMode,
  config,
  onFormatChange,
  onModeChange,
  onConfigChange,
  onContinue,
  onCancel,
  isProcessing,
  continueLabel,
  processingLabel,
}: StepOneProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const { toast } = useToast();
  const hasRequiredBasics =
    config.basic.name.trim().length > 0 &&
    Boolean(config.basic.startDate) &&
    Boolean(config.basic.endDate) &&
    config.basic.state.trim().length > 0;
  const canContinue = builderMode === "create" ? hasRequiredBasics : true;

  const handleFileImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const text = await fileToText(file);
      const parsed = JSON.parse(text);
      if (!parsed || typeof parsed !== "object") {
        throw new Error("Invalid file format");
      }

      if (isTournamentTemplateSnapshot(parsed)) {
        const snapshot: TournamentTemplateSnapshot = {
          ...parsed,
          selected:
            Array.isArray(parsed.selected) && parsed.selected.length > 0
              ? (parsed.selected as TemplateSectionKey[])
              : TOURNAMENT_TEMPLATE_OPTIONS.map((option) => option.id),
        };
        const baseConfig = createDefaultConfig(
          snapshot.format ?? format,
          snapshot.mode ?? mode,
        );
        const mergedConfig = applyTournamentTemplateSnapshot(baseConfig, snapshot);
        onModeChange(snapshot.mode ?? mode);
        onFormatChange(snapshot.format ?? format);
        onConfigChange(mergedConfig);
        toast({ title: "Template imported", description: "Configuration applied from template." });
        return;
      }

      const parsedConfig = parseTournamentConfig({
        id: 0,
        name: typeof parsed?.basic?.name === "string" ? parsed.basic.name : "Imported Tournament",
        format: (parsed.format ?? format) as Tournament["format"],
        status: "draft",
        rounds: parsed?.details?.rounds ?? config.details.rounds,
        timeControl: parsed?.details?.timeControl ?? config.details.timeControl,
        currentRound: 0,
        isDoubleRoundRobin: false,
        playerCount: null,
        useQuickSetup: false,
        tiebreakOrder: parsed?.details?.tiebreakSystem ?? "rating",
        location: parsed?.basic?.city ?? "",
        directorPhone: null,
        directorEmail: null,
        roundTimings: parsed,
        createdBy: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as unknown as Tournament);
      onModeChange(parsedConfig.mode ?? mode);
      onFormatChange(parsedConfig.format ?? format);
      onConfigChange(parsedConfig);
      toast({ title: "Configuration imported" });
    } catch (error: any) {
      toast({
        title: "Import failed",
        description: error?.message ?? "Unable to import configuration file.",
        variant: "destructive",
      });
    } finally {
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      if (event.target) {
        event.target.value = "";
      }
    }
  };

  const handleContinue = () => {
    if (!canContinue) {
      return;
    }
    onContinue();
  };

  const continueText = isProcessing
    ? processingLabel ?? "Processing..."
    : continueLabel ?? "Continue";

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">Select Format</CardTitle>
          <p className="text-sm text-muted-foreground">
            Choose the tournament format that matches your event. You can adjust details later.
          </p>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2">
            {FORMAT_CARDS.map((card) => {
              const isSelected = format === card.id;
              return (
                <button
                  type="button"
                  key={card.id}
                  onClick={() => onFormatChange(card.id)}
                  className={`text-left border rounded-lg p-4 transition-colors ${ 
                    isSelected ? "border-primary bg-primary/5" : "hover:border-primary/40"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="text-lg font-semibold">{card.title}</div>
                    {isSelected && <Check className="h-5 w-5 text-primary" />}
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">{card.description}</p>
                  <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
                    {card.features.map((feature) => (
                      <li key={feature}>• {feature}</li>
                    ))}
                  </ul>
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {format !== 'arena' && (
        <Card>
          <CardHeader>
            <CardTitle className="text-xl">Select Mode</CardTitle>
            <p className="text-sm text-muted-foreground">
              Modes enable federation-specific workflows and reports.
            </p>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-2">
              {MODE_OPTIONS.map((option) => {
                const isSelected = mode === option.id;
                const isOnline = option.id === "online";
                return (
                  <button
                    type="button"
                    key={option.id}
                    disabled={isOnline}
                    onClick={() => onModeChange(option.id)}
                    className={cn(
                      "text-left border rounded-lg p-4 transition-colors",
                      isSelected ? "border-primary bg-primary/5" : "hover:border-primary/40",
                      isOnline && "opacity-50 cursor-not-allowed grayscale"
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className={cn("font-semibold", isOnline && "text-muted-foreground")}>
                          {option.label}
                        </div>
                        {isOnline && (
                          <Badge variant="outline" className="text-[10px] uppercase tracking-wider h-5">
                            Coming Soon
                          </Badge>
                        )}
                      </div>
                      {isSelected && <Check className="h-5 w-5 text-primary" />}
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">{option.description}</p>
                  </button>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-xl">Basic Information</CardTitle>
          <p className="text-sm text-muted-foreground">
            Capture the essentials so your public page is easier to finish later.
          </p>
        </CardHeader>
        <CardContent>
          <BasicInformationFields variant="minimal" config={config} onConfigChange={onConfigChange} />
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-3 justify-between">
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => fileInputRef.current?.click()}>
            <Upload className="h-4 w-4 mr-2" /> Import from File
          </Button>
          <input
            type="file"
            ref={fileInputRef}
            accept="application/json"
            className="hidden"
            onChange={handleFileImport}
          />
        </div>
        <div className="flex gap-2">
          {onCancel && (
            <Button variant="outline" onClick={onCancel}>
              Cancel
            </Button>
          )}
          <Button onClick={handleContinue} disabled={isProcessing || !canContinue}>
            {continueText}
            <ChevronRight className="h-4 w-4 ml-2" />
          </Button>
        </div>
      </div>
    </div>
  );
}
