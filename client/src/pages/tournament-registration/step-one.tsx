import React, { useState, useEffect, useMemo } from "react";
import { useFormContext } from "react-hook-form";
import { Search, Loader2 } from "lucide-react";
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

export default function StepOne({
  config,
  players,
  sections,
  entryFees,
}: {
  config: ReturnType<typeof parseTournamentConfig> | null;
  players: Player[];
  sections: SectionOption[];
  entryFees: EntryFeeRule[];
}) {
  const form = useFormContext<RegistrationFormValues>();
  const lookupMode = form.watch("lookupMode");
  const ratingProvider = form.watch("ratingProvider");
  const uscfRatingValue = form.watch("uscfRating");
  const fideRatingValue = form.watch("fideRating");
  const [searchTerm, setSearchTerm] = useState("");
  const [remoteResults, setRemoteResults] = useState<RatingLookupResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

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
        const params = new URLSearchParams({ q: term, limit: "10" });
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
    form.setValue("firstName", player.firstName, { shouldDirty: true, shouldValidate: true });
    form.setValue("lastName", player.lastName, { shouldDirty: true, shouldValidate: true });
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
    form.setValue("firstName", firstName, { shouldDirty: true, shouldValidate: true });
    form.setValue("lastName", lastName, { shouldDirty: true, shouldValidate: true });
    if (result.source === "uscf") {
      form.setValue("ratingProvider", "uscf", { shouldDirty: true });
      form.setValue("uscfId", result.id, { shouldDirty: true });
      form.setValue("uscfRating", result.ratingDisplay ?? result.rating ?? "", { shouldDirty: true });
      if (result.location) {
        form.setValue("state", result.location, { shouldDirty: false });
      }
      if (result.metadata?.expiration) {
        form.setValue("customAnswers.uscfExpiration", result.metadata.expiration, { shouldDirty: true });
      }
    } else {
      form.setValue("ratingProvider", "fide", { shouldDirty: true });
      form.setValue("fideId", result.id, { shouldDirty: true });
      form.setValue("fideRating", result.ratingDisplay ?? result.rating ?? "", { shouldDirty: true });
      if (result.location) {
        form.setValue("country", result.location, { shouldDirty: false });
      }
    }
    setSearchTerm(result.name);
    setRemoteResults([]);
  };

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="flex items-center gap-4 border-b border-gray-100 bg-gray-50/50 px-6 py-5">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-white border border-gray-200 shadow-sm">
          <Search className="h-5 w-5 text-gray-600" />
        </div>
        <div>
          <h2 className="text-lg font-semibold leading-tight text-gray-900">Player Lookup</h2>
          <p className="text-sm text-gray-500">Step 1 of 3: Identity & Verification</p>
        </div>
      </div>

      <div className="space-y-8 p-6 sm:p-8">
        <RadioGroup
          value={lookupMode}
          onValueChange={(value) => {
            const newMode = value as RegistrationFormValues["lookupMode"];
            form.setValue("lookupMode", newMode, { shouldDirty: true });

            // If switching to manual, ensure fields are cleared so search results don't ghost
            if (newMode === "manual") {
              form.setValue("firstName", "", { shouldDirty: true });
              form.setValue("lastName", "", { shouldDirty: true });
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
            <RadioOption
              group="lookupMode"
              value="manual"
              title="Manual entry"
              description="Enter all details yourself."
            />
          </div>
        </RadioGroup>

        {lookupMode === "profile" && (
          <div className="space-y-4">
            <Label className="text-sm font-medium text-slate-700">Search players</Label>
            <div className="relative">
              <Input
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Type name or ID (Min 3 chars)..."
                autoComplete="off"
                className="h-11 pl-10 pr-10 focus-visible:ring-blue-500/30"
              />
              <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            </div>

            {isSearching ? (
              <div className="my-2 flex flex-col items-center justify-center gap-3 py-8 rounded-lg border border-dashed border-slate-200 bg-slate-50/50">
                <Loader2 className="h-6 w-6 animate-spin text-blue-500" />
                <span className="text-sm font-medium text-slate-500">Searching USCF & FIDE databases...</span>
              </div>
            ) : (
              <>
                {searchTerm.trim().length < 3 ? (
                  <p className="text-xs text-slate-500">Enter at least three characters to search both databases.</p>
                ) : (
                  <p className="text-xs text-slate-500">
                    Showing the best matches from the official USCF and FIDE player directories.
                  </p>
                )}
                {searchError && <p className="text-xs text-red-500">{searchError}</p>}
              </>
            )}

            {searchTerm.trim().length >= 3 && (remoteResults.length > 0 || rosterMatches.length > 0) && (
              <div className="space-y-5">
                {remoteResults.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-[11px] uppercase tracking-wide text-slate-500">USCF &amp; FIDE results</p>
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
          <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400">Player identity</p>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="First name" name="firstName" required />
            <Field label="Last name" name="lastName" required />
            {getFieldConfig(config, "uscfId").visible && (
              <Field 
                label={getFieldConfig(config, "uscfId").label} 
                name="uscfId" 
                required={getFieldConfig(config, "uscfId").required} 
                placeholder={getFieldConfig(config, "uscfId").placeholder}
                description={getFieldConfig(config, "uscfId").description}
              />
            )}
            {getFieldConfig(config, "fideId").visible && (
              <Field 
                label={getFieldConfig(config, "fideId").label} 
                name="fideId" 
                required={getFieldConfig(config, "fideId").required} 
                placeholder={getFieldConfig(config, "fideId").placeholder}
                description={getFieldConfig(config, "fideId").description}
              />
            )}
            {config?.details.primaryRatingSystem === "fide" ? (
              <>
                <Field label="FIDE rating (Primary)" name="fideRating" />
                <Field label="USCF rating" name="uscfRating" />
              </>
            ) : (
              <>
                <Field label="USCF rating (Primary)" name="uscfRating" />
                <Field label="FIDE rating" name="fideRating" />
              </>
            )}
          </div>
        </div>

        <div className="space-y-3 pt-2">
          <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400">Contact information</p>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Email" name="email" required valueAs="email" />

          </div>
        </div>

        <div className="space-y-3 pt-2">
          <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400">Section &amp; rating</p>
          <div className="grid gap-5 sm:grid-cols-2">
            <div>
              <Label className="text-sm font-medium text-slate-700">Preferred section</Label>
              <Select
                onValueChange={(value) => form.setValue("sectionChoice", value, { shouldDirty: true })}
                value={form.watch("sectionChoice") ?? ""}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Choose a section" />
                </SelectTrigger>
                <SelectContent>
                  {sectionDetails.length === 0 ? (
                    <SelectItem value="" disabled>
                      Sections will be announced soon
                    </SelectItem>
                  ) : (
                    sectionDetails.map((section) => {
                      const eligible = ratingWithinSectionRange(numericRating, section);
                      const showEligibilityWarning = numericRating !== null && !eligible;
                      return (
                        <SelectItem
                          key={section.id}
                          value={section.name}
                          disabled={showEligibilityWarning}
                          className={cn(
                            "flex flex-col items-start gap-1",
                            showEligibilityWarning && "opacity-45 text-slate-400",
                          )}
                        >
                          <span className="font-medium text-slate-900">{section.label}</span>
                          {(section.ratingMin !== null || section.ratingMax !== null) && (
                            <span className="text-xs text-slate-500">
                              {" · "}
                              {config?.details.primaryRatingSystem === "fide" ? "FIDE" : "USCF"} Rating:{" "}
                              {section.ratingMin ?? "Unrated"} – {section.ratingMax ?? "Open"}
                            </span>
                          )}
                          {showEligibilityWarning && numericRating !== null && (
                            <span className="text-[11px] text-blue-600">
                              Not eligible with {config?.details.primaryRatingSystem === "fide" ? "FIDE" : "USCF"} rating {numericRating}.
                            </span>
                          )}
                        </SelectItem>
                      );
                    })
                  )}
                </SelectContent>
              </Select>
              {form.formState.errors.sectionChoice && (
                <p className="mt-1 text-xs text-red-500">{form.formState.errors.sectionChoice.message}</p>
              )}
            </div>
            <div>
              <Label className="text-sm font-medium text-slate-700">Rating provider</Label>
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
          </div>
        </div>
      </div>
    </div>
  );
}

