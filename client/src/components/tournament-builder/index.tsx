import React, { useMemo, useState, useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Settings, Check, ChevronRight } from "lucide-react";

import type { Tournament } from "@shared/schema";
import {
  parseTournamentConfig, serializeTournamentConfig, createDefaultConfig, buildTournamentPayload, createDefaultSchedule
} from "@/lib/tournament-config";
import type { TournamentConfig, TournamentMode } from "@/lib/tournament-config";

import type { TournamentBuilderProps } from "./types";
import { cloneConfig } from "./helpers";
import { BasicInformationFields, StepOne as StepOneComponent } from "./step-one";
import StepTwo from "./step-two";

export function TournamentBuilder({
  mode,
  format: initialFormat,
  tournament,
  onCancel,
  onComplete,
  activeSubTab,
  onSubTabChange
}: TournamentBuilderProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [format, setFormat] = useState<Tournament["format"]>(tournament?.format ?? initialFormat);
  const [config, setConfig] = useState<TournamentConfig>(() =>
    tournament ? parseTournamentConfig(tournament) : createDefaultConfig(initialFormat)
  );
  const [step, setStep] = useState(tournament ? 2 : 1);

  const handleFormatChange = (nextFormat: Tournament["format"]) => {
    setFormat(nextFormat);
    setConfig((prev) => {
      const defaultConfig = createDefaultConfig(nextFormat, prev.mode ?? "rated");
      return {
        ...prev,
        format: nextFormat,
        details: {
          ...prev.details,
          rounds: defaultConfig.details.rounds,
          pairingSystem: defaultConfig.details.pairingSystem,
        },
        schedule: createDefaultSchedule(defaultConfig.details.rounds),
      };
    });
  };

  const handleModeChange = (nextMode: TournamentMode) => {
    setConfig((prev) => {
      const registers = { ...prev.registers };

      if (nextMode === "online") {
        registers.allowSignup = true;
        registers.fideRated = false;
        registers.uscfRated = false;
      } else if (nextMode === "unrated") {
        registers.fideRated = false;
        registers.uscfRated = false;
      } else if (nextMode === "rated") {
        registers.fideRated = true;
        registers.uscfRated = true;
      }

      return {
        ...prev,
        mode: nextMode,
        registers,
      };
    });
  };

  const mutation = useMutation({
    mutationFn: async () => {
      // Strict validation for Arena and Knockout formats
      if (format === 'arena' || format === 'knockout') {
        const hasUnsetClock = (config.details.timeControls ?? []).some(tc => !tc.minutes || tc.minutes <= 0);
        if (hasUnsetClock) {
          throw new Error("All clock settings (Minutes) must be configured with a value greater than 0 before starting.");
        }
      }

      const payload = buildTournamentPayload(config, { format });
      payload.roundTimings = serializeTournamentConfig({ ...config, format });
      if (mode === "create") {
        (payload as any).status = "draft";
        return apiRequest("/api/tournaments", {
          method: "POST",
          body: JSON.stringify(payload),
        });
      }
      if (!tournament) throw new Error("Tournament missing");
      (payload as any).status = tournament.status;
      return apiRequest(`/api/tournaments/${tournament.id}`, {
        method: "PUT",
        body: JSON.stringify(payload),
      });
    },
    onSuccess: (createdTournament) => {
      const targetId = (createdTournament as Tournament | undefined)?.id ?? tournament?.id;
      if (targetId) {
        queryClient.invalidateQueries({ queryKey: ["tournament-payments-config", targetId] });
        queryClient.invalidateQueries({ queryKey: [`/api/tournaments/${targetId}`] });
      }
      if (createdTournament && typeof createdTournament === "object") {
        try {
          const nextConfig = parseTournamentConfig(createdTournament as Tournament);
          setConfig(nextConfig);
        } catch (error) {
          console.warn("Failed to parse updated tournament config", error);
        }
      }
      if (mode === "create") {
        toast({ title: "Tournament created" });
      }
      onComplete?.(createdTournament);
    },
    onError: (error: any) => {
      toast({
        title: "Unable to save tournament",
        description: error?.message ?? "Please verify form fields and try again.",
        variant: "destructive",
      });
    },
  });

  // Autosave logic
  const lastSavedConfigRef = useRef(JSON.stringify(config));
  useEffect(() => {
    if (mode !== "edit" || !tournament) return;

    const currentConfig = JSON.stringify(config);
    if (currentConfig === lastSavedConfigRef.current) return;

    const timer = setTimeout(() => {
      mutation.mutate();
      lastSavedConfigRef.current = currentConfig;
    }, 1500);

    return () => clearTimeout(timer);
  }, [config, mode, tournament]);

  return step === 1 ? (
    <StepOneComponent
      format={format}
      mode={config.mode}
      builderMode={mode}
      config={config}
      onFormatChange={handleFormatChange}
      onModeChange={handleModeChange}
      onConfigChange={(nextConfig: any) => setConfig(nextConfig)}
      onContinue={() => {
        if (mode === "create") {
          if (!mutation.isPending) {
            mutation.mutate();
          }
        } else {
          setStep(2);
        }
      }}
      onCancel={onCancel}
      isProcessing={mutation.isPending}
      continueLabel={mode === "create" ? "Create tournament" : "Continue"}
      processingLabel={mode === "create" ? "Creating..." : "Processing..."}
    />
  ) : (
    <StepTwo
      format={format}
      mode={config.mode}
      builderMode={mode}
      config={config}
      onConfigChange={(nextConfig: any) => setConfig(nextConfig)}
      onBack={() => setStep(1)}
      onCancel={onCancel}
      onSave={() => mutation.mutate()}
      saving={mutation.isPending}
      tournament={tournament}
      activeSubTab={activeSubTab}
      onSubTabChange={onSubTabChange}
    />
  );
}


export default TournamentBuilder;
