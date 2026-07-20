import React, { useState, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { 
  UserCheck, 
  UserX, 
  Clock, 
  CheckCircle2, 
  XCircle, 
  Eye, 
  Search, 
  SlidersHorizontal,
  CreditCard,
  Calendar,
  User,
  MapPin,
  ClipboardList
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { PlayerRegistration, Tournament } from "@shared/schema";
import { cn } from "@/lib/utils";
import { parseTournamentConfig } from "@/lib/tournament-config";
import { resolveDisplayRating } from "@shared/tournament-config";

interface RegistrationManagementProps {
  tournamentId: number;
  tournament?: Tournament;
}

export default function RegistrationManagement({ tournamentId, tournament }: RegistrationManagementProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "pending" | "approved" | "declined">("all");
  const [selectedReg, setSelectedReg] = useState<PlayerRegistration | null>(null);

  const [visibleColumns, setVisibleColumns] = useState<string[]>(() => {
    try {
      const stored = window.localStorage.getItem(`tournament-${tournamentId}-visible-registration-columns`);
      if (stored) return JSON.parse(stored);
    } catch (e) {
      console.error(e);
    }
    // Default columns
    return ["index", "name", "section", "rating", "payment", "createdAt", "status", "actions"];
  });

  React.useEffect(() => {
    try {
      window.localStorage.setItem(`tournament-${tournamentId}-visible-registration-columns`, JSON.stringify(visibleColumns));
    } catch (e) {
      console.error(e);
    }
  }, [visibleColumns, tournamentId]);

  const { data: registrations = [], isLoading } = useQuery<PlayerRegistration[]>({
    queryKey: [`/api/tournaments/${tournamentId}/registrations`],
    retry: false,
  });

  const updateRegistrationMutation = useMutation({
    mutationFn: async ({ registrationId, status }: { registrationId: number; status: string }) => {
      return apiRequest(`/api/tournaments/${tournamentId}/registrations/${registrationId}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
    },
    onSuccess: (_, { registrationId, status }) => {
      toast({
        title: `Registration ${status.charAt(0).toUpperCase() + status.slice(1)}`,
        description: `Successfully marked registration as ${status}.`,
      });
      queryClient.invalidateQueries({ queryKey: [`/api/tournaments/${tournamentId}/registrations`] });
      queryClient.invalidateQueries({ queryKey: [`/api/tournaments/${tournamentId}/players`] });
      // If the currently open modal is the one updated, sync it
      if (selectedReg) {
        setSelectedReg(prev => prev && prev.id === registrationId ? { ...prev, status } : prev);
      }
    },
    onError: (err: any) => {
      toast({
        title: "Operation Failed",
        description: err?.message || "Could not update registration status.",
        variant: "destructive",
      });
    }
  });

  // Calculate stats
  const stats = useMemo(() => {
    return {
      total: registrations.length,
      pending: registrations.filter(r => r.status === "pending").length,
      approved: registrations.filter(r => r.status === "approved").length,
      declined: registrations.filter(r => r.status === "declined").length,
    };
  }, [registrations]);

  const tournamentConfig = useMemo(() => {
    return tournament ? parseTournamentConfig(tournament) : null;
  }, [tournament]);

  const getUscfActiveStatus = (reg: any) => {
    const uscfExpiration = reg.customAnswers?.uscfExpiration;
    if (!uscfExpiration) {
      return reg.uscfActive === true || reg.uscfActive === "true" || reg.uscfActive === 1;
    }
    try {
      const expDate = new Date(uscfExpiration);
      if (isNaN(expDate.getTime())) {
        return reg.uscfActive === true || reg.uscfActive === "true" || reg.uscfActive === 1;
      }
      const tourneyStart = tournament?.startDate ? new Date(tournament.startDate) : new Date();
      return expDate >= tourneyStart;
    } catch {
      return reg.uscfActive === true || reg.uscfActive === "true" || reg.uscfActive === 1;
    }
  };

  // Filter registrations
  const filteredRegs = useMemo(() => {
    return registrations.filter(reg => {
      const matchesSearch = reg.playerName?.toLowerCase().includes(searchTerm.toLowerCase()) || 
        reg.email?.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesStatus = statusFilter === "all" || reg.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [registrations, searchTerm, statusFilter]);

  // Map custom field answer to human readable labels
  const getCustomAnswersList = (reg: PlayerRegistration) => {
    const answers = reg.customAnswers as Record<string, any> || {};
    const fields = tournamentConfig?.registrationFormConfig?.fields || [];
    
    return Object.entries(answers).map(([key, value]) => {
      const configField = fields.find(f => f.id === key);
      let label = configField ? configField.label : key.replace(/^(custom_)/, "").replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
      if (key === "prizeStripeEmail") label = "Prize Stripe Email";
      if (key === "prizeBankRouting") label = "Prize Bank Routing Number";
      if (key === "prizeBankAccount") label = "Prize Bank Account Number";
      if (key === "prizeZelleEmail") label = "Prize Zelle Email";
      if (key === "prizeZellePhone") label = "Prize Zelle Phone";
      
      let displayValue = "";
      if (typeof value === "boolean") {
        displayValue = value ? "Yes" : "No";
      } else if (value === null || value === undefined) {
        displayValue = "—";
      } else {
        displayValue = String(value);
      }

      return { key, label, value: displayValue };
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Clock className="h-6 w-6 animate-spin text-slate-400 mr-2" />
        <span className="text-slate-500 font-medium">Loading registrations...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Stats Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="bg-slate-50 border-slate-200 shadow-sm">
          <CardContent className="p-4 flex flex-col justify-between h-20">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Total</span>
            <span className="text-2xl font-bold text-slate-900">{stats.total}</span>
          </CardContent>
        </Card>
        <Card className="bg-amber-50 border-amber-200/60 shadow-sm">
          <CardContent className="p-4 flex flex-col justify-between h-20">
            <span className="text-xs font-semibold text-amber-600 uppercase tracking-wider">Pending</span>
            <span className="text-2xl font-bold text-amber-700">{stats.pending}</span>
          </CardContent>
        </Card>
        <Card className="bg-emerald-50 border-emerald-200/60 shadow-sm">
          <CardContent className="p-4 flex flex-col justify-between h-20">
            <span className="text-xs font-semibold text-emerald-600 uppercase tracking-wider">Approved</span>
            <span className="text-2xl font-bold text-emerald-700">{stats.approved}</span>
          </CardContent>
        </Card>
        <Card className="bg-red-50 border-red-200/60 shadow-sm">
          <CardContent className="p-4 flex flex-col justify-between h-20">
            <span className="text-xs font-semibold text-red-600 uppercase tracking-wider">Declined</span>
            <span className="text-2xl font-bold text-red-700">{stats.declined}</span>
          </CardContent>
        </Card>
      </div>

      {/* Roster / Registration Table Toolbar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
          <Input 
            placeholder="Search by name or email..." 
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-9 h-10 bg-white border-slate-200"
          />
        </div>
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 w-full md:w-auto">
          <div className="flex bg-slate-100 p-0.5 rounded-lg border border-slate-200 w-full sm:w-auto">
            {(["all", "pending", "approved", "declined"] as const).map((status) => (
              <button
                key={status}
                onClick={() => setStatusFilter(status)}
                className={cn(
                  "flex-1 sm:flex-none px-4 py-1.5 rounded-md text-xs font-semibold transition-all whitespace-nowrap capitalize",
                  statusFilter === status 
                    ? "bg-white text-slate-900 shadow-sm"
                    : "text-slate-500 hover:text-slate-800"
                )}
              >
                {status}
              </button>
            ))}
          </div>

          {/* Column Selection Popover */}
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" className="h-10 border-slate-200 hover:bg-slate-50">
                <Eye className="mr-2 h-4 w-4 text-slate-500" />
                Columns
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-56 p-3 space-y-2.5 bg-white shadow-lg border border-slate-200 rounded-lg" align="end">
              <div className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1 px-1">Visible Columns</div>
              <div className="space-y-2 max-h-[300px] overflow-y-auto no-scrollbar">
                {[
                  { id: "index", label: "# Number" },
                  { id: "name", label: "Player Details" },
                  { id: "section", label: "Section Choice" },
                  { id: "rating", label: "Unified Rating" },
                  { id: "uscfRating", label: "USCF Rating" },
                  { id: "fideRating", label: "FIDE Rating" },
                  { id: "uscfId", label: "USCF ID" },
                  { id: "fideId", label: "FIDE ID" },
                  { id: "uscfStatus", label: "USCF Membership" },
                  { id: "email", label: "Email Address" },
                  { id: "byes", label: "Byes List" },
                  { id: "payment", label: "Payment Status" },
                  { id: "createdAt", label: "Date Submitted" },
                  { id: "status", label: "Approval Status" },
                  { id: "actions", label: "Actions" },
                ].map((col) => (
                  <label key={col.id} className="flex items-center gap-2 px-1 text-sm text-slate-700 cursor-pointer hover:bg-slate-50 rounded py-0.5 select-none">
                    <Checkbox
                      id={`col-${col.id}`}
                      checked={visibleColumns.includes(col.id)}
                      onCheckedChange={(checked) => {
                        if (checked) {
                          setVisibleColumns([...visibleColumns, col.id]);
                        } else {
                          setVisibleColumns(visibleColumns.filter((id) => id !== col.id));
                        }
                      }}
                    />
                    <span>{col.label}</span>
                  </label>
                ))}
              </div>
            </PopoverContent>
          </Popover>
        </div>
      </div>
      {/* Main Table */}
      <Card className="border-slate-200/60 shadow-[0_8px_30px_rgba(0,0,0,0.04)] rounded-2xl overflow-hidden">
        <Table>
          <TableHeader className="bg-slate-50/80">
            <TableRow className="border-b border-slate-200/80 hover:bg-transparent">
              {visibleColumns.includes("index") && (
                <TableHead className="w-10 sticky left-0 z-20 text-center text-sm font-semibold text-slate-500 bg-slate-50/80 font-sans">#</TableHead>
              )}
              {visibleColumns.includes("name") && (
                <TableHead className={cn(
                  "sticky z-20 text-sm font-semibold text-slate-500 bg-slate-50/80 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.05)] font-sans px-2 py-2",
                  visibleColumns.includes("index") ? "left-10" : "left-0"
                )}>
                  Player
                </TableHead>
              )}
              {visibleColumns.includes("section") && <TableHead className="text-sm font-semibold text-slate-500 bg-slate-50/80 font-sans px-2 py-2">Section Choice</TableHead>}
              {visibleColumns.includes("rating") && <TableHead className="text-sm font-semibold text-slate-500 bg-slate-50/80 font-sans px-2 py-2">Unified Rating</TableHead>}
              {visibleColumns.includes("uscfRating") && <TableHead className="text-sm font-semibold text-slate-500 bg-slate-50/80 font-sans px-2 py-2">USCF Rating</TableHead>}
              {visibleColumns.includes("fideRating") && <TableHead className="text-sm font-semibold text-slate-500 bg-slate-50/80 font-sans px-2 py-2">FIDE Rating</TableHead>}
              {visibleColumns.includes("uscfId") && <TableHead className="text-sm font-semibold text-slate-500 bg-slate-50/80 font-sans px-2 py-2">USCF ID</TableHead>}
              {visibleColumns.includes("fideId") && <TableHead className="text-sm font-semibold text-slate-500 bg-slate-50/80 font-sans px-2 py-2">FIDE ID</TableHead>}
              {visibleColumns.includes("uscfStatus") && <TableHead className="text-sm font-semibold text-slate-500 bg-slate-50/80 font-sans px-2 py-2">USCF Membership</TableHead>}
              {visibleColumns.includes("email") && <TableHead className="text-sm font-semibold text-slate-500 bg-slate-50/80 font-sans px-2 py-2">Email</TableHead>}
              {visibleColumns.includes("byes") && <TableHead className="text-sm font-semibold text-slate-500 bg-slate-50/80 font-sans px-2 py-2">Byes</TableHead>}
              {visibleColumns.includes("payment") && <TableHead className="text-sm font-semibold text-slate-500 bg-slate-50/80 font-sans px-2 py-2">Payment</TableHead>}
              {visibleColumns.includes("createdAt") && <TableHead className="text-sm font-semibold text-slate-500 bg-slate-50/80 font-sans px-2 py-2">Submitted</TableHead>}
              {visibleColumns.includes("status") && <TableHead className="text-sm font-semibold text-slate-500 bg-slate-50/80 font-sans px-2 py-2">Status</TableHead>}
              {visibleColumns.includes("actions") && (
                <TableHead className="w-32 pl-2 pr-2 py-2 text-right text-sm font-semibold text-slate-500 bg-slate-50/80 sticky right-0 z-20 shadow-[-2px_0_5px_-2px_rgba(0,0,0,0.05)] font-sans">
                  Actions
                </TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody className="font-sans text-sm">
            {filteredRegs.length === 0 ? (
              <TableRow>
                <TableCell colSpan={visibleColumns.length} className="py-12 text-center text-slate-400">
                  No registrations found matching the criteria.
                </TableCell>
              </TableRow>
            ) : (
              filteredRegs.map((reg, index) => {
                const primarySystem = tournamentConfig?.details?.primaryRatingSystem || "uscf";
                const threshold = tournamentConfig?.registers?.uscfMinGamesThreshold ?? 4;
                const uscfDisp = resolveDisplayRating((reg as any).uscfRatingRaw, reg.uscfRating, threshold, false);
                const fideDisp = resolveDisplayRating((reg as any).fideRatingRaw, reg.fideRating, 0, true);
                const rating = primarySystem === "fide"
                  ? (fideDisp !== "Unrated" ? fideDisp : uscfDisp)
                  : (uscfDisp !== "Unrated" ? uscfDisp : fideDisp);
                const isIndexVisible = visibleColumns.includes("index");

                return (
                  <TableRow 
                    key={reg.id} 
                    className="group border-b border-slate-100 cursor-pointer transition-colors hover:bg-slate-50/80 dark:bg-slate-800/40 dark:hover:bg-slate-700/40 h-11 font-sans text-sm"
                    onClick={() => setSelectedReg(reg)}
                  >
                    {visibleColumns.includes("index") && (
                      <TableCell className={cn(
                        "sticky left-0 transition-colors z-10 text-sm font-semibold text-slate-500 text-center px-2 py-2 font-sans",
                        "bg-white group-hover:bg-slate-50/85"
                      )}>
                        <div className="font-sans">{index + 1}</div>
                      </TableCell>
                    )}
                    {visibleColumns.includes("name") && (
                      <TableCell className={cn(
                        "sticky transition-colors z-10 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.05)] px-2 py-2 overflow-hidden truncate font-sans text-sm",
                        isIndexVisible ? "left-10" : "left-0",
                        "bg-white group-hover:bg-slate-50/85"
                      )}>
                        <div className="flex flex-col gap-0.5 font-sans text-sm">
                          <span className="text-sm font-semibold text-slate-850 hover:text-indigo-650 transition-colors truncate font-sans">
                            {reg.uscfId || reg.fideId ? (
                              <a
                                href={
                                  reg.ratingProvider === "fide" && reg.fideId
                                    ? `https://ratings.fide.com/profile/${reg.fideId}`
                                    : reg.ratingProvider === "uscf" && reg.uscfId
                                    ? `https://ratings.uschess.org/player/${reg.uscfId}`
                                    : reg.uscfId
                                    ? `https://ratings.uschess.org/player/${reg.uscfId}`
                                    : reg.fideId
                                    ? `https://ratings.fide.com/profile/${reg.fideId}`
                                    : undefined
                                }
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-indigo-600 hover:text-indigo-850 hover:underline cursor-pointer font-sans"
                                onClick={(e) => e.stopPropagation()}
                              >
                                {reg.playerName}
                              </a>
                            ) : (
                              reg.playerName
                            )}
                          </span>
                          {!visibleColumns.includes("email") && reg.email && (
                            <span className="text-xs text-slate-400 font-medium">{reg.email}</span>
                          )}
                        </div>
                      </TableCell>
                    )}
                    {visibleColumns.includes("section") && (
                      <TableCell className="px-2 py-2 text-sm font-medium text-slate-705 font-sans">
                        <Badge variant="secondary" className="bg-slate-100 hover:bg-slate-100 text-slate-700 text-xs px-2 py-0.5 capitalize shadow-none">
                          {reg.sectionChoice || "Default"}
                        </Badge>
                      </TableCell>
                    )}
                    {visibleColumns.includes("rating") && (
                      <TableCell className="px-2 py-2 text-sm font-medium text-slate-850 overflow-hidden font-sans">
                        {rating === "Unrated" ? (
                          <span className="text-sm text-slate-400 font-sans">—</span>
                        ) : (
                          <span className="font-sans text-sm font-semibold text-slate-800 bg-slate-50 px-2 py-0.5 rounded border border-slate-200/60 shadow-sm whitespace-nowrap font-mono">{rating}</span>
                        )}
                      </TableCell>
                    )}
                    {visibleColumns.includes("uscfRating") && (
                      <TableCell className="px-2 py-2 text-sm font-medium text-slate-850 overflow-hidden font-sans">
                        {reg.uscfId ? (
                          <span className="font-sans text-sm font-semibold text-slate-800 bg-slate-50 px-2 py-0.5 rounded border border-slate-200/60 shadow-sm whitespace-nowrap font-mono">
                            {resolveDisplayRating((reg as any).uscfRatingRaw, reg.uscfRating, threshold, false)}
                          </span>
                        ) : (
                          <span className="text-slate-400 font-sans">—</span>
                        )}
                      </TableCell>
                    )}
                    {visibleColumns.includes("fideRating") && (
                      <TableCell className="px-2 py-2 text-sm font-medium text-slate-850 overflow-hidden font-sans">
                        {reg.fideId ? (
                          <span className="font-sans text-sm font-semibold text-slate-800 bg-slate-50 px-2 py-0.5 rounded border border-slate-200/60 shadow-sm whitespace-nowrap font-mono">
                            {resolveDisplayRating((reg as any).fideRatingRaw, reg.fideRating, 0, true)}
                          </span>
                        ) : (
                          <span className="text-slate-400 font-sans">—</span>
                        )}
                      </TableCell>
                    )}
                    {visibleColumns.includes("uscfId") && (
                      <TableCell className="px-2 py-2 overflow-hidden font-sans text-sm">
                        {reg.uscfId ? (
                          <span className="font-sans text-sm font-semibold text-slate-800 bg-slate-50 px-2 py-0.5 rounded border border-slate-200/60 shadow-sm whitespace-nowrap">{reg.uscfId}</span>
                        ) : (
                          <span className="text-slate-400 font-sans">—</span>
                        )}
                      </TableCell>
                    )}
                    {visibleColumns.includes("fideId") && (
                      <TableCell className="px-2 py-2 overflow-hidden font-sans text-sm">
                        {reg.fideId ? (
                          <span className="font-sans text-sm font-semibold text-slate-800 bg-slate-50 px-2 py-0.5 rounded border border-slate-200/60 shadow-sm whitespace-nowrap">{reg.fideId}</span>
                        ) : (
                          <span className="text-slate-400 font-sans">—</span>
                        )}
                      </TableCell>
                    )}
                    {visibleColumns.includes("uscfStatus") && (
                      <TableCell className="px-2 py-2 whitespace-nowrap overflow-hidden font-sans text-sm">
                        {reg.uscfId ? (
                          <div className="flex flex-col gap-1 items-start">
                            <Badge 
                              variant="outline" 
                              className={cn(
                                "text-xs font-bold px-2 py-0.5 shadow-none",
                                getUscfActiveStatus(reg) 
                                  ? "bg-emerald-50 text-emerald-700 border-emerald-200" 
                                  : "bg-rose-50 text-rose-700 border-rose-200"
                              )}
                            >
                              {getUscfActiveStatus(reg) ? "Active" : "Expired"}
                            </Badge>
                            {(reg as any).isProvisional && (
                              <Badge 
                                variant="outline" 
                                className="text-[10px] font-medium px-1.5 py-0.5 bg-amber-50 text-amber-700 border-amber-200 shadow-none mt-0.5 whitespace-nowrap"
                              >
                                Provisional ({(reg as any).gamesCount ?? 0}g)
                              </Badge>
                            )}
                          </div>
                        ) : (
                          <span className="text-slate-400 text-sm font-sans">—</span>
                        )}
                      </TableCell>
                    )}
                    {visibleColumns.includes("email") && (
                      <TableCell className="px-2 py-2 text-sm font-normal truncate font-sans">
                        {reg.email || <span className="text-slate-400 font-sans">—</span>}
                      </TableCell>
                    )}
                    {visibleColumns.includes("byes") && (
                      <TableCell className="px-2 py-2 font-sans text-sm">
                        {reg.byePreference === "yes" && reg.byeRounds && (reg.byeRounds as string[]).length > 0 ? (
                          <Badge variant="outline" className="bg-slate-50 text-slate-650 border-slate-200 text-xs px-2 py-0.5 font-sans">
                            Byes: {(reg.byeRounds as string[]).map(r => r.replace("Round ", "")).join(", ")}
                          </Badge>
                        ) : (
                          <span className="text-slate-400 font-sans">—</span>
                        )}
                      </TableCell>
                    )}
                    {visibleColumns.includes("payment") && (
                      <TableCell className="px-2 py-2 overflow-hidden font-sans text-sm">
                        <div className="flex flex-col gap-1 items-start">
                          <div className="flex items-center gap-1.5">
                            <Badge 
                              variant="outline" 
                              className={cn(
                                "text-xs font-semibold px-2 py-0.5 shadow-none",
                                reg.paymentStatus === "paid" 
                                  ? "bg-emerald-50 text-emerald-700 border-emerald-200/50" 
                                  : reg.paymentStatus === "processing" 
                                  ? "bg-amber-50 text-amber-700 border-amber-200/50 animate-pulse"
                                  : "bg-slate-50 text-slate-500 border-slate-200"
                              )}
                            >
                              {reg.paymentStatus || "Unpaid"}
                            </Badge>
                            {reg.paymentMethod && (
                              <span className="text-xs text-slate-400 font-mono capitalize">({reg.paymentMethod})</span>
                            )}
                          </div>
                          <span className="text-xs font-mono text-slate-500 mt-0.5">
                            ${Number(reg.amountDue || 0).toFixed(2)} due
                          </span>
                        </div>
                      </TableCell>
                    )}
                    {visibleColumns.includes("createdAt") && (
                      <TableCell className="px-2 py-2 text-sm text-slate-600 font-sans">
                        {reg.updatedAt ? new Date(reg.updatedAt).toLocaleDateString() : "—"}
                      </TableCell>
                    )}
                    {visibleColumns.includes("status") && (
                      <TableCell className="px-2 py-2 font-sans text-sm">
                        <Badge 
                          className={cn(
                            "text-xs font-semibold px-2 py-0.5 shadow-none tracking-wide capitalize",
                            reg.status === "approved" 
                              ? "bg-emerald-600 hover:bg-emerald-600" 
                              : reg.status === "declined" 
                              ? "bg-red-500 hover:bg-red-500" 
                              : "bg-amber-500 hover:bg-amber-500"
                          )}
                        >
                          {reg.status}
                        </Badge>
                      </TableCell>
                    )}
                    {visibleColumns.includes("actions") && (
                      <TableCell className={cn(
                        "text-right sticky right-0 z-10 transition-colors shadow-[-2px_0_5px_-2px_rgba(0,0,0,0.05)] pl-2 pr-2 py-2 w-32 font-sans text-sm",
                        "bg-white group-hover:bg-slate-50/85"
                      )}>
                        <div className="flex items-center justify-end gap-1.5 font-sans text-sm pr-6" onClick={(e) => e.stopPropagation()}>
                          <Button 
                            size="sm" 
                            variant="ghost" 
                            className="h-8 w-8 p-0 text-slate-500 hover:text-slate-900 rounded-lg" 
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedReg(reg);
                            }}
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                          
                          {reg.status === "pending" && (
                            <>
                              <AlertDialog>
                                <AlertDialogTrigger asChild onClick={(e) => e.stopPropagation()}>
                                  <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 rounded-lg">
                                    <UserCheck className="h-4 w-4" />
                                  </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent className="bg-white border-slate-100" onClick={(e) => e.stopPropagation()}>
                                  <AlertDialogHeader>
                                    <AlertDialogTitle>Approve Player Registration?</AlertDialogTitle>
                                    <AlertDialogDescription>
                                      This will approve the registration for {reg.playerName}. If they are not already in the tournament roster, they will be added automatically.
                                    </AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                    <AlertDialogCancel onClick={(e) => e.stopPropagation()}>Cancel</AlertDialogCancel>
                                    <AlertDialogAction 
                                      className="bg-emerald-600 hover:bg-emerald-700 text-white"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        updateRegistrationMutation.mutate({ registrationId: reg.id, status: "approved" });
                                      }}
                                    >
                                      Approve
                                    </AlertDialogAction>
                                  </AlertDialogFooter>
                                </AlertDialogContent>
                              </AlertDialog>

                              <AlertDialog>
                                <AlertDialogTrigger asChild onClick={(e) => e.stopPropagation()}>
                                  <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-red-600 hover:text-red-700 hover:bg-red-50 rounded-lg">
                                    <UserX className="h-4 w-4" />
                                  </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent className="bg-white border-slate-100" onClick={(e) => e.stopPropagation()}>
                                  <AlertDialogHeader>
                                    <AlertDialogTitle>Decline Player Registration?</AlertDialogTitle>
                                    <AlertDialogDescription>
                                      This will decline the registration for {reg.playerName}. They will not be added to the tournament roster.
                                    </AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                    <AlertDialogCancel onClick={(e) => e.stopPropagation()}>Cancel</AlertDialogCancel>
                                    <AlertDialogAction 
                                      className="bg-red-650 hover:bg-red-700 text-white"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        updateRegistrationMutation.mutate({ registrationId: reg.id, status: "declined" });
                                      }}
                                    >
                                      Decline
                                    </AlertDialogAction>
                                  </AlertDialogFooter>
                                </AlertDialogContent>
                              </AlertDialog>
                            </>
                          )}
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </Card>

      {/* Detailed view dialog */}
      <Dialog open={!!selectedReg} onOpenChange={(open) => !open && setSelectedReg(null)}>
        {selectedReg && (
          <DialogContent className="max-w-2xl overflow-y-auto max-h-[85vh] border-slate-100">
            <DialogHeader className="border-b pb-4">
              <div className="flex items-center justify-between">
                <div>
                  <DialogTitle className="text-xl font-bold text-slate-900">
                    {selectedReg.uscfId || selectedReg.fideId ? (
                      <a
                        href={
                          (tournamentConfig?.details?.primaryRatingSystem || "uscf") === "fide" && selectedReg.fideId
                            ? `https://ratings.fide.com/profile/${selectedReg.fideId}`
                            : selectedReg.uscfId
                            ? `https://ratings.uschess.org/player/${selectedReg.uscfId}`
                            : `https://ratings.fide.com/profile/${selectedReg.fideId}`
                        }
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:underline cursor-pointer"
                      >
                        {selectedReg.playerName}
                      </a>
                    ) : (
                      selectedReg.playerName
                    )}
                  </DialogTitle>
                  <DialogDescription className="text-slate-400">Roster registration request details</DialogDescription>
                </div>
                <Badge 
                  className={cn(
                    "text-xs font-bold uppercase mr-6",
                    selectedReg.status === "approved" 
                      ? "bg-emerald-600 hover:bg-emerald-600" 
                      : selectedReg.status === "declined" 
                      ? "bg-red-500 hover:bg-red-500" 
                      : "bg-amber-500 hover:bg-amber-500"
                  )}
                >
                  {selectedReg.status}
                </Badge>
              </div>
            </DialogHeader>

            <div className="py-4 space-y-6">
              {/* Group 1: Basic details */}
              <div className="space-y-2">
                <h4 className="text-xs font-black uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                  <User className="h-3.5 w-3.5" />
                  Basic Information
                </h4>
                <div className="grid grid-cols-2 gap-4 bg-slate-50 p-3.5 rounded-lg border border-slate-100">
                  <div>
                    <span className="text-[10px] text-slate-400 font-semibold uppercase">Email</span>
                    <p className="text-sm font-medium text-slate-900">{selectedReg.email || "—"}</p>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400 font-semibold uppercase">Section Choice</span>
                    <p className="text-sm font-medium text-slate-900 capitalize">{selectedReg.sectionChoice || "Default"}</p>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400 font-semibold uppercase">USCF ID</span>
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-slate-900 font-mono">{selectedReg.uscfId || "—"}</p>
                      {selectedReg.uscfId && (
                        <Badge 
                          variant="outline" 
                          className={cn(
                            "text-[9px] font-bold px-1.5 py-0.5",
                            getUscfActiveStatus(selectedReg) 
                              ? "bg-emerald-50 text-emerald-700 border-emerald-200" 
                              : "bg-rose-50 text-rose-700 border-rose-200"
                          )}
                        >
                          {getUscfActiveStatus(selectedReg) ? "Active" : "Expired"}
                        </Badge>
                      )}
                    </div>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400 font-semibold uppercase">FIDE ID</span>
                    <p className="text-sm font-medium text-slate-900 font-mono">{selectedReg.fideId || "—"}</p>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400 font-semibold uppercase">USCF Rating</span>
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-slate-900">
                        {resolveDisplayRating(
                          (selectedReg as any).uscfRatingRaw,
                          selectedReg.uscfRating,
                          tournamentConfig?.registers?.uscfMinGamesThreshold ?? 4,
                          false
                        )}
                      </p>
                      {(selectedReg as any).isProvisional && (
                        <Badge 
                          variant="outline" 
                          className="text-[9px] font-bold px-1.5 py-0.5 bg-amber-50 text-amber-700 border-amber-200"
                        >
                          Provisional ({(selectedReg as any).gamesCount ?? 0} games)
                        </Badge>
                      )}
                    </div>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400 font-semibold uppercase">FIDE Rating</span>
                    <p className="text-sm font-medium text-slate-900">
                      {resolveDisplayRating(
                        (selectedReg as any).fideRatingRaw,
                        selectedReg.fideRating,
                        0,
                        true
                      )}
                    </p>
                  </div>
                </div>
              </div>

              {/* Group 2: Address */}
              {(selectedReg.address1 || selectedReg.city || selectedReg.state || selectedReg.postalCode) && (
                <div className="space-y-2">
                  <h4 className="text-xs font-black uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                    <MapPin className="h-3.5 w-3.5" />
                    Address & Location
                  </h4>
                  <div className="bg-slate-50 p-3.5 rounded-lg border border-slate-100 space-y-2 text-sm text-slate-900">
                    {selectedReg.address1 && <p>{selectedReg.address1} {selectedReg.address2}</p>}
                    <p>
                      {[selectedReg.city, selectedReg.state, selectedReg.postalCode].filter(Boolean).join(", ")}
                      {selectedReg.country ? ` (${selectedReg.country})` : ""}
                    </p>
                  </div>
                </div>
              )}

              {/* Group 3: Tournament Options & Preferences */}
              <div className="space-y-2">
                <h4 className="text-xs font-black uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                  <ClipboardList className="h-3.5 w-3.5" />
                  Preferences & Notes
                </h4>
                <div className="grid grid-cols-2 gap-4 bg-slate-50 p-3.5 rounded-lg border border-slate-100">
                  <div>
                    <span className="text-[10px] text-slate-400 font-semibold uppercase">Requested Byes</span>
                    <p className="text-sm font-medium text-slate-900">
                      {selectedReg.byePreference === "yes" || selectedReg.byePreference === "true" 
                        ? (selectedReg.byeRounds && (selectedReg.byeRounds as any).length > 0 
                            ? `Rounds: ${(selectedReg.byeRounds as any).join(", ")}` 
                            : "Yes")
                        : "None requested"}
                    </p>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400 font-semibold uppercase">Arrival Time</span>
                    <p className="text-sm font-medium text-slate-900">{selectedReg.arrivalTime || "—"}</p>
                  </div>
                  <div className="col-span-2">
                    <span className="text-[10px] text-slate-400 font-semibold uppercase">Bulletins & Newsletter</span>
                    <p className="text-sm font-medium text-slate-900">{selectedReg.newsletter ? "Subscribed" : "No"}</p>
                  </div>
                  <div className="col-span-2">
                    <span className="text-[10px] text-slate-400 font-semibold uppercase">Special Notes / Requests</span>
                    <p className="text-sm font-medium text-slate-900 whitespace-pre-wrap">{selectedReg.notes || "—"}</p>
                  </div>
                </div>
              </div>

              {/* Group 4: Payment info */}
              <div className="space-y-2">
                <h4 className="text-xs font-black uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                  <CreditCard className="h-3.5 w-3.5" />
                  Payment Details
                </h4>
                <div className="grid grid-cols-2 gap-4 bg-slate-50 p-3.5 rounded-lg border border-slate-100">
                  <div>
                    <span className="text-[10px] text-slate-400 font-semibold uppercase">Payment Status</span>
                    <div className="mt-0.5">
                      <Badge variant="outline" className={cn(
                        "text-[10px] font-bold uppercase",
                        selectedReg.paymentStatus === "paid" 
                          ? "bg-emerald-50 text-emerald-700 border-emerald-200/50" 
                          : "bg-slate-50 text-slate-500 border-slate-200"
                      )}>
                        {selectedReg.paymentStatus || "Unpaid"}
                      </Badge>
                    </div>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400 font-semibold uppercase">Amount Paid</span>
                    <p className="text-sm font-semibold text-slate-900">
                      {selectedReg.amountPaid ? `${Number(selectedReg.amountPaid).toFixed(2)} ${selectedReg.currency || "USD"}` : "—"}
                    </p>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400 font-semibold uppercase">Payment Method</span>
                    <p className="text-sm font-medium text-slate-900 capitalize">{selectedReg.paymentMethod || "—"}</p>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400 font-semibold uppercase">Transaction Date</span>
                    <p className="text-sm font-medium text-slate-900">
                      {selectedReg.paidAt ? new Date(selectedReg.paidAt).toLocaleString() : "—"}
                    </p>
                  </div>
                  {selectedReg.paymentNotes && (
                    <div className="col-span-2">
                      <span className="text-[10px] text-slate-400 font-semibold uppercase">Payment Notes</span>
                      <p className="text-sm font-medium text-slate-900 whitespace-pre-wrap">{selectedReg.paymentNotes}</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Group 5: Custom Answers */}
              <div className="space-y-2">
                <h4 className="text-xs font-black uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                  <ClipboardList className="h-3.5 w-3.5" />
                  Additional Custom Questions Answers
                </h4>
                <div className="bg-slate-50 p-3.5 rounded-lg border border-slate-100">
                  {getCustomAnswersList(selectedReg).length === 0 ? (
                    <p className="text-sm text-slate-400 italic">No custom questions answered.</p>
                  ) : (
                    <div className="grid grid-cols-2 gap-4">
                      {getCustomAnswersList(selectedReg).map((item) => (
                        <div key={item.key} className="col-span-2 sm:col-span-1">
                          <span className="text-[10px] text-slate-400 font-semibold uppercase">{item.label}</span>
                          <p className="text-sm font-medium text-slate-900 whitespace-pre-wrap">{item.value}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {selectedReg.status === "pending" && (
              <div className="border-t pt-4 flex justify-end gap-2 mt-4">
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="outline" className="border-red-200 text-red-600 hover:bg-red-50">
                      Decline Registration
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Decline {selectedReg.playerName}?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This player will not be added to the active tournament roster.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={() => updateRegistrationMutation.mutate({ registrationId: selectedReg.id, status: "declined" })} className="bg-red-600">
                        Decline
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>

                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button className="bg-emerald-600 hover:bg-emerald-700">
                      Approve & Roster Player
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Approve {selectedReg.playerName}?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This will add the player to the tournament immediately.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={() => updateRegistrationMutation.mutate({ registrationId: selectedReg.id, status: "approved" })}>
                        Approve
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            )}
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}
