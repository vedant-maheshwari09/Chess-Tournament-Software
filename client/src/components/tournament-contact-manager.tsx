import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { UserCircle2, Plus, Save, Undo2, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { Tournament } from "@shared/schema";
import {
  buildTournamentPayload,
  parseTournamentConfig,
  serializeTournamentConfig,
  type ContactEntry,
  type TournamentConfig,
} from "@/lib/tournament-config";
import { apiRequest } from "@/lib/queryClient";

interface TournamentContactManagerProps {
  tournament: Tournament;
  onUpdated?: () => void;
}

const ROLE_OPTIONS = [
  "Chief Arbiter",
  "Deputy Chief Arbiter",
  "Pairings Officer",
  "Fair Play Officer",
  "Sector Arbiter",
  "Arbiter",
  "Organizer",
  "Volunteer",
];

function createContactTemplate(): ContactEntry {
  return {
    id: typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: "",
    role: ROLE_OPTIONS[0] ?? "Chief Arbiter",
    phone: "",
    email: "",
  };
}

export default function TournamentContactManager({ tournament, onUpdated }: TournamentContactManagerProps) {
  const { toast } = useToast();
  const [config, setConfig] = useState<TournamentConfig>(() => parseTournamentConfig(tournament));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setConfig(parseTournamentConfig(tournament));
  }, [tournament]);

  const contacts = config.contacts;

  const pristineContacts = useMemo(() => parseTournamentConfig(tournament).contacts, [tournament]);

  const hasChanges = useMemo(() => {
    if (contacts.length !== pristineContacts.length) return true;
    const serialize = (items: ContactEntry[]) =>
      items
        .map((item) => ({
          name: item.name.trim(),
          role: item.role.trim(),
          phone: (item.phone ?? "").trim(),
          email: (item.email ?? "").trim(),
        }))
        .sort((a, b) => `${a.name}-${a.role}`.localeCompare(`${b.name}-${b.role}`));
    const current = JSON.stringify(serialize(contacts));
    const initial = JSON.stringify(serialize(pristineContacts));
    return current !== initial;
  }, [contacts, pristineContacts]);

  const updateContacts = (updater: (prev: ContactEntry[]) => ContactEntry[]) => {
    setConfig((prev) => ({
      ...prev,
      contacts: updater(prev.contacts),
    }));
  };

  const handleAddContact = () => {
    updateContacts((prev) => [...prev, createContactTemplate()]);
  };

  const handleFieldChange = (id: string, field: keyof ContactEntry, value: string) => {
    updateContacts((prev) =>
      prev.map((contact) =>
        contact.id === id
          ? {
              ...contact,
              [field]: value,
            }
          : contact,
      ),
    );
  };

  const handleRemove = (id: string) => {
    updateContacts((prev) => prev.filter((contact) => contact.id !== id));
  };

  const handleCancel = () => {
    setConfig(parseTournamentConfig(tournament));
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      const nextConfig: TournamentConfig = serializeTournamentConfig(config);
      await apiRequest(`/api/tournaments/${tournament.id}`, {
        method: "PUT",
        body: JSON.stringify(buildTournamentPayload(nextConfig, { format: tournament.format })),
      });
      toast({ title: "Contacts saved" });
      onUpdated?.();
    } catch (error: any) {
      toast({
        title: "Unable to save",
        description: error?.message ?? "Please try again",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <CardTitle className="flex items-center gap-2">
            <UserCircle2 className="h-5 w-5" />
            Contact Team
          </CardTitle>
          <CardDescription>
            Maintain arbiter and staff contact details. These appear across reports and player views.
          </CardDescription>
        </div>
        <Badge variant="secondary">{contacts.length} contact{contacts.length === 1 ? "" : "s"}</Badge>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex flex-wrap gap-3">
          <Button onClick={handleAddContact} className="flex items-center gap-2">
            <Plus className="h-4 w-4" />
            Add Contact
          </Button>
          <Button
            variant="outline"
            onClick={handleSave}
            disabled={!hasChanges || saving}
            className="flex items-center gap-2"
          >
            <Save className="h-4 w-4" />
            {saving ? "Saving..." : "Save"}
          </Button>
          <Button
            variant="ghost"
            onClick={handleCancel}
            disabled={saving || !hasChanges}
            className="flex items-center gap-2"
          >
            <Undo2 className="h-4 w-4" />
            Cancel
          </Button>
        </div>

        {contacts.length === 0 ? (
          <div className="rounded-lg border border-dashed bg-slate-50 p-6 text-center text-sm text-muted-foreground">
            No contacts added yet. Use <span className="font-medium">Add Contact</span> to get started.
          </div>
        ) : (
          <div className="space-y-4">
            {contacts.map((contact) => (
              <div
                key={contact.id}
                className="rounded-lg border bg-white p-4 shadow-sm"
              >
                <div className="grid gap-3 md:grid-cols-[minmax(0,1.5fr),minmax(0,1fr),minmax(0,1fr),auto] md:items-center">
                  <Input
                    placeholder="Surname, Name"
                    value={contact.name}
                    onChange={(event) => handleFieldChange(contact.id, "name", event.target.value)}
                  />
                  <Select
                    value={contact.role}
                    onValueChange={(value) => handleFieldChange(contact.id, "role", value)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Role" />
                    </SelectTrigger>
                    <SelectContent>
                      {ROLE_OPTIONS.map((role) => (
                        <SelectItem key={role} value={role}>
                          {role}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Input
                      placeholder="Phone Number"
                      value={contact.phone ?? ""}
                      onChange={(event) => handleFieldChange(contact.id, "phone", event.target.value)}
                    />
                    <Input
                      placeholder="E-mail Address"
                      value={contact.email ?? ""}
                      onChange={(event) => handleFieldChange(contact.id, "email", event.target.value)}
                    />
                  </div>
                  <div className="flex justify-end">
                    <Button
                      type="button"
                      variant="ghost"
                      className="text-red-500 hover:text-red-600"
                      onClick={() => handleRemove(contact.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
