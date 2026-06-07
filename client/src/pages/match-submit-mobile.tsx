import { useState, useEffect } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Loader2, CheckCircle } from "lucide-react";

export default function MatchSubmitMobile() {
  const params = useParams();
  const matchId = parseInt(params.id || "0", 10);
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const [submitted, setSubmitted] = useState(false);

  // Fetch match details publicly
  const { data: matchDetails, isLoading, error } = useQuery<{ board: number; whiteName: string; blackName: string }>({
    queryKey: [`/api/matches/${matchId}/details`],
    enabled: matchId > 0,
  });

  const submitMutation = useMutation({
    mutationFn: async (result: string) => {
      const res = await fetch(`/api/matches/${matchId}/submit-public`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ result }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Failed to submit result");
      }
      return res.json();
    },
    onSuccess: () => {
      setSubmitted(true);
      toast({
        title: "Success",
        description: "Match result recorded successfully.",
      });
    },
    onError: (err: any) => {
      toast({
        title: "Error",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-50">
        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
      </div>
    );
  }

  if (error || !matchDetails) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-50 p-4">
        <Card className="w-full max-w-md border-red-200">
          <CardContent className="pt-6 text-center text-red-600">
            Invalid Match ID or Match not found.
          </CardContent>
        </Card>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-50 p-4">
        <Card className="w-full max-w-md border-green-200 bg-green-50 shadow-sm">
          <CardContent className="pt-8 pb-8 text-center flex flex-col items-center">
            <CheckCircle className="h-16 w-16 text-green-500 mb-4" />
            <h2 className="text-2xl font-bold text-green-700 mb-2">Result Submitted</h2>
            <p className="text-green-600 mb-6">The tournament director has been notified.</p>
            <Button onClick={() => window.close()} className="w-full bg-green-600 hover:bg-green-700">
              Close Window
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100 p-4 sm:p-6 flex flex-col items-center justify-center">
      <Card className="w-full max-w-md shadow-xl border-t-4 border-t-blue-500">
        <CardHeader className="text-center pb-2">
          <CardTitle className="text-2xl font-bold text-slate-800">Board {matchDetails.board}</CardTitle>
          <p className="text-sm text-slate-500 uppercase tracking-widest font-semibold mt-1">Submit Result</p>
        </CardHeader>
        <CardContent className="pt-4 pb-6 space-y-6">
          <div className="bg-white border rounded-xl p-4 flex flex-col items-center gap-2 shadow-sm">
            <div className="w-full text-center py-3 bg-slate-50 rounded-lg border">
              <span className="font-bold text-lg text-slate-800">{matchDetails.whiteName}</span>
              <div className="text-xs text-slate-500 font-medium uppercase mt-1 tracking-wider">White</div>
            </div>
            <div className="text-slate-400 font-bold italic text-sm">VS</div>
            <div className="w-full text-center py-3 bg-slate-800 rounded-lg border border-slate-700">
              <span className="font-bold text-lg text-white">{matchDetails.blackName}</span>
              <div className="text-xs text-slate-300 font-medium uppercase mt-1 tracking-wider">Black</div>
            </div>
          </div>

          <div className="space-y-3">
            <Button 
              size="lg" 
              className="w-full h-16 text-lg font-bold bg-white text-slate-800 border-2 border-slate-200 hover:bg-slate-50 hover:border-blue-500 shadow-sm"
              onClick={() => submitMutation.mutate("1-0")}
              disabled={submitMutation.isPending}
            >
              White Wins (1-0)
            </Button>
            <Button 
              size="lg" 
              className="w-full h-16 text-lg font-bold bg-slate-100 text-slate-700 border-2 border-slate-200 hover:bg-slate-200 hover:border-slate-400 shadow-sm"
              onClick={() => submitMutation.mutate("1/2-1/2")}
              disabled={submitMutation.isPending}
            >
              Draw (½-½)
            </Button>
            <Button 
              size="lg" 
              className="w-full h-16 text-lg font-bold bg-slate-800 text-white border-2 border-slate-700 hover:bg-slate-900 shadow-sm"
              onClick={() => submitMutation.mutate("0-1")}
              disabled={submitMutation.isPending}
            >
              Black Wins (0-1)
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
