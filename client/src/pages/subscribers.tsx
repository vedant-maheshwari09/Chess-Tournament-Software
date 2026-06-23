import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { ArrowLeft, Users, ShieldAlert, Search, UserMinus, UserCheck, MessageSquare, Loader2, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

export default function SubscribersModerationPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [subscriberSearch, setSubscriberSearch] = useState("");
  const [blockedSearch, setBlockedSearch] = useState("");
  const [manualBlockSearch, setManualBlockSearch] = useState("");

  // 1. Fetch Subscribers (followers)
  const { data: subscribers = [], isLoading: subscribersLoading } = useQuery<any[]>({
    queryKey: ["/api/follows/followers"],
  });

  // 2. Fetch Blocked Players
  const { data: blockedPlayers = [], isLoading: blockedLoading } = useQuery<any[]>({
    queryKey: ["/api/blocks"],
  });

  // 3. Manual Search Player Accounts to Block
  const { data: searchResults = [], isLoading: searchLoading } = useQuery<any[]>({
    queryKey: ["/api/blocks/search-players", manualBlockSearch],
    queryFn: async () => {
      if (manualBlockSearch.length < 2) return [];
      return apiRequest(`/api/blocks/search-players?q=${encodeURIComponent(manualBlockSearch)}`);
    },
    enabled: manualBlockSearch.length >= 2,
  });

  // 4. Block Mutation
  const blockMutation = useMutation({
    mutationFn: async (userId: number) => {
      return apiRequest(`/api/blocks/${userId}`, { method: "POST" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/blocks"] });
      toast({
        title: "Player blocked",
        description: "They can no longer register for your tournaments.",
      });
    },
    onError: (err: any) => {
      toast({
        title: "Block failed",
        description: err.message || "An unexpected error occurred.",
        variant: "destructive",
      });
    },
  });

  // 5. Unblock Mutation
  const unblockMutation = useMutation({
    mutationFn: async (userId: number) => {
      return apiRequest(`/api/blocks/${userId}`, { method: "DELETE" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/blocks"] });
      toast({
        title: "Player unblocked",
        description: "They can now register for your tournaments again.",
      });
    },
    onError: (err: any) => {
      toast({
        title: "Unblock failed",
        description: err.message || "An unexpected error occurred.",
        variant: "destructive",
      });
    },
  });

  // 6. Create Direct Chat Message Mutation
  const createChatMutation = useMutation({
    mutationFn: async (userId: number) => {
      return apiRequest("/api/messages/threads", {
        method: "POST",
        body: JSON.stringify({ participantIds: [userId] }),
      });
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/messages/threads"] });
      // Navigate to messages page — the thread ID is in data.id
      if (data?.id) {
        setLocation(`/messages?threadId=${data.id}`);
      } else {
        setLocation(`/messages`);
      }
    },
    onError: (err: any) => {
      toast({
        title: "Failed to open chat",
        description: err.message || "An unexpected error occurred.",
        variant: "destructive",
      });
    },
  });

  // Filter subscribers list
  const filteredSubscribers = subscribers.filter((sub) => {
    const term = subscriberSearch.toLowerCase();
    const fullName = `${sub.firstName} ${sub.lastName}`.toLowerCase();
    return (
      sub.username.toLowerCase().includes(term) ||
      fullName.includes(term) ||
      sub.email.toLowerCase().includes(term)
    );
  });

  // Filter blocked list
  const filteredBlocked = blockedPlayers.filter((blocked) => {
    const term = blockedSearch.toLowerCase();
    const fullName = `${blocked.firstName} ${blocked.lastName}`.toLowerCase();
    return (
      blocked.username.toLowerCase().includes(term) ||
      fullName.includes(term) ||
      blocked.email.toLowerCase().includes(term)
    );
  });

  const handleBack = () => {
    if (window.history.length > 1) {
      window.history.back();
    } else {
      setLocation("/dashboard");
    }
  };

  return (
    <div className="min-h-screen bg-transparent pb-12">
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8 space-y-8">
        
        {/* Back Button & Header */}
        <div className="space-y-4">
          <Button
            variant="ghost"
            onClick={handleBack}
            className="flex items-center gap-2 text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Dashboard
          </Button>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h1 className="text-3xl font-extrabold text-slate-950 dark:text-white tracking-tight">Subscribers & Moderation</h1>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Manage your subscribers and blacklisted player accounts.</p>
            </div>
          </div>
        </div>

        <Tabs defaultValue="subscribers" className="w-full">
          <TabsList className="flex w-full min-h-[48px] overflow-x-auto no-scrollbar items-center gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl border border-slate-200/60 dark:border-slate-700/60 shadow-sm mb-6">
            <TabsTrigger value="subscribers" className="flex-1 rounded-lg text-xs sm:text-sm font-semibold py-2">
              My Subscribers ({subscribers.length})
            </TabsTrigger>
            <TabsTrigger value="blocked" className="flex-1 rounded-lg text-xs sm:text-sm font-semibold py-2">
              Blocked Players ({blockedPlayers.length})
            </TabsTrigger>
          </TabsList>

          {/* Tab 1: Subscribers list */}
          <TabsContent value="subscribers" className="space-y-6">
            <div className="relative">
              <Search className="absolute left-3.5 top-3 h-4 w-4 text-slate-400" />
              <Input
                placeholder="Search subscribers by name, username, or email..."
                value={subscriberSearch}
                onChange={(e) => setSubscriberSearch(e.target.value)}
                className="pl-10 rounded-xl"
              />
            </div>

            {subscribersLoading ? (
              <div className="py-12 flex justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
              </div>
            ) : filteredSubscribers.length === 0 ? (
              <Card className="border-none shadow-sm dark:bg-slate-900 bg-white">
                <CardContent className="flex flex-col items-center justify-center gap-4 py-16 text-center text-slate-500">
                  <Users className="h-12 w-12 text-slate-200" />
                  <div>
                    <h3 className="font-semibold text-slate-950 dark:text-white">No subscribers found</h3>
                    <p className="text-sm mt-1">{subscriberSearch ? "Try refining your search query." : "Players who follow your profile will appear here."}</p>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                {filteredSubscribers.map((subscriber) => {
                  const dispName = subscriber.organizationName || `${subscriber.firstName} ${subscriber.lastName}`.trim() || subscriber.username;
                  const isBlocked = blockedPlayers.some((b) => b.id === subscriber.id);
                  
                  return (
                    <Card key={subscriber.id} className="hover:shadow-md transition-all border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/50">
                      <CardContent className="flex items-center justify-between p-5 gap-4">
                        <div className="flex items-center gap-4 min-w-0">
                          <Avatar className="h-12 w-12 border border-slate-100 dark:border-slate-800 shadow-sm shrink-0">
                            {subscriber.profilePicture ? (
                              <img src={subscriber.profilePicture} alt={dispName} className="object-cover w-full h-full" />
                            ) : (
                              <AvatarFallback className="bg-indigo-50 text-indigo-700 font-bold">
                                {dispName.substring(0, 2).toUpperCase()}
                              </AvatarFallback>
                            )}
                          </Avatar>
                          <div className="min-w-0">
                            <h4 className="font-bold text-sm text-slate-900 dark:text-white truncate">{dispName}</h4>
                            <p className="text-xs text-slate-500 truncate">@{subscriber.username}</p>
                            <p className="text-[10px] text-slate-400 truncate flex items-center gap-1 mt-0.5">
                              <Mail className="h-3 w-3 inline" />
                              {subscriber.email}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50 dark:hover:bg-slate-800 rounded-full"
                            onClick={() => createChatMutation.mutate(subscriber.id)}
                            disabled={createChatMutation.isPending}
                          >
                            <MessageSquare className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className={`h-8 w-8 rounded-full ${isBlocked ? "text-green-600 hover:text-green-700 hover:bg-green-50" : "text-destructive hover:text-destructive hover:bg-destructive/10"}`}
                            onClick={() => isBlocked ? unblockMutation.mutate(subscriber.id) : blockMutation.mutate(subscriber.id)}
                            disabled={blockMutation.isPending || unblockMutation.isPending}
                          >
                            {isBlocked ? <UserCheck className="h-4 w-4" /> : <UserMinus className="h-4 w-4" />}
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </TabsContent>

          {/* Tab 2: Blocked Players list + Search lookup to block */}
          <TabsContent value="blocked" className="space-y-8">
            {/* Manual blocking search */}
            <Card className="border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/50 shadow-sm">
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <ShieldAlert className="h-5 w-5 text-indigo-500" />
                  Manual Player Account Blocking
                </CardTitle>
                <CardDescription>
                  Search and block player accounts by username, name, or email, even if they aren't subscribed to you.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="relative">
                  <Search className="absolute left-3.5 top-3 h-4 w-4 text-slate-400" />
                  <Input
                    placeholder="Search player accounts (type at least 2 characters)..."
                    value={manualBlockSearch}
                    onChange={(e) => setManualBlockSearch(e.target.value)}
                    className="pl-10 rounded-xl"
                  />
                </div>

                {manualBlockSearch.length >= 2 && (
                  <div className="border border-slate-100 dark:border-slate-800 rounded-xl p-3 bg-slate-50/50 dark:bg-slate-950/20 max-h-64 overflow-y-auto space-y-2">
                    {searchLoading ? (
                      <div className="py-6 flex justify-center">
                        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                      </div>
                    ) : searchResults.length === 0 ? (
                      <p className="text-center text-xs text-muted-foreground py-4">No accounts match this query.</p>
                    ) : (
                      searchResults.map((player) => {
                        const dispName = player.organizationName || `${player.firstName} ${player.lastName}`.trim() || player.username;
                        const isBlocked = blockedPlayers.some((b) => b.id === player.id);
                        
                        return (
                          <div key={player.id} className="flex items-center justify-between p-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-200/50 dark:border-slate-800/50 shadow-sm">
                            <div className="flex items-center gap-3 min-w-0">
                              <Avatar className="h-9 w-9 border border-slate-100 dark:border-slate-800 shrink-0">
                                {player.profilePicture ? (
                                  <img src={player.profilePicture} alt={dispName} className="object-cover w-full h-full" />
                                ) : (
                                  <AvatarFallback className="bg-slate-100 text-slate-700 text-xs font-bold">
                                    {dispName.substring(0, 2).toUpperCase()}
                                  </AvatarFallback>
                                )}
                              </Avatar>
                              <div className="min-w-0">
                                <span className="font-bold text-xs text-slate-900 dark:text-white truncate block">{dispName}</span>
                                <span className="text-[10px] text-slate-400 block truncate">@{player.username} | {player.email}</span>
                              </div>
                            </div>
                            <Button
                              size="sm"
                              variant={isBlocked ? "outline" : "destructive"}
                              className="text-xs h-7 px-3 rounded-lg font-semibold shrink-0"
                              onClick={() => isBlocked ? unblockMutation.mutate(player.id) : blockMutation.mutate(player.id)}
                              disabled={blockMutation.isPending || unblockMutation.isPending}
                            >
                              {isBlocked ? "Blocked" : "Block Player"}
                            </Button>
                          </div>
                        );
                      })
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Blocked Players list */}
            <div className="space-y-4">
              <h3 className="font-bold text-lg text-slate-950 dark:text-white">Blocked List</h3>
              
              <div className="relative">
                <Search className="absolute left-3.5 top-3 h-4 w-4 text-slate-400" />
                <Input
                  placeholder="Filter blocked list..."
                  value={blockedSearch}
                  onChange={(e) => setBlockedSearch(e.target.value)}
                  className="pl-10 rounded-xl"
                />
              </div>

              {blockedLoading ? (
                <div className="py-12 flex justify-center">
                  <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
                </div>
              ) : filteredBlocked.length === 0 ? (
                <Card className="border-none shadow-sm dark:bg-slate-900 bg-white">
                  <CardContent className="flex flex-col items-center justify-center gap-4 py-16 text-center text-slate-500">
                    <ShieldAlert className="h-12 w-12 text-slate-200" />
                    <div>
                      <h4 className="font-semibold text-slate-950 dark:text-white">No blocked players</h4>
                      <p className="text-sm mt-1">{blockedSearch ? "No blocked players match this filter." : "There are no players currently on your blocked list."}</p>
                    </div>
                  </CardContent>
                </Card>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2">
                  {filteredBlocked.map((blocked) => {
                    const dispName = blocked.organizationName || `${blocked.firstName} ${blocked.lastName}`.trim() || blocked.username;
                    return (
                      <Card key={blocked.id} className="border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/50">
                        <CardContent className="flex items-center justify-between p-5 gap-4">
                          <div className="flex items-center gap-4 min-w-0">
                            <Avatar className="h-12 w-12 border border-slate-100 dark:border-slate-800 shadow-sm shrink-0">
                              {blocked.profilePicture ? (
                                <img src={blocked.profilePicture} alt={dispName} className="object-cover w-full h-full" />
                              ) : (
                                <AvatarFallback className="bg-slate-100 text-slate-650 font-bold">
                                  {dispName.substring(0, 2).toUpperCase()}
                                </AvatarFallback>
                              )}
                            </Avatar>
                            <div className="min-w-0">
                              <h4 className="font-bold text-sm text-slate-900 dark:text-white truncate">{dispName}</h4>
                              <p className="text-xs text-slate-500 truncate">@{blocked.username}</p>
                              <p className="text-[10px] text-slate-400 truncate flex items-center gap-1 mt-0.5">
                                <Mail className="h-3 w-3 inline" />
                                {blocked.email}
                              </p>
                            </div>
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            className="rounded-lg text-xs h-8 font-semibold shrink-0"
                            onClick={() => unblockMutation.mutate(blocked.id)}
                            disabled={unblockMutation.isPending}
                          >
                            Unblock
                          </Button>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
