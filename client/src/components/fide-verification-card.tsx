import { useAuth } from "@/hooks/useAuth";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Globe, CheckCircle2, AlertCircle, HelpCircle, Loader2 } from "lucide-react";

export function FideVerificationCard() {
  const { user } = useAuth();

  // Query real-time USCF and FIDE status from the API so it updates instantly
  const { data: statusData, isLoading } = useQuery({
    queryKey: ["/api/verification/uscf/me"],
    enabled: !!user
  });

  if (!user) return null;

  if (isLoading) {
    return (
      <Card className="border-slate-200/60 shadow-sm rounded-2xl dark:bg-slate-900">
        <CardContent className="p-6 flex justify-center">
          <Loader2 className="animate-spin h-6 w-6 text-primary" />
        </CardContent>
      </Card>
    );
  }

  // Extract from real-time status data, fallback to user model
  const status = (statusData as any)?.status || user.uscfVerificationStatus;
  const fideId = (statusData as any)?.fideId || user.uscfFideId;

  const isUscfVerified = status === "verified";
  const isUscfPending = status === "pending";
  const hasFideId = !!fideId;

  // Render badge in top-right
  const renderBadge = () => {
    if (isUscfVerified && hasFideId) {
      return (
        <Badge variant="default" className="bg-green-100 text-green-800 hover:bg-green-100 border-none px-3 py-1 font-semibold rounded-full flex items-center gap-1.5 dark:bg-green-950/40 dark:text-green-300">
          <CheckCircle2 className="h-3.5 w-3.5 text-green-600" /> Verified
        </Badge>
      );
    }
    if (isUscfPending && hasFideId) {
      return (
        <Badge variant="outline" className="bg-amber-100 text-amber-800 hover:bg-amber-100 border-none px-3 py-1 font-semibold rounded-full flex items-center gap-1.5 dark:bg-amber-950/40 dark:text-amber-300">
          <HelpCircle className="h-3.5 w-3.5 text-amber-600 animate-pulse" /> Connected (Pending Verification)
        </Badge>
      );
    }
    return (
      <Badge variant="secondary" className="bg-slate-100 text-slate-700 hover:bg-slate-100 border-none px-3 py-1 font-semibold rounded-full flex items-center gap-1.5 dark:bg-slate-800 dark:text-slate-300">
        Unverified
      </Badge>
    );
  };

  return (
    <Card className="border-slate-200/60 shadow-sm rounded-2xl dark:bg-slate-900">
      <CardHeader className="flex flex-row items-center gap-3 border-b bg-muted/20 px-6 py-4">
        <Globe className="h-5 w-5 text-indigo-500" />
        <div className="flex-1">
          <CardTitle className="text-base font-semibold">FIDE Account Linking</CardTitle>
          <CardDescription className="text-xs text-muted-foreground mt-0.5">
            Link your official FIDE ID to your profile.
          </CardDescription>
        </div>
        {renderBadge()}
      </CardHeader>
      <CardContent className="p-6 space-y-4">
        {isUscfVerified && hasFideId ? (
          <div className="rounded-lg border bg-green-50/50 dark:bg-green-950/20 p-4">
            <div className="flex flex-col gap-2">
              <div className="flex justify-between items-center">
                <span className="text-sm font-medium text-muted-foreground">FIDE ID</span>
                <span className="font-mono font-bold text-lg text-slate-800 dark:text-slate-200">{fideId}</span>
              </div>
              <p className="text-sm text-muted-foreground mt-2">
                Your FIDE ID was automatically verified and linked via your official USCF profile.
              </p>
            </div>
          </div>
        ) : isUscfPending && hasFideId ? (
          <div className="rounded-lg border bg-amber-50/50 dark:bg-amber-950/20 p-4">
            <div className="flex flex-col gap-2">
              <div className="flex justify-between items-center">
                <span className="text-sm font-medium text-muted-foreground">FIDE ID</span>
                <span className="font-mono font-bold text-lg text-slate-800 dark:text-slate-200">{fideId}</span>
              </div>
              <p className="text-sm text-muted-foreground mt-2">
                Your FIDE ID is connected and awaiting verification along with your USCF profile.
              </p>
            </div>
          </div>
        ) : isUscfVerified && !hasFideId ? (
          <div className="rounded-lg border bg-amber-50/50 dark:bg-amber-950/20 p-4 flex gap-3">
            <AlertCircle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <h4 className="text-sm font-medium text-amber-900 dark:text-amber-300">
                No FIDE ID on USCF Profile
              </h4>
              <p className="text-sm text-amber-800/80 dark:text-amber-400/80 leading-relaxed">
                You have verified your USCF account, but your USCF profile does not list a FIDE ID. 
                If you have a FIDE ID, please contact the US Chess Federation to have it added to your member profile. 
                Once added, it will automatically sync here.
              </p>
            </div>
          </div>
        ) : isUscfPending && !hasFideId ? (
          <div className="rounded-lg border bg-amber-50/50 dark:bg-amber-950/20 p-4 flex gap-3">
            <AlertCircle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <h4 className="text-sm font-medium text-amber-900 dark:text-amber-300">
                No FIDE ID found
              </h4>
              <p className="text-sm text-amber-800/80 dark:text-amber-400/80 leading-relaxed">
                Your USCF account is connected (Pending Verification), but we could not locate a matching FIDE ID. 
                If you have a FIDE ID, once your USCF account is verified, we will attempt to sync it if available.
              </p>
            </div>
          </div>
        ) : (
          <div className="rounded-lg border bg-card p-4">
            <p className="text-sm text-muted-foreground leading-relaxed">
              To link your FIDE ID, you must first connect/verify your USCF account. 
              We securely pull your official FIDE ID directly from your verified USCF profile.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
