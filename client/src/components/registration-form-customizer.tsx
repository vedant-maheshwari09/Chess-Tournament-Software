import React, { useMemo, useEffect, useRef } from "react";
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
  ExternalLink
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
    id: "name",
    label: "Name",
    description: "First and last name of the participant.",
    fieldIds: ["firstName", "lastName"],
    alwaysVisible: true,
    alwaysRequired: true
  },
  {
    id: "email",
    label: "Email Address",
    description: "Email for notifications and check-in confirmation.",
    fieldIds: ["email"],
    alwaysVisible: true,
    alwaysRequired: true
  },
  {
    id: "phone",
    label: "Phone Number",
    description: "Contact number for text alerts or urgent updates.",
    fieldIds: ["phone"]
  },
  {
    id: "club",
    label: "Chess Club",
    description: "Local chess club, school, or team federation.",
    fieldIds: ["club"]
  },
  {
    id: "birthdate",
    label: "Birthdate",
    description: "Date of birth (required for age-restricted sections).",
    fieldIds: ["birthdate"]
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
    id: "address",
    label: "Mailing Address",
    description: "Full address fields including country and zip.",
    fieldIds: ["address1", "address2", "postalCode", "country", "detailsSection"]
  },
  {
    id: "byes",
    label: "Bye Requests",
    description: "Allows players to choose bye rounds when registering.",
    fieldIds: ["byePreference"]
  },
  {
    id: "notes",
    label: "Special Notes / Requests",
    description: "Additional requests, e.g., wheelchair accessibility.",
    fieldIds: ["notes"]
  },
  {
    id: "arrival",
    label: "Expected Arrival Time",
    description: "Helpful for check-in organization.",
    fieldIds: ["arrivalTime"]
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
  }
];

export function RegistrationFormCustomizer({ config, onConfigChange, actions, tournamentSlug, previewChannelId }: RegistrationFormCustomizerProps) {
  const previewWindowRef = useRef<Window | null>(null);
  const broadcastRef = useRef<BroadcastChannel | null>(null);

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
    if (group.alwaysVisible) return true;
    return group.fieldIds
      .filter((id) => id !== "detailsSection")
      .some((id) => {
        const field = formConfig.fields.find((f) => f.id === id);
        return field?.visible ?? false;
      });
  };

  const isGroupRequired = (group: FieldGroup) => {
    if (group.alwaysRequired) return true;
    return group.fieldIds
      .filter((id) => id !== "detailsSection")
      .some((id) => {
        const field = formConfig.fields.find((f) => f.id === id);
        return field?.required ?? false;
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

    if (group.id === "address") {
      const detailsSectionField = nextFields.find((f) => f.id === "detailsSection");
      if (detailsSectionField) {
        detailsSectionField.visible = checked;
      }
    }

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

    if (group.id === "address" && checked) {
      const detailsSectionField = nextFields.find((f) => f.id === "detailsSection");
      if (detailsSectionField) {
        detailsSectionField.visible = true;
      }
    }

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
                
                return (
                  <div key={group.id} className="grid grid-cols-12 gap-4 px-6 py-4 items-center hover:bg-slate-50/40 transition-colors">
                    <div className="col-span-6 sm:col-span-8 space-y-0.5">
                      <Label className="text-sm font-bold text-slate-800">{group.label}</Label>
                      <p className="text-xs text-slate-500 leading-normal font-medium">{group.description}</p>
                    </div>
                    
                    <div className="col-span-3 sm:col-span-2 flex justify-center">
                      <Switch
                        checked={visible}
                        disabled={group.alwaysVisible}
                        onCheckedChange={(val) => handleGroupVisibilityChange(group, val)}
                      />
                    </div>
                    
                    <div className="col-span-3 sm:col-span-2 flex justify-center">
                      <Switch
                        checked={required}
                        disabled={group.alwaysRequired || !visible}
                        onCheckedChange={(val) => handleGroupRequiredChange(group, val)}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* General Settings */}
        <Card className="rounded-2xl border bg-white shadow-sm overflow-hidden">
          <CardHeader className="bg-slate-50/50 p-5 border-b">
            <CardTitle className="text-base font-extrabold text-slate-900 flex items-center gap-2">
              <Settings className="h-4.5 w-4.5 text-slate-500" />
              General Form Policies
            </CardTitle>
            <CardDescription className="text-xs font-semibold text-slate-500">Configure global registration policies.</CardDescription>
          </CardHeader>
          <CardContent className="p-5 space-y-4">
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
          </CardContent>
        </Card>

        {/* Constraints */}
        <Card className="rounded-2xl border bg-white shadow-sm overflow-hidden">
          <CardHeader className="bg-slate-50/50 p-5 border-b">
            <CardTitle className="text-base font-extrabold text-slate-900 flex items-center gap-2">
              <Settings className="h-4.5 w-4.5 text-slate-500" />
              Constraints
            </CardTitle>
            <CardDescription className="text-xs font-semibold text-slate-500">Configure participant capacity limits and registration deadlines.</CardDescription>
          </CardHeader>
          <CardContent className="p-5 space-y-4">
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
          </CardContent>
        </Card>

        {/* Tournament Entry & Rating Requirements */}
        <Card className="rounded-2xl border bg-white shadow-sm overflow-hidden">
          <CardHeader className="bg-slate-50/50 p-5 border-b">
            <CardTitle className="text-base font-extrabold text-slate-900 flex items-center gap-2">
              <CheckSquare className="h-4.5 w-4.5 text-slate-500" />
              Tournament Entry & Rating Requirements
            </CardTitle>
            <CardDescription className="text-xs font-semibold text-slate-500 font-sans">Configure tournament rating validation and federation verification policies.</CardDescription>
          </CardHeader>
          <CardContent className="p-5 space-y-5">
            <div className="space-y-1.5">
              <Label className="text-sm font-bold text-slate-800">Tournament Entry Type</Label>
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
                <SelectTrigger className="h-10 text-xs border-slate-200 bg-white rounded-xl">
                  <SelectValue placeholder="Choose entry type" />
                </SelectTrigger>
                <SelectContent className="rounded-xl">
                  <SelectItem value="casual">Casual / Unrated (No Verification)</SelectItem>
                  <SelectItem value="rated">Official Rated (Requires Federation ID)</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-slate-400 font-medium leading-relaxed">
                {config.registers?.entryRequirementType === "casual"
                  ? "This tournament is casual. Name and contact info are required; USCF/FIDE lookup steps will be hidden."
                  : "Rated tournament. Validates active memberships and fetches ratings automatically."}
              </p>
            </div>

            {config.registers?.entryRequirementType !== "casual" && (
              <div className="space-y-4 border-t pt-4 animate-in slide-in-from-top-2 duration-200">
                <div className="space-y-1.5">
                  <Label className="text-xs font-bold text-slate-650">Required Federation System</Label>
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
                    <SelectTrigger className="h-10 text-xs border-slate-200 bg-white rounded-xl">
                      <SelectValue placeholder="Choose rating system" />
                    </SelectTrigger>
                    <SelectContent className="rounded-xl">
                      <SelectItem value="uscf">USCF Only</SelectItem>
                      <SelectItem value="fide">FIDE Only</SelectItem>
                      <SelectItem value="both">Both USCF & FIDE Required</SelectItem>
                      <SelectItem value="either">Either USCF or FIDE Required</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-bold text-slate-650">Registration Verification Mode</Label>
                  <Select
                    value={config.registers?.strictAutofillOnly ? "strict" : "flexible"}
                    onValueChange={(val: "strict" | "flexible") => {
                      handleRegistersChange("strictAutofillOnly", val === "strict");
                    }}
                  >
                    <SelectTrigger className="h-10 text-xs border-slate-200 bg-white rounded-xl">
                      <SelectValue placeholder="Select registration mode" />
                    </SelectTrigger>
                    <SelectContent className="rounded-xl">
                      <SelectItem value="flexible">Flexible (Registry Lookup + Manual Input Override)</SelectItem>
                      <SelectItem value="strict">Strict Autofill (Registry Lookup Only - No Manual Edits)</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-[10px] text-slate-400 leading-normal">
                    {config.registers?.strictAutofillOnly
                      ? "Players must search the registry and select a valid profile. Typing names or IDs manually is disabled."
                      : "Players can lookup their profiles, but are allowed to type their ID/rating manually if search fails."}
                  </p>
                </div>

                <div className="flex items-center justify-between border-t pt-4">
                  <div className="space-y-0.5">
                    <Label className="text-sm font-bold text-slate-800">Auto-Verify Membership Status</Label>
                    <p className="text-xs text-slate-500 leading-normal font-semibold">Force lookups against active chess registries during registration.</p>
                  </div>
                  <Switch
                    checked={Boolean(config.registers?.verifyUscfMembership)}
                    onCheckedChange={(checked) => handleRegistersChange("verifyUscfMembership", checked)}
                  />
                </div>

                <div className="space-y-2 border-t pt-4">
                  <Label className="text-sm font-bold text-slate-800 block">Provisional Rating Games Threshold</Label>
                  <p className="text-xs text-slate-500 leading-normal font-semibold mb-2">Number of played games below which a rating is considered provisional (e.g. less than 4 games).</p>
                  <Input
                    type="number"
                    value={config.registers?.uscfMinGamesThreshold ?? 4}
                    onChange={(e) => handleRegistersChange("uscfMinGamesThreshold", parseInt(e.target.value, 10) || 4)}
                    className="w-32 h-10 text-xs border-slate-200 rounded-xl"
                    min={0}
                  />
                </div>
              </div>
            )}

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
          </CardContent>
        </Card>

        {/* Payments Config */}
        <Card className="rounded-2xl border bg-white shadow-sm overflow-hidden">
          <CardHeader className="bg-slate-50/50 p-5 border-b">
            <CardTitle className="text-base font-extrabold text-slate-900 flex items-center gap-2">
              <Settings className="h-4.5 w-4.5 text-slate-500" />
              Payments & Collection Policies
            </CardTitle>
            <CardDescription className="text-xs font-semibold text-slate-500 font-sans">Collect entry fees online or handle cash on-site.</CardDescription>
          </CardHeader>
          <CardContent className="p-5 space-y-4">
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
