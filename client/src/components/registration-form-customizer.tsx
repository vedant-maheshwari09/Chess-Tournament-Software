import React, { useState, useMemo, useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { 
  Settings,
  CheckSquare,
  ListPlus,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  Plus,
  Trash2,
  Sliders
} from "lucide-react";
import { 
  DEFAULT_REGISTRATION_FIELDS, 
  type RegistrationFormConfig, 
  type RegistrationFormField,
  type TournamentConfig,
  type RegistersConfig,
  type PaymentSettings
} from "@/lib/tournament-config";

interface RegistrationFormCustomizerProps {
  config: TournamentConfig;
  onConfigChange: (config: TournamentConfig) => void;
  actions?: React.ReactNode;
  tournamentSlug?: string;
  saveSuccessCount?: number;
  /** Unique channel key (e.g. tournament ID) used to broadcast live config to the preview tab */
  previewChannelId?: string | number;
}

interface FieldGroup {
  id: string;
  label: string;
  description: string;
  fieldIds: string[];
  alwaysVisible?: boolean;
  alwaysRequired?: boolean;
}

const FIELD_GROUPS: FieldGroup[] = [
  {
    id: "lookupSection",
    label: "Player Profile Lookup Section Header",
    description: "Show/hide the container section for Player Profile Lookup.",
    fieldIds: ["lookupSection"]
  },
  {
    id: "playerSearch",
    label: "Player Registry Search Input",
    description: "Allow players to search the USCF/FIDE database.",
    fieldIds: ["playerSearch"]
  },
  {
    id: "playerIdentityHeading",
    label: "Player Identity Section Header",
    description: "Show/hide the 'Player Identity' section heading.",
    fieldIds: ["playerIdentityHeading"]
  },
  {
    id: "name",
    label: "First & Last Name",
    description: "First and last name of the participant.",
    fieldIds: ["firstName", "lastName"]
  },
  {
    id: "uscfId",
    label: "USCF ID",
    description: "United States Chess Federation ID field.",
    fieldIds: ["uscfId"]
  },
  {
    id: "fideId",
    label: "FIDE ID",
    description: "World Chess Federation ID field.",
    fieldIds: ["fideId"]
  },
  {
    id: "fideTitle",
    label: "FIDE Title",
    description: "Your official FIDE title (if applicable). Allows fee waiving.",
    fieldIds: ["fideTitle"]
  },
  {
    id: "membershipProof",
    label: "Membership Card Copy",
    description: "Upload USCF/FIDE membership proof if verification fails.",
    fieldIds: ["membershipProof"]
  },
  {
    id: "club",
    label: "Chess Club",
    description: "Local chess club, school, or team federation.",
    fieldIds: ["club"]
  },
  {
    id: "teamCaptain",
    label: "Team Captain / Coach",
    description: "Name of school coach or team captain.",
    fieldIds: ["teamCaptain"]
  },
  {
    id: "boardNumber",
    label: "Board Number Assignment",
    description: "Board assignment for team-match events (1-4).",
    fieldIds: ["boardNumber"]
  },
  {
    id: "birthdate",
    label: "Birthdate",
    description: "Date of birth (required for age-restricted sections).",
    fieldIds: ["birthdate"]
  },
  {
    id: "scholasticGrade",
    label: "Scholastic Grade Level",
    description: "Grade level of student (Pre-K to 12th).",
    fieldIds: ["scholasticGrade"]
  },
  {
    id: "schoolName",
    label: "School Name",
    description: "School of representation (for team standings).",
    fieldIds: ["schoolName"]
  },
  {
    id: "sex",
    label: "Gender / Sex",
    description: "Gender option (required for gender-restricted sections).",
    fieldIds: ["sex"]
  },
  {
    id: "cityState",
    label: "City & State",
    description: "Demographic location details.",
    fieldIds: ["city", "state"]
  },
  {
    id: "contactInfoHeading",
    label: "Contact Info Section Header",
    description: "Show/hide the 'Contact Information' section heading.",
    fieldIds: ["contactInfoHeading"]
  },
  {
    id: "email",
    label: "Email Address",
    description: "Email for notifications and check-in confirmation.",
    fieldIds: ["email"]
  },
  {
    id: "parentContact",
    label: "Parent/Guardian Contact Details",
    description: "Emergency name and contact phone for juniors.",
    fieldIds: ["parentContact"]
  },
  {
    id: "phone",
    label: "Phone Number",
    description: "Contact number for text alerts or urgent updates.",
    fieldIds: ["phone"]
  },
  {
    id: "ratingProvider",
    label: "Rating Provider Selection",
    description: "Allows players to choose which federation rating to use.",
    fieldIds: ["ratingProvider"]
  },
  {
    id: "detailsSection",
    label: "Mailing Address Section Header",
    description: "Show/hide the mailing address section container.",
    fieldIds: ["detailsSection"]
  },
  {
    id: "address",
    label: "Mailing Address Fields",
    description: "Full address fields including country and zip.",
    fieldIds: ["address1", "address2", "postalCode", "country"]
  },
  {
    id: "preferencesSection",
    label: "Preferences Section Header",
    description: "Show/hide the 'Preferences & Options' section container.",
    fieldIds: ["preferencesSection"]
  },
  {
    id: "sectionChoice",
    label: "Preferred Section Selection",
    description: "Choose the section you want to play in.",
    fieldIds: ["sectionChoice"]
  },
  {
    id: "byes",
    label: "Bye Requests",
    description: "Allows players to choose bye rounds when registering.",
    fieldIds: ["byePreference"]
  },
  {
    id: "arrival",
    label: "Expected Arrival Time",
    description: "Helpful for check-in organization.",
    fieldIds: ["arrivalTime"]
  },
  {
    id: "notes",
    label: "Special Notes / Requests",
    description: "Additional requests, e.g., wheelchair accessibility.",
    fieldIds: ["notes"]
  },
  {
    id: "newsletter",
    label: "Receive Bulletins",
    description: "Opt-in to newsletter or future tournament bulletins.",
    fieldIds: ["newsletter"]
  },
  {
    id: "notifications",
    label: "Notification Preference",
    description: "Allows players to choose channel for pairing notifications.",
    fieldIds: ["pairingNotifications"]
  },
  {
    id: "checkoutSection",
    label: "Review & Submit Section Header",
    description: "Show/hide the 'Review & Submit' section container.",
    fieldIds: ["checkoutSection"]
  },
  {
    id: "paymentFlow",
    label: "Credit Card Payment Option",
    description: "Stripe payment element integration.",
    fieldIds: ["paymentFlow"]
  },
  {
    id: "entryFee",
    label: "Entry Fee Selection Tier",
    description: "Choose your entry fee tier.",
    fieldIds: ["entryFee"]
  }
];


export function RegistrationFormCustomizer({ config, onConfigChange, actions, tournamentSlug, previewChannelId }: RegistrationFormCustomizerProps) {
  const previewWindowRef = useRef<Window | null>(null);
  const broadcastRef = useRef<BroadcastChannel | null>(null);
  const [expandedGroupId, setExpandedGroupId] = useState<string | null>(null);

  // Open / maintain a BroadcastChannel for the lifetime of this component
  useEffect(() => {
    if (!previewChannelId) return;
    const ch = new BroadcastChannel(`reg-form-preview-${previewChannelId}`);
    broadcastRef.current = ch;
    return () => {
      ch.close();
      broadcastRef.current = null;
    };
  }, [previewChannelId]);

  // Broadcast every config change to the live preview tab
  useEffect(() => {
    if (!broadcastRef.current) return;
    broadcastRef.current.postMessage({ type: "CONFIG_UPDATE", config });
  }, [config]);

  const handleLivePreview = () => {
    const url = tournamentSlug
      ? `/tournaments/${tournamentSlug}/register?preview=1`
      : null;
    if (!url) return;

    // If the preview window is already open, just focus it; otherwise open a new one
    if (previewWindowRef.current && !previewWindowRef.current.closed) {
      previewWindowRef.current.focus();
    } else {
      previewWindowRef.current = window.open(url, `reg-preview-${previewChannelId}`);
    }

    // Broadcast the current config immediately so the newly-opened tab gets it
    setTimeout(() => {
      if (broadcastRef.current) {
        broadcastRef.current.postMessage({ type: "CONFIG_UPDATE", config });
      }
    }, 800);
  };
  // Parse or default the registration form configuration with migration for legacy system fields
  const formConfig = useMemo((): RegistrationFormConfig & { migratedToSystemFields?: boolean } => {
    const saved = config.registrationFormConfig;
    if (!saved) {
      return {
        fields: DEFAULT_REGISTRATION_FIELDS.map(f => ({ ...f })),
        migratedToSystemFields: true
      };
    }
    return saved;
  }, [config.registrationFormConfig]);

  // Persist migrated config to database if it was migrated in-memory
  React.useEffect(() => {
    if (config.registrationFormConfig?.migratedToSystemFields !== true && formConfig.migratedToSystemFields === true) {
      onConfigChange({
        ...config,
        registrationFormConfig: formConfig
      });
    }
  }, [config, formConfig, onConfigChange]);

  const updateFormConfig = (next: RegistrationFormConfig) => {
    onConfigChange({ 
      ...config, 
      registrationFormConfig: {
        ...next,
        migratedToSystemFields: true
      } 
    });
  };

  const handleFormHeaderChange = (key: "formTitle" | "formDescription", value: string) => {
    updateFormConfig({
      ...formConfig,
      [key]: value
    });
  };

  const handleRegistersChange = (key: keyof RegistersConfig, value: any) => {
    const extra = key === "allowSignup" ? { allowPlayerToJoin: value } : {};
    onConfigChange({
      ...config,
      registers: {
        ...config.registers,
        [key]: value,
        ...extra
      }
    });
  };

  const handlePaymentsChange = (key: keyof PaymentSettings, value: any) => {
    onConfigChange({
      ...config,
      payments: {
        ...config.payments,
        [key]: value
      }
    });
  };

  const toggleOfflineMethod = (method: string) => {
    const methods = config.payments?.acceptedOfflineMethods ?? [];
    const nextMethods = methods.includes(method as any)
      ? methods.filter(m => m !== method)
      : [...methods, method as any];
    handlePaymentsChange("acceptedOfflineMethods", nextMethods);
  };

  // Switch helpers for field groups
  const isGroupVisible = (group: FieldGroup) => {
    return group.fieldIds.some((id) => {
      const field = formConfig.fields.find((f) => f.id === id);
      return field?.visible ?? false;
    });
  };

  const isGroupRequired = (group: FieldGroup) => {
    return group.fieldIds.some((id) => {
      const field = formConfig.fields.find((f) => f.id === id);
      return field?.required ?? false;
    });
  };

  const canGroupBeRequired = (group: FieldGroup) => {
    return group.fieldIds.some((id) => {
      const field = formConfig.fields.find((f) => f.id === id);
      return field && field.type !== "section" && field.type !== "heading";
    });
  };

  const handleGroupVisibilityChange = (group: FieldGroup, checked: boolean) => {
    const nextFields = formConfig.fields.map((f) => {
      if (group.fieldIds.includes(f.id)) {
        return {
          ...f,
          visible: checked,
          required: checked ? f.required : false,
        };
      }
      return f;
    });

    updateFormConfig({ ...formConfig, fields: nextFields });
  };

  const handleGroupRequiredChange = (group: FieldGroup, checked: boolean) => {
    const nextFields = formConfig.fields.map((f) => {
      if (group.fieldIds.includes(f.id)) {
        return {
          ...f,
          required: checked,
          visible: checked ? true : f.visible,
        };
      }
      return f;
    });

    updateFormConfig({ ...formConfig, fields: nextFields });
  };

  const getGroupSettings = (group: FieldGroup): any => {
    const firstField = formConfig.fields.find(f => group.fieldIds.includes(f.id));
    return firstField?.settings ?? {};
  };

  const handleGroupSettingsChange = (group: FieldGroup, update: Partial<any> | ((prev: any) => any)) => {
    const nextFields = formConfig.fields.map((f) => {
      if (group.fieldIds.includes(f.id)) {
        const currentSettings = f.settings ?? {};
        const nextSettings = typeof update === "function" ? update(currentSettings) : { ...currentSettings, ...update };
        return {
          ...f,
          settings: nextSettings,
        };
      }
      return f;
    });
    updateFormConfig({ ...formConfig, fields: nextFields });
  };

  return (
    <div className="w-full space-y-6 max-w-4xl mx-auto font-sans relative">
      <div className="flex flex-wrap items-center justify-between gap-4 pb-2 border-b">
        <div className="space-y-0.5">
          <h3 className="text-xl font-extrabold tracking-tight text-slate-900">
            Form Registration Customizer
          </h3>
          <p className="text-xs font-semibold text-slate-500">
            Edit player registration forms and verification policies.
          </p>
        </div>
        {tournamentSlug && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleLivePreview}
            className="flex items-center gap-2 border-indigo-200 text-indigo-700 hover:bg-indigo-50 hover:border-indigo-300 font-semibold text-xs h-9 px-4 rounded-xl shadow-sm transition-all"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Live Preview
          </Button>
        )}
      </div>

      <div className="space-y-6 pb-24">
        {/* Information to Collect settings card */}
        <Card className="rounded-2xl border bg-white shadow-sm overflow-hidden">
          <CardHeader className="bg-slate-50/50 p-5 border-b">
            <CardTitle className="text-base font-extrabold text-slate-900 flex items-center gap-2">
              <ListPlus className="h-4.5 w-4.5 text-slate-500" />
              Information to Collect
            </CardTitle>
            <CardDescription className="text-xs font-semibold text-slate-500 font-sans">
              Choose what fields to display on the registration form and whether they are required.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {/* Custom Form Header & Subtitle */}
            <div className="p-5 bg-slate-50/25 border-b border-slate-100 space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label className="text-xs font-bold text-slate-700">Form Custom Title</Label>
                  <Input
                    type="text"
                    placeholder="e.g. American Open Registration Form"
                    value={formConfig.formTitle || ""}
                    onChange={(e) => handleFormHeaderChange("formTitle", e.target.value)}
                    className="bg-white border-slate-200 focus:ring-blue-200 text-xs font-medium h-9 rounded-xl"
                  />
                  <p className="text-[10px] text-slate-400 font-semibold">Custom header title displayed under the live registration wizard.</p>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-bold text-slate-700">Form Custom Subtitle / Description</Label>
                  <Input
                    type="text"
                    placeholder="e.g. Nov 26-29, 2026 · Los Angeles · 6 rounds"
                    value={formConfig.formDescription || ""}
                    onChange={(e) => handleFormHeaderChange("formDescription", e.target.value)}
                    className="bg-white border-slate-200 focus:ring-blue-200 text-xs font-medium h-9 rounded-xl"
                  />
                  <p className="text-[10px] text-slate-400 font-semibold">Custom subtitle text displayed below the title header.</p>
                </div>
              </div>
            </div>

            <div className="divide-y divide-slate-100">
              {/* Table header */}
              <div className="grid grid-cols-12 gap-4 px-6 py-3 bg-slate-50 text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                <div className="col-span-6 sm:col-span-8">Field Info</div>
                <div className="col-span-3 sm:col-span-2 text-center">Collect</div>
                <div className="col-span-3 sm:col-span-2 text-center">Required</div>
              </div>
              
              {FIELD_GROUPS.map((group) => {
                const visible = isGroupVisible(group);
                const required = isGroupRequired(group);
                const canBeRequired = canGroupBeRequired(group);
                const isExpanded = expandedGroupId === group.id;
                const gSettings = getGroupSettings(group);
                
                return (
                  <div key={group.id} className="border-b border-slate-100 last:border-b-0">
                    <div className="grid grid-cols-12 gap-4 px-6 py-4 items-center hover:bg-slate-50/40 transition-colors">
                      <div className="col-span-6 sm:col-span-8 flex items-start gap-2.5">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => setExpandedGroupId(isExpanded ? null : group.id)}
                          className="h-7 w-7 mt-0.5 rounded-md hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
                        >
                          {isExpanded ? (
                            <ChevronUp className="h-4 w-4" />
                          ) : (
                            <ChevronDown className="h-4 w-4" />
                          )}
                        </Button>
                        <div className="space-y-0.5 cursor-pointer flex-1" onClick={() => setExpandedGroupId(isExpanded ? null : group.id)}>
                          <div className="flex items-center gap-1.5">
                            <Label className="text-sm font-bold text-slate-800 cursor-pointer">{group.label}</Label>
                            {Object.keys(gSettings).length > 0 && (
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-indigo-50 text-indigo-600">
                                Configured
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-slate-500 leading-normal font-medium">{group.description}</p>
                        </div>
                      </div>
                      
                      <div className="col-span-3 sm:col-span-2 flex justify-center">
                        <Switch
                          checked={visible}
                          onCheckedChange={(val) => handleGroupVisibilityChange(group, val)}
                        />
                      </div>
                      
                      <div className="col-span-3 sm:col-span-2 flex justify-center">
                        {canBeRequired ? (
                          <Switch
                            checked={required}
                            disabled={!visible}
                            onCheckedChange={(val) => handleGroupRequiredChange(group, val)}
                          />
                        ) : (
                          <span className="text-slate-300 text-xs font-semibold select-none">–</span>
                        )}
                      </div>
                    </div>

                    {/* Expandable Drawer with nested sub-settings */}
                    {isExpanded && (
                      <div className="bg-slate-50/70 border-t border-slate-100 px-14 py-4 space-y-4 text-xs">
                        <h4 className="text-[10px] font-bold text-slate-500 flex items-center gap-1.5 uppercase tracking-wider mb-2">
                          <Sliders className="h-3 w-3 text-indigo-500" />
                          Advanced Chess Sub-Settings
                        </h4>
                        
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          {/* 1. Player Profile Lookup / Search Input */}
                          {(group.id === "lookupSection" || group.id === "playerSearch") && (
                            <div className="col-span-1 md:col-span-2 space-y-4">
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="space-y-1.5">
                                  <Label className="text-xs font-bold text-slate-700">Tournament Entry Type</Label>
                                  <Select
                                    value={config.registers?.entryRequirementType || "rated"}
                                    onValueChange={(val: "casual" | "rated") => {
                                      if (val === "casual") {
                                        onConfigChange({
                                          ...config,
                                          registers: {
                                            ...config.registers,
                                            entryRequirementType: "casual",
                                            verifyUscfMembership: false,
                                            uscfRated: false,
                                            fideRated: false,
                                            ratedSystem: undefined,
                                            strictAutofillOnly: false,
                                          }
                                        });
                                      } else {
                                        onConfigChange({
                                          ...config,
                                          registers: {
                                            ...config.registers,
                                            entryRequirementType: "rated",
                                            verifyUscfMembership: true,
                                            uscfRated: true,
                                            ratedSystem: "uscf",
                                            strictAutofillOnly: false,
                                          }
                                        });
                                      }
                                    }}
                                  >
                                    <SelectTrigger className="h-8 text-xs rounded-lg border-slate-200">
                                      <SelectValue placeholder="Choose entry type" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="casual">Casual / Unrated (No Verification)</SelectItem>
                                      <SelectItem value="rated">Official Rated (Requires Federation ID)</SelectItem>
                                    </SelectContent>
                                  </Select>
                                  <p className="text-[10px] text-slate-400 font-semibold leading-normal">
                                    {config.registers?.entryRequirementType === "casual"
                                      ? "This tournament is casual. Name and contact info are required; USCF/FIDE lookup steps will be hidden."
                                      : "Rated tournament. Validates active memberships and fetches ratings automatically."}
                                  </p>
                                </div>

                                <div className="space-y-1.5">
                                  <Label className="text-xs font-bold text-slate-700">Database Verification Source</Label>
                                  <Select
                                    value={gSettings.validationType || "none"}
                                    onValueChange={(val) => handleGroupSettingsChange(group, { validationType: val as any })}
                                  >
                                    <SelectTrigger className="h-8 text-xs rounded-lg border-slate-200">
                                      <SelectValue placeholder="Select verification policy" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="none">No Database Verification</SelectItem>
                                      <SelectItem value="strict_active">USCF/FIDE Online Verified</SelectItem>
                                      <SelectItem value="min_games">Require Active & Established Rating</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </div>
                              </div>

                              {config.registers?.entryRequirementType !== "casual" && (
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t border-slate-100 animate-in slide-in-from-top-1 duration-150">
                                  <div className="space-y-1.5">
                                    <Label className="text-xs font-bold text-slate-700">Required Federation System</Label>
                                    <Select
                                      value={config.registers?.ratedSystem || "uscf"}
                                      onValueChange={(val: "uscf" | "fide" | "both" | "either") => {
                                        onConfigChange({
                                          ...config,
                                          registers: {
                                            ...config.registers,
                                            ratedSystem: val,
                                            uscfRated: val === "uscf" || val === "both" || val === "either",
                                            fideRated: val === "fide" || val === "both" || val === "either",
                                          }
                                        });
                                      }}
                                    >
                                      <SelectTrigger className="h-8 text-xs rounded-lg border-slate-200">
                                        <SelectValue placeholder="Choose rating system" />
                                      </SelectTrigger>
                                      <SelectContent>
                                        <SelectItem value="uscf">USCF Only</SelectItem>
                                        <SelectItem value="fide">FIDE Only</SelectItem>
                                        <SelectItem value="both">Both USCF & FIDE Required</SelectItem>
                                        <SelectItem value="either">Either USCF or FIDE Required</SelectItem>
                                      </SelectContent>
                                    </Select>
                                  </div>

                                  <div className="space-y-1.5">
                                    <Label className="text-xs font-bold text-slate-700">Registration Verification Mode</Label>
                                    <Select
                                      value={config.registers?.strictAutofillOnly ? "strict" : "flexible"}
                                      onValueChange={(val: "strict" | "flexible") => {
                                        handleRegistersChange("strictAutofillOnly", val === "strict");
                                      }}
                                    >
                                      <SelectTrigger className="h-8 text-xs rounded-lg border-slate-200">
                                        <SelectValue placeholder="Select registration mode" />
                                      </SelectTrigger>
                                      <SelectContent>
                                        <SelectItem value="flexible">Flexible (Registry Lookup + Manual Input Override)</SelectItem>
                                        <SelectItem value="strict">Strict Autofill (Registry Lookup Only - No Manual Edits)</SelectItem>
                                      </SelectContent>
                                    </Select>
                                    <p className="text-[10px] text-slate-400 font-semibold leading-normal">
                                      {config.registers?.strictAutofillOnly
                                        ? "Players must search the registry and select a valid profile. Typing names or IDs manually is disabled."
                                        : "Players can lookup their profiles, but are allowed to type their ID/rating manually if search fails."}
                                    </p>
                                  </div>

                                  <div className="flex items-center justify-between col-span-1 md:col-span-2 pt-2 border-t border-slate-100">
                                    <div className="space-y-0.5">
                                      <Label className="text-xs font-bold text-slate-700">Auto-Verify Membership Status</Label>
                                      <p className="text-[10px] text-slate-500 font-medium">Force lookups against active chess registries during registration.</p>
                                    </div>
                                    <Switch
                                      checked={Boolean(config.registers?.verifyUscfMembership)}
                                      onCheckedChange={(checked) => handleRegistersChange("verifyUscfMembership", checked)}
                                    />
                                  </div>

                                  <div className="space-y-1.5 col-span-1 md:col-span-2">
                                    <Label className="text-xs font-bold text-slate-700">Provisional Rating Games Threshold</Label>
                                    <div className="flex items-center gap-4">
                                      <Input
                                        type="number"
                                        value={config.registers?.uscfMinGamesThreshold ?? 4}
                                        onChange={(e) => handleRegistersChange("uscfMinGamesThreshold", parseInt(e.target.value, 10) || 4)}
                                        className="w-32 h-8 text-xs border-slate-200 rounded-lg"
                                        min={0}
                                      />
                                      <span className="text-[10px] text-slate-500 font-medium">Number of played games below which a rating is considered provisional (e.g. less than 4 games).</span>
                                    </div>
                                  </div>
                                </div>
                              )}

                              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t border-slate-100">
                                <div className="flex items-center justify-between col-span-1 md:col-span-2">
                                  <div className="space-y-0.5">
                                    <Label className="text-xs font-bold text-slate-700">Auto-Fill Local Roster Cache</Label>
                                    <p className="text-[10px] text-slate-500 font-medium">Auto-completes from previously registered player records on the same server.</p>
                                  </div>
                                  <Switch
                                    checked={Boolean(gSettings.registrySpellingEnforcer)}
                                    onCheckedChange={(val) => handleGroupSettingsChange(group, { registrySpellingEnforcer: val })}
                                  />
                                </div>
                              </div>
                            </div>
                          )}

                          {/* 2. Name field styling / validations */}
                          {group.id === "name" && (
                            <>
                              <div className="space-y-1.5">
                                <Label className="text-xs font-bold text-slate-700">First/Last Name Formatting</Label>
                                <Select
                                  value={gSettings.caseFormatting || "none"}
                                  onValueChange={(val) => handleGroupSettingsChange(group, { caseFormatting: val as any })}
                                >
                                  <SelectTrigger className="h-8 text-xs rounded-lg border-slate-200">
                                    <SelectValue placeholder="Select casing formatting" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="none">As Entered by Player</SelectItem>
                                    <SelectItem value="title">Title Case (e.g. John Doe)</SelectItem>
                                    <SelectItem value="upper">UPPERCASE (e.g. JOHN DOE)</SelectItem>
                                  </SelectContent>
                                </Select>
                              </div>
                              <div className="space-y-1.5">
                                <Label className="text-xs font-bold text-slate-700">Block Name Spelling Mismatches</Label>
                                <div className="flex items-center gap-2 mt-1">
                                  <Switch
                                    checked={Boolean(gSettings.registrySpellingEnforcer)}
                                    onCheckedChange={(val) => handleGroupSettingsChange(group, { registrySpellingEnforcer: val })}
                                  />
                                  <span className="text-xs font-semibold text-slate-500">Must exactly match registry spelling</span>
                                </div>
                              </div>
                            </>
                          )}

                          {/* 3. USCF ID / FIDE ID fields */}
                          {(group.id === "uscfId" || group.id === "fideId") && (
                            <>
                              <div className="space-y-1.5">
                                <Label className="text-xs font-bold text-slate-700">Expired Membership Policy</Label>
                                <div className="flex items-center gap-2 mt-1">
                                  <Switch
                                    checked={Boolean(gSettings.rejectExpiredMembership)}
                                    onCheckedChange={(val) => handleGroupSettingsChange(group, { rejectExpiredMembership: val })}
                                  />
                                  <span className="text-xs font-semibold text-slate-500">Reject Expired Membership</span>
                                </div>
                              </div>
                              <div className="space-y-1.5">
                                <Label className="text-xs font-bold text-slate-700">Federation Renewal Redirection</Label>
                                <div className="flex items-center gap-2 mt-1">
                                  <Switch
                                    checked={Boolean(gSettings.provideRenewalLink)}
                                    onCheckedChange={(val) => handleGroupSettingsChange(group, { provideRenewalLink: val })}
                                  />
                                  <span className="text-xs font-semibold text-slate-500">Display external renewal URL</span>
                                </div>
                              </div>
                              <div className="space-y-1.5 col-span-1 md:col-span-2">
                                <Label className="text-xs font-bold text-slate-700">Minimum Section Rating Floor Requirement</Label>
                                <Input
                                  type="number"
                                  placeholder="e.g. 2000"
                                  className="h-8 text-xs rounded-lg border-slate-200 mt-1"
                                  value={gSettings.ratingFloorConstraint || ""}
                                  onChange={(e) => handleGroupSettingsChange(group, { ratingFloorConstraint: e.target.value ? parseInt(e.target.value) : undefined })}
                                />
                              </div>
                            </>
                          )}

                          {/* 4. Chess Club settings */}
                          {group.id === "club" && (
                            <>
                              <div className="space-y-1.5">
                                <Label className="text-xs font-bold text-slate-700">Input Mode Selection</Label>
                                <Select
                                  value={gSettings.inputStyle || "text"}
                                  onValueChange={(val) => handleGroupSettingsChange(group, { inputStyle: val as any })}
                                >
                                  <SelectTrigger className="h-8 text-xs rounded-lg border-slate-200">
                                    <SelectValue placeholder="Select style" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="text">Free Form Text Input</SelectItem>
                                    <SelectItem value="select">Pre-Approved Dropdown Selection</SelectItem>
                                  </SelectContent>
                                </Select>
                              </div>
                              {gSettings.inputStyle === "select" && (
                                <div className="space-y-1.5 col-span-1 md:col-span-2">
                                  <Label className="text-xs font-bold text-slate-700">Pre-Approved Chess Clubs (one per line)</Label>
                                  <textarea
                                    className="w-full text-xs font-medium p-2 border border-slate-200 rounded-lg min-h-[80px] focus:outline-indigo-500 bg-white"
                                    placeholder="Marshall Chess Club&#10;St. Louis Chess Club&#10;Charlotte Chess Center"
                                    value={gSettings.clubPreApprovedList?.join("\n") || ""}
                                    onChange={(e) => handleGroupSettingsChange(group, { clubPreApprovedList: e.target.value.split("\n").filter(Boolean) })}
                                  />
                                </div>
                              )}
                            </>
                          )}

                          {/* 5. Birthdate / scholasticGrade / schoolName settings */}
                          {(group.id === "birthdate" || group.id === "scholasticGrade" || group.id === "schoolName") && (
                            <>
                              <div className="space-y-1.5">
                                <Label className="text-xs font-bold text-slate-700">Minimum Allowed Age/Grade Level</Label>
                                <Input
                                  type="number"
                                  placeholder="e.g. 5"
                                  className="h-8 text-xs rounded-lg border-slate-200"
                                  value={gSettings.ageMin || gSettings.gradeMin || ""}
                                  onChange={(e) => {
                                    const val = e.target.value ? parseInt(e.target.value) : undefined;
                                    if (group.id === "scholasticGrade") {
                                      handleGroupSettingsChange(group, { gradeMin: val });
                                    } else {
                                      handleGroupSettingsChange(group, { ageMin: val });
                                    }
                                  }}
                                />
                              </div>
                              <div className="space-y-1.5">
                                <Label className="text-xs font-bold text-slate-700">Maximum Allowed Age/Grade Level</Label>
                                <Input
                                  type="number"
                                  placeholder="e.g. 18"
                                  className="h-8 text-xs rounded-lg border-slate-200"
                                  value={gSettings.ageMax || gSettings.gradeMax || ""}
                                  onChange={(e) => {
                                    const val = e.target.value ? parseInt(e.target.value) : undefined;
                                    if (group.id === "scholasticGrade") {
                                      handleGroupSettingsChange(group, { gradeMax: val });
                                    } else {
                                      handleGroupSettingsChange(group, { ageMax: val });
                                    }
                                  }}
                                />
                              </div>
                              {group.id === "birthdate" && (
                                <div className="space-y-1.5 col-span-1 md:col-span-2">
                                  <Label className="text-xs font-bold text-slate-700">Tournament Age Cutoff Reference Date</Label>
                                  <Input
                                    type="date"
                                    className="h-8 text-xs rounded-lg border-slate-200"
                                    value={gSettings.ageCutoffReference || ""}
                                    onChange={(e) => handleGroupSettingsChange(group, { ageCutoffReference: e.target.value })}
                                  />
                                </div>
                              )}
                            </>
                          )}

                          {/* 6. Gender / Sex settings */}
                          {group.id === "sex" && (
                            <div className="space-y-1.5 col-span-1 md:col-span-2">
                              <Label className="text-xs font-bold text-slate-700">Gender Restriction Filter</Label>
                              <Select
                                value={gSettings.validationType || "none"}
                                onValueChange={(val) => handleGroupSettingsChange(group, { validationType: val as any })}
                              >
                                <SelectTrigger className="h-8 text-xs rounded-lg border-slate-200">
                                  <SelectValue placeholder="Select restriction" />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="none">Open Event (All Genders Eligible)</SelectItem>
                                  <SelectItem value="strict_active">Women/Girls Championship (Only Females Eligible)</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                          )}

                          {/* 7. Email and Phone confirmation/updates */}
                          {(group.id === "email" || group.id === "parentContact") && (
                            <>
                              <div className="space-y-1.5">
                                <Label className="text-xs font-bold text-slate-700">Double-Entry Verification Email Check</Label>
                                <div className="flex items-center gap-2 mt-1">
                                  <Switch
                                    checked={Boolean(gSettings.doubleEntryCheck)}
                                    onCheckedChange={(val) => handleGroupSettingsChange(group, { doubleEntryCheck: val })}
                                  />
                                  <span className="text-xs font-semibold text-slate-500">Require email confirmation field</span>
                                </div>
                              </div>
                              <div className="space-y-1.5">
                                <Label className="text-xs font-bold text-slate-700">Parent/Guardian Secondary CC Delivery</Label>
                                <div className="flex items-center gap-2 mt-1">
                                  <Switch
                                    checked={Boolean(gSettings.parentCopyNotifications)}
                                    onCheckedChange={(val) => handleGroupSettingsChange(group, { parentCopyNotifications: val })}
                                  />
                                  <span className="text-xs font-semibold text-slate-500">CC email pairing/results reports to parent</span>
                                </div>
                              </div>
                            </>
                          )}

                          {/* 8. Phone SMS notifications */}
                          {group.id === "phone" && (
                            <div className="space-y-1.5 col-span-1 md:col-span-2">
                              <Label className="text-xs font-bold text-slate-700">SMS Pairing Notification Subscription Checkbox</Label>
                              <div className="flex items-center gap-2 mt-1">
                                <Switch
                                  checked={Boolean(gSettings.smsNotificationsEnabled)}
                                  onCheckedChange={(val) => handleGroupSettingsChange(group, { smsNotificationsEnabled: val })}
                                />
                                <span className="text-xs font-semibold text-slate-500">Enable automated pairings & stand-to-play text alerts</span>
                              </div>
                            </div>
                          )}

                          {/* 9. Section playing up rules */}
                          {group.id === "sectionChoice" && (
                            <>
                              <div className="space-y-1.5">
                                <Label className="text-xs font-bold text-slate-700">Allow Playing Up in Higher Rating Section</Label>
                                <div className="flex items-center gap-2 mt-1">
                                  <Switch
                                    checked={Boolean(gSettings.allowPlayingUp)}
                                    onCheckedChange={(val) => handleGroupSettingsChange(group, { allowPlayingUp: val })}
                                  />
                                  <span className="text-xs font-semibold text-slate-500">Permit playing in higher rated sections</span>
                                </div>
                              </div>
                              {gSettings.allowPlayingUp && (
                                <div className="space-y-1.5">
                                  <Label className="text-xs font-bold text-slate-700">Play-Up Surcharge Fee ($)</Label>
                                  <Input
                                    type="number"
                                    placeholder="e.g. 25"
                                    className="h-8 text-xs rounded-lg border-slate-200"
                                    value={gSettings.playUpFeeAmount || ""}
                                    onChange={(e) => handleGroupSettingsChange(group, { playUpFeeAmount: e.target.value ? parseFloat(e.target.value) : undefined })}
                                  />
                                </div>
                              )}
                            </>
                          )}

                          {/* 10. Bye preference policies */}
                          {group.id === "byes" && (
                            <>
                              <div className="space-y-1.5">
                                <Label className="text-xs font-bold text-slate-700">Maximum Allowed Requested Byes</Label>
                                <Select
                                  value={gSettings.maxByesAllowed?.toString() || "2"}
                                  onValueChange={(val) => handleGroupSettingsChange(group, { maxByesAllowed: parseInt(val) })}
                                >
                                  <SelectTrigger className="h-8 text-xs rounded-lg border-slate-200">
                                    <SelectValue placeholder="Max byes" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="1">1 Half-Point Bye Max</SelectItem>
                                    <SelectItem value="2">2 Half-Point Byes Max</SelectItem>
                                    <SelectItem value="3">3 Half-Point Byes Max</SelectItem>
                                    <SelectItem value="4">4 Half-Point Byes Max</SelectItem>
                                  </SelectContent>
                                </Select>
                              </div>
                              <div className="space-y-1.5">
                                <Label className="text-xs font-bold text-slate-700">Zero-Point Final Round Bye Rule</Label>
                                <div className="flex items-center gap-2 mt-1">
                                  <Switch
                                    checked={Boolean(gSettings.lastRoundZeroPointBye)}
                                    onCheckedChange={(val) => handleGroupSettingsChange(group, { lastRoundZeroPointBye: val })}
                                  />
                                  <span className="text-xs font-semibold text-slate-500">Final round bye gives 0 points (anti-collusion)</span>
                                </div>
                              </div>
                            </>
                          )}

                          {/* 11. Entry Fee Pricing Policy */}
                          {group.id === "entryFee" && (
                            <>
                              <div className="space-y-1.5 col-span-1 md:col-span-2">
                                <Label className="text-xs font-bold text-slate-700">Titled Chess Player Entry Fee Waiver</Label>
                                <div className="flex items-center gap-2 mt-1">
                                  <Switch
                                    checked={Boolean(gSettings.waiveTitledFee)}
                                    onCheckedChange={(val) => handleGroupSettingsChange(group, { waiveTitledFee: val })}
                                  />
                                  <span className="text-xs font-semibold text-slate-500">GM / IM / WGM / WIM register with $0 waived entry fee</span>
                                </div>
                              </div>
                              <div className="space-y-1.5">
                                <Label className="text-xs font-bold text-slate-700">Early-Bird Rate Price Deadline</Label>
                                <Input
                                  type="date"
                                  className="h-8 text-xs rounded-lg border-slate-200 mt-1"
                                  value={gSettings.earlyBirdDeadline || ""}
                                  onChange={(e) => handleGroupSettingsChange(group, { earlyBirdDeadline: e.target.value })}
                                />
                              </div>
                              <div className="space-y-1.5">
                                <Label className="text-xs font-bold text-slate-700">Late-Fee Surcharge Sched Penalty Deadline</Label>
                                <Input
                                  type="date"
                                  className="h-8 text-xs rounded-lg border-slate-200 mt-1"
                                  value={gSettings.lateFeeDeadline || ""}
                                  onChange={(e) => handleGroupSettingsChange(group, { lateFeeDeadline: e.target.value })}
                                />
                              </div>
                            </>
                          )}

                          {/* Default fallback info */}
                          {!["lookupSection", "playerSearch", "name", "uscfId", "fideId", "club", "birthdate", "scholasticGrade", "schoolName", "sex", "email", "parentContact", "phone", "sectionChoice", "byes", "entryFee"].includes(group.id) && (
                            <div className="col-span-1 md:col-span-2 text-slate-400 font-semibold italic text-center py-2">
                              No advanced chess settings needed for this structural block.
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* General Form Policies */}
        <Card className="rounded-2xl border bg-white shadow-sm overflow-hidden">
          <CardHeader className="bg-slate-50/50 p-5 border-b">
            <CardTitle className="text-base font-extrabold text-slate-900 flex items-center gap-2">
              <Settings className="h-4.5 w-4.5 text-slate-500" />
              General Form Policies
            </CardTitle>
            <CardDescription className="text-xs font-semibold text-slate-500">Configure global registration policies, capacity limits, and payments.</CardDescription>
          </CardHeader>
          <CardContent className="p-5 space-y-6">
            {/* Subsection 1: Registration Workflow */}
            <div className="space-y-4">
              <h4 className="text-xs font-extrabold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                <Sliders className="h-3 w-3 text-indigo-500" />
                Registration & Edit Workflow
              </h4>
              
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label className="text-sm font-bold text-slate-800">Enable Multi-Player Registration</Label>
                    <p className="text-xs text-slate-500 leading-normal font-semibold">Allow a player to register multiple participants in a single session (shopping cart mode).</p>
                  </div>
                  <Switch
                    checked={Boolean(config.registers?.allowMultiPlayerSignup)}
                    onCheckedChange={(checked) => handleRegistersChange("allowMultiPlayerSignup", checked)}
                  />
                </div>

                <div className="flex items-center justify-between border-t pt-4">
                  <div className="space-y-0.5">
                    <Label className="text-sm font-bold text-slate-800">Allow Registration Edits</Label>
                    <p className="text-xs text-slate-500 leading-normal font-semibold">Allow players to modify their sections or request byes after registering.</p>
                  </div>
                  <Switch
                    checked={Boolean(config.registers?.allowEditRegistration)}
                    onCheckedChange={(checked) => handleRegistersChange("allowEditRegistration", checked)}
                  />
                </div>

                <div className="flex items-center justify-between border-t pt-4">
                  <div className="space-y-0.5">
                    <Label className="text-sm font-bold text-slate-800">Auto-Accept Registrations</Label>
                    <p className="text-xs text-slate-500 leading-normal font-semibold">Automatically approve submitted registrations and add players directly to the roster.</p>
                  </div>
                  <Switch
                    checked={Boolean(config.registers?.autoAcceptRegistrations)}
                    onCheckedChange={(checked) => handleRegistersChange("autoAcceptRegistrations", checked)}
                  />
                </div>

                <div className="flex items-center justify-between border-t pt-4">
                  <div className="space-y-0.5">
                    <Label className="text-sm font-bold text-slate-800">Collect Zelle Payout Details</Label>
                    <p className="text-xs text-slate-500 leading-normal font-semibold">Ask players for their Zelle email and phone number during registration to facilitate direct payouts.</p>
                  </div>
                  <Switch
                    checked={config.registers?.collectPrizePayoutDetails !== false}
                    onCheckedChange={(checked) => handleRegistersChange("collectPrizePayoutDetails", checked)}
                  />
                </div>
              </div>
            </div>

            {/* Subsection 2: Capacity & Deadlines */}
            <div className="border-t pt-6 space-y-4">
              <h4 className="text-xs font-extrabold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                <CheckSquare className="h-3 w-3 text-indigo-500" />
                Capacity & Deadline Constraints
              </h4>

              <div className="space-y-4">
                <div className="space-y-2">
                  <Label className="text-sm font-bold text-slate-800 block">Participant Capacity</Label>
                  <p className="text-xs text-slate-500 leading-normal font-semibold mb-2">Limit the number of registered players. Leave blank or 0 for no limit.</p>
                  <Input
                    type="number"
                    placeholder="No limit"
                    value={config.registers?.playerLimit || ""}
                    onChange={(e) => handleRegistersChange("playerLimit", parseInt(e.target.value, 10) || null)}
                    className="w-32 h-10 text-xs border-slate-200 rounded-xl"
                    min={0}
                  />
                </div>

                <div className="space-y-2 border-t pt-4">
                  <Label className="text-sm font-bold text-slate-800 block">Registration Deadline</Label>
                  <p className="text-xs text-slate-500 leading-normal font-semibold mb-2">Players will not be able to register online after this date and time.</p>
                  <div className="flex gap-4">
                    <div className="flex-1">
                      <Input
                        type="date"
                        value={config.registers?.registrationDeadlineDate || ""}
                        onChange={(e) => handleRegistersChange("registrationDeadlineDate", e.target.value || null)}
                        className="h-10 text-xs border-slate-200 rounded-xl"
                      />
                    </div>
                    <div className="flex-1">
                      <Input
                        type="time"
                        value={config.registers?.registrationDeadlineTime || ""}
                        onChange={(e) => handleRegistersChange("registrationDeadlineTime", e.target.value || null)}
                        className="h-10 text-xs border-slate-200 rounded-xl"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Subsection 3: Payments & Collection Policies */}
            <div className="border-t pt-6 space-y-4">
              <h4 className="text-xs font-extrabold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                <Settings className="h-3 w-3 text-indigo-500" />
                Payments & Entry Fee Collection
              </h4>

              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label className="text-sm font-bold text-slate-800">Collect Entry Fees</Label>
                    <p className="text-xs text-slate-500 leading-normal font-semibold">Require players to pay entry fees to confirm registration.</p>
                  </div>
                  <Switch
                    checked={Boolean(config.payments?.onlineEnabled)}
                    onCheckedChange={(checked) => handlePaymentsChange("onlineEnabled", checked)}
                  />
                </div>

                {config.payments?.onlineEnabled && (
                  <div className="space-y-4 border-t pt-4 animate-in slide-in-from-top-2 duration-200">
                    <div className="space-y-1.5">
                      <Label className="text-xs font-bold text-slate-650">Online Payment Provider</Label>
                      <Select
                        value={config.payments?.provider || "stripe"}
                        onValueChange={(val) => handlePaymentsChange("provider", val)}
                      >
                        <SelectTrigger className="h-10 text-xs border-slate-200 bg-white rounded-xl">
                          <SelectValue placeholder="Select provider" />
                        </SelectTrigger>
                        <SelectContent className="rounded-xl">
                          <SelectItem value="stripe">Stripe Connect (Recommended)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="flex items-center justify-between border-t pt-4">
                      <div className="space-y-0.5">
                        <Label className="text-sm font-bold text-slate-800">Require Upfront Checkout Payment</Label>
                        <p className="text-xs text-slate-500 leading-normal font-semibold">Require successful credit/debit card checkout before creating roster entries.</p>
                      </div>
                      <Switch
                        checked={Boolean(config.payments?.requirePaymentOnRegistration)}
                        onCheckedChange={(checked) => handlePaymentsChange("requirePaymentOnRegistration", checked)}
                      />
                    </div>

                    <div className="space-y-2.5 border-t pt-4">
                      <Label className="text-xs font-bold text-slate-650 block">Accepted Offline Payment Methods</Label>
                      <div className="grid grid-cols-2 gap-2">
                        {["cash", "check", "venmo", "zelle", "paypal", "other"].map((m) => {
                          const active = (config.payments?.acceptedOfflineMethods || []).includes(m as any);
                          return (
                            <label key={m} className="flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer select-none">
                              <input
                                type="checkbox"
                                checked={active}
                                onChange={() => toggleOfflineMethod(m)}
                                className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 h-4.5 w-4.5"
                              />
                              <span className="capitalize">{m}</span>
                            </label>
                          );
                        })}
                      </div>
                    </div>

                    <div className="space-y-1.5 border-t pt-4">
                      <Label className="text-xs font-bold text-slate-650">Offline Payment Instructions</Label>
                      <textarea
                        value={config.payments?.offlineInstructions || ""}
                        onChange={(e) => handlePaymentsChange("offlineInstructions", e.target.value)}
                        rows={2}
                        placeholder="e.g. Bring cash/check to the registration desk at 9:30 AM before Round 1 starts."
                        className="w-full text-xs border rounded-xl p-2.5 bg-white border-slate-200 focus:outline-none focus:border-indigo-500 font-semibold"
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {actions && (
        <div className="border-t border-slate-200 pt-4 flex items-center justify-end">
          {actions}
        </div>
      )}
    </div>
  );
}

export default RegistrationFormCustomizer;
