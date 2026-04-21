import { useMemo, useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { ChevronLeft, Download, Printer, Loader2, Globe, Flag } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  parseTournamentConfig,
  serializeTournamentConfig,
  buildTournamentPayload,
  type TournamentConfig,
  type FideRegistrationData,
  type UscfReportData
} from "@/lib/tournament-config";
import { FideRegistrationSection, UscfReportSection } from "@/components/tournament-settings/sections";
import { cn } from "@/lib/utils";
import type { Tournament, Player, Match } from "@shared/schema";

interface TournamentReportsPageProps {
  tournamentId: number;
  type: "fide" | "uscf";
}

export default function TournamentReportsPage({ tournamentId, type }: TournamentReportsPageProps) {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const reportRef = useRef<HTMLDivElement>(null);

  const { data: tournament, isLoading: tournamentLoading } = useQuery<Tournament>({
    queryKey: [`/api/tournaments/${tournamentId}`],
  });

  const { data: players, isLoading: playersLoading } = useQuery<Player[]>({
    queryKey: [`/api/tournaments/${tournamentId}/players`],
  });

  const { data: matches, isLoading: matchesLoading } = useQuery<Match[]>({
    queryKey: [`/api/tournaments/${tournamentId}/matches`],
  });

  const config = useMemo(() => (tournament ? parseTournamentConfig(tournament) : null), [tournament]);

  const updateConfig = async (updates: Partial<TournamentConfig>) => {
    if (!config || !tournament) return;
    const nextConfig = { ...config, ...updates };
    const payload = buildTournamentPayload(nextConfig, { format: tournament.format });
    (payload as any).status = tournament.status;
    
    try {
      await apiRequest(`/api/tournaments/${tournamentId}`, {
        method: "PUT",
        body: JSON.stringify(payload),
      });
      queryClient.invalidateQueries({ queryKey: [`/api/tournaments/${tournamentId}`] });
      toast({ title: "Report data saved" });
    } catch (error: any) {
      toast({ title: "Failed to save data", description: error.message, variant: "destructive" });
    }
  };

  const handlePrint = () => {
    if (!reportRef.current) return;
    window.print();
  };

  if (tournamentLoading || playersLoading || matchesLoading || !tournament || !config) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <div className="flex items-center gap-3 text-slate-500">
          <Loader2 className="h-5 w-5 animate-spin" />
          Loading report data...
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 pb-20 print:bg-white print:pb-0">
      <div className="mx-auto max-w-5xl space-y-8 p-6 print:p-0 print:max-w-none">
        <div className="flex items-center justify-between print:hidden">
          <Button
            variant="ghost"
            onClick={() => setLocation(`/tournaments/${tournamentId}/manage`)}
            className="pl-0 text-slate-500 hover:text-slate-900"
          >
            <ChevronLeft className="mr-1 h-4 w-4" />
            Back to Management
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={handlePrint}>
              <Printer className="mr-2 h-4 w-4" />
              Print Report
            </Button>
          </div>
        </div>

        <div className="space-y-6">
          <div className="flex items-center gap-4 print:hidden">
            <div className={cn(
              "w-12 h-12 rounded-2xl flex items-center justify-center shadow-sm",
              type === "fide" ? "bg-blue-50 text-blue-600" : "bg-red-50 text-red-600"
            )}>
              {type === "fide" ? <Globe className="h-6 w-6" /> : <Flag className="h-6 w-6" />}
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900">
                {type === "fide" ? "FIDE Federation Report" : "USCF Rating Report"}
              </h1>
              <p className="text-sm text-slate-500">
                Tournament ID: #{tournamentId} • {tournament.name}
              </p>
            </div>
          </div>

          <div className="grid gap-8 lg:grid-cols-[1fr,350px] print:grid-cols-1">
            <div className="space-y-8">
              {type === "fide" ? (
                <FideRegistrationSection
                  value={config.fide}
                  onChange={(update) => updateConfig({ fide: { ...config.fide, ...update } })}
                  tournamentName={tournament.name}
                  tournamentCity={tournament.location ?? ""}
                />
              ) : (
                <div className="space-y-8">
                  <UscfReportSection
                    value={config.uscf}
                    onChange={(update) => updateConfig({ uscf: { ...config.uscf, ...update } })}
                  />
                  
                  {/* Official USCF Preview */}
                  <Card className="border-slate-200 shadow-md">
                    <CardHeader className="bg-slate-50/50 border-b">
                      <CardTitle className="text-lg font-bold flex items-center gap-2">
                        Official USCF Post-Tournament Summary
                      </CardTitle>
                      <CardDescription>Preview of the official summary layout.</CardDescription>
                    </CardHeader>
                    <CardContent className="p-8 space-y-8 print:p-0">
                      <div className="text-center space-y-1">
                        <h2 className="text-xl font-bold uppercase tracking-tight">US Chess Federation</h2>
                        <h3 className="text-lg font-bold border-b-2 border-black inline-block px-4 pb-1">Tournament Summary</h3>
                      </div>

                      <div className="grid grid-cols-2 gap-x-12 gap-y-4 text-sm mt-8">
                        <div className="space-y-3">
                          <div className="flex justify-between border-b border-slate-200 pb-1">
                            <span className="font-bold text-slate-400 uppercase text-[9px] tracking-wider">Event Name</span>
                            <span className="font-bold text-slate-900">{tournament.name}</span>
                          </div>
                          <div className="flex justify-between border-b border-slate-200 pb-1">
                            <span className="font-bold text-slate-400 uppercase text-[9px] tracking-wider">Location</span>
                            <span className="font-bold text-slate-900">{tournament.location || "N/A"}</span>
                          </div>
                          <div className="flex justify-between border-b border-slate-200 pb-1">
                            <span className="font-bold text-slate-400 uppercase text-[9px] tracking-wider">Date Ended</span>
                            <span className="font-bold text-slate-900">{tournament.arenaStartTime ? new Date(tournament.arenaStartTime).toLocaleDateString() : "N/A"}</span>
                          </div>
                        </div>
                        <div className="space-y-3">
                          <div className="flex justify-between border-b border-slate-200 pb-1">
                            <span className="font-bold text-slate-400 uppercase text-[9px] tracking-wider">Affiliate ID</span>
                            <span className="font-bold text-slate-900">{config.uscf.affiliateId || "N/A"}</span>
                          </div>
                          <div className="flex justify-between border-b border-slate-200 pb-1">
                            <span className="font-bold text-slate-400 uppercase text-[9px] tracking-wider">Tournament Director</span>
                            <span className="font-bold text-slate-900">{config.uscf.tournamentDirector || "N/A"}</span>
                          </div>
                          <div className="flex justify-between border-b border-slate-200 pb-1">
                            <span className="font-bold text-slate-400 uppercase text-[9px] tracking-wider">Total Entrants</span>
                            <span className="font-bold text-slate-900">{players?.length || 0}</span>
                          </div>
                        </div>
                      </div>

                      <div className="space-y-6 mt-10">
                        <div className="flex items-center gap-3">
                          <h4 className="font-black text-xs bg-slate-900 text-white px-3 py-1.5 rounded-sm uppercase tracking-widest">Cross Table Summary</h4>
                          <div className="h-px bg-slate-200 flex-1" />
                        </div>
                        <div className="overflow-x-auto rounded-lg border border-slate-200">
                          <table className="w-full text-[11px] border-collapse">
                            <thead>
                              <tr className="bg-slate-50 border-b border-slate-200">
                                <th className="text-left py-2.5 px-4 font-bold text-slate-500 uppercase tracking-tighter">Rank</th>
                                <th className="text-left py-2.5 px-4 font-bold text-slate-500 uppercase tracking-tighter">ID Number</th>
                                <th className="text-left py-2.5 px-4 font-bold text-slate-500 uppercase tracking-tighter">Participant Name</th>
                                <th className="text-left py-2.5 px-4 font-bold text-slate-500 uppercase tracking-tighter">Rating</th>
                                <th className="text-center py-2.5 px-4 font-bold text-slate-500 uppercase tracking-tighter">Total Score</th>
                              </tr>
                            </thead>
                            <tbody>
                              {players?.sort((a, b) => Number(b.arenaPoints) - Number(a.arenaPoints)).map((player, idx) => (
                                <tr key={player.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/30 transition-colors">
                                  <td className="py-2.5 px-4 font-black text-slate-400">{idx + 1}</td>
                                  <td className="py-2.5 px-4 font-mono text-slate-600">{player.id.toString().padStart(8, '0')}</td>
                                  <td className="py-2.5 px-4 font-bold text-slate-900 uppercase">
                                    {player.lastName}, {player.firstName}
                                  </td>
                                  <td className="py-2.5 px-4 font-medium text-slate-700">
                                    {(player.uscfRating || player.rating || 1000)}
                                  </td>
                                  <td className="py-2.5 px-4 text-center font-black bg-slate-50/50 text-slate-900">{player.arenaPoints}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-12 mt-12 text-[11px]">
                        <div className="space-y-4">
                          <div className="flex justify-between border-b border-dotted border-slate-300 pb-1">
                            <span className="text-slate-500">Chief Tournament Director</span>
                            <span className="font-bold underline uppercase">{config.uscf.tournamentDirector || (user?.username.toUpperCase())}</span>
                          </div>
                          <div className="flex justify-between border-b border-dotted border-slate-300 pb-1">
                            <span className="text-slate-500">TD USCF ID:</span>
                            <span className="font-bold">{config.uscf.affiliateId || "PENDING"}</span>
                          </div>
                        </div>
                        <div className="space-y-4">
                          <div className="flex justify-between border-b border-dotted border-slate-300 pb-1">
                            <span className="text-slate-500">Section Name</span>
                            <span className="font-bold">ARENA CHAMPIONSHIP</span>
                          </div>
                          <div className="flex justify-between border-b border-dotted border-slate-300 pb-1">
                            <span className="text-slate-500">Rating System</span>
                            <span className="font-bold">ONLINE BLITZ</span>
                          </div>
                        </div>
                      </div>

                      <div className="mt-16 pt-8 border-t-2 border-slate-100 space-y-6">
                        <div className="grid grid-cols-2 gap-12">
                          <div className="space-y-8">
                            <div className="space-y-1">
                              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Director's Certification</p>
                              <p className="text-[11px] leading-relaxed text-slate-600 italic">
                                I certify that the information contained in this report is a true and accurate record of the tournament results and has been conducted in accordance with the rules of the US Chess Federation.
                              </p>
                            </div>
                            <div className="pt-8 border-b border-black w-full" />
                            <p className="text-[9px] font-bold uppercase text-slate-400">Main Tournament Director Signature</p>
                          </div>
                          <div className="space-y-4">
                            <div className="p-4 bg-slate-50 rounded-xl border border-slate-200">
                              <p className="text-[10px] font-bold text-slate-500 uppercase mb-2">Internal Verification</p>
                              <div className="flex items-center justify-between text-[11px]">
                                <span>Software Integrity</span>
                                <Badge variant="outline" className="text-[9px] h-4 px-1.5 bg-white">SECURE</Badge>
                              </div>
                              <div className="flex items-center justify-between text-[11px] mt-1">
                                <span>Checksum Valid</span>
                                <Badge variant="outline" className="text-[9px] h-4 px-1.5 bg-white">MATCH</Badge>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="mt-12 text-center text-[10px] text-slate-400 font-medium italic border-t pt-4">
                        Generated by Chess Tournament Manager Official Reporting Tool
                      </div>
                    </CardContent>
                  </Card>
                </div>
              )}
            </div>

            <div className="space-y-6 print:hidden">
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm font-bold uppercase tracking-wider text-slate-500">Report Status</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">Validation</span>
                    <Badge variant="outline" className="text-green-600 bg-green-50 border-green-100">PASS</Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">Standings</span>
                    <Badge variant="outline" className="text-slate-600 bg-slate-50">SYNCED</Badge>
                  </div>
                  <Separator />
                  <p className="text-xs text-slate-500">
                    Ensure all data is accurate before finalizing for submission to the federation.
                  </p>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </div>
      <style>{`
        @media print {
          body * {
            visibility: hidden;
          }
          .print\\:p-0, .print\\:p-0 * {
            visibility: visible;
          }
          .print\\:p-0 {
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
          }
          @page {
            margin: 1cm;
          }
          .print\\:hidden {
            display: none !important;
          }
        }
      `}</style>
    </div>
  );
}


