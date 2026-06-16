import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Tournament } from "@shared/schema";
import {
  type WebhookSyncConfig,
  type FideRegistrationData,
  type RegistersConfig,
  type TournamentConfig,
  type UscfReportData,
  type BoardNumberingSettings,
  buildTournamentPayload,
  parseTournamentConfig,
  serializeTournamentConfig,
} from "@/lib/tournament-config";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  WebhookSyncSettingsCard,
  FideRegistrationSection,
  UscfReportSection,
} from "@/components/tournament-settings/sections";
import { GeneralSettingsCard } from "@/components/tournament-settings/GeneralSettingsCard";
import { BoardNumberingCard } from "@/components/tournament-settings/BoardNumberingCard";
import { Loader2, ChevronLeft, Check } from "lucide-react";

type SettingsSection = "registers" | "fide" | "uscf" | "webhook-sync";

interface TournamentSettingsPageProps {
  tournamentId: number;
  section?: string;
}

function cloneConfig(config: TournamentConfig): TournamentConfig {
  return JSON.parse(JSON.stringify(config)) as TournamentConfig;
}

function downloadJson(filename: string, data: unknown) {
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

export default function TournamentSettingsPage({ tournamentId, section }: TournamentSettingsPageProps) {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { user, isLoading: authLoading } = useAuth();
  const queryClient = useQueryClient();

  const { data: tournament, isLoading: tournamentLoading } = useQuery<Tournament>({
    queryKey: [`/api/tournaments/${tournamentId}`],
  });

  const [config, setConfig] = useState<TournamentConfig | null>(null);
  const [baseline, setBaseline] = useState<TournamentConfig | null>(null);
  const [isDirty, setIsDirty] = useState(false);

  useEffect(() => {
    if (!tournament) return;
    const parsed = parseTournamentConfig(tournament);
    const cloned = cloneConfig(parsed);
    setConfig(cloned);
    setBaseline(cloneConfig(parsed));
    setIsDirty(false);
  }, [tournament]);

  useEffect(() => {
    if (tournament && user && user.role === "tournament_director" && tournament.createdBy !== user.id) {
      setLocation(`/tournaments/${tournamentId}`);
    }
  }, [tournament, user, tournamentId, setLocation]);

  const markDirty = () => {
    setIsDirty(true);
  };

  const updateRegisters = (update: Partial<RegistersConfig>) => {
    if (!config) return;
    setConfig((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        registers: {
          ...prev.registers,
          ...update,
        },
      };
    });
    markDirty();
  };

  const updateBoardNumbering = (update: Partial<BoardNumberingSettings>) => {
    if (!config) return;
    setConfig((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        boardNumbering: {
          ...prev.boardNumbering,
          ...update,
        },
      };
    });
    markDirty();
  };

  const updateFide = (update: Partial<FideRegistrationData>) => {
    if (!config) return;
    setConfig((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        fide: {
          ...prev.fide,
          ...update,
        },
      };
    });
    markDirty();
  };

  const updateUscf = (update: Partial<UscfReportData>) => {
    if (!config) return;
    setConfig((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        uscf: {
          ...prev.uscf,
          ...update,
        },
      };
    });
    markDirty();
  };

  const updateWebhookSync = (update: Partial<any>) => {
    if (!config) return;
    setConfig((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        webhookSync: {
          ...prev.webhookSync,
          ...update,
        },
      };
    });
    markDirty();
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!config || !tournament) throw new Error("Configuration not ready");
      const serialized = serializeTournamentConfig(cloneConfig(config));
      const payload = buildTournamentPayload(serialized, { format: tournament.format });
      (payload as any).status = tournament.status;
      return apiRequest(`/api/tournaments/${tournamentId}`, {
        method: "PUT",
        body: JSON.stringify(payload),
      });
    },
    onSuccess: (updatedTournament: Tournament) => {
      const parsed = parseTournamentConfig(updatedTournament);
      const cloned = cloneConfig(parsed);
      setConfig(cloned);
      setBaseline(cloneConfig(parsed));
      setIsDirty(false);
      queryClient.invalidateQueries({ queryKey: [`/api/tournaments/${tournamentId}`] });
      toast({ title: "Tournament settings saved successfully" });
    },
    onError: (error: any) => {
      toast({
        title: "Unable to save settings",
        description: error?.message ?? "Please review the form and try again.",
        variant: "destructive",
      });
    },
  });

  const testMutation = useMutation({
    mutationFn: async () => {
      if (!config) throw new Error("Configuration not ready");
      await apiRequest(`/api/tournaments/${tournamentId}/webhook-sync/test`, {
        method: "POST",
        body: JSON.stringify({ config }),
      });
    },
    onSuccess: () => {
      toast({ title: "Connection test successful" });
    },
    onError: (error: any) => {
      toast({
        title: "Connection test failed",
        description: error?.message ?? "Verify credentials and try again.",
        variant: "destructive",
      });
    },
  });

  const syncMutation = useMutation({
    mutationFn: async () => {
      if (!config) throw new Error("Configuration not ready");
      const response = await apiRequest(`/api/tournaments/${tournamentId}/webhook-sync`, {
        method: "POST",
        body: JSON.stringify({ config }),
      });
      return response;
    },
    onSuccess: (result) => {
      if (result?.config) {
        setConfig(cloneConfig(result.config));
      }
      toast({ title: "Webhook synchronization complete" });
      queryClient.invalidateQueries({ queryKey: [`/api/tournaments/${tournamentId}`] });
      setIsDirty(true);
    },
    onError: (error: any) => {
      toast({
        title: "Synchronization failed",
        description: error?.message ?? "Check credentials and network access.",
        variant: "destructive",
      });
    },
  });

  const handleDownloadWebhookSync = useCallback(() => {
    if (!config) return;
    downloadJson(`tournament-${tournamentId}-webhook-sync.json`, {
      tournamentId,
      tournamentName: tournament?.name,
      form: "WebhookSync",
      data: config.webhookSync,
    });
  }, [config, tournament?.name, tournamentId]);

  const allowedSections = useMemo(() => {
    const source = config ?? baseline;
    if (!source) return ["registers", "webhook-sync"] satisfies SettingsSection[];

    const sections: SettingsSection[] = ["registers"];
    if (source.registers.fideRated) {
      sections.push("fide");
    }
    if (source.registers.uscfRated) {
      sections.push("uscf");
    }
    sections.push("webhook-sync");
    return sections;
  }, [baseline, config]);

  const currentSection: SettingsSection = useMemo(() => {
    const normalized = (section ?? "registers") as SettingsSection;
    return allowedSections.includes(normalized) ? normalized : "registers";
  }, [section, allowedSections]);

  useEffect(() => {
    if (!config) return;
    if (!allowedSections.includes(currentSection)) {
      setLocation(`/tournaments/${tournamentId}/advanced-settings/${allowedSections[0] ?? "registers"}`);
    }
  }, [allowedSections, config, currentSection, setLocation, tournamentId]);

  if (authLoading || tournamentLoading || !config || !baseline) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-transparent">
        <div className="flex items-center gap-3 text-slate-500">
          <Loader2 className="h-5 w-5 animate-spin" />
          Loading tournament settings...
        </div>
      </div>
    );
  }

  const NAV_LABELS: Record<SettingsSection, string> = {
    registers: "Registers",
    fide: "Data for FIDE",
    uscf: "Data for USCF",
    "webhook-sync": "Custom API Sync",
  };

  const goToSection = (id: SettingsSection) => {
    if (!allowedSections.includes(id)) return;
    setLocation(`/tournaments/${tournamentId}/advanced-settings/${id}`);
  };

  const unsavedChanges = isDirty || JSON.stringify(config) !== JSON.stringify(baseline);

  return (
    <div className="min-h-screen bg-transparent">
      <div className="mx-auto max-w-6xl space-y-6 p-6">
        <Button
          variant="link"
          onClick={() => setLocation(`/tournaments/${tournamentId}/settings`)}
          className="pl-0 text-slate-500 hover:text-slate-900"
        >
          <ChevronLeft className="mr-1 h-4 w-4" />
          Back to settings
        </Button>

        <div className="flex flex-col gap-4 border-b pb-4 md:flex-row md:items-center md:justify-between">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              {unsavedChanges && <Badge variant="destructive">Unsaved changes</Badge>}
            </div>
            <div>
              <h1 className="text-2xl font-semibold">Tournament settings</h1>
              <p className="text-sm text-muted-foreground">
                Manage federation forms and custom API synchronization for {tournament?.name}.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-9"
              onClick={() => {
                if (!baseline) return;
                setConfig(cloneConfig(baseline));
                setIsDirty(false);
              }}
              disabled={!unsavedChanges || saveMutation.isPending}
            >
              Reset
            </Button>
            <Button
              size="sm"
              className="h-9"
              onClick={() => saveMutation.mutate()}
              disabled={!unsavedChanges || saveMutation.isPending}
            >
              {saveMutation.isPending ? "Saving..." : "Save changes"}
            </Button>
          </div>
        </div>

        {/* Horizontal Navigation Tabs */}
        <div className="flex flex-wrap gap-2 mb-6">
          {["registers", "fide", "uscf", "webhook-sync"].map((sectionId) => {
            const id = sectionId as SettingsSection;
            if (!allowedSections.includes(id)) return null;
            return (
              <Button
                key={id}
                variant={currentSection === id ? "default" : "outline"}
                onClick={() => goToSection(id)}
                className="rounded-xl shadow-sm px-4 py-2 font-medium"
              >
                {NAV_LABELS[id]}
              </Button>
            );
          })}
        </div>

        <Separator />

        <div className="space-y-6 pb-12">
          {currentSection === "registers" && (
            <div className="space-y-6">
              <GeneralSettingsCard
                value={config.registers}
                onChange={updateRegisters}
                format={tournament?.format}
              />
              <BoardNumberingCard
                value={config.boardNumbering}
                onChange={updateBoardNumbering}
              />
            </div>
          )}

          {currentSection === "fide" && allowedSections.includes("fide") && (
            <FideRegistrationSection
              value={config.fide}
              onChange={updateFide}
            />
          )}

          {currentSection === "uscf" && allowedSections.includes("uscf") && (
            <UscfReportSection
              value={config.uscf}
              onChange={updateUscf}
            />
          )}

          {currentSection === "webhook-sync" && allowedSections.includes("webhook-sync") && (
            <WebhookSyncSettingsCard
              value={config.webhookSync}
              onChange={updateWebhookSync}
              onTest={() => testMutation.mutate()}
              onSync={() => syncMutation.mutate()}
              testing={testMutation.isPending}
              syncing={syncMutation.isPending}
              disabled={config.webhookSync.syncMode === "disabled"}
              onDownload={handleDownloadWebhookSync}
              enabled={true}
              onEnabledChange={() => {}}
            />
          )}
        </div>
      </div>
    </div>
  );
}
