import React, { useEffect, useMemo } from "react";
import { useFormContext } from "react-hook-form";
import { Info, HelpCircle, Trophy, AlertCircle, Check } from "lucide-react";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RadioOption, Field } from "./components";
import { cn } from "@/lib/utils";
import type { RegistrationFormValues, SectionOption, PaymentSettings, PaymentTotals } from "./types";
import { COUNTRY_OPTIONS } from "./types";
import {
  derivePlayerRating,
  filterEntryFeesBySection,
  ratingWithinSectionRange,
  formatCurrency,
  formatEntryFeeRange,
  findRecommendedEntryFee,
  getFieldConfig,
  buildArrivalNotes,
  toggleArrayValue,
  ratingWithinEntryFee,
  formatDate,
  NO_ENTRY_FEE_ID,
} from "./helpers";
import { DEFAULT_REGISTRATION_FIELDS } from "@/lib/tournament-config";
import type { parseTournamentConfig, EntryFeeRule, OfflinePaymentMethod } from "@/lib/tournament-config";

export default function StepTwo({
  config,
  entryFees,
  paymentSettings,
  sections,
  activeFields,
  pageIndex,
  totalPages,
}: {
  config: ReturnType<typeof parseTournamentConfig> | null;
  entryFees: EntryFeeRule[];
  paymentSettings: PaymentSettings | null;
  sections: SectionOption[];
  activeFields: any[];
  pageIndex: number;
  totalPages: number;
}) {
  const form = useFormContext<RegistrationFormValues>();
  const byePreference = form.watch("byePreference");
  const ratingProvider = form.watch("ratingProvider");
  const uscfRatingValue = form.watch("uscfRating");
  const fideRatingValue = form.watch("fideRating");
  const selectedSection = form.watch("sectionChoice");
  const selectedEntryFeeId = form.watch("entryFeeId");

  const numericRating = useMemo(
    () => derivePlayerRating(ratingProvider, uscfRatingValue, fideRatingValue, config?.details.primaryRatingSystem),
    [fideRatingValue, ratingProvider, uscfRatingValue, config?.details.primaryRatingSystem],
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
    if (!selectedSection) return;
    const current = sectionDetails.find((section) => section.name === selectedSection);
    if (current && !ratingWithinSectionRange(numericRating, current)) {
      const fallback = sectionDetails.find((section) => ratingWithinSectionRange(numericRating, section));
      form.setValue("sectionChoice", fallback ? fallback.name : "", { shouldDirty: true, shouldValidate: true });
    }
  }, [numericRating, selectedSection, sectionDetails, form]);

  const selectedSectionOption = useMemo(() => {
    if (!selectedSection) return undefined;
    const normalized = selectedSection.trim().toLowerCase();
    return sections.find((section) => section.name.trim().toLowerCase() === normalized);
  }, [selectedSection, sections]);

  const entryFeeOptions = useMemo(
    () => filterEntryFeesBySection(entryFees, selectedSection, sections),
    [entryFees, selectedSection, sections],
  );
  const contributionAllowed = paymentSettings?.allowProcessingContribution !== false;
  useEffect(() => {
    if (!contributionAllowed) {
      form.setValue("processingContribution", "0", { shouldDirty: false, shouldValidate: true });
    }
  }, [contributionAllowed, form]);

  const recommendedEntryFee = useMemo(
    () => findRecommendedEntryFee(entryFeeOptions, numericRating, sections, selectedSectionOption),
    [entryFeeOptions, numericRating, sections, selectedSectionOption],
  );

  useEffect(() => {
    if (entryFees.length === 0) {
      if (!form.getValues("entryFeeId")) {
        form.setValue("entryFeeId", NO_ENTRY_FEE_ID, { shouldDirty: false });
      }
      return;
    }
    if (entryFeeOptions.length === 0) {
      form.setValue("entryFeeId", NO_ENTRY_FEE_ID, { shouldDirty: false });
      return;
    }
    const current = form.getValues("entryFeeId");
    const fallback = recommendedEntryFee ?? entryFeeOptions[0];
    if (!current || !entryFeeOptions.some((fee) => fee.id === current)) {
      form.setValue("entryFeeId", fallback.id, { shouldDirty: false });
    }
  }, [entryFeeOptions, entryFees.length, form, recommendedEntryFee]);

  const byeRounds = useMemo(() => {
    const rounds = config?.details.rounds ?? 0;
    return Array.from({ length: rounds }, (_, index) => `Round ${index + 1}`);
  }, [config?.details.rounds]);

  const firstFieldIsSection = activeFields[0]?.type === "section";
  const pageTitle = firstFieldIsSection ? activeFields[0].label : "Tournament Options";
  const pageSubtitle = firstFieldIsSection
    ? (activeFields[0].description || "Preferences & Information")
    : "Step 2 of 3: Preferences & Details";
  const fieldsToRender = firstFieldIsSection ? activeFields.slice(1) : activeFields;

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="border-b border-gray-100 bg-gray-50/50 px-6 py-5">
        <h2 className="text-lg font-semibold leading-tight text-gray-900">{pageTitle}</h2>
        {pageSubtitle && (
          <p className="text-sm text-gray-500 mt-0.5">{pageSubtitle}</p>
        )}
      </div>

      <div className="space-y-8 p-6">
        {fieldsToRender.length > 0 && (
          <div className="grid gap-6 sm:grid-cols-2">
            {fieldsToRender.map((field: any) => {
              const isCustom = field.isCustom;
              const path = isCustom ? `customAnswers.${field.id}` : field.id;

              // --- SPECIAL FIELD: EMAIL WITH DOUBLE CONFIRMATION ENTRY ---
              if (field.id === "email") {
                const isDoubleEmail = field.settings?.doubleEntryCheck === true;
                const val = form.watch("email") ?? "";
                const confirmVal = form.watch("customAnswers.confirmEmail") ?? "";
                const emailError = form.formState.errors.email;
                const confirmError = form.formState.errors.customAnswers?.confirmEmail;

                return (
                  <div key={field.id} className={cn("grid gap-5 col-span-2", isDoubleEmail ? "sm:grid-cols-2" : "grid-cols-1")}>
                    <div className="space-y-2">
                      <Label className="text-sm font-semibold text-slate-700">
                        {field.label}
                        {field.required && <span className="ml-1 text-red-500">*</span>}
                      </Label>
                      <Input
                        type="email"
                        placeholder={field.placeholder || "email@example.com"}
                        className="bg-white border-slate-200 focus:ring-blue-200 focus:border-blue-400"
                        value={val}
                        onChange={(e) => form.setValue("email", e.target.value, { shouldDirty: true, shouldValidate: true })}
                      />
                      {field.description && (
                        <p className="text-[11px] text-slate-400 leading-normal mt-0.5">{field.description}</p>
                      )}
                      {emailError && (
                        <p className="text-xs text-red-500">{emailError.message as string}</p>
                      )}
                    </div>
                    {isDoubleEmail && (
                      <div className="space-y-2">
                        <Label className="text-sm font-semibold text-slate-700">
                          Confirm Email Address
                          <span className="ml-1 text-red-500">*</span>
                        </Label>
                        <Input
                          type="email"
                          placeholder="Retype email address"
                          className="bg-white border-slate-200 focus:ring-blue-200 focus:border-blue-400"
                          value={confirmVal}
                          onChange={(e) => form.setValue("customAnswers.confirmEmail", e.target.value, { shouldDirty: true, shouldValidate: true })}
                        />
                        <p className="text-[11px] text-slate-400 leading-normal mt-0.5">Please re-enter your email to verify it matches.</p>
                        {confirmError && (
                          <p className="text-xs text-red-500">{confirmError.message as string}</p>
                        )}
                      </div>
                    )}
                  </div>
                );
              }

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

              // --- SECTION CHOICE (PREFERRED SECTION) ---
              if (field.id === "sectionChoice") {
                return (
                  <div key={field.id} className="col-span-2 space-y-2">
                    <Label className="text-sm font-semibold text-slate-700">
                      {field.label}
                      {field.required && <span className="ml-1 text-red-500">*</span>}
                    </Label>
                    <Select
                      onValueChange={(value) => form.setValue("sectionChoice", value, { shouldDirty: true, shouldValidate: true })}
                      value={form.watch("sectionChoice") ?? ""}
                    >
                      <SelectTrigger className="bg-white border-slate-200 focus:ring-blue-200 focus:border-blue-400">
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
                );
              }

              // --- ENTRY FEE SELECTION ---
              if (field.id === "entryFee") {
                if (entryFees.length === 0) {
                  return (
                    <div key={field.id} className="col-span-2 rounded-lg border border-dashed border-blue-200 bg-blue-50/70 p-4 text-sm text-blue-700">
                      Entry fees will be confirmed by the tournament director. Continue to acknowledge payment on the next step.
                    </div>
                  );
                }
                if (entryFeeOptions.length === 0) {
                  return (
                    <div key={field.id} className="col-span-2 flex items-start gap-3 rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-700">
                      <AlertCircle className="h-4 w-4 shrink-0" />
                      <p>No pricing has been configured for the selected section. Please contact the director for assistance.</p>
                    </div>
                  );
                }
                return (
                  <div key={field.id} className="col-span-2 space-y-4">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <Label className="text-sm font-bold text-slate-900 tracking-tight">{field.label}</Label>
                        {isCustom && field.description && <p className="text-xs font-medium text-slate-500">{field.description}</p>}
                      </div>
                      <Badge variant="outline" className="w-fit border-blue-200 bg-blue-50/70 text-blue-800 font-bold px-3 py-1">
                        {numericRating !== null ? `Live Rating: ${numericRating}` : "Status: Unrated"}
                      </Badge>
                    </div>
                    <RadioGroup
                      value={selectedEntryFeeId ?? ""}
                      onValueChange={(value) => form.setValue("entryFeeId", value, { shouldDirty: true })}
                      className="grid gap-3 sm:grid-cols-2 animate-in fade-in duration-200"
                    >
                      {entryFeeOptions.map((fee) => {
                        const eligible = ratingWithinEntryFee(numericRating, fee, sections, selectedSectionOption);
                        const isRecommended = recommendedEntryFee?.id === fee.id;
                        const isSelected = selectedEntryFeeId === fee.id;
                        const effectiveAfterLabel = fee.effectiveAfter
                          ? `Effective after ${formatDate(fee.effectiveAfter)}`
                          : "Effective immediately";
                        return (
                          <label
                            key={fee.id}
                            htmlFor={`entry-fee-${fee.id}`}
                            className={cn(
                              "relative flex cursor-pointer flex-col gap-2 rounded-xl border p-5 transition-all shadow-sm ring-1 ring-inset ring-transparent",
                              isSelected
                                ? "border-blue-400 bg-blue-50/80 ring-blue-400/20 shadow-md"
                                : "border-slate-200 bg-white hover:border-blue-300 hover:bg-blue-50/30",
                            )}
                          >
                            <RadioGroupItem id={`entry-fee-${fee.id}`} value={fee.id} className="sr-only" />
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-sm font-semibold text-slate-900">{fee.section}</span>
                              <span className="text-sm font-semibold text-slate-900">
                                {formatCurrency(fee.amount, fee.currency)}
                              </span>
                            </div>
                            <p className="text-xs text-slate-500">{formatEntryFeeRange(fee, sections, selectedSectionOption)}</p>
                            <p className="text-[11px] text-slate-400">{effectiveAfterLabel}</p>
                            {fee.notes && <p className="text-xs text-slate-500">{fee.notes}</p>}
                            <div className="flex flex-wrap gap-2 pt-2">
                              {isRecommended && (
                                <Badge className="border-emerald-200 bg-emerald-50/80 text-emerald-700">Recommended</Badge>
                              )}
                              <Badge
                                variant="outline"
                                className={cn(
                                  "border text-xs",
                                  eligible
                                    ? "border-emerald-200 bg-emerald-50/70 text-emerald-700"
                                    : "border-blue-200 bg-blue-50/70 text-blue-700",
                                )}
                              >
                                {eligible ? "Matches rating" : "Director review required"}
                              </Badge>
                            </div>
                          </label>
                        );
                      })}
                    </RadioGroup>
                    {form.formState.errors.entryFeeId && (
                      <p className="text-xs text-red-500">{form.formState.errors.entryFeeId.message}</p>
                    )}
                  </div>
                );
              }

                // --- PAIRING NOTIFICATIONS ---
                if (field.id === "pairingNotifications") {
                  const error = form.formState.errors.pairingNotifications;
                  return (
                    <div key={field.id} className="group space-y-2 col-span-1">
                      <Label className="text-sm font-medium text-slate-700 transition-colors group-focus-within:text-blue-700 font-bold">
                        {field.label}
                        {field.required && <span className="ml-1 text-red-500">*</span>}
                      </Label>
                      <Select
                        value={form.watch("pairingNotifications") ?? "email"}
                        onValueChange={(value) =>
                          form.setValue("pairingNotifications", value as RegistrationFormValues["pairingNotifications"], {
                            shouldDirty: true,
                            shouldValidate: true,
                          })
                        }
                      >
                        <SelectTrigger className="bg-white border-slate-200 focus:ring-blue-200 focus:border-blue-400">
                          <SelectValue placeholder={field.placeholder || "Select preference"} />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">None</SelectItem>
                          <SelectItem value="push">Push notifications</SelectItem>
                          <SelectItem value="email">Email</SelectItem>
                          <SelectItem value="both">Both (Email & Push)</SelectItem>
                        </SelectContent>
                      </Select>
                      {field.description && (
                        <p className="text-[11px] text-slate-400 leading-normal mt-0.5">{field.description}</p>
                      )}
                      {error && (
                        <p className="text-xs text-red-500 mt-1">{error.message}</p>
                      )}
                    </div>
                  );
                }

                // --- BYE PREFERENCE ---
                if (field.id === "byePreference") {
                  if (config?.format === "arena" || config?.format === "knockout") return null;
                  return (
                    <div key={field.id} className="space-y-4 col-span-2">
                      <Label className="text-sm font-semibold text-slate-700">
                        {field.label}
                        {field.required && <span className="ml-1 text-red-500">*</span>}
                      </Label>
                      <RadioGroup
                        value={byePreference}
                        onValueChange={(value) =>
                          form.setValue("byePreference", value as RegistrationFormValues["byePreference"], {
                            shouldDirty: true,
                            shouldValidate: true,
                          })
                        }
                        className="grid gap-3 sm:grid-cols-2"
                      >
                        <RadioOption group="byePreference" value="none" title="No byes" description="I plan to play every round." />
                        <RadioOption group="byePreference" value="yes" title="Request byes" description="Select rounds you cannot attend." />
                      </RadioGroup>

                      {byePreference === "yes" && (
                        <div className="rounded-xl border border-slate-200 bg-slate-50/20 p-5 space-y-3 animate-in fade-in slide-in-from-top-1 duration-200">
                          <div className="flex items-center justify-between">
                            <Label className="text-sm font-semibold text-slate-700">Select eligible rounds</Label>
                            {(() => {
                              const byeField = config?.registrationFormConfig?.fields.find((f: any) => f.id === "byePreference");
                              const limit = byeField?.settings?.maxByesAllowed ?? config?.registers?.byeLimit;
                              const selected = form.watch("byeRounds") ?? [];
                              if (limit != null && selected.length >= limit) {
                                return (
                                  <span className="text-xs font-semibold text-amber-600 bg-amber-50 border border-amber-200 rounded-full px-2.5 py-0.5">
                                    Max {limit} bye{limit !== 1 ? "s" : ""} reached
                                  </span>
                                );
                              }
                              return null;
                            })()}
                          </div>
                          <div className="grid gap-3 sm:grid-cols-3">
                            {byeRounds.map((label, roundIdx) => {
                              const checked = form.watch("byeRounds")?.includes(label);
                              const totalRounds = config?.details.rounds ?? 0;
                              const isLastRound = roundIdx === totalRounds - 1;
                              const lastRoundBlocked = isLastRound && config?.registers?.allowLastRoundBye === false;
                              
                              const byeField = config?.registrationFormConfig?.fields.find((f: any) => f.id === "byePreference");
                              const lastRoundZeroPointBye = byeField?.settings?.lastRoundZeroPointBye === true;
                              const maxByesAllowed = byeField?.settings?.maxByesAllowed ?? config?.registers?.byeLimit;
                              
                              const selectedCount = (form.watch("byeRounds") ?? []).length;
                              const limitReached = maxByesAllowed != null && selectedCount >= maxByesAllowed && !checked;
                              const isDisabled = lastRoundBlocked || limitReached;
                              return (
                                <button
                                  key={label}
                                  type="button"
                                  disabled={isDisabled}
                                  onClick={() => !isDisabled && toggleArrayValue(form, "byeRounds", label)}
                                  className={cn(
                                    "flex flex-col items-start gap-1 justify-center rounded-xl border px-4 py-3 text-left text-sm font-medium transition-all shadow-sm active:scale-[0.98] min-h-[56px]",
                                    checked
                                      ? "border-blue-500 bg-blue-600 text-white shadow-md shadow-blue-100/50"
                                      : isDisabled
                                      ? "border-slate-200 bg-slate-100 text-slate-400 cursor-not-allowed opacity-60"
                                      : "border-slate-200 bg-white text-slate-600 hover:border-blue-200 hover:bg-blue-50/50",
                                  )}
                                >
                                  <div className="flex w-full items-center justify-between gap-1">
                                    <span className="font-semibold">{label}</span>
                                    {checked && <Check className="h-4 w-4 shrink-0" />}
                                  </div>
                                  {isLastRound && lastRoundZeroPointBye && (
                                    <span className={cn("text-[9px] font-bold mt-0.5", checked ? "text-blue-100" : "text-amber-600")}>
                                      0-point bye
                                    </span>
                                  )}
                                  {lastRoundBlocked && !checked && (
                                    <span className="text-[10px] font-bold text-slate-400">Not allowed</span>
                                  )}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}
                      {form.formState.errors.byePreference && (
                        <p className="mt-1 text-xs text-red-500">{form.formState.errors.byePreference.message}</p>
                      )}
                    </div>
                  );
                }

                // --- BOOLEAN (CHECKBOX CARD) ---
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
                        {isCustom && field.description && (
                          <p className="text-xs leading-relaxed text-slate-500 select-none">
                            {field.description}
                          </p>
                        )}
                      </div>
                    </div>
                  );
                }

                // --- NOTES (TEXTAREA) ---
                if (field.id === "notes") {
                  const error = form.formState.errors.notes;
                  return (
                    <div key={field.id} className="col-span-2 space-y-2">
                      <Label className="text-sm font-medium text-slate-700">
                        {field.label}
                        {field.required && <span className="ml-1 text-red-500">*</span>}
                      </Label>
                      <Textarea
                        className="mt-1 bg-white focus:border-blue-400 focus:ring-blue-200 min-h-24"
                        placeholder={field.placeholder || "Share any additional information, companions, or messages for the Director."}
                        {...form.register("notes")}
                      />
                      {isCustom && field.description && (
                        <p className="text-[11px] text-slate-400 leading-normal mt-1">{field.description}</p>
                      )}
                      {error && (
                        <p className="mt-1 text-xs text-red-500">{error.message}</p>
                      )}
                    </div>
                  );
                }

                // --- SELECT / DROPDOWN (including Country) ---
                if (field.type === "select" || field.id === "country") {
                  const val = form.watch(path as any) ?? (field.id === "country" ? "United States" : "");
                  const selectOptions = field.id === "country" ? COUNTRY_OPTIONS : (field.options ?? []);
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
                      {isCustom && field.description && (
                        <p className="text-[11px] text-slate-400 leading-normal mt-0.5">{field.description}</p>
                      )}
                      {error && (
                        <p className="text-xs text-red-500">{error.message as string}</p>
                      )}
                    </div>
                  );
                }

                // --- PARAGRAPH ---
                if (field.type === "paragraph") {
                  const error = isCustom 
                    ? form.formState.errors.customAnswers?.[field.id] 
                    : form.formState.errors[field.id as keyof RegistrationFormValues];
                  return (
                    <div key={field.id} className="col-span-2 space-y-2">
                      <Label className="text-sm font-medium text-slate-700 font-bold">
                        {field.label}
                        {field.required && <span className="ml-1 text-red-500">*</span>}
                      </Label>
                      <Textarea
                        className="mt-1 bg-white focus:border-blue-400 focus:ring-blue-200 min-h-24 font-semibold"
                        placeholder={field.placeholder || `Enter ${field.label}...`}
                        value={form.watch(path as any) ?? ""}
                        onChange={(e) => form.setValue(path as any, e.target.value, { shouldDirty: true, shouldValidate: true })}
                      />
                      {field.description && (
                        <p className="text-[11px] text-slate-400 leading-normal mt-1">{field.description}</p>
                      )}
                      {error && (
                        <p className="mt-1 text-xs text-red-500">{error.message as string}</p>
                      )}
                    </div>
                  );
                }

                // --- RADIO (MULTIPLE CHOICE) ---
                if (field.type === "radio") {
                  const val = form.watch(path as any) ?? "";
                  const options = field.options ?? [];
                  const error = isCustom 
                    ? form.formState.errors.customAnswers?.[field.id] 
                    : form.formState.errors[field.id as keyof RegistrationFormValues];
                  return (
                    <div key={field.id} className="col-span-2 space-y-2">
                      <Label className="text-sm font-medium text-slate-700 font-bold">
                        {field.label}
                        {field.required && <span className="ml-1 text-red-500">*</span>}
                      </Label>
                      <RadioGroup
                        value={val}
                        onValueChange={(value) => form.setValue(path as any, value, { shouldDirty: true, shouldValidate: true })}
                        className="flex flex-col gap-2 mt-1"
                      >
                        {options.map((opt: any) => (
                          <div key={opt} className="flex items-center gap-2">
                            <RadioGroupItem value={opt} id={`${field.id}-${opt}`} />
                            <Label htmlFor={`${field.id}-${opt}`} className="text-xs font-bold text-slate-700 cursor-pointer">{opt}</Label>
                          </div>
                        ))}
                      </RadioGroup>
                      {field.description && (
                        <p className="text-[11px] text-slate-400 leading-normal mt-1">{field.description}</p>
                      )}
                      {error && (
                        <p className="mt-1 text-xs text-red-500">{error.message as string}</p>
                      )}
                    </div>
                  );
                }

                // --- CHECKBOX (CHECKBOXES) ---
                if (field.type === "checkbox") {
                  const checkedValues: string[] = form.watch(path as any) ?? [];
                  const options = field.options ?? [];
                  const error = isCustom 
                    ? form.formState.errors.customAnswers?.[field.id] 
                    : form.formState.errors[field.id as keyof RegistrationFormValues];
                  const handleCheckboxChange = (opt: string, checked: boolean) => {
                    const next = checked ? [...checkedValues, opt] : checkedValues.filter(v => v !== opt);
                    form.setValue(path as any, next, { shouldDirty: true, shouldValidate: true });
                  };
                  return (
                    <div key={field.id} className="col-span-2 space-y-2">
                      <Label className="text-sm font-medium text-slate-700 font-bold">
                        {field.label}
                        {field.required && <span className="ml-1 text-red-500">*</span>}
                      </Label>
                      <div className="flex flex-col gap-2 mt-1">
                        {options.map((opt: any) => {
                          const isChecked = checkedValues.includes(opt);
                          return (
                            <label key={opt} className="flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer select-none">
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={(e) => handleCheckboxChange(opt, e.target.checked)}
                                className="rounded border-slate-350 text-blue-600 focus:ring-blue-500 h-4.5 w-4.5"
                              />
                              <span>{opt}</span>
                            </label>
                          );
                        })}
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

                // --- DATE ---
                if (field.type === "date") {
                  const error = isCustom 
                    ? form.formState.errors.customAnswers?.[field.id] 
                    : form.formState.errors[field.id as keyof RegistrationFormValues];
                  return (
                    <div key={field.id} className="col-span-1 space-y-2">
                      <Label className="text-sm font-medium text-slate-700 font-bold">
                        {field.label}
                        {field.required && <span className="ml-1 text-red-500">*</span>}
                      </Label>
                      <Input
                        type="date"
                        className="bg-white border-slate-200 focus:ring-blue-200 focus:border-blue-400"
                        value={form.watch(path as any) ?? ""}
                        onChange={(e) => form.setValue(path as any, e.target.value, { shouldDirty: true, shouldValidate: true })}
                      />
                      {field.description && (
                        <p className="text-[11px] text-slate-400 leading-normal mt-1">{field.description}</p>
                      )}
                      {error && (
                        <p className="mt-1 text-xs text-red-500">{error.message as string}</p>
                      )}
                    </div>
                  );
                }

                // --- TIME ---
                if (field.type === "time") {
                  const error = isCustom 
                    ? form.formState.errors.customAnswers?.[field.id] 
                    : form.formState.errors[field.id as keyof RegistrationFormValues];
                  return (
                    <div key={field.id} className="col-span-1 space-y-2">
                      <Label className="text-sm font-medium text-slate-700 font-bold">
                        {field.label}
                        {field.required && <span className="ml-1 text-red-500">*</span>}
                      </Label>
                      <Input
                        type="time"
                        className="bg-white border-slate-200 focus:ring-blue-200 focus:border-blue-400"
                        value={form.watch(path as any) ?? ""}
                        onChange={(e) => form.setValue(path as any, e.target.value, { shouldDirty: true, shouldValidate: true })}
                      />
                      {isCustom && field.description && (
                        <p className="text-[11px] text-slate-400 leading-normal mt-1">{field.description}</p>
                      )}
                      {error && (
                        <p className="mt-1 text-xs text-red-500">{error.message as string}</p>
                      )}
                    </div>
                  );
                }

               // --- TEXT / NUMBER FIELDS ---
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
        )}

        {/* Prize Payout Details */}
        {pageIndex === totalPages - 1 && config?.registers?.collectPrizePayoutDetails !== false && (
          <div className="space-y-4 border-t border-slate-100 pt-6 col-span-2">
            <div>
              <h3 className="text-sm font-bold text-slate-900 tracking-tight">Prize Payout Details (Zelle)</h3>
              <p className="text-xs text-slate-500 mt-1">
                Provide your Zelle contact information. The tournament director will use this if you win a cash prize.
              </p>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="prizeZelleEmail" className="text-xs font-semibold text-slate-700">Zelle Email Address</Label>
                <Input
                  id="prizeZelleEmail"
                  type="email"
                  placeholder="email@example.com"
                  {...form.register("customAnswers.prizeZelleEmail")}
                  className="bg-white border-slate-200 focus:ring-blue-200 focus:border-blue-400"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="prizeZellePhone" className="text-xs font-semibold text-slate-700">Zelle Phone Number</Label>
                <Input
                  id="prizeZellePhone"
                  type="tel"
                  placeholder="(555) 000-0000"
                  {...form.register("customAnswers.prizeZellePhone")}
                  className="bg-white border-slate-200 focus:ring-blue-200 focus:border-blue-400"
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const OFFLINE_METHOD_LABELS: Record<OfflinePaymentMethod, string> = {
  cash: "Cash",
  check: "Check",
  venmo: "Venmo",
  zelle: "Zelle",
  paypal: "PayPal",
  other: "Other",
};

type PaymentStatusKey = "unpaid" | "processing" | "paid" | "failed" | "refunded";

interface StepThreeProps {
  paymentDetails?: string | null;
  paymentSettings: PaymentSettings | null;
  paymentTotals: PaymentTotals;
  selectedEntryFee: EntryFeeRule | null;
  sections: SectionOption[];
  requiresPayment: boolean;
  onlineConfigured: boolean;
  clientSecret: string | null;
  registerPaymentHandler: (fn: (() => Promise<boolean>) | null) => void;
  setPaymentBusy: (busy: boolean) => void;
  onPaymentElementReady: (ready: boolean) => void;
  paymentIntentLoading: boolean;
  paymentIntentError: string | null;
  canAcceptOnlinePayment: boolean;
  tournamentId: number;
  retryPaymentIntent: () => void;
  playerDrafts?: Array<{ id: string; values: Partial<RegistrationFormValues> }>;
  onEditDraft?: (id: string) => void;
  onRemoveDraft?: (id: string) => void;
}

