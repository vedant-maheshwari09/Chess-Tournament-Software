import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Player, Tournament } from "@shared/schema";
import { parseTournamentConfig } from "@/lib/tournament-config";
import { Textarea } from "@/components/ui/textarea";

interface RatingLookupResponse {
  query: string;
  uscf: Array<{ id: string; name: string; rating?: string; location?: string; extra?: string }>;
  fide: Array<{ id: string; name: string; rating?: string; location?: string; extra?: string }>;
  ecf: Array<{ id: string; name: string; rating?: string; location?: string; extra?: string }>;
}

interface PlayerManagerProps {
  tournament: Tournament;
  tournamentId: number;
}

const FEDERATION_OPTIONS = [
  "United States",
  "Canada",
  "United Kingdom",
  "Germany",
  "France",
  "Spain",
  "India",
  "China",
  "Australia",
];

const SOURCE_META = {
  uscf: { label: "USCF", accent: "bg-blue-50 text-blue-700" },
  fide: { label: "FIDE", accent: "bg-purple-50 text-purple-700" },
  ecf: { label: "ECF", accent: "bg-amber-50 text-amber-700" },
} as const;

const FEDERATION_SEARCH_LINKS: Record<SourceKey, string> = {
  uscf: "https://www.uschess.org/msa/thin.php",
  fide: "https://ratings.fide.com/",
  ecf: "https://www.ecfrating.org.uk/v2/new/search.php",
};

type SourceKey = keyof typeof SOURCE_META;
type TabKey = "basic" | "payments" | "notes";

export default function PlayerManager({ tournament, tournamentId }: PlayerManagerProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [activeTab, setActiveTab] = useState<TabKey>("basic");

  const tournamentConfig = useMemo(() => parseTournamentConfig(tournament), [tournament]);
  const defaultFederation = tournamentConfig.basic.federation || "United States";
  const federationOptions = useMemo(() => {
    return FEDERATION_OPTIONS.includes(defaultFederation)
      ? FEDERATION_OPTIONS
      : [defaultFederation, ...FEDERATION_OPTIONS];
  }, [defaultFederation]);

  const createEmptyForm = useCallback(
    () => ({
      firstName: "",
      lastName: "",
      federation: defaultFederation,
      rating: "",
      ratingRapid: "",
      ratingBlitz: "",
      email: "",
      phoneCountry: "+1",
      phone: "",
      club: "",
      birthdate: "",
      sex: "",
      title: "",
      labels: "",
      uscfId: "",
      localId: "",
      notesAdmin: "",
      notesPublic: "",
      notesPrivate: "",
      paymentDate: "",
      paymentMethod: "",
      paymentAmount: "",
    }),
    [defaultFederation],
  );

  const [formState, setFormState] = useState(createEmptyForm);

  const { data: players = [], isLoading } = useQuery<Player[]>({
    queryKey: [`/api/tournaments/${tournamentId}/players`],
  });

  const [lookupQuery, setLookupQuery] = useState("");
  useEffect(() => {
    const handle = setTimeout(() => {
      setLookupQuery(searchTerm.trim());
    }, 350);
    return () => clearTimeout(handle);
  }, [searchTerm]);

  const { data: lookupData, isFetching: lookupFetching } = useQuery<RatingLookupResponse | null>({
    queryKey: ["rating-lookup", lookupQuery],
    queryFn: async () => {
      if (!lookupQuery) return null;
      try {
        return await apiRequest(`/api/rating-lookup?q=${encodeURIComponent(lookupQuery)}`);
      } catch (error) {
        console.warn("lookup failed", error);
        return null;
      }
    },
    staleTime: 1000 * 30,
  });

  useEffect(() => {
    if (!dialogOpen) {
      setActiveTab("basic");
      setSearchTerm("");
      setLookupQuery("");
      setFormState(createEmptyForm());
    }
  }, [dialogOpen, createEmptyForm]);

  const addPlayerMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        firstName: formState.firstName.trim() || "Player",
        lastName: formState.lastName.trim() || `#${players.length + 1}`,
        rating: Number(formState.rating) || 0,
        federation: formState.federation || "United States",
      };
      return apiRequest(`/api/tournaments/${tournamentId}/players`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
    },
    onSuccess: () => {
      toast({ title: "Player added" });
      queryClient.invalidateQueries({ queryKey: [`/api/tournaments/${tournamentId}/players`] });
      setDialogOpen(false);
    },
    onError: (error: any) => {
      toast({
        title: "Unable to add player",
        description: error?.message ?? "Please try again.",
        variant: "destructive",
      });
    },
  });

  const lookupResults = useMemo(() => {
    const empty = { uscf: [], fide: [], ecf: [] } as Record<SourceKey, any[]>;
    if (!lookupData) return empty;
    return {
      uscf: lookupData.uscf ?? [],
      fide: lookupData.fide ?? [],
      ecf: lookupData.ecf ?? [],
    };
  }, [lookupData]);

  const combinedResults = useMemo(() => {
    return (Object.keys(SOURCE_META) as SourceKey[]).map((source) => ({
      source,
      items: lookupResults[source] ?? [],
    }));
  }, [lookupResults]);

  const handleResultClick = (source: SourceKey, item: any) => {
    const [lastName, firstName] = item.name.split(",");
    setFormState((prev) => ({
      ...prev,
      firstName: (firstName ?? "").trim(),
      lastName: (lastName ?? item.name).trim(),
      rating: item.rating ?? prev.rating,
      federation: item.location ?? prev.federation,
      club: item.extra ?? prev.club,
    }));
    setActiveTab("basic");
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[260px,1fr]">
      <Card className="self-start">
        <CardHeader>
          <CardTitle className="text-lg">Player tools</CardTitle>
          <p className="text-sm text-muted-foreground">Quick actions for updating your roster.</p>
        </CardHeader>
        <CardContent className="space-y-3">
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button className="w-full">Add Player</Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[1100px]">
              <DialogHeader>
                <DialogTitle>Add Player</DialogTitle>
                <DialogDescription>Search federations or add a player manually.</DialogDescription>
              </DialogHeader>

              <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as TabKey)} className="space-y-4">
                <TabsList className="grid grid-cols-3 w-full">
                  <TabsTrigger value="basic">Basic</TabsTrigger>
                  <TabsTrigger value="payments">Payments</TabsTrigger>
                  <TabsTrigger value="notes">Notes</TabsTrigger>
                </TabsList>

                <TabsContent value="basic" className="space-y-4">
                  <div className="grid gap-6 lg:grid-cols-[320px,1fr]">
                    <div className="space-y-3">
                      <Label>Search national databases</Label>
                      <Input
                        value={searchTerm}
                        onChange={(event) => setSearchTerm(event.target.value)}
                        placeholder="e.g., Jack Finlay"
                      />
                      <div className="flex flex-wrap gap-2">
                        {(Object.keys(SOURCE_META) as SourceKey[]).map((source) => (
                          <Button
                            key={source}
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => window.open(FEDERATION_SEARCH_LINKS[source], "_blank")}
                          >
                            Open {SOURCE_META[source].label} finder
                          </Button>
                        ))}
                      </div>
                      <ScrollArea className="h-[360px] rounded-md border">
                        {!searchTerm && !lookupFetching ? (
                          <p className="p-3 text-sm text-muted-foreground">
                            Enter a player name to search federation records.
                          </p>
                        ) : lookupFetching ? (
                          <p className="p-3 text-sm text-muted-foreground">Searching federations…</p>
                        ) : combinedResults.every((section) => section.items.length === 0) ? (
                          <p className="p-3 text-sm text-muted-foreground">
                            No players found. Try another spelling or open the official finder above.
                          </p>
                        ) : (
                          <div className="divide-y">
                            {combinedResults.map(({ source, items }) => {
                              if (items.length === 0) return null;
                              const meta = SOURCE_META[source];
                              return (
                                <div key={source}>
                                  <div className="bg-slate-100 px-3 py-2 text-xs font-semibold uppercase text-slate-600">
                                    {meta.label}
                                  </div>
                                  {items.map((item) => (
                                    <button
                                      key={`${source}-${item.id}-${item.name}`}
                                      type="button"
                                      className="flex w-full items-start gap-3 px-3 py-3 text-left transition hover:bg-slate-50"
                                      onClick={() => handleResultClick(source, item)}
                                    >
                                      {source !== "uscf" && (
                                        <Badge className={`${meta.accent}`}>{meta.label}</Badge>
                                      )}
                                      <div className="space-y-1">
                                        <div className="font-medium leading-none">{item.name}</div>
                                        <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                                          {item.rating && <span>Rating: {item.rating}</span>}
                                          {item.location && <span>{item.location}</span>}
                                          {item.extra && <span>{item.extra}</span>}
                                        </div>
                                      </div>
                                    </button>
                                  ))}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </ScrollArea>
                    </div>

                    <div className="space-y-6">
                      <div className="grid gap-3 md:grid-cols-2">
                        <div className="space-y-1">
                          <Label>First name</Label>
                          <Input
                            value={formState.firstName}
                            onChange={(event) => setFormState((prev) => ({ ...prev, firstName: event.target.value }))}
                          />
                        </div>
                        <div className="space-y-1">
                          <Label>Last name</Label>
                          <Input
                            value={formState.lastName}
                            onChange={(event) => setFormState((prev) => ({ ...prev, lastName: event.target.value }))}
                          />
                        </div>
                        <div className="space-y-1">
                          <Label>Birthdate</Label>
                          <Input
                            type="date"
                            value={formState.birthdate}
                            onChange={(event) => setFormState((prev) => ({ ...prev, birthdate: event.target.value }))}
                          />
                        </div>
                        <div className="space-y-1">
                          <Label>Sex</Label>
                          <Select value={formState.sex} onValueChange={(value) => setFormState((prev) => ({ ...prev, sex: value }))}>
                            <SelectTrigger>
                              <SelectValue placeholder="Select" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="male">Male</SelectItem>
                              <SelectItem value="female">Female</SelectItem>
                              <SelectItem value="other">Other</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1">
                          <Label>Club</Label>
                          <Input
                            value={formState.club}
                            onChange={(event) => setFormState((prev) => ({ ...prev, club: event.target.value }))}
                          />
                        </div>
                        <div className="space-y-1">
                          <Label>Federation</Label>
                          <Select
                            value={formState.federation}
                            onValueChange={(value) => setFormState((prev) => ({ ...prev, federation: value }))}
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {federationOptions.map((option) => (
                                <SelectItem key={option} value={option}>
                                  {option}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1">
                          <Label>Title</Label>
                          <Input
                            value={formState.title}
                            onChange={(event) => setFormState((prev) => ({ ...prev, title: event.target.value }))}
                          />
                        </div>
                        <div className="space-y-1">
                          <Label>Labels</Label>
                          <Input
                            value={formState.labels}
                            onChange={(event) => setFormState((prev) => ({ ...prev, labels: event.target.value }))}
                          />
                        </div>
                      </div>

                      <div className="grid gap-3 md:grid-cols-2">
                        <div className="space-y-1">
                          <Label>Rating (Classic)</Label>
                          <Input
                            value={formState.rating}
                            onChange={(event) => setFormState((prev) => ({ ...prev, rating: event.target.value }))}
                          />
                        </div>
                        <div className="space-y-1">
                          <Label>Rating (Rapid)</Label>
                          <Input
                            value={formState.ratingRapid}
                            onChange={(event) => setFormState((prev) => ({ ...prev, ratingRapid: event.target.value }))}
                          />
                        </div>
                        <div className="space-y-1">
                          <Label>Rating (Blitz)</Label>
                          <Input
                            value={formState.ratingBlitz}
                            onChange={(event) => setFormState((prev) => ({ ...prev, ratingBlitz: event.target.value }))}
                          />
                        </div>
                        <div className="space-y-1">
                          <Label>USCF ID</Label>
                          <Input
                            value={formState.uscfId}
                            onChange={(event) => setFormState((prev) => ({ ...prev, uscfId: event.target.value }))}
                          />
                        </div>
                        <div className="space-y-1">
                          <Label>Local ID</Label>
                          <Input
                            value={formState.localId}
                            onChange={(event) => setFormState((prev) => ({ ...prev, localId: event.target.value }))}
                          />
                        </div>
                        <div className="space-y-1">
                          <Label>Email</Label>
                          <Input
                            type="email"
                            value={formState.email}
                            onChange={(event) => setFormState((prev) => ({ ...prev, email: event.target.value }))}
                          />
                        </div>
                        <div className="space-y-1 md:col-span-2">
                          <Label>Phone number</Label>
                          <div className="grid grid-cols-[120px,1fr] gap-2">
                            <Input
                              value={formState.phoneCountry}
                              onChange={(event) => setFormState((prev) => ({ ...prev, phoneCountry: event.target.value }))}
                            />
                            <Input
                              value={formState.phone}
                              onChange={(event) => setFormState((prev) => ({ ...prev, phone: event.target.value }))}
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </TabsContent>

                <TabsContent value="payments" className="space-y-4">
                  <div className="grid gap-3 md:grid-cols-3">
                    <div className="space-y-1">
                      <Label>Date</Label>
                      <Input
                        type="datetime-local"
                        value={formState.paymentDate}
                        onChange={(event) => setFormState((prev) => ({ ...prev, paymentDate: event.target.value }))}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label>Method</Label>
                      <Select
                        value={formState.paymentMethod}
                        onValueChange={(value) => setFormState((prev) => ({ ...prev, paymentMethod: value }))}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="cash">Cash</SelectItem>
                          <SelectItem value="card">Card</SelectItem>
                          <SelectItem value="online">Online</SelectItem>
                          <SelectItem value="other">Other</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label>Amount</Label>
                      <Input
                        type="number"
                        value={formState.paymentAmount}
                        onChange={(event) => setFormState((prev) => ({ ...prev, paymentAmount: event.target.value }))}
                      />
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Payment tracking fields are informational for now and will be stored in a later update.
                  </p>
                </TabsContent>

                <TabsContent value="notes" className="space-y-3">
                  <div className="space-y-1">
                    <Label>Admin&apos;s notes</Label>
                    <Textarea
                      rows={4}
                      value={formState.notesAdmin}
                      onChange={(event) => setFormState((prev) => ({ ...prev, notesAdmin: event.target.value }))}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>Public notes</Label>
                    <Textarea
                      rows={4}
                      value={formState.notesPublic}
                      onChange={(event) => setFormState((prev) => ({ ...prev, notesPublic: event.target.value }))}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>Private message from player</Label>
                    <Textarea
                      rows={4}
                      value={formState.notesPrivate}
                      onChange={(event) => setFormState((prev) => ({ ...prev, notesPrivate: event.target.value }))}
                    />
                  </div>
                </TabsContent>
              </Tabs>

              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={() => setDialogOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={() => addPlayerMutation.mutate()} disabled={addPlayerMutation.isPending}>
                  {addPlayerMutation.isPending ? "Adding..." : "Add Player"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>

          <Button variant="outline" className="w-full" disabled>
            Entry fees
          </Button>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" className="w-full" disabled>
              Export
            </Button>
            <Button variant="secondary" className="w-full" disabled>
              Import
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Chess-Results syncing will use these controls once backend automation is enabled.
          </p>
        </CardContent>
      </Card>

      <Card className="lg:col-span-1">
        <CardHeader className="flex items-center justify-between">
          <div>
            <CardTitle className="text-xl">Players</CardTitle>
            <p className="text-sm text-muted-foreground">Overview of everyone registered for this event.</p>
          </div>
          <Badge variant="secondary">Total: {players.length}</Badge>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading players…</p>
          ) : players.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-sm text-muted-foreground">No players registered yet.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">#</TableHead>
                  <TableHead>Surname, Name</TableHead>
                  <TableHead>Rating</TableHead>
                  <TableHead>Club</TableHead>
                  <TableHead>Birthdate</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {players.map((player, index) => (
                  <TableRow key={player.id}>
                    <TableCell>{index + 1}</TableCell>
                    <TableCell>
                      {player.lastName}, {player.firstName}
                    </TableCell>
                    <TableCell>{player.rating ?? "-"}</TableCell>
                    <TableCell>-</TableCell>
                    <TableCell>-</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}