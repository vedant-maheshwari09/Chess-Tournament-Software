import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Badge } from "@/components/ui/badge";
import { Loader2, Link as LinkIcon, RefreshCcw, Monitor, Upload, AlertTriangle, CheckCircle2, Trash2 } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export function UscfVerificationCard() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [step, setStep] = useState<"initial" | "wizard" | "recording" | "uploading">("initial");
  const [challengeCode, setChallengeCode] = useState<string>("");
  const [challengeId, setChallengeId] = useState<number>(0);
  const [countdown, setCountdown] = useState(600);
  const [attemptId, setAttemptId] = useState<number | null>(null);
  const [lastFailureReason, setLastFailureReason] = useState<string | null>(null);
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  
  const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
  const canScreenRecord = !isMobile && !!navigator.mediaDevices?.getDisplayMedia;

  const { data: statusData, isLoading: isLoadingStatus } = useQuery({
    queryKey: ["/api/verification/uscf/me"],
    refetchInterval: (query) => {
      const data = query.state.data as any;
      // If we are waiting on a pending verification, poll faster
      return (attemptId || data?.status === 'pending') ? 3000 : false;
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
      queryClient.invalidateQueries({ queryKey: ["/api/verification/uscf/me"] });
    },
    onError: (err: any) => {
      toast({ title: "Disconnect Failed", description: err.message || "Failed to disconnect account.", variant: "destructive" });
    }
  });

  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (step === "wizard" || step === "recording") {
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

  // Polling for attempt status
  const { data: attemptData } = useQuery({
    queryKey: [`/api/verification/uscf/status/${attemptId}`],
    enabled: !!attemptId,
    refetchInterval: (query) => {
      const data = query.state.data as any;
      if (data?.status === "approved" || data?.status === "rejected") return false;
      return 2000;
    }
  });

  useEffect(() => {
    if (attemptData) {
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
      
      // Enforce sharing entire screen so we can read the browser address bar (security check)
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

  if (isLoadingStatus) {
    return <Card><CardContent className="p-6 flex justify-center"><Loader2 className="animate-spin h-6 w-6 text-primary" /></CardContent></Card>;
  }

  const { status, name, uscfId, ratingRegular, ratingQuick, ratingBlitz, state, expiry, fideId } = (statusData as any) || {};

  const isVerified = status === 'verified';
  const isProcessing = !!attemptId;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-3">
        <LinkIcon className="h-5 w-5 text-primary" />
        <div>
          <CardTitle>USCF Account</CardTitle>
          <p className="text-sm text-muted-foreground">Link your official US Chess Federation profile.</p>
        </div>
      </CardHeader>
      
      <CardContent className="space-y-4">
        {isVerified && !isProcessing && (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Badge variant="default" className="bg-green-600 hover:bg-green-700">
                <CheckCircle2 className="h-3 w-3 mr-1" /> Verified USCF Member
              </Badge>
            </div>
            <div className="grid grid-cols-2 gap-2 text-sm bg-accent/30 p-4 rounded-md">
              <div><span className="font-medium">Name:</span> {name}</div>
              <div><span className="font-medium">Member ID:</span> {uscfId}</div>
              <div><span className="font-medium">Regular Rating:</span> {ratingRegular || 'Unrated'}</div>
              <div><span className="font-medium">Quick Rating:</span> {ratingQuick || 'Unrated'}</div>
              <div><span className="font-medium">Blitz Rating:</span> {ratingBlitz || 'Unrated'}</div>
              <div><span className="font-medium">State:</span> {state}</div>
              <div><span className="font-medium">Expires:</span> {expiry}</div>
              <div><span className="font-medium">FIDE ID:</span> {fideId || 'None'}</div>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => generateChallengeMutation.mutate()}>
                <RefreshCcw className="h-3 w-3 mr-2" /> Re-verify / Update
              </Button>
              <Button 
                variant="destructive" 
                size="sm" 
                onClick={() => disconnectMutation.mutate()} 
                disabled={disconnectMutation.isPending}
              >
                {disconnectMutation.isPending ? <Loader2 className="h-3 w-3 mr-2 animate-spin" /> : <Trash2 className="h-3 w-3 mr-2" />}
                Disconnect Account
              </Button>
            </div>
          </div>
        )}

        {!isVerified && step === "initial" && !isProcessing && (
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

        {isProcessing && (() => {
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
                  // All variables used by StepItem must be declared first.
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


                  // Compute step-by-step pass state for cascade logic
                  const step1ok = !!s.codeFound;
                  const step2ok = !!s.urlBeforeReload;
                  const step3ok = !!s.memberIdBefore;
                  const step4ok = !!s.emailBefore;
                  const step5ok = !!s.reloadDetected;
                  const step6ok = !!s.urlAfterReload;
                  const step7ok = !!s.memberIdAfter;
                  const step8ok = !!s.emailAfter;
                  const step9ok = !!s.detailsMatch;
                  const step10ok = s?.status === 'approved';

                  // A step fails only if the attempt is rejected AND it is the first step that failed.
                  // Steps after the first failure remain "pending" (grayed out, not red).
                  const firstFail = isRejected
                    ? (!step1ok ? 1 : !step2ok ? 2 : !step3ok ? 3 : !step4ok ? 4 : !step5ok ? 5
                       : !step6ok ? 6 : !step7ok ? 7 : !step8ok ? 8 : !step9ok ? 9 : !step10ok ? 10 : 0)
                    : 0;

                  return (
                    <>
                      {/* Step 1: Challenge Code */}
                      <StepItem
                        isComplete={step1ok}
                        isFailed={firstFail === 1}
                        completeText="Challenge Code Found"
                        pendingText="Locating challenge code in recording..."
                        failText="Challenge code was NOT found — record this page with the code visible for 3 seconds at the start"
                      />

                      {/* Step 2: USCF URL Before Reload */}
                      <StepItem
                        isComplete={step2ok}
                        isFailed={firstFail === 2}
                        completeText="USCF User URL verified (before refresh)"
                        pendingText="Checking address bar before refresh..."
                        failText="'new.uschess.org/user/<id>' not found in address bar before the refresh — share Entire Screen and go to your profile page"
                      />

                      {/* Step 3: Member ID Before Reload */}
                      <StepItem
                        isComplete={step3ok}
                        isFailed={firstFail === 3}
                        completeText={
                          <>
                            Member ID extracted (before refresh):{" "}
                            <code className="bg-background px-1.5 py-0.5 rounded border text-xs font-mono font-bold text-foreground">
                              {s.memberIdBefore}
                            </code>
                          </>
                        }
                        pendingText="Extracting your Member ID (before refresh)..."
                        failText="Member ID could not be read before the refresh — make sure the USCF dashboard is fully loaded and Member ID is visible"
                      />

                      {/* Step 4: Email Before Reload */}
                      <StepItem
                        isComplete={step4ok}
                        isFailed={firstFail === 4}
                        completeText="Email extracted (before refresh)"
                        pendingText="Extracting your email address (before refresh)..."
                        failText="Email address could not be read before the refresh — ensure your registered email is visible on the USCF dashboard"
                      />

                      {/* Step 5: Page Reload */}
                      <StepItem
                        isComplete={step5ok}
                        isFailed={firstFail === 5}
                        completeText="Live page refresh detected"
                        pendingText="Waiting for browser reload button click..."
                        failText="No page refresh was detected — you MUST click the browser reload (↺) button while recording to prove the session is live"
                      />

                      {/* Step 6: USCF URL After Reload */}
                      <StepItem
                        isComplete={step6ok}
                        isFailed={firstFail === 6}
                        completeText="USCF User URL confirmed (after refresh)"
                        pendingText="Verifying address bar after refresh..."
                        failText="'new.uschess.org/user/<id>' not found in the address bar after the refresh — share Entire Screen so the full address bar is visible"
                      />

                      {/* Step 7: Member ID After Reload */}
                      <StepItem
                        isComplete={step7ok}
                        isFailed={firstFail === 7}
                        completeText={
                          <>
                            Member ID confirmed (after refresh):{" "}
                            <code className="bg-background px-1.5 py-0.5 rounded border text-xs font-mono font-bold text-foreground">
                              {s.memberIdAfter}
                            </code>
                          </>
                        }
                        pendingText="Extracting your Member ID (after refresh)..."
                        failText="Member ID could not be read after the refresh — wait for the page to fully reload before stopping the recording"
                      />

                      {/* Step 8: Email After Reload */}
                      <StepItem
                        isComplete={step8ok}
                        isFailed={firstFail === 8}
                        completeText="Email confirmed (after refresh)"
                        pendingText="Extracting your email address (after refresh)..."
                        failText="Email could not be read after the refresh — wait for the page to fully reload before stopping the recording"
                      />

                      {/* Step 9: Details Match */}
                      <StepItem
                        isComplete={step9ok}
                        isFailed={firstFail === 9}
                        completeText="Member ID and email match before & after refresh"
                        pendingText="Verifying profile continuity across the refresh..."
                        failText="Member ID or email changed between the refresh — the same account must be visible before and after the reload"
                      />

                      {/* Step 10: Final USCF Profile Fetch */}
                      <StepItem
                        isComplete={step10ok}
                        isFailed={firstFail === 10}
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

        {(step === "wizard" || step === "recording" || step === "uploading") && (
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
                  <li>Start recording (you <strong>MUST</strong> select <strong>"Entire Screen"</strong> in the browser prompt so the address bar is visible).</li>
                  <li>Ensure this page with your <span className="text-primary font-mono font-bold bg-background px-1 py-0.5 rounded border">{challengeCode}</span> is visible at the start of the recording for 3 seconds.</li>
                  <li><strong>BEFORE Reload:</strong> Open a new tab, log in to <a href="https://new.uschess.org" target="_blank" rel="noreferrer" className="text-primary hover:underline font-bold">new.uschess.org</a>, and go to your user profile page <code>https://new.uschess.org/user/&lt;your-id&gt;</code>. Ensure your Member ID and email are clearly visible.</li>
                  <li><strong>THE Reload:</strong> Hit the browser's <strong>Refresh/Reload button (↺)</strong> to reload the USCF page live (this proves the session is live).</li>
                  <li><strong>AFTER Reload:</strong> <strong className="text-amber-600 dark:text-amber-400">Wait at least 3 to 5 seconds</strong> after the page has completely finished reloading. This gives the browser time to clear any loading progress bars/spinners in the address bar and fully render your Member ID and email on a clean background before you stop recording.</li>
                  <li>Switch back here and click <strong>Stop & Submit</strong>.</li>
                </ol>
                
                <div className="mt-4 pt-3 border-t border-primary/10 text-xs text-muted-foreground leading-relaxed space-y-2">
                  <p className="font-semibold text-foreground flex items-center gap-1.5">
                    🔒 Privacy Commitment:
                  </p>
                  <p>
                    We strictly extract only your public name, USCF ID, and email address to verify your profile. Other details visible on your screen (such as phone numbers, billing details, or mailing addresses) are completely ignored and never stored.
                  </p>
                  <p>
                    All video recordings are permanently deleted from our servers immediately after the automated verification process finishes.
                  </p>
                </div>
              </div>

              <div className="space-y-4">
                {step === "recording" ? (
                  <div className="space-y-4 h-full flex flex-col justify-center items-center p-4 border-2 border-dashed border-red-300 rounded-lg bg-red-50 dark:bg-red-950/20">
                    <div className="flex items-center gap-2 text-red-600 font-medium animate-pulse">
                      <div className="w-3 h-3 bg-red-600 rounded-full"></div>
                      Recording in progress
                    </div>
                    <video ref={videoRef} autoPlay muted playsInline className="w-full max-w-[200px] rounded border bg-black shadow-sm hidden" />
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
