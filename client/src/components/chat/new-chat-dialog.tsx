import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Loader2, Plus, Search, User as UserIcon } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

export function NewChatDialog({ onChatCreated }: { onChatCreated: (threadId: number) => void }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const queryClient = useQueryClient();

  const { data: users, isLoading } = useQuery({
    queryKey: ["/api/messages/users/search", search],
    queryFn: async () => {
      if (search.length < 2) return [];
      const res = await fetch(`/api/messages/users/search?q=${encodeURIComponent(search)}`);
      if (!res.ok) throw new Error("Failed to search users");
      return res.json();
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
      onChatCreated(thread.id);
    },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="icon" variant="ghost">
          <Plus className="h-5 w-5" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Start a New Chat</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-4">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by username or name..."
              className="pl-9"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <ScrollArea className="h-[300px] rounded-md border p-2">
            {search.length < 2 ? (
              <div className="p-4 text-center text-sm text-muted-foreground">
                Type at least 2 characters to search for users.
              </div>
            ) : isLoading ? (
              <div className="p-4 flex justify-center">
                <Loader2 className="animate-spin h-5 w-5 text-muted-foreground" />
              </div>
            ) : users?.length === 0 ? (
              <div className="p-4 text-center text-sm text-muted-foreground">
                No users found.
              </div>
            ) : (
              <div className="flex flex-col gap-1">
                {users?.map((u: any) => (
                  <button
                    key={u.id}
                    onClick={() => createChatMutation.mutate(u.id)}
                    disabled={createChatMutation.isPending}
                    className="flex items-center gap-3 p-2 rounded-md hover:bg-accent transition-colors text-left"
                  >
                    <Avatar className="h-8 w-8">
                      <AvatarFallback className="bg-primary/10 text-primary text-xs">
                        {u.username.substring(0, 2).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 overflow-hidden">
                      <p className="text-sm font-medium leading-none truncate">
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
        </div>
      </DialogContent>
    </Dialog>
  );
}
