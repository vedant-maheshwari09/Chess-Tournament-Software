import React, { useState, useMemo } from "react";
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
  Check,
  Users,
  CreditCard,
  GripVertical,
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
  AlignLeft,
  Hash,
  ListPlus,
  CheckSquare,
  X,
  ExternalLink,
  Copy,
  Sliders,
  ShieldCheck,
  Trophy
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
  tournamentId?: number;
  actions?: React.ReactNode; // Slot for custom actions (like Save button)
}

// Unified categories for one-click adding and enabling
const ONE_CLICK_CATEGORIES = [
  {
    id: "personal",
    name: "Personal & Contact Details",
    icon: <User className="h-4 w-4 text-blue-600" />,
    description: "Demographic info, direct contacts, and emergency contacts.",
    fields: [
      {
        id: "dob",
        label: "Date of Birth",
        type: "text" as const,
        placeholder: "MM/DD/YYYY",
        description: "Used to verify age eligibility for restricted junior or senior sections.",
        prebuiltType: "dob",
        isCustom: true
      },
      {
        id: "gender",
        label: "Gender / Sex",
        type: "select" as const,
        options: ["Male", "Female", "Prefer not to say"],
        placeholder: "Select gender...",
        description: "For category tracking or gender-specific sections.",
        prebuiltType: "gender",
        isCustom: true
      },
      {
        id: "phone",
        label: "Phone Number",
        type: "text" as const,
        placeholder: "e.g. (555) 019-2834",
        description: "Primary contact number for pairings or emergency alerts.",
        isCustom: true
      },
      {
        id: "emergencyContactName",
        label: "Emergency Contact Name",
        type: "text" as const,
        placeholder: "e.g. Jane Doe",
        description: "On-site emergency contact name.",
        isCustom: true
      },
      {
        id: "emergencyContactPhone",
        label: "Emergency Contact Phone",
        type: "text" as const,
        placeholder: "e.g. (555) 019-2834",
        description: "Active phone number of the emergency contact person.",
        isCustom: true
      }
    ]
  },
  {
    id: "chess",
    name: "Chess & Federation Profiles",
    icon: <Trophy className="h-4 w-4 text-blue-600" />,
    description: "Federation credentials, school details, and club rosters.",
    fields: [
      {
        id: "uscfId",
        label: "USCF ID",
        type: "text" as const,
        placeholder: "e.g. 12345678",
        description: "Your official 8-digit United States Chess Federation ID."
      },
      {
        id: "fideId",
        label: "FIDE ID",
        type: "text" as const,
        placeholder: "e.g. 1500021",
        description: "Your official international World Chess Federation ID."
      },
      {
        id: "uscfExpiration",
        label: "USCF Expiration Date",
        type: "text" as const,
        placeholder: "MM/DD/YYYY",
        description: "Required to verify active status with US Chess Federation.",
        prebuiltType: "uscf_expiration",
        isCustom: true
      },
      {
        id: "fideFederation",
        label: "FIDE Federation",
        type: "text" as const,
        placeholder: "e.g. USA, ENG, CAN",
        description: "National chess federation registered with FIDE.",
        prebuiltType: "fide_federation",
        isCustom: true
      },
      {
        id: "schoolName",
        label: "School Name",
        type: "text" as const,
        placeholder: "e.g. Oak Elementary School",
        description: "For scholastic team scores and trophies tracking.",
        prebuiltType: "school",
        isCustom: true
      },
      {
        id: "grade",
        label: "Grade",
        type: "select" as const,
        options: ["Kindergarten", "1st Grade", "2nd Grade", "3rd Grade", "4th Grade", "5th Grade", "6th Grade", "7th Grade", "8th Grade", "9th Grade", "10th Grade", "11th Grade", "12th Grade"],
        placeholder: "Select grade level...",
        description: "Required for grade-restricted school brackets.",
        prebuiltType: "grade",
        isCustom: true
      },
      {
        id: "coachName",
        label: "Coach Name",
        type: "text" as const,
        placeholder: "e.g. Mr. John Doe",
        description: "The scholastic or private coach of the player.",
        prebuiltType: "coach",
        isCustom: true
      },
      {
        id: "clubName",
        label: "Club Name",
        type: "text" as const,
        placeholder: "e.g. Metro Chess Club",
        description: "Affiliated local chess club team name.",
        prebuiltType: "club",
        isCustom: true
      },
      {
        id: "ratingVerification",
        label: "Confirm Rating Accuracy",
        type: "boolean" as const,
        description: "I agree that the director may adjust my section enrollment if my official rating differs.",
        isCustom: true
      }
    ]
  },
  {
    id: "location",
    name: "Location & Address Details",
    icon: <MapPin className="h-4 w-4 text-blue-600" />,
    description: "Standard physical mailing addresses for billing and statistics.",
    fields: [
      {
        id: "address1",
        label: "Street Address",
        type: "text" as const,
        placeholder: "e.g. 123 Main Street",
        description: "Primary street address."
      },
      {
        id: "address2",
        label: "Apt / Suite / Room",
        type: "text" as const,
        placeholder: "e.g. Suite 4B or Apt 12",
        description: "Apartment number, suite, or room (optional)."
      },
      {
        id: "city",
        label: "City",
        type: "text" as const,
        placeholder: "e.g. New York",
        description: "City of residence."
      },
      {
        id: "state",
        label: "State / Province",
        type: "text" as const,
        placeholder: "e.g. NY",
        description: "State or province abbreviation."
      },
      {
        id: "postalCode",
        label: "Postal / ZIP Code",
        type: "text" as const,
        placeholder: "e.g. 10001",
        description: "Postal or ZIP code."
      },
      {
        id: "country",
        label: "Country",
        type: "text" as const,
        placeholder: "e.g. United States",
        description: "Country of residence."
      }
    ]
  },
  {
    id: "payments",
    name: "Payments & ID Verification",
    icon: <ShieldCheck className="h-4 w-4 text-blue-600" />,
    description: "Terms of pay, offline deposit agreements, and identification checks.",
    fields: [
      {
        id: "paymentOffline",
        label: "Offline Payment Agreement",
        type: "boolean" as const,
        description: "I agree to pay the registration fee offline on-site before Round 1 starts, or risk being withdrawn.",
        isCustom: true
      },
      {
        id: "paymentOnline",
        label: "Online Deposit Consent",
        type: "boolean" as const,
        description: "I acknowledge that online registration requires completing checkout through the online billing module.",
        isCustom: true
      },
      {
        id: "uscfMembershipRenewalFee",
        label: "USCF Membership Renewal Fee ($45)",
        type: "boolean" as const,
        description: "Add USCF registration / renewal fee to your tournament entry checkout.",
        isCustom: true
      },
      {
        id: "tshirtPreorderFee",
        label: "Pre-order Tournament T-Shirt ($20)",
        type: "boolean" as const,
        description: "Includes official cotton event t-shirt (please specify size in preferences).",
        isCustom: true
      },
      {
        id: "donationPrizeFund",
        label: "Optional Donation to Prize Fund",
        type: "select" as const,
        options: ["No donation", "Donate $10", "Donate $25", "Donate $50", "Donate $100"],
        placeholder: "Select contribution level...",
        description: "Help support the scholastic and master prize funds.",
        isCustom: true
      },
      {
        id: "earlyBirdDiscountCode",
        label: "Voucher / Promo Code",
        type: "text" as const,
        placeholder: "e.g. EARLYBIRD10, CHESSCLUB...",
        description: "Enter an active promotion or membership discount code.",
        isCustom: true
      },
      {
        id: "paymentMethodPreference",
        label: "Preferred Payment Method",
        type: "select" as const,
        options: ["Credit / Debit Card (Online)", "Venmo", "Zelle", "PayPal", "Cash / Check On-Site"],
        placeholder: "Select payment method...",
        description: "Indicate how you plan to complete checkout to help TDs organize receipts.",
        isCustom: true
      },
      {
        id: "idDocumentVerification",
        label: "ID Document Number",
        type: "text" as const,
        placeholder: "e.g. Passport, State ID, or Driver's license number...",
        description: "Verification code required for official FIDE profiles or qualified payouts.",
        isCustom: true
      },
      {
        id: "idVerificationAgreement",
        label: "Identity Verification Agreement",
        type: "boolean" as const,
        description: "I agree to show a valid photo ID (e.g. passport or driver's license) during on-site check-in if requested.",
        isCustom: true
      }
    ]
  },
  {
    id: "preferences",
    name: "Preferences & Scheduling",
    icon: <Sliders className="h-4 w-4 text-blue-600" />,
    description: "Requested byes, check-in schedules, shirt sizes, and meal boxes.",
    fields: [
      {
        id: "byePreference",
        label: "Bye Requests",
        type: "boolean" as const,
        description: "Request a half-point bye for rounds you are unable to play."
      },
      {
        id: "arrivalTime",
        label: "Expected Arrival Time",
        type: "text" as const,
        placeholder: "e.g. Friday 6:30 PM",
        description: "Helpful for directors to manage on-site schedules and check-ins."
      },
      {
        id: "notes",
        label: "Notes / Special Requests",
        type: "text" as const,
        placeholder: "e.g. Wheelchair access, traveling with family...",
        description: "Any special accommodations or messages for the Tournament Director."
      },
      {
        id: "newsletter",
        label: "Receive Bulletins",
        type: "boolean" as const,
        description: "Opt-in to receive round pairings, final standings, and future event details."
      },
      {
        id: "tshirtSize",
        label: "T-Shirt Size",
        type: "select" as const,
        options: ["Youth S", "Youth M", "Youth L", "Adult S", "Adult M", "Adult L", "Adult XL", "Adult XXL"],
        placeholder: "Select shirt size...",
        description: "Required if entry fee includes a tournament t-shirt.",
        prebuiltType: "tshirt",
        isCustom: true
      },
      {
        id: "lunchOption",
        label: "Lunch Box Preference",
        type: "select" as const,
        options: ["None", "Vegetarian Box", "Turkey & Cheese Box", "Ham & Swiss Box", "Gluten-Free Salad"],
        placeholder: "Select lunch option...",
        description: "Optional pre-ordered lunch box for the tournament day.",
        isCustom: true
      },
      {
        id: "sectionCheck",
        label: "Acknowledge Section Eligibility",
        type: "boolean" as const,
        description: "I have reviewed the rating limits for my selected section and certify that I am eligible.",
        isCustom: true
      }
    ]
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
    <div className="space-y-3 p-4 bg-slate-50 border border-slate-200 rounded-xl">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-extrabold text-slate-700 tracking-wide flex items-center gap-1.5">
          <ListPlus className="h-3.5 w-3.5 text-blue-600" />
          Dropdown Menu Choices
        </span>
        <span className="text-[10px] text-slate-500 font-extrabold bg-slate-200 px-2 py-0.5 rounded-full border border-slate-200/50">
          {options.length} Options
        </span>
      </div>
      
      {options.length > 0 ? (
        <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto p-1.5 bg-white border border-slate-200 rounded-xl">
          {options.map((option, idx) => (
            <div 
              key={idx} 
              className="flex items-center gap-1.5 bg-white border border-slate-200 text-slate-800 font-bold px-2 py-0.5 rounded-lg text-xs shadow-sm hover:border-slate-350 transition-all"
            >
              <span>{option}</span>
              <button
                type="button"
                onClick={() => handleRemove(idx)}
                className="text-slate-400 hover:text-red-500 hover:bg-red-50 p-0.5 rounded-md transition"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-[11px] text-slate-400 italic px-1">No options defined yet. Add choices below.</p>
      )}

      <div className="flex gap-2">
        <Input
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type choice and press Enter..."
          className="h-10 text-xs bg-white border-slate-200 focus:border-blue-500 rounded-xl"
        />
        <Button
          type="button"
          onClick={handleAdd}
          className="h-10 text-xs px-4 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl shadow-sm"
        >
          Add Choice
        </Button>
      </div>
    </div>
  );
}

export function RegistrationFormCustomizer({ config, onConfigChange, tournamentId, actions }: RegistrationFormCustomizerProps) {
  const { toast } = useToast();
  const [focusedFieldId, setFocusedFieldId] = useState<string | null>(null);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
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

  // Add custom questions from bottom toolbar
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
    const newId = `custom_${Date.now()}`;
    const newField: RegistrationFormField = {
      id: newId,
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

  // Unified add or enable prebuilt / standard fields from side shelf
  const addOrEnableField = (template: {
    id: string;
    label: string;
    type: "text" | "number" | "boolean" | "select";
    placeholder?: string;
    description: string;
    options?: string[];
    prebuiltType?: string;
    isCustom?: boolean;
  }) => {
    const existingFieldIdx = formConfig.fields.findIndex(f => f.id === template.id);
    
    if (existingFieldIdx > -1) {
      const existingField = formConfig.fields[existingFieldIdx];
      if (existingField.visible) {
        // Scroll or focus in builder
        setFocusedFieldId(template.id);
        toast({
          title: "Field already active",
          description: `Focused "${template.label}" in the form builder list.`,
        });
      } else {
        // Turn visible back on
        const nextFields = formConfig.fields.map(f => f.id === template.id ? { ...f, visible: true } : f);
        updateFormConfig({ ...formConfig, fields: nextFields });
        setFocusedFieldId(template.id);
        toast({
          title: "Field Enabled",
          description: `Successfully enabled standard "${template.label}" field.`,
        });
      }
    } else {
      // Append brand-new chess/custom prebuilt template
      const newField: RegistrationFormField = {
        id: template.id,
        label: template.label,
        type: template.type,
        placeholder: template.placeholder,
        description: template.description,
        required: false,
        visible: true,
        isCustom: template.isCustom,
        prebuiltType: template.prebuiltType,
        options: template.options,
      };
      
      updateFormConfig({ ...formConfig, fields: [...formConfig.fields, newField] });
      setFocusedFieldId(newField.id);
      toast({
        title: "Field Added",
        description: `Successfully added prebuilt "${template.label}" question.`,
      });
    }
  };

  const removeField = (id: string) => {
    // If it's standard, hide it instead of deleting it permanently, keeping schema intact
    const standardField = DEFAULT_REGISTRATION_FIELDS.find(f => f.id === id);
    if (standardField) {
      updateField(id, { visible: false, required: false });
    } else {
      updateFormConfig({ ...formConfig, fields: formConfig.fields.filter((f) => f.id !== id) });
    }
    if (focusedFieldId === id) setFocusedFieldId(null);
    toast({
      title: "Field Deactivated",
      description: "Question removed or hidden from the registration form."
    });
  };

  const moveField = (index: number, direction: "up" | "down") => {
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= formConfig.fields.length) return;
    
    // Deep clone array items to guarantee React reactive re-render
    const nextFields = formConfig.fields.map(f => ({ ...f }));
    const temp = nextFields[index];
    nextFields[index] = nextFields[targetIndex];
    nextFields[targetIndex] = temp;
    
    updateFormConfig({ ...formConfig, fields: nextFields });
    
    // Keep focus locked on the same moving field
    setFocusedFieldId(nextFields[targetIndex].id);
    
    toast({
      title: "Question Reordered",
      description: `Moved question successfully ${direction}.`
    });
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

  const registrationUrl = useMemo(() => {
    if (typeof window === "undefined") return "";
    const origin = window.location.origin;
    const id = tournamentId ?? 44;
    return `${origin}/tournaments/${id}/register`;
  }, [tournamentId]);

  const handleCopyLink = () => {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(registrationUrl);
      toast({
        title: "Link Copied",
        description: "Registration form link copied to clipboard.",
      });
    } else {
      toast({
        title: "Copy Failed",
        description: "Clipboard access is not supported in this browser environment.",
        variant: "destructive",
      });
    }
  };

  const getFieldIcon = (field: RegistrationFormField) => {
    if (field.prebuiltType === "school") return <School className="h-4 w-4 text-slate-500" />;
    if (field.prebuiltType === "grade") return <GraduationCap className="h-4 w-4 text-slate-500" />;
    if (field.prebuiltType === "coach") return <User className="h-4 w-4 text-slate-500" />;
    if (field.prebuiltType === "club") return <Users className="h-4 w-4 text-slate-500" />;
    if (field.prebuiltType === "tshirt") return <Shirt className="h-4 w-4 text-slate-500" />;
    if (field.prebuiltType === "gender") return <User className="h-4 w-4 text-slate-500" />;
    if (field.prebuiltType === "dob") return <Calendar className="h-4 w-4 text-slate-500" />;
    if (field.prebuiltType === "uscf_expiration") return <CreditCard className="h-4 w-4 text-slate-500" />;
    if (field.prebuiltType === "fide_federation") return <Globe className="h-4 w-4 text-slate-500" />;

    // Standard columns mapping
    if (field.id === "uscfId" || field.id === "fideId" || field.id.toLowerCase().includes("payment") || field.id.toLowerCase().includes("fee") || field.id.toLowerCase().includes("donation")) {
      return <CreditCard className="h-4 w-4 text-slate-500" />;
    }
    if (field.id.toLowerCase().includes("tshirt")) {
      return <Shirt className="h-4 w-4 text-slate-500" />;
    }
    if (field.id === "byePreference") return <Compass className="h-4 w-4 text-slate-500" />;
    if (field.id === "newsletter") return <Mail className="h-4 w-4 text-slate-500" />;
    if (field.id === "arrivalTime") return <Clock className="h-4 w-4 text-slate-500" />;
    if (field.id === "notes") return <Settings className="h-4 w-4 text-slate-500" />;
    if (field.id.startsWith("address") || field.id === "city" || field.id === "state" || field.id === "postalCode" || field.id === "country") return <MapPin className="h-4 w-4 text-slate-500" />;

    return <Settings className="h-4 w-4 text-slate-500" />;
  };

  const getFieldTag = (field: RegistrationFormField) => {
    if (field.prebuiltType) return "Chess Prebuilt";
    if (field.isCustom) return "Custom Question";
    return "Standard Field";
  };

  const getFieldTagClass = (field: RegistrationFormField) => {
    if (field.prebuiltType) return "bg-sky-50 text-sky-700 border-sky-200/50";
    if (field.isCustom) return "bg-blue-50 text-blue-700 border-blue-200/50";
    return "bg-slate-50 text-slate-600 border-slate-200/50";
  };

  return (
    <div className="rounded-2xl border bg-slate-50/50 p-6 space-y-6 shadow-sm border-slate-200/60 font-sans">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <h3 className="text-xl font-extrabold tracking-tight text-slate-950 flex items-center gap-2.5">
            <Sliders className="h-5.5 w-5.5 text-blue-600" />
            Edit Registration Form
          </h3>
          <p className="text-xs font-semibold text-slate-500 leading-relaxed">
            Customize fields and request parameters for player signups. Reorder blocks and save to update instantly.
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
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left Columns: Main Configuration Builder List */}
        <div className="lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between border-b pb-2">
            <span className="text-xs font-extrabold text-slate-500 tracking-wider uppercase">Active Form Fields Schema</span>
            <span className="text-xs text-slate-400 font-semibold">{formConfig.fields.filter(f => f.visible).length} active / {formConfig.fields.length} total blocks</span>
          </div>

          <div className="space-y-3">
            {formConfig.fields.map((field, idx) => {
              const isFocused = focusedFieldId === field.id;
              return (
                <div 
                  key={field.id}
                  draggable={focusedFieldId !== field.id}
                  onDragStart={(e) => {
                    setDraggedIndex(idx);
                    e.dataTransfer.effectAllowed = "move";
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    if (draggedIndex !== null && draggedIndex !== idx) {
                      setDragOverIndex(idx);
                    }
                  }}
                  onDragEnd={() => {
                    setDraggedIndex(null);
                    setDragOverIndex(null);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (draggedIndex !== null && draggedIndex !== idx) {
                      const nextFields = [...formConfig.fields];
                      const [draggedItem] = nextFields.splice(draggedIndex, 1);
                      nextFields.splice(idx, 0, draggedItem);
                      updateFormConfig({ ...formConfig, fields: nextFields });
                      toast({
                        title: "Fields Reordered",
                        description: `Moved "${draggedItem.label}" successfully.`,
                      });
                    }
                    setDraggedIndex(null);
                    setDragOverIndex(null);
                  }}
                  className={`transition-all duration-200 relative ${
                    draggedIndex === idx ? "opacity-30 scale-[0.98] border-2 border-dashed border-blue-200 rounded-2xl" : ""
                  } ${
                    dragOverIndex === idx && draggedIndex !== idx ? "border-t-4 border-t-blue-500 pt-3" : ""
                  }`}
                >
                  {isFocused ? (
                    /* EXPANDED ACTIVE STATE CARD */
                    <div 
                      className="border-l-4 border-l-blue-600 bg-white border-slate-200 shadow-lg p-5 rounded-2xl animate-in fade-in duration-200"
                    >
                      <div className="flex items-center justify-between gap-3 pb-3 mb-3.5 border-b border-slate-100">
                        <div className="flex items-center gap-2">
                          <GripVertical className="h-4 w-4 text-slate-400 cursor-grab active:cursor-grabbing" />
                          <span className="text-[10px] font-extrabold text-slate-400 tracking-wider">
                            QUESTION {idx + 1}
                          </span>
                          <span className={`text-[10px] font-extrabold px-1.5 py-0.25 border rounded-full ${getFieldTagClass(field)}`}>
                            {getFieldTag(field)}
                          </span>
                        </div>
                        
                        {/* Type converter dropdown */}
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

                      {/* Edit Fields */}
                      <div className="space-y-4">
                        <div className="grid gap-4 sm:grid-cols-2">
                          <div className="space-y-1">
                            <Label className="text-[11px] font-extrabold text-slate-500 tracking-wide">Question Label</Label>
                            <Input
                              value={field.label}
                              onChange={(e) => updateField(field.id, { label: e.target.value })}
                              className="h-10 text-sm bg-white rounded-xl focus:border-blue-500 font-semibold"
                            />
                          </div>

                          {field.type !== "boolean" && (
                            <div className="space-y-1">
                              <Label className="text-[11px] font-extrabold text-slate-500 tracking-wide">Watermark Placeholder</Label>
                              <Input
                                value={field.placeholder ?? ""}
                                onChange={(e) => updateField(field.id, { placeholder: e.target.value })}
                                placeholder="Type helper text..."
                                className="h-10 text-sm bg-white rounded-xl focus:border-blue-500"
                              />
                            </div>
                          )}
                        </div>

                        <div className="space-y-1">
                          <Label className="text-[11px] font-extrabold text-slate-500 tracking-wide">Helper Explanation / Instructions</Label>
                          <textarea
                            value={field.description ?? ""}
                            onChange={(e) => updateField(field.id, { description: e.target.value })}
                            rows={2}
                            placeholder="Helpful hints appear under the question..."
                            className="w-full text-xs border rounded-xl p-3 bg-white border-slate-200 focus:outline-none focus:border-blue-500 font-semibold leading-relaxed"
                          />
                        </div>

                        {field.type === "select" && (
                          <OptionsManager
                            options={field.options ?? []}
                            onChange={(nextOptions) => updateField(field.id, { options: nextOptions })}
                          />
                        )}

                        {/* Bottom bar controls */}
                        <div className="flex flex-wrap items-center justify-between gap-4 pt-3 border-t border-slate-100">
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

                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => removeField(field.id)}
                              className="h-8 text-xs text-red-500 hover:text-red-700 hover:bg-red-50 gap-1.5 rounded-lg font-bold"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                              {DEFAULT_REGISTRATION_FIELDS.some(f => f.id === field.id) ? "Hide Field" : "Delete"}
                            </Button>
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    /* COLLAPSED INACTIVE STATE CARD */
                    <div 
                      onClick={() => setFocusedFieldId(field.id)}
                      className={`border-l-4 border-l-transparent bg-white hover:bg-slate-50/20 border-slate-200 hover:border-slate-300 shadow-sm p-4 rounded-2xl cursor-pointer transition-all duration-200 flex flex-col gap-2.5 relative ${
                        !field.visible ? "opacity-60" : ""
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span className="text-xs font-bold text-slate-400 shrink-0">#{idx + 1}</span>
                          <div className="flex-shrink-0 h-7 w-7 rounded-lg bg-slate-50 border border-slate-200 flex items-center justify-center">
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

                        <div className="flex items-center gap-3 shrink-0" onClick={(e) => e.stopPropagation()}>
                          <span className={`text-[10px] font-bold px-2 py-0.5 border rounded-full ${getFieldTagClass(field)}`}>
                            {field.type === "text" ? "Short Text" : field.type === "number" ? "Number" : field.type === "select" ? "Dropdown" : "Yes/No"}
                          </span>

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

                      <div className="pl-9 pr-1">
                        {field.type === "text" || field.type === "number" ? (
                          <div className="h-8 border border-slate-100 border-dashed rounded-lg bg-slate-50/30 flex items-center px-3 select-none">
                            <span className="text-xs text-slate-400 truncate font-semibold">{field.placeholder || "Type answer here..."}</span>
                          </div>
                        ) : field.type === "select" ? (
                          <div className="flex flex-wrap gap-1.5 max-h-12 overflow-hidden items-center">
                            {(field.options && field.options.length > 0) ? (
                              field.options.map((opt, oIdx) => (
                                <span key={oIdx} className="inline-flex items-center px-2 py-0.5 rounded-md text-[9px] font-bold bg-slate-100 text-slate-600 border border-slate-200">
                                  {opt}
                                </span>
                              ))
                            ) : (
                              <span className="text-[10px] text-slate-400 italic">No options defined</span>
                            )}
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            <div className="h-4 w-4 rounded border border-slate-200 bg-slate-50 shrink-0" />
                            <span className="text-xs text-slate-400 font-semibold">Yes / No Option Checkbox</span>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* QUICK ADD BUILDER TOOLBAR */}
          <div className="sticky bottom-6 z-20 mx-auto flex items-center justify-between gap-2.5 p-2.5 rounded-3xl border border-slate-200/80 bg-white/95 backdrop-blur-md shadow-lg max-w-lg animate-in slide-in-from-bottom-5">
            <div className="flex items-center gap-1.5 w-full justify-between overflow-x-auto no-scrollbar">
              <div className="flex items-center gap-1.5 px-3 py-1 bg-slate-100 rounded-2xl shrink-0 whitespace-nowrap">
                <Plus className="h-3.5 w-3.5 text-slate-600 shrink-0" />
                <span className="text-[10px] font-extrabold text-slate-700 tracking-wider uppercase whitespace-nowrap">Custom Field</span>
              </div>
              
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 px-2 text-xs text-slate-700 hover:text-blue-600 hover:bg-blue-50/55 rounded-xl flex items-center gap-1 transition-all font-bold shrink-0 whitespace-nowrap"
                onClick={() => addCustomQuestionWithType("text")}
              >
                <AlignLeft className="h-3.5 w-3.5 text-blue-500 shrink-0" />
                <span>Text</span>
              </Button>
              
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 px-2 text-xs text-slate-700 hover:text-blue-600 hover:bg-blue-50/55 rounded-xl flex items-center gap-1 transition-all font-bold shrink-0 whitespace-nowrap"
                onClick={() => addCustomQuestionWithType("number")}
              >
                <Hash className="h-3.5 w-3.5 text-blue-500 shrink-0" />
                <span>Number</span>
              </Button>
              
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 px-2 text-xs text-slate-700 hover:text-blue-600 hover:bg-blue-50/55 rounded-xl flex items-center gap-1 transition-all font-bold shrink-0 whitespace-nowrap"
                onClick={() => addCustomQuestionWithType("select")}
              >
                <ListPlus className="h-3.5 w-3.5 text-blue-500 shrink-0" />
                <span>Dropdown</span>
              </Button>
              
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 px-2 text-xs text-slate-700 hover:text-blue-600 hover:bg-blue-50/55 rounded-xl flex items-center gap-1 transition-all font-bold shrink-0 whitespace-nowrap"
                onClick={() => addCustomQuestionWithType("boolean")}
              >
                <CheckSquare className="h-3.5 w-3.5 text-blue-500 shrink-0" />
                <span>Yes/No</span>
              </Button>
            </div>
          </div>
        </div>

        {/* Right Column: Dynamic Form Link & Accordion Prebuilt Shelf */}
        <div className="space-y-6">
          {/* Live Registration Link card */}
          <Card className="border border-blue-100 bg-blue-50/5 shadow-sm rounded-2xl">
            <CardHeader className="p-4 pb-2">
              <CardTitle className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <ExternalLink className="h-4 w-4 text-blue-600" />
                Live Registration Link
              </CardTitle>
              <CardDescription className="text-xs text-slate-500">
                View and test the active, fully working registration signup form page.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-4 pt-2 space-y-3">
              <div className="flex items-center gap-2 bg-white border border-slate-200 p-2.5 rounded-xl text-xs font-mono text-slate-600 select-all overflow-hidden truncate">
                <span className="truncate">{registrationUrl}</span>
              </div>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleCopyLink}
                  className="flex-1 gap-1.5 text-xs h-9 bg-white border-slate-200 text-slate-700 hover:bg-slate-50 font-bold rounded-xl shadow-sm"
                >
                  <Copy className="h-3.5 w-3.5 text-slate-500" />
                  Copy Link
                </Button>
                <Button
                  type="button"
                  variant="default"
                  size="sm"
                  onClick={() => window.open(registrationUrl, "_blank")}
                  className="flex-1 gap-1.5 text-xs h-9 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl shadow-sm"
                >
                  Open Form
                  <ExternalLink className="h-3.5 w-3.5" />
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Structured One-Click Add Shelf (Closed Accordion Blocks) */}
          <Card className="border border-slate-200 bg-white shadow-sm rounded-2xl">
            <CardHeader className="p-4 pb-2">
              <CardTitle className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <ListPlus className="h-4 w-4 text-blue-600" />
                One-Click Add Fields
              </CardTitle>
              <CardDescription className="text-xs text-slate-500">
                Instantly enable standard columns or inject structured questions grouped by category.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-4 pt-2 space-y-3">
              {ONE_CLICK_CATEGORIES.map((category) => (
                <details 
                  key={category.id} 
                  className="group border border-slate-200 rounded-xl bg-white overflow-hidden transition-all duration-200"
                >
                  <summary className="flex items-center justify-between p-3 font-semibold text-xs text-slate-700 cursor-pointer select-none bg-slate-50/50 hover:bg-slate-50 transition-colors">
                    <div className="flex items-center gap-2">
                      {category.icon}
                      <span>{category.name}</span>
                    </div>
                    <ChevronDown className="h-3.5 w-3.5 text-slate-400 group-open:rotate-180 transition-transform duration-200" />
                  </summary>
                  <div className="p-3 border-t border-slate-100 bg-slate-50/10 space-y-2.5">
                    <p className="text-[10px] text-slate-400 font-medium leading-normal mb-1">{category.description}</p>
                    <div className="space-y-1.5">
                      {category.fields.map((f) => {
                        const exists = formConfig.fields.some(field => field.id === f.id);
                        const isVisible = exists && formConfig.fields.find(field => field.id === f.id)?.visible;
                        const isCurrentlyActive = exists && isVisible;

                        return (
                          <div 
                            key={f.id} 
                            className="flex items-center justify-between gap-3 p-2 bg-white border border-slate-150 rounded-xl text-xs shadow-sm hover:border-slate-250 transition-colors"
                          >
                            <div className="min-w-0 flex-1 space-y-0.5">
                              <span className="font-bold text-slate-800 text-[11px] block truncate">{f.label}</span>
                              <span className="text-[9px] text-slate-400 block leading-normal truncate">{f.description}</span>
                            </div>
                            <Button
                              type="button"
                              variant={isCurrentlyActive ? "outline" : "default"}
                              size="sm"
                              onClick={() => addOrEnableField(f)}
                              className={`h-7 px-2 text-[10px] font-bold rounded-lg shrink-0 transition-all ${
                                isCurrentlyActive 
                                  ? "bg-slate-100 border-slate-200 text-slate-500 hover:bg-slate-150" 
                                  : "bg-blue-600 hover:bg-blue-700 text-white shadow-sm"
                              }`}
                            >
                              {isCurrentlyActive ? (
                                <span className="flex items-center gap-1">
                                  <Check className="h-3 w-3 text-emerald-600 font-extrabold" />
                                  Active
                                </span>
                              ) : (
                                "Add"
                              )}
                            </Button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </details>
              ))}
            </CardContent>
          </Card>
        </div>
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
