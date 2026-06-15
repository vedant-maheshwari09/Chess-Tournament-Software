import React, { useState, useEffect, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { 
  Plus, 
  Trash2, 
  Eye, 
  EyeOff, 
  ChevronDown, 
  FileUp, 
  FileDown,
  ArrowLeft,
  ChevronRight,
  Check,
  Users,
  CreditCard,
  UserPlus
} from "lucide-react";
import { 
  DEFAULT_REGISTRATION_FIELDS, 
  type RegistrationFormConfig, 
  type RegistrationFormField,
  type TournamentConfig
} from "@/lib/tournament-config";

// Local helper functions
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
  actions?: React.ReactNode; // Slot for custom actions (like Save button)
}

interface PreviewPlayer {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  section: string;
  rating: string;
  uscfId?: string;
  fideId?: string;
  // Step 2 values
  address1?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
  arrivalTime?: string;
  byePreference?: "none" | "yes";
  byeRounds?: string[];
  notes?: string;
  customAnswers?: Record<string, any>;
}

export function RegistrationFormCustomizer({ config, onConfigChange, actions }: RegistrationFormCustomizerProps) {
  const { toast } = useToast();
  const [showPreview, setShowPreview] = useState(true);
  const importRef = React.useRef<HTMLInputElement>(null);

  const formConfig: RegistrationFormConfig = config.registrationFormConfig ?? {
    fields: DEFAULT_REGISTRATION_FIELDS.map(f => ({ ...f })),
  };

  const standardFields = formConfig.fields.filter((f) => !f.isCustom);
  const customFields = formConfig.fields.filter((f) => f.isCustom);

  const updateFormConfig = (next: RegistrationFormConfig) => {
    onConfigChange({ ...config, registrationFormConfig: next });
  };

  const updateField = (id: string, updates: Partial<RegistrationFormField>) => {
    const next = formConfig.fields.map((f) => (f.id === id ? { ...f, ...updates } : f));
    updateFormConfig({ ...formConfig, fields: next });
  };

  const addCustomField = () => {
    const newField: RegistrationFormField = {
      id: `custom_${Date.now()}`,
      label: "New Question",
      type: "text",
      required: false,
      visible: true,
      isCustom: true,
    };
    updateFormConfig({ ...formConfig, fields: [...formConfig.fields, newField] });
  };

  const removeCustomField = (id: string) => {
    updateFormConfig({ ...formConfig, fields: formConfig.fields.filter((f) => f.id !== id) });
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
      toast({ title: "Imported", description: "Form configuration applied." });
    } catch {
      toast({ title: "Import failed", description: "Invalid JSON file.", variant: "destructive" });
    } finally {
      if (e.target) e.target.value = "";
    }
  };

  // --- INTERACTIVE PREVIEW STATE ---
  const [previewStep, setPreviewStep] = useState(1);
  const [previewDrafts, setPreviewDrafts] = useState<PreviewPlayer[]>([]);
  
  // Current player input state
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [section, setSection] = useState("");
  const [rating, setRating] = useState("");
  const [uscfId, setUscfId] = useState("");
  const [fideId, setFideId] = useState("");
  
  // Step 2 input state
  const [address1, setAddress1] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [country, setCountry] = useState("United States");
  const [arrivalTime, setArrivalTime] = useState("");
  const [byePreference, setByePreference] = useState<"none" | "yes">("none");
  const [byeRounds, setByeRounds] = useState<string[]>([]);
  const [notes, setNotes] = useState("");
  const [customAnswers, setCustomAnswers] = useState<Record<string, any>>({});

  const multiPlayerAllowed = Boolean(config.registers?.allowMultiPlayerSignup);
  const sectionsList = useMemo(() => {
    if (config.sections && config.sections.length > 0) {
      return config.sections.map(s => s.name);
    }
    return ["Premier Open", "Under 2000", "Under 1600"];
  }, [config.sections]);

  // Set default section Choice in preview
  useEffect(() => {
    if (sectionsList.length > 0 && !section) {
      setSection(sectionsList[0]);
    }
  }, [sectionsList, section]);

  const clearForm = () => {
    setFirstName("");
    setLastName("");
    setEmail("");
    setRating("");
    setUscfId("");
    setFideId("");
    setAddress1("");
    setCity("");
    setState("");
    setPostalCode("");
    setCountry("United States");
    setArrivalTime("");
    setByePreference("none");
    setByeRounds([]);
    setNotes("");
    setCustomAnswers({});
  };

  const handleAddPlayerToRoster = () => {
    if (!firstName.trim() || !lastName.trim() || !email.trim()) {
      toast({
        title: "Validation Error",
        description: "First name, last name, and email are required to add a player.",
        variant: "destructive"
      });
      return;
    }

    const newPlayer: PreviewPlayer = {
      id: `preview_${Date.now()}`,
      firstName,
      lastName,
      email,
      section,
      rating: rating || "Unrated",
      uscfId,
      fideId,
      address1,
      city,
      state,
      postalCode,
      country,
      arrivalTime,
      byePreference,
      byeRounds,
      notes,
      customAnswers: { ...customAnswers }
    };

    setPreviewDrafts(prev => [...prev, newPlayer]);
    clearForm();
    toast({
      title: "Player Added",
      description: `${firstName} ${lastName} added to the registration list.`
    });
  };

  const handleRemovePlayer = (id: string) => {
    setPreviewDrafts(prev => prev.filter(p => p.id !== id));
  };

  const handlePreviewSubmit = () => {
    let playersCount = previewDrafts.length;
    
    // If we have text in the current form, we treat it as the current active player
    const hasActivePlayer = firstName.trim() && lastName.trim() && email.trim();
    if (hasActivePlayer) {
      playersCount += 1;
    }

    if (playersCount === 0) {
      toast({
        title: "Submit Failed",
        description: "You must add at least one player to submit registration.",
        variant: "destructive"
      });
      return;
    }

    toast({
      title: "Registration Success (Simulation)",
      description: `Successfully simulated registration for ${playersCount} player(s)!`
    });

    // Reset everything
    setPreviewDrafts([]);
    clearForm();
    setPreviewStep(1);
  };

  const handleNextStep = () => {
    if (previewStep === 1) {
      // Validate current form if no players are in draft
      if (previewDrafts.length === 0 && (!firstName.trim() || !lastName.trim() || !email.trim())) {
        toast({
          title: "Validation Error",
          description: "Please fill in the required fields (First name, Last name, Email) or add a player to the roster.",
          variant: "destructive"
        });
        return;
      }
    }
    setPreviewStep(prev => prev + 1);
  };

  const handlePrevStep = () => {
    setPreviewStep(prev => prev - 1);
  };

  const handleToggleByeRound = (round: string) => {
    setByeRounds(prev => 
      prev.includes(round) ? prev.filter(r => r !== round) : [...prev, round]
    );
  };

  return (
    <div className="rounded-2xl border bg-white p-6 space-y-6 shadow-sm border-slate-200/60">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <h3 className="text-base font-semibold text-black">Registration Form Builder</h3>
          <p className="text-sm text-slate-500">Configure standard & custom signup questions, then test the interactive flow.</p>
        </div>
        <div className="flex items-center gap-2">
          <input ref={importRef} type="file" accept=".json" className="hidden" onChange={handleImportFile} />
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1.5 text-xs h-8 border-slate-200"
            onClick={handleImportClick}
          >
            <FileUp className="h-3.5 w-3.5" />
            Import
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1.5 text-xs h-8 border-slate-200"
            onClick={handleExport}
          >
            <FileDown className="h-3.5 w-3.5" />
            Export
          </Button>
          <Button
            type="button"
            variant={showPreview ? "default" : "outline"}
            size="sm"
            className="gap-1.5 text-xs h-8 border-slate-200"
            onClick={() => setShowPreview((v) => !v)}
          >
            {showPreview ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            {showPreview ? "Hide Preview" : "Preview Form"}
          </Button>
        </div>
      </div>

      <div className={`grid gap-6 ${showPreview ? "lg:grid-cols-2" : "grid-cols-1"}`}>
        {/* Left: Configuration */}
        <div className="space-y-6">
          {/* Standard Fields */}
          <div className="space-y-3">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Standard Fields</p>
            <div className="space-y-2">
              {standardFields.map((field) => (
                <div
                  key={field.id}
                  className={`flex items-center gap-3 rounded-xl border px-4 py-3 transition-all ${
                    field.visible ? "bg-white border-slate-200 shadow-sm" : "bg-slate-50 border-slate-100 opacity-60"
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-800 truncate">{field.label}</p>
                    <p className="text-[11px] text-slate-400 capitalize">{field.type}</p>
                  </div>
                  <div className="flex items-center gap-4 flex-shrink-0">
                    <div className="flex items-center gap-1.5">
                      <Switch
                        id={`std-vis-${field.id}`}
                        checked={field.visible}
                        onCheckedChange={(v) => updateField(field.id, { visible: v, required: v ? field.required : false })}
                        className="scale-75 origin-right"
                      />
                      <label htmlFor={`std-vis-${field.id}`} className="text-[11px] text-slate-500 cursor-pointer">Show</label>
                    </div>
                    {field.visible && (
                      <div className="flex items-center gap-1.5">
                        <Switch
                          id={`std-req-${field.id}`}
                          checked={field.required}
                          onCheckedChange={(v) => updateField(field.id, { required: v })}
                          className="scale-75 origin-right"
                        />
                        <label htmlFor={`std-req-${field.id}`} className="text-[11px] text-slate-500 cursor-pointer">Required</label>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Custom Fields */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Custom Questions</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-1.5 text-xs h-7 border-dashed border-slate-300 text-slate-600 hover:text-black"
                onClick={addCustomField}
              >
                <Plus className="h-3 w-3" />
                Add Question
              </Button>
            </div>
            {customFields.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/40 px-4 py-5 text-center">
                <p className="text-xs text-slate-400">No custom questions yet. Click "Add Question" to create one.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {customFields.map((field) => (
                  <div key={field.id} className="rounded-xl border border-slate-200 bg-white p-4 space-y-3 shadow-sm">
                    <div className="flex items-center gap-2">
                      <Input
                        value={field.label}
                        onChange={(e) => updateField(field.id, { label: e.target.value })}
                        placeholder="Question label..."
                        className="flex-1 h-8 text-sm border-slate-200"
                      />
                      <Select
                        value={field.type}
                        onValueChange={(v) => updateField(field.id, { type: v as RegistrationFormField["type"] })}
                      >
                        <SelectTrigger className="w-28 h-8 text-xs border-slate-200">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="text">Text</SelectItem>
                          <SelectItem value="number">Number</SelectItem>
                          <SelectItem value="boolean">Checkbox</SelectItem>
                          <SelectItem value="select">Dropdown</SelectItem>
                        </SelectContent>
                      </Select>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-red-400 hover:text-red-600 hover:bg-red-50 flex-shrink-0"
                        onClick={() => removeCustomField(field.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                    {field.type === "select" && (
                      <div className="space-y-1">
                        <label className="text-[10px] font-medium text-slate-400">Options (comma-separated)</label>
                        <Input
                          value={(field.options ?? []).join(", ")}
                          onChange={(e) =>
                            updateField(field.id, {
                              options: e.target.value.split(",").map((s) => s.trim()).filter(Boolean),
                            })
                          }
                          placeholder="Option A, Option B, Option C"
                          className="h-8 text-xs border-slate-200"
                        />
                      </div>
                    )}
                    <div className="flex items-center gap-4">
                      <div className="flex items-center gap-1.5">
                        <Switch
                          id={`cust-req-${field.id}`}
                          checked={field.required}
                          onCheckedChange={(v) => updateField(field.id, { required: v })}
                          className="scale-75 origin-left"
                        />
                        <label htmlFor={`cust-req-${field.id}`} className="text-[11px] text-slate-500 cursor-pointer">Required</label>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right: Live Preview */}
        {showPreview && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Form Preview</p>
              <div className="flex items-center gap-1">
                {[1, 2, 3].map((step) => (
                  <div 
                    key={step} 
                    className={`h-1.5 w-8 rounded-full transition-colors ${
                      previewStep === step ? "bg-indigo-600" : previewStep > step ? "bg-indigo-300" : "bg-slate-200"
                    }`} 
                  />
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50/60 p-5 space-y-4 max-h-[680px] overflow-y-auto shadow-inner">
              
              {/* Drafts Summary Header for Multi-Player Sign Up */}
              {multiPlayerAllowed && previewStep < 3 && (
                <div className="bg-indigo-50/80 border border-indigo-100 rounded-xl p-4.5 space-y-3 shadow-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-indigo-900 flex items-center gap-1.5">
                      <Users className="h-4 w-4 text-indigo-600" />
                      Registration Roster ({previewDrafts.length} Saved)
                    </span>
                    {previewStep === 1 && (
                      <Button
                        type="button"
                        size="sm"
                        onClick={handleAddPlayerToRoster}
                        className="h-7 text-xs bg-indigo-600 hover:bg-indigo-700 font-bold"
                      >
                        <UserPlus className="h-3 w-3 mr-1" />
                        Add Player
                      </Button>
                    )}
                  </div>
                  {previewDrafts.length > 0 ? (
                    <div className="flex flex-wrap gap-2 max-h-24 overflow-y-auto">
                      {previewDrafts.map((player) => (
                        <div key={player.id} className="flex items-center gap-1.5 bg-white border border-slate-200 rounded-full pl-2.5 pr-1.5 py-0.5 text-xs text-slate-800 font-semibold shadow-sm">
                          <span>{player.firstName} {player.lastName.slice(0, 1)}.</span>
                          <button 
                            type="button" 
                            onClick={() => handleRemovePlayer(player.id)}
                            className="text-red-400 hover:text-red-600 transition"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-[11px] text-indigo-600/80 italic font-medium">No players added to roster yet. Fill in details and click "Add Player".</p>
                  )}
                </div>
              )}

              {/* STEP 1: IDENTITY & VERIFICATION */}
              {previewStep === 1 && (
                <div className="space-y-4">
                  <div className="border-b pb-2">
                    <p className="text-sm font-semibold text-slate-800">Step 1: Player Profile</p>
                    <p className="text-xs text-slate-400">Specify details for the player being signed up.</p>
                  </div>
                  <div className="space-y-3">
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-slate-600">First Name <span className="text-red-500">*</span></label>
                      <Input
                        value={firstName}
                        onChange={(e) => setFirstName(e.target.value)}
                        placeholder="Player's first name"
                        className="h-9 text-xs border-slate-200 bg-white"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-slate-600">Last Name <span className="text-red-500">*</span></label>
                      <Input
                        value={lastName}
                        onChange={(e) => setLastName(e.target.value)}
                        placeholder="Player's last name"
                        className="h-9 text-xs border-slate-200 bg-white"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-slate-600">Email Address <span className="text-red-500">*</span></label>
                      <Input
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="your@email.com"
                        type="email"
                        className="h-9 text-xs border-slate-200 bg-white"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-slate-600">Rating (Estimated/Official)</label>
                      <Input
                        value={rating}
                        onChange={(e) => setRating(e.target.value)}
                        placeholder="e.g. 1600"
                        className="h-9 text-xs border-slate-200 bg-white"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-slate-600">Tournament Section</label>
                      <Select value={section} onValueChange={setSection}>
                        <SelectTrigger className="h-9 text-xs border-slate-200 bg-white">
                          <SelectValue placeholder="Select section..." />
                        </SelectTrigger>
                        <SelectContent>
                          {sectionsList.map(s => (
                            <SelectItem key={s} value={s}>{s}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    {/* Standard visible verification IDs */}
                    {formConfig.fields.find(f => f.id === "uscfId")?.visible && (
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-slate-600">
                          {formConfig.fields.find(f => f.id === "uscfId")?.label}
                          {formConfig.fields.find(f => f.id === "uscfId")?.required && <span className="text-red-500 ml-0.5">*</span>}
                        </label>
                        <Input
                          value={uscfId}
                          onChange={(e) => setUscfId(e.target.value)}
                          placeholder="e.g. 12345678"
                          className="h-9 text-xs border-slate-200 bg-white"
                        />
                      </div>
                    )}
                    {formConfig.fields.find(f => f.id === "fideId")?.visible && (
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-slate-600">
                          {formConfig.fields.find(f => f.id === "fideId")?.label}
                          {formConfig.fields.find(f => f.id === "fideId")?.required && <span className="text-red-500 ml-0.5">*</span>}
                        </label>
                        <Input
                          value={fideId}
                          onChange={(e) => setFideId(e.target.value)}
                          placeholder="e.g. 1500021"
                          className="h-9 text-xs border-slate-200 bg-white"
                        />
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* STEP 2: DETAILS & CUSTOM QUESTIONS */}
              {previewStep === 2 && (
                <div className="space-y-4">
                  <div className="border-b pb-2">
                    <p className="text-sm font-semibold text-slate-800">Step 2: Preferences & Details</p>
                    <p className="text-xs text-slate-400">Additional options and specific requirements.</p>
                  </div>

                  {/* Standard visible address fields */}
                  {(formConfig.fields.find(f => f.id === "address1")?.visible || 
                    formConfig.fields.find(f => f.id === "city")?.visible || 
                    formConfig.fields.find(f => f.id === "state")?.visible || 
                    formConfig.fields.find(f => f.id === "postalCode")?.visible || 
                    formConfig.fields.find(f => f.id === "country")?.visible) && (
                    <div className="space-y-3">
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Mailing Address</p>
                      
                      {formConfig.fields.find(f => f.id === "address1")?.visible && (
                        <div className="space-y-1">
                          <label className="text-xs font-medium text-slate-600">
                            {formConfig.fields.find(f => f.id === "address1")?.label}
                            {formConfig.fields.find(f => f.id === "address1")?.required && <span className="text-red-500 ml-0.5">*</span>}
                          </label>
                          <Input
                            value={address1}
                            onChange={(e) => setAddress1(e.target.value)}
                            placeholder="Address 1"
                            className="h-9 text-xs border-slate-200 bg-white"
                          />
                        </div>
                      )}
                      
                      <div className="grid grid-cols-2 gap-3">
                        {formConfig.fields.find(f => f.id === "city")?.visible && (
                          <div className="space-y-1">
                            <label className="text-xs font-medium text-slate-600">City</label>
                            <Input
                              value={city}
                              onChange={(e) => setCity(e.target.value)}
                              placeholder="City"
                              className="h-9 text-xs border-slate-200 bg-white"
                            />
                          </div>
                        )}
                        {formConfig.fields.find(f => f.id === "state")?.visible && (
                          <div className="space-y-1">
                            <label className="text-xs font-medium text-slate-600">State</label>
                            <Input
                              value={state}
                              onChange={(e) => setState(e.target.value)}
                              placeholder="State"
                              className="h-9 text-xs border-slate-200 bg-white"
                            />
                          </div>
                        )}
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        {formConfig.fields.find(f => f.id === "postalCode")?.visible && (
                          <div className="space-y-1">
                            <label className="text-xs font-medium text-slate-600">Postal Code</label>
                            <Input
                              value={postalCode}
                              onChange={(e) => setPostalCode(e.target.value)}
                              placeholder="Postal Code"
                              className="h-9 text-xs border-slate-200 bg-white"
                            />
                          </div>
                        )}
                        {formConfig.fields.find(f => f.id === "country")?.visible && (
                          <div className="space-y-1">
                            <label className="text-xs font-medium text-slate-600">Country</label>
                            <Input
                              value={country}
                              onChange={(e) => setCountry(e.target.value)}
                              placeholder="Country"
                              className="h-9 text-xs border-slate-200 bg-white"
                            />
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Arrival Time */}
                  {formConfig.fields.find(f => f.id === "arrivalTime")?.visible && (
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-slate-600">
                        {formConfig.fields.find(f => f.id === "arrivalTime")?.label}
                        {formConfig.fields.find(f => f.id === "arrivalTime")?.required && <span className="text-red-500 ml-0.5">*</span>}
                      </label>
                      <Input
                        value={arrivalTime}
                        onChange={(e) => setArrivalTime(e.target.value)}
                        placeholder="e.g. Saturday 9AM"
                        className="h-9 text-xs border-slate-200 bg-white"
                      />
                    </div>
                  )}

                  {/* Bye preferences */}
                  {formConfig.fields.find(f => f.id === "byePreference")?.visible && (
                    <div className="space-y-2">
                      <label className="text-xs font-medium text-slate-600">Bye Requests</label>
                      <div className="flex gap-4">
                        <label className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer">
                          <input 
                            type="radio" 
                            name="byePref" 
                            checked={byePreference === "none"} 
                            onChange={() => setByePreference("none")} 
                          />
                          No byes
                        </label>
                        <label className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer">
                          <input 
                            type="radio" 
                            name="byePref" 
                            checked={byePreference === "yes"} 
                            onChange={() => setByePreference("yes")} 
                          />
                          Request byes
                        </label>
                      </div>
                      {byePreference === "yes" && (
                        <div className="flex flex-wrap gap-1.5 bg-white border rounded-lg p-2.5">
                          {["Round 1", "Round 2", "Round 3", "Round 4", "Round 5"].map(r => {
                            const checked = byeRounds.includes(r);
                            return (
                              <button
                                key={r}
                                type="button"
                                onClick={() => handleToggleByeRound(r)}
                                className={`text-[10px] px-2 py-1.5 rounded border font-semibold transition-all ${
                                  checked 
                                    ? "bg-indigo-600 border-indigo-600 text-white shadow-sm" 
                                    : "bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100"
                                }`}
                              >
                                {r}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Notes */}
                  {formConfig.fields.find(f => f.id === "notes")?.visible && (
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-slate-600">Notes / Request Description</label>
                      <textarea
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        placeholder="Additional requests or notes"
                        rows={2}
                        className="w-full text-xs border rounded-lg p-2 bg-white border-slate-200"
                      />
                    </div>
                  )}

                  {/* Newsletter */}
                  {formConfig.fields.find(f => f.id === "newsletter")?.visible && (
                    <label className="flex items-start gap-2 bg-white border border-slate-200/60 p-3 rounded-lg cursor-pointer">
                      <input 
                        type="checkbox" 
                        className="mt-0.5 rounded text-indigo-600 focus:ring-indigo-500" 
                      />
                      <div className="space-y-0.5">
                        <span className="block text-xs font-bold text-slate-800">{formConfig.fields.find(f => f.id === "newsletter")?.label}</span>
                        <span className="block text-[10px] text-slate-400">Receive bulletings, round reports, and notices.</span>
                      </div>
                    </label>
                  )}

                  {/* Custom fields */}
                  {customFields.length > 0 && (
                    <div className="space-y-3 pt-3 border-t">
                      <p className="text-xs font-bold text-slate-800">Additional Questions</p>
                      {customFields.map((field) => (
                        <div key={field.id} className="space-y-1">
                          <label className="text-xs font-medium text-slate-600">
                            {field.label || "Untitled Question"}
                            {field.required && <span className="text-red-500 ml-0.5">*</span>}
                          </label>
                          {field.type === "boolean" ? (
                            <label className="flex items-center gap-2 bg-white border p-3 rounded-lg cursor-pointer border-slate-200">
                              <input 
                                type="checkbox" 
                                checked={customAnswers[field.id] ?? false}
                                onChange={(e) => setCustomAnswers(prev => ({ ...prev, [field.id]: e.target.checked }))}
                                className="rounded text-indigo-600" 
                              />
                              <span className="text-xs text-slate-400">{field.label}</span>
                            </label>
                          ) : field.type === "select" && field.options?.length ? (
                            <Select 
                              value={customAnswers[field.id] ?? ""} 
                              onValueChange={(val) => setCustomAnswers(prev => ({ ...prev, [field.id]: val }))}
                            >
                              <SelectTrigger className="h-9 text-xs border-slate-200 bg-white">
                                <SelectValue placeholder="Choose an option..." />
                              </SelectTrigger>
                              <SelectContent>
                                {field.options.map(opt => (
                                  <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ) : (
                            <Input
                              type={field.type === "number" ? "number" : "text"}
                              value={customAnswers[field.id] ?? ""}
                              onChange={(e) => setCustomAnswers(prev => ({ ...prev, [field.id]: e.target.value }))}
                              placeholder={field.type === "number" ? "0" : `Enter ${field.label}...`}
                              className="h-9 text-xs border-slate-200 bg-white"
                            />
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* STEP 3: REVIEW & CONFIRMATION SUMMARY */}
              {previewStep === 3 && (
                <div className="space-y-4">
                  <div className="border-b pb-2">
                    <p className="text-sm font-semibold text-slate-800">Step 3: Review & Summary</p>
                    <p className="text-xs text-slate-400">Please review all players before final submission.</p>
                  </div>

                  {/* Summary of players */}
                  <div className="space-y-3">
                    {/* Combine preview drafts with current form values if not empty */}
                    {(() => {
                      const allPlayers = [...previewDrafts];
                      const activePlayer = firstName.trim() && lastName.trim() && email.trim();
                      if (activePlayer) {
                        allPlayers.push({
                          id: "active",
                          firstName,
                          lastName,
                          email,
                          section,
                          rating: rating || "Unrated",
                          uscfId,
                          fideId,
                          address1,
                          city,
                          state,
                          postalCode,
                          country,
                          arrivalTime,
                          byePreference,
                          byeRounds,
                          notes,
                          customAnswers: { ...customAnswers }
                        });
                      }

                      return (
                        <div className="space-y-3">
                          <div className="border border-slate-200 rounded-xl overflow-hidden bg-white shadow-sm divide-y">
                            <div className="bg-slate-50 px-4 py-2 text-xs font-bold text-slate-500">
                              Players ({allPlayers.length})
                            </div>
                            {allPlayers.map((p, idx) => (
                              <div key={p.id} className="p-4.5 space-y-2 text-xs">
                                <div className="flex items-center justify-between">
                                  <span className="font-bold text-slate-900">{idx + 1}. {p.firstName} {p.lastName}</span>
                                  <span className="bg-indigo-50 border border-indigo-100 text-indigo-700 font-semibold px-2 py-0.5 rounded text-[10px]">
                                    {p.section}
                                  </span>
                                </div>
                                <div className="grid grid-cols-2 gap-2 text-slate-500 leading-normal text-[11px]">
                                  <div>Email: <span className="font-medium text-slate-700">{p.email}</span></div>
                                  <div>Rating: <span className="font-medium text-slate-700">{p.rating}</span></div>
                                  {p.uscfId && <div>USCF ID: <span className="font-medium text-slate-700">{p.uscfId}</span></div>}
                                  {p.fideId && <div>FIDE ID: <span className="font-medium text-slate-700">{p.fideId}</span></div>}
                                  {p.byePreference === "yes" && p.byeRounds?.length && (
                                    <div className="col-span-2">Byes requested: <span className="font-semibold text-indigo-600">{p.byeRounds.join(", ")}</span></div>
                                  )}
                                </div>
                                
                                {/* Render custom answers summary */}
                                {p.customAnswers && Object.keys(p.customAnswers).length > 0 && (
                                  <div className="pt-2 border-t mt-2 bg-slate-50/50 p-2.5 rounded-lg border border-slate-100 space-y-1">
                                    <span className="block font-bold text-[10px] text-slate-400 uppercase tracking-wide">Custom Answers</span>
                                    {Object.entries(p.customAnswers).map(([qid, val]) => {
                                      const label = formConfig.fields.find(f => f.id === qid)?.label || qid;
                                      return (
                                        <div key={qid} className="text-[11px] flex justify-between">
                                          <span className="text-slate-500">{label}:</span>
                                          <span className="font-bold text-slate-700">{typeof val === "boolean" ? (val ? "Yes" : "No") : String(val)}</span>
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>

                          {/* Calculated fees */}
                          <div className="bg-white border rounded-xl p-4.5 space-y-3.5 shadow-sm border-slate-200">
                            <div className="text-xs font-bold text-slate-400 uppercase tracking-wide border-b pb-1.5">
                              Estimated Costs
                            </div>
                            <div className="text-xs space-y-2">
                              <div className="flex justify-between text-slate-500">
                                <span>Entry Fee ({allPlayers.length}x)</span>
                                <span className="font-semibold text-slate-800">${allPlayers.length * 50}.00</span>
                              </div>
                              <div className="flex justify-between text-slate-500">
                                <span>Processing Contribution</span>
                                <span className="font-semibold text-slate-800">$2.00</span>
                              </div>
                              <div className="flex justify-between text-sm font-bold text-slate-900 border-t pt-2">
                                <span>Total Simulated Fee</span>
                                <span className="text-indigo-600">${allPlayers.length * 50 + 2}.00</span>
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                </div>
              )}

              {/* Progress and Navigation Footer */}
              <div className="pt-4 border-t flex items-center justify-between gap-2">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">
                  Step {previewStep} of 3
                </span>
                <div className="flex items-center gap-2">
                  {previewStep > 1 && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handlePrevStep}
                      className="h-8 text-xs border-slate-200"
                    >
                      <ArrowLeft className="h-3.5 w-3.5 mr-1" />
                      Back
                    </Button>
                  )}

                  {previewStep < 3 ? (
                    <Button
                      type="button"
                      size="sm"
                      onClick={handleNextStep}
                      className="h-8 text-xs bg-slate-800 hover:bg-slate-900 text-white font-bold"
                    >
                      Continue
                      <ChevronRight className="h-3.5 w-3.5 ml-1" />
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      size="sm"
                      onClick={handlePreviewSubmit}
                      className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700 text-white font-bold"
                    >
                      <Check className="h-3.5 w-3.5 mr-1" />
                      Submit Simulation
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
      
      {actions && (
        <div className="border-t pt-5 flex items-center justify-end">
          {actions}
        </div>
      )}
    </div>
  );
}

export default RegistrationFormCustomizer;
