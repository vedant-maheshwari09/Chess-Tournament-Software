import React, { useState, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Camera, RefreshCw, ScanLine } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { Match } from "@shared/schema";
import type { PendingResultsMap } from "./types";

interface OCRScannerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onScanComplete: (results: PendingResultsMap) => void;
  matchesForStatus: Match[];
}

export function OCRScannerDialog({
  open,
  onOpenChange,
  onScanComplete,
  matchesForStatus,
}: OCRScannerDialogProps) {
  const { toast } = useToast();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [isOcrProcessing, setIsOcrProcessing] = useState(false);

  const startCamera = async () => {
    try {
      setIsCameraActive(false);
      setCapturedImage(null);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.onloadedmetadata = () => {
          setIsCameraActive(true);
        };
      }
    } catch (err) {
      toast({
        title: "Camera Error",
        description: "Unable to access the camera. Please upload an image instead.",
        variant: "destructive",
      });
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    setIsCameraActive(false);
  };

  const capturePhoto = () => {
    if (videoRef.current && canvasRef.current) {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL("image/jpeg");
        setCapturedImage(dataUrl);
        stopCamera();
      }
    }
  };

  const handleCloseScanDialog = () => {
    stopCamera();
    setCapturedImage(null);
    onOpenChange(false);
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        setCapturedImage(event.target?.result as string);
        stopCamera();
      };
      reader.readAsDataURL(file);
    }
  };

  const normalizeOcrChar = (ch: string): string => {
    const map: Record<string, string> = {
      'l': '1', 'I': '1', '|': '1', '!': '1',
      'O': '0', 'Q': '0', 'o': '0',
      'S': '5', 's': '5',
      'B': '8', 'Z': '2', 'z': '2',
    };
    return map[ch] ?? ch;
  };

  const normalizeResultToken = (token: string): string | null => {
    if (!token) return null;
    const t = token.trim().toLowerCase().replace(/^[^a-z0-9½]+|[^a-z0-9½]+$/g, '');
    if (t === '1' || t === 'l' || t === 'i' || t === '|' || t === '!') return '1';
    if (t === '0' || t === 'o' || t === 'q') return '0';
    if (t === '1/2' || t === '½' || t === '12' || t === '1/' || t === '/2' || t === 'draw' || t === '0.5' || t === '05') return '0.5';
    return null;
  };

  const parseOcrResults = (text: string): PendingResultsMap => {
    const results: PendingResultsMap = {};
    const roundMatches = matchesForStatus;
    if (!roundMatches || roundMatches.length === 0) return results;

    const lines = text.split(/\r?\n/);

    for (const line of lines) {
      const parts = line.split(')');
      if (parts.length < 2) continue;

      const tokens1 = parts[0].trim().split(/\s+/);
      if (tokens1.length < 2) continue;

      let boardNum: number | null = null;
      let whiteResult: string | null = null;
      let boardTokenIndex = -1;

      for (let i = 0; i < tokens1.length; i++) {
        const token = tokens1[i];
        const parsedInt = parseInt(token);
        if (!isNaN(parsedInt) && parsedInt >= 1 && parsedInt <= roundMatches.length) {
          boardNum = parsedInt;
          boardTokenIndex = i;
          break;
        }
      }

      if (boardTokenIndex === -1) {
        for (let i = 0; i < tokens1.length; i++) {
          const token = tokens1[i];
          for (let b = 1; b <= roundMatches.length; b++) {
            const bStr = b.toString();
            if (token.startsWith(bStr)) {
              const rest = token.slice(bStr.length);
              const normRest = normalizeResultToken(rest);
              if (normRest !== null) {
                boardNum = b;
                whiteResult = normRest;
                boardTokenIndex = i;
                break;
              }
            }
          }
          if (boardNum !== null) break;
        }
      }

      if (boardTokenIndex !== -1 && whiteResult === null && boardTokenIndex + 1 < tokens1.length) {
        whiteResult = normalizeResultToken(tokens1[boardTokenIndex + 1]);
      }

      const tokens2 = parts[1].trim().split(/\s+/);
      let blackResult: string | null = null;
      for (let i = 0; i < Math.min(tokens2.length, 3); i++) {
        const norm = normalizeResultToken(tokens2[i]);
        if (norm !== null) {
          blackResult = norm;
          break;
        }
      }

      if (boardNum !== null && whiteResult !== null && blackResult !== null) {
        let finalResult: string | null = null;
        if (whiteResult === '1' && blackResult === '0') finalResult = '1-0';
        else if (whiteResult === '0' && blackResult === '1') finalResult = '0-1';
        else if (whiteResult === '0.5' && blackResult === '0.5') finalResult = '1/2-1/2';

        if (finalResult !== null) {
          const match = roundMatches.find(m => m.board === boardNum);
          if (match) {
            results[match.id] = finalResult;
          }
        }
      }
    }
    return results;
  };

  const handleOcrScan = async () => {
    if (!capturedImage) return;
    setIsOcrProcessing(true);
    try {
      const Tesseract = await import('tesseract.js');
      const { data: { text } } = await Tesseract.recognize(capturedImage, 'eng', {
        logger: () => {},
      });
      const parsed = parseOcrResults(text);
      if (Object.keys(parsed).length === 0) {
        toast({
          title: "No Results Found",
          description: "Could not detect any results from the image. Try again with better lighting.",
          variant: "destructive",
        });
      } else {
        onScanComplete(parsed);
        toast({
          title: "Scan Complete",
          description: `Detected ${Object.keys(parsed).length} result(s). Review and save.`,
        });
        handleCloseScanDialog();
      }
    } catch (err) {
      toast({
        title: "OCR Error",
        description: "Failed to process image.",
        variant: "destructive",
      });
    } finally {
      setIsOcrProcessing(false);
    }
  };

  React.useEffect(() => {
    if (open) {
      startCamera();
    } else {
      stopCamera();
    }
    return () => stopCamera();
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleCloseScanDialog(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Camera className="h-5 w-5 text-purple-600" />
            Scan Pairing Sheet
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {!capturedImage ? (
            <div className="space-y-4">
              <div className="relative bg-black rounded-xl overflow-hidden" style={{ aspectRatio: '16/9' }}>
                <video
                  ref={videoRef}
                  className="w-full h-full object-cover"
                  autoPlay
                  playsInline
                  muted
                />
                {!isCameraActive && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-slate-900/80">
                    <Camera className="h-12 w-12 text-white/50" />
                    <p className="text-white/70 text-sm">Camera initializing...</p>
                  </div>
                )}
              </div>
              <div className="flex flex-col items-center justify-center border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-xl p-4 bg-slate-50/50 dark:bg-slate-900/20">
                <p className="text-sm text-slate-550 mb-2 font-semibold">Or select/upload an image file of the pairing sheet:</p>
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleImageUpload}
                  className="block w-full text-sm text-slate-500
                    file:mr-4 file:py-2 file:px-4
                    file:rounded-full file:border-0
                    file:text-sm file:font-semibold
                    file:bg-purple-50 file:text-purple-700
                    hover:file:bg-purple-100
                    dark:file:bg-purple-950/30 dark:file:text-purple-400 cursor-pointer"
                />
              </div>
            </div>
          ) : (
            <div className="relative rounded-xl overflow-hidden border border-slate-200">
              <img src={capturedImage} alt="Captured pairing sheet" className="w-full" />
            </div>
          )}
          <canvas ref={canvasRef} className="hidden" />
          <div className="flex items-center justify-end gap-3">
            {!capturedImage ? (
              <Button
                onClick={capturePhoto}
                disabled={!isCameraActive}
                className="bg-purple-600 hover:bg-purple-700 text-white font-semibold"
              >
                <Camera className="mr-2 h-4 w-4" />
                Take Photo
              </Button>
            ) : (
              <>
                <Button
                  variant="outline"
                  onClick={() => { setCapturedImage(null); startCamera(); }}
                >
                  Retake
                </Button>
                <Button
                  onClick={handleOcrScan}
                  disabled={isOcrProcessing}
                  className="bg-purple-600 hover:bg-purple-700 text-white font-semibold"
                >
                  {isOcrProcessing ? (
                    <><RefreshCw className="mr-2 h-4 w-4 animate-spin" />Scanning...</>
                  ) : (
                    <><ScanLine className="mr-2 h-4 w-4" />Scan Results</>
                  )}
                </Button>
              </>
            )}
            <Button variant="outline" onClick={handleCloseScanDialog}>Close</Button>
          </div>
          <p className="text-xs text-slate-500 text-center">
            Take a clear photo of the printed pairing sheet with results marked. Ensure good lighting for best accuracy.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
