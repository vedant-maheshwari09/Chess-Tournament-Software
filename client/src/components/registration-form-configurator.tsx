import React, { useState, useEffect, useMemo } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { Tournament } from "@shared/schema";
import { Save, Loader2 } from "lucide-react";
import { parseTournamentConfig, type TournamentConfig } from "@/lib/tournament-config";
import { RegistrationFormCustomizer } from "@/components/registration-form-customizer";
import { slugify } from "@/lib/utils";

interface RegistrationFormConfiguratorProps {
  tournamentId: number;
  tournament: Tournament;
}

export default function RegistrationFormConfigurator({ tournamentId, tournament }: RegistrationFormConfiguratorProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const tournamentConfig = useMemo(() => {
    return parseTournamentConfig(tournament);
  }, [tournament]);

  // Local state for the tournament config
  const [localConfig, setLocalConfig] = useState<TournamentConfig | null>(null);

  useEffect(() => {
    if (tournamentConfig) {
      setLocalConfig(tournamentConfig);
    }
  }, [tournamentConfig]);

  const saveConfigMutation = useMutation({
    mutationFn: async (updatedConfig: TournamentConfig) => {
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

  const handleSave = () => {
    if (!localConfig) return;
    
    // Validate custom fields
    const customFields = localConfig.registrationFormConfig?.fields?.filter(f => f.isCustom) || [];
    const invalidField = customFields.find(f => !f.label.trim());
    if (invalidField) {
      toast({
        title: "Validation Error",
        description: "All custom questions must have a label.",
        variant: "destructive"
      });
      return;
    }

    saveConfigMutation.mutate(localConfig);
  };

  if (!localConfig) return null;

  return (
    <div className="space-y-4">
      <RegistrationFormCustomizer 
        config={localConfig}
        onConfigChange={setLocalConfig}
        tournamentSlug={slugify(tournament.name)}
        actions={
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
        }
      />
    </div>
  );
}
