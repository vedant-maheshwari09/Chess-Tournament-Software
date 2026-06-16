import React, { useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { 
  Trophy, CheckCircle2, AlertTriangle, Loader2, RefreshCw, 
  ArrowLeft, ArrowRight, ShieldCheck, User, Info
} from "lucide-react";

export default function QrResultSubmit() {
  const [location] = useLocation();
  const { toast } = useToast();

  // Extract query parameters: ?m=MATCH_ID&token=HMAC_TOKEN
  const queryParams = new URLSearchParams(location.split("?")[1] || "");
  const matchIdStr = queryParams.get("m");
  const token = queryParams.get("token");

  const matchId = matchIdStr ? parseInt(matchIdStr) : 0;

  // Fetch match details publicly using the secure HMAC token
  const { 
    data: matchData, 
    isLoading: matchLoading, 
    error: fetchError,
    refetch 
  } = useQuery<{
    match: any;
    tournamentName: string;
    whitePlayerName: string;
    blackPlayerName: string;
  }>({
    queryKey: [`/api/public/matches/${matchId}`, token],
    queryFn: async () => {
      if (!matchId || !token) throw new Error("Missing parameters");
      const res = await fetch(`/api/public/matches/${matchId}?token=${token}`);
      if (!res.ok) {
        const errBody = await res.json();
        throw new Error(errBody.message || "Failed to retrieve match details");
      }
      return res.json();
    },
    enabled: matchId > 0 && !!token,
    retry: false
  });

  // Result submission status: 'idle' | 'success'
  const [submissionState, setSubmissionState] = useState<'idle' | 'success'>('idle');
  const [submittedResult, setSubmittedResult] = useState<string>("");

  // Submit result mutation
  const submitResultMutation = useMutation({
    mutationFn: async (resultCode: string) => {
      const res = await apiRequest(`/api/public/matches/${matchId}/result`, {
        method: "POST",
        body: JSON.stringify({
          token,
          result: resultCode
        })
      });
      return res;
    },
    onSuccess: (_, resultCode) => {
      setSubmittedResult(resultCode);
      setSubmissionState('success');
      toast({
        title: "Result Submitted Successfully!",
        description: `Recorded result: ${resultCode}`,
      });
    },
    onError: (err: any) => {
      toast({
        title: "Failed to submit result",
        description: err.message || "Please check your network and try again.",
        variant: "destructive"
      });
    }
  });

  const handleResultSelect = (resultCode: string) => {
    if (submitResultMutation.isPending) return;
    submitResultMutation.mutate(resultCode);
  };

  const getResultFriendlyName = (res: string) => {
    switch (res) {
      case '1-0': return "White Wins (1-0)";
      case '0-1': return "Black Wins (0-1)";
      case '1/2-1/2': return "Draw (½-½)";
      case '1F-0F': return "White Win by Forfeit (1F-0F)";
      case '0F-1F': return "Black Win by Forfeit (0F-1F)";
      case '0F-0F': return "Double Forfeit (0F-0F)";
      default: return res;
    }
  };

  // Rendering Loading state
  if (matchLoading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="text-center space-y-4 max-w-sm w-full bg-white p-8 rounded-2xl shadow-sm border border-slate-100">
          <Loader2 className="h-10 w-10 text-primary animate-spin mx-auto" />
          <h2 className="text-base font-bold text-slate-800">Retrieving Match Info</h2>
          <p className="text-xs text-slate-500">Connecting to the tournament scoring system...</p>
        </div>
      </div>
    );
  }

  // Rendering Invalid/Missing token error state
  if (fetchError || !matchId || !token) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <Card className="max-w-sm w-full shadow-md border-red-100 bg-white">
          <CardHeader className="text-center pb-2">
            <div className="h-12 w-12 rounded-full bg-red-50 flex items-center justify-center mx-auto mb-2">
              <AlertTriangle className="h-6 w-6 text-red-500" />
            </div>
            <CardTitle className="text-red-700 text-lg font-bold">Access Denied</CardTitle>
            <CardDescription className="text-xs">
              Invalid or expired result submission link.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-center pt-2">
            <p className="text-xs text-slate-500">
              The QR code scanned does not match a valid active board, or the security token is incorrect. Please request a new printable sheet from the Tournament Director.
            </p>
            <Button onClick={() => refetch()} className="w-full flex items-center justify-center gap-1.5 h-10 rounded-xl font-bold">
              <RefreshCw className="h-4 w-4" />
              Retry Verification
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Rendering Success state after submission
  if (submissionState === 'success' && matchData) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <Card className="max-w-md w-full shadow-lg border-emerald-100 bg-white">
          <CardContent className="pt-8 text-center space-y-6">
            <div className="h-16 w-16 rounded-full bg-emerald-50 flex items-center justify-center mx-auto mb-2 animate-bounce">
              <CheckCircle2 className="h-10 w-10 text-emerald-500" />
            </div>
            <div className="space-y-2">
              <h1 className="text-xl font-extrabold text-slate-900 tracking-tight">Score Recorded!</h1>
              <p className="text-sm font-semibold text-slate-500 px-4">
                {matchData.tournamentName}
              </p>
            </div>

            <div className="bg-slate-50 border border-slate-100 p-4 rounded-xl space-y-3 mx-4 text-left shadow-inner">
              <div className="flex justify-between items-center text-xs border-b pb-2">
                <span className="font-bold text-slate-400">Board Number</span>
                <Badge className="bg-slate-200 text-slate-800 font-mono border-0 font-bold">Board {matchData.match.board}</Badge>
              </div>
              <div className="flex justify-between items-center text-xs border-b pb-2">
                <span className="font-bold text-slate-400">Round</span>
                <span className="font-bold text-slate-700">Round {matchData.match.round}</span>
              </div>
              <div className="text-xs space-y-1.5 py-1">
                <div className="flex justify-between font-medium">
                  <span className="text-slate-500">White: {matchData.whitePlayerName}</span>
                </div>
                <div className="flex justify-between font-medium">
                  <span className="text-slate-500">Black: {matchData.blackPlayerName}</span>
                </div>
              </div>
              <div className="pt-2 border-t flex justify-between items-center">
                <span className="text-xs font-bold text-slate-400">Final Outcome</span>
                <Badge className="bg-emerald-500 text-white font-extrabold text-xs px-2.5 py-0.5 border-0 shadow-sm">
                  {getResultFriendlyName(submittedResult)}
                </Badge>
              </div>
            </div>

            <div className="px-4 pt-2 space-y-2">
              <p className="text-[10px] text-slate-400 flex items-center justify-center gap-1">
                <ShieldCheck className="h-3 w-3 text-emerald-500" />
                Submission logged securely. Standing boards will update live.
              </p>
              <Button 
                variant="outline"
                onClick={() => setSubmissionState('idle')}
                className="w-full h-10 font-bold border-slate-200 text-slate-700 rounded-xl"
              >
                Change Submission
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Active Submission Dashboard layout
  if (!matchData) return null;

  const currentResult = matchData.match.result;

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col p-4 sm:p-6 justify-center items-center">
      <Card className="max-w-md w-full shadow-lg bg-white border-slate-100 rounded-2xl overflow-hidden">
        {/* Header containing details */}
        <CardHeader className="bg-slate-900 text-white p-5 space-y-2 text-center relative">
          <div className="absolute top-4 left-4">
            <Trophy className="h-5 w-5 text-amber-400" />
          </div>
          <CardTitle className="text-base font-extrabold tracking-tight truncate px-6">
            {matchData.tournamentName}
          </CardTitle>
          <CardDescription className="text-xs text-slate-300 font-medium">
            Round {matchData.match.round} • Board {matchData.match.board} Matchup
          </CardDescription>
        </CardHeader>

        <CardContent className="p-6 space-y-6">
          {/* Active players matchup visualization */}
          <div className="bg-slate-50 border border-slate-100 rounded-xl p-4 flex items-center justify-between shadow-inner">
            <div className="w-[45%] text-center space-y-1">
              <div className="h-8 w-8 rounded-full bg-white border shadow-sm flex items-center justify-center mx-auto text-slate-500">
                <User className="h-4 w-4" />
              </div>
              <p className="text-xs font-bold text-slate-900 leading-tight truncate">
                {matchData.whitePlayerName}
              </p>
              <span className="inline-block text-[9px] bg-slate-200 text-slate-700 px-1.5 py-0.5 rounded font-bold uppercase tracking-wider">
                White
              </span>
            </div>

            <div className="text-slate-400 font-extrabold text-xs uppercase tracking-wider">
              VS
            </div>

            <div className="w-[45%] text-center space-y-1">
              <div className="h-8 w-8 rounded-full bg-slate-900 text-white flex items-center justify-center mx-auto border shadow-sm">
                <User className="h-4 w-4" />
              </div>
              <p className="text-xs font-bold text-slate-900 leading-tight truncate">
                {matchData.blackPlayerName}
              </p>
              <span className="inline-block text-[9px] bg-slate-900 text-white px-1.5 py-0.5 rounded font-bold uppercase tracking-wider">
                Black
              </span>
            </div>
          </div>

          {currentResult && (
            <div className="bg-amber-50/60 border border-amber-100 rounded-xl p-3 flex items-center gap-2.5 mx-0.5 text-amber-800 text-xs">
              <Info className="h-4 w-4 flex-shrink-0 text-amber-600" />
              <p className="font-medium">
                Already reported as: <span className="font-extrabold">{getResultFriendlyName(currentResult)}</span>. You can select another outcome below to override it.
              </p>
            </div>
          )}

          {/* Action selection buttons grid */}
          <div className="space-y-4">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 text-center">
              Select Match Outcome
            </h3>

            <div className="grid grid-cols-1 gap-3">
              {/* Primary Results */}
              <Button 
                onClick={() => handleResultSelect("1-0")}
                disabled={submitResultMutation.isPending}
                className="w-full flex items-center justify-between px-4 h-12 border border-slate-200 bg-white hover:bg-slate-50 text-slate-800 hover:text-black font-extrabold shadow-sm rounded-xl transition-all duration-200 group"
              >
                <span className="flex items-center gap-2">
                  <span className="h-5 w-5 bg-white border border-slate-300 rounded shadow-sm text-slate-600 font-mono text-xs flex items-center justify-center group-hover:scale-105 transition-transform font-bold">1</span>
                  <span>White Wins</span>
                </span>
                <span className="text-xs text-slate-400 font-bold font-mono">1 - 0</span>
              </Button>

              <Button 
                onClick={() => handleResultSelect("1/2-1/2")}
                disabled={submitResultMutation.isPending}
                className="w-full flex items-center justify-between px-4 h-12 border border-slate-200 bg-white hover:bg-slate-50 text-slate-800 hover:text-black font-extrabold shadow-sm rounded-xl transition-all duration-200 group"
              >
                <span className="flex items-center gap-2">
                  <span className="h-5 w-5 bg-slate-200 text-slate-700 rounded shadow-sm text-xs flex items-center justify-center group-hover:scale-105 transition-transform font-bold">½</span>
                  <span>Draw Match</span>
                </span>
                <span className="text-xs text-slate-400 font-bold font-mono">½ - ½</span>
              </Button>

              <Button 
                onClick={() => handleResultSelect("0-1")}
                disabled={submitResultMutation.isPending}
                className="w-full flex items-center justify-between px-4 h-12 border border-slate-200 bg-white hover:bg-slate-50 text-slate-800 hover:text-black font-extrabold shadow-sm rounded-xl transition-all duration-200 group"
              >
                <span className="flex items-center gap-2">
                  <span className="h-5 w-5 bg-slate-900 text-white rounded shadow-sm font-mono text-xs flex items-center justify-center group-hover:scale-105 transition-transform font-bold">0</span>
                  <span>Black Wins</span>
                </span>
                <span className="text-xs text-slate-400 font-bold font-mono">0 - 1</span>
              </Button>
            </div>

            {/* Special Forfeits Collapsible or Grid */}
            <div className="pt-2 border-t">
              <h4 className="text-[10px] font-bold uppercase tracking-wider text-slate-400 text-center mb-3">
                Forfeits & Penalties
              </h4>
              <div className="grid grid-cols-3 gap-2">
                <Button 
                  onClick={() => handleResultSelect("1F-0F")}
                  disabled={submitResultMutation.isPending}
                  variant="outline"
                  className="h-10 text-[10px] font-extrabold rounded-lg hover:bg-amber-50/50 hover:text-amber-800 transition-colors border-slate-200 px-1.5"
                >
                  White Forfeit
                </Button>
                <Button 
                  onClick={() => handleResultSelect("0F-1F")}
                  disabled={submitResultMutation.isPending}
                  variant="outline"
                  className="h-10 text-[10px] font-extrabold rounded-lg hover:bg-amber-50/50 hover:text-amber-800 transition-colors border-slate-200 px-1.5"
                >
                  Black Forfeit
                </Button>
                <Button 
                  onClick={() => handleResultSelect("0F-0F")}
                  disabled={submitResultMutation.isPending}
                  variant="outline"
                  className="h-10 text-[10px] font-extrabold rounded-lg hover:bg-red-50/50 hover:text-red-800 transition-colors border-slate-200 px-1.5"
                >
                  Double Forfeit
                </Button>
              </div>
            </div>
          </div>

          <div className="text-center pt-2">
            {submitResultMutation.isPending && (
              <div className="flex items-center justify-center text-xs font-bold text-slate-500 gap-1.5">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                Submitting score...
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
