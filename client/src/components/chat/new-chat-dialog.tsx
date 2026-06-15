import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Loader2, Plus, Search, Users, X } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export function NewChatDialog({ onChatCreated }: { onChatCreated: (threadId: number) => void }) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"dm" | "group">("dm");
  const [search, setSearch] = useState("");
  const [groupName, setGroupName] = useState("");
  const [selectedUsers, setSelectedUsers] = useState<Array<{ id: number; username: string }>>([]);
  const queryClient = useQueryClient();

  const { data: myTournaments } = useQuery<any[]>({
    queryKey: ["/api/tournaments"],
    enabled: user?.role === 'tournament_director' && open,
  });

  const addAllFollowers = async () => {
    try {
      const followers = await apiRequest("/api/follows/followers");
      const usersList = followers.map((f: any) => ({
        id: f.id,
        username: f.username
      }));
      setSelectedUsers((prev) => {
        const existingIds = new Set(prev.map(u => u.id));
        const next = [...prev];
        for (const u of usersList) {
          if (!existingIds.has(u.id)) {
            next.push(u);
            existingIds.add(u.id);
          }
        }
        return next;
      });
    } catch (err) {
      console.error("Failed to add followers:", err);
    }
  };

  const fetchEntrants = async (tournamentId: number) => {
    try {
      const players = await apiRequest(`/api/tournaments/${tournamentId}/players`);
      const usersList = players.filter((p: any) => p.userId).map((p: any) => ({
        id: p.userId,
        username: p.username || `${p.firstName} ${p.lastName}`
      }));
      setSelectedUsers((prev) => {
        const existingIds = new Set(prev.map(u => u.id));
        const next = [...prev];
        for (const u of usersList) {
          if (!existingIds.has(u.id)) {
            next.push(u);
            existingIds.add(u.id);
          }
        }
        return next;
      });
    } catch (err) {
      console.error("Failed to fetch entrants:", err);
    }
  };

  const { data: users, isLoading } = useQuery({
    queryKey: ["/api/messages/users/search", search],
    queryFn: async () => {
      if (search.length < 2) return [];
      return apiRequest(`/api/messages/users/search?q=${encodeURIComponent(search)}`);
    },
    enabled: search.length >= 2,
  });

  const createChatMutation = useMutation({
    mutationFn: async (userId: number) => {
      return apiRequest("/api/messages/threads", {
        method: "POST",
        body: JSON.stringify({ participantIds: [userId] }),
      });
    },
    onSuccess: async (data) => {
      const thread = await data.json();
      queryClient.invalidateQueries({ queryKey: ["/api/messages/threads"] });
      setOpen(false);
      setSearch("");
      onChatCreated(thread.id);
    },
  });

  const createGroupMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("/api/messages/threads", {
        method: "POST",
        body: JSON.stringify({
          name: groupName.trim() || "Group Chat",
          isGroup: true,
          participantIds: selectedUsers.map((u) => u.id),
        }),
      });
    },
    onSuccess: async (data) => {
      const thread = await data.json();
      queryClient.invalidateQueries({ queryKey: ["/api/messages/threads"] });
      setOpen(false);
      setGroupName("");
      setSelectedUsers([]);
      setSearch("");
      onChatCreated(thread.id);
    },
  });

  const toggleUserSelection = (user: { id: number; username: string }) => {
    if (selectedUsers.some((u) => u.id === user.id)) {
      setSelectedUsers(selectedUsers.filter((u) => u.id !== user.id));
    } else {
      setSelectedUsers([...selectedUsers, user]);
    }
  };

  const resetState = () => {
    setSearch("");
    setGroupName("");
    setSelectedUsers([]);
    setActiveTab("dm");
  };

  return (
    <Dialog open={open} onOpenChange={(val) => { setOpen(val); if (!val) resetState(); }}>
      <DialogTrigger asChild>
        <Button size="icon" variant="ghost" className="hover:bg-primary/10 rounded-full h-9 w-9">
          <Plus className="h-5 w-5" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md border-border/50 shadow-lg">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold tracking-tight">Start a Chat</DialogTitle>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={(val) => { setActiveTab(val as "dm" | "group"); setSearch(""); }} className="w-full mt-2">
          {user?.role === 'tournament_director' && (
            <TabsList className="grid w-full grid-cols-2 p-1 bg-muted/60 rounded-xl">
              <TabsTrigger value="dm" className="rounded-lg py-2 text-xs font-semibold">Direct Message</TabsTrigger>
              <TabsTrigger value="group" className="rounded-lg py-2 text-xs font-semibold flex items-center gap-1.5 justify-center">
                <Users className="h-3.5 w-3.5" /> Group Chat
              </TabsTrigger>
            </TabsList>
          )}

          <TabsContent value="dm" className="space-y-4 pt-3 mt-0">
            <div className="relative">
              <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search players by name or username..."
                className="pl-9 bg-muted/30 border-transparent focus-visible:bg-background focus-visible:ring-1"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>

            <ScrollArea className="h-[260px] rounded-xl border border-border/50 p-2 bg-card/30">
              {search.length < 2 ? (
                <div className="p-8 text-center text-sm text-muted-foreground flex flex-col items-center justify-center h-full">
                  <Search className="h-8 w-8 mb-2 text-muted-foreground/30" />
                  <p className="font-medium">Find a player</p>
                  <p className="text-xs text-muted-foreground/75 mt-1">Type at least 2 characters to search.</p>
                </div>
              ) : isLoading ? (
                <div className="p-8 flex justify-center items-center h-full">
                  <Loader2 className="animate-spin h-6 w-6 text-primary" />
                </div>
              ) : users?.length === 0 ? (
                <div className="p-8 text-center text-sm text-muted-foreground flex flex-col items-center justify-center h-full">
                  <p className="font-medium">No players found</p>
                  <p className="text-xs text-muted-foreground/75 mt-1">Try searching for a different username or name.</p>
                </div>
              ) : (
                <div className="flex flex-col gap-1">
                  {users?.map((u: any) => (
                    <button
                      key={u.id}
                      onClick={() => createChatMutation.mutate(u.id)}
                      disabled={createChatMutation.isPending}
                      className="flex items-center gap-3 p-2.5 rounded-xl hover:bg-accent transition-all text-left w-full group"
                    >
                      <Avatar className="h-9 w-9 shadow-sm border border-border/30">
                        <AvatarFallback className="bg-primary/5 text-primary text-xs font-bold">
                          {u.username.substring(0, 2).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1 overflow-hidden">
                        <p className="text-sm font-semibold leading-none truncate group-hover:text-primary transition-colors">
                          {u.username}
                        </p>
                        {(u.firstName || u.lastName) && (
                          <p className="text-xs text-muted-foreground mt-1 truncate">
                            {u.firstName} {u.lastName}
                          </p>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </ScrollArea>
          </TabsContent>

          <TabsContent value="group" className="space-y-4 pt-3 mt-0">
            <div className="space-y-3">
              <Input
                placeholder="Group Chat Name (e.g. Round 1 Discuss)"
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                className="bg-muted/30 border-transparent focus-visible:bg-background focus-visible:ring-1 font-medium"
              />
              <div className="flex flex-col gap-2 p-3 rounded-xl border border-slate-200/60 bg-slate-50/50">
                <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Bulk Add Members</p>
                <div className="flex flex-wrap sm:flex-nowrap gap-2 items-center">
                  <Button 
                    type="button" 
                    variant="outline" 
                    size="sm" 
                    onClick={addAllFollowers}
                    className="text-xs font-semibold h-8 rounded-lg bg-white"
                  >
                    Add All Followers
                  </Button>
                  {myTournaments && myTournaments.length > 0 && (
                    <Select onValueChange={(val) => fetchEntrants(Number(val))}>
                      <SelectTrigger className="h-8 text-xs font-semibold rounded-lg bg-white">
                        <SelectValue placeholder="Add Entrants..." />
                      </SelectTrigger>
                      <SelectContent>
                        {myTournaments.map((t: any) => (
                          <SelectItem key={t.id} value={t.id.toString()}>
                            {t.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              </div>
              <div className="relative">
                <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Add group members..."
                  className="pl-9 bg-muted/30 border-transparent focus-visible:bg-background focus-visible:ring-1"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
            </div>

            {selectedUsers.length > 0 && (
              <div className="flex flex-wrap gap-1.5 p-2 rounded-xl bg-muted/40 border border-border/30 max-h-[85px] overflow-y-auto">
                {selectedUsers.map((u) => (
                  <Badge key={u.id} variant="secondary" className="pl-2.5 pr-1 py-1 rounded-lg flex items-center gap-1.5 text-xs font-medium bg-background border border-border/50">
                    {u.username}
                    <button
                      onClick={() => toggleUserSelection(u)}
                      className="rounded-full hover:bg-muted p-0.5 transition-colors text-muted-foreground hover:text-foreground"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </Badge>
                ))}
              </div>
            )}

            <ScrollArea className="h-[180px] rounded-xl border border-border/50 p-2 bg-card/30">
              {search.length < 2 ? (
                <div className="p-6 text-center text-sm text-muted-foreground flex flex-col items-center justify-center h-full">
                  <Search className="h-7 w-7 mb-1.5 text-muted-foreground/30" />
                  <p className="font-medium">Search to add members</p>
                  <p className="text-xs text-muted-foreground/75 mt-0.5">Type name to find players to add.</p>
                </div>
              ) : isLoading ? (
                <div className="p-6 flex justify-center items-center h-full">
                  <Loader2 className="animate-spin h-5 w-5 text-primary" />
                </div>
              ) : users?.length === 0 ? (
                <div className="p-6 text-center text-sm text-muted-foreground flex flex-col items-center justify-center h-full">
                  <p className="font-medium">No players found</p>
                </div>
              ) : (
                <div className="flex flex-col gap-1">
                  {users?.map((u: any) => {
                    const isSelected = selectedUsers.some((selected) => selected.id === u.id);
                    return (
                      <button
                        key={u.id}
                        type="button"
                        onClick={() => toggleUserSelection({ id: u.id, username: u.username })}
                        className={`flex items-center gap-3 p-2 rounded-xl transition-all text-left w-full group ${isSelected ? "bg-primary/5 hover:bg-primary/10" : "hover:bg-accent"}`}
                      >
                        <Avatar className="h-8 w-8 shadow-sm">
                          <AvatarFallback className="bg-primary/5 text-primary text-xs font-bold">
                            {u.username.substring(0, 2).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1 overflow-hidden">
                          <p className="text-sm font-semibold leading-none truncate group-hover:text-primary transition-colors">
                            {u.username}
                          </p>
                          {(u.firstName || u.lastName) && (
                            <p className="text-xs text-muted-foreground mt-0.5 truncate">
                              {u.firstName} {u.lastName}
                            </p>
                          )}
                        </div>
                        <div className={`h-4 w-4 rounded border flex items-center justify-center mr-1 transition-all ${isSelected ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/30"}`}>
                          {isSelected && <Plus className="h-3 w-3 stroke-[3]" />}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </ScrollArea>

            <Button
              className="w-full py-5 rounded-xl text-sm font-semibold shadow-md shadow-primary/10 transition-all active:scale-[0.98]"
              disabled={selectedUsers.length === 0 || !groupName.trim() || createGroupMutation.isPending}
              onClick={() => createGroupMutation.mutate()}
            >
              {createGroupMutation.isPending ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="animate-spin h-4 w-4" /> Creating Group...
                </span>
              ) : (
                `Create Group Chat (${selectedUsers.length} member${selectedUsers.length !== 1 ? "s" : ""})`
              )}
            </Button>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
