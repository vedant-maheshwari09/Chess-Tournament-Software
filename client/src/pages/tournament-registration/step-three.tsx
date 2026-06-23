import React, { useState, useEffect, useMemo, useCallback } from "react";
import { useFormContext } from "react-hook-form";
import { useStripe, useElements, PaymentElement } from "@stripe/react-stripe-js";
import type { Stripe, StripeElements } from "@stripe/stripe-js";
import { AlertCircle, CreditCard, ShieldCheck, Wallet, Loader2, Save } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { useQuery } from "@tanstack/react-query";
import type { Tournament } from "@shared/schema";
import { cn, slugify } from "@/lib/utils";
import type { RegistrationFormValues, SectionOption, PaymentTotals, PlayerDraft, PaymentStatusKey } from "./types";
import { RadioOption } from "./components";
import { computePaymentTotals, formatCurrency, DEBUG_LOG, parseContribution, mapStripeStatus, NO_ENTRY_FEE_ID } from "./helpers";
import type { EntryFeeRule, PaymentSettings } from "@/lib/tournament-config";

const OFFLINE_METHOD_LABELS: Record<string, string> = {
  cash: "Cash",
  check: "Check",
  venmo: "Venmo",
  paypal: "PayPal",
  zelle: "Zelle",
  other: "Other Offline Payment Method"
};

export interface StepThreeProps {
  paymentDetails: string | undefined | null;
  paymentSettings: PaymentSettings | null;
  paymentTotals: PaymentTotals;
  playerDrafts: PlayerDraft[];
  onEditDraft: (draftId: string) => void;
  onRemoveDraft: (draftId: string) => void;
  selectedEntryFee: EntryFeeRule | null;
  sections: SectionOption[];
  requiresPayment: boolean;
  onlineConfigured: boolean;
  clientSecret: string | null;
  registerPaymentHandler: (handler: (() => Promise<boolean>) | null) => void;
  setPaymentBusy: (busy: boolean) => void;
  onPaymentElementReady: (ready: boolean) => void;
  paymentIntentLoading: boolean;
  paymentIntentError: string | null;
  canAcceptOnlinePayment: boolean;
  tournamentId: number;
  retryPaymentIntent: () => void;
}

export interface StepThreeContentProps extends StepThreeProps {
  stripe: Stripe | null;
  elements: StripeElements | null;
}

function StepThree(props: StepThreeProps) {
  if (props.canAcceptOnlinePayment) {
    return <StepThreeStripe {...props} />;
  }
  return <StepThreeContent {...props} stripe={null} elements={null} />;
}

function StepThreeStripe(props: StepThreeProps) {
  const stripe = useStripe();
  const elements = useElements();
  return <StepThreeContent {...props} stripe={stripe} elements={elements} />;
}

export default StepThree;

function StepThreeContent({
  paymentDetails,
  paymentSettings,
  paymentTotals,
  selectedEntryFee,
  sections,
  requiresPayment,
  onlineConfigured,
  clientSecret,
  registerPaymentHandler,
  setPaymentBusy,
  onPaymentElementReady,
  paymentIntentLoading,
  paymentIntentError,
  canAcceptOnlinePayment,
  tournamentId,
  retryPaymentIntent,
  playerDrafts = [],
  onEditDraft,
  onRemoveDraft,
  stripe,
  elements,
}: StepThreeContentProps) {
  const form = useFormContext<RegistrationFormValues>();
  const { toast } = useToast();
  const { data: tournament } = useQuery<Tournament>({
    queryKey: [`/api/tournaments/${tournamentId}`],
    enabled: Boolean(tournamentId),
  });

  const contributionAllowed = paymentSettings?.allowProcessingContribution !== false;
  const entryFeeId = form.watch("entryFeeId");
  const processingContributionRaw = form.watch("processingContribution");
  const processingContribution = contributionAllowed ? parseContribution(processingContributionRaw) : 0;
  const paymentStatus = (form.watch("paymentStatus") ?? "unpaid") as PaymentStatusKey;
  const acknowledgementChecked = form.watch("paymentAcknowledgement");
  const paymentMethod = form.watch("paymentMethod") ?? undefined;
  const acknowledgementError = form.formState.errors.paymentAcknowledgement?.message as string | undefined;
  const contributionError = form.formState.errors.processingContribution?.message as string | undefined;

  const firstName = form.watch("firstName");
  const lastName = form.watch("lastName");
  const sectionChoice = form.watch("sectionChoice");
  const sectionChoiceOption = useMemo(() => {
    if (!sectionChoice) return undefined;
    const normalized = sectionChoice.trim().toLowerCase();
    return sections.find((section: any) => section.name.trim().toLowerCase() === normalized);
  }, [sectionChoice, sections]);
  const email = form.watch("email");

  const arrivalTime = form.watch("arrivalTime");
  const notes = form.watch("notes");

  const offlineMethods = paymentSettings?.acceptedOfflineMethods ?? [];
  const offlineAllowed = offlineMethods.length > 0;
  const showPaymentToggle = canAcceptOnlinePayment && offlineAllowed && requiresPayment;
  const [activePaymentMode, setActivePaymentMode] = useState<"online" | "offline">(
    canAcceptOnlinePayment ? "online" : "offline"
  );
  const offlineInstructions = paymentSettings?.offlineInstructions;
  const offlineInfoBlocks = ((offlineAllowed || !requiresPayment) ? [offlineInstructions, paymentDetails] : []) as Array<
    string | null | undefined
  >;
  const isOfflineEntry = entryFeeId === NO_ENTRY_FEE_ID || !selectedEntryFee;

  const statusStyles: Record<PaymentStatusKey, string> = {
    unpaid: "bg-slate-100 text-slate-700",
    processing: "bg-blue-100 text-blue-700",
    paid: "bg-emerald-100 text-emerald-700",
    failed: "bg-red-100 text-red-700",
    refunded: "bg-slate-100 text-slate-600 border border-slate-200",
  };

  const statusLabels: Record<PaymentStatusKey, string> = {
    unpaid: "Unpaid",
    processing: "Processing",
    paid: "Paid",
    failed: "Failed",
    refunded: "Refunded",
  };

  const acknowledgementLabel = requiresPayment
    ? "I authorize the tournament to charge the payment method above and confirm these details are accurate."
    : "I will complete payment using the offline instructions provided by the tournament director.";

  // Individual player summary grid removed to avoid double section/summary
  // We rely on the Registration Summary list rendered by the parent for roster details.
  const summary: any[] = [];

  useEffect(() => {
    if (!canAcceptOnlinePayment) {
      onPaymentElementReady(true);
    }
  }, [canAcceptOnlinePayment, onPaymentElementReady]);

  const handlePaymentConfirmation = useCallback(async () => {
    if (!requiresPayment) {
      return true;
    }
    if (activePaymentMode === "offline" || !canAcceptOnlinePayment) {
      form.setValue("paymentStatus", "unpaid", { shouldDirty: true, shouldValidate: true });
      form.setValue("paymentMethod", "offline", { shouldDirty: true, shouldValidate: true });
      form.setValue("amountDue", paymentTotals.total, { shouldDirty: false });
      form.setValue("currency", paymentTotals.currency, { shouldDirty: false });
      return true;
    }

    if (!stripe || !elements) {
      toast({
        title: "Payment unavailable",
        description: "Stripe Checkout is still loading. Please wait a moment and try again.",
        variant: "destructive",
      });
      return false;
    }

    setPaymentBusy(true);
    try {
      const { error: submitError } = await elements.submit();
      if (submitError) {
        toast({
          title: "Payment details incomplete",
          description: submitError.message ?? "Fill out the payment form before continuing.",
          variant: "destructive",
        });
        return false;
      }

      const trimmedName = `${firstName ?? ""} ${lastName ?? ""}`.trim() || undefined;
      const returnUrl =
        typeof window !== "undefined" && tournament
          ? `${window.location.origin}/tournaments/${slugify(tournament.name)}/register?payment=complete`
          : undefined;

      const result = await stripe.confirmPayment({
        elements,
        redirect: "if_required",
        confirmParams: {
          return_url: returnUrl,
          payment_method_data: {
            billing_details: {
              name: trimmedName,
              email: email || undefined,

            },
          },
        },
      });

      if (result.error) {
        form.setValue("paymentStatus", "failed", { shouldDirty: true });
        toast({
          title: "Payment failed",
          description: result.error.message ?? "Your payment method was declined. Please try again.",
          variant: "destructive",
        });
        return false;
      }

      const intent = result.paymentIntent;
      if (!intent) {
        toast({
          title: "Payment failed",
          description: "Stripe did not return a payment status. Please try again.",
          variant: "destructive",
        });
        return false;
      }

      const mappedStatus = mapStripeStatus(intent.status);
      form.setValue("paymentStatus", mappedStatus, { shouldDirty: false });
      form.setValue("paymentIntentId", intent.id, { shouldDirty: false });
      const amountReceivedCents =
        typeof (intent as any).amount_received === "number"
          ? (intent as any).amount_received
          : typeof (intent as any).amountReceived === "number"
            ? (intent as any).amountReceived
            : 0;
      const amountCents =
        typeof intent.amount === "number"
          ? intent.amount
          : typeof (intent as any).amount === "number"
            ? (intent as any).amount
            : Math.round(paymentTotals.total * 100);
      form.setValue("amountPaid", Number((amountReceivedCents / 100).toFixed(2)), { shouldDirty: false });
      form.setValue("amountDue", Number((amountCents / 100).toFixed(2)), { shouldDirty: false });
      form.setValue(
        "currency",
        intent.currency ? intent.currency.toUpperCase() : paymentTotals.currency,
        { shouldDirty: false },
      );
      form.setValue(
        "paymentMethod",
        intent.payment_method_types?.[0] ?? form.getValues("paymentMethod") ?? undefined,
        { shouldDirty: false },
      );
      const receiptUrl =
        (intent as any)?.charges?.data?.[0]?.receipt_url ??
        (intent as any)?.latest_charge?.receipt_url ??
        undefined;
      form.setValue("paymentReceiptUrl", receiptUrl, { shouldDirty: false });

      if (mappedStatus !== "paid") {
        toast({
          title: "Payment processing",
          description: "Stripe is still processing this transaction. Please wait a moment and submit again.",
          variant: "destructive",
        });
        return false;
      }

      form.setValue("paymentAcknowledgement", true, { shouldDirty: true, shouldValidate: true });
      toast({
        title: "Payment confirmed",
        description: "Your payment was processed successfully.",
      });
      return true;
    } catch (error) {
      toast({
        title: "Payment failed",
        description: error instanceof Error ? error.message : "Unable to confirm the payment.",
        variant: "destructive",
      });
      return false;
    } finally {
      setPaymentBusy(false);
    }
  }, [
    canAcceptOnlinePayment,
    requiresPayment,
    stripe,
    elements,
    toast,
    setPaymentBusy,
    form,
    paymentTotals.total,
    paymentTotals.currency,
    firstName,
    lastName,
    email,
    tournament,
    tournamentId,
  ]);

  useEffect(() => {
    registerPaymentHandler(handlePaymentConfirmation);
    return () => registerPaymentHandler(null);
  }, [registerPaymentHandler, handlePaymentConfirmation]);

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="flex items-center gap-4 border-b border-gray-100 bg-gray-50/50 px-6 py-5">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-white border border-gray-200 shadow-sm">
          <Wallet className="h-5 w-5 text-gray-600" />
        </div>
        <div>
          <h2 className="text-lg font-semibold leading-tight text-gray-900">Payment &amp; Review</h2>
          <p className="text-sm text-gray-500">
            Step 3 of 3: {requiresPayment ? "Complete registration with secure checkout" : "Confirm and submit your registration"}
          </p>
        </div>
      </div>

      <div className="space-y-6 p-6">
        <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-slate-900">Payment summary</h3>
            <span className={cn("rounded-full px-3 py-1 text-xs font-semibold", statusStyles[paymentStatus])}>
              {statusLabels[paymentStatus]}
            </span>
          </div>
          <div className="mt-3 space-y-3 text-sm text-slate-600">
            <div className="flex items-center justify-between font-medium">
              <span>{playerDrafts.length > 1 ? `Subtotal (${playerDrafts.length} players)` : "Entry fee"}</span>
              <span className="text-blue-700">
                {formatCurrency(paymentTotals.subtotal, paymentTotals.currency)}
              </span>
            </div>
            {playerDrafts.length <= 1 && selectedEntryFee && (
              <p className="text-xs text-slate-500">
                Section: {selectedEntryFee.section}
              </p>
            )}
            {(() => {
              const answers = form.watch("customAnswers") ?? {};
              const hasUscf = answers.uscfMembershipRenewalFee === true || answers.uscfMembershipRenewalFee === "true";
              const hasTshirt = answers.tshirtPreorderFee === true || answers.tshirtPreorderFee === "true";
              const donationValue = answers.donationPrizeFund;
              let donationAmt = 0;
              if (typeof donationValue === "string") {
                if (donationValue.includes("$10")) donationAmt = 10;
                else if (donationValue.includes("$25")) donationAmt = 25;
                else if (donationValue.includes("$50")) donationAmt = 50;
                else if (donationValue.includes("$100")) donationAmt = 100;
              }
              const discountCode = answers.earlyBirdDiscountCode || answers.voucherCode;
              let discountAmt = 0;
              if (typeof discountCode === "string" && discountCode.trim()) {
                const code = discountCode.trim().toUpperCase();
                if (code === "EARLYBIRD10" || code === "CHESSCLUB") {
                  discountAmt = 10;
                }
              }

              if (playerDrafts.length <= 1 && (hasUscf || hasTshirt || donationAmt > 0 || discountAmt > 0)) {
                return (
                  <div className="border-t border-dashed border-slate-200 pt-3 space-y-2">
                    <span className="text-[10px] font-extrabold text-slate-400 tracking-wider uppercase">Add-ons & Vouchers</span>
                    {hasUscf && (
                      <div className="flex items-center justify-between text-xs text-slate-600 font-medium">
                        <span>USCF Membership Renewal</span>
                        <span>{formatCurrency(45, paymentTotals.currency)}</span>
                      </div>
                    )}
                    {hasTshirt && (
                      <div className="flex items-center justify-between text-xs text-slate-600 font-medium">
                        <span>Pre-order T-Shirt Add-on</span>
                        <span>{formatCurrency(20, paymentTotals.currency)}</span>
                      </div>
                    )}
                    {donationAmt > 0 && (
                      <div className="flex items-center justify-between text-xs text-slate-600 font-medium">
                        <span>Prize Fund Donation</span>
                        <span>{formatCurrency(donationAmt, paymentTotals.currency)}</span>
                      </div>
                    )}
                    {discountAmt > 0 && (
                      <div className="flex items-center justify-between text-xs text-emerald-600 font-bold bg-emerald-50/50 px-2.5 py-1 rounded-xl">
                        <span>Voucher Discount ({String(discountCode).trim().toUpperCase()})</span>
                        <span>-{formatCurrency(discountAmt, paymentTotals.currency)}</span>
                      </div>
                    )}
                  </div>
                );
              }
              return null;
            })()}
            {contributionAllowed ? (
              <div className="flex items-center justify-between border-t border-dashed border-slate-200 pt-3">
                <label htmlFor="processing-contribution" className="text-sm">
                  Optional processing contribution
                </label>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-500">{selectedEntryFee?.currency ?? paymentTotals.currency}</span>
                  <Input
                    id="processing-contribution"
                    type="number"
                    step="0.01"
                    min={0}
                    max={500}
                    value={processingContributionRaw ?? "0"}
                    onChange={(event: any) =>
                      form.setValue("processingContribution", event.target.value, {
                        shouldDirty: true,
                        shouldValidate: true,
                      })
                    }
                    className="w-28"
                  />
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between border-t border-dashed border-slate-200 pt-3 text-xs text-slate-500">
                <span>Processing contributions</span>
                <span>Disabled by director</span>
              </div>
            )}
            {contributionError && <p className="text-xs text-red-500">{contributionError}</p>}
            {paymentTotals.feeAmount > 0 && (
              <div className="flex items-center justify-between border-t border-dashed border-slate-200 pt-3">
                <span>Processing fee</span>
                <span>{formatCurrency(paymentTotals.feeAmount, paymentTotals.currency)}</span>
              </div>
            )}
            <div className="flex items-center justify-between border-t border-slate-200 pt-3 text-sm font-semibold text-blue-700">
              <span>Total due</span>
              <span>{formatCurrency(paymentTotals.total, paymentTotals.currency)}</span>
            </div>
            {paymentMethod && <p className="text-xs text-slate-500">Payment method: {paymentMethod.toUpperCase()}</p>}
          </div>
        </div>

        {showPaymentToggle && (
          <div className="flex bg-gray-100/80 p-1.5 rounded-lg">
            <button
              type="button"
              onClick={() => setActivePaymentMode("online")}
              className={cn(
                "flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-all",
                activePaymentMode === "online"
                  ? "bg-white text-gray-900 shadow-sm border border-gray-200"
                  : "text-gray-600 hover:text-gray-900",
              )}
            >
              <CreditCard className="h-4 w-4" />
              Pay Online
            </button>
            <button
              type="button"
              onClick={() => setActivePaymentMode("offline")}
              className={cn(
                "flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-all",
                activePaymentMode === "offline"
                  ? "bg-white text-gray-900 shadow-sm border border-gray-200"
                  : "text-gray-600 hover:text-gray-900",
              )}
            >
              <Wallet className="h-4 w-4" />
              Pay Later (Offline)
            </button>
          </div>
        )}

        {(activePaymentMode === "online" || !offlineAllowed) && (
          <div className="space-y-3 rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900">Payment method</h3>
              {requiresPayment && <Badge variant="outline">Required</Badge>}
            </div>
            {canAcceptOnlinePayment ? (
              <div className="space-y-3">
                {paymentIntentLoading ? (
                  <div className="flex items-center justify-center gap-2 rounded-lg border border-dashed border-blue-200 bg-blue-50/60 p-4 text-sm text-blue-600">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Preparing secure checkout...
                  </div>
                ) : (
                  <div className="rounded-lg border border-blue-200 bg-white p-4">
                    <PaymentElement
                      options={{ layout: "tabs" }}
                      onReady={() => onPaymentElementReady(!requiresPayment)}
                      onChange={(event: any) => onPaymentElementReady(!requiresPayment || Boolean(event.complete))}
                    />
                  </div>
                )}
                {paymentIntentError && (
                  <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-600">
                    <AlertCircle className="mt-0.5 h-4 w-4" />
                    <span>{paymentIntentError}</span>
                  </div>
                )}
                <p className="text-xs text-slate-500">
                  Payments are securely processed by Stripe. Your receipt will be sent to {email || "your email"} when the payment succeeds.
                </p>
              </div>
            ) : (
              <div className="space-y-3 rounded-lg border border-dashed border-slate-200 bg-slate-50/70 p-4 text-xs text-slate-600">
                {paymentIntentError ? (
                  <>
                    <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-red-600">
                      <AlertCircle className="mt-0.5 h-4 w-4" />
                      <span>{paymentIntentError}</span>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={retryPaymentIntent}
                      disabled={paymentIntentLoading}
                    >
                      Retry payment setup
                    </Button>
                  </>
                ) : requiresPayment ? (
                  <p className="font-medium text-slate-700">
                    Stripe checkout is unavailable right now. Please contact the tournament director to arrange payment.
                  </p>
                ) : (
                  <p>Online checkout is disabled. Follow the offline instructions below to complete payment.</p>
                )}
              </div>
            )}
          </div>
        )}

        {(activePaymentMode === "offline" || !canAcceptOnlinePayment) && (
          <div className="space-y-3 rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900">Offline payment options</h3>
              {!canAcceptOnlinePayment && <Badge variant="secondary">Alternative</Badge>}
            </div>
            {offlineAllowed ? (
              <div className="space-y-3">
                <div className="flex flex-wrap gap-2">
                  {offlineMethods.map((method: any) => (
                    <span key={method} className="rounded-full bg-blue-100 px-3 py-1 text-xs font-semibold text-blue-700">
                      {OFFLINE_METHOD_LABELS[method] ?? method}
                    </span>
                  ))}
                </div>
                <div className="rounded-lg border border-amber-200 bg-amber-50/70 p-3 text-xs leading-5 text-amber-800">
                  <div className="flex items-center gap-2 mb-1.5 font-bold uppercase tracking-tight">
                    <AlertCircle className="h-3.5 w-3.5" />
                    Important: PENDING REGISTRATION
                  </div>
                  If choosing an offline method, your registration will remain in a <strong>Pending</strong> status and isn't guaranteed until payment is finalized with the director.
                </div>
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-red-200 bg-red-50 p-3 text-xs text-red-600 font-medium">
                Offline payments are strictly disabled. Online checkout is required to secure your spot.
              </div>
            )}
            {offlineInfoBlocks
              .filter((block): block is string => Boolean(block && block.trim()))
              .map((block, index) => (
                <div
                  key={`${index}-${block.slice(0, 12)}`}
                  className="rounded-lg border border-blue-200 bg-blue-50/70 p-3 text-xs leading-5 text-blue-700"
                >
                  {block}
                </div>
              ))}
          </div>
        )}

        <div className="space-y-2 rounded-lg border border-gray-200 bg-gray-50/50 p-4">
          <label className="flex items-start gap-3 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={Boolean(acknowledgementChecked)}
              onChange={(event: any) =>
                form.setValue("paymentAcknowledgement", event.target.checked, {
                  shouldDirty: true,
                  shouldValidate: true,
                })
              }
              className="mt-1 h-4 w-4 rounded border-slate-300 text-blue-500 focus:ring-blue-500"
            />
            <span>{acknowledgementLabel}</span>
          </label>
          {acknowledgementError && <p className="text-xs text-red-500">{acknowledgementError}</p>}
        </div>


      </div>
    </div>
  );
}

