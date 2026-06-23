import { useEffect, useState, useRef, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Send, Hash, Loader2, Trash2, Pencil, Copy, Check, MoreVertical, Info, BellOff, Paperclip, Pin, Search, Smile, FileIcon, X } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { NewChatDialog } from "@/components/chat/new-chat-dialog";
import { useToast } from "@/hooks/use-toast";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

export default function MessagesDashboard() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [activeThreadId, setActiveThreadId] = useState<number | null>(null);
  const [messageText, setMessageText] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const [typingUsers, setTypingUsers] = useState<Record<number, string[]>>({});
  const typingTimeoutRef = useRef<Record<string, NodeJS.Timeout>>({});
  const [editingMessageId, setEditingMessageId] = useState<number | null>(null);
  const [editMessageText, setEditMessageText] = useState("");
  const [copiedMessageId, setCopiedMessageId] = useState<number | null>(null);
  const [isMuted, setIsMuted] = useState<Record<number, boolean>>({});

  // Search & Attachments
  const [searchQuery, setSearchQuery] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const [attachment, setAttachment] = useState<{ url: string; type: "image" | "file"; name: string } | null>(null);
  const [uploadingFile, setUploadingFile] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const quickEmojis = ["👍", "❤️", "🔥", "😂", "😮", "😢"];

  const { data: threads, isLoading: threadsLoading } = useQuery({
    queryKey: ["/api/messages/threads"],
    queryFn: async () => {
      return apiRequest("/api/messages/threads");
    }
  });

  const { data: messages, isLoading: messagesLoading } = useQuery({
    queryKey: ["/api/messages/threads", activeThreadId, "messages", searchQuery],
    queryFn: async () => {
      if (!activeThreadId) return [];
      const url = searchQuery
        ? `/api/messages/threads/${activeThreadId}/messages?q=${encodeURIComponent(searchQuery)}`
        : `/api/messages/threads/${activeThreadId}/messages`;
      return apiRequest(url);
    },
    enabled: !!activeThreadId,
  });

  // Group threads into DMs and Tournament Channels
  const groupedThreads = useMemo(() => {
    const dms: any[] = [];
    const servers: Record<string, { id: number; name: string; channels: any[] }> = {};

    for (const t of threads || []) {
      if (t.tournamentId) {
        const key = `t-${t.tournamentId}`;
        if (!servers[key]) {
          servers[key] = {
            id: t.tournamentId,
            name: t.tournamentName || "Tournament Server",
            channels: []
          };
        }
        servers[key].channels.push(t);
      } else {
        dms.push(t);
      }
    }

    // Sort channels inside each server by name (announcements first)
    for (const key of Object.keys(servers)) {
      servers[key].channels.sort((a, b) => {
        if (a.name === "announcements") return -1;
        if (b.name === "announcements") return 1;
        return a.name.localeCompare(b.name);
      });
    }

    return { dms, servers: Object.values(servers) };
  }, [threads]);

  const activeThread = useMemo(() => {
    return threads?.find((t: any) => t.id === activeThreadId);
  }, [threads, activeThreadId]);

  const activeThreadName = useMemo(() => {
    if (!activeThread) return "";
    if (activeThread.tournamentId) {
      return `# ${activeThread.name}`;
    }
    const partner = activeThread.participants?.find((p: any) => p.id !== user?.id);
    return partner?.displayName || partner?.username || "Direct Message";
  }, [activeThread, user]);

  const isAnnouncementOnly = useMemo(() => {
    return activeThread?.tournamentId && activeThread.name === "announcements" && user?.role !== "tournament_director";
  }, [activeThread, user]);

  const sendMessageMutation = useMutation({
    mutationFn: async () => {
      if (!activeThreadId) return;
      if (!messageText.trim() && !attachment) return;
      
      return apiRequest("/api/messages/send", {
        method: "POST",
        body: JSON.stringify({
          threadId: activeThreadId,
          content: messageText,
          attachmentUrl: attachment?.url || null,
          attachmentType: attachment?.type || null
        })
      });
    },
    onSuccess: () => {
      setMessageText("");
      setAttachment(null);
      queryClient.invalidateQueries({ queryKey: ["/api/messages/threads", activeThreadId, "messages", searchQuery] });
      // Clear typing indicator
      apiRequest("/api/messages/typing", {
        method: "POST",
        body: JSON.stringify({ threadId: activeThreadId, isTyping: false })
      });
    }
  });

  const deleteMessageMutation = useMutation({
    mutationFn: async (messageId: number) => {
      return apiRequest(`/api/messages/${messageId}`, {
        method: "DELETE"
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/messages/threads", activeThreadId, "messages", searchQuery] });
    }
  });

  const editMessageMutation = useMutation({
    mutationFn: async ({ messageId, content }: { messageId: number; content: string }) => {
      return apiRequest(`/api/messages/${messageId}`, {
        method: "PATCH",
        body: JSON.stringify({ content })
      });
    },
    onSuccess: () => {
      setEditingMessageId(null);
      setEditMessageText("");
      queryClient.invalidateQueries({ queryKey: ["/api/messages/threads", activeThreadId, "messages", searchQuery] });
    }
  });

  const togglePinMutation = useMutation({
    mutationFn: async ({ messageId, isPinned }: { messageId: number; isPinned: boolean }) => {
      const endpoint = isPinned ? "unpin" : "pin";
      return apiRequest(`/api/messages/${messageId}/${endpoint}`, {
        method: "POST"
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/messages/threads", activeThreadId, "messages", searchQuery] });
      toast({
        title: "Message pin status updated",
      });
    }
  });

  const handleCopyMessage = (msgId: number, content: string) => {
    navigator.clipboard.writeText(content);
    setCopiedMessageId(msgId);
    toast({
      title: "Copied to clipboard",
      description: "Message content has been copied.",
    });
    setTimeout(() => {
      setCopiedMessageId(null);
    }, 2000);
  };

  const handleToggleReaction = async (msgId: number, emoji: string, hasReacted: boolean) => {
    try {
      if (hasReacted) {
        await apiRequest(`/api/messages/${msgId}/react`, {
          method: "DELETE",
          body: JSON.stringify({ emoji }),
        });
      } else {
        await apiRequest(`/api/messages/${msgId}/react`, {
          method: "POST",
          body: JSON.stringify({ emoji }),
        });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/messages/threads", activeThreadId, "messages", searchQuery] });
    } catch (err) {
      console.error("Error toggling reaction:", err);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadingFile(true);
    const formData = new FormData();
    formData.append("file", file);

    try {
      const result = await apiRequest("/api/messages/upload", {
        method: "POST",
        body: formData,
      });
      setAttachment(result);
    } catch (err: any) {
      console.error(err);
      toast({
        title: "Upload failed",
        description: err.message || "Could not upload attachment.",
        variant: "destructive",
      });
    } finally {
      setUploadingFile(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleTyping = (e: React.ChangeEvent<HTMLInputElement>) => {
    setMessageText(e.target.value);
    if (!activeThreadId) return;

    apiRequest("/api/messages/typing", {
      method: "POST",
      body: JSON.stringify({ threadId: activeThreadId, isTyping: e.target.value.length > 0 })
    });
  };

  useEffect(() => {
    const token = localStorage.getItem("auth_token") || "";
    const eventSource = new EventSource(`/api/messages/stream?token=${encodeURIComponent(token)}`);
    
    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "new_message") {
          queryClient.invalidateQueries({ queryKey: ["/api/messages/threads", data.message.threadId, "messages", searchQuery] });
          queryClient.invalidateQueries({ queryKey: ["/api/messages/threads"] });
        } else if (data.type === "message_deleted") {
          queryClient.invalidateQueries({ queryKey: ["/api/messages/threads", data.threadId, "messages", searchQuery] });
        } else if (data.type === "message_edited") {
          queryClient.invalidateQueries({ queryKey: ["/api/messages/threads", data.message.threadId, "messages", searchQuery] });
        } else if (data.type === "message_reactions_updated") {
          queryClient.invalidateQueries({ queryKey: ["/api/messages/threads", data.threadId, "messages", searchQuery] });
        } else if (data.type === "message_pin_updated") {
          queryClient.invalidateQueries({ queryKey: ["/api/messages/threads", data.threadId, "messages", searchQuery] });
        } else if (data.type === "typing") {
          const { threadId, displayName, username, isTyping } = data;
          const display = displayName || username;
          setTypingUsers(prev => {
            const current = prev[threadId] || [];
            if (isTyping) {
              if (!current.includes(display)) {
                const timerKey = `${threadId}-${display}`;
                if (typingTimeoutRef.current[timerKey]) clearTimeout(typingTimeoutRef.current[timerKey]);
                
                typingTimeoutRef.current[timerKey] = setTimeout(() => {
                  setTypingUsers(p => ({
                    ...p,
                    [threadId]: (p[threadId] || []).filter(u => u !== display)
                  }));
                }, 3000);

                return { ...prev, [threadId]: [...current, display] };
              }
              return prev;
            } else {
              return { ...prev, [threadId]: current.filter(u => u !== display) };
            }
          });
        }
      } catch (err) {
        console.error("Failed to parse SSE", err);
      }
    };

    return () => {
      eventSource.close();
      Object.values(typingTimeoutRef.current).forEach(clearTimeout);
    };
  }, [queryClient, searchQuery]);

  // Auto scroll
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, typingUsers]);

  const pinnedMessages = useMemo(() => {
    return messages?.filter((m: any) => m.isPinned) || [];
  }, [messages]);

  return (
    <div className="flex h-[calc(100vh-4rem)] max-w-6xl mx-auto py-6 px-4 gap-4">
      {/* Sidebar */}
      <Card className="w-1/3 flex flex-col overflow-hidden border-border/50 shadow-sm bg-card">
        <div className="p-4 border-b bg-muted/20 flex justify-between items-center shrink-0">
          <h2 className="font-bold text-lg">Chats</h2>
          <NewChatDialog onChatCreated={(id) => setActiveThreadId(id)} />
        </div>
        <ScrollArea className="flex-grow">
          {threadsLoading ? (
            <div className="p-4 flex justify-center"><Loader2 className="animate-spin h-6 w-6 text-muted-foreground" /></div>
          ) : threads?.length === 0 ? (
            <div className="p-4 flex flex-col items-center justify-center text-center h-40 text-muted-foreground">
              <p className="mb-2">No active chats</p>
              <p className="text-sm">Click the + icon to start a new conversation.</p>
            </div>
          ) : (
            <div className="p-3 space-y-4">
              {/* 1. Tournament Servers Category */}
              {groupedThreads.servers.length > 0 && (
                <div className="space-y-3">
                  <span className="text-[10px] font-extrabold text-muted-foreground/80 tracking-wider uppercase block px-1">Tournament Chatrooms</span>
                  {groupedThreads.servers.map((server) => (
                    <div key={server.id} className="space-y-1 pl-1">
                      <div className="text-xs font-bold text-slate-800 dark:text-slate-200 truncate py-0.5 px-1">{server.name}</div>
                      <div className="space-y-0.5 pl-1.5 border-l border-slate-200 dark:border-slate-800">
                        {server.channels.map((channel: any) => (
                          <button
                            key={channel.id}
                            onClick={() => {
                              setActiveThreadId(channel.id);
                              queryClient.invalidateQueries({ queryKey: ["/api/messages/threads"] });
                            }}
                            className={`flex items-center gap-2 w-full p-1.5 rounded-lg text-left text-xs transition-all ${
                              activeThreadId === channel.id
                                ? "bg-indigo-50 dark:bg-slate-800 text-indigo-700 dark:text-indigo-400 font-semibold"
                                : "text-muted-foreground hover:text-foreground hover:bg-muted/30"
                            }`}
                          >
                            <Hash className="h-3.5 w-3.5" />
                            <span className="truncate">{channel.name}</span>
                            {channel.unreadCount > 0 && activeThreadId !== channel.id && (
                              <span className="ml-auto w-1.5 h-1.5 bg-indigo-500 rounded-full shrink-0"></span>
                            )}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* 2. Direct Messages Category */}
              <div className="space-y-1">
                <span className="text-[10px] font-extrabold text-muted-foreground/80 tracking-wider uppercase block px-1 pb-1">Direct Messages</span>
                {groupedThreads.dms.map((thread: any) => {
                  const partner = thread.participants?.find((p: any) => p.id !== user?.id);
                  const threadName = thread.name || partner?.displayName || partner?.username || "Direct Message";
                  
                  return (
                    <button
                      key={thread.id}
                      onClick={() => {
                        setActiveThreadId(thread.id);
                        queryClient.invalidateQueries({ queryKey: ["/api/messages/threads"] });
                      }}
                      className={`flex items-center gap-2.5 w-full p-2 rounded-xl text-left transition-all ${
                        activeThreadId === thread.id
                          ? "bg-primary/10 hover:bg-primary/15"
                          : "bg-transparent hover:bg-accent"
                      }`}
                    >
                      <Avatar className="h-9 w-9 shadow-sm shrink-0">
                        <AvatarFallback className="bg-slate-100 text-slate-700 text-xs font-semibold">
                          {threadName.substring(0, 2).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1 overflow-hidden">
                        <div className={`font-semibold text-xs truncate ${thread.unreadCount > 0 && activeThreadId !== thread.id ? "text-foreground font-bold" : "text-foreground/80"}`}>
                          {threadName}
                        </div>
                        <div className="text-[10px] text-muted-foreground truncate">
                          {(typingUsers[thread.id]?.length || 0) > 0 ? (
                            <span className="text-primary italic">Typing...</span>
                          ) : thread.unreadCount > 0 && activeThreadId !== thread.id ? (
                            <span className="font-semibold text-primary">{thread.unreadCount} new messages</span>
                          ) : (
                            "Direct message"
                          )}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </ScrollArea>
      </Card>

      {/* Main Chat Area */}
      <Card className="flex-grow flex flex-col overflow-hidden border-border/50 shadow-sm relative bg-card">
        {activeThreadId ? (
          <>
            {/* Header */}
            <div className="p-4 border-b bg-background/95 backdrop-blur z-10 shadow-sm flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2">
                <h2 className="font-bold text-base flex items-center gap-2">
                  {activeThreadName}
                </h2>
                {activeThread?.tournamentId && (
                  <span className="text-[10px] font-semibold text-indigo-600 bg-indigo-50 dark:text-indigo-400 dark:bg-slate-800 px-2 py-0.5 rounded-full">
                    {activeThread.tournamentName}
                  </span>
                )}
              </div>
              
              <div className="flex items-center gap-1.5">
                {/* Search Toggle */}
                <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full" onClick={() => setShowSearch(!showSearch)}>
                  <Search className="h-4 w-4 text-slate-500" />
                </Button>

                {/* Pins List Popover */}
                <Dialog>
                  <DialogTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full" title="Pinned Messages">
                      <Pin className="h-4 w-4 text-slate-500" />
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-md max-h-[80vh] overflow-hidden flex flex-col">
                    <DialogHeader>
                      <DialogTitle className="flex items-center gap-2">
                        <Pin className="h-5 w-5 text-indigo-500" />
                        Pinned Messages
                      </DialogTitle>
                    </DialogHeader>
                    <ScrollArea className="flex-grow mt-4 pr-3">
                      {pinnedMessages.length === 0 ? (
                        <p className="text-center text-xs text-muted-foreground py-8">No pinned messages in this chat.</p>
                      ) : (
                        <div className="space-y-4 pb-4">
                          {pinnedMessages.map((msg: any) => (
                            <div key={msg.id} className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200/50 dark:border-slate-850 space-y-1.5 relative group">
                              <div className="flex justify-between items-center">
                                <span className="text-xs font-bold text-slate-900 dark:text-white">{msg.senderDisplayName}</span>
                                <span className="text-[10px] text-muted-foreground">{new Date(msg.createdAt).toLocaleDateString()}</span>
                              </div>
                              <p className="text-sm text-slate-700 dark:text-slate-300">{msg.content}</p>
                              {msg.attachmentUrl && (
                                <div className="mt-1">
                                  {msg.attachmentType === "image" ? (
                                    <img src={msg.attachmentUrl} className="max-h-24 rounded object-cover" />
                                  ) : (
                                    <span className="text-xs text-indigo-500 underline">Attachment: {msg.attachmentUrl.split("/").pop()}</span>
                                  )}
                                </div>
                              )}
                              {user?.id === msg.senderId && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-6 text-[10px] text-destructive hover:bg-destructive/10 rounded absolute right-2 bottom-2 opacity-0 group-hover:opacity-100 transition-opacity"
                                  onClick={() => togglePinMutation.mutate({ messageId: msg.id, isPinned: true })}
                                >
                                  Unpin
                                </Button>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </ScrollArea>
                  </DialogContent>
                </Dialog>

                {/* More Options Dropdown */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full">
                      <MoreVertical className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-48">
                    <DropdownMenuItem onClick={() => {
                      const names = activeThread?.participants?.map((p: any) => p.displayName).join(", ") || "None";
                      toast({
                        title: "Chat Members",
                        description: names,
                      });
                    }}>
                      <Info className="mr-2 h-4 w-4 text-slate-500" />
                      <span>View Members</span>
                    </DropdownMenuItem>
                    
                    <DropdownMenuItem onClick={() => {
                      navigator.clipboard.writeText(String(activeThreadId));
                      toast({
                        title: "Chat ID Copied",
                        description: `ID: ${activeThreadId}`,
                      });
                    }}>
                      <Copy className="mr-2 h-4 w-4 text-slate-500" />
                      <span>Copy Chat ID</span>
                    </DropdownMenuItem>

                    <DropdownMenuItem onClick={() => {
                      setIsMuted(prev => ({ ...prev, [activeThreadId]: !prev[activeThreadId] }));
                      toast({
                        title: isMuted[activeThreadId] ? "Notifications Unmuted" : "Notifications Muted",
                        description: isMuted[activeThreadId] 
                          ? "You will now receive notifications for this chat." 
                          : "You will no longer receive sounds or badges for this chat.",
                      });
                    }}>
                      <BellOff className="mr-2 h-4 w-4 text-slate-500" />
                      <span>{isMuted[activeThreadId] ? "Unmute Chat" : "Mute Chat"}</span>
                    </DropdownMenuItem>

                    <DropdownMenuSeparator />

                    <DropdownMenuItem onClick={() => {
                      toast({
                        title: "Feature coming soon",
                        description: "Clearing history is not available yet.",
                      });
                    }} className="text-destructive focus:text-destructive">
                      <Trash2 className="mr-2 h-4 w-4" />
                      <span>Clear History</span>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>

            {/* Search Input Bar */}
            {showSearch && (
              <div className="px-4 py-2 border-b bg-muted/15 flex gap-2 items-center">
                <Search className="h-4 w-4 text-slate-400" />
                <Input
                  placeholder="Search message history..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="h-8 text-xs border-transparent focus-visible:ring-1 bg-background"
                  autoFocus
                />
                {searchQuery && (
                  <Button variant="ghost" size="icon" className="h-6 w-6 text-slate-400 hover:text-slate-900" onClick={() => setSearchQuery("")}>
                    <X className="h-3 w-3" />
                  </Button>
                )}
              </div>
            )}
            
            {/* Messages Viewport */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4" ref={scrollRef}>
              {messagesLoading ? (
                <div className="flex justify-center"><Loader2 className="animate-spin h-6 w-6 text-muted-foreground" /></div>
              ) : messages?.length === 0 ? (
                <div className="text-center text-xs text-muted-foreground py-12">
                  {searchQuery ? "No messages matching your search query." : "No messages yet. Send a message to start the conversation!"}
                </div>
              ) : (
                messages?.map((msg: any, index: number) => {
                  const isMe = msg.senderId === user?.id;
                  const prevMsg = index > 0 ? messages[index - 1] : null;
                  const showAvatar = !prevMsg || prevMsg.senderId !== msg.senderId || new Date(msg.createdAt).getTime() - new Date(prevMsg.createdAt).getTime() > 5 * 60 * 1000;
                  const isEditing = editingMessageId === msg.id;

                  return (
                    <div key={msg.id} className={`flex gap-3 group ${isMe ? "ml-auto flex-row-reverse" : "mr-auto"}`}>
                      <div className="w-8 shrink-0 flex flex-col justify-end">
                        {showAvatar && !isMe && (
                          <Avatar className="h-8 w-8 mb-1">
                            <AvatarFallback className="text-xs bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-semibold">
                              {msg.senderDisplayName?.slice(0, 2).toUpperCase() || '?'}
                            </AvatarFallback>
                          </Avatar>
                        )}
                      </div>
                      
                      <div className={`flex flex-col gap-1 max-w-[75%] ${isMe ? "items-end" : "items-start"}`}>
                        {showAvatar && (
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-xs font-semibold text-foreground/80">{isMe ? "You" : msg.senderDisplayName}</span>
                            <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                              {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              {msg.isEdited && <span className="text-[9px] text-muted-foreground/60 italic">(edited)</span>}
                              {msg.isPinned && <span title="Pinned message"><Pin className="h-3 w-3 text-indigo-500 fill-indigo-500" /></span>}
                            </span>
                          </div>
                        )}
                        
                        <div className="flex items-center gap-2 group relative">
                          {/* Hover Actions (Reactions + Copy + Edit + Delete + Pin) */}
                          {!msg.isDeleted && !isEditing && (
                            <div className={`flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-all duration-200 absolute ${isMe ? "right-[100%] mr-2.5" : "left-[100%] ml-2.5"} z-20`}>
                              {/* Quick Reaction Bar */}
                              <div className="flex items-center bg-background dark:bg-slate-900 border border-border/50 rounded-full px-2 py-0.5 shadow-sm gap-1">
                                {quickEmojis.map(emoji => {
                                  const hasReacted = msg.reactions?.some((r: any) => r.userId === user?.id && r.emoji === emoji);
                                  return (
                                    <button
                                      key={emoji}
                                      className={`hover:scale-125 transition-transform text-sm px-0.5 ${hasReacted ? "opacity-40" : "opacity-100"}`}
                                      onClick={() => handleToggleReaction(msg.id, emoji, hasReacted)}
                                    >
                                      {emoji}
                                    </button>
                                  );
                                })}
                              </div>

                              {/* Copy Clip Option */}
                              <Button 
                                variant="ghost" 
                                size="icon" 
                                className="h-6 w-6 text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded-full"
                                onClick={() => handleCopyMessage(msg.id, msg.content)}
                              >
                                {copiedMessageId === msg.id ? (
                                  <Check className="h-3.5 w-3.5 text-green-500" />
                                ) : (
                                  <Copy className="h-3.5 w-3.5" />
                                )}
                              </Button>
                              
                              {/* Pin Message Toggle */}
                              <Button 
                                variant="ghost" 
                                size="icon" 
                                className={`h-6 w-6 rounded-full ${msg.isPinned ? "text-indigo-500 hover:text-indigo-600 bg-indigo-50" : "text-muted-foreground hover:text-foreground hover:bg-muted/50"}`}
                                onClick={() => togglePinMutation.mutate({ messageId: msg.id, isPinned: msg.isPinned })}
                                disabled={togglePinMutation.isPending}
                              >
                                <Pin className="h-3.5 w-3.5" />
                              </Button>

                              {isMe && (
                                <>
                                  <Button 
                                    variant="ghost" 
                                    size="icon" 
                                    className="h-6 w-6 text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded-full"
                                    onClick={() => {
                                      setEditingMessageId(msg.id);
                                      setEditMessageText(msg.content);
                                    }}
                                  >
                                    <Pencil className="h-3.5 w-3.5" />
                                  </Button>
                                  <Button 
                                    variant="ghost" 
                                    size="icon" 
                                    className="h-6 w-6 text-destructive hover:text-destructive hover:bg-destructive/10 rounded-full"
                                    onClick={() => deleteMessageMutation.mutate(msg.id)}
                                    disabled={deleteMessageMutation.isPending}
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </Button>
                                </>
                              )}
                            </div>
                          )}
                          
                          {isEditing ? (
                            <div className="flex flex-col gap-1.5 min-w-[200px] bg-background border border-border/50 p-2.5 rounded-2xl shadow-sm">
                              <Input
                                value={editMessageText}
                                onChange={(e) => setEditMessageText(e.target.value)}
                                className="bg-muted/30 border-transparent focus-visible:bg-background focus-visible:ring-1 text-sm py-1.5 h-8"
                                autoFocus
                                onKeyDown={(e) => {
                                  if (e.key === "Enter" && editMessageText.trim()) {
                                    editMessageMutation.mutate({ messageId: msg.id, content: editMessageText });
                                  } else if (e.key === "Escape") {
                                    setEditingMessageId(null);
                                  }
                                }}
                              />
                              <div className="flex gap-1.5 justify-end">
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-6 text-[11px] px-2 rounded-md"
                                  onClick={() => setEditingMessageId(null)}
                                >
                                  Cancel
                                </Button>
                                <Button
                                  size="sm"
                                  className="h-6 text-[11px] px-2 rounded-md"
                                  disabled={!editMessageText.trim() || editMessageMutation.isPending}
                                  onClick={() => editMessageMutation.mutate({ messageId: msg.id, content: editMessageText })}
                                >
                                  {editMessageMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Save"}
                                </Button>
                              </div>
                            </div>
                          ) : (
                            <div className="space-y-1">
                              {/* Message bubble */}
                              <div className={`px-4 py-2.5 shadow-sm text-sm leading-relaxed
                                ${msg.isDeleted ? "bg-muted/50 text-muted-foreground italic rounded-2xl border border-dashed border-border" 
                                : isMe 
                                  ? "bg-primary text-primary-foreground rounded-2xl rounded-tr-sm" 
                                  : "bg-background border border-border/50 text-foreground rounded-2xl rounded-tl-sm"}`}>
                                {msg.isDeleted ? "This message was deleted." : msg.content}
                                
                                {/* Message attachment display */}
                                {msg.attachmentUrl && !msg.isDeleted && (
                                  <div className="mt-2 block">
                                    {msg.attachmentType === "image" ? (
                                      <a href={msg.attachmentUrl} target="_blank" rel="noopener noreferrer">
                                        <img src={msg.attachmentUrl} alt="attachment" className="max-w-xs max-h-52 rounded-lg object-cover border border-white/20 mt-1 cursor-zoom-in" />
                                      </a>
                                    ) : (
                                      <a
                                        href={msg.attachmentUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className={`flex items-center gap-2 p-2 rounded-lg border text-xs mt-1.5 font-medium transition-all ${
                                          isMe 
                                            ? "bg-white/10 hover:bg-white/15 border-white/10 text-white" 
                                            : "bg-slate-50 hover:bg-slate-100 dark:bg-slate-900 border-slate-200/50 text-indigo-600 dark:text-indigo-400"
                                        }`}
                                      >
                                        <FileIcon className="h-4 w-4 shrink-0" />
                                        <span className="truncate max-w-[160px]">{msg.attachmentUrl.split("/").pop()}</span>
                                      </a>
                                    )}
                                  </div>
                                )}
                              </div>
                              
                              {/* Reactions tally display */}
                              {msg.reactions && msg.reactions.length > 0 && !msg.isDeleted && (
                                <div className={`flex flex-wrap gap-1 mt-1.5 ${isMe ? "justify-end" : "justify-start"}`}>
                                  {Object.entries(
                                    msg.reactions.reduce((acc: any, r: any) => {
                                      if (!acc[r.emoji]) acc[r.emoji] = [];
                                      acc[r.emoji].push(r);
                                      return acc;
                                    }, {})
                                  ).map(([emoji, list]: [string, any]) => {
                                    const hasReacted = list.some((r: any) => r.userId === user?.id);
                                    const tooltipText = list.map((r: any) => r.userDisplayName).join(", ");
                                    
                                    return (
                                      <button
                                        key={emoji}
                                        title={tooltipText}
                                        onClick={() => handleToggleReaction(msg.id, emoji, hasReacted)}
                                        className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] border transition-all ${
                                          hasReacted 
                                            ? "bg-indigo-50 border-indigo-200 dark:bg-indigo-950/40 dark:border-indigo-900/50 text-indigo-600 dark:text-indigo-400 font-semibold" 
                                            : "bg-background border-border/50 text-muted-foreground hover:border-border"
                                        }`}
                                      >
                                        <span>{emoji}</span>
                                        <span>{list.length}</span>
                                      </button>
                                    );
                                  })}
                                </div>
                              )}

                              {msg.isEdited && !showAvatar && (
                                <span className="text-[9px] text-muted-foreground/50 italic mt-0.5 block text-right pr-1">(edited)</span>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
              
              {/* Typing indicator bubble */}
              {activeThreadId && (typingUsers[activeThreadId]?.length || 0) > 0 && (
                <div className="flex gap-3 mr-auto items-end animate-in fade-in slide-in-from-bottom-2 duration-300">
                  <Avatar className="h-8 w-8 mb-1 shrink-0">
                    <AvatarFallback className="text-xs bg-slate-200">
                      ...
                    </AvatarFallback>
                  </Avatar>
                  <div className="bg-background border border-border/50 text-foreground px-4 py-3 rounded-2xl rounded-tl-sm shadow-sm flex gap-1.5 items-center">
                    <span className="text-xs text-muted-foreground mr-1">
                      {typingUsers[activeThreadId].join(", ")} {typingUsers[activeThreadId].length === 1 ? "is" : "are"} typing
                    </span>
                    <span className="w-1.5 h-1.5 bg-slate-500 dark:bg-slate-400 rounded-full animate-bounce [animation-delay:-0.3s]"></span>
                    <span className="w-1.5 h-1.5 bg-slate-500 dark:bg-slate-400 rounded-full animate-bounce [animation-delay:-0.15s]"></span>
                    <span className="w-1.5 h-1.5 bg-slate-500 dark:bg-slate-400 rounded-full animate-bounce"></span>
                  </div>
                </div>
              )}
            </div>

            {/* Input Form Bar */}
            <div className="p-4 bg-background/95 backdrop-blur border-t z-10 shrink-0">
              {/* Attachment Preview thumbnail */}
              {attachment && (
                <div className="mb-2 p-2 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200/60 dark:border-slate-800/80 flex items-center justify-between gap-4 max-w-sm relative">
                  <div className="flex items-center gap-2 min-w-0">
                    {attachment.type === "image" ? (
                      <img src={attachment.url} className="h-10 w-10 object-cover rounded-lg border shrink-0" />
                    ) : (
                      <FileIcon className="h-8 w-8 text-indigo-500 shrink-0" />
                    )}
                    <span className="text-xs text-slate-700 dark:text-slate-300 truncate">{attachment.name}</span>
                  </div>
                  <Button variant="ghost" size="icon" className="h-6 w-6 rounded-full text-slate-400 hover:text-slate-950" onClick={() => setAttachment(null)}>
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              )}

              {isAnnouncementOnly ? (
                <div className="text-center text-xs text-muted-foreground py-3 bg-slate-50/50 dark:bg-slate-900/30 rounded-xl border border-dashed">
                  This channel is read-only. Only tournament organizers can post announcements.
                </div>
              ) : (
                <form 
                  onSubmit={(e) => { e.preventDefault(); sendMessageMutation.mutate(); }}
                  className="flex gap-2 relative items-center"
                >
                  <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleFileChange}
                    className="hidden"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="rounded-full shrink-0 text-slate-500 hover:text-indigo-600 hover:bg-slate-100 dark:hover:bg-slate-800"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploadingFile || sendMessageMutation.isPending}
                  >
                    {uploadingFile ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}
                  </Button>

                  <Input 
                    placeholder="Type a message..." 
                    value={messageText}
                    onChange={handleTyping}
                    disabled={sendMessageMutation.isPending}
                    className="rounded-full bg-muted/50 border-transparent focus-visible:ring-1 focus-visible:bg-background pr-12 py-6 text-sm shadow-sm"
                  />
                  <Button 
                    type="submit" 
                    size="icon" 
                    className={`absolute right-1.5 rounded-full h-9 w-9 shrink-0 transition-all ${
                      messageText.trim() || attachment ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                    }`} 
                    disabled={(!messageText.trim() && !attachment) || sendMessageMutation.isPending}
                  >
                    {sendMessageMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4 ml-0.5" />}
                  </Button>
                </form>
              )}
            </div>
          </>
        ) : (
          <div className="flex-grow flex flex-col items-center justify-center text-muted-foreground gap-4 bg-muted/5">
            <div className="h-20 w-20 rounded-full bg-primary/5 flex items-center justify-center">
              <Hash className="h-10 w-10 text-primary/20" />
            </div>
            <p className="text-lg font-medium text-foreground/80">Select a chat to start messaging</p>
            <p className="text-sm max-w-sm text-center font-normal">Choose a tournament server channel or direct message from the sidebar to connect with other players.</p>
          </div>
        )}
      </Card>
    </div>
  );
}
