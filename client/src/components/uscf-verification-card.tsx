import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Badge } from "@/components/ui/badge";
import { Loader2, Link as LinkIcon, RefreshCcw, Monitor, Upload, AlertTriangle, CheckCircle2 } from "lucide-react";
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
    onError: () => {
      toast({ title: "Error", description: "Failed to generate challenge code.", variant: "destructive" });
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
            <Button variant="outline" size="sm" onClick={() => generateChallengeMutation.mutate()}>
              <RefreshCcw className="h-3 w-3 mr-2" /> Re-verify / Update
            </Button>
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
            <Button onClick={() => generateChallengeMutation.mutate()} disabled={generateChallengeMutation.isPending}>
              {generateChallengeMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Start Verification
            </Button>
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
                {/* 1. Challenge Code */}
                <div className="flex items-center gap-2.5 text-sm">
                  {attempt?.codeFound ? (
                    <span className="text-green-600 dark:text-green-400 font-medium flex items-center gap-1.5">
                      <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />
                      Challenge Code Found
                    </span>
                  ) : (
                    <span className="text-muted-foreground flex items-center gap-2">
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                      Locating Challenge Code...
                    </span>
                  )}
                </div>

                {/* 2. URL Check */}
                <div className="flex items-center gap-2.5 text-sm">
                  {attempt?.uscfUrlFound ? (
                    <span className="text-green-600 dark:text-green-400 font-medium flex items-center gap-1.5">
                      <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />
                      Verified Browser URL (new.uschess.org)
                    </span>
                  ) : (
                    <span className="text-muted-foreground flex items-center gap-2">
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                      Checking Browser Address Bar...
                    </span>
                  )}
                </div>

                {/* 3. Member ID Check */}
                <div className="flex items-center gap-2.5 text-sm">
                  {attempt?.memberIdExtracted ? (
                    <span className="text-green-600 dark:text-green-400 font-medium flex items-center gap-1.5">
                      <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />
                      Read Member ID: <code className="bg-background px-1.5 py-0.5 rounded border text-xs font-mono font-bold text-foreground">{attempt.memberIdExtracted}</code>
                    </span>
                  ) : (
                    <span className="text-muted-foreground flex items-center gap-2">
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                      Extracting Member ID...
                    </span>
                  )}
                </div>

                {/* 4. Email check */}
                <div className="flex items-center gap-2.5 text-sm">
                  {attempt?.emailExtracted ? (
                    <span className="text-green-600 dark:text-green-400 font-medium flex items-center gap-1.5">
                      <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />
                      Read Profile Email: <code className="bg-background px-1.5 py-0.5 rounded border text-xs font-mono text-foreground">{attempt.emailExtracted}</code>
                    </span>
                  ) : (
                    <span className="text-muted-foreground flex items-center gap-2">
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                      Matching Account Email...
                    </span>
                  )}
                </div>

                {/* 5. Live refresh check */}
                <div className="flex items-center gap-2.5 text-sm">
                  {attempt?.reloadDetected ? (
                    <span className="text-green-600 dark:text-green-400 font-medium flex items-center gap-1.5">
                      <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />
                      Page Reload Verified (Anti-Spoof)
                    </span>
                  ) : (
                    <span className="text-muted-foreground flex items-center gap-2">
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                      Verifying Browser Refresh Sequence...
                    </span>
                  )}
                </div>
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
                  ⏱ {Math.floor(countdown / 60)}:{(countdown % 60).toString().padStart(2, '0')}
                </span>
              </AlertDescription>
            </Alert>

            <div className="grid md:grid-cols-2 gap-6">
              <div className="space-y-4 p-4 bg-accent/20 rounded-lg">
                <h3 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground">What to record:</h3>
                <ol className="list-decimal list-inside space-y-3.5 text-sm font-medium leading-relaxed">
                  <li>Start recording (you <strong>MUST</strong> select <strong>"Entire Screen"</strong> in the browser prompt so the address bar is visible).</li>
                  <li>Ensure this page with your <span className="text-primary font-mono font-bold bg-background px-1 py-0.5 rounded border">{challengeCode}</span> is visible at the start of the recording for 3 seconds.</li>
                  <li>Open a new tab, go to your dashboard on <a href="https://new.uschess.org" target="_blank" rel="noreferrer" className="text-primary hover:underline font-bold">new.uschess.org</a>, and log in.</li>
                  <li>Hit the browser's <strong>Refresh button (↻)</strong> to reload the USCF page live (this defeats inspect-element spoofing).</li>
                  <li>Wait for the page to finish reloading so your Member ID and email are fully visible.</li>
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
