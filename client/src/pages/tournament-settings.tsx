import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Tournament } from "@shared/schema";
import {
  type ChessResultsConfig,
  type FideRegistrationData,
  type RegistersConfig,
  type TournamentConfig,
  type UscfReportData,
  buildTournamentPayload,
  parseTournamentConfig,
  serializeTournamentConfig,
} from "@/lib/tournament-config";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  ChessResultsSettingsCard,
  FideRegistrationSection,
  RegistersSettingsCard,
  UscfReportSection,
} from "@/components/tournament-settings/sections";
import { Loader2 } from "lucide-react";

type SettingsSection = "registers" | "fide" | "uscf" | "chess-results";

interface TournamentSettingsPageProps {
  tournamentId: number;
  section?: string;
}

function cloneConfig(config: TournamentConfig): TournamentConfig {
  return JSON.parse(JSON.stringify(config)) as TournamentConfig;
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

  const currentSection: SettingsSection = useMemo(() => {
    const normalized = (section ?? "registers") as SettingsSection;
    return normalized === "registers" || normalized === "fide" || normalized === "uscf" || normalized === "chess-results"
      ? normalized
      : "registers";
  }, [section]);

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
      const next = {
        ...prev,
        registers: {
          ...prev.registers,
          ...update,
        },
      };
      return next;
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

  const updateChessResults = (update: Partial<ChessResultsConfig>) => {
    if (!config) return;
    setConfig((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        chessResults: {
          ...prev.chessResults,
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
      toast({ title: "Tournament settings saved" });
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
      await apiRequest(`/api/tournaments/${tournamentId}/chess-results/test`, {
        method: "POST",
        body: JSON.stringify({ config }),
      });
    },
    onSuccess: () => {
      toast({ title: "Chess-Results connection successful" });
    },
    onError: (error: any) => {
      toast({
        title: "Connection failed",
        description: error?.message ?? "Verify credentials and try again.",
        variant: "destructive",
      });
    },
  });

  const syncMutation = useMutation({
    mutationFn: async () => {
      if (!config) throw new Error("Configuration not ready");
      const response = await apiRequest(`/api/tournaments/${tournamentId}/chess-results/sync`, {
        method: "POST",
        body: JSON.stringify({ config }),
      });
      return response;
    },
    onSuccess: (result) => {
      if (result?.config) {
        setConfig(cloneConfig(result.config));
      }
      toast({ title: "Chess-Results sync complete" });
      queryClient.invalidateQueries({ queryKey: [`/api/tournaments/${tournamentId}`] });
      setIsDirty(true);
    },
    onError: (error: any) => {
      toast({
        title: "Sync failed",
        description: error?.message ?? "Check credentials and network access.",
        variant: "destructive",
      });
    },
  });

  const allowedSections = useMemo(() => {
    const source = baseline ?? config;
    if (!source) return ["registers", "chess-results"] satisfies SettingsSection[];

    const sections: SettingsSection[] = ["registers"];
    if (source.registers.fideRated) {
      sections.push("fide");
    }
    if (source.registers.uscfRated) {
      sections.push("uscf");
    }
    sections.push("chess-results");
    return sections;
  }, [baseline, config]);

  useEffect(() => {
    if (!config) return;
    if (!allowedSections.includes(currentSection)) {
      setLocation(`/tournaments/${tournamentId}/settings/${allowedSections[0] ?? "registers"}`);
    }
  }, [allowedSections, config, currentSection, setLocation, tournamentId]);

  if (authLoading || tournamentLoading || !config || !baseline) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
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
    "chess-results": "Chess-Results",
  };

  const goToSection = (id: SettingsSection) => {
    if (!allowedSections.includes(id)) return;
    setLocation(`/tournaments/${tournamentId}/settings/${id}`);
  };

  const unsavedChanges = isDirty || JSON.stringify(config) !== JSON.stringify(baseline);

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-6xl space-y-6 p-6">
        <div className="flex flex-col gap-4 border-b pb-4 md:flex-row md:items-center md:justify-between">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" onClick={() => setLocation(`/tournaments/${tournamentId}/manage`)}>
                Back to tournament
              </Button>
              {unsavedChanges && <Badge variant="destructive">Unsaved changes</Badge>}
            </div>
            <div>
              <h1 className="text-2xl font-semibold">Tournament settings</h1>
              <p className="text-sm text-muted-foreground">
                Manage federation forms and Chess-Results synchronization for {tournament?.name}.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={() => {
                if (!baseline) return;
                setConfig(cloneConfig(baseline));
                setIsDirty(false);
              }}
              disabled={!unsavedChanges}
            >
              Reset
            </Button>
            <Button onClick={() => saveMutation.mutate()} disabled={!unsavedChanges || saveMutation.isPending}>
              {saveMutation.isPending ? "Saving..." : "Save changes"}
            </Button>
          </div>
        </div>

        {currentSection === "registers" && (
          <div className="flex flex-wrap gap-2">
            {["registers", "fide", "uscf", "chess-results"].map((sectionId) => {
              const id = sectionId as SettingsSection;
              if (!allowedSections.includes(id)) return null;
              return (
                <Button
                  key={id}
                  variant={currentSection === id ? "default" : "outline"}
                  onClick={() => goToSection(id)}
                >
                  {NAV_LABELS[id]}
                </Button>
              );
            })}
          </div>
        )}

        <Separator />

        <div className="space-y-6 pb-12">
          {currentSection === "registers" && (
            <div className="space-y-6">
              <RegistersSettingsCard value={config.registers} onChange={updateRegisters} />
            </div>
          )}

          {currentSection === "fide" && allowedSections.includes("fide") && (
            <FideRegistrationSection value={config.fide} onChange={updateFide} />
          )}

          {currentSection === "uscf" && allowedSections.includes("uscf") && (
            <UscfReportSection value={config.uscf} onChange={updateUscf} />
          )}

          {currentSection === "chess-results" && allowedSections.includes("chess-results") && (
            <ChessResultsSettingsCard
              value={config.chessResults}
              onChange={updateChessResults}
              onTest={() => testMutation.mutate()}
              onSync={() => syncMutation.mutate()}
              testing={testMutation.isPending}
              syncing={syncMutation.isPending}
              disabled={config.chessResults.syncMode === "disabled"}
            />
          )}
        </div>
      </div>
    </div>
  );
}
