import React, { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  Plus, 
  Trash2, 
  ChevronDown, 
  ChevronUp,
  FileUp, 
  FileDown,
  Settings,
  X,
  Type,
  LayoutGrid,
  AlignLeft,
  CheckSquare,
  Copy,
  SeparatorHorizontal,
  Eye,
  ListPlus
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { 
  DEFAULT_REGISTRATION_FIELDS, 
  type RegistrationFormConfig, 
  type RegistrationFormField,
  type TournamentConfig,
  type RegistersConfig,
  type PaymentSettings
} from "@/lib/tournament-config";

function downloadJson(filename: string, data: unknown) {
  if (typeof window === "undefined") return;
  const payload = JSON.stringify(data, null, 2);
  const blob = new Blob([payload], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function fileToText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

const formatDate = (value: string | Date | null | undefined) => {
  if (!value) return "TBD";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "TBD";
  return date.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
};

interface RegistrationFormCustomizerProps {
  config: TournamentConfig;
  onConfigChange: (config: TournamentConfig) => void;
  actions?: React.ReactNode;
  tournamentSlug?: string;
}

export function RegistrationFormCustomizer({ config, onConfigChange, actions, tournamentSlug }: RegistrationFormCustomizerProps) {
  const { toast } = useToast();
  const [focusedFieldId, setFocusedFieldId] = useState<string | null>(null);
  const importRef = React.useRef<HTMLInputElement>(null);
  const [activeSubTab, setActiveSubTab] = useState("questions");

  // Parse or default the registration form configuration with migration for legacy system fields
  const formConfig = useMemo((): RegistrationFormConfig & { migratedToSystemFields?: boolean } => {
    const saved = config.registrationFormConfig;
    if (!saved) {
      return {
        fields: DEFAULT_REGISTRATION_FIELDS.map(f => ({ ...f })),
        migratedToSystemFields: true
      };
    }

    if (
      !saved.migratedToSystemFields || 
      !saved.fields.some(f => f.id === "playerSearch" || f.id === "paymentFlow") ||
      !saved.fields.some(f => f.id === "playerIdentityHeading" || f.id === "contactInfoHeading" || f.id === "sectionRatingHeading")
    ) {
      const fieldIds = new Set(saved.fields.map(f => f.id));
      let nextFields = [...saved.fields];

      // Remove any existing lookupSection/detailsSection/preferencesSection/checkoutSection to re-insert them at correct positions to prevent duplicate/messy ordering
      nextFields = nextFields.filter(f => 
        f.id !== "lookupSection" && 
        f.id !== "detailsSection" && 
        f.id !== "preferencesSection" && 
        f.id !== "checkoutSection" &&
        f.id !== "playerSearch" &&
        f.id !== "paymentFlow"
      );

      // Core Lookup section fields
      if (!fieldIds.has("firstName")) {
        nextFields.unshift({
          id: "firstName",
          label: "First Name",
          type: "text" as const,
          required: true,
          visible: true,
          placeholder: "e.g. John",
          description: "Enter your first name (as it appears on your chess ID)."
        });
      }

      if (!fieldIds.has("lastName")) {
        const idx = nextFields.findIndex(f => f.id === "firstName");
        const newField = {
          id: "lastName",
          label: "Last Name",
          type: "text" as const,
          required: true,
          visible: true,
          placeholder: "e.g. Doe",
          description: "Enter your last name (as it appears on your chess ID)."
        };
        if (idx !== -1) nextFields.splice(idx + 1, 0, newField);
        else nextFields.unshift(newField);
      }

      if (!fieldIds.has("playerIdentityHeading")) {
        const idx = nextFields.findIndex(f => f.id === "firstName");
        const newField = {
          id: "playerIdentityHeading",
          label: "Player Identity",
          type: "heading" as const,
          required: false,
          visible: true,
        };
        if (idx !== -1) nextFields.splice(idx, 0, newField); // Place right before firstName
        else nextFields.unshift(newField);
      }

      if (!fieldIds.has("email")) {
        const idx = nextFields.findIndex(f => f.id === "lastName");
        const newField = {
          id: "email",
          label: "Email Address",
          type: "text" as const,
          required: true,
          visible: true,
          placeholder: "e.g. john.doe@example.com",
          description: "We will send pairing notifications and receipts here."
        };
        if (idx !== -1) nextFields.splice(idx + 1, 0, newField);
        else nextFields.unshift(newField);
      }

      if (!fieldIds.has("contactInfoHeading")) {
        const idx = nextFields.findIndex(f => f.id === "email");
        const newField = {
          id: "contactInfoHeading",
          label: "Contact Information",
          type: "heading" as const,
          required: false,
          visible: true,
        };
        if (idx !== -1) nextFields.splice(idx, 0, newField); // Place right before email
        else nextFields.unshift(newField);
      }

      if (!fieldIds.has("sectionChoice")) {
        const idx = nextFields.findIndex(f => f.id === "email");
        const newField = {
          id: "sectionChoice",
          label: "Preferred Section",
          type: "select" as const,
          required: true,
          visible: true,
          description: "Choose the section you want to play in."
        };
        if (idx !== -1) nextFields.splice(idx + 1, 0, newField);
        else nextFields.unshift(newField);
      }

      if (!fieldIds.has("sectionRatingHeading")) {
        const idx = nextFields.findIndex(f => f.id === "sectionChoice");
        const newField = {
          id: "sectionRatingHeading",
          label: "Section & Rating",
          type: "heading" as const,
          required: false,
          visible: true,
        };
        if (idx !== -1) nextFields.splice(idx, 0, newField); // Place right before sectionChoice
        else nextFields.unshift(newField);
      }

      if (!fieldIds.has("ratingProvider")) {
        const idx = nextFields.findIndex(f => f.id === "sectionChoice");
        const newField = {
          id: "ratingProvider",
          label: "Rating Provider",
          type: "select" as const,
          required: true,
          visible: true,
          description: "Select where we should verify your rating."
        };
        if (idx !== -1) nextFields.splice(idx + 1, 0, newField);
        else nextFields.unshift(newField);
      }

      if (!fieldIds.has("entryFee")) {
        nextFields.push({
          id: "entryFee",
          label: "Entry Fee Selection",
          type: "select" as const,
          required: true,
          visible: true,
          description: "Choose your entry fee tier."
        });
      }

      if (!fieldIds.has("pairingNotifications")) {
        nextFields.push({
          id: "pairingNotifications",
          label: "Notification Preference",
          type: "select" as const,
          required: false,
          visible: true,
          description: "Receive pairings, standings, and tournament updates."
        });
      }

      // Now insert the default section dividers and customizer-visible preset modules in correct order
      // 1. lookupSection at the very beginning
      nextFields.unshift({
        id: "lookupSection",
        label: "Player Profile Lookup",
        type: "section" as const,
        required: false,
        visible: true,
        description: "Search or enter your player profile information."
      });

      // Insert playerSearch right after lookupSection
      nextFields.splice(1, 0, {
        id: "playerSearch",
        label: "Player Search",
        type: "text" as const,
        required: false,
        visible: true,
        description: "Search by player name or Chess ID to auto-fill details."
      });

      // 2. detailsSection right before address1 (or uscfId, or default middle)
      let detailsIdx = nextFields.findIndex(f => f.id === "address1" || f.id === "uscfId" || f.id === "fideId");
      if (detailsIdx === -1) detailsIdx = nextFields.findIndex(f => f.id === "ratingProvider") + 1;
      nextFields.splice(detailsIdx, 0, {
        id: "detailsSection",
        label: "Contact Information",
        type: "section" as const,
        required: false,
        visible: true,
        description: "Provide your contact and mailing address details."
      });

      // 3. preferencesSection right before byePreference (or arrivalTime, or newsletter)
      let prefIdx = nextFields.findIndex(f => f.id === "byePreference" || f.id === "arrivalTime" || f.id === "newsletter" || f.id === "pairingNotifications");
      if (prefIdx === -1) prefIdx = nextFields.length;
      nextFields.splice(prefIdx, 0, {
        id: "preferencesSection",
        label: "Preferences & Options",
        type: "section" as const,
        required: false,
        visible: true,
        description: "Select byes, arrival time, and notification settings."
      });

      // 4. checkoutSection right before entryFee
      let checkIdx = nextFields.findIndex(f => f.id === "entryFee");
      if (checkIdx === -1) checkIdx = nextFields.length;
      nextFields.splice(checkIdx, 0, {
        id: "checkoutSection",
        label: "Review & Submit",
        type: "section" as const,
        required: false,
        visible: true,
        description: "Confirm details, complete payment, and submit your registration."
      });

      // Insert paymentFlow right after checkoutSection
      const updatedCheckIdx = nextFields.findIndex(f => f.id === "checkoutSection");
      nextFields.splice(updatedCheckIdx + 1, 0, {
        id: "paymentFlow",
        label: "Stripe Credit Card Payment",
        type: "boolean" as const,
        required: false,
        visible: true,
        description: "Collect entry fees securely via Stripe checkout."
      });

      return {
        ...saved,
        fields: nextFields,
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

  const updateFormTitle = (title: string) => {
    updateFormConfig({ ...formConfig, formTitle: title });
  };

  const updateFormDescription = (description: string) => {
    updateFormConfig({ ...formConfig, formDescription: description });
  };

  const updateField = (id: string, updates: Partial<RegistrationFormField>) => {
    const next = formConfig.fields.map((f) => (f.id === id ? { ...f, ...updates } : f));
    updateFormConfig({ ...formConfig, fields: next });
  };

  const addCustomQuestionWithType = (type: RegistrationFormField["type"]) => {
    const defaultLabels = {
      text: "Untitled Short Answer",
      paragraph: "Untitled Paragraph",
      select: "Untitled Dropdown Question",
      radio: "Untitled Multiple Choice",
      checkbox: "Untitled Checkboxes Question",
      boolean: "Untitled Yes/No Toggle",
      date: "Untitled Date Question",
      time: "Untitled Time Question",
      number: "Untitled Number Question",
      section: "Untitled Section Divider",
      heading: "Untitled Heading"
    };

    const newField: RegistrationFormField = {
      id: `${(type === "section" || type === "heading") ? type : "custom"}_${Date.now()}`,
      label: defaultLabels[type] || "Untitled Question",
      type,
      placeholder: (type === "text" || type === "number" || type === "paragraph") ? "Short answer text" : undefined,
      description: (type === "section" || type === "heading") ? "Subtitle or description text (optional)" : "Question helper text",
      required: false,
      visible: true,
      isCustom: true,
      options: (type === "select" || type === "radio" || type === "checkbox") ? ["Option 1", "Option 2"] : undefined,
    };

    updateFormConfig({ ...formConfig, fields: [...formConfig.fields, newField] });
    setFocusedFieldId(newField.id);

    // Scroll to bottom where the new question was added
    setTimeout(() => {
      const el = document.getElementById(`field-card-${newField.id}`);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 100);

    toast({
      title: `${type.toUpperCase()} added`,
      description: `Successfully appended to form.`
    });
  };

  const duplicateField = (field: RegistrationFormField, index: number) => {
    const duplicated: RegistrationFormField = {
      ...field,
      id: `${field.type === "section" ? "section" : "custom"}_duplicated_${Date.now()}`,
      label: `${field.label} (Copy)`,
      isCustom: true,
      options: field.options ? [...field.options] : undefined
    };

    const nextFields = [...formConfig.fields];
    nextFields.splice(index + 1, 0, duplicated);

    updateFormConfig({ ...formConfig, fields: nextFields });
    setFocusedFieldId(duplicated.id);

    setTimeout(() => {
      const el = document.getElementById(`field-card-${duplicated.id}`);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 100);

    toast({
      title: "Question duplicated",
      description: "Created a copy of the question."
    });
  };

  const removeField = (id: string) => {
    const nonDeletableFields = [
      "firstName",
      "lastName",
      "email",
      "sectionChoice",
      "lookupSection",
      "checkoutSection"
    ];

    if (nonDeletableFields.includes(id)) {
      toast({
        title: "Cannot delete",
        description: "This field is required for tournament registration and cannot be removed.",
        variant: "destructive"
      });
      return;
    }

    const field = formConfig.fields.find(f => f.id === id);
    if (field && !field.isCustom) {
      // Standard system field: hide instead of deleting so it can be restored
      updateFormConfig({
        ...formConfig,
        fields: formConfig.fields.map(f => f.id === id ? { ...f, visible: false, required: false } : f)
      });
    } else {
      // Custom field: delete completely
      updateFormConfig({
        ...formConfig,
        fields: formConfig.fields.filter((f) => f.id !== id)
      });
    }

    if (focusedFieldId === id) setFocusedFieldId(null);
    toast({
      title: "Removed",
      description: "Item removed from registration form."
    });
  };

  const deletableSystemFields = [
    { id: "playerSearch", label: "Player Search Options" },
    { id: "uscfId", label: "USCF ID Lookup" },
    { id: "fideId", label: "FIDE ID Lookup" },
    { id: "city", label: "City" },
    { id: "state", label: "State" },
    { id: "detailsSection", label: "Contact Info Divider" },
    { id: "address1", label: "Address Line 1" },
    { id: "address2", label: "Address Line 2" },
    { id: "postalCode", label: "Postal Code" },
    { id: "country", label: "Country" },
    { id: "byePreference", label: "Bye Requests" },
    { id: "arrivalTime", label: "Expected Arrival Time" },
    { id: "notes", label: "Notes / Requests" },
    { id: "newsletter", label: "Receive Bulletins" },
    { id: "pairingNotifications", label: "Notification Preference" },
  ];

  const restoreSystemField = (id: string) => {
    updateFormConfig({
      ...formConfig,
      fields: formConfig.fields.map(f => f.id === id ? { ...f, visible: true } : f)
    });
    toast({
      title: "Restored",
      description: "Field restored to the form."
    });
  };

  const moveField = (index: number, direction: "up" | "down") => {
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= formConfig.fields.length) return;
    const nextFields = [...formConfig.fields];
    const temp = nextFields[index];
    nextFields[index] = nextFields[targetIndex];
    nextFields[targetIndex] = temp;
    updateFormConfig({ ...formConfig, fields: nextFields });
  };

  const handleExport = () => {
    downloadJson(`registration-form-config.json`, formConfig);
    toast({ title: "Exported", description: "Form configuration downloaded." });
  };

  const handleImportClick = () => {
    importRef.current?.click();
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await fileToText(file);
      const parsed = JSON.parse(text) as RegistrationFormConfig;
      if (!Array.isArray(parsed?.fields)) throw new Error("Invalid format");
      updateFormConfig(parsed);
      toast({ title: "Imported", description: "Form configuration applied successfully." });
    } catch {
      toast({ title: "Import failed", description: "Invalid JSON configuration file.", variant: "destructive" });
    } finally {
      if (e.target) e.target.value = "";
    }
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
      </div>

      {/* Tabs Header: Questions & Settings */}
      <div className="flex items-center justify-between bg-slate-100/80 border p-1 rounded-xl shadow-sm">
        <Tabs value={activeSubTab} onValueChange={setActiveSubTab} className="w-full">
          <TabsList className="grid grid-cols-2 max-w-xs bg-transparent border-none">
            <TabsTrigger value="questions" className="rounded-lg font-bold text-sm py-1.5 flex items-center gap-1.5 data-[state=active]:bg-white data-[state=active]:shadow-sm">
              <AlignLeft className="h-4 w-4" />
              Questions
            </TabsTrigger>
            <TabsTrigger value="settings" className="rounded-lg font-bold text-sm py-1.5 flex items-center gap-1.5 data-[state=active]:bg-white data-[state=active]:shadow-sm">
              <Settings className="h-4 w-4" />
              Settings
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <div className="flex gap-6 items-start">
        {/* Main Content Area */}
        <div className="flex-1 space-y-4 min-w-0">
          {activeSubTab === "questions" ? (
            <div className="space-y-4 pb-24">
              {/* Form Title & Description Card (Google Forms Style) */}
              <div className="border-t-8 border-t-sky-500 bg-white border border-slate-200 shadow-sm p-6 rounded-2xl space-y-3">
                <Input
                  className="text-2xl font-bold tracking-tight text-slate-900 border-transparent hover:border-slate-200 focus:border-sky-500 focus:ring-0 px-1 py-0 h-auto bg-transparent rounded-lg"
                  value={formConfig.formTitle ?? `${config.basic.name || "Chess Tournament"} Registration Form`}
                  onChange={(e) => updateFormTitle(e.target.value)}
                  placeholder="Form Title"
                />
                <textarea
                  className="w-full text-sm text-slate-500 border-transparent hover:border-slate-200 focus:border-sky-500 focus:outline-none px-1 py-1 h-auto bg-transparent rounded-lg resize-none"
                  rows={3}
                  value={formConfig.formDescription ?? ""}
                  onChange={(e) => updateFormDescription(e.target.value)}
                  placeholder={config.basic.startDate
                    ? `${formatDate(config.basic.startDate)}${config.basic.endDate && config.basic.endDate !== config.basic.startDate ? ` – ${formatDate(config.basic.endDate)}` : ""} · ${config.basic.city || "Venue TBA"} · ${config.details.timeControl?.toUpperCase() || "STANDARD"} · ${config.details.rounds || 0} rounds · 0 players`
                    : "Form description"
                  }
                />
              </div>

              {/* Questions List */}
              <div className="space-y-4">
                {(() => {
                  const visibleFieldsList = formConfig.fields.filter(f => f.isCustom || f.visible);
                  const totalVisibleCount = visibleFieldsList.length;
                  let visibleCount = 0;

                  return formConfig.fields.map((field, originalIdx) => {
                    const isHiddenSystemField = !field.isCustom && !field.visible;
                    if (isHiddenSystemField) return null;

                    const displayIdx = visibleCount;
                    visibleCount++;

                    const isFocused = focusedFieldId === field.id;
                  const isSystemField =
                    field.id === "firstName" ||
                    field.id === "lastName" ||
                    field.id === "email" ||
                    field.id === "sectionChoice" ||
                    field.id === "ratingProvider" ||
                    field.id === "entryFee" ||
                    field.id === "pairingNotifications" ||
                    field.id === "lookupSection" ||
                    field.id === "detailsSection" ||
                    field.id === "preferencesSection" ||
                    field.id === "checkoutSection" ||
                    field.id === "playerSearch" ||
                    field.id === "paymentFlow" ||
                    field.id === "playerIdentityHeading" ||
                    field.id === "contactInfoHeading" ||
                    field.id === "sectionRatingHeading";
                  
                  return (
                    <div 
                      key={field.id} 
                      id={`field-card-${field.id}`}
                      className="transition-all duration-200"
                    >
                      {isFocused ? (
                        /* GOOGLE FORMS ACTIVE STATE QUESTION CARD */
                        <div className="border-l-4 border-l-sky-500 bg-white border border-slate-200 shadow-md p-6 rounded-2xl space-y-4 animate-in fade-in duration-200">
                          {/* Top Row: Title & Question Type Dropdown */}
                          <div className="flex items-start gap-4">
                            <Input
                              value={field.label}
                              onChange={(e) => updateField(field.id, { label: e.target.value })}
                              placeholder="Question"
                              className="text-base font-bold text-slate-800 border-b border-b-slate-200 hover:border-b-slate-355 focus:border-b-sky-500 focus:ring-0 px-2 py-1.5 h-10 bg-slate-50 border-t-0 border-l-0 border-r-0 rounded-t-lg rounded-b-none flex-1"
                            />
                            
                            <Select
                              value={field.type}
                              disabled={isSystemField}
                              onValueChange={(val: RegistrationFormField["type"]) => {
                                const defaultPlaceholders = {
                                  text: "Short answer text",
                                  paragraph: "Paragraph text",
                                  number: "Number input",
                                  select: undefined,
                                  radio: undefined,
                                  checkbox: undefined,
                                  boolean: "",
                                  date: "",
                                  time: "",
                                  section: "",
                                  heading: ""
                                };
                                updateField(field.id, {
                                  type: val,
                                  placeholder: defaultPlaceholders[val] || undefined,
                                  options: (val === "select" || val === "radio" || val === "checkbox") ? (field.options && field.options.length > 0 ? field.options : ["Option 1", "Option 2"]) : undefined
                                });
                              }}
                            >
                              <SelectTrigger className="w-[180px] h-10 text-xs border-slate-200 bg-white font-bold rounded-xl shrink-0">
                                <SelectValue placeholder="Question Type" />
                              </SelectTrigger>
                              <SelectContent className="rounded-xl">
                                <SelectItem value="text">Short answer</SelectItem>
                                <SelectItem value="paragraph">Paragraph</SelectItem>
                                <SelectItem value="number">Number</SelectItem>
                                <SelectItem value="select">Dropdown</SelectItem>
                                <SelectItem value="radio">Multiple Choice</SelectItem>
                                <SelectItem value="checkbox">Checkboxes</SelectItem>
                                <SelectItem value="boolean">Yes/No Toggle</SelectItem>
                                <SelectItem value="date">Date</SelectItem>
                                <SelectItem value="time">Time</SelectItem>
                                <SelectItem value="section">Section Divider</SelectItem>
                                <SelectItem value="heading">Heading / Title</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>

                          {/* Question Description / Helper Text */}
                          <div className="space-y-1">
                            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                              {(field.type === "section" || field.type === "heading") ? "Section Subtitle / Description" : "Helper Text"}
                            </label>
                            <Input
                              value={field.description ?? ""}
                              onChange={(e) => updateField(field.id, { description: e.target.value })}
                              placeholder={(field.type === "section" || field.type === "heading") ? "Subtitle or description for this page/step..." : "Explain or provide hints for this field..."}
                              className="h-8 text-xs border-transparent hover:border-slate-200 focus:border-sky-500 rounded-lg"
                            />
                          </div>

                          {/* Dynamic Inputs Based on Selected Type */}
                          <div className="pt-2">
                            {field.type === "text" && (
                              <div className="border-b border-dashed border-slate-300 pb-1 w-2/3">
                                <span className="text-xs text-slate-400 italic">Short answer text</span>
                              </div>
                            )}

                            {field.type === "paragraph" && (
                              <div className="border-b border-dashed border-slate-300 pb-1.5 w-full">
                                <span className="text-xs text-slate-400 italic">Long answer paragraph text</span>
                              </div>
                            )}

                            {field.type === "number" && (
                              <div className="border-b border-dashed border-slate-300 pb-1 w-1/3">
                                <span className="text-xs text-slate-400 italic">Numeric input</span>
                              </div>
                            )}

                            {field.type === "boolean" && (
                              <div className="flex items-center gap-2.5 bg-slate-50 border p-3 rounded-xl max-w-sm">
                                <div className="h-4.5 w-8 rounded-full bg-slate-200 border relative shrink-0" />
                                <span className="text-xs font-semibold text-slate-500">Yes/No checkbox toggle preview</span>
                              </div>
                            )}

                            {field.type === "date" && (
                              <div className="border border-slate-200 bg-slate-50/50 p-2.5 rounded-xl text-xs text-slate-500 w-48 flex justify-between items-center">
                                <span>Month, Day, Year</span>
                                <span className="text-slate-400">📅</span>
                              </div>
                            )}

                            {field.type === "time" && (
                              <div className="border border-slate-200 bg-slate-50/50 p-2.5 rounded-xl text-xs text-slate-500 w-32 flex justify-between items-center">
                                <span>-- : -- --</span>
                                <span className="text-slate-400">🕒</span>
                              </div>
                            )}

                            {field.type === "section" && (
                              <div className="bg-indigo-50/50 border border-indigo-200 border-dashed rounded-xl p-4 space-y-2">
                                <span className="text-[10px] font-bold text-indigo-650 uppercase tracking-wider block">Step / Page Divider</span>
                                <p className="text-xs text-slate-500 leading-relaxed font-medium">
                                  This block acts as a dynamic page/step break in the registration wizard. All fields located below this divider card will be automatically grouped into the next step/page of the signup form.
                                </p>
                              </div>
                            )}

                            {field.type === "heading" && (
                              <div className="bg-slate-50 border border-slate-200 border-dashed rounded-xl p-4 space-y-2">
                                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Heading / Text Block Preview</span>
                                <h3 className="text-sm font-extrabold text-slate-800">{field.label || "Untitled Heading"}</h3>
                                {field.description && (
                                  <p className="text-xs text-slate-500 font-medium leading-relaxed">{field.description}</p>
                                )}
                              </div>
                            )}

                            {/* Inline Options Editor for GForms Choice Types */}
                            {!isSystemField && (field.type === "select" || field.type === "radio" || field.type === "checkbox") && (
                              <div className="space-y-2.5">
                                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Options</span>
                                
                                <div className="space-y-1.5">
                                  {(field.options ?? []).map((option, optIdx) => (
                                    <div key={optIdx} className="flex items-center gap-2 group max-w-md">
                                      {field.type === "radio" && <div className="h-4 w-4 rounded-full border border-slate-300 flex-shrink-0" />}
                                      {field.type === "checkbox" && <div className="h-4 w-4 rounded border border-slate-300 flex-shrink-0" />}
                                      {field.type === "select" && <span className="text-xs text-slate-400 font-bold w-4">{optIdx + 1}.</span>}
                                      
                                      <Input
                                        value={option}
                                        onChange={(e) => {
                                          const newOptions = [...(field.options ?? [])];
                                          newOptions[optIdx] = e.target.value;
                                          updateField(field.id, { options: newOptions });
                                        }}
                                        className="h-8 text-xs border-transparent hover:border-slate-200 focus:border-sky-500 focus:ring-0 bg-transparent rounded-lg flex-1 font-semibold"
                                      />
                                      
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        onClick={() => {
                                          const newOptions = (field.options ?? []).filter((_, idx) => idx !== optIdx);
                                          updateField(field.id, { options: newOptions });
                                        }}
                                        className="h-7 w-7 text-slate-400 hover:text-red-500 rounded-lg hover:bg-slate-100 shrink-0"
                                      >
                                        <X className="h-3.5 w-3.5" />
                                      </Button>
                                    </div>
                                  ))}
                                </div>

                                <div className="pt-1 flex items-center gap-3">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const nextOpts = [...(field.options ?? []), `Option ${(field.options ?? []).length + 1}`];
                                      updateField(field.id, { options: nextOpts });
                                    }}
                                    className="text-xs font-bold text-sky-650 hover:text-sky-700 hover:underline"
                                  >
                                    + Add Option
                                  </button>
                                </div>
                              </div>
                            )}

                            {/* System field info notice (core identity / system blocks) */}
                            {isSystemField && (
                              <div className="rounded-xl border border-sky-200 bg-sky-50/60 p-3.5 flex items-start gap-2.5">
                                <span className="text-sky-500 text-lg leading-none mt-0.5">ℹ</span>
                                <p className="text-xs text-sky-700 font-semibold leading-relaxed">
                                  {field.id === "firstName"
                                    ? "This block collects the participant's first name, integrated with database lookup systems."
                                    : field.id === "lastName"
                                    ? "This block collects the participant's last name, integrated with database lookup systems."
                                    : field.id === "email"
                                    ? "This block collects the participant's email address for registration confirmations and notifications."
                                    : field.id === "sectionChoice"
                                    ? "This block presents section options automatically based on sections configured for this tournament."
                                    : field.id === "ratingProvider"
                                    ? "This block controls selection of official rating databases (USCF, FIDE, etc.)."
                                    : field.id === "entryFee"
                                    ? "This block is controlled by the Entry Fees you configure in tournament settings. Its options are generated automatically."
                                    : field.id === "pairingNotifications"
                                    ? "This block lets players subscribe to email/text notifications for pairings and results. It is rendered by the system."
                                    : field.id === "lookupSection"
                                    ? "This starts the Player Profile Lookup page/step. It contains first/last name, email, section, and rating lookup options."
                                    : field.id === "detailsSection"
                                    ? "This starts the Contact Information page/step, prompting for mailing address and contact details."
                                    : field.id === "preferencesSection"
                                    ? "This starts the Preferences page/step, prompting for bye requests, arrival times, and pairing notification settings."
                                    : field.id === "checkoutSection"
                                    ? "This starts the Checkout/Review page/step, prompting the user for payment and final confirmation."
                                    : field.id === "playerIdentityHeading"
                                    ? "This heading introduces the Player Identity section (first name, last name, federation IDs)."
                                    : field.id === "contactInfoHeading"
                                    ? "This heading introduces the Contact Information section (email address)."
                                    : field.id === "sectionRatingHeading"
                                    ? "This heading introduces the Section & Rating preferences."
                                    : "This is a system configuration block."}
                                </p>
                              </div>
                            )}
                          </div>

                          {/* Bottom Action Footer Row of Active Card */}
                          <div className="flex items-center justify-between border-t pt-3 mt-2 text-slate-400">
                            <div className="flex items-center gap-1">
                              <Button
                                type="button"
                                disabled={displayIdx === 0}
                                onClick={() => moveField(originalIdx, "up")}
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-slate-400 hover:text-slate-900 rounded-lg"
                              >
                                <ChevronUp className="h-4 w-4" />
                              </Button>
                              <Button
                                type="button"
                                disabled={displayIdx === totalVisibleCount - 1}
                                onClick={() => moveField(originalIdx, "down")}
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-slate-400 hover:text-slate-900 rounded-lg"
                              >
                                <ChevronDown className="h-4 w-4" />
                              </Button>
                            </div>

                            <div className="flex items-center gap-4 font-semibold">
                              <button
                                type="button"
                                onClick={() => duplicateField(field, originalIdx)}
                                className="flex items-center gap-1.5 text-xs font-bold hover:text-slate-700 transition"
                                title="Duplicate question"
                              >
                                <Copy className="h-3.5 w-3.5" />
                                Duplicate
                              </button>

                              <button
                                type="button"
                                onClick={() => removeField(field.id)}
                                className="flex items-center gap-1.5 text-xs font-bold hover:text-red-655 transition text-red-500"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                                Delete
                              </button>

                              <div className="h-4 border-l border-slate-200" />

                              {field.type !== "section" && (
                                <div className="flex items-center gap-2">
                                  <span className="text-xs font-bold text-slate-500">Required</span>
                                  <Switch
                                    checked={field.required}
                                    onCheckedChange={(v) => updateField(field.id, { required: v, visible: v ? true : field.visible })}
                                    className="scale-90 data-[state=checked]:bg-sky-500"
                                  />
                                </div>
                              )}

                              <div className="flex items-center gap-2">
                                <span className="text-xs font-bold text-slate-500">Visible</span>
                                <Switch
                                  checked={field.visible}
                                  onCheckedChange={(v) => updateField(field.id, { visible: v, required: v ? field.required : false })}
                                  className="scale-90 data-[state=checked]:bg-sky-500"
                                  disabled={field.required} // required fields must be visible
                                />
                              </div>
                            </div>
                          </div>
                        </div>
                      ) : (
                        /* COLLAPSED INACTIVE CARD PREVIEW */
                        <div 
                          onClick={() => setFocusedFieldId(field.id)}
                          className={`bg-white hover:bg-slate-50/50 border border-slate-200 shadow-sm p-4 rounded-xl cursor-pointer transition-all flex items-center justify-between gap-4 ${
                            !field.visible ? "opacity-60 bg-slate-50/20" : ""
                          }`}
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <span className="text-xs font-bold text-slate-400 shrink-0">#{displayIdx + 1}</span>
                            <span className="text-sm font-bold text-slate-800 truncate">
                              {field.label || "Untitled Question"}
                            </span>
                            {field.required && (
                              <span className="text-red-500 font-extrabold text-xs shrink-0" title="Required">*</span>
                            )}
                            {!field.visible && (
                              <span className="bg-slate-100 text-slate-400 text-[9px] font-bold px-1.5 py-0.5 border rounded-full shrink-0">
                                Hidden
                              </span>
                            )}
                            {field.type === "section" && (
                              <span className="bg-indigo-50 text-indigo-700 text-[9px] font-extrabold px-1.5 py-0.5 border border-indigo-200 rounded-full shrink-0">
                                Step / Page Divider
                              </span>
                            )}
                          </div>

                          <div className="flex items-center gap-3 shrink-0">
                            <span className="text-[10px] font-extrabold bg-slate-100 text-slate-500 px-2 py-0.5 rounded border border-slate-200 capitalize">
                              {field.type === "select" ? "dropdown" : field.type === "boolean" ? "yes/no" : field.type}
                            </span>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                });
              })()}
              </div>
            </div>
          ) : (
            /* TAB 2: SETTINGS (PRESERVED ALL EXISTING POLICIES AND STYLINGS) */
            <div className="space-y-6 pb-24">
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
                      <Label className="text-sm font-bold text-slate-800">Collect Prize Payout Details</Label>
                      <p className="text-xs text-slate-500 leading-normal font-semibold">Ask players for their Stripe email and bank info during registration to facilitate direct payouts.</p>
                    </div>
                    <Switch
                      checked={config.registers?.collectPrizePayoutDetails !== false}
                      onCheckedChange={(checked) => handleRegistersChange("collectPrizePayoutDetails", checked)}
                    />
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
        </div>

        {/* Google Forms-style Sticky Right Floating Toolbar */}
        {activeSubTab === "questions" && (
          <div className="sticky top-6 flex flex-col items-center gap-3 p-2 bg-white border border-slate-200 shadow-md rounded-2xl shrink-0 w-12 animate-in fade-in duration-300">
            {/* Live Preview (Eye Icon) */}
            {tournamentSlug && (
              <a
                href={`/tournaments/${tournamentSlug}/register`}
                target="_blank"
                rel="noopener noreferrer"
                className="h-8 w-8 rounded-lg hover:bg-slate-100 text-slate-650 hover:text-sky-600 transition flex items-center justify-center shrink-0"
                title="Preview registration form"
              >
                <Eye className="h-4.5 w-4.5" />
              </a>
            )}

            <div className="w-6 border-t border-slate-200" />

            {/* Add question */}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded-lg hover:bg-slate-100 hover:text-sky-600 transition"
              title="Add Question"
              onClick={() => addCustomQuestionWithType("text")}
            >
              <Plus className="h-4.5 w-4.5 text-slate-600 hover:text-sky-600" />
            </Button>

            {/* Add Standard Field */}
            {(() => {
              const hiddenStandardFields = deletableSystemFields.filter(
                (field) => formConfig.fields.some((f) => f.id === field.id && !f.visible)
              );
              if (hiddenStandardFields.length === 0) return null;
              return (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 rounded-lg hover:bg-slate-100 hover:text-sky-600 transition"
                      title="Add Standard Field"
                    >
                      <ListPlus className="h-4.5 w-4.5 text-slate-600 hover:text-sky-600" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="rounded-xl w-48 max-h-72 overflow-y-auto bg-white border border-slate-200 shadow-lg p-1">
                    {hiddenStandardFields.map((field) => (
                      <DropdownMenuItem
                        key={field.id}
                        onClick={() => restoreSystemField(field.id)}
                        className="text-xs font-bold text-slate-750 cursor-pointer rounded-lg hover:bg-slate-50 px-2 py-1.5 focus:bg-slate-50 focus:text-slate-900 outline-none"
                      >
                        {field.label}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              );
            })()}

            {/* Add heading/title */}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded-lg hover:bg-slate-100 hover:text-sky-600 transition"
              title="Add Heading / Title"
              onClick={() => addCustomQuestionWithType("heading")}
            >
              <Type className="h-4.5 w-4.5 text-slate-600 hover:text-sky-600" />
            </Button>

            {/* Add section divider */}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded-lg hover:bg-slate-100 hover:text-sky-600 transition"
              title="Add Section Divider"
              onClick={() => addCustomQuestionWithType("section")}
            >
              <SeparatorHorizontal className="h-4.5 w-4.5 text-slate-600 hover:text-sky-600" />
            </Button>

            <div className="w-6 border-t border-slate-200" />

            {/* Import JSON */}
            <input ref={importRef} type="file" accept=".json" className="hidden" onChange={handleImportFile} />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded-lg hover:bg-slate-100 hover:text-sky-600 transition"
              title="Import Form"
              onClick={handleImportClick}
            >
              <FileUp className="h-4.5 w-4.5 text-slate-600" />
            </Button>

            {/* Export JSON */}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded-lg hover:bg-slate-100 hover:text-sky-600 transition"
              title="Export Form"
              onClick={handleExport}
            >
              <FileDown className="h-4.5 w-4.5 text-slate-600" />
            </Button>
          </div>
        )}
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
