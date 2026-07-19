import React, { useState, useEffect, useMemo } from "react";
import { useFormContext } from "react-hook-form";
import { Search, Loader2, RefreshCw, AlertCircle, Check, Info, AlertTriangle, ExternalLink } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { Player } from "@shared/schema";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiRequest } from "@/lib/queryClient";
import { RadioOption, Field } from "./components";
import { cn } from "@/lib/utils";
import type { RegistrationFormValues, SectionOption, RatingLookupResult, RatingLookupResponse, RatingLookupSource } from "./types";
import {
  splitName,
  derivePlayerRating,
  filterEntryFeesBySection,
  ratingWithinSectionRange,
  formatCurrency,
  getFieldConfig,
} from "./helpers";
import type { parseTournamentConfig, EntryFeeRule } from "@/lib/tournament-config";

function UscfRatingField({ disabled }: { disabled?: boolean }) {
  const form = useFormContext<RegistrationFormValues>();
  const { toast } = useToast();
  const [isSyncing, setIsSyncing] = useState(false);

  const uscfId = form.watch("uscfId");
  const ratingProvider = form.watch("ratingProvider");

  const handleSyncRating = async () => {
    if (!uscfId || !/^\d{7,8}$/.test(uscfId.trim())) {
      toast({
        title: "Invalid USCF ID",
        description: "Please enter a valid 7 or 8-digit USCF ID to sync ratings.",
        variant: "destructive"
      });
      return;
    }

    setIsSyncing(true);
    try {
      const response = await fetch(`/api/ratings/uscf/${uscfId.trim()}/latest`);
      if (!response.ok) {
        throw new Error(await response.text() || "Failed to fetch live USCF rating");
      }
      const data = await response.json();
      
      if (data.ratingRegular !== null) {
        form.setValue("uscfRating", String(data.ratingRegular), { shouldDirty: true, shouldValidate: true });
        form.setValue("uscfRatingRaw", `${data.ratingRegular}/${data.expiry}`, { shouldDirty: true });
      } else {
        form.setValue("uscfRating", "", { shouldDirty: true });
        form.setValue("uscfRatingRaw", "Unrated", { shouldDirty: true });
      }

      if (data.expiry) {
        form.setValue("customAnswers.uscfExpiration", data.expiry, { shouldDirty: true, shouldValidate: true });
      }

      if (data.state) {
        const currentState = form.getValues("state");
        if (!currentState) {
          form.setValue("state", data.state, { shouldDirty: true, shouldValidate: true });
        }
      }

      toast({
        title: "Rating Synced",
        description: `Successfully synced live rating for ${data.name}.`
      });
    } catch (err: any) {
      console.error("Live USCF sync failed:", err);
      toast({
        title: "Sync Failed",
        description: err.message || "Failed to pull live USCF rating. Please input it manually.",
        variant: "destructive"
      });
    } finally {
      setIsSyncing(false);
    }
  };

  const showSyncButton = ratingProvider === "uscf" && uscfId && /^\d{7,8}$/.test(uscfId.trim());

  return (
    <div className="group space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-medium text-slate-700 transition-colors group-focus-within:text-blue-700">
          USCF rating
        </Label>
        {showSyncButton && (
          <button
            type="button"
            onClick={handleSyncRating}
            disabled={isSyncing}
            className="flex items-center gap-1 text-[11px] font-semibold text-blue-600 hover:text-blue-800 disabled:text-slate-400 cursor-pointer transition"
          >
            {isSyncing ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <RefreshCw className="h-3 w-3" />
            )}
            Refresh Live
          </button>
        )}
      </div>
      <div className="relative flex items-center">
        <Input
          {...form.register("uscfRating")}
          placeholder="e.g. 1850"
          type="text"
          disabled={disabled || isSyncing}
          className={cn(
            "w-full transition focus-visible:border-blue-500 focus-visible:ring-blue-500",
            form.formState.errors.uscfRating && "border-red-500 focus-visible:border-red-500 focus-visible:ring-red-500"
          )}
        />
      </div>
      {form.formState.errors.uscfRating && (
        <p className="flex items-center gap-1 text-xs font-medium text-red-500 animate-in fade-in-50 slide-in-from-top-1 duration-150">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          {form.formState.errors.uscfRating.message}
        </p>
      )}
    </div>
  );
}

export default function StepOne({
  config,
  players,
  sections,
  entryFees,
  activeFields = [],
}: {
  config: ReturnType<typeof parseTournamentConfig> | null;
  players: Player[];
  sections: SectionOption[];
  entryFees: EntryFeeRule[];
  activeFields?: any[];
}) {
  const form = useFormContext<RegistrationFormValues>();
  
  const extraFields = useMemo(() => {
    const hardcodedIds = [
      "firstName", "lastName", "uscfId", "fideId", "uscfRating", "fideRating", 
      "city", "state", "email", "ratingProvider", "playerSearch", "lookupSection",
      "playerIdentityHeading", "contactInfoHeading"
    ];
    return activeFields.filter(f => f && !hardcodedIds.includes(f.id));
  }, [activeFields]);
  const lookupMode = form.watch("lookupMode");
  const ratingProvider = form.watch("ratingProvider");
  const uscfRatingValue = form.watch("uscfRating");
  const fideRatingValue = form.watch("fideRating");
  const uscfExpiration = form.watch("customAnswers.uscfExpiration");

  const isExpired = useMemo(() => {
    if (!uscfExpiration || !/^\d{4}-\d{2}-\d{2}$/.test(uscfExpiration)) return false;
    const expDate = new Date(uscfExpiration);
    const startDateStr = config?.basic.startDate || new Date().toISOString();
    const tourneyStart = new Date(startDateStr);
    return expDate < tourneyStart;
  }, [uscfExpiration, config]);

  const [searchTerm, setSearchTerm] = useState("");
  const [remoteResults, setRemoteResults] = useState<RatingLookupResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const playerSearchConfig = getFieldConfig(config, "playerSearch");
  const lookupSectionConfig = getFieldConfig(config, "lookupSection");

  useEffect(() => {
    if (!playerSearchConfig.visible) {
      form.setValue("lookupMode", "manual", { shouldDirty: false });
    }
  }, [playerSearchConfig.visible, form]);

  useEffect(() => {
    if (config?.registers?.strictAutofillOnly) {
      form.setValue("lookupMode", "profile", { shouldDirty: false });
    }
  }, [config?.registers?.strictAutofillOnly, form]);

  const numericRating = useMemo(
    () => derivePlayerRating(ratingProvider, uscfRatingValue, fideRatingValue, config?.details.primaryRatingSystem),
    [ratingProvider, uscfRatingValue, fideRatingValue, config?.details.primaryRatingSystem],
  );

  const sectionDetails = useMemo(
    () =>
      sections.map((section) => {
        const options = filterEntryFeesBySection(entryFees, section.name, sections);
        const primaryFee = options[0] ?? null;
        const label = primaryFee
          ? `${section.name} (${formatCurrency(primaryFee.amount, primaryFee.currency)})`
          : `${section.name} (TBD)`;
        return {
          ...section,
          entryFee: primaryFee,
          label,
        };
      }),
    [sections, entryFees],
  );

  useEffect(() => {
    if (sectionDetails.length === 0) return;
    const current = form.getValues("sectionChoice");
    if (current && sectionDetails.some((section) => section.name === current)) {
      return;
    }
    const fallback =
      numericRating !== null
        ? sectionDetails.find((section) => ratingWithinSectionRange(numericRating, section))
        : sectionDetails[0];
    if (fallback) {
      form.setValue("sectionChoice", fallback.name, { shouldDirty: false, shouldValidate: true });
    }
  }, [sectionDetails, form, numericRating]);

  useEffect(() => {
    if (numericRating === null) return;
    const current = form.getValues("sectionChoice");
    if (!current) return;
    const active = sectionDetails.find((section) => section.name === current);
    if (active && !ratingWithinSectionRange(numericRating, active)) {
      const fallback = sectionDetails.find((section) => ratingWithinSectionRange(numericRating, section));
      form.setValue("sectionChoice", fallback ? fallback.name : "", { shouldDirty: true, shouldValidate: true });
    }
  }, [numericRating, sectionDetails, form]);

  useEffect(() => {
    if (lookupMode !== "profile") {
      setRemoteResults([]);
      setIsSearching(false);
      setSearchError(null);
      return;
    }

    const term = searchTerm.trim();
    if (term.length < 3) {
      setRemoteResults([]);
      setIsSearching(false);
      return;
    }

    let cancelled = false;
    setIsSearching(true);
    setSearchError(null);

    const timeoutId = window.setTimeout(async () => {
      try {
        const params = new URLSearchParams({ 
          q: term, 
          limit: "10",
          uscfMinGamesThreshold: String(config?.registers?.uscfMinGamesThreshold ?? 4)
        });
        const response = (await apiRequest(`/api/rating-lookup?${params.toString()}`)) as RatingLookupResponse;
        if (cancelled) return;
        const combined = [...(response.uscf ?? []), ...(response.fide ?? [])];
        setRemoteResults(combined);
        const mergedErrors = response.errors
          ? Object.values(response.errors)
            .filter((value): value is string => Boolean(value && value.trim()))
            .join(" ")
          : "";
        setSearchError(mergedErrors && combined.length === 0 ? mergedErrors : null);
      } catch (error) {
        if (cancelled) return;
        setRemoteResults([]);
        setSearchError(error instanceof Error ? error.message : "Lookup failed");
      } finally {
        if (!cancelled) {
          setIsSearching(false);
        }
      }
    }, 350);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [lookupMode, searchTerm]);

  const rosterMatches = useMemo(() => {
    if (lookupMode !== "profile") return [] as Player[];
    const term = searchTerm.trim().toLowerCase();
    if (!term) return [] as Player[];
    return players.filter((player) => `${player.firstName} ${player.lastName}`.toLowerCase().includes(term));
  }, [lookupMode, players, searchTerm]);

  const handleSelectRosterPlayer = (player: Player) => {
    form.setValue("lookupMode", "profile", { shouldDirty: true });
    form.setValue("profileSelected", true, { shouldDirty: true });
    form.setValue("firstName", player.firstName, { shouldDirty: true, shouldValidate: true });
    form.setValue("lastName", player.lastName, { shouldDirty: true, shouldValidate: true });
    form.setValue("customAnswers.registryFirstName", player.firstName, { shouldDirty: true });
    form.setValue("customAnswers.registryLastName", player.lastName, { shouldDirty: true });
    if (player.rating) {
      const primarySystem = config?.details.primaryRatingSystem || "uscf";
      if (primarySystem === "fide") {
        form.setValue("fideRating", String(player.rating), { shouldDirty: true });
        form.setValue("ratingProvider", "fide", { shouldDirty: true });
      } else {
        form.setValue("uscfRating", String(player.rating), { shouldDirty: true });
        form.setValue("ratingProvider", "uscf", { shouldDirty: true });
      }
    }
    setSearchTerm(`${player.firstName} ${player.lastName}`.trim());
  };

  const handleSelectLookupResult = (result: RatingLookupResult) => {
    const { firstName, lastName } = splitName(result.name);
    form.setValue("lookupMode", "profile", { shouldDirty: true });
    form.setValue("profileSelected", true, { shouldDirty: true });
    form.setValue("firstName", firstName, { shouldDirty: true, shouldValidate: true });
    form.setValue("lastName", lastName, { shouldDirty: true, shouldValidate: true });
    form.setValue("customAnswers.registryFirstName", firstName, { shouldDirty: true });
    form.setValue("customAnswers.registryLastName", lastName, { shouldDirty: true });
    if (result.source === "uscf") {
      form.setValue("ratingProvider", "uscf", { shouldDirty: true });
      form.setValue("uscfId", result.id, { shouldDirty: true });
      form.setValue("uscfRating", result.ratingDisplay ?? result.rating ?? "", { shouldDirty: true });
      form.setValue("uscfRatingRaw", result.ratingRaw ?? result.ratingDisplay ?? result.rating ?? "", { shouldDirty: true });
      
      if (result.location) {
        const parts = result.location.split(",").map(s => s.trim());
        if (parts.length >= 2) {
          form.setValue("city", parts[0], { shouldDirty: true, shouldValidate: true });
          form.setValue("state", parts[1], { shouldDirty: true, shouldValidate: true });
        } else if (parts.length === 1 && parts[0].length === 2) {
          form.setValue("state", parts[0], { shouldDirty: true, shouldValidate: true });
          form.setValue("city", "", { shouldDirty: true });
        } else {
          form.setValue("city", parts[0], { shouldDirty: true, shouldValidate: true });
          form.setValue("state", "", { shouldDirty: true });
        }
      } else {
        form.setValue("state", "", { shouldDirty: true });
        form.setValue("city", "", { shouldDirty: true });
      }
      
      if (result.metadata?.expiration) {
        form.setValue("customAnswers.uscfExpiration", result.metadata.expiration, { shouldDirty: true });
      }
    } else {
      form.setValue("ratingProvider", "fide", { shouldDirty: true });
      form.setValue("fideId", result.id, { shouldDirty: true });
      form.setValue("fideRating", result.ratingDisplay ?? result.rating ?? "", { shouldDirty: true });
      form.setValue("fideRatingRaw", result.ratingRaw ?? result.ratingDisplay ?? result.rating ?? "", { shouldDirty: true });
      if (result.location) {
        form.setValue("country", result.location, { shouldDirty: false });
      }
      form.setValue("city", "", { shouldDirty: true });
      form.setValue("state", "", { shouldDirty: true });
    }
    setSearchTerm(result.name);
    setRemoteResults([]);
  };

  const lookupTitle = lookupSectionConfig.label || "Player Lookup";
  const lookupDescription = lookupSectionConfig.description || "Verify your rating profile";

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="border-b border-gray-100 bg-gray-50/50 px-6 py-5">
        <h2 className="text-lg font-semibold leading-tight text-gray-900">{lookupTitle}</h2>
        {lookupDescription && (
          <p className="text-sm text-gray-500 mt-0.5">{lookupDescription}</p>
        )}
      </div>

      <div className="space-y-8 p-6 sm:p-8">
        {playerSearchConfig.visible && !config?.registers?.strictAutofillOnly && (
          <RadioGroup
            value={lookupMode}
            onValueChange={(value) => {
              const newMode = value as RegistrationFormValues["lookupMode"];
              form.setValue("lookupMode", newMode, { shouldDirty: true });

              // If switching to manual, ensure fields are cleared so search results don't ghost
              if (newMode === "manual") {
                form.setValue("firstName", "", { shouldDirty: true });
                form.setValue("lastName", "", { shouldDirty: true });
                form.setValue("profileSelected", false, { shouldDirty: true });
                setSearchTerm("");
              }
            }}
          >
            <div className="flex flex-col gap-4 sm:flex-row">
              <RadioOption
                group="lookupMode"
                value="profile"
                title="Use saved profile"
                description="Search USCF and FIDE player lists."
              />
              {/* Hide manual entry when strict autofill is required */}
              {!config?.registers?.strictAutofillOnly && (
                <RadioOption
                  group="lookupMode"
                  value="manual"
                  title="Manual entry"
                  description="Enter all details yourself."
                />
              )}
            </div>
          </RadioGroup>
        )}

        {playerSearchConfig.visible && lookupMode === "profile" && (
          <div className="space-y-4">
            <Label className="text-sm font-medium text-slate-700">Search players</Label>
            <div className="relative">
              <Input
                value={searchTerm}
                onChange={(event) => {
                  setSearchTerm(event.target.value);
                  // Clear profileSelected if user clears the search field
                  if (!event.target.value.trim()) {
                    form.setValue("profileSelected", false, { shouldDirty: true });
                  }
                }}
                placeholder="Type name or ID (Min 3 chars)..."
                autoComplete="off"
                className="h-11 pl-10 pr-10 focus-visible:ring-blue-500/30"
              />
              <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            </div>

            {isSearching ? (
              <div className="my-2 flex flex-col items-center justify-center gap-3 py-8 rounded-lg border border-dashed border-slate-200 bg-slate-50/50">
                <Loader2 className="h-6 w-6 animate-spin text-blue-500" />
                <span className="text-sm font-medium text-slate-500">Searching USCF database...</span>
              </div>
            ) : (
              <>
                {searchTerm.trim().length < 3 ? (
                  <p className="text-xs text-slate-500">Enter at least three characters to search the USCF database.</p>
                ) : (
                  <p className="text-xs text-slate-500">
                    Showing the best matches from the official USCF player directory.
                  </p>
                )}
                {searchError && <p className="text-xs text-red-500">{searchError}</p>}
              </>
            )}

            {searchTerm.trim().length >= 3 && (remoteResults.length > 0 || rosterMatches.length > 0) && (
              <div className="space-y-5">
                {remoteResults.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-[11px] uppercase tracking-wide text-slate-500">USCF results</p>
                    <div className="max-h-52 space-y-2 overflow-y-auto pr-1">
                      {remoteResults.map((result) => (
                        <button
                          key={`${result.source}-${result.id}`}
                          type="button"
                          onClick={() => handleSelectLookupResult(result)}
                          className="group w-full rounded-lg border border-gray-200 bg-white p-4 text-left shadow-sm transition-all hover:bg-gray-50"
                        >
                          <div className="flex items-center justify-between gap-4">
                            <div className="flex items-center gap-3">
                              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gray-100 font-medium text-gray-500 transition group-hover:text-gray-900">
                                {result.source === 'uscf' ? 'US' : 'FI'}
                              </div>
                              <div className="space-y-0.5">
                                <p className="text-sm font-semibold text-gray-900">{result.name}</p>
                                <div className="flex flex-wrap items-center gap-2 text-[11px] text-gray-500">
                                  <span className="font-medium text-gray-600">{result.source.toUpperCase()} · #{result.id}</span>
                                  {result.location && <span className="text-gray-300">|</span>}
                                  {result.location && <span>{result.location}</span>}
                                </div>
                              </div>
                            </div>
                            <div className="bg-gray-900 text-white rounded px-2.5 py-1 text-xs font-medium">
                              {result.ratingDisplay ?? result.rating ?? "No Rating"}
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {rosterMatches.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-[11px] uppercase tracking-wide text-slate-500">Tournament roster matches</p>
                    <div className="max-h-48 space-y-2 overflow-y-auto pr-1">
                      {rosterMatches.map((player) => (
                        <button
                          key={player.id}
                          type="button"
                          onClick={() => handleSelectRosterPlayer(player)}
                          className="w-full rounded-lg border border-gray-200 bg-white p-3 text-left shadow-sm transition hover:bg-gray-50"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <p className="text-sm font-semibold text-slate-900">
                                {player.firstName} {player.lastName}
                              </p>
                              <p className="text-[11px] text-slate-500">Registered for this event</p>
                            </div>
                            {player.rating !== null && player.rating !== undefined && (
                              <span className="text-sm font-medium text-slate-700">{player.rating}</span>
                            )}
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        <div className="space-y-3">
          {getFieldConfig(config, "playerIdentityHeading").visible !== false && (
            <h3 className="text-base font-bold text-slate-900 tracking-tight">
              {getFieldConfig(config, "playerIdentityHeading").label || "Player Identity"}
              {config?.registers?.strictAutofillOnly && (
                <span className="ml-1.5 text-[11px] font-normal text-sky-600">(Profile search autofill required)</span>
              )}
            </h3>
          )}
          <div className="grid gap-5 sm:grid-cols-2">
            {getFieldConfig(config, "firstName").visible && (
              <Field
                label={getFieldConfig(config, "firstName").label}
                name="firstName"
                required={getFieldConfig(config, "firstName").required}
                placeholder={getFieldConfig(config, "firstName").placeholder}
                description={getFieldConfig(config, "firstName").description}
                disabled={Boolean(config?.registers?.strictAutofillOnly)}
              />
            )}
            {getFieldConfig(config, "lastName").visible && (
              <Field
                label={getFieldConfig(config, "lastName").label}
                name="lastName"
                required={getFieldConfig(config, "lastName").required}
                placeholder={getFieldConfig(config, "lastName").placeholder}
                description={getFieldConfig(config, "lastName").description}
                disabled={Boolean(config?.registers?.strictAutofillOnly)}
              />
            )}
            {getFieldConfig(config, "uscfId").visible && (
              <div className="space-y-3">
                <Field 
                  label={getFieldConfig(config, "uscfId").label} 
                  name="uscfId" 
                  required={getFieldConfig(config, "uscfId").required} 
                  placeholder={getFieldConfig(config, "uscfId").placeholder}
                  description={getFieldConfig(config, "uscfId").description}
                  disabled={Boolean(config?.registers?.strictAutofillOnly)}
                />
                {isExpired && getFieldConfig(config, "uscfId").settings?.provideRenewalLink !== false && (
                  <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-4 text-xs text-amber-800 space-y-2 shadow-sm animate-in fade-in slide-in-from-top-1 duration-200">
                    <div className="flex items-start gap-2.5 font-sans">
                      <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                      <div className="space-y-1">
                        <p className="font-bold">USCF Membership Expired / Expiring</p>
                        <p className="text-amber-700 font-medium">
                          Your USCF membership expires on <strong className="text-amber-900">{uscfExpiration}</strong>, which is before the tournament start date.
                        </p>
                      </div>
                    </div>
                    <div className="pl-6.5">
                      <a
                        href="https://new.uschess.org/join-us-or-renew"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 font-bold text-amber-950 hover:text-amber-900 underline underline-offset-2 hover:no-underline transition-all"
                      >
                        Renew Membership on US Chess <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>
                  </div>
                )}
              </div>
            )}
            {getFieldConfig(config, "fideId").visible && (
              <Field 
                label={getFieldConfig(config, "fideId").label} 
                name="fideId" 
                required={getFieldConfig(config, "fideId").required} 
                placeholder={getFieldConfig(config, "fideId").placeholder}
                description={getFieldConfig(config, "fideId").description}
                disabled={Boolean(config?.registers?.strictAutofillOnly)}
              />
            )}
            {config?.details.primaryRatingSystem === "fide" ? (
              <>
                {getFieldConfig(config, "fideRating").visible && (
                  <Field
                    label={getFieldConfig(config, "fideRating").label || "FIDE rating (Primary)"}
                    name="fideRating"
                    disabled={Boolean(config?.registers?.strictAutofillOnly)}
                  />
                )}
                {getFieldConfig(config, "uscfRating").visible && (
                  <UscfRatingField disabled={Boolean(config?.registers?.strictAutofillOnly)} />
                )}
              </>
            ) : (
              <>
                {getFieldConfig(config, "uscfRating").visible && (
                  <UscfRatingField disabled={Boolean(config?.registers?.strictAutofillOnly)} />
                )}
                {getFieldConfig(config, "fideRating").visible && (
                  <Field
                    label={getFieldConfig(config, "fideRating").label || "FIDE rating"}
                    name="fideRating"
                    disabled={Boolean(config?.registers?.strictAutofillOnly)}
                  />
                )}
              </>
            )}
            {getFieldConfig(config, "city").visible && (
              <Field
                label={getFieldConfig(config, "city").label}
                name="city"
                required={getFieldConfig(config, "city").required}
                placeholder={getFieldConfig(config, "city").placeholder}
                description={getFieldConfig(config, "city").description}
              />
            )}
            {getFieldConfig(config, "state").visible && (
              <Field
                label={getFieldConfig(config, "state").label}
                name="state"
                required={getFieldConfig(config, "state").required}
                placeholder={getFieldConfig(config, "state").placeholder}
                description={getFieldConfig(config, "state").description}
              />
            )}
          </div>
        </div>

        {(getFieldConfig(config, "email").visible || getFieldConfig(config, "ratingProvider").visible) && (
          <div className="space-y-3 pt-2">
            {getFieldConfig(config, "contactInfoHeading").visible !== false && (
              <h3 className="text-base font-bold text-slate-900 tracking-tight">
                {getFieldConfig(config, "contactInfoHeading").label || "Contact Information"}
              </h3>
            )}
            <div className="grid gap-5 sm:grid-cols-2">
              {getFieldConfig(config, "email").visible && (
                <Field
                  label={getFieldConfig(config, "email").label}
                  name="email"
                  required={getFieldConfig(config, "email").required}
                  placeholder={getFieldConfig(config, "email").placeholder}
                  description={getFieldConfig(config, "email").description}
                  valueAs="email"
                />
              )}
              {getFieldConfig(config, "ratingProvider").visible && (
                <div className="space-y-2">
                  <Label className="text-sm font-medium text-slate-700">
                    {getFieldConfig(config, "ratingProvider").label}
                    {getFieldConfig(config, "ratingProvider").required && <span className="ml-1 text-red-500">*</span>}
                  </Label>
                  <Select
                    onValueChange={(value) =>
                      form.setValue("ratingProvider", value as RegistrationFormValues["ratingProvider"], { shouldDirty: true })
                    }
                    value={form.watch("ratingProvider") ?? "none"}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select rating provider" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No rating</SelectItem>
                      <SelectItem value="uscf">USCF</SelectItem>
                      <SelectItem value="fide">FIDE</SelectItem>
                      <SelectItem value="manual">Manual</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          </div>
        )}

        {extraFields.length > 0 && (
          <div className="space-y-4 border-t border-slate-100 pt-6">
            <h3 className="text-base font-bold text-slate-900 tracking-tight">Additional Information</h3>
            <div className="grid gap-5 sm:grid-cols-2">
              {extraFields.map((field) => {
                const isCustom = field.isCustom;
                const path = isCustom ? `customAnswers.${field.id}` : field.id;

                // --- SPECIAL FIELD: FIDE TITLE SELECT DROPDOWN ---
                if (field.id === "fideTitle") {
                  const error = isCustom 
                    ? form.formState.errors.customAnswers?.[field.id] 
                    : form.formState.errors[field.id as keyof RegistrationFormValues];
                  const val = form.watch(path as any) ?? "";
                  const titleOptions = ["None", "GM", "IM", "FM", "CM", "WGM", "WIM", "WFM", "WCM"];
                  
                  return (
                    <div key={field.id} className="group space-y-2 col-span-1">
                      <Label className="text-sm font-semibold text-slate-700 transition-colors group-focus-within:text-blue-700">
                        {field.label}
                        {field.required && <span className="ml-1 text-red-500">*</span>}
                      </Label>
                      <Select
                        value={val || "None"}
                        onValueChange={(value) => form.setValue(path as any, value === "None" ? "" : value, { shouldDirty: true, shouldValidate: true })}
                      >
                        <SelectTrigger className="bg-white border-slate-200 focus:ring-blue-200 focus:border-blue-400">
                          <SelectValue placeholder={field.placeholder || "Select FIDE Title"} />
                        </SelectTrigger>
                        <SelectContent>
                          {titleOptions.map((title) => (
                            <SelectItem key={title} value={title}>
                              {title}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {field.description && (
                        <p className="text-[11px] text-slate-400 leading-normal mt-0.5">{field.description}</p>
                      )}
                      {error && (
                        <p className="text-xs text-red-500">{error.message as string}</p>
                      )}
                    </div>
                  );
                }

                // --- SPECIAL FIELD: SCHOLASTIC GRADE DROPDOWN ---
                if (field.id === "scholasticGrade") {
                  const error = isCustom 
                    ? form.formState.errors.customAnswers?.[field.id] 
                    : form.formState.errors[field.id as keyof RegistrationFormValues];
                  const val = form.watch(path as any) ?? "";

                  const allGrades = [
                    "Pre-Kindergarten", "Kindergarten", "1st Grade", "2nd Grade", 
                    "3rd Grade", "4th Grade", "5th Grade", "6th Grade", 
                    "7th Grade", "8th Grade", "9th Grade", "10th Grade", 
                    "11th Grade", "12th Grade"
                  ];
                  
                  const gradeMin = typeof field.settings?.gradeMin === "number" ? field.settings.gradeMin : 0;
                  const gradeMax = typeof field.settings?.gradeMax === "number" ? field.settings.gradeMax : 13;
                  const filteredGrades = allGrades.slice(gradeMin, gradeMax + 1);

                  return (
                    <div key={field.id} className="group space-y-2 col-span-1">
                      <Label className="text-sm font-semibold text-slate-700 transition-colors group-focus-within:text-blue-700">
                        {field.label}
                        {field.required && <span className="ml-1 text-red-500">*</span>}
                      </Label>
                      <Select
                        value={val}
                        onValueChange={(value) => form.setValue(path as any, value, { shouldDirty: true, shouldValidate: true })}
                      >
                        <SelectTrigger className="bg-white border-slate-200 focus:ring-blue-200 focus:border-blue-400">
                          <SelectValue placeholder={field.placeholder || "Select grade level"} />
                        </SelectTrigger>
                        <SelectContent>
                          {filteredGrades.map((grade) => (
                            <SelectItem key={grade} value={grade}>
                              {grade}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {field.description && (
                        <p className="text-[11px] text-slate-400 leading-normal mt-0.5">{field.description}</p>
                      )}
                      {error && (
                        <p className="text-xs text-red-500">{error.message as string}</p>
                      )}
                    </div>
                  );
                }

                // --- SPECIAL FIELD: MEMBERSHIP PROOF UPLOAD ---
                if (field.id === "membershipProof") {
                  const error = isCustom 
                    ? form.formState.errors.customAnswers?.[field.id] 
                    : form.formState.errors[field.id as keyof RegistrationFormValues];
                  const uploadedFile = form.watch(path as any);
                  
                  return (
                    <div key={field.id} className="col-span-2 space-y-2">
                      <Label className="text-sm font-semibold text-slate-700">
                        {field.label}
                        {field.required && <span className="ml-1 text-red-500">*</span>}
                      </Label>
                      <div 
                        className={cn(
                          "flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-6 text-center transition-all",
                          uploadedFile 
                            ? "border-emerald-300 bg-emerald-50/20" 
                            : "border-slate-200 bg-slate-50/30 hover:bg-slate-50 hover:border-blue-300"
                        )}
                      >
                        {uploadedFile ? (
                          <div className="space-y-2">
                            <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
                              <Check className="h-5 w-5" />
                            </div>
                            <div>
                              <p className="text-sm font-semibold text-slate-900">Proof uploaded successfully</p>
                              <p className="text-xs text-slate-500">{uploadedFile}</p>
                            </div>
                            <button
                              type="button"
                              onClick={() => form.setValue(path as any, "", { shouldDirty: true, shouldValidate: true })}
                              className="text-xs font-bold text-red-500 hover:text-red-700"
                            >
                              Remove file
                            </button>
                          </div>
                        ) : (
                          <div className="space-y-2">
                            <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-slate-400">
                              <Info className="h-5 w-5" />
                            </div>
                            <div>
                              <p className="text-sm text-slate-700">
                                Drag and drop your file here, or{" "}
                                <button
                                  type="button"
                                  onClick={() => form.setValue(path as any, "simulated_membership_card.pdf", { shouldDirty: true, shouldValidate: true })}
                                  className="font-bold text-blue-600 hover:text-blue-800"
                                >
                                  browse files
                                </button>
                              </p>
                              <p className="text-xs text-slate-500 mt-1">PDF, JPG, or PNG (Max 5MB)</p>
                            </div>
                          </div>
                        )}
                      </div>
                      {field.description && (
                        <p className="text-[11px] text-slate-400 leading-normal mt-1">{field.description}</p>
                      )}
                      {error && (
                        <p className="mt-1 text-xs text-red-500">{error.message as string}</p>
                      )}
                    </div>
                  );
                }

                // --- SPECIAL FIELD: CLUB SELECT DROP DOWN ---
                if (field.id === "club") {
                  const error = isCustom 
                    ? form.formState.errors.customAnswers?.[field.id] 
                    : form.formState.errors[field.id as keyof RegistrationFormValues];
                  const val = form.watch(path as any) ?? "";
                  
                  const isSelectStyle = field.settings?.inputStyle === "select";
                  const preApprovedClubs = field.settings?.clubPreApprovedList ?? [];

                  if (isSelectStyle && preApprovedClubs.length > 0) {
                    return (
                      <div key={field.id} className="group space-y-2 col-span-1">
                        <Label className="text-sm font-semibold text-slate-700 transition-colors group-focus-within:text-blue-700">
                          {field.label}
                          {field.required && <span className="ml-1 text-red-500">*</span>}
                        </Label>
                        <Select
                          value={val}
                          onValueChange={(value) => form.setValue(path as any, value, { shouldDirty: true, shouldValidate: true })}
                        >
                          <SelectTrigger className="bg-white border-slate-200 focus:ring-blue-200 focus:border-blue-400">
                            <SelectValue placeholder={field.placeholder || "Select your club"} />
                          </SelectTrigger>
                          <SelectContent>
                            {preApprovedClubs.map((clubName: string) => (
                              <SelectItem key={clubName} value={clubName}>
                                {clubName}
                              </SelectItem>
                            ))}
                            <SelectItem value="Other / None">Other / None</SelectItem>
                          </SelectContent>
                        </Select>
                        {field.description && (
                          <p className="text-[11px] text-slate-400 leading-normal mt-0.5">{field.description}</p>
                        )}
                        {error && (
                          <p className="text-xs text-red-500">{error.message as string}</p>
                        )}
                      </div>
                    );
                  }
                }

                // --- SPECIAL FIELD: PARENT CONTACT CARD ---
                if (field.id === "parentContact") {
                  const parentName = form.watch("customAnswers.parentContactName") ?? "";
                  const parentPhone = form.watch("customAnswers.parentContactPhone") ?? "";
                  const parentRelationship = form.watch("customAnswers.parentContactRelationship") ?? "";
                  
                  return (
                    <div key={field.id} className="col-span-2 rounded-xl border border-slate-200 bg-slate-50/50 p-5 space-y-4">
                      <div>
                        <Label className="text-sm font-bold text-slate-950">
                          {field.label}
                          {field.required && <span className="ml-1 text-red-500">*</span>}
                        </Label>
                        {field.description && (
                          <p className="text-xs text-slate-500 mt-1">{field.description}</p>
                        )}
                      </div>
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div className="space-y-1.5">
                          <Label className="text-xs font-semibold text-slate-700">Contact Name</Label>
                          <Input
                            placeholder="First and Last Name"
                            className="bg-white border-slate-200 focus:border-blue-450"
                            value={parentName}
                            onChange={(e) => {
                              form.setValue("customAnswers.parentContactName", e.target.value, { shouldDirty: true });
                              form.setValue("customAnswers.parentContact", `${e.target.value} (${parentRelationship}) - ${parentPhone}`.trim(), { shouldDirty: true, shouldValidate: true });
                            }}
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-xs font-semibold text-slate-700">Relationship</Label>
                          <Input
                            placeholder="e.g. Mother, Father, Guardian"
                            className="bg-white border-slate-200 focus:border-blue-450"
                            value={parentRelationship}
                            onChange={(e) => {
                              form.setValue("customAnswers.parentContactRelationship", e.target.value, { shouldDirty: true });
                              form.setValue("customAnswers.parentContact", `${parentName} (${e.target.value}) - ${parentPhone}`.trim(), { shouldDirty: true, shouldValidate: true });
                            }}
                          />
                        </div>
                        <div className="col-span-2 space-y-1.5">
                          <Label className="text-xs font-semibold text-slate-700">Contact Phone / Email</Label>
                          <Input
                            placeholder="(555) 000-0000 or email@example.com"
                            className="bg-white border-slate-200 focus:border-blue-450"
                            value={parentPhone}
                            onChange={(e) => {
                              form.setValue("customAnswers.parentContactPhone", e.target.value, { shouldDirty: true });
                              form.setValue("customAnswers.parentContact", `${parentName} (${parentRelationship}) - ${e.target.value}`.trim(), { shouldDirty: true, shouldValidate: true });
                            }}
                          />
                        </div>
                      </div>
                    </div>
                  );
                }

                // --- HEADING / TEXT BLOCK ---
                if (field.type === "heading") {
                  return (
                    <div key={field.id} className="col-span-2 space-y-1 pt-4">
                      <h3 className="text-base font-bold text-slate-900 tracking-tight">{field.label}</h3>
                      {field.description && (
                        <p className="text-xs text-slate-500 leading-normal">{field.description}</p>
                      )}
                    </div>
                  );
                }

                // --- SELECT ---
                if (field.type === "select") {
                  const val = form.watch(path as any) ?? "";
                  const selectOptions = field.options ?? [];
                  const error = isCustom 
                    ? form.formState.errors.customAnswers?.[field.id] 
                    : form.formState.errors[field.id as keyof RegistrationFormValues];

                  return (
                    <div key={field.id} className="group space-y-2 col-span-1">
                      <Label className="text-sm font-medium text-slate-700 transition-colors group-focus-within:text-blue-700">
                        {field.label}
                        {field.required && <span className="ml-1 text-red-500">*</span>}
                      </Label>
                      <Select
                        value={val}
                        onValueChange={(value) => form.setValue(path as any, value, { shouldDirty: true, shouldValidate: true })}
                      >
                        <SelectTrigger className="bg-white border-slate-200 focus:ring-blue-200 focus:border-blue-400">
                          <SelectValue placeholder={field.placeholder || `Select ${field.label}`} />
                        </SelectTrigger>
                        <SelectContent>
                          {selectOptions.map((opt: any) => (
                            <SelectItem key={opt} value={opt}>
                              {opt}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {field.description && (
                        <p className="text-[11px] text-slate-400 leading-normal mt-0.5">{field.description}</p>
                      )}
                      {error && (
                        <p className="text-xs text-red-500">{error.message as string}</p>
                      )}
                    </div>
                  );
                }

                // --- CHECKBOX ---
                if (field.type === "boolean") {
                  const checked = form.watch(path as any) ?? false;
                  return (
                    <div 
                      key={field.id} 
                      className={cn(
                        "flex items-start gap-4 rounded-xl border p-5 transition-all group col-span-2 shadow-sm cursor-pointer",
                        checked
                          ? "border-blue-300 bg-blue-50/40 hover:bg-blue-50/60"
                          : "border-slate-200 bg-slate-50/50 hover:bg-white hover:shadow-md hover:border-blue-200"
                      )}
                      onClick={() => form.setValue(path as any, !checked, { shouldDirty: true, shouldValidate: true })}
                    >
                      <input
                        id={field.id}
                        type="checkbox"
                        className="mt-1 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                        checked={checked}
                        onChange={(event) => {
                          event.stopPropagation();
                          form.setValue(path as any, event.target.checked, { shouldDirty: true, shouldValidate: true });
                        }}
                      />
                      <div className="space-y-1">
                        <Label htmlFor={field.id} className="text-sm font-bold text-slate-900 cursor-pointer select-none">
                          {field.label}
                          {field.required && <span className="ml-1 text-red-500">*</span>}
                        </Label>
                        {field.description && (
                          <p className="text-xs leading-relaxed text-slate-500 select-none">
                            {field.description}
                          </p>
                        )}
                      </div>
                    </div>
                  );
                }

                // --- TEXT / NUMBER FALLBACK ---
                return (
                  <div key={field.id} className="col-span-1">
                    <Field
                      label={field.label}
                      name={path}
                      required={field.required}
                      placeholder={field.placeholder || `Enter ${field.label}...`}
                      type={field.type === "number" ? "number" : "text"}
                      description={isCustom ? field.description : undefined}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

