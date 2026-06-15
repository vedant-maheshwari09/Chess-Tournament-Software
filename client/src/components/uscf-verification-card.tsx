import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Badge } from "@/components/ui/badge";
import { Loader2, Link as LinkIcon, RefreshCcw, Monitor, Upload, AlertTriangle, CheckCircle2, Trash2, HelpCircle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// Screen recording system disabled by default under this boolean flag
const enableScreenRecording = false;

export function UscfVerificationCard() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [step, setStep] = useState<"initial" | "wizard" | "recording" | "uploading">("initial");
  const [challengeCode, setChallengeCode] = useState<string>("");
  const [challengeId, setChallengeId] = useState<number>(0);
  const [countdown, setCountdown] = useState(600);
  const [attemptId, setAttemptId] = useState<number | null>(null);
  const [lastFailureReason, setLastFailureReason] = useState<string | null>(null);
  
  // Simple flow state variables
  const [uscfIdInput, setUscfIdInput] = useState("");
  const [connectingError, setConnectingError] = useState<{ message: string; code?: string } | null>(null);
  const [reportingSuccess, setReportingSuccess] = useState(false);
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  
  const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
  const canScreenRecord = !isMobile && !!navigator.mediaDevices?.getDisplayMedia;

  const { data: statusData, isLoading: isLoadingStatus } = useQuery({
    queryKey: ["/api/verification/uscf/me"],
    refetchInterval: (query) => {
      const data = query.state.data as any;
      // If we are waiting on a pending verification (only in recording mode), poll faster
      return (enableScreenRecording && (attemptId || data?.status === 'pending')) ? 3000 : false;
    }
  });

  const generateChallengeMutation = useMutation({
    mutationFn: async () => {
      const data = await apiRequest("/api/verification/uscf/challenge", { method: "POST" });
      return data;
    },
    onSuccess: (data) => {
      setChallengeCode(data.code);
      setChallengeId(data.id);
      setCountdown(600);
      setStep("wizard");
    },
    onError: (err: any) => {
      toast({ title: "Action Blocked", description: err.message || "Failed to generate challenge code.", variant: "destructive" });
    }
  });

  const submitVideoMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("video", file);
      formData.append("challengeCodeId", challengeId.toString());

      return await apiRequest("/api/verification/uscf/submit", {
        method: "POST",
        body: formData,
      });
    },
    onSuccess: (data) => {
      setAttemptId(data.attemptId);
      setStep("initial"); // Return to initial which will show polling state
      queryClient.invalidateQueries({ queryKey: ["/api/verification/uscf/me"] });
    },
    onError: (err: any) => {
      toast({ title: "Upload Failed", description: err.message || "Failed to submit video.", variant: "destructive" });
      setStep("wizard");
    }
  });

  const disconnectMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("/api/verification/uscf/disconnect", { method: "POST" });
    },
    onSuccess: () => {
      toast({ title: "Disconnected", description: "Your USCF account has been disconnected." });
      setConnectingError(null);
      setReportingSuccess(false);
      queryClient.invalidateQueries({ queryKey: ["/api/verification/uscf/me"] });
    },
    onError: (err: any) => {
      toast({ title: "Disconnect Failed", description: err.message || "Failed to disconnect account.", variant: "destructive" });
    }
  });

  // Simple flow connect mutation
  const connectUscfMutation = useMutation({
    mutationFn: async (uscfId: string) => {
      return await apiRequest("/api/verification/uscf/connect", {
        method: "POST",
        body: JSON.stringify({ uscfId })
      });
    },
    onSuccess: (data) => {
      toast({ title: "Connected", description: data.message });
      setUscfIdInput("");
      setConnectingError(null);
      setReportingSuccess(false);
      queryClient.invalidateQueries({ queryKey: ["/api/verification/uscf/me"] });
    },
    onError: (err: any) => {
      setConnectingError({ message: err.message || "Failed to connect.", code: err.code });
    }
  });

  // Simple flow report falsification mutation
  const reportFalsificationMutation = useMutation({
    mutationFn: async (uscfId: string) => {
      return await apiRequest("/api/verification/uscf/report-falsification", {
        method: "POST",
        body: JSON.stringify({ uscfId })
      });
    },
    onSuccess: (data) => {
      toast({ title: "Report Submitted", description: data.message });
      setReportingSuccess(true);
    },
    onError: (err: any) => {
      toast({ title: "Report Failed", description: err.message || "Failed to submit falsification report.", variant: "destructive" });
    }
  });

  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (enableScreenRecording && (step === "wizard" || step === "recording")) {
      timer = setInterval(() => {
        setCountdown((c) => {
          if (c <= 1) {
            clearInterval(timer);
            setStep("initial");
            toast({ title: "Expired", description: "Challenge code expired. Please start again." });
            return 0;
          }
          return c - 1;
        });
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [step, toast]);

  // Polling for attempt status (recording mode only)
  const { data: attemptData } = useQuery({
    queryKey: [`/api/verification/uscf/status/${attemptId}`],
    enabled: enableScreenRecording && !!attemptId,
    refetchInterval: (query) => {
      const data = query.state.data as any;
      if (data?.status === "approved" || data?.status === "rejected") return false;
      return 2000;
    }
  });

  useEffect(() => {
    if (enableScreenRecording && attemptData) {
      const status = (attemptData as any).status;
      if (status === "approved") {
        setAttemptId(null);
        setLastFailureReason(null);
        queryClient.invalidateQueries({ queryKey: ["/api/verification/uscf/me"] });
      } else if (status === "rejected") {
        setAttemptId(null);
        setLastFailureReason((attemptData as any).failureReason || "Verification rejected.");
        queryClient.invalidateQueries({ queryKey: ["/api/verification/uscf/me"] });
      }
    }
  }, [attemptData, queryClient]);

  const startRecording = async () => {
    try {
      recordedChunksRef.current = []; // Reset chunks for new recording
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { displaySurface: "monitor" }
      });
      
      const track = stream.getVideoTracks()[0];
      const settings = track.getSettings();
      
      if (settings.displaySurface && settings.displaySurface !== "monitor") {
        track.stop();
        toast({
          title: "Entire Screen Required",
          description: "For security verification, you must share your ENTIRE SCREEN, not just a tab or window.",
          variant: "destructive"
        });
        return;
      }
      
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      
      const mediaRecorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
      mediaRecorderRef.current = mediaRecorder;
      
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          recordedChunksRef.current.push(e.data);
        }
      };
      
      mediaRecorder.onstop = () => {
        stream.getTracks().forEach(track => track.stop());
      };
      
      mediaRecorder.start(1000);
      setStep("recording");
    } catch (err) {
      console.error(err);
      toast({ title: "Recording Failed", description: "Could not access screen recording.", variant: "destructive" });
    }
  };

  const stopAndSubmitRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
      mediaRecorderRef.current.onstop = () => {
        const blob = new Blob(recordedChunksRef.current, { type: "video/webm" });
        const file = new File([blob], "screen-record.webm", { type: "video/webm" });
        setStep("uploading");
        submitVideoMutation.mutate(file);
      };
      mediaRecorderRef.current.stop();
      if(videoRef.current) videoRef.current.srcObject = null;
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setStep("uploading");
      submitVideoMutation.mutate(file);
    }
  };

  const handleConnectSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!uscfIdInput.trim()) return;
    setConnectingError(null);
    setReportingSuccess(false);
    connectUscfMutation.mutate(uscfIdInput.trim());
  };

  if (isLoadingStatus) {
    return <Card><CardContent className="p-6 flex justify-center"><Loader2 className="animate-spin h-6 w-6 text-primary" /></CardContent></Card>;
  }

  const { status, name, uscfId, ratingRegular, ratingQuick, ratingBlitz, state, expiry, fideId } = (statusData as any) || {};

  const isVerified = status === 'verified';
  const isPending = status === 'pending';
  const isProcessing = !!attemptId;

  return (
    <Card className="border-slate-200/60 shadow-sm rounded-2xl dark:bg-slate-900">
      <CardHeader className="flex flex-row items-center gap-3 border-b bg-muted/20 px-6 py-4">
        <LinkIcon className="h-5 w-5 text-indigo-500" />
        <div>
          <CardTitle className="text-base font-semibold">USCF Account</CardTitle>
          <p className="text-xs text-muted-foreground">Link your official US Chess Federation profile.</p>
        </div>
      </CardHeader>
      
      <CardContent className="p-6 space-y-4">
        {/* Connected / Verified state */}
        {(isVerified || isPending) && !isProcessing && (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              {isVerified ? (
                <Badge variant="default" className="bg-green-100 text-green-800 hover:bg-green-100 border-none px-3 py-1 font-semibold rounded-full flex items-center gap-1.5">
                  <CheckCircle2 className="h-3.5 w-3.5 text-green-600" /> Verified USCF Member
                </Badge>
              ) : (
                <Badge variant="outline" className="bg-amber-100 text-amber-800 hover:bg-amber-100 border-none px-3 py-1 font-semibold rounded-full flex items-center gap-1.5">
                  <HelpCircle className="h-3.5 w-3.5 text-amber-600 animate-pulse" /> Connected (Pending Verification)
                </Badge>
              )}
            </div>
            
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm bg-slate-50 dark:bg-slate-800/50 p-4 rounded-xl border border-slate-100 dark:border-slate-800">
              <div><span className="font-semibold text-slate-500">Name:</span> <span className="font-bold text-slate-800 dark:text-slate-200">{name}</span></div>
              <div><span className="font-semibold text-slate-500">Member ID:</span> <span className="font-mono font-bold text-slate-800 dark:text-slate-200">{uscfId}</span></div>
              <div><span className="font-semibold text-slate-500">Regular Rating:</span> <span className="font-bold text-slate-800 dark:text-slate-200">{ratingRegular || 'Unrated'}</span></div>
              <div><span className="font-semibold text-slate-500">Quick Rating:</span> <span className="font-bold text-slate-800 dark:text-slate-200">{ratingQuick || 'Unrated'}</span></div>
              <div><span className="font-semibold text-slate-500">Blitz Rating:</span> <span className="font-bold text-slate-800 dark:text-slate-200">{ratingBlitz || 'Unrated'}</span></div>
              <div><span className="font-semibold text-slate-500">State:</span> <span className="font-bold text-slate-800 dark:text-slate-200">{state || 'N/A'}</span></div>
              <div><span className="font-semibold text-slate-500">Expires:</span> <span className="font-bold text-slate-800 dark:text-slate-200">{expiry || 'N/A'}</span></div>
              <div><span className="font-semibold text-slate-500">FIDE ID:</span> <span className="font-mono font-bold text-slate-800 dark:text-slate-200">{fideId || 'None'}</span></div>
            </div>

            <div className="flex gap-2">
              <Button 
                variant="destructive" 
                size="sm" 
                onClick={() => disconnectMutation.mutate()} 
                disabled={disconnectMutation.isPending}
                className="rounded-xl shadow-sm text-xs font-semibold"
              >
                {disconnectMutation.isPending ? <Loader2 className="h-3 w-3 mr-2 animate-spin" /> : <Trash2 className="h-3 w-3 mr-2" />}
                Disconnect Account
              </Button>
            </div>
          </div>
        )}

        {/* Unverified / Connect Form State */}
        {!isVerified && !isPending && step === "initial" && !isProcessing && (
          <div className="space-y-4">
            {!enableScreenRecording ? (
              // Simple Flow Form
              <form onSubmit={handleConnectSubmit} className="space-y-4">
                {connectingError && (
                  <Alert variant="destructive" className="rounded-xl">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertTitle>Connection Failed</AlertTitle>
                    <AlertDescription className="mt-1">
                      {connectingError.message}
                      {connectingError.code === "ALREADY_CONNECTED" && !reportingSuccess && (
                        <div className="mt-3">
                          <Button 
                            type="button" 
                            variant="outline" 
                            size="sm" 
                            className="bg-white hover:bg-slate-50 text-red-600 border-red-200 font-semibold"
                            onClick={() => reportFalsificationMutation.mutate(uscfIdInput.trim() || uscfId || "")}
                            disabled={reportFalsificationMutation.isPending}
                          >
                            {reportFalsificationMutation.isPending && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
                            Report Identity Falsification
                          </Button>
                        </div>
                      )}
                      {reportingSuccess && (
                        <p className="mt-2 text-xs font-semibold text-green-600 dark:text-green-400">
                          ✓ Identity falsification report submitted. Administrators have been notified.
                        </p>
                      )}
                    </AlertDescription>
                  </Alert>
                )}
                
                <div className="space-y-2">
                  <Label htmlFor="uscf-id-input" className="text-sm font-semibold text-slate-700 dark:text-slate-300">Enter your 8-digit USCF Member ID</Label>
                  <div className="flex gap-2">
                    <Input 
                      id="uscf-id-input"
                      placeholder="e.g. 12345678"
                      value={uscfIdInput}
                      onChange={(e) => setUscfIdInput(e.target.value.replace(/[^0-9]/g, ""))}
                      maxLength={8}
                      className="rounded-xl border-slate-200 font-mono tracking-wider h-11"
                    />
                    <Button 
                      type="submit" 
                      disabled={connectUscfMutation.isPending || !uscfIdInput.trim() || uscfIdInput.length < 8}
                      className="bg-indigo-600 hover:bg-indigo-700 rounded-xl h-11 px-5 shadow-sm font-semibold whitespace-nowrap"
                    >
                      {connectUscfMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Link Profile"}
                    </Button>
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-normal">
                    Your account first name and last name must match your official USCF member record to connect.
                  </p>
                </div>
              </form>
            ) : (
              // Legacy Video Flow
              <div className="space-y-4">
                {lastFailureReason && (
                  <Alert variant="destructive">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertTitle>Verification Failed</AlertTitle>
                    <AlertDescription className="mt-1">{lastFailureReason}</AlertDescription>
                  </Alert>
                )}
                <div className="text-sm text-muted-foreground">
                  By linking your USCF account, your official rating and name will be used when you register for tournaments.
                </div>
                <div className="space-y-2">
                  <Button onClick={() => generateChallengeMutation.mutate()} disabled={generateChallengeMutation.isPending}>
                    {generateChallengeMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    Start Verification
                  </Button>
                  <p className="text-xs text-muted-foreground italic">
                    Note: There is a mandatory 1-minute cooldown period between verification attempts.
                  </p>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Polling / Processing state (for screen recording flow) */}
        {enableScreenRecording && isProcessing && (() => {
          const attempt = attemptData as any;
          return (
            <div className="space-y-5 p-6 bg-accent/20 rounded-md border border-primary/10">
              <div className="flex items-center gap-3">
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
                <h3 className="font-semibold text-base">Processing your video...</h3>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Our automated system is performing Optical Character Recognition (OCR) frame analysis to verify your USCF session. This usually takes 20 to 45 seconds.
              </p>
              
              <div className="space-y-3 border-t border-primary/5 pt-4">
                {(() => {
                  const s = attempt || {};
                  const isRejected = s?.status === 'rejected';

                  const StepItem = ({ isComplete, isFailed, completeText, pendingText, failText }: { isComplete: boolean, isFailed: boolean, completeText: React.ReactNode, pendingText: string, failText: string }) => {
                    if (isComplete) {
                      return (
                        <div className="flex items-center gap-2.5 text-sm">
                          <span className="text-green-600 dark:text-green-400 font-medium flex items-center gap-1.5">
                            <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />
                            {completeText}
                          </span>
                        </div>
                      );
                    }
                    if (isFailed) {
                      return (
                        <div className="flex items-center gap-2.5 text-sm">
                          <span className="text-red-600 dark:text-red-400 font-medium flex items-center gap-1.5">
                            <AlertTriangle className="h-4 w-4 text-red-600 dark:text-red-400" />
                            {failText}
                          </span>
                        </div>
                      );
                    }
                    return (
                      <div className="flex items-center gap-2.5 text-sm">
                        <span className="text-muted-foreground flex items-center gap-2 opacity-60">
                          {isRejected ? <div className="h-3.5 w-3.5 rounded-full border-2 border-muted" /> : <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
                          {pendingText}
                        </span>
                      </div>
                    );
                  };

                  const step1ok = !!s.codeFound;
                  const step2ok = !!s.startedOffProfile;
                  const step3ok = !!s.navigatedToProfile;
                  const step4ok = !!s.uscfUrlFound;
                  const step5ok = !!s.memberIdExtracted;
                  const step6ok = !!s.emailExtracted;
                  const step7ok = s?.status === 'approved';

                  const firstFail = isRejected
                    ? (!step1ok ? 1 : !step2ok ? 2 : !step3ok ? 3 : !step4ok ? 4 : !step5ok ? 5 : !step6ok ? 6 : !step7ok ? 7 : 0)
                    : 0;

                  return (
                    <>
                      <StepItem
                        isComplete={step1ok}
                        isFailed={firstFail === 1}
                        completeText="Challenge Code Found"
                        pendingText="Locating challenge code in recording..."
                        failText="Challenge code was NOT found — record this page with the code visible for 3 seconds at the start"
                      />
                      <StepItem
                        isComplete={step2ok}
                        isFailed={firstFail === 2}
                        completeText="Started on non-profile USCF page (e.g. Dashboard)"
                        pendingText="Verifying video starts outside the profile page..."
                        failText="Video did not start on a non-profile page — you MUST navigate TO your profile during the recording"
                      />
                      <StepItem
                        isComplete={step3ok}
                        isFailed={firstFail === 3}
                        completeText="Navigation to profile detected"
                        pendingText="Waiting for navigation to your profile..."
                        failText="No profile navigation detected — you must click your profile link during the recording"
                      />
                      <StepItem
                        isComplete={step4ok}
                        isFailed={firstFail === 4}
                        completeText="USCF User URL verified"
                        pendingText="Verifying address bar URL..."
                        failText="'new.uschess.org/user/<id>' not found in address bar — share Entire Screen and go to your profile page"
                      />
                      <StepItem
                        isComplete={step5ok}
                        isFailed={firstFail === 5}
                        completeText={
                          <>
                            Member ID extracted:{" "}
                            <code className="bg-background px-1.5 py-0.5 rounded border text-xs font-mono font-bold text-foreground">
                              {s.memberIdExtracted}
                            </code>
                          </>
                        }
                        pendingText="Extracting your Member ID..."
                        failText="Member ID could not be clearly read from the profile page"
                      />
                      <StepItem
                        isComplete={step6ok}
                        isFailed={firstFail === 6}
                        completeText="Email extracted"
                        pendingText="Extracting your email address..."
                        failText="Email address could not be clearly read from the profile page"
                      />
                      <StepItem
                        isComplete={step7ok}
                        isFailed={firstFail === 7}
                        completeText={
                          <>
                            USCF profile fetched &amp; verified:{" "}
                            <code className="bg-background px-1.5 py-0.5 rounded border text-xs font-mono font-bold text-foreground">
                              {s.memberIdExtracted}
                            </code>
                          </>
                        }
                        pendingText="Fetching official USCF profile data..."
                        failText="Could not retrieve your official USCF profile — the USCF server may be temporarily unavailable; please try again"
                      />
                    </>
                  );
                })()}
              </div>
            </div>
          );
        })()}

        {enableScreenRecording && (step === "wizard" || step === "recording" || step === "uploading") && (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4">
            <Alert className="bg-primary/5 border-primary/20">
              <AlertTitle className="text-lg font-bold flex items-center gap-2">
                Your Challenge Code: <span className="font-mono bg-background px-2 py-1 rounded border tracking-wider text-primary">{challengeCode}</span>
              </AlertTitle>
              <AlertDescription className="mt-2 text-sm flex items-center justify-between">
                <span>Keep this page visible at the start of your recording.</span>
                <span className="font-mono font-medium text-amber-600 bg-amber-100 dark:bg-amber-900/30 px-2 py-1 rounded">
                  {Math.floor(countdown / 60)}:{(countdown % 60).toString().padStart(2, '0')}
                </span>
              </AlertDescription>
            </Alert>

            <div className="grid md:grid-cols-2 gap-6">
              <div className="space-y-4 p-4 bg-accent/20 rounded-lg">
                <h3 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground">What to record:</h3>
                <ol className="list-decimal list-inside space-y-3.5 text-sm font-medium leading-relaxed">
                  <li><strong>BEFORE recording:</strong> Open a new tab and log in to <a href="https://new.uschess.org" target="_blank" rel="noreferrer" className="text-primary hover:underline font-bold">new.uschess.org</a>. Once you are logged in, keep that tab open and come back to this verification page.</li>
                  <li>Start recording (you <strong>MUST</strong> select <strong>"Entire Screen"</strong> in the browser prompt so the address bar is visible).</li>
                  <li>Ensure this page with your <span className="text-primary font-mono font-bold bg-background px-1 py-0.5 rounded border">{challengeCode}</span> is visible at the start of the recording for 3 seconds.</li>
                  <li><strong>THE Navigation:</strong> Go to the USCF tab you opened. Click on your profile link to navigate to your user profile page (<code>https://new.uschess.org/user/&lt;your-id&gt;</code>). This proves the page loaded fresh and wasn't altered.</li>
                  <li><strong>AFTER Navigation:</strong> Ensure your Member ID and email are clearly visible. <strong className="text-amber-600 dark:text-amber-400">Wait at least 3 to 5 seconds</strong> after the page has completely finished loading before you stop recording.</li>
                  <li>Switch back here and click <strong>Stop & Submit</strong>.</li>
                </ol>
              </div>

              <div className="space-y-4">
                {step === "recording" ? (
                  <div className="space-y-4 h-full flex flex-col justify-center items-center p-4 border-2 border-dashed border-red-300 rounded-lg bg-red-50 dark:bg-red-950/20">
                    <div className="flex items-center gap-2 text-red-600 font-medium animate-pulse">
                      <div className="w-3 h-3 bg-red-600 rounded-full"></div>
                      Recording in progress
                    </div>
                    <Button variant="destructive" onClick={stopAndSubmitRecording} className="w-full">
                      Stop & Submit Recording
                    </Button>
                  </div>
                ) : step === "uploading" ? (
                  <div className="flex flex-col items-center justify-center p-6 space-y-4 border rounded-lg bg-accent/20 h-full">
                    <Loader2 className="h-6 w-6 animate-spin text-primary" />
                    <p className="text-sm font-medium">Uploading video...</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {canScreenRecord ? (
                      <>
                        <Button className="w-full h-auto py-4 flex flex-col gap-1" onClick={startRecording}>
                          <div className="flex items-center gap-2"><Monitor className="h-5 w-5" /> Record In-Browser</div>
                          <span className="text-xs font-normal opacity-80">We'll open a screen picker. No install needed.</span>
                        </Button>
                        <div className="relative my-4">
                          <div className="absolute inset-0 flex items-center"><span className="w-full border-t" /></div>
                          <div className="relative flex justify-center text-xs uppercase"><span className="bg-card px-2 text-muted-foreground">Or</span></div>
                        </div>
                      </>
                    ) : (
                      <Alert className="bg-amber-50 border-amber-200 dark:bg-amber-950/30 dark:border-amber-800">
                        <AlertTriangle className="h-4 w-4 text-amber-600" />
                        <AlertTitle className="text-amber-800 dark:text-amber-400">Mobile Device Detected</AlertTitle>
                        <AlertDescription className="text-amber-700/80 dark:text-amber-500/80 mt-1">
                          Browser recording isn't supported here. Use your phone's built-in screen recorder (Control Center / Quick Settings), then upload the video below.
                        </AlertDescription>
                      </Alert>
                    )}
                    
                    <div className="relative w-full">
                      <Button variant="outline" className="w-full h-auto py-4 flex flex-col gap-1 overflow-hidden" type="button">
                        <div className="flex items-center gap-2"><Upload className="h-5 w-5" /> Upload Video File</div>
                        <span className="text-xs font-normal opacity-70">MP4, WebM, or MOV</span>
                      </Button>
                      <input 
                        type="file" 
                        accept="video/mp4,video/webm,video/quicktime" 
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" 
                        onChange={handleFileUpload}
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
            
            <div className="flex justify-start">
               <Button variant="ghost" size="sm" onClick={() => setStep("initial")} disabled={step === "uploading"}>Cancel</Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
