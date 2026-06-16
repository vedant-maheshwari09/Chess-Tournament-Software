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

  const { data: registrations = [], isLoading } = useQuery<PlayerRegistration[]>({
    queryKey: [`/api/tournaments/${tournamentId}/registrations`],
    retry: false,
  });

  const updateRegistrationMutation = useMutation({
    mutationFn: async ({ registrationId, status, paymentStatus }: { registrationId: number; status: string; paymentStatus?: string }) => {
      return apiRequest(`/api/tournaments/${tournamentId}/registrations/${registrationId}`, {
        method: "PATCH",
        body: JSON.stringify({ status, paymentStatus }),
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
      const label = configField ? configField.label : key.replace(/^(custom_)/, "").replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
      
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
        <Card className="bg-white border-slate-200 shadow-sm">
          <CardContent className="p-4 flex flex-col justify-between h-20">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Total</span>
            <span className="text-2xl font-bold text-slate-900">{stats.total}</span>
          </CardContent>
        </Card>
        <Card className="bg-amber-50 border-amber-200 shadow-sm">
          <CardContent className="p-4 flex flex-col justify-between h-20">
            <span className="text-xs font-semibold text-amber-600 uppercase tracking-wider">Pending</span>
            <span className="text-2xl font-bold text-amber-700">{stats.pending}</span>
          </CardContent>
        </Card>
        <Card className="bg-emerald-50 border-emerald-200 shadow-sm">
          <CardContent className="p-4 flex flex-col justify-between h-20">
            <span className="text-xs font-semibold text-emerald-600 uppercase tracking-wider">Approved</span>
            <span className="text-2xl font-bold text-emerald-700">{stats.approved}</span>
          </CardContent>
        </Card>
        <Card className="bg-red-50 border-red-200 shadow-sm">
          <CardContent className="p-4 flex flex-col justify-between h-20">
            <span className="text-xs font-semibold text-red-600 uppercase tracking-wider">Declined</span>
            <span className="text-2xl font-bold text-red-700">{stats.declined}</span>
          </CardContent>
        </Card>
      </div>

      {/* Roster / Registration Table Toolbar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <Input 
            placeholder="Search by name or email..." 
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-9 bg-white border-slate-200"
          />
        </div>
        <div className="flex bg-slate-100 p-0.5 rounded-lg border border-slate-200 w-full md:w-auto">
          {(["all", "pending", "approved", "declined"] as const).map((status) => (
            <button
              key={status}
              onClick={() => setStatusFilter(status)}
              className={cn(
                "flex-1 md:flex-none px-4 py-1.5 rounded-md text-xs font-semibold transition-all whitespace-nowrap capitalize",
                statusFilter === status 
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-500 hover:text-slate-800"
              )}
            >
              {status}
            </button>
          ))}
        </div>
      </div>

      {/* Main Table */}
      <Card className="border-slate-200/60 shadow-sm overflow-hidden">
        <Table>
          <TableHeader className="bg-slate-50/80">
            <TableRow>
              <TableHead className="w-12">#</TableHead>
              <TableHead>Player</TableHead>
              <TableHead>Section Choice</TableHead>
              <TableHead>Rating</TableHead>
              <TableHead>Payment</TableHead>
              <TableHead>Submitted</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredRegs.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="py-12 text-center text-slate-400">
                  No registrations found matching the criteria.
                </TableCell>
              </TableRow>
            ) : (
              filteredRegs.map((reg, index) => {
                const primarySystem = tournamentConfig?.details?.primaryRatingSystem || "uscf";
                const rating = primarySystem === "fide" 
                  ? reg.fideRating || reg.uscfRating || "Unrated"
                  : reg.uscfRating || reg.fideRating || "Unrated";

                return (
                  <TableRow key={reg.id} className="hover:bg-slate-50/50 transition">
                    <TableCell className="font-medium text-slate-500">{index + 1}</TableCell>
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="font-semibold text-slate-950">{reg.playerName}</span>
                        <span className="text-[11px] text-slate-400 font-medium">{reg.email || "No email"}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="bg-slate-100 hover:bg-slate-100 text-slate-700 text-[10px] capitalize">
                        {reg.sectionChoice || "Default"}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{rating}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <Badge 
                          variant="outline" 
                          className={cn(
                            "text-[10px] font-semibold tracking-wide",
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
                          <span className="text-[10px] text-slate-400 font-mono capitalize">({reg.paymentMethod})</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-xs text-slate-500">
                      {reg.updatedAt ? new Date(reg.updatedAt).toLocaleDateString() : "—"}
                    </TableCell>
                    <TableCell>
                      <Badge 
                        className={cn(
                          "text-[10px] font-bold tracking-wider uppercase",
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
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <Button 
                          size="sm" 
                          variant="ghost" 
                          className="h-8 w-8 p-0 text-slate-500 hover:text-slate-900" 
                          onClick={() => setSelectedReg(reg)}
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                        
                        {reg.status === "pending" && (
                          <>
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50" title="Approve Registration">
                                  <UserCheck className="h-4 w-4" />
                                </Button>
                              </AlertDialogTrigger>
                              {reg.paymentStatus === "paid" ? (
                                <AlertDialogContent>
                                  <AlertDialogHeader>
                                    <AlertDialogTitle>Approve {reg.playerName}?</AlertDialogTitle>
                                    <AlertDialogDescription>
                                      This will add {reg.playerName} as an active player in the tournament roster.
                                    </AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                                    <AlertDialogAction onClick={() => updateRegistrationMutation.mutate({ registrationId: reg.id, status: "approved" })}>
                                      Approve
                                    </AlertDialogAction>
                                  </AlertDialogFooter>
                                </AlertDialogContent>
                              ) : (
                                <AlertDialogContent className="max-w-md">
                                  <AlertDialogHeader>
                                    <AlertDialogTitle>Approve {reg.playerName}?</AlertDialogTitle>
                                    <AlertDialogDescription>
                                      Choose how to approve this registration. Either mark their payment as Paid (for cash/check/Venmo in-person payments) or approve them as Unpaid.
                                    </AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter className="flex flex-col sm:flex-row gap-2">
                                    <AlertDialogCancel className="sm:mr-auto mt-0">Cancel</AlertDialogCancel>
                                    <AlertDialogAction 
                                      onClick={() => updateRegistrationMutation.mutate({ registrationId: reg.id, status: "approved" })}
                                      className="bg-slate-200 hover:bg-slate-300 text-slate-900 border border-slate-300 shadow-sm font-semibold"
                                    >
                                      Approve & Keep Unpaid
                                    </AlertDialogAction>
                                    <AlertDialogAction 
                                      onClick={() => updateRegistrationMutation.mutate({ registrationId: reg.id, status: "approved", paymentStatus: "paid" })}
                                      className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold"
                                    >
                                      Approve & Mark Paid
                                    </AlertDialogAction>
                                  </AlertDialogFooter>
                                </AlertDialogContent>
                              )}
                            </AlertDialog>

                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-red-600 hover:text-red-700 hover:bg-red-50">
                                  <UserX className="h-4 w-4" />
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>Decline {reg.playerName}?</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    Are you sure you want to decline this registration? The player will not be rostered.
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                                  <AlertDialogAction onClick={() => updateRegistrationMutation.mutate({ registrationId: reg.id, status: "declined" })} className="bg-red-600">
                                    Decline
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          </>
                        )}
                      </div>
                    </TableCell>
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
                  <DialogTitle className="text-xl font-bold text-slate-900">{selectedReg.playerName}</DialogTitle>
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
                    <p className="text-sm font-medium text-slate-900 font-mono">{selectedReg.uscfId || "—"}</p>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400 font-semibold uppercase">FIDE ID</span>
                    <p className="text-sm font-medium text-slate-900 font-mono">{selectedReg.fideId || "—"}</p>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400 font-semibold uppercase">USCF Rating</span>
                    <p className="text-sm font-medium text-slate-900">{selectedReg.uscfRating || "—"}</p>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400 font-semibold uppercase">FIDE Rating</span>
                    <p className="text-sm font-medium text-slate-900">{selectedReg.fideRating || "—"}</p>
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
                    <Button className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold">
                      Approve & Roster Player
                    </Button>
                  </AlertDialogTrigger>
                  {selectedReg.paymentStatus === "paid" ? (
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
                  ) : (
                    <AlertDialogContent className="max-w-md">
                      <AlertDialogHeader>
                        <AlertDialogTitle>Approve {selectedReg.playerName}?</AlertDialogTitle>
                        <AlertDialogDescription>
                          Choose how to approve this registration. Either mark their payment as Paid (for cash/check/Venmo in-person payments) or approve them as Unpaid.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter className="flex flex-col sm:flex-row gap-2">
                        <AlertDialogCancel className="sm:mr-auto mt-0">Cancel</AlertDialogCancel>
                        <AlertDialogAction 
                          onClick={() => updateRegistrationMutation.mutate({ registrationId: selectedReg.id, status: "approved" })}
                          className="bg-slate-200 hover:bg-slate-300 text-slate-900 border border-slate-300 shadow-sm font-semibold"
                        >
                          Approve & Keep Unpaid
                        </AlertDialogAction>
                        <AlertDialogAction 
                          onClick={() => updateRegistrationMutation.mutate({ registrationId: selectedReg.id, status: "approved", paymentStatus: "paid" })}
                          className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold"
                        >
                          Approve & Mark Paid
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  )}
                </AlertDialog>
              </div>
            )}
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}
