import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Mail, Share2, Trash2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { Tournament } from "@shared/schema";

interface TournamentActionsPageProps {
  tournamentId: number;
}

export default function TournamentActionsPage({ tournamentId }: TournamentActionsPageProps) {
  const { user, isLoading: authLoading } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [deleting, setDeleting] = useState(false);
  const [shareEmails, setShareEmails] = useState("");
  const [shareMessage, setShareMessage] = useState("");

  const { data: tournament, isLoading: tournamentLoading } = useQuery<Tournament>({
    queryKey: [`/api/tournaments/${tournamentId}`],
  });

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
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
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
    const message = shareMessage.trim().length > 0 ? `${shareMessage.trim()}

` : "";
    const body = encodeURIComponent(`${message}Event details: ${link}`);
    const to = encodeURIComponent(recipients.join(","));
    window.location.href = `mailto:${to}?subject=${subject}&body=${body}`;
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-4xl space-y-6 p-6">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b pb-4">
          <div>
            <Button variant="outline" onClick={() => setLocation(`/tournaments/${tournamentId}`)}>
              Back to tournament
            </Button>
            <h1 className="mt-4 text-2xl font-semibold text-slate-900">Tournament actions</h1>
            <p className="text-sm text-muted-foreground">
              Manage advanced settings for {tournament.name}.
            </p>
          </div>
          <Badge variant="outline">ID #{tournament.id}</Badge>
        </div>

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
      </div>
    </div>
  );
}
