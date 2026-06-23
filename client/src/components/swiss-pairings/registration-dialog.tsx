import React, { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { UserPlus } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

interface QuickRegistrationProps {
  tournamentId: number;
  onSuccess?: () => void;
}

export function QuickRegistration({ tournamentId, onSuccess }: QuickRegistrationProps) {
  const { toast } = useToast();
  const [guestFirstName, setGuestFirstName] = useState("");
  const [guestLastName, setGuestLastName] = useState("");
  const [guestRating, setGuestRating] = useState("1000");
  const [guestUscfId, setGuestUscfId] = useState("");
  const [guestStatus, setGuestStatus] = useState<'guest' | 'houseplayer'>("guest");

  const registerGuestMutation = useMutation({
    mutationFn: async (payload: { firstName: string; lastName: string; rating: number; status: string; localId?: string }) => {
      return await apiRequest(`/api/tournaments/${tournamentId}/register-guest`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/tournaments/${tournamentId}/players`] });
      queryClient.invalidateQueries({ queryKey: [`/api/tournaments/${tournamentId}/matches`] });
      toast({
        title: "Player registered",
        description: "Registered successfully as " + (guestStatus === 'guest' ? 'Guest' : 'Houseplayer') + ".",
      });
      setGuestFirstName("");
      setGuestLastName("");
      setGuestRating("1000");
      setGuestUscfId("");
      onSuccess?.();
    },
    onError: (err: any) => {
      toast({
        title: "Registration failed",
        description: err?.message ?? "Failed to register player.",
        variant: "destructive",
      });
    },
  });

  return (
    <div className="space-y-4 p-5 bg-slate-50 dark:bg-slate-900/40 rounded-2xl border border-slate-100 dark:border-slate-850">
      <div className="flex items-center gap-2 mb-1">
        <UserPlus className="h-5 w-5 text-indigo-500" />
        <h4 className="text-sm font-bold text-slate-800 dark:text-slate-100 font-sans">Register Guest / Houseplayer</h4>
      </div>
      <p className="text-xs text-slate-500 font-sans leading-relaxed">
        Register a non-tournament participant to play rated extra games without affecting standings.
      </p>
      
      <div className="space-y-3 pt-2">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 font-sans">First Name</label>
            <Input
              placeholder="First Name"
              value={guestFirstName}
              onChange={(e) => setGuestFirstName(e.target.value)}
              className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 rounded-xl h-10 text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 font-sans">Last Name</label>
            <Input
              placeholder="Last Name"
              value={guestLastName}
              onChange={(e) => setGuestLastName(e.target.value)}
              className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 rounded-xl h-10 text-sm"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 font-sans">Rating</label>
            <Input
              type="number"
              placeholder="1000"
              value={guestRating}
              onChange={(e) => setGuestRating(e.target.value)}
              className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 rounded-xl h-10 text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 font-sans">USCF ID (Optional)</label>
            <Input
              placeholder="e.g. 12345678"
              value={guestUscfId}
              onChange={(e) => setGuestUscfId(e.target.value)}
              className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 rounded-xl h-10 text-sm"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 font-sans">Status Type</label>
          <Select value={guestStatus} onValueChange={(v: 'guest' | 'houseplayer') => setGuestStatus(v)}>
            <SelectTrigger className="w-full bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 rounded-xl">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="guest">Guest (casual rated games)</SelectItem>
              <SelectItem value="houseplayer">Houseplayer (fills odd-person pairings)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Button
          type="button"
          onClick={() => {
            if (!guestFirstName || !guestLastName) {
              toast({
                title: "Error",
                description: "First name and Last name are required.",
                variant: "destructive",
              });
              return;
            }
            const ratingNum = parseInt(guestRating);
            if (isNaN(ratingNum) || ratingNum < 100) {
              toast({
                title: "Error",
                description: "Please enter a valid rating (at least 100).",
                variant: "destructive",
              });
              return;
            }
            registerGuestMutation.mutate({
              firstName: guestFirstName,
              lastName: guestLastName,
              rating: ratingNum,
              status: guestStatus,
              localId: guestUscfId || undefined,
            });
          }}
          disabled={registerGuestMutation.isPending || !guestFirstName || !guestLastName}
          className="w-full bg-teal-600 hover:bg-teal-700 text-white rounded-xl font-medium h-10 gap-2 mt-2"
        >
          {registerGuestMutation.isPending ? "Registering..." : "Register Player"}
        </Button>
      </div>
    </div>
  );
}
