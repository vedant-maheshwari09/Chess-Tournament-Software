import React, { useEffect, useMemo, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { 
  Zap, Heading1, Heading2, Heading3, Bold, Italic, List, ListOrdered, 
  Link2, RotateCcw, Quote, Code, Minus, Table, Undo2, Redo2, 
  Copy, Eraser, Check, Image as ImageIcon, MapPin, FileUp, Globe,
  Strikethrough, Underline, ListChecks, AlignLeft, AlignCenter, AlignRight, AlignJustify,
  Type, Palette, Smile, Info,
  Calendar, ScrollText, Award, Map as MapIcon, Layout,
  ChevronDown, Link, Save, Clock, Share2, Monitor, Settings as SettingsIcon
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  buildTournamentPayload,
  parseTournamentConfig,
  serializeTournamentConfig,
  type TournamentConfig,
} from "@/lib/tournament-config";
import { renderTournamentPageContent } from "@/lib/tournament-page";
import type { Tournament } from "@shared/schema";
import { cn } from "@/lib/utils";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

type ToolbarAction = 
  | "h1" | "h2" | "h3" | "bold" | "italic" | "underline" | "strikethrough" 
  | "ul" | "ol" | "check" | "link" | "image" | "quote" | "code" | "hr" | "table" 
  | "align-left" | "align-center" | "align-right" | "align-justify" 
  | "normal" | "color" | "emoji" | "map"
  | "template-schedule" | "template-rules" | "template-venue" | "template-prizes" | "template-prize-table"
  | "template-hotel" | "template-contact" | "template-deadlines";

interface TournamentPagePanelProps {
  tournament: Tournament;
  onUpdated?: () => void;
}

export default function TournamentPagePanel({ tournament, onUpdated }: TournamentPagePanelProps) {
  const { toast } = useToast();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const [config, setConfig] = useState<TournamentConfig>(() => parseTournamentConfig(tournament));
  const [initialContent, setInitialContent] = useState<string>(
    parseTournamentConfig(tournament).tournamentPageContent ?? ""
  );
  const [refineInstructions, setRefineInstructions] = useState("");
  const [isCopied, setIsCopied] = useState(false);
  const [isAutosaving, setIsAutosaving] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedStateRef = useRef<string | null>(null);

  // Undo/Redo State
  const [history, setHistory] = useState<string[]>([]);
  const [redoStack, setRedoStack] = useState<string[]>([]);

  const previewHtml = useMemo(
    () => renderTournamentPageContent(config.tournamentPageContent ?? ""),
    [config.tournamentPageContent],
  );

  useEffect(() => {
    const nextConfig = parseTournamentConfig(tournament);
    setConfig(nextConfig);
    setInitialContent(nextConfig.tournamentPageContent ?? "");
    setHistory([]);
    setRedoStack([]);
  }, [tournament]);

  const handleContentChange = (value: string, skipHistory = false) => {
    if (!skipHistory) {
      setHistory(prev => [...prev.slice(-19), config.tournamentPageContent ?? ""]);
      setRedoStack([]);
    }
    setConfig((prev) => ({ ...prev, tournamentPageContent: value }));
  };

  const undo = () => {
    if (history.length === 0) return;
    const prev = history[history.length - 1];
    setRedoStack(r => [config.tournamentPageContent ?? "", ...r]);
    setHistory(h => h.slice(0, -1));
    handleContentChange(prev, true);
  };

  const redo = () => {
    if (redoStack.length === 0) return;
    const next = redoStack[0];
    setHistory(h => [...h, config.tournamentPageContent ?? ""]);
    setRedoStack(r => r.slice(1));
    handleContentChange(next, true);
  };

  const updatePublicPage = (updates: Partial<NonNullable<TournamentConfig["publicPage"]>>) =>
    setConfig((prev) => ({ 
      ...prev, 
      publicPage: { 
        ...(prev.publicPage || {}), 
        ...updates 
      } 
    }));

  const toolbarGroups = [
    {
      label: "Heading",
      isDropdown: true,
      items: [
        { action: "normal", icon: <Type className="h-4 w-4" />, label: "Normal" },
        { action: "h1", icon: <span className="font-bold">H1</span>, label: "Heading 1" },
        { action: "h2", icon: <span className="font-bold">H2</span>, label: "Heading 2" },
        { action: "h3", icon: <span className="font-bold text-xs">H3</span>, label: "Heading 3" },
      ]
    },
    {
      label: "Formatting",
      items: [
        { action: "bold", icon: <Bold className="h-4 w-4" />, label: "Bold" },
        { action: "italic", icon: <Italic className="h-4 w-4" />, label: "Italic" },
        { action: "underline", icon: <Underline className="h-4 w-4" />, label: "Underline" },
        { action: "strikethrough", icon: <Strikethrough className="h-4 w-4" />, label: "Strike" },
      ]
    },
    {
      label: "Alignment",
      items: [
        { action: "align-left", icon: <AlignLeft className="h-4 w-4" />, label: "Left" },
        { action: "align-center", icon: <AlignCenter className="h-4 w-4" />, label: "Center" },
        { action: "align-right", icon: <AlignRight className="h-4 w-4" />, label: "Right" },
        { action: "align-justify", icon: <AlignJustify className="h-4 w-4" />, label: "Justify" },
      ]
    },
    {
      label: "Lists",
      items: [
        { action: "ul", icon: <List className="h-4 w-4" />, label: "Bullets" },
        { action: "ol", icon: <ListOrdered className="h-4 w-4" />, label: "Numbers" },
        { action: "check", icon: <ListChecks className="h-4 w-4" />, label: "Checklist" },
      ]
    },
    {
      label: "Insert",
      items: [
        { action: "link", icon: <Link className="h-4 w-4" />, label: "Link" },
        { action: "image", icon: <ImageIcon className="h-4 w-4" />, label: "Image" },
        { action: "table", icon: <Table className="h-4 w-4" />, label: "Table" },
        { action: "hr", icon: <Minus className="h-4 w-4" />, label: "Divider" },
      ]
    },
    {
      label: "Tournament",
      isDropdown: true,
      dropdownLabel: "Special Tools",
      items: [
        { action: "map", icon: <MapPin className="h-4 w-4" />, label: "Location Map" },
        { action: "template-venue", icon: <MapIcon className="h-4 w-4" />, label: "Venue Information" },
        { action: "template-prize-table", icon: <Layout className="h-4 w-4" />, label: "Chess Prize Fund" },
        { action: "template-schedule", icon: <Calendar className="h-4 w-4" />, label: "Tournament Schedule" },
        { action: "template-rules", icon: <ScrollText className="h-4 w-4" />, label: "Official Rules" },
        { action: "template-prizes", icon: <Award className="h-4 w-4" />, label: "Trophies & Medals" },
        { action: "template-hotel", icon: <Layout className="h-4 w-4" />, label: "Hotel & Lodging" },
        { action: "template-contact", icon: <Link className="h-4 w-4" />, label: "Contact Information" },
        { action: "template-deadlines", icon: <Clock className="h-4 w-4" />, label: "Registration Deadlines" },
      ]
    }
  ];

  const appendContentBlock = (snippet: string, { ensureSpacing = true }: { ensureSpacing?: boolean } = {}) => {
    const current = config.tournamentPageContent ?? "";
    const prefix = ensureSpacing && current.trim().length > 0 ? "\n\n" : "";
    handleContentChange(`${current}${prefix}${snippet}`);
  };

  const wrapSelection = (
    before: string,
    after = "",
    options: { placeholder?: string; selectPlaceholder?: boolean; newlineBefore?: boolean } = {}
  ) => {
    const textarea = textareaRef.current;
    const currentValue = config.tournamentPageContent ?? "";
    const start = textarea ? textarea.selectionStart : currentValue.length;
    const end = textarea ? textarea.selectionEnd : start;
    const needsNewline = options.newlineBefore && start > 0 && !currentValue.slice(0, start).endsWith("\n");
    const selected = currentValue.slice(start, end);
    const placeholder = selected.length > 0 ? selected : options.placeholder ?? "";
    const insertBefore = `${needsNewline ? "\n" : ""}${before}`;

    const nextValue =
      currentValue.slice(0, start) +
      insertBefore +
      placeholder +
      after +
      currentValue.slice(end);

    handleContentChange(nextValue);

    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      const base = start + insertBefore.length;
      if (options.selectPlaceholder && placeholder.length > 0) {
        el.setSelectionRange(base, base + placeholder.length);
      } else {
        const position = base + placeholder.length + after.length;
        el.setSelectionRange(position, position);
      }
    });
  };

  const handleToolbarAction = (action: ToolbarAction) => {
    switch (action) {
      case "normal": wrapSelection("", "", { newlineBefore: true }); break;
      case "h1": wrapSelection("# ", "", { newlineBefore: true }); break;
      case "h2": wrapSelection("## ", "", { newlineBefore: true }); break;
      case "h3": wrapSelection("### ", "", { newlineBefore: true }); break;
      case "bold": wrapSelection("**", "**", { placeholder: "Bold text", selectPlaceholder: true }); break;
      case "italic": wrapSelection("*", "*", { placeholder: "Italic text", selectPlaceholder: true }); break;
      case "underline": wrapSelection("<u>", "</u>", { placeholder: "Underlined text", selectPlaceholder: true }); break;
      case "strikethrough": wrapSelection("~~", "~~", { placeholder: "Strikethrough text", selectPlaceholder: true }); break;
      case "ul": wrapSelection("- ", "", { newlineBefore: true }); break;
      case "ol": wrapSelection("1. ", "", { newlineBefore: true }); break;
      case "check": wrapSelection("- [ ] ", "", { newlineBefore: true }); break;
      case "link": wrapSelection("[", "](https://)", { placeholder: "Link text", selectPlaceholder: true }); break;
      case "quote": wrapSelection("> ", "", { newlineBefore: true }); break;
      case "code": wrapSelection("```\n", "\n```", { placeholder: "code here", selectPlaceholder: true }); break;
      case "hr": appendContentBlock("---"); break;
      case "table": 
        appendContentBlock("| Column 1 | Column 2 |\n| --- | --- |\n| Data | Data |");
        break;
      case "align-left": wrapSelection("{{align-left:", "}}", { placeholder: "left aligned text", selectPlaceholder: true }); break;
      case "align-center": wrapSelection("{{align-center:", "}}", { placeholder: "centered text", selectPlaceholder: true }); break;
      case "align-right": wrapSelection("{{align-right:", "}}", { placeholder: "right aligned text", selectPlaceholder: true }); break;
      case "align-justify": wrapSelection("{{align-justify:", "}}", { placeholder: "justified text", selectPlaceholder: true }); break;
      case "color": /* Handled via dropdown */ break;
      case "map":
        const query = window.prompt("Enter address for map buttons (e.g. '123 Main St, New York')");
        if (query) appendContentBlock(`{{map-buttons:${query}}}`);
        break;
      case "template-schedule":
        appendContentBlock("## 📅 Tournament Schedule\n\n- **Check-in:** 08:30 AM - 09:15 AM\n- **Round 1:** 09:30 AM\n- **Lunch Break:** 12:30 PM\n- **Round 2:** 01:30 PM\n- **Awards Ceremony:** 05:00 PM");
        break;
      case "template-rules":
        appendContentBlock("## 📜 Tournament Rules\n\n1. **Time Control:** 30 minutes per player.\n2. **Touch Move:** The touch-move rule is strictly enforced.\n3. **Silence:** Please maintain silence in the playing area.\n4. **Disputes:** All disputes will be resolved by the TD.");
        break;
      case "template-venue":
        appendContentBlock("## 📍 Venue Information\n\n**Location:** [Venue Name]\n**Address:** [Full Address Here]\n\n{{map-buttons:Enter Address Here}}");
        break;
      case "template-prizes":
        appendContentBlock("## 🏆 Prizes & Awards\n\n- **1st Place:** $500 + Trophy\n- **2nd Place:** $250 + Medal\n- **3rd Place:** $100 + Medal\n- **Best Junior:** Chess Set");
        break;
      case "image":
        imageInputRef.current?.click();
        break;
      case "template-prize-table":
        appendContentBlock("## 💰 Prize Fund Breakdown\n\n| Section | 1st | 2nd | 3rd | 4th |\n| :--- | :---: | :---: | :---: | :---: |\n| **Open** | $5000 | $2500 | $1250 | $650 |\n| **U2300** | $4000 | $2000 | $1000 | $500 |\n| **U2100** | $4000 | $2000 | $1000 | $500 |\n| **U1900** | $3000 | $1500 | $750 | $325 |");
        break;
      case "template-hotel":
        appendContentBlock("## 🏨 Hotel & Accommodation\n\n**Official Hotel:** Embassy Suites Hotel\n**Special Group Rate:** Use code “ACA” by August 8.\n\n**Amenities Included:**\n- Beautiful two-room suites with sleeper sofa\n- Full American Cooked-to-order Breakfast\n- Complimentary Evening Reception");
        break;
      case "template-contact":
        appendContentBlock("## ✉️ Contact Information\n\n**Tournament Director:** [Director Name]\n**Email:** [Email Address]\n\nFor questions regarding registration or FIDE/USCF requirements, please reach out via email.");
        break;
      case "template-deadlines":
        appendContentBlock("## ⏳ Registration Deadlines\n\n- **Early Bird:** Before July 1st ($10 discount)\n- **Standard:** July 1st - August 15th\n- **Late Registration:** After August 15th ($25 late fee)\n- **On-site Registration:** No on-site registration allowed.");
        break;
    }
  };

  const geminiRefine = useMutation({
    mutationFn: async () =>
      apiRequest("/api/tools/gemini-refine", {
        method: "POST",
        body: JSON.stringify({ 
          config: { 
            ...config, 
            instructions: refineInstructions,
            tournamentPageContent: config.tournamentPageContent 
          } 
        }),
      }),
    onSuccess: (data: any) => {
      const generated = (data?.content ?? "").toString().trim();
      if (generated) {
        handleContentChange(generated);
        setRefineInstructions("");
        toast({ title: "Content refined", description: "Gemini has updated your tournament page." });
      } else {
        toast({ title: "No content returned", description: "Try again with different instructions." });
      }
    },
    onError: (error: any) => {
      toast({ title: "Refinement failed", description: error?.message || "Unable to refine content.", variant: "destructive" });
    },
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = buildTournamentPayload(config, { format: tournament.format });
      payload.roundTimings = serializeTournamentConfig({ ...config, format: tournament.format });
      (payload as any).status = tournament.status;
      return apiRequest(`/api/tournaments/${tournament.id}`, {
        method: "PUT",
        body: JSON.stringify(payload),
      });
    },
    onSuccess: (updatedTournament: Tournament) => {
      const nextConfig = parseTournamentConfig(updatedTournament);
      setConfig(nextConfig);
      setInitialContent(nextConfig.tournamentPageContent ?? "");
      setHistory([]);
      setRedoStack([]);
      toast({ title: "Tournament page updated" });
      onUpdated?.();
    },
    onError: (error: any) => {
      toast({ title: "Save failed", description: error?.message ?? "Unable to update tournament page.", variant: "destructive" });
      setIsAutosaving(false);
    },
  });

  // --- Auto-save implementation ---
  useEffect(() => {
    // We want to detect changes in any part of the config
    // Skip if config hasn't changed from what we last saved or initially loaded
    const currentConfigStr = JSON.stringify(config);
    if (currentConfigStr === lastSavedStateRef.current) return;
    
    // If it's exactly what came from the tournament prop, skip
    const initialConfigStr = JSON.stringify(parseTournamentConfig(tournament));
    if (currentConfigStr === initialConfigStr) {
      lastSavedStateRef.current = initialConfigStr;
      return;
    }

    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);

    autoSaveTimerRef.current = setTimeout(() => {
      setIsAutosaving(true);
      
      const payload = buildTournamentPayload(config, { format: tournament.format });
      payload.roundTimings = serializeTournamentConfig({ ...config, format: tournament.format });
      (payload as any).status = tournament.status;

      apiRequest(`/api/tournaments/${tournament.id}`, {
        method: "PUT",
        body: JSON.stringify(payload),
      }).then((updated: Tournament) => {
        const nextConfig = parseTournamentConfig(updated);
        lastSavedStateRef.current = JSON.stringify(nextConfig);
        setLastSavedAt(new Date());
        setIsAutosaving(false);
      }).catch((error) => {
        console.error("Autosave failed:", error);
        setIsAutosaving(false);
      });
    }, 2000); // 2-second debounce for all settings

    return () => { if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current); };
  }, [config, tournament.id, tournament.format, tournament.status]);

  const hasChanges = (config.tournamentPageContent ?? "") !== initialContent;

  const copyToClipboard = () => {
    navigator.clipboard.writeText(config.tournamentPageContent ?? "");
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
    toast({ title: "Copied to clipboard" });
  };

  const clearContent = () => {
    if (window.confirm("Are you sure you want to clear all content?")) {
      handleContentChange("");
    }
  };

  const handleImportFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      handleContentChange(text);
      toast({ title: "Content imported" });
    } catch (e) {
      toast({ title: "Import failed", variant: "destructive" });
    }
  };

  return (
    <Card className="border-slate-200 shadow-sm overflow-hidden">
      <CardHeader className="bg-slate-50/50 border-b border-slate-100">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-xl font-bold flex items-center gap-2">
              <Globe className="h-5 w-5 text-primary" />
              Public Tournament Page
            </CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              Craft a professional landing page for your tournament.
            </p>
          </div>
          <div className="flex items-center gap-4">
             <div className="hidden md:flex items-center gap-2 text-xs text-muted-foreground bg-slate-100/50 px-2 py-1 rounded-md border border-slate-200/50">
               {isAutosaving ? (
                 <span className="flex items-center gap-1.5">
                   <RotateCcw className="h-3 w-3 animate-spin" />
                   Autosaving...
                 </span>
               ) : lastSavedAt ? (
                 <span className="flex items-center gap-1.5 text-emerald-600 font-medium">
                   <Check className="h-3 w-3" />
                   Autosaved {lastSavedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                 </span>
               ) : (
                 <span className="flex items-center gap-1.5">
                   <Save className="h-3 w-3 opacity-50" />
                   Draft ready
                 </span>
               )}
             </div>
             <Button variant="outline" size="sm" onClick={() => importInputRef.current?.click()}>
                <FileUp className="h-4 w-4 mr-2" />
                Import
             </Button>

          </div>
        </div>
      </CardHeader>

      <CardContent className="p-0">
        <div className="grid grid-cols-1 xl:grid-cols-2 divide-x divide-slate-100 min-h-[600px]">
          {/* Editor Column */}
          <div className="flex flex-col bg-white">
            <div className="sticky top-0 z-10 p-2 bg-white border-b border-slate-100 flex flex-wrap items-center justify-between gap-y-2">
              <div className="flex flex-wrap items-center gap-x-1 gap-y-1.5">
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={undo} disabled={history.length === 0}>
                        <Undo2 className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Undo</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={redo} disabled={redoStack.length === 0}>
                        <Redo2 className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Redo</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
                
                <Separator orientation="vertical" className="h-6 mx-1 hidden sm:block" />

                {toolbarGroups.map((group, idx) => (
                  <React.Fragment key={group.label}>
                    {group.isDropdown ? (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button 
                            variant="ghost" 
                            size="sm" 
                            className="h-8 gap-1 px-2 text-slate-600 bg-slate-50/50 hover:bg-white hover:shadow-sm"
                          >
                            {group.dropdownLabel || group.label}
                            <ChevronDown className="h-3 w-3 opacity-50" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start" className="w-48">
                          {group.items.map((item) => (
                            <DropdownMenuItem 
                              key={item.action} 
                              onClick={() => handleToolbarAction(item.action as ToolbarAction)}
                              className="gap-2"
                            >
                              {item.icon}
                              <span>{item.label}</span>
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    ) : (
                      <div className="flex items-center gap-0.5 bg-slate-50/50 p-0.5 rounded-lg border border-slate-100">
                        {group.items.map((item) => (
                          <TooltipProvider key={item.action}>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 text-slate-600 hover:text-primary hover:bg-white hover:shadow-sm transition-all"
                                  onClick={() => handleToolbarAction(item.action as ToolbarAction)}
                                >
                                  {item.icon}
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent side="bottom" className="text-xs">{item.label}</TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        ))}
                      </div>
                    )}
                  </React.Fragment>
                ))}
                
                <Separator orientation="vertical" className="h-6 mx-1 hidden sm:block" />

                <div className="flex items-center gap-0.5">
                  <TooltipProvider>
                    <DropdownMenu>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-600 hover:text-primary">
                              <Palette className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                        </TooltipTrigger>
                        <TooltipContent>Text Color</TooltipContent>
                      </Tooltip>
                      <DropdownMenuContent align="start">
                        <DropdownMenuItem onClick={() => wrapSelection("{{color-red:", "}}", { placeholder: "red text", selectPlaceholder: true })} className="text-red-500 font-medium">Red</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => wrapSelection("{{color-blue:", "}}", { placeholder: "blue text", selectPlaceholder: true })} className="text-blue-500 font-medium">Blue</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => wrapSelection("{{color-green:", "}}", { placeholder: "green text", selectPlaceholder: true })} className="text-green-500 font-medium">Green</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => wrapSelection("{{color-yellow:", "}}", { placeholder: "yellow text", selectPlaceholder: true })} className="text-yellow-600 font-medium">Yellow</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => wrapSelection("{{color-purple:", "}}", { placeholder: "purple text", selectPlaceholder: true })} className="text-purple-500 font-medium">Purple</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>

                    <Popover>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <PopoverTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-600 hover:text-primary">
                              <Smile className="h-4 w-4" />
                            </Button>
                          </PopoverTrigger>
                        </TooltipTrigger>
                        <TooltipContent>Insert Emoji</TooltipContent>
                      </Tooltip>
                      <PopoverContent className="w-64 p-2" align="start">
                        <div className="grid grid-cols-6 gap-1">
                          {['🏆', '♟️', '⚔️', '⏱️', '📍', '📅', '📢', '🔥', '✨', '✅', '❌', 'ℹ️', '🤝', '🙌', '👏', '🚀', '⭐', '💎'].map(emoji => (
                            <Button 
                              key={emoji} 
                              variant="ghost" 
                              size="sm" 
                              className="h-8 w-8 p-0 text-lg"
                              onClick={() => {
                                wrapSelection(emoji, "");
                              }}
                            >
                              {emoji}
                            </Button>
                          ))}
                        </div>
                      </PopoverContent>
                    </Popover>


                    {/* Page Settings moved to Options Tab, but added here for live preview convenience */}


                  </TooltipProvider>
                </div>
              </div>

              <div className="flex items-center gap-1 pr-2 ml-auto">
                <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-400 hover:text-red-500" onClick={clearContent}>
                  <Eraser className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-400 hover:text-primary" onClick={copyToClipboard}>
                  {isCopied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
            </div>

            <div className="flex-1 relative flex flex-col">
              <Textarea
                ref={textareaRef}
                value={config.tournamentPageContent ?? ""}
                onChange={(e) => handleContentChange(e.target.value)}
                className="flex-1 border-none focus-visible:ring-0 resize-none p-6 text-base leading-relaxed font-mono"
                placeholder="Start writing your tournament page content here..."
              />
              
              {/* Gemini Refinement Bar */}
              <div className="sticky bottom-0 z-10 p-4 bg-slate-50/90 backdrop-blur-md border-t border-slate-100 mt-auto">
                <div className="flex gap-2">
                  <div className="flex-1 relative">
                    <Input
                      value={refineInstructions}
                      onChange={(e) => setRefineInstructions(e.target.value)}
                      placeholder="Ask Gemini to refine your draft (e.g. 'make it more formal', 'add section headers')..."
                      className="bg-white pr-10 h-10 border-slate-200 shadow-sm"
                      onKeyDown={(e) => e.key === "Enter" && geminiRefine.mutate()}
                    />
                    <Zap className="absolute right-3 top-3 h-4 w-4 text-primary/40" />
                  </div>
                  <Button 
                    variant="default" 
                    size="sm" 
                    className="h-10 px-4 shadow-md bg-gradient-to-r from-primary to-blue-600 hover:from-primary/90 hover:to-blue-700 border-none shrink-0"
                    onClick={() => geminiRefine.mutate()}
                    disabled={geminiRefine.isPending}
                  >
                    {geminiRefine.isPending ? (
                      <RotateCcw className="h-4 w-4 animate-spin mr-2" />
                    ) : (
                      <Zap className="h-4 w-4 mr-2" />
                    )}
                    <span className="hidden sm:inline">Refine with Gemini</span>
                    <span className="sm:hidden">Refine</span>
                  </Button>
                </div>
              </div>
            </div>
          </div>

          {/* Preview Column */}
          <div className="flex flex-col bg-slate-50/30 overflow-hidden">
            <div className="sticky top-0 z-10 p-3 bg-white/80 backdrop-blur-md border-b border-slate-100 px-6">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Live Preview</span>
            </div>
            <div className="flex-1 overflow-y-auto p-0 bg-slate-100/50">
               <div className={cn(
                 "min-h-full transition-colors duration-500",
                 config.publicPage?.theme === "professional" && "bg-slate-50",
                 config.publicPage?.theme === "vibrant" && "bg-blue-50/50",
                 config.publicPage?.theme === "dark" && "bg-slate-950 text-slate-100",
                 config.publicPage?.theme === "glass" && "bg-gradient-to-br from-indigo-50 via-white to-purple-50"
               )}>
                 <style dangerouslySetInnerHTML={{ __html: `
                   :root {
                     ${config.publicPage?.customAccentColor ? `--primary: ${config.publicPage.customAccentColor};` : ''}
                   }
                 `}} />

                 {/* Banner Preview */}
                 {config.publicPage?.bannerUrl ? (
                   <div className="relative h-48 w-full overflow-hidden">
                     <img 
                       src={config.publicPage.bannerUrl} 
                       alt="Banner" 
                       className="w-full h-full object-cover"
                     />
                     <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent flex items-end p-6">
                        <h1 className="text-2xl font-bold text-white tracking-tight">{tournament.name}</h1>
                     </div>
                   </div>
                 ) : (
                   <div className="bg-white border-b border-slate-100 p-6">
                      <h1 className="text-2xl font-bold text-slate-900">{tournament.name}</h1>
                   </div>
                 )}

                 <div className="max-w-4xl mx-auto p-4 sm:p-8 space-y-6">
                   {/* Announcement Preview */}
                   {config.publicPage?.announcement && (
                     <div className="bg-amber-50 border-l-4 border-amber-500 p-4 rounded-r-lg shadow-sm flex items-start gap-3">
                        <Info className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
                        <div>
                          <h4 className="text-xs font-bold text-amber-800 uppercase tracking-tight">Announcement</h4>
                          <p className="text-amber-900 mt-0.5 text-sm font-medium">{config.publicPage.announcement}</p>
                        </div>
                     </div>
                   )}

                   <div className={cn(
                     "shadow-xl border border-slate-200/60 rounded-2xl p-6 sm:p-12 bg-white min-h-[400px]",
                     config.publicPage?.theme === "dark" && "bg-slate-900 border-slate-800",
                     config.publicPage?.theme === "glass" && "bg-white/70 backdrop-blur-md border-white/20"
                   )}>
                    {config.tournamentPageContent?.trim() ? (
                      <article 
                        className={cn(
                          "tournament-content prose prose-slate prose-headings:font-bold prose-a:text-primary prose-img:rounded-xl max-w-none",
                          config.publicPage?.theme === "dark" && "prose-invert"
                        )}
                        dangerouslySetInnerHTML={{ __html: previewHtml }}
                      />
                    ) : (
                      <div className="flex flex-col items-center justify-center py-20 text-center">
                        <div className="w-16 h-16 rounded-full bg-slate-50 flex items-center justify-center mb-4">
                          <Globe className="h-8 w-8 text-slate-200" />
                        </div>
                        <h3 className="text-lg font-semibold text-slate-400">Nothing to preview yet</h3>
                        <p className="text-sm text-slate-400 mt-1 max-w-[200px]">
                          Your changes will appear here in real-time.
                        </p>
                      </div>
                    )}
                   </div>
                 </div>
               </div>
            </div>
            </div>
        </div>
      </CardContent>

      <input
        type="file"
        ref={importInputRef}
        accept=".txt,.md,.markdown,.json,.html,.htm"
        className="hidden"
        onChange={handleImportFile}
      />
      <input
        type="file"
        ref={imageInputRef}
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          const reader = new FileReader();
          reader.onload = () => {
            const dataUrl = reader.result as string;
            appendContentBlock(`![${file.name}](${dataUrl})\n`);
            toast({ title: "Image added" });
          };
          reader.readAsDataURL(file);
        }}
      />
    </Card>
  );
}
