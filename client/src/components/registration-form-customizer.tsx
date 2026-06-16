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
  ChevronUp,
  FileUp, 
  FileDown,
  ArrowLeft,
  ChevronRight,
  Check,
  Users,
  CreditCard,
  UserPlus,
  GripVertical,
  Sparkles,
  School,
  GraduationCap,
  Shirt,
  User,
  Calendar,
  Globe,
  Settings,
  Mail,
  Clock,
  MapPin,
  Compass,
  LayoutGrid,
  // New icons for rich visuals:
  AlignLeft,
  Hash,
  ListPlus,
  CheckSquare,
  X,
  HelpCircle,
  Sparkle
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
  address2?: string;
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

// Prebuilt chess registration field templates
const CHESS_PREBUILT_TEMPLATES = [
  {
    id: "schoolName",
    label: "School Name",
    type: "text" as const,
    placeholder: "e.g. Oak Elementary School",
    description: "For scholastic team awards and team score tracking.",
    required: false,
    visible: true,
    isCustom: true,
    prebuiltType: "school"
  },
  {
    id: "grade",
    label: "Grade",
    type: "select" as const,
    options: ["Kindergarten", "1st Grade", "2nd Grade", "3rd Grade", "4th Grade", "5th Grade", "6th Grade", "7th Grade", "8th Grade", "9th Grade", "10th Grade", "11th Grade", "12th Grade"],
    placeholder: "Select grade level",
    description: "Required for age-restricted scholastic sections.",
    required: false,
    visible: true,
    isCustom: true,
    prebuiltType: "grade"
  },
  {
    id: "coachName",
    label: "Coach Name",
    type: "text" as const,
    placeholder: "e.g. Mr. John Doe",
    description: "Name of the team or school chess coach.",
    required: false,
    visible: true,
    isCustom: true,
    prebuiltType: "coach"
  },
  {
    id: "clubName",
    label: "Club Name",
    type: "text" as const,
    placeholder: "e.g. Metro Chess Club",
    description: "Tracking local club affiliations for team standings.",
    required: false,
    visible: true,
    isCustom: true,
    prebuiltType: "club"
  },
  {
    id: "tshirtSize",
    label: "T-Shirt Size",
    type: "select" as const,
    options: ["Youth S", "Youth M", "Youth L", "Adult S", "Adult M", "Adult L", "Adult XL", "Adult XXL"],
    placeholder: "Select shirt size",
    description: "Required if entry fee includes a tournament t-shirt.",
    required: false,
    visible: true,
    isCustom: true,
    prebuiltType: "tshirt"
  },
  {
    id: "gender",
    label: "Gender / Sex",
    type: "select" as const,
    options: ["Male", "Female", "Prefer not to say"],
    placeholder: "Select gender",
    description: "For statistical tracking or female-only section eligibility.",
    required: false,
    visible: true,
    isCustom: true,
    prebuiltType: "gender"
  },
  {
    id: "dob",
    label: "Date of Birth",
    type: "text" as const,
    placeholder: "MM/DD/YYYY",
    description: "Used to verify age-bracket sections (e.g. Under 12).",
    required: false,
    visible: true,
    isCustom: true,
    prebuiltType: "dob"
  },
  {
    id: "uscfExpiration",
    label: "USCF Expiration Date",
    type: "text" as const,
    placeholder: "MM/DD/YYYY",
    description: "To verify active membership status with US Chess.",
    required: false,
    visible: true,
    isCustom: true,
    prebuiltType: "uscf_expiration"
  },
  {
    id: "fideFederation",
    label: "FIDE Federation",
    type: "text" as const,
    placeholder: "e.g. USA, FID, CAN",
    description: "The national federation registered with FIDE.",
    required: false,
    visible: true,
    isCustom: true,
    prebuiltType: "fide_federation"
  }
];

// Inline Options Chip Manager Subcomponent
interface OptionsManagerProps {
  options: string[];
  onChange: (options: string[]) => void;
}

function OptionsManager({ options, onChange }: OptionsManagerProps) {
  const [inputValue, setInputValue] = useState("");

  const handleAdd = () => {
    const trimmed = inputValue.trim();
    if (trimmed && !options.includes(trimmed)) {
      onChange([...options, trimmed]);
      setInputValue("");
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleAdd();
    }
  };

  const handleRemove = (indexToRemove: number) => {
    onChange(options.filter((_, idx) => idx !== indexToRemove));
  };

  return (
    <div className="space-y-3.5 p-4.5 bg-blue-50/10 border border-blue-100/50 rounded-2xl animate-in fade-in duration-200">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-extrabold text-blue-950 tracking-wide flex items-center gap-1.5">
          <ListPlus className="h-3.5 w-3.5 text-blue-500 animate-pulse" />
          Dropdown Menu Choices
        </span>
        <span className="text-[10px] text-blue-600 font-extrabold bg-blue-50 px-2 py-0.5 rounded-full border border-blue-100/40">
          {options.length} Options
        </span>
      </div>
      
      {/* Option Chips */}
      {options.length > 0 ? (
        <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto p-1.5 bg-white/40 border border-slate-100/80 rounded-xl">
          {options.map((option, idx) => (
            <div 
              key={idx} 
              className="flex items-center gap-1.5 bg-white border border-blue-100 text-blue-950 font-bold px-2.5 py-1 rounded-xl text-xs shadow-sm hover:border-blue-300 transition-all duration-150 hover:bg-slate-50 active:scale-95"
            >
              <span>{option}</span>
              <button
                type="button"
                onClick={() => handleRemove(idx)}
                className="text-blue-400 hover:text-red-500 hover:bg-red-50 p-0.5 rounded-md transition"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-[11px] text-slate-400 italic px-1">No options defined yet. Add choices below.</p>
      )}

      {/* Input row */}
      <div className="flex gap-2">
        <Input
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type choice and press Enter..."
          className="h-10 text-xs bg-white border-slate-200 focus:border-blue-350 rounded-xl shadow-inner"
        />
        <Button
          type="button"
          onClick={handleAdd}
          className="h-10 text-xs px-4 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl shadow-sm transition-all active:scale-95"
        >
          Add Choice
        </Button>
      </div>
    </div>
  );
}

export function RegistrationFormCustomizer({ config, onConfigChange, actions }: RegistrationFormCustomizerProps) {
  const { toast } = useToast();
  const [showPreview, setShowPreview] = useState(true);
  const [focusedFieldId, setFocusedFieldId] = useState<string | null>(null);
  const importRef = React.useRef<HTMLInputElement>(null);

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

  // Upgraded custom field addition based on types
  const addCustomQuestionWithType = (type: "text" | "number" | "boolean" | "select") => {
    const defaultLabels = {
      text: "Custom Text Question",
      number: "Custom Number Question",
      select: "Custom Dropdown Question",
      boolean: "Custom Yes/No Question",
    };
    const defaultPlaceholders = {
      text: "Type details here...",
      number: "Enter number...",
      select: "Select option...",
      boolean: undefined,
    };
    const newField: RegistrationFormField = {
      id: `custom_${Date.now()}`,
      label: defaultLabels[type],
      type,
      placeholder: defaultPlaceholders[type],
      description: "Additional details requested by the organizer.",
      required: false,
      visible: true,
      isCustom: true,
      options: type === "select" ? ["Option 1", "Option 2"] : undefined,
    };
    updateFormConfig({ ...formConfig, fields: [...formConfig.fields, newField] });
    setFocusedFieldId(newField.id);
    toast({
      title: `${type.toUpperCase()} Question Added`,
      description: `New "${defaultLabels[type]}" block successfully added.`
    });
  };

  const addPrebuiltField = (template: typeof CHESS_PREBUILT_TEMPLATES[0]) => {
    const exists = formConfig.fields.some(f => f.id === template.id);
    if (exists) {
      toast({
        title: "Field already exists",
        description: `"${template.label}" is already in your form configuration.`,
        variant: "destructive"
      });
      return;
    }
    const newField: RegistrationFormField = {
      ...template,
    };
    updateFormConfig({ ...formConfig, fields: [...formConfig.fields, newField] });
    setFocusedFieldId(newField.id);
    toast({
      title: "Chess Field Added",
      description: `Successfully added prebuilt "${template.label}" question.`
    });
  };

  const removeField = (id: string) => {
    updateFormConfig({ ...formConfig, fields: formConfig.fields.filter((f) => f.id !== id) });
    if (focusedFieldId === id) setFocusedFieldId(null);
    toast({
      title: "Field Removed",
      description: "Question removed from your registration form."
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

  // --- INTERACTIVE PREVIEW STATE ---
  const [previewStep, setPreviewStep] = useState(1);
  const [previewDrafts, setPreviewDrafts] = useState<PreviewPlayer[]>([]);
  
  // Player identity inputs (Step 1)
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [section, setSection] = useState("");
  const [rating, setRating] = useState("");
  const [uscfId, setUscfId] = useState("");
  const [fideId, setFideId] = useState("");
  
  // Step 2 details inputs
  const [address1, setAddress1] = useState("");
  const [address2, setAddress2] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [country, setCountry] = useState("United States");
  const [arrivalTime, setArrivalTime] = useState("");
  const [byePreference, setByePreference] = useState<"none" | "yes">("none");
  const [byeRounds, setByeRounds] = useState<string[]>([]);
  const [notes, setNotes] = useState("");
  const [newsletter, setNewsletter] = useState(true);
  const [customAnswers, setCustomAnswers] = useState<Record<string, any>>({});

  const multiPlayerAllowed = Boolean(config.registers?.allowMultiPlayerSignup);
  const sectionsList = useMemo(() => {
    if (config.sections && config.sections.length > 0) {
      return config.sections.map(s => s.name);
    }
    return ["Premier Open", "Under 2000", "Under 1600", "Scholastic K-12"];
  }, [config.sections]);

  // Set default section choice in preview
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
    setAddress2("");
    setCity("");
    setState("");
    setPostalCode("");
    setCountry("United States");
    setArrivalTime("");
    setByePreference("none");
    setByeRounds([]);
    setNotes("");
    setNewsletter(true);
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
      address2,
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
      title: "Player Saved",
      description: `${newPlayer.firstName} ${newPlayer.lastName} added to checkout list.`
    });
  };

  const handleRemovePlayer = (id: string) => {
    setPreviewDrafts(prev => prev.filter(p => p.id !== id));
  };

  const handlePreviewSubmit = () => {
    let playersCount = previewDrafts.length;
    const hasActivePlayer = firstName.trim() && lastName.trim() && email.trim();
    if (hasActivePlayer) {
      playersCount += 1;
    }

    if (playersCount === 0) {
      toast({
        title: "Simulation Failed",
        description: "You must add at least one player to complete checkout.",
        variant: "destructive"
      });
      return;
    }

    toast({
      title: "Registration Confirmed (Simulation)",
      description: `Checkout processed successfully for ${playersCount} tournament player(s)!`,
    });

    setPreviewDrafts([]);
    clearForm();
    setPreviewStep(1);
  };

  const handleNextStep = () => {
    if (previewStep === 1) {
      if (previewDrafts.length === 0 && (!firstName.trim() || !lastName.trim() || !email.trim())) {
        toast({
          title: "Profile Required",
          description: "Please specify player details (Name and Email) before continuing.",
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

  // Dynamically resolve standard and chess templates icons for the builder rows
  const getFieldIcon = (field: RegistrationFormField) => {
    if (field.prebuiltType === "school") return <School className="h-4 w-4 text-blue-500" />;
    if (field.prebuiltType === "grade") return <GraduationCap className="h-4 w-4 text-violet-500" />;
    if (field.prebuiltType === "coach") return <User className="h-4 w-4 text-purple-500" />;
    if (field.prebuiltType === "club") return <Users className="h-4 w-4 text-blue-500" />;
    if (field.prebuiltType === "tshirt") return <Shirt className="h-4 w-4 text-pink-500" />;
    if (field.prebuiltType === "gender") return <User className="h-4 w-4 text-teal-500" />;
    if (field.prebuiltType === "dob") return <Calendar className="h-4 w-4 text-amber-500" />;
    if (field.prebuiltType === "uscf_expiration") return <CreditCard className="h-4 w-4 text-emerald-500" />;
    if (field.prebuiltType === "fide_federation") return <Globe className="h-4 w-4 text-rose-500" />;

    // Standard columns mapping
    if (field.id === "uscfId" || field.id === "fideId") return <CreditCard className="h-4 w-4 text-blue-500" />;
    if (field.id === "byePreference") return <Compass className="h-4 w-4 text-teal-500" />;
    if (field.id === "newsletter") return <Mail className="h-4 w-4 text-emerald-500" />;
    if (field.id === "arrivalTime") return <Clock className="h-4 w-4 text-amber-500" />;
    if (field.id === "notes") return <Settings className="h-4 w-4 text-slate-500" />;
    if (field.id.startsWith("address") || field.id === "city" || field.id === "state" || field.id === "postalCode" || field.id === "country") return <MapPin className="h-4 w-4 text-cyan-500" />;

    return <Settings className="h-4 w-4 text-slate-500" />;
  };

  // Get field tag text
  const getFieldTag = (field: RegistrationFormField) => {
    if (field.prebuiltType) return "Chess Template";
    if (field.isCustom) return "Custom Question";
    return "Standard Column";
  };

  const getFieldTagClass = (field: RegistrationFormField) => {
    if (field.prebuiltType) return "bg-amber-50 text-amber-700 border-amber-200/55";
    if (field.isCustom) return "bg-blue-50 text-blue-700 border-blue-200/55";
    return "bg-slate-50 text-slate-600 border-slate-200/55";
  };

  // Dynamic round requests counting for the preview
  const previewByeRoundsCount = config.details?.rounds ?? 5;
  const previewByeRoundsList = useMemo(() => {
    return Array.from({ length: previewByeRoundsCount }, (_, i) => `Round ${i + 1}`);
  }, [previewByeRoundsCount]);

  // List of active fields rendered in step 2 preview (excluding step 1 identities)
  const step2ActiveFields = useMemo(() => {
    return formConfig.fields.filter(f => f.visible && f.id !== "uscfId" && f.id !== "fideId");
  }, [formConfig.fields]);

  return (
    <div className="rounded-2xl border bg-slate-50/50 p-6 space-y-6 shadow-sm border-slate-200/60 font-sans">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <h3 className="text-xl font-extrabold tracking-tight text-slate-900 flex items-center gap-2.5">
            <LayoutGrid className="h-5.5 w-5.5 text-blue-600 animate-spin" style={{ animationDuration: '10s' }} />
            Tactile Form Builder
          </h3>
          <p className="text-xs font-semibold text-slate-500 leading-relaxed">
            Configure registration schemas as interactive, tactile block pieces. Feel the Google Forms-style focus flow.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <input ref={importRef} type="file" accept=".json" className="hidden" onChange={handleImportFile} />
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1.5 text-xs h-9 bg-white border-slate-200 text-slate-700 hover:bg-slate-50 shadow-sm rounded-xl font-bold"
            onClick={handleImportClick}
          >
            <FileUp className="h-3.5 w-3.5" />
            Import Form
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1.5 text-xs h-9 bg-white border-slate-200 text-slate-700 hover:bg-slate-50 shadow-sm rounded-xl font-bold"
            onClick={handleExport}
          >
            <FileDown className="h-3.5 w-3.5" />
            Export Form
          </Button>
          <Button
            type="button"
            variant={showPreview ? "default" : "outline"}
            size="sm"
            className="gap-1.5 text-xs h-9 bg-slate-900 text-white hover:bg-slate-800 shadow-sm font-bold rounded-xl"
            onClick={() => setShowPreview((v) => !v)}
          >
            {showPreview ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            {showPreview ? "Hide Preview" : "Show Live Preview"}
          </Button>
        </div>
      </div>

      {/* CHESS PREBUILT SHELF */}
      <div className="bg-gradient-to-r from-amber-500/10 via-blue-500/5 to-transparent border border-amber-200/50 rounded-2xl p-5 space-y-4 shadow-sm">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4.5 w-4.5 text-amber-500 animate-pulse" />
            <span className="text-sm font-extrabold text-slate-950 tracking-tight">Chess Registration Templates Shelf</span>
            <span className="text-[9px] bg-amber-100 text-amber-800 font-extrabold px-2 py-0.5 rounded-full tracking-wide">One-Click Add</span>
          </div>
          <p className="text-[11px] font-semibold text-slate-500">Inject prebuilt dynamic fields customized specifically for chess players.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {CHESS_PREBUILT_TEMPLATES.map((tmpl) => {
            const added = formConfig.fields.some(f => f.id === tmpl.id);
            return (
              <button
                key={tmpl.id}
                type="button"
                disabled={added}
                onClick={() => addPrebuiltField(tmpl)}
                className={`inline-flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-bold transition-all border shadow-sm ${
                  added 
                    ? "bg-slate-100 text-slate-400 border-slate-250 opacity-65 cursor-not-allowed" 
                    : "bg-white text-slate-800 border-slate-200 hover:border-amber-300 hover:bg-amber-50/40 hover:text-amber-900 active:scale-95"
                }`}
              >
                {tmpl.prebuiltType === "school" && <School className="h-3.5 w-3.5 text-blue-500" />}
                {tmpl.prebuiltType === "grade" && <GraduationCap className="h-3.5 w-3.5 text-violet-500" />}
                {tmpl.prebuiltType === "coach" && <User className="h-3.5 w-3.5 text-purple-500" />}
                {tmpl.prebuiltType === "club" && <Users className="h-3.5 w-3.5 text-blue-500" />}
                {tmpl.prebuiltType === "tshirt" && <Shirt className="h-3.5 w-3.5 text-pink-500" />}
                {tmpl.prebuiltType === "gender" && <User className="h-3.5 w-3.5 text-teal-500" />}
                {tmpl.prebuiltType === "dob" && <Calendar className="h-3.5 w-3.5 text-amber-500" />}
                {tmpl.prebuiltType === "uscf_expiration" && <CreditCard className="h-3.5 w-3.5 text-emerald-500" />}
                {tmpl.prebuiltType === "fide_federation" && <Globe className="h-3.5 w-3.5 text-rose-500" />}
                <span>{tmpl.label}</span>
                {added && <Check className="h-3.5 w-3.5 ml-1 text-emerald-600 font-extrabold" />}
              </button>
            );
          })}
        </div>
      </div>

      <div className={`grid gap-6 ${showPreview ? "lg:grid-cols-2" : "grid-cols-1"}`}>
        {/* Left: Configuration Builder List */}
        <div className="space-y-4">
          <div className="flex items-center justify-between border-b pb-2">
            <span className="text-xs font-extrabold text-slate-500 tracking-wider">Registration Form Fields Schema</span>
            <span className="text-xs text-slate-400 font-semibold">{formConfig.fields.length} blocks total</span>
          </div>

          <div className="space-y-3">
            {formConfig.fields.map((field, idx) => {
              const isFocused = focusedFieldId === field.id;
              return (
                <div 
                  key={field.id}
                  className="transition-all duration-200"
                >
                  {isFocused ? (
                    /* EXPANDED ACTIVE STATE CARD */
                    <div 
                      className="border-l-4 border-l-blue-600 bg-white border-blue-200 shadow-xl ring-1 ring-blue-400/10 p-5 rounded-2xl animate-in fade-in duration-200"
                    >
                      {/* Drag/Sort indicator & Header row */}
                      <div className="flex items-center justify-between gap-3 pb-3 mb-3.5 border-b border-slate-100">
                        <div className="flex items-center gap-2">
                          <GripVertical className="h-4 w-4 text-slate-400 cursor-grab active:cursor-grabbing" />
                          <span className="text-[10px] font-extrabold text-slate-400 tracking-wider">
                            Question {idx + 1}
                          </span>
                          <span className={`text-[10px] font-extrabold px-1.5 py-0.25 border rounded-full ${getFieldTagClass(field)}`}>
                            {getFieldTag(field)}
                          </span>
                        </div>
                        
                        {/* Type converter dropdown on active block */}
                        <Select
                          value={field.type}
                          onValueChange={(val: "text" | "number" | "boolean" | "select") => {
                            const defaultPlaceholders = {
                              text: "Type answer here...",
                              number: "Enter number...",
                              select: "Select option...",
                              boolean: "",
                            };
                            updateField(field.id, {
                              type: val,
                              placeholder: defaultPlaceholders[val] || undefined,
                              options: val === "select" ? (field.options && field.options.length > 0 ? field.options : ["Option 1", "Option 2"]) : undefined
                            });
                            toast({
                              title: "Question Type Updated",
                              description: `Changed question to ${val} input.`
                            });
                          }}
                        >
                          <SelectTrigger className="w-[155px] h-9 text-xs bg-white border-slate-200 font-bold rounded-xl shrink-0">
                            <SelectValue placeholder="Question Type" />
                          </SelectTrigger>
                          <SelectContent className="rounded-xl">
                            <SelectItem value="text">
                              <div className="flex items-center gap-2">
                                <AlignLeft className="h-3.5 w-3.5 text-blue-500" />
                                <span>Short answer</span>
                              </div>
                            </SelectItem>
                            <SelectItem value="number">
                              <div className="flex items-center gap-2">
                                <Hash className="h-3.5 w-3.5 text-blue-500" />
                                <span>Number</span>
                              </div>
                            </SelectItem>
                            <SelectItem value="select">
                              <div className="flex items-center gap-2">
                                <ListPlus className="h-3.5 w-3.5 text-blue-500" />
                                <span>Dropdown</span>
                              </div>
                            </SelectItem>
                            <SelectItem value="boolean">
                              <div className="flex items-center gap-2">
                                <CheckSquare className="h-3.5 w-3.5 text-blue-500" />
                                <span>Yes/No toggle</span>
                              </div>
                            </SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      {/* Editing configurations form */}
                      <div className="space-y-4">
                        <div className="grid gap-4 sm:grid-cols-2">
                          {/* Label Edit */}
                          <div className="space-y-1">
                            <Label className="text-[11px] font-extrabold text-slate-500 tracking-wide">Question Label</Label>
                            <Input
                              value={field.label}
                              onChange={(e) => updateField(field.id, { label: e.target.value })}
                              className="h-10 text-sm bg-white rounded-xl focus:border-blue-400 focus:ring-1 focus:ring-blue-400 font-semibold"
                            />
                          </div>

                          {/* Input Placeholder Edit */}
                          {field.type !== "boolean" && (
                            <div className="space-y-1">
                              <Label className="text-[11px] font-extrabold text-slate-500 tracking-wide">Watermark Placeholder</Label>
                              <Input
                                value={field.placeholder ?? ""}
                                onChange={(e) => updateField(field.id, { placeholder: e.target.value })}
                                placeholder="Type a helper watermark..."
                                className="h-10 text-sm bg-white rounded-xl focus:border-blue-400 focus:ring-1 focus:ring-blue-400"
                              />
                            </div>
                          )}
                        </div>

                        {/* Field Help Description */}
                        <div className="space-y-1">
                          <Label className="text-[11px] font-extrabold text-slate-500 tracking-wide">Helper Explanation / Instructions</Label>
                          <textarea
                            value={field.description ?? ""}
                            onChange={(e) => updateField(field.id, { description: e.target.value })}
                            rows={2}
                            placeholder="This helper text will appear underneath the question on the signup page..."
                            className="w-full text-xs border rounded-xl p-3 bg-white border-slate-200 focus:outline-none focus:border-blue-450 focus:ring-1 focus:ring-blue-400/20 font-semibold leading-relaxed"
                          />
                        </div>

                        {/* Tag-Style Options Manager */}
                        {field.type === "select" && (
                          <OptionsManager
                            options={field.options ?? []}
                            onChange={(nextOptions) => updateField(field.id, { options: nextOptions })}
                          />
                        )}

                        {/* Bottom bar of active question card */}
                        <div className="flex flex-wrap items-center justify-between gap-4 pt-3 border-t border-slate-100">
                          {/* Move buttons and Field Metadata */}
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
                            <span className="text-[10px] text-slate-400 font-mono select-all ml-2 font-semibold">ID: {field.id}</span>
                          </div>

                          {/* Switches & Delete */}
                          <div className="flex items-center gap-5">
                            <div className="flex items-center gap-2">
                              <Switch
                                id={`visible-${field.id}`}
                                checked={field.visible}
                                onCheckedChange={(v) => updateField(field.id, { visible: v, required: v ? field.required : false })}
                                className="scale-90"
                              />
                              <Label htmlFor={`visible-${field.id}`} className="text-xs font-bold text-slate-500 cursor-pointer">Visible</Label>
                            </div>

                            {field.visible && (
                              <div className="flex items-center gap-2">
                                <Switch
                                  id={`required-${field.id}`}
                                  checked={field.required}
                                  onCheckedChange={(v) => updateField(field.id, { required: v })}
                                  className="scale-90"
                                />
                                <Label htmlFor={`required-${field.id}`} className="text-xs font-bold text-slate-500 cursor-pointer">Required</Label>
                              </div>
                            )}

                            {(field.isCustom || field.prebuiltType) && (
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => removeField(field.id)}
                                className="h-8 text-xs text-red-500 hover:text-red-700 hover:bg-red-50 gap-1.5 rounded-lg font-bold"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                                Delete
                              </Button>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    /* COLLAPSED INACTIVE HIGH-FIDELITY SUMMARY CARD */
                    <div 
                      onClick={() => setFocusedFieldId(field.id)}
                      className={`border-l-4 border-l-transparent bg-white hover:bg-slate-50/20 border-slate-200 hover:border-slate-350 shadow-sm p-4 rounded-2xl cursor-pointer transition-all duration-200 flex flex-col gap-2.5 relative ${
                        !field.visible ? "opacity-60" : ""
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        {/* Label & Number */}
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span className="text-xs font-bold text-slate-400 shrink-0">#{idx + 1}</span>
                          <div className="flex-shrink-0 h-7 w-7 rounded-lg bg-slate-50 border border-slate-200/50 flex items-center justify-center">
                            {getFieldIcon(field)}
                          </div>
                          <span className="text-sm font-semibold text-slate-800 truncate">
                            {field.label || "Untitled Question"}
                          </span>
                          {field.required && (
                            <span className="text-red-500 font-extrabold text-xs shrink-0" title="Required">*</span>
                          )}
                          {!field.visible && (
                            <span className="bg-slate-100 text-slate-400 text-[9px] font-bold px-1.5 py-0.5 rounded-full border border-slate-200 shrink-0">
                              Hidden
                            </span>
                          )}
                        </div>

                        {/* Type Badge & Quick switches */}
                        <div className="flex items-center gap-3 shrink-0" onClick={(e) => e.stopPropagation()}>
                          <span className={`text-[10px] font-bold px-2 py-0.5 border rounded-full ${getFieldTagClass(field)}`}>
                            {field.type === "text" ? "Short Text" : field.type === "number" ? "Number" : field.type === "select" ? "Dropdown" : "Yes/No"}
                          </span>

                          {/* Mini interactive toggles right on the collapsed card */}
                          <div className="flex items-center gap-2.5 border-l pl-2.5 border-slate-100">
                            <button
                              type="button"
                              onClick={() => updateField(field.id, { visible: !field.visible, required: !field.visible ? field.required : false })}
                              className={`p-1 rounded-md hover:bg-slate-100 transition-colors ${
                                field.visible ? "text-slate-400 hover:text-slate-700" : "text-slate-300 hover:text-slate-400"
                              }`}
                              title={field.visible ? "Hide from players" : "Show to players"}
                            >
                              {field.visible ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                            </button>

                            {field.visible && (
                              <button
                                type="button"
                                onClick={() => updateField(field.id, { required: !field.required })}
                                className={`px-1.5 py-0.5 rounded-md hover:bg-slate-100 transition-all text-[10px] font-extrabold leading-none ${
                                  field.required ? "text-red-600 bg-red-50/50 hover:bg-red-50" : "text-slate-300 hover:text-slate-500"
                                }`}
                                title={field.required ? "Make optional" : "Make required"}
                              >
                                Req
                              </button>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Mock visual representation of collapsed questions */}
                      <div className="pl-9 pr-1">
                        {field.type === "text" || field.type === "number" ? (
                          <div className="h-8 border border-slate-100 border-dashed rounded-lg bg-slate-50/30 flex items-center px-3 select-none">
                            <span className="text-xs text-slate-400/80 truncate font-semibold">{field.placeholder || "Type answer here..."}</span>
                          </div>
                        ) : field.type === "select" ? (
                          <div className="flex flex-wrap gap-1.5 max-h-12 overflow-hidden items-center">
                            {(field.options && field.options.length > 0) ? (
                              field.options.map((opt, oIdx) => (
                                <span key={oIdx} className="inline-flex items-center px-2 py-0.5 rounded-md text-[9px] font-bold bg-blue-50/30 text-blue-600 border border-blue-100/20 shadow-sm">
                                  {opt}
                                </span>
                              ))
                            ) : (
                              <span className="text-[10px] text-slate-400 italic">No options defined</span>
                            )}
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            <div className="h-4 w-4 rounded border border-slate-200 bg-slate-50/40 shrink-0" />
                            <span className="text-xs text-slate-400/85 font-semibold">Yes / No Option Checkbox</span>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* GORGEOUS STICKY FLOATING BUILDER TOOLBAR */}
          <div className="sticky bottom-6 z-20 mx-auto flex items-center justify-between gap-3 p-2.5 rounded-3xl border border-slate-200/80 bg-white/95 backdrop-blur-md shadow-2xl max-w-md animate-in slide-in-from-bottom-5 duration-300">
            <div className="flex items-center gap-1.5 w-full justify-around">
              <div className="flex items-center gap-1.5 px-3 py-1 bg-blue-50 rounded-2xl shrink-0">
                <Sparkle className="h-3.5 w-3.5 text-blue-600 animate-spin" style={{ animationDuration: '6s' }} />
                <span className="text-[10px] font-extrabold text-blue-950 tracking-wider">Add Piece</span>
              </div>
              
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-9 px-2 text-xs text-slate-700 hover:text-blue-600 hover:bg-blue-50/55 rounded-xl flex items-center gap-1.5 transition-all duration-150 active:scale-95 font-bold"
                onClick={() => addCustomQuestionWithType("text")}
              >
                <AlignLeft className="h-4 w-4 text-blue-500" />
                <span>Text</span>
              </Button>
              
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-9 px-2 text-xs text-slate-700 hover:text-blue-600 hover:bg-blue-50/55 rounded-xl flex items-center gap-1.5 transition-all duration-150 active:scale-95 font-bold"
                onClick={() => addCustomQuestionWithType("number")}
              >
                <Hash className="h-4 w-4 text-blue-500" />
                <span>Number</span>
              </Button>
              
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-9 px-2 text-xs text-slate-700 hover:text-blue-600 hover:bg-blue-50/55 rounded-xl flex items-center gap-1.5 transition-all duration-150 active:scale-95 font-bold"
                onClick={() => addCustomQuestionWithType("select")}
              >
                <ListPlus className="h-4 w-4 text-blue-500" />
                <span>Dropdown</span>
              </Button>
              
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-9 px-2 text-xs text-slate-700 hover:text-blue-600 hover:bg-blue-50/55 rounded-xl flex items-center gap-1.5 transition-all duration-150 active:scale-95 font-bold"
                onClick={() => addCustomQuestionWithType("boolean")}
              >
                <CheckSquare className="h-4 w-4 text-blue-500" />
                <span>Yes/No</span>
              </Button>
            </div>
          </div>
        </div>

        {/* Right: Premium Interactive Live Preview */}
        {showPreview && (
          <div className="space-y-4">
            <div className="flex items-center justify-between border-b pb-2">
              <span className="text-xs font-extrabold text-slate-500 tracking-wider">High-Fidelity Live Preview</span>
              <div className="flex items-center gap-1.5">
                {[1, 2, 3].map((step) => (
                  <div 
                    key={step} 
                    className={`h-2 rounded-full transition-all duration-300 ${
                      previewStep === step 
                        ? "w-8 bg-gradient-to-r from-blue-500 to-violet-600" 
                        : previewStep > step 
                          ? "w-4 bg-blue-300" 
                          : "w-2.5 bg-slate-200"
                    }`} 
                  />
                ))}
              </div>
            </div>

            <div className="rounded-3xl border border-slate-200 bg-white p-5 space-y-4 max-h-[720px] overflow-y-auto shadow-md">
              {/* Drafts summary badge shelf for multi-player registers */}
              {multiPlayerAllowed && previewStep < 3 && (
                <div className="bg-blue-50/60 border border-blue-100 rounded-2xl p-4 space-y-3 shadow-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-blue-900 flex items-center gap-1.5">
                      <Users className="h-4 w-4 text-blue-600" />
                      Registration Cart ({previewDrafts.length} Saved)
                    </span>
                    {previewStep === 1 && (
                      <Button
                        type="button"
                        size="sm"
                        onClick={handleAddPlayerToRoster}
                        className="h-7 text-xs bg-blue-600 hover:bg-blue-700 font-bold shadow-sm"
                      >
                        <UserPlus className="h-3 w-3 mr-1" />
                        Add to Cart
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
                            className="text-red-400 hover:text-red-600 transition p-0.5 rounded-full hover:bg-red-50"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-[11px] text-blue-600/80 italic font-medium">Cart is currently empty. Fill details below and click "Add to Cart" to test cart mode.</p>
                  )}
                </div>
              )}

              {/* STEP 1: PLAYER PROFILE IDENTITY */}
              {previewStep === 1 && (
                <div className="space-y-4 animate-in fade-in duration-300">
                  <div className="border-b pb-2">
                    <p className="text-base font-bold text-slate-900 leading-tight">1. Player Lookup Profile</p>
                    <p className="text-xs text-slate-400 font-semibold mt-0.5">Search official registries and confirm rating status.</p>
                  </div>
                  <div className="space-y-3.5">
                    <div className="space-y-1">
                      <label className="text-xs font-bold text-slate-600">First Name <span className="text-red-500">*</span></label>
                      <Input
                        value={firstName}
                        onChange={(e) => setFirstName(e.target.value)}
                        placeholder="Player's first name"
                        className="h-10 text-xs border-slate-200 rounded-xl"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-bold text-slate-600">Last Name <span className="text-red-500">*</span></label>
                      <Input
                        value={lastName}
                        onChange={(e) => setLastName(e.target.value)}
                        placeholder="Player's last name"
                        className="h-10 text-xs border-slate-200 rounded-xl"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-bold text-slate-600">Email Address <span className="text-red-500">*</span></label>
                      <Input
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="player@email.com"
                        type="email"
                        className="h-10 text-xs border-slate-200 rounded-xl"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <label className="text-xs font-bold text-slate-600">Section</label>
                        <Select value={section} onValueChange={setSection}>
                          <SelectTrigger className="h-10 text-xs border-slate-200 bg-white rounded-xl">
                            <SelectValue placeholder="Select section..." />
                          </SelectTrigger>
                          <SelectContent className="rounded-xl">
                            {sectionsList.map(s => (
                              <SelectItem key={s} value={s}>{s}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-bold text-slate-600">Rating (Optional)</label>
                        <Input
                          value={rating}
                          onChange={(e) => setRating(e.target.value)}
                          placeholder="e.g. 1540"
                          className="h-10 text-xs border-slate-200 rounded-xl"
                        />
                      </div>
                    </div>

                    {/* Step 1 dynamic standard field lookups */}
                    {formConfig.fields.find(f => f.id === "uscfId")?.visible && (
                      <div className="space-y-1">
                        <label className="text-xs font-bold text-slate-600 flex items-center justify-between">
                          <span>
                            {formConfig.fields.find(f => f.id === "uscfId")?.label}
                            {formConfig.fields.find(f => f.id === "uscfId")?.required && <span className="text-red-500 ml-0.5">*</span>}
                          </span>
                          <span className="text-[10px] text-slate-400 font-bold bg-slate-50 border border-slate-100 px-1.5 py-0.5 rounded">Standard</span>
                        </label>
                        <Input
                          value={uscfId}
                          onChange={(e) => setUscfId(e.target.value)}
                          placeholder={formConfig.fields.find(f => f.id === "uscfId")?.placeholder ?? "e.g. 12345678"}
                          className="h-10 text-xs border-slate-200 rounded-xl"
                        />
                        {formConfig.fields.find(f => f.id === "uscfId")?.description && (
                          <p className="text-[10px] text-slate-400 mt-0.5 leading-relaxed font-semibold">{formConfig.fields.find(f => f.id === "uscfId")?.description}</p>
                        )}
                      </div>
                    )}

                    {formConfig.fields.find(f => f.id === "fideId")?.visible && (
                      <div className="space-y-1">
                        <label className="text-xs font-bold text-slate-600 flex items-center justify-between">
                          <span>
                            {formConfig.fields.find(f => f.id === "fideId")?.label}
                            {formConfig.fields.find(f => f.id === "fideId")?.required && <span className="text-red-500 ml-0.5">*</span>}
                          </span>
                          <span className="text-[10px] text-slate-400 font-bold bg-slate-50 border border-slate-100 px-1.5 py-0.5 rounded">Standard</span>
                        </label>
                        <Input
                          value={fideId}
                          onChange={(e) => setFideId(e.target.value)}
                          placeholder={formConfig.fields.find(f => f.id === "fideId")?.placeholder ?? "e.g. 1500021"}
                          className="h-10 text-xs border-slate-200 rounded-xl"
                        />
                        {formConfig.fields.find(f => f.id === "fideId")?.description && (
                          <p className="text-[10px] text-slate-400 mt-0.5 leading-relaxed font-semibold">{formConfig.fields.find(f => f.id === "fideId")?.description}</p>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* STEP 2: PREFERENCES & DYNAMIC CONFIG-ORDER BUILDER FIELDS */}
              {previewStep === 2 && (
                <div className="space-y-4 animate-in fade-in duration-300">
                  <div className="border-b pb-2">
                    <p className="text-base font-bold text-slate-900 leading-tight">2. Preferences & Details</p>
                    <p className="text-xs text-slate-400 font-semibold mt-0.5">Answer dynamic tournament-specific fields in sequence.</p>
                  </div>

                  <div className="space-y-4.5">
                    {step2ActiveFields.map((field) => {
                      const req = field.required;
                      
                      // Render logic based on specific field ID or Type
                      if (field.id === "byePreference") {
                        return (
                          <div key={field.id} className="space-y-2 p-4 bg-slate-50 border border-slate-200 rounded-2xl">
                            <Label className="text-xs font-extrabold text-slate-700 flex items-center justify-between">
                              <span>{field.label} {req && <span className="text-red-500">*</span>}</span>
                              <span className="text-[10px] bg-teal-50 text-teal-700 font-extrabold px-1.5 py-0.5 rounded border border-teal-100">Byes</span>
                            </Label>
                            {field.description && <p className="text-[10px] text-slate-400 leading-relaxed font-semibold">{field.description}</p>}
                            <div className="flex gap-4 mt-2">
                              <label className="flex items-center gap-1.5 text-xs text-slate-700 font-bold cursor-pointer">
                                <input 
                                  type="radio" 
                                  name="byePref" 
                                  checked={byePreference === "none"} 
                                  onChange={() => setByePreference("none")} 
                                  className="text-blue-600 focus:ring-blue-500 h-3.5 w-3.5"
                                />
                                No byes
                              </label>
                              <label className="flex items-center gap-1.5 text-xs text-slate-700 font-bold cursor-pointer">
                                <input 
                                  type="radio" 
                                  name="byePref" 
                                  checked={byePreference === "yes"} 
                                  onChange={() => setByePreference("yes")} 
                                  className="text-blue-600 focus:ring-blue-500 h-3.5 w-3.5"
                                />
                                Request byes
                              </label>
                            </div>
                            {byePreference === "yes" && (
                              <div className="flex flex-wrap gap-1.5 mt-2 bg-white border rounded-xl p-2">
                                {previewByeRoundsList.map(r => {
                                  const checked = byeRounds.includes(r);
                                  return (
                                    <button
                                      key={r}
                                      type="button"
                                      onClick={() => handleToggleByeRound(r)}
                                      className={`text-[10px] px-2.5 py-1.5 rounded-lg border font-bold transition-all active:scale-95 ${
                                        checked 
                                          ? "bg-blue-650 border-blue-600 text-white shadow-sm font-extrabold" 
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
                        );
                      }

                      if (field.type === "boolean") {
                        const val = field.isCustom ? (customAnswers[field.id] ?? false) : (field.id === "newsletter" ? newsletter : false);
                        const handleBoolChange = (checked: boolean) => {
                          if (field.isCustom) {
                            setCustomAnswers(prev => ({ ...prev, [field.id]: checked }));
                          } else if (field.id === "newsletter") {
                            setNewsletter(checked);
                          }
                        };

                        return (
                          <div key={field.id} className="flex items-start gap-3 bg-white border border-slate-200 p-3.5 rounded-2xl shadow-sm hover:border-slate-300">
                            <input 
                              type="checkbox" 
                              checked={val}
                              onChange={(e) => handleBoolChange(e.target.checked)}
                              className="mt-1 rounded border-slate-300 text-blue-600 focus:ring-blue-500 h-4 w-4 shrink-0" 
                            />
                            <div className="space-y-0.5">
                              <span className="block text-xs font-bold text-slate-800">{field.label} {req && <span className="text-red-500">*</span>}</span>
                              {field.description && <span className="block text-[10px] text-slate-400 leading-relaxed font-semibold">{field.description}</span>}
                            </div>
                          </div>
                        );
                      }

                      if (field.type === "select") {
                        const val = field.isCustom ? (customAnswers[field.id] ?? "") : (field.id === "country" ? country : "");
                        const handleSelectChange = (val: string) => {
                          if (field.isCustom) {
                            setCustomAnswers(prev => ({ ...prev, [field.id]: val }));
                          } else if (field.id === "country") {
                            setCountry(val);
                          }
                        };
                        const selectOptions = field.id === "country" ? ["United States", "Canada", "Mexico", "India", "UK"] : (field.options ?? []);

                        return (
                          <div key={field.id} className="space-y-1">
                            <Label className="text-xs font-bold text-slate-600 flex items-center justify-between">
                              <span>{field.label} {req && <span className="text-red-500">*</span>}</span>
                              {field.prebuiltType && <span className="text-[9px] font-bold px-1.5 bg-amber-50 border border-amber-100 rounded text-amber-700">Prebuilt</span>}
                            </Label>
                            <Select value={val} onValueChange={handleSelectChange}>
                              <SelectTrigger className="h-10 text-xs border-slate-200 bg-white rounded-xl">
                                <SelectValue placeholder={field.placeholder || "Select option..."} />
                              </SelectTrigger>
                              <SelectContent className="rounded-xl">
                                {selectOptions.map(opt => (
                                  <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            {field.description && (
                              <p className="text-[10px] text-slate-400 leading-normal mt-0.5 font-semibold">{field.description}</p>
                            )}
                          </div>
                        );
                      }

                      if (field.id === "notes") {
                        return (
                          <div key={field.id} className="space-y-1">
                            <Label className="text-xs font-bold text-slate-600">{field.label} {req && <span className="text-red-500">*</span>}</Label>
                            <textarea
                              value={notes}
                              onChange={(e) => setNotes(e.target.value)}
                              placeholder={field.placeholder || "Write instructions..."}
                              rows={2.5}
                              className="w-full text-xs border rounded-xl p-2.5 bg-white border-slate-200 focus:outline-none focus:border-blue-400 font-semibold"
                            />
                            {field.description && (
                              <p className="text-[10px] text-slate-400 leading-normal mt-0.5 font-semibold">{field.description}</p>
                            )}
                          </div>
                        );
                      }

                      // Normal input text / numbers (including standard address, arrival time and custom)
                      const getInputValue = () => {
                        if (field.isCustom) return customAnswers[field.id] ?? "";
                        if (field.id === "address1") return address1;
                        if (field.id === "address2") return address2;
                        if (field.id === "city") return city;
                        if (field.id === "state") return state;
                        if (field.id === "postalCode") return postalCode;
                        if (field.id === "arrivalTime") return arrivalTime;
                        return "";
                      };

                      const setInputValue = (v: string) => {
                        if (field.isCustom) {
                          setCustomAnswers(prev => ({ ...prev, [field.id]: v }));
                        } else if (field.id === "address1") {
                          setAddress1(v);
                        } else if (field.id === "address2") {
                          setAddress2(v);
                        } else if (field.id === "city") {
                          setCity(v);
                        } else if (field.id === "state") {
                          setState(v);
                        } else if (field.id === "postalCode") {
                          setPostalCode(v);
                        } else if (field.id === "arrivalTime") {
                          setArrivalTime(v);
                        }
                      };

                      return (
                        <div key={field.id} className="space-y-1 animate-in slide-in-from-bottom-2 duration-200">
                          <Label className="text-xs font-bold text-slate-600 flex items-center justify-between">
                            <span>{field.label} {req && <span className="text-red-500">*</span>}</span>
                            {field.prebuiltType && <span className="text-[9px] font-bold px-1.5 bg-amber-50 border border-amber-100 rounded text-amber-700">Prebuilt</span>}
                          </Label>
                          <Input
                            type={field.type === "number" ? "number" : "text"}
                            value={getInputValue()}
                            onChange={(e) => setInputValue(e.target.value)}
                            placeholder={field.placeholder || `Enter ${field.label}...`}
                            className="h-10 text-xs border-slate-200 rounded-xl"
                          />
                          {field.description && (
                            <p className="text-[10px] text-slate-400 leading-normal mt-0.5 font-semibold">{field.description}</p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* STEP 3: REVIEW & CONFIRMATION CART SUMMARY */}
              {previewStep === 3 && (
                <div className="space-y-4 animate-in fade-in duration-300">
                  <div className="border-b pb-2">
                    <p className="text-base font-bold text-slate-900 leading-tight">3. Review & Checkout</p>
                    <p className="text-xs text-slate-400 font-semibold mt-0.5">Review rosters and complete simulated billing checkout.</p>
                  </div>

                  <div className="space-y-3">
                    {/* Gather active lists */}
                    {(() => {
                      const roster = [...previewDrafts];
                      const activeProfileFilled = firstName.trim() && lastName.trim() && email.trim();
                      if (activeProfileFilled) {
                        roster.push({
                          id: "active",
                          firstName,
                          lastName,
                          email,
                          section,
                          rating: rating || "Unrated",
                          uscfId,
                          fideId,
                          address1,
                          address2,
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
                        <div className="space-y-4">
                          <div className="border border-slate-200 rounded-2xl overflow-hidden bg-white shadow-sm divide-y">
                            <div className="bg-slate-50/50 px-4 py-2.5 text-[10px] font-bold text-slate-400 tracking-wide">
                              Enrolled Players ({roster.length})
                            </div>
                            {roster.map((player, idx) => (
                              <div key={player.id} className="p-4 space-y-2 text-xs">
                                <div className="flex items-center justify-between">
                                  <span className="font-bold text-slate-900">{idx + 1}. {player.firstName} {player.lastName}</span>
                                  <span className="bg-blue-50 border border-blue-100 text-blue-700 font-bold px-2 py-0.5 rounded text-[10px]">
                                    {player.section}
                                  </span>
                                </div>
                                <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-slate-500 leading-normal text-[11px] font-semibold">
                                  <div>Email: <span className="font-bold text-slate-700">{player.email}</span></div>
                                  <div>Rating: <span className="font-bold text-slate-700">{player.rating}</span></div>
                                  {player.uscfId && <div>USCF ID: <span className="font-bold text-slate-700">{player.uscfId}</span></div>}
                                  {player.fideId && <div>FIDE ID: <span className="font-bold text-slate-700">{player.fideId}</span></div>}
                                  {player.byePreference === "yes" && player.byeRounds?.length && (
                                    <div className="col-span-2">
                                      Byes: <span className="font-extrabold text-blue-650 bg-blue-50 px-1.5 py-0.5 rounded border border-blue-100">{player.byeRounds.join(", ")}</span>
                                    </div>
                                  )}
                                </div>
                                
                                {/* Dynamically list custom answers */}
                                {player.customAnswers && Object.keys(player.customAnswers).length > 0 && (
                                  <div className="pt-2 border-t mt-2 bg-slate-50/60 p-2.5 rounded-xl border border-slate-100/60 space-y-1 animate-in slide-in-from-bottom-2 duration-300">
                                    <span className="block font-bold text-[9px] text-slate-400 tracking-wide">Dynamic Responses</span>
                                    {Object.entries(player.customAnswers).map(([qid, val]) => {
                                      const label = formConfig.fields.find(f => f.id === qid)?.label || qid;
                                      return (
                                        <div key={qid} className="text-[11px] flex justify-between gap-3 leading-normal border-b border-dashed border-slate-100 pb-0.5 last:border-b-0 last:pb-0">
                                          <span className="text-slate-500 truncate font-semibold">{label}:</span>
                                          <span className="font-bold text-slate-850 shrink-0">
                                            {typeof val === "boolean" ? (val ? "Yes" : "No") : String(val)}
                                          </span>
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>

                          {/* Calculated fees card */}
                          <div className="bg-gradient-to-r from-slate-900 to-slate-950 text-white rounded-2xl p-4.5 space-y-3 shadow-md">
                            <div className="text-[10px] font-extrabold text-slate-400 tracking-wider border-b border-slate-800 pb-1.5">
                              Fees Calculations
                            </div>
                            <div className="text-xs space-y-2.5 font-bold">
                              <div className="flex justify-between text-slate-300">
                                <span>Tournament Entry Fee ({roster.length}x)</span>
                                <span className="font-bold text-slate-100">${roster.length * 60}.00</span>
                              </div>
                              <div className="flex justify-between text-slate-300 border-b border-slate-800/40 pb-2">
                                <span>Processing Contribution</span>
                                <span className="font-bold text-slate-100">$2.50</span>
                              </div>
                              <div className="flex justify-between text-sm font-bold text-white pt-1">
                                <span>Checkout Subtotal</span>
                                <span className="text-amber-400 font-extrabold text-base">${roster.length * 60 + 2.50}</span>
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
              <div className="pt-4 border-t border-slate-100 flex items-center justify-between gap-2">
                <span className="text-[10px] font-bold text-slate-400 tracking-wide">
                  Step {previewStep} of 3
                </span>
                <div className="flex items-center gap-2">
                  {previewStep > 1 && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handlePrevStep}
                      className="h-8.5 text-xs border-slate-200 text-slate-700 bg-white shadow-sm hover:bg-slate-50 rounded-xl font-bold"
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
                      className="h-8.5 text-xs bg-slate-900 hover:bg-slate-800 text-white font-bold shadow-sm rounded-xl"
                    >
                      Continue
                      <ChevronRight className="h-3.5 w-3.5 ml-1" />
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      size="sm"
                      onClick={handlePreviewSubmit}
                      className="h-8.5 text-xs bg-emerald-600 hover:bg-emerald-700 text-white font-bold shadow-sm rounded-xl"
                    >
                      <Check className="h-3.5 w-3.5 mr-1" />
                      Complete Checkout
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
      
      {actions && (
        <div className="border-t border-slate-200/60 pt-5 flex items-center justify-end">
          {actions}
        </div>
      )}
    </div>
  );
}

export default RegistrationFormCustomizer;
