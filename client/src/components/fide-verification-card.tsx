import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Globe, CheckCircle2, AlertCircle } from "lucide-react";

export function FideVerificationCard() {
  const { user } = useAuth();

  if (!user) return null;

  const isUscfVerified = user.uscfVerificationStatus === "verified";
  const hasFideId = !!user.uscfFideId;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-3">
        <Globe className="h-5 w-5 text-primary" />
        <div className="flex-1">
          <CardTitle>FIDE Account Linking</CardTitle>
          <CardDescription>
            Link your official FIDE ID to your profile.
          </CardDescription>
        </div>
        {isUscfVerified && hasFideId ? (
          <Badge variant="default" className="bg-green-600 hover:bg-green-700 flex items-center gap-1">
            <CheckCircle2 className="h-3 w-3" />
            Verified
          </Badge>
        ) : (
          <Badge variant="secondary" className="flex items-center gap-1">
            Unverified
          </Badge>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {isUscfVerified && hasFideId ? (
          <div className="rounded-lg border bg-green-50/50 dark:bg-green-950/20 p-4">
            <div className="flex flex-col gap-2">
              <div className="flex justify-between items-center">
                <span className="text-sm font-medium text-muted-foreground">FIDE ID</span>
                <span className="font-semibold text-lg">{user.uscfFideId}</span>
              </div>
              <p className="text-sm text-muted-foreground mt-2">
                Your FIDE ID was automatically verified and linked via your official USCF profile.
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
              <p className="text-sm text-amber-800/80 dark:text-amber-400/80">
                You have verified your USCF account, but your USCF profile does not list a FIDE ID. 
                If you have a FIDE ID, please contact the US Chess Federation to have it added to your member profile. 
                Once added, it will automatically sync here.
              </p>
            </div>
          </div>
        ) : (
          <div className="rounded-lg border bg-card p-4">
            <p className="text-sm text-muted-foreground">
              To link your FIDE ID, you must first verify your USCF account. 
              We securely pull your official FIDE ID directly from your verified USCF profile.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
