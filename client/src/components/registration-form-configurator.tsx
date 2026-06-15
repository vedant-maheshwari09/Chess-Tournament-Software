import React, { useState, useEffect, useMemo } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { Tournament } from "@shared/schema";
import { 
  Plus, 
  Trash2, 
  Save, 
  Loader2, 
  Eye, 
  EyeOff, 
  ChevronDown,
  FileUp,
  FileDown
} from "lucide-react";
import { 
  parseTournamentConfig, 
  DEFAULT_REGISTRATION_FIELDS, 
  type RegistrationFormConfig, 
  type RegistrationFormField 
} from "@/lib/tournament-config";

interface RegistrationFormConfiguratorProps {
  tournamentId: number;
  tournament: Tournament;
}

export default function RegistrationFormConfigurator({ tournamentId, tournament }: RegistrationFormConfiguratorProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [showPreview, setShowPreview] = useState(true); // Default to showing preview!

  const tournamentConfig = useMemo(() => {
    return parseTournamentConfig(tournament);
  }, [tournament]);

  // Local state for form fields
  const [fields, setFields] = useState<RegistrationFormField[]>([]);

  useEffect(() => {
    if (tournamentConfig?.registrationFormConfig?.fields) {
      setFields(tournamentConfig.registrationFormConfig.fields);
    } else {
      setFields(DEFAULT_REGISTRATION_FIELDS.map(f => ({ ...f })));
    }
  }, [tournamentConfig]);

  const saveConfigMutation = useMutation({
    mutationFn: async (updatedFields: RegistrationFormField[]) => {
      const updatedConfig = {
        ...tournamentConfig,
        registrationFormConfig: {
          fields: updatedFields
        }
      };

      return apiRequest(`/api/tournaments/${tournamentId}`, {
        method: "PATCH",
        body: JSON.stringify({ config: JSON.stringify(updatedConfig) }),
      });
    },
    onSuccess: () => {
      toast({
        title: "Configuration Saved",
        description: "Successfully updated registration form fields.",
      });
      queryClient.invalidateQueries({ queryKey: [`/api/tournaments/${tournamentId}`] });
    },
    onError: (err: any) => {
      toast({
        title: "Failed to Save",
        description: err?.message || "Could not save form configuration.",
        variant: "destructive",
      });
    }
  });

  const updateField = (id: string, updates: Partial<RegistrationFormField>) => {
    setFields(prev => prev.map(field => {
      if (field.id === id) {
        const updated = { ...field, ...updates };
        if ("visible" in updates && !updates.visible) {
          updated.required = false;
        }
        return updated;
      }
      return field;
    }));
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
    setFields(prev => [...prev, newField]);
  };

  const removeCustomField = (id: string) => {
    setFields(prev => prev.filter(field => field.id !== id));
  };

  const handleExport = () => {
    const configData: RegistrationFormConfig = { fields };
    const blob = new Blob([JSON.stringify(configData, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `registration-form-config-${tournamentId}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    toast({
      title: "Config Exported",
      description: "Downloaded form design JSON file."
    });
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const json = JSON.parse(event.target?.result as string);
        if (json && Array.isArray(json.fields)) {
          const validatedFields = json.fields.map((f: any) => ({
            id: String(f.id),
            label: String(f.label || ""),
            type: ["text", "number", "boolean", "select"].includes(f.type) ? f.type : "text",
            options: Array.isArray(f.options) ? f.options.map(String) : undefined,
            required: Boolean(f.required),
            visible: Boolean(f.visible),
            isCustom: Boolean(f.isCustom)
          }));

          setFields(validatedFields);
          toast({
            title: "Config Imported",
            description: "Applied form configuration successfully. Don't forget to click Save Changes."
          });
        } else {
          throw new Error("Invalid structure");
        }
      } catch (err) {
        toast({
          title: "Import Failed",
          description: "Ensure you selected a valid Chess Registration Form Config JSON file.",
          variant: "destructive"
        });
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const handleSave = () => {
    const invalidField = fields.find(f => f.isCustom && !f.label.trim());
    if (invalidField) {
      toast({
        title: "Validation Error",
        description: "All custom questions must have a label.",
        variant: "destructive"
      });
      return;
    }

    saveConfigMutation.mutate(fields);
  };

  const standardFields = useMemo(() => fields.filter(f => !f.isCustom), [fields]);
  const customFields = useMemo(() => fields.filter(f => f.isCustom), [fields]);

  return (
    <Card className="border-slate-200/60 shadow-sm bg-white">
      <CardHeader className="border-b border-slate-100 flex flex-col md:flex-row md:items-center justify-between gap-4 py-5 px-6">
        <div>
          <CardTitle className="text-lg font-bold text-slate-900">Registration Form Customizer</CardTitle>
          <CardDescription className="text-slate-400">
            Control which fields players see during sign-up, and create custom questionnaire fields.
          </CardDescription>
        </div>
        <div className="flex gap-2 items-center">
          <Button 
            variant="outline" 
            size="sm" 
            onClick={handleExport}
            className="border-slate-200 text-slate-600 hover:bg-slate-50 font-bold gap-1.5 text-xs h-8"
          >
            <FileDown className="h-3.5 w-3.5" />
            Export Config
          </Button>
          <Button 
            variant="outline" 
            size="sm" 
            onClick={() => fileInputRef.current?.click()}
            className="border-slate-200 text-slate-600 hover:bg-slate-50 font-bold gap-1.5 text-xs h-8"
          >
            <FileUp className="h-3.5 w-3.5" />
            Import Config
          </Button>
          <Button
            variant={showPreview ? "default" : "outline"}
            size="sm"
            className="gap-1.5 text-xs h-8 border-slate-200"
            onClick={() => setShowPreview((v) => !v)}
          >
            {showPreview ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            {showPreview ? "Hide Preview" : "Preview Form"}
          </Button>
          <input 
            type="file" 
            ref={fileInputRef} 
            onChange={handleImport} 
            accept=".json" 
            className="hidden" 
          />
        </div>
      </CardHeader>
      <CardContent className="p-6 space-y-6">
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
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Form Preview</p>
              <div className="rounded-2xl border border-slate-200 bg-slate-50/60 p-5 space-y-4 max-h-[600px] overflow-y-auto shadow-inner">
                <div className="space-y-1">
                  <p className="text-sm font-semibold text-slate-700">Registration Form</p>
                  <p className="text-xs text-slate-400">Preview of what players will see</p>
                </div>
                {/* Always-shown fields */}
                <div className="space-y-3">
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-slate-600">First Name <span className="text-red-500">*</span></label>
                    <div className="h-9 rounded-lg border border-slate-200 bg-white px-3 flex items-center text-xs text-slate-400">First name</div>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-slate-600">Last Name <span className="text-red-500">*</span></label>
                    <div className="h-9 rounded-lg border border-slate-200 bg-white px-3 flex items-center text-xs text-slate-400">Last name</div>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-slate-600">Rating</label>
                    <div className="h-9 rounded-lg border border-slate-200 bg-white px-3 flex items-center text-xs text-slate-400">e.g. 1500</div>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-slate-600">Email <span className="text-red-500">*</span></label>
                    <div className="h-9 rounded-lg border border-slate-200 bg-white px-3 flex items-center text-xs text-slate-400">your@email.com</div>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-slate-600">Section</label>
                    <div className="h-9 rounded-lg border border-slate-200 bg-white px-3 flex items-center justify-between text-xs text-slate-400">
                      <span>Select section...</span>
                      <ChevronDown className="h-3 w-3" />
                    </div>
                  </div>
                </div>
                {/* Standard visible fields */}
                {standardFields.filter((f) => f.visible).map((field) => (
                  <div key={field.id} className="space-y-1">
                    <label className="text-xs font-medium text-slate-600">
                      {field.label}
                      {field.required && <span className="text-red-500 ml-0.5">*</span>}
                    </label>
                    {field.type === "boolean" ? (
                      <div className="flex items-center gap-2">
                        <div className="h-4 w-4 rounded border border-slate-300 bg-white" />
                        <span className="text-xs text-slate-400">{field.label}</span>
                      </div>
                    ) : (
                      <div className="h-9 rounded-lg border border-slate-200 bg-white px-3 flex items-center text-xs text-slate-400">
                        {field.label}...
                      </div>
                    )}
                  </div>
                ))}
                {/* Custom fields */}
                {customFields.length > 0 && (
                  <>
                    <div className="border-t border-slate-200 pt-3">
                      <p className="text-xs font-semibold text-slate-500 mb-3">Additional Questions</p>
                      {customFields.map((field) => (
                        <div key={field.id} className="space-y-1 mb-3">
                          <label className="text-xs font-medium text-slate-600">
                            {field.label || "Untitled Question"}
                            {field.required && <span className="text-red-500 ml-0.5">*</span>}
                          </label>
                          {field.type === "boolean" ? (
                            <div className="flex items-center gap-2">
                              <div className="h-4 w-4 rounded border border-slate-300 bg-white" />
                              <span className="text-xs text-slate-400">{field.label}</span>
                            </div>
                          ) : field.type === "select" && field.options?.length ? (
                            <div className="h-9 rounded-lg border border-slate-200 bg-white px-3 flex items-center justify-between text-xs text-slate-400">
                              <span>Select {field.label}...</span>
                              <ChevronDown className="h-3 w-3" />
                            </div>
                          ) : (
                            <div className="h-9 rounded-lg border border-slate-200 bg-white px-3 flex items-center text-xs text-slate-400">
                              {field.type === "number" ? "0" : `Enter ${field.label}...`}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </>
                )}
                <div className="pt-2">
                  <div className="h-9 w-full rounded-lg bg-slate-800 text-white text-xs flex items-center justify-center font-medium">
                    Register
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Save Bar */}
        <div className="border-t pt-5 flex items-center justify-end">
          <Button 
            onClick={handleSave} 
            disabled={saveConfigMutation.isPending}
            className="bg-emerald-600 hover:bg-emerald-700 font-bold text-white shadow-md shadow-emerald-600/10 px-8 py-2 h-11"
          >
            {saveConfigMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Saving Changes...
              </>
            ) : (
              <>
                <Save className="h-4 w-4 mr-2" />
                Save Form Configuration
              </>
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
