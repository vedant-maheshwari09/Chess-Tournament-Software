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
  Eye
} from "lucide-react";
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

  // Parse or default the registration form configuration
  const formConfig = useMemo((): RegistrationFormConfig => {
    return config.registrationFormConfig ?? {
      fields: DEFAULT_REGISTRATION_FIELDS.map(f => ({ ...f })),
    };
  }, [config.registrationFormConfig]);

  const updateFormConfig = (next: RegistrationFormConfig) => {
    onConfigChange({ ...config, registrationFormConfig: next });
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
      section: "Untitled Section Divider"
    };

    const newField: RegistrationFormField = {
      id: `${type === "section" ? "section" : "custom"}_${Date.now()}`,
      label: defaultLabels[type] || "Untitled Question",
      type,
      placeholder: (type === "text" || type === "number" || type === "paragraph") ? "Short answer text" : undefined,
      description: type === "section" ? "Section description (optional)" : "Question helper text",
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
    updateFormConfig({ ...formConfig, fields: formConfig.fields.filter((f) => f.id !== id) });
    if (focusedFieldId === id) setFocusedFieldId(null);
    toast({
      title: "Removed",
      description: "Item removed from registration form."
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
    onConfigChange({
      ...config,
      registers: {
        ...config.registers,
        [key]: value
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
                  defaultValue="Chess Registration Form"
                  placeholder="Form Title"
                />
                <textarea
                  className="w-full text-sm text-slate-500 border-transparent hover:border-slate-200 focus:border-sky-500 focus:outline-none px-1 py-1 h-auto bg-transparent rounded-lg resize-none"
                  rows={2}
                  defaultValue="Description"
                  placeholder="Form description"
                />
              </div>

              {/* Questions List */}
              <div className="space-y-4">
                {formConfig.fields.map((field, idx) => {
                  const isFocused = focusedFieldId === field.id;
                  
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
                                  section: ""
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
                              </SelectContent>
                            </Select>
                          </div>

                          {/* Question Description / Helper Text */}
                          {field.type !== "section" && (
                            <div className="space-y-1">
                              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Helper Text</label>
                              <Input
                                value={field.description ?? ""}
                                onChange={(e) => updateField(field.id, { description: e.target.value })}
                                placeholder="Explain or provide hints for this field..."
                                className="h-8 text-xs border-transparent hover:border-slate-200 focus:border-sky-500 rounded-lg"
                              />
                            </div>
                          )}

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
                              <div className="bg-slate-50 border border-slate-200 border-dashed rounded-xl p-4 space-y-2">
                                <span className="text-[10px] font-bold text-sky-600 uppercase tracking-wider block">Visual Section Divider</span>
                                <p className="text-xs text-slate-500 leading-relaxed font-medium">
                                  This block splits your form with a clean separator line. It displays the section name in bold to organize the layout.
                                </p>
                              </div>
                            )}

                            {/* Inline Options Editor for GForms Choice Types */}
                            {(field.type === "select" || field.type === "radio" || field.type === "checkbox") && (
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
                          </div>

                          {/* Bottom Action Footer Row of Active Card */}
                          <div className="flex items-center justify-between border-t pt-3 mt-2 text-slate-400">
                            <div className="flex items-center gap-1">
                              <Button
                                type="button"
                                disabled={idx === 0}
                                onClick={() => moveField(idx, "up")}
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-slate-400 hover:text-slate-900 rounded-lg"
                              >
                                <ChevronUp className="h-4 w-4" />
                              </Button>
                              <Button
                                type="button"
                                disabled={idx === formConfig.fields.length - 1}
                                onClick={() => moveField(idx, "down")}
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-slate-400 hover:text-slate-900 rounded-lg"
                              >
                                <ChevronDown className="h-4 w-4" />
                              </Button>
                            </div>

                            <div className="flex items-center gap-4">
                              <button
                                type="button"
                                onClick={() => duplicateField(field, idx)}
                                className="flex items-center gap-1.5 text-xs font-bold hover:text-slate-700 transition"
                                title="Duplicate question"
                              >
                                <Copy className="h-3.5 w-3.5" />
                                Duplicate
                              </button>

                              {/* Only allow deleting custom fields or specific editable fields */}
                              {(field.isCustom || field.prebuiltType) && (
                                <button
                                  type="button"
                                  onClick={() => removeField(field.id)}
                                  className="flex items-center gap-1.5 text-xs font-bold hover:text-red-655 transition text-red-500"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                  Delete
                                </button>
                              )}

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
                            <span className="text-xs font-bold text-slate-400 shrink-0">#{idx + 1}</span>
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
                              <span className="bg-slate-100 text-indigo-700 text-[9px] font-extrabold px-1.5 py-0.5 border border-indigo-200 rounded-full shrink-0">
                                Section Divider
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
                })}
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
                      <Label className="text-sm font-bold text-slate-800">Show on Calendar</Label>
                      <p className="text-xs text-slate-500 leading-normal font-semibold">Make this tournament visible on the public event calendar.</p>
                    </div>
                    <Switch
                      checked={Boolean(config.registers?.showOnCalendar)}
                      onCheckedChange={(checked) => handleRegistersChange("showOnCalendar", checked)}
                    />
                  </div>

                  <div className="flex items-center justify-between border-t pt-4">
                    <div className="space-y-0.5">
                      <Label className="text-sm font-bold text-slate-800">Allow Online Registrations</Label>
                      <p className="text-xs text-slate-500 leading-normal font-semibold">Allow users to register and sign up for this tournament online.</p>
                    </div>
                    <Switch
                      checked={Boolean(config.registers?.allowSignup)}
                      onCheckedChange={(checked) => handleRegistersChange("allowSignup", checked)}
                    />
                  </div>

                  <div className="flex items-center justify-between border-t pt-4">
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

              {/* USCF Verification */}
              <Card className="rounded-2xl border bg-white shadow-sm overflow-hidden">
                <CardHeader className="bg-slate-50/50 p-5 border-b">
                  <CardTitle className="text-base font-extrabold text-slate-900 flex items-center gap-2">
                    <CheckSquare className="h-4.5 w-4.5 text-slate-500" />
                    USCF Verification & Auto-Accept
                  </CardTitle>
                  <CardDescription className="text-xs font-semibold text-slate-500 font-sans">Automate registry verification and player approvals.</CardDescription>
                </CardHeader>
                <CardContent className="p-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label className="text-sm font-bold text-slate-800">Verify USCF Membership</Label>
                      <p className="text-xs text-slate-500 leading-normal font-semibold">Force lookups against active US Chess registries during registration.</p>
                    </div>
                    <Switch
                      checked={Boolean(config.registers?.verifyUscfMembership)}
                      onCheckedChange={(checked) => handleRegistersChange("verifyUscfMembership", checked)}
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

            {/* Add section header */}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded-lg hover:bg-slate-100 hover:text-sky-600 transition"
              title="Add Section Divider"
              onClick={() => addCustomQuestionWithType("section")}
            >
              <Type className="h-4.5 w-4.5 text-slate-600 hover:text-sky-600" />
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
