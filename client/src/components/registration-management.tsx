import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
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
import { UserCheck, UserX, Clock, CheckCircle, XCircle, Info } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { PlayerRegistration } from "@shared/schema";
import { cn } from "@/lib/utils";

interface RegistrationManagementProps {
  tournamentId: number;
}

export default function RegistrationManagement({ tournamentId }: RegistrationManagementProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: registrations = [], isLoading, error } = useQuery<PlayerRegistration[]>({
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
    onSuccess: (_, { status }) => {
      toast({
        title: "Update Successful",
        description: `Registration ${status}.`,
      });
      queryClient.invalidateQueries({ queryKey: [`/api/tournaments/${tournamentId}/registrations`] });
      queryClient.invalidateQueries({ queryKey: [`/api/tournaments/${tournamentId}/players`] });
    },
  });

  if (error || isLoading) return null;

  const pending = registrations.filter(r => r.status === "pending");
  const processed = registrations.filter(r => r.status !== "pending");

  return (
    <Card className="border shadow-sm overflow-hidden">
      <CardHeader className="p-4 border-b bg-muted/20">
        <CardTitle className="text-sm font-bold flex items-center justify-between">
          <span>Registrations</span>
          <Badge variant="secondary" className="text-[10px] h-5">{pending.length} New</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <ScrollArea className="h-[400px]">
          <div className="divide-y">
            {/* Pending Section */}
            {pending.length > 0 ? (
              pending.map((reg) => (
                <div key={reg.id} className="p-3 bg-white dark:bg-slate-950">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="min-w-0">
                      <p className="text-xs font-black truncate">{reg.playerName}</p>
                      <p className="text-[10px] text-muted-foreground">Rating: {reg.uscfRating || reg.fideRating || "Unrated"}</p>
                    </div>
                    <Clock className="h-3 w-3 text-amber-500 shrink-0" />
                  </div>
                  
                  <div className="flex items-center gap-1.5 mt-2">
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button size="sm" className="h-7 text-[10px] px-2 flex-1 bg-emerald-600 hover:bg-emerald-700">
                          Approve
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Approve {reg.playerName}?</AlertDialogTitle>
                          <AlertDialogDescription>Add this player to the roster.</AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction onClick={() => updateRegistrationMutation.mutate({ registrationId: reg.id, status: "approved" })}>Approve</AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>

                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button size="sm" variant="outline" className="h-7 text-[10px] px-2 flex-1 border-red-200 text-red-600 hover:bg-red-50">
                          Decline
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Decline {reg.playerName}?</AlertDialogTitle>
                          <AlertDialogDescription>This player will not be added.</AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction onClick={() => updateRegistrationMutation.mutate({ registrationId: reg.id, status: "declined" })} className="bg-red-600">Decline</AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </div>
              ))
            ) : processed.length === 0 ? (
              <div className="p-8 text-center opacity-40">
                <Info className="h-8 w-8 mx-auto mb-2" />
                <p className="text-[10px] font-medium">No registrations yet</p>
              </div>
            ) : null}

            {/* History Section */}
            {processed.length > 0 && (
              <div className="bg-muted/5">
                <div className="px-3 py-1.5 bg-muted/30 border-y">
                   <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Processed History</p>
                </div>
                <div className="divide-y">
                  {processed.map((reg) => (
                    <div key={reg.id} className="p-3 opacity-70">
                      <div className="flex items-center justify-between">
                        <div className="min-w-0">
                          <p className="text-xs font-semibold truncate">{reg.playerName}</p>
                          <p className="text-[9px] text-muted-foreground">{new Date(reg.updatedAt || "").toLocaleDateString()}</p>
                        </div>
                        {reg.status === 'approved' ? (
                          <CheckCircle className="h-3 w-3 text-emerald-500" />
                        ) : (
                          <XCircle className="h-3 w-3 text-red-400" />
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}

