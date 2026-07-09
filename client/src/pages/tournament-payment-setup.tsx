import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { parseTournamentConfig, type PaymentProvider, type AccountPaymentSettings } from "@/lib/tournament-config";
import type { Tournament } from "@shared/schema";
import { apiRequest } from "@/lib/queryClient";
import clsx from "clsx";
import { slugify } from "@/lib/utils";
import { BadgeCheck, AlertCircle } from "lucide-react";


interface TournamentPaymentSetupPageProps {
  tournamentId: number;
}

interface FormState {
  provider: PaymentProvider;
  defaultCurrency: string;
  onlineEnabled: boolean;
  requirePaymentOnRegistration: boolean;
  allowProcessingContribution: boolean;
  processingFeePercent: string;
  stripeAccountId: string;
  stripePublishableKey: string;
  payoutStatementDescriptor: string;
}

const providerDescriptions: Record<PaymentProvider, { title: string; subtitle: string }> = {
  stripe: {
    title: "Stripe",
    subtitle: "Accept cards, digital wallets, and more with fast payouts.",
  },
  paypal: {
    title: "PayPal",
    subtitle: "Accept PayPal, credit and debit cards via PayPal Checkout.",
  },
};

function sanitizeCurrency(input: string): string {
  const trimmed = input.trim().toUpperCase();
  return trimmed.slice(0, 3) || "USD";
}

function useTournamentData(tournamentId: number) {
  return useQuery<Tournament>({
    queryKey: [`/api/tournaments/${tournamentId}`],
    queryFn: async () => apiRequest(`/api/tournaments/${tournamentId}`),
  });
}

function useAccountPaymentSettings() {
  return useQuery<AccountPaymentSettings>({
    queryKey: ["/api/account/payments"],
    queryFn: async () => apiRequest("/api/account/payments"),
  });
}

export default function TournamentPaymentSetupPage({ tournamentId }: TournamentPaymentSetupPageProps) {
  const { user, isLoading: authLoading } = useAuth();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: tournament, isLoading: tournamentLoading } = useTournamentData(tournamentId);
  const { data: accountSettings } = useAccountPaymentSettings();

  const parsedConfig = useMemo(() => (tournament ? parseTournamentConfig(tournament) : null), [tournament]);
  const isOwner = user?.role === "tournament_director" && tournament && tournament.createdBy === user.id;

  const [hydrated, setHydrated] = useState(false);
  const [form, setForm] = useState<FormState>({
    provider: "stripe",
    defaultCurrency: "USD",
    onlineEnabled: false,
    requirePaymentOnRegistration: false,
    allowProcessingContribution: true,
    processingFeePercent: "0",
    stripeAccountId: "",
    stripePublishableKey: "",
    payoutStatementDescriptor: "",
  });

  useEffect(() => {
    if (hydrated || !parsedConfig) return;
    const defaults = accountSettings ?? { preferredProvider: null };
    const payments = parsedConfig.payments;
    setForm({
      provider: payments.provider ?? (defaults.preferredProvider ?? "stripe"),
      defaultCurrency: payments.defaultCurrency ?? "USD",
      onlineEnabled: payments.onlineEnabled ?? false,
      requirePaymentOnRegistration: payments.requirePaymentOnRegistration ?? false,
      allowProcessingContribution: payments.allowProcessingContribution ?? true,
      processingFeePercent:
        payments.processingFeePercent !== null && payments.processingFeePercent !== undefined
          ? payments.processingFeePercent.toString()
          : "",
      stripeAccountId: payments.stripeAccountId ?? defaults.stripeAccountId ?? "",
      stripePublishableKey: payments.stripePublishableKey ?? defaults.stripePublishableKey ?? "",
      payoutStatementDescriptor:
        payments.payoutStatementDescriptor ?? defaults.payoutStatementDescriptor ?? "",
    });
    setHydrated(true);
  }, [hydrated, parsedConfig, accountSettings]);

  useEffect(() => {
    if (authLoading || tournamentLoading) return;
    if (!user) {
      setLocation("/");
    } else if (user.role !== "tournament_director" || (parsedConfig && !isOwner)) {
      setLocation(`/tournaments/${tournament ? slugify(tournament.name) : tournamentId}`);
    }
  }, [authLoading, tournamentLoading, user, parsedConfig, isOwner, setLocation, tournamentId, tournament]);

  const updateTournamentPayments = useMutation({
    mutationFn: async (payload: Record<string, unknown>) =>
      apiRequest(`/api/tournaments/${tournamentId}/payments`, {
        method: "PUT",
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/tournaments/${tournamentId}`] });
      queryClient.invalidateQueries({ queryKey: [`/api/tournaments/${tournamentId}/payments/config`] });
    },
  });



  if (authLoading || tournamentLoading || !parsedConfig || !hydrated) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-transparent">
        <div className="flex items-center gap-3 text-slate-500">
          <span className="inline-flex h-5 w-5 animate-spin rounded-full border-2 border-slate-300 border-t-slate-600" />
          Loading payment settings...
        </div>
      </div>
    );
  }

  if (!user || user.role !== "tournament_director" || !isOwner) {
    return null;
  }

  const accountDefaults: AccountPaymentSettings = accountSettings ?? { preferredProvider: null };

  const providerCards = (["stripe"] as PaymentProvider[]).map((provider) => {
    const active = form.provider === provider;
    const { title, subtitle } = providerDescriptions[provider];
    return (
      <button
        key={provider}
        type="button"
        onClick={() => setForm((prev) => ({ ...prev, provider }))}
        className={clsx(
          "flex h-full flex-col gap-2 rounded-lg border p-4 text-left shadow-sm transition",
          active
            ? "border-indigo-500 bg-indigo-50/70 text-indigo-900"
            : "border-slate-200 hover:border-indigo-200 hover:bg-indigo-50/40",
        )}
      >
        <div className="flex items-center justify-between">
          <span className="text-lg font-semibold">{title}</span>
          {active && <Badge variant="outline">Selected</Badge>}
        </div>
        <p className="text-sm text-slate-600">{subtitle}</p>
      </button>
    );
  });

  const safeProcessingFee = (): number | null => {
    const trimmed = form.processingFeePercent.trim();
    if (!trimmed) return null;
    const numeric = Number(trimmed);
    if (!Number.isFinite(numeric)) return null;
    return Math.max(0, Math.min(100, Number(numeric.toFixed(2))));
  };

  const buildTournamentPayload = () => ({
    provider: form.provider,
    defaultCurrency: sanitizeCurrency(form.defaultCurrency),
    onlineEnabled: form.onlineEnabled,
    requirePaymentOnRegistration: form.requirePaymentOnRegistration,
    allowProcessingContribution: form.allowProcessingContribution,
    processingFeePercent: safeProcessingFee(),
    stripeAccountId: accountSettings?.stripeAccountId?.trim() ?? "",
    stripePublishableKey: accountSettings?.stripePublishableKey?.trim() ?? "",
    payoutStatementDescriptor: accountSettings?.payoutStatementDescriptor?.trim() ?? "",
    connectionScope: "tournament",
  });

  const handleSaveTournament = async () => {
    try {
      await updateTournamentPayments.mutateAsync(buildTournamentPayload());
      toast({ title: "Payment settings updated", description: "Tournament payments are ready to use." });
      queryClient.invalidateQueries({ queryKey: [`/api/tournaments/${tournamentId}`] });
    } catch (error: any) {
      toast({
        title: "Unable to update tournament",
        description: error?.message ?? "Please try again",
        variant: "destructive",
      });
    }
  };

  const isBusy = updateTournamentPayments.isPending;

  return (
    <div className="min-h-screen bg-transparent">
      <div className="border-b bg-white/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-6 sm:px-6 lg:px-8">
          <div className="space-y-1">

            <h1 className="text-2xl font-semibold text-slate-900 mt-2">Collect entry fees</h1>
            <p className="text-sm text-slate-600">
              Connect a payment provider to start accepting online entry fees for this tournament.
            </p>
          </div>
          <Badge variant="secondary">Tournament #{tournamentId}</Badge>
        </div>
      </div>

      <div className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
        <div className="grid gap-6 lg:grid-cols-[2fr,1fr]">
          <Card className="shadow-sm">
            <CardHeader className="border-b border-slate-100 bg-white">
              <CardTitle>Tournament Checkout Rules</CardTitle>
              <CardDescription>Configure rules and fees for online player registrations.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6 bg-white pt-6">
              <div className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <ToggleField
                    label="Enable Online Registration Payments"
                    description="Allow players to register and pay entry fees online."
                    checked={form.onlineEnabled}
                    onCheckedChange={(checked) => setForm((prev) => ({ ...prev, onlineEnabled: checked }))}
                  />
                  <ToggleField
                    label="Require Payment on Registration"
                    description="Players must complete entry checkout immediately to register."
                    checked={form.requirePaymentOnRegistration}
                    onCheckedChange={(checked) => setForm((prev) => ({ ...prev, requirePaymentOnRegistration: checked }))}
                  />
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="defaultCurrency">Default currency</Label>
                  <Select
                    value={form.defaultCurrency}
                    onValueChange={(value) => setForm((prev) => ({ ...prev, defaultCurrency: value }))}
                  >
                    <SelectTrigger id="defaultCurrency">
                      <SelectValue placeholder="Select a currency" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="USD">USD - United States Dollar</SelectItem>
                      <SelectItem value="CAD">CAD - Canadian Dollar</SelectItem>
                      <SelectItem value="EUR">EUR - Euro</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-slate-500">Select the primary currency for payments.</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="processingFee">Processing fee (%)</Label>
                  <Input
                    id="processingFee"
                    type="number"
                    inputMode="decimal"
                    min="0"
                    max="100"
                    step="0.1"
                    value={form.processingFeePercent}
                    onChange={(event) => setForm((prev) => ({ ...prev, processingFeePercent: event.target.value }))}
                  />
                  <p className="text-xs text-slate-500">Leave blank to disable additional fees.</p>
                </div>
              </div>

              {form.provider === "stripe" ? (
                <div className={clsx(
                  "space-y-4 rounded-xl border p-5 mt-4 animate-in fade-in duration-200 shadow-sm transition-colors",
                  accountSettings?.stripeAccountId 
                    ? "bg-emerald-50/70 border-emerald-200 text-emerald-900" 
                    : "bg-rose-50/70 border-rose-200 text-rose-900"
                )}>
                  <div className="flex items-start gap-4">
                    <div className={clsx(
                      "rounded-xl p-2 shrink-0 mt-0.5 shadow-sm border",
                      accountSettings?.stripeAccountId 
                        ? "bg-emerald-100/80 text-emerald-600 border-emerald-200" 
                        : "bg-rose-100/80 text-rose-600 border-rose-200"
                    )}>
                      {accountSettings?.stripeAccountId ? (
                        <BadgeCheck className="h-6 w-6 text-emerald-600" />
                      ) : (
                        <AlertCircle className="h-6 w-6 text-rose-600" />
                      )}
                    </div>
                    <div className="space-y-1">
                      <h4 className={clsx(
                        "text-sm font-bold",
                        accountSettings?.stripeAccountId ? "text-emerald-900" : "text-rose-900"
                      )}>
                        {accountSettings?.stripeAccountId ? "Stripe Connected successfully" : "Stripe Connection Required"}
                      </h4>
                      <p className={clsx(
                        "text-xs leading-relaxed",
                        accountSettings?.stripeAccountId ? "text-emerald-700/90" : "text-rose-700/90"
                      )}>
                        {accountSettings?.stripeAccountId ? (
                          <>
                            Your tournament is connected to your global Stripe account: <code className="font-mono bg-emerald-100/60 px-1.5 py-0.5 rounded text-[11px] font-bold text-emerald-800">{accountSettings.stripeAccountId}</code>. All online registration fees will route directly to your connected bank account.
                          </>
                        ) : (
                          <>
                            You must connect your Stripe Account under Settings in order to collect online registration payments.
                          </>
                        )}
                      </p>
                    </div>
                  </div>

                  <div className="flex gap-3 pt-1">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setLocation("/settings")}
                      className={clsx(
                        "text-xs font-semibold gap-1.5 h-8 shadow-sm transition",
                        accountSettings?.stripeAccountId 
                          ? "bg-white border-emerald-200 text-emerald-700 hover:bg-emerald-50" 
                          : "bg-white border-rose-200 text-rose-700 hover:bg-rose-50"
                      )}
                    >
                      ✏️ {accountSettings?.stripeAccountId ? "Manage Stripe Connection in Settings" : "Configure Stripe Connection in Settings"}
                    </Button>
                  </div>
                </div>
              ) : null}

              <div className="flex justify-end gap-3 border-t pt-5">
                <Button
                  variant="outline"
                  type="button"
                  onClick={() => setLocation(`/tournaments/${tournament ? slugify(tournament.name) : tournamentId}/manage`)}
                  disabled={isBusy}
                >
                  Cancel
                </Button>
                <Button onClick={handleSaveTournament} disabled={isBusy || (form.provider === "stripe" && !accountSettings?.stripeAccountId)}>
                  {updateTournamentPayments.isPending ? "Saving..." : "Save payment settings"}
                </Button>
              </div>
            </CardContent>
          </Card>

          <div className="space-y-4">
            <Card className="shadow-sm">
              <CardHeader>
                <CardTitle className="text-base font-semibold">How it works</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm text-slate-600">
                <p>
                  Configure a payment provider so players can pay their entry fees during registration. Online
                  payments remain optional unless you require payment on registration.
                </p>
                <p>
                  Saving as your default account will prefill future tournaments with the same connection details.
                </p>
              </CardContent>
            </Card>

            <Card className="shadow-sm">
              <CardHeader>
                <CardTitle className="text-base font-semibold">Account defaults</CardTitle>
                <CardDescription>Current payment preferences saved on your director account.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <SummaryRow label="Preferred provider">
                  {accountDefaults.preferredProvider ? accountDefaults.preferredProvider.toUpperCase() : "None"}
                </SummaryRow>
                <SummaryRow label="Stripe account ID">{accountDefaults.stripeAccountId || "—"}</SummaryRow>
                <SummaryRow label="Stripe key">{accountDefaults.stripePublishableKey || "—"}</SummaryRow>
                <SummaryRow label="Last updated">
                  {accountDefaults.updatedAt ? new Date(accountDefaults.updatedAt).toLocaleString() : "—"}
                </SummaryRow>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}

interface ToggleFieldProps {
  label: string;
  description: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}

function ToggleField({ label, description, checked, onCheckedChange }: ToggleFieldProps) {
  return (
    <div className="flex items-start justify-between rounded-lg border border-slate-200 bg-slate-50/70 p-4">
      <div className="pr-4">
        <p className="text-sm font-medium text-slate-900">{label}</p>
        <p className="text-xs text-slate-600">{description}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  );
}

interface SummaryRowProps {
  label: string;
  children: React.ReactNode;
}

function SummaryRow({ label, children }: SummaryRowProps) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-slate-500">{label}</span>
      <span className="font-medium text-slate-900">{children}</span>
    </div>
  );
}
