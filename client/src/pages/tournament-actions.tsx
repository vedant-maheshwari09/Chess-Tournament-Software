import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { AlertTriangle, ChevronLeft, Mail, Share2, Trash2, Users, UserPlus, Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  parseTournamentConfig,
  serializeTournamentConfig,
  buildTournamentPayload,
  type TournamentConfig,
} from "@/lib/tournament-config";
import {
  TOURNAMENT_TEMPLATE_OPTIONS,
  applyTournamentTemplateSnapshot,
  buildTournamentTemplateSnapshot,
  isTournamentTemplateSnapshot,
  type TemplateSectionKey,
  type TournamentTemplateSnapshot,
} from "@/lib/tournament-templates";
import type { Tournament, Player } from "@shared/schema";

interface TournamentActionsPageProps {
  tournamentId: number;
  section?: string;
}

export function TournamentActionsContent({ 
  tournamentId, 
  tournament, 
  parsedConfig 
}: { 
  tournamentId: number; 
  tournament: Tournament; 
  parsedConfig: TournamentConfig | null;
}) {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const [deleting, setDeleting] = useState(false);
  const [shareEmails, setShareEmails] = useState("");
  const [shareMessage, setShareMessage] = useState("");
  const [templateSelections, setTemplateSelections] = useState<TemplateSectionKey[]>(() =>
    TOURNAMENT_TEMPLATE_OPTIONS.map((option) => option.id),
  );
  const [templateSaving, setTemplateSaving] = useState(false);
  const templateImportInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setTemplateSelections(TOURNAMENT_TEMPLATE_OPTIONS.map((option) => option.id));
  }, [tournamentId]);

  const updateTemplateSelection = (key: TemplateSectionKey, checked: boolean) => {
    setTemplateSelections((prev) => {
      if (checked) {
        if (prev.includes(key)) return prev;
        return [...prev, key];
      }
      return prev.filter((value) => value !== key);
    });
  };

  const handleTemplateSelectAll = () => {
    setTemplateSelections(TOURNAMENT_TEMPLATE_OPTIONS.map((option) => option.id));
  };

  const handleTemplateClear = () => {
    setTemplateSelections([]);
  };

  const handleTemplateExport = async () => {
    if (!parsedConfig) {
      toast({ title: "Tournament not ready", variant: "destructive" });
      return;
    }
    if (templateSelections.length === 0) {
      toast({ title: "Select sections to export", variant: "destructive" });
      return;
    }

    let players: Player[] | undefined;
    if (templateSelections.includes("players")) {
      try {
        const res = await apiRequest(`/api/tournaments/${tournamentId}/players`);
        const data = res instanceof Response ? await res.json() : res;
        players = Array.isArray(data) ? data : [];
      } catch {
        toast({ title: "Could not fetch player roster", variant: "destructive" });
        return;
      }
    }

    const format = parsedConfig.format ?? tournament.format;
    const mode = parsedConfig.mode ?? "rated";
    const snapshot = buildTournamentTemplateSnapshot(
      parsedConfig,
      format,
      mode,
      templateSelections,
      players,
    );
    const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const slug = tournament.name
      ? tournament.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")
      : `tournament-${tournament.id}`;
    const link = document.createElement("a");
    link.href = url;
    link.download = `${slug || "tournament"}-template.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    const playerNote = players && players.length > 0 ? ` Includes ${players.length} player(s).` : "";
    toast({ title: "Template exported", description: `Download complete.${playerNote}` });
  };

  const handleTemplateImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      if (!isTournamentTemplateSnapshot(parsed)) {
        throw new Error("File is not a valid tournament template.");
      }
      if (!parsedConfig) {
        throw new Error("Tournament configuration unavailable.");
      }

      const snapshot: TournamentTemplateSnapshot = {
        ...parsed,
        selected:
          parsed.selected && parsed.selected.length > 0
            ? (parsed.selected as TemplateSectionKey[])
            : TOURNAMENT_TEMPLATE_OPTIONS.map((option) => option.id),
      };

      const mergedConfig = applyTournamentTemplateSnapshot(parsedConfig, snapshot);
      const format = mergedConfig.format ?? tournament.format;
      const payload = buildTournamentPayload(mergedConfig, { format });
      payload.roundTimings = serializeTournamentConfig({ ...mergedConfig, format });
      (payload as any).status = tournament.status;

      setTemplateSaving(true);
      await apiRequest(`/api/tournaments/${tournamentId}`, {
        method: "PUT",
        body: JSON.stringify(payload),
      });

      let playerImportNote = "";
      if (snapshot.selected.includes("players") && Array.isArray(snapshot.data.players) && snapshot.data.players.length > 0) {
        try {
          const playerRes = await apiRequest(`/api/tournaments/${tournamentId}/bulk-create-players`, {
            method: "POST",
            body: JSON.stringify({ players: snapshot.data.players }),
          });
          const playerData = playerRes instanceof Response ? await playerRes.json() : playerRes;
          const count = playerData?.players?.length ?? snapshot.data.players.length;
          playerImportNote = ` ${count} player(s) imported.`;
          queryClient.invalidateQueries({ queryKey: [`/api/tournaments/${tournamentId}/players`] });
        } catch {
          playerImportNote = " (Player import failed — check console for details.";
        }
      }

      setTemplateSelections(snapshot.selected);
      queryClient.invalidateQueries({ queryKey: [`/api/tournaments/${tournamentId}`] });
      toast({ title: "Template applied", description: `Tournament configuration updated.${playerImportNote}` });
    } catch (error) {
      toast({
        title: "Template import failed",
        description: error instanceof Error ? error.message : "Unable to load template file.",
        variant: "destructive",
      });
    } finally {
      setTemplateSaving(false);
      if (event.target) {
        event.target.value = "";
      }
    }
  };

  const handleDelete = async () => {
    if (!window.confirm("Are you sure you want to delete this tournament? This action cannot be undone.")) {
      return;
    }

    try {
      setDeleting(true);
      await apiRequest(`/api/tournaments/${tournamentId}`, {
        method: "DELETE",
      });
      toast({ title: "Tournament deleted" });
      setLocation("/dashboard");
    } catch (error: any) {
      toast({
        title: "Unable to delete tournament",
        description: error?.message ?? "Please try again later.",
        variant: "destructive",
      });
    } finally {
      setDeleting(false);
    }
  };

  const handleShare = () => {
    const recipients = shareEmails
      .split(/[,;\s]+/)
      .map((value) => value.trim())
      .filter((value) => value.length > 0);

    if (recipients.length === 0) {
      toast({ title: "Add at least one email", variant: "destructive" });
      return;
    }

    const subject = encodeURIComponent(`Tournament Coordination: ${tournament.name}`);
    const link = typeof window !== "undefined" ? `${window.location.origin}/tournaments/${tournamentId}` : "";
    const message = shareMessage.trim().length > 0 ? `${shareMessage.trim()}\n\n` : "";
    const body = encodeURIComponent(`${message}Event details: ${link}`);
    const to = encodeURIComponent(recipients.join(","));
    window.location.href = `mailto:${to}?subject=${subject}&body=${body}`;
  };

  return (
    <div className="space-y-6">
      {/* Templates Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Templates
          </CardTitle>
          <CardDescription>
            Export selected configuration areas or apply a saved template to this tournament.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <Button type="button" variant="ghost" size="sm" onClick={handleTemplateSelectAll}>
              Select all
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={handleTemplateClear}>
              Clear
            </Button>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {TOURNAMENT_TEMPLATE_OPTIONS.map((option) => {
              const checked = templateSelections.includes(option.id);
              return (
                <label
                  key={option.id}
                  className="flex items-start gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 text-left shadow-sm cursor-pointer hover:border-slate-350 transition-all"
                >
                  <Checkbox
                    checked={checked}
                    onCheckedChange={(value) => updateTemplateSelection(option.id, value === true)}
                  />
                  <div>
                    <p className="text-sm font-medium text-slate-900">{option.label}</p>
                    <p className="text-xs text-slate-500">{option.description}</p>
                  </div>
                </label>
              );
            })}
          </div>
          <div className="flex flex-wrap items-center gap-3 pt-2">
            <Button variant="outline" onClick={() => templateImportInputRef.current?.click()} disabled={templateSaving}>
              {templateSaving ? "Applying template..." : "Import template"}
            </Button>
            <Button onClick={handleTemplateExport} disabled={templateSelections.length === 0}>
              Export template
            </Button>
            <input
              ref={templateImportInputRef}
              type="file"
              accept="application/json"
              className="hidden"
              onChange={handleTemplateImport}
            />
          </div>
        </CardContent>
      </Card>

      {/* Player Roster Import */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5 text-indigo-600" />
            Player Roster
          </CardTitle>
          <CardDescription>
            Import the same set of players from one of your past tournaments to quickly sign everyone up.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-slate-600 leading-relaxed">
            Go to <strong>Settings → Player Signup</strong> to select a past tournament and choose which players to import into this one. Their name, rating, and section details will carry over.
          </p>
          <Button
            variant="outline"
            className="border-indigo-200 text-indigo-700 hover:bg-indigo-50"
            onClick={() => setLocation(`/tournaments/${tournamentId}/settings/player-signup`)}
          >
            <Users className="mr-2 h-4 w-4" />
            Import Players from Past Tournament
          </Button>
        </CardContent>
      </Card>

      {/* Share Event Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Share2 className="h-5 w-5" /> Share event with directors
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-700" htmlFor="share-emails">
              Email addresses
            </label>
            <Input
              id="share-emails"
              value={shareEmails}
              onChange={(event) => setShareEmails(event.target.value)}
              placeholder="director1@example.com, director2@example.com"
            />
            <p className="text-xs text-muted-foreground">Separate recipients with commas or spaces.</p>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-700" htmlFor="share-message">
              Personal message (optional)
            </label>
            <Textarea
              id="share-message"
              rows={4}
              value={shareMessage}
              onChange={(event) => setShareMessage(event.target.value)}
              placeholder="Add context or instructions for fellow directors."
            />
          </div>

          <Button onClick={handleShare} className="flex items-center gap-2">
            <Mail className="h-4 w-4" /> Share via email
          </Button>
        </CardContent>
      </Card>

      {/* Delete Tournament Card */}
      <Card className="border-red-200 bg-red-50/80">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-red-700">
            <Trash2 className="h-5 w-5" /> Delete tournament
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm text-red-700">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4" />
            <p>
              This will remove the tournament, its players, pairings, and history. This action cannot be undone.
            </p>
          </div>
          <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
            {deleting ? "Deleting..." : "Delete tournament"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

export default function TournamentActionsPage({ tournamentId, section }: TournamentActionsPageProps) {
  const { user, isLoading: authLoading } = useAuth();
  const [, setLocation] = useLocation();

  const { data: tournament, isLoading: tournamentLoading } = useQuery<Tournament>({
    queryKey: [`/api/tournaments/${tournamentId}`],
  });

  const parsedConfig = useMemo(() => (tournament ? parseTournamentConfig(tournament) : null), [tournament]);

  const canManageTournament = useMemo(() => {
    if (!user || !tournament) return false;
    return user.role === "tournament_director" && user.id === tournament.createdBy;
  }, [user, tournament]);

  useEffect(() => {
    if (authLoading || tournamentLoading) return;
    if (!user) {
      setLocation("/");
      return;
    }
    if (!canManageTournament && tournament) {
      setLocation(`/tournaments/${tournamentId}`);
    }
  }, [authLoading, canManageTournament, tournament, tournamentId, tournamentLoading, user, setLocation]);

  if (authLoading || tournamentLoading || !tournament) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-transparent">
        <div className="flex items-center gap-3 text-slate-500">
          <span className="inline-flex h-5 w-5 animate-spin rounded-full border-2 border-slate-300 border-t-slate-500" />
          Loading tournament actions...
        </div>
      </div>
    );
  }

  if (!canManageTournament) {
    return null;
  }

  if (section === "player-signup") {
    return (
      <div className="min-h-screen bg-transparent">
        <div className="mx-auto max-w-4xl space-y-6 p-6">
          <Button
            variant="link"
            onClick={() => setLocation(`/tournaments/${tournamentId}/settings`)}
            className="pl-0 text-slate-500 hover:text-slate-900"
          >
            <ChevronLeft className="mr-1 h-4 w-4" />
            Back to settings
          </Button>

          <div className="flex flex-wrap items-center justify-between gap-4 border-b pb-4">
            <div>
              <h1 className="text-2xl font-semibold text-slate-900">Player Roster Import</h1>
              <p className="text-sm text-muted-foreground">
                Import player rosters from your past events into {tournament.name}.
              </p>
            </div>
            <Badge variant="outline">ID #{tournament.id}</Badge>
          </div>

          <PlayerImportCard tournamentId={tournamentId} targetTournamentName={tournament.name} />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-transparent">
      <div className="mx-auto max-w-4xl space-y-6 p-6">
        <Button
          variant="link"
          onClick={() => setLocation(`/tournaments/${tournamentId}/manage`)}
          className="pl-0 text-slate-500 hover:text-slate-900"
        >
          <ChevronLeft className="mr-1 h-4 w-4" />
          Back to management
        </Button>

        <div className="flex flex-wrap items-center justify-between gap-4 border-b pb-4">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">Tournament Settings</h1>
            <p className="text-sm text-muted-foreground">
              Manage configuration, templates, and administrative controls for {tournament.name}.
            </p>
          </div>
          <Badge variant="outline">ID #{tournament.id}</Badge>
        </div>

        <TournamentActionsContent 
          tournamentId={tournamentId} 
          tournament={tournament} 
          parsedConfig={parsedConfig} 
        />
      </div>
    </div>
  );
}

function PlayerImportCard({ tournamentId, targetTournamentName }: { tournamentId: number; targetTournamentName?: string }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedSourceId, setSelectedSourceId] = useState<string>("");
  const [selectedPlayerIds, setSelectedPlayerIds] = useState<Set<number>>(new Set());

  // Fetch all my tournaments
  const { data: tournaments = [], isLoading: loadingTournaments } = useQuery<Tournament[]>({
    queryKey: ["/api/my-tournaments"],
  });

  // Filter out current tournament
  const sourceTournaments = tournaments.filter(t => t.id !== tournamentId);

  // Fetch players for selected source tournament
  const { data: sourcePlayers = [], isLoading: loadingPlayers } = useQuery<Player[]>({
    queryKey: [`/api/tournaments/${selectedSourceId}/players`],
    enabled: !!selectedSourceId,
  });

  // Update selected players when source tournament changes
  useEffect(() => {
    setSelectedPlayerIds(new Set());
  }, [selectedSourceId]);

  const togglePlayer = (id: number) => {
    setSelectedPlayerIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedPlayerIds.size === sourcePlayers.length) {
      setSelectedPlayerIds(new Set());
    } else {
      setSelectedPlayerIds(new Set(sourcePlayers.map(p => p.id)));
    }
  };

  const importMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest(`/api/tournaments/${tournamentId}/import-players`, {
        method: "POST",
        body: JSON.stringify({
          sourceTournamentId: parseInt(selectedSourceId),
          playerIds: Array.from(selectedPlayerIds),
        }),
      });
      return res;
    },
    onSuccess: async (res) => {
      const responseData = await res.json();
      toast({
        title: "Players Imported",
        description: responseData.message || `Successfully imported ${selectedPlayerIds.size} players.`,
      });
      queryClient.invalidateQueries({ queryKey: [`/api/tournaments/${tournamentId}/players`] });
      setSelectedPlayerIds(new Set());
      setSelectedSourceId("");
    },
    onError: (error: any) => {
      toast({
        title: "Import failed",
        description: error?.message ?? "An error occurred during import.",
        variant: "destructive",
      });
    },
  });

  return (
    <Card className="shadow-sm">
      <CardHeader>
        <CardTitle className="text-xl font-bold flex items-center gap-2 text-indigo-900">
          <UserPlus className="h-5 w-5 text-indigo-600" />
          <span>Import Players from Past Tournament</span>
        </CardTitle>
        <p className="text-sm text-slate-500">
          Clone player rosters from your previous tournaments to quickly sign up the same set of players.
        </p>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
          <label className="text-sm font-semibold text-slate-700">Select Past Tournament</label>
          {loadingTournaments ? (
            <div className="flex items-center gap-2 text-slate-500 text-sm py-2">
              <Loader2 className="h-4 w-4 animate-spin text-indigo-500" />
              <span>Loading tournaments...</span>
            </div>
          ) : sourceTournaments.length === 0 ? (
            <p className="text-sm text-slate-500 italic py-2">No other tournaments available to clone from.</p>
          ) : (
            <Select value={selectedSourceId} onValueChange={setSelectedSourceId}>
              <SelectTrigger className="w-full md:w-80">
                <SelectValue placeholder="Choose a tournament..." />
              </SelectTrigger>
              <SelectContent>
                {sourceTournaments.map(t => (
                  <SelectItem key={t.id} value={String(t.id)}>
                    {t.name} ({t.status})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        {selectedSourceId && (
          <div className="space-y-4 pt-4 border-t">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-slate-800">
                Available Players ({sourcePlayers.length})
              </h3>
              {sourcePlayers.length > 0 && (
                <Button variant="outline" size="sm" onClick={toggleAll}>
                  {selectedPlayerIds.size === sourcePlayers.length ? "Deselect All" : "Select All"}
                </Button>
              )}
            </div>

            {loadingPlayers ? (
              <div className="flex items-center justify-center py-8 text-slate-500 text-sm">
                <Loader2 className="h-6 w-6 animate-spin text-indigo-500 mr-2" />
                <span>Loading players roster...</span>
              </div>
            ) : sourcePlayers.length === 0 ? (
              <p className="text-sm text-slate-500 italic py-4 text-center">No players found in this tournament.</p>
            ) : (
              <div className="border rounded-lg overflow-hidden max-h-[300px] overflow-y-auto">
                <table className="w-full text-left text-sm text-slate-600 border-collapse">
                  <thead className="bg-slate-50 text-slate-700 uppercase text-xs font-semibold border-b sticky top-0">
                    <tr>
                      <th className="p-3 w-12 text-center">Select</th>
                      <th className="p-3">Name</th>
                      <th className="p-3">Rating</th>
                      <th className="p-3">Section</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {sourcePlayers.map(p => {
                      const isSelected = selectedPlayerIds.has(p.id);
                      return (
                        <tr
                          key={p.id}
                          className={cn(
                            "hover:bg-slate-50 cursor-pointer transition-colors",
                            isSelected && "bg-indigo-50/50"
                          )}
                          onClick={() => togglePlayer(p.id)}
                        >
                          <td className="p-3 text-center" onClick={(e) => e.stopPropagation()}>
                            <Checkbox
                              checked={isSelected}
                              onCheckedChange={() => togglePlayer(p.id)}
                            />
                          </td>
                          <td className="p-3 font-medium text-slate-900">
                            {p.firstName} {p.lastName}
                          </td>
                          <td className="p-3">{p.rating ?? "1000"}</td>
                          <td className="p-3 text-slate-500">{p.sectionName || "Open"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            <div className="flex justify-end pt-4 border-t">
              <Button
                onClick={() => importMutation.mutate()}
                disabled={selectedPlayerIds.size === 0 || importMutation.isPending}
                className="bg-indigo-600 text-white hover:bg-indigo-700 flex items-center gap-2"
              >
                {importMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                <span>Import Selected ({selectedPlayerIds.size})</span>
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
