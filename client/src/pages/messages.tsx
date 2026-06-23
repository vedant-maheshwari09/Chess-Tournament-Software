import { useEffect, useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Send, Hash, Loader2, Trash2, Pencil, Copy, Check, MoreVertical, Info, BellOff } from "lucide-react";
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

  const { data: threads, isLoading: threadsLoading } = useQuery({
    queryKey: ["/api/messages/threads"],
    queryFn: async () => {
      return apiRequest("/api/messages/threads");
    }
  });

  const { data: messages, isLoading: messagesLoading } = useQuery({
    queryKey: ["/api/messages/threads", activeThreadId, "messages"],
    queryFn: async () => {
      if (!activeThreadId) return [];
      return apiRequest(`/api/messages/threads/${activeThreadId}/messages`);
    },
    enabled: !!activeThreadId,
  });

  const sendMessageMutation = useMutation({
    mutationFn: async () => {
      if (!activeThreadId || !messageText.trim()) return;
      return apiRequest("/api/messages/send", {
        method: "POST",
        body: JSON.stringify({ threadId: activeThreadId, content: messageText })
      });
    },
    onSuccess: () => {
      setMessageText("");
      queryClient.invalidateQueries({ queryKey: ["/api/messages/threads", activeThreadId, "messages"] });
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
      queryClient.invalidateQueries({ queryKey: ["/api/messages/threads", activeThreadId, "messages"] });
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
      queryClient.invalidateQueries({ queryKey: ["/api/messages/threads", activeThreadId, "messages"] });
    }
  });

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
          queryClient.invalidateQueries({ queryKey: ["/api/messages/threads", data.message.threadId, "messages"] });
          queryClient.invalidateQueries({ queryKey: ["/api/messages/threads"] });
        } else if (data.type === "message_deleted") {
          queryClient.invalidateQueries({ queryKey: ["/api/messages/threads", data.threadId, "messages"] });
        } else if (data.type === "message_edited") {
          queryClient.invalidateQueries({ queryKey: ["/api/messages/threads", data.message.threadId, "messages"] });
        } else if (data.type === "typing") {
          const { threadId, username, isTyping } = data;
          setTypingUsers(prev => {
            const current = prev[threadId] || [];
            if (isTyping) {
              if (!current.includes(username)) {
                const timerKey = `${threadId}-${username}`;
                if (typingTimeoutRef.current[timerKey]) clearTimeout(typingTimeoutRef.current[timerKey]);
                
                typingTimeoutRef.current[timerKey] = setTimeout(() => {
                  setTypingUsers(p => ({
                    ...p,
                    [threadId]: (p[threadId] || []).filter(u => u !== username)
                  }));
                }, 3000);

                return { ...prev, [threadId]: [...current, username] };
              }
              return prev;
            } else {
              return { ...prev, [threadId]: current.filter(u => u !== username) };
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
  }, [queryClient]);

  // Auto scroll
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, typingUsers]);

  return (
    <div className="flex h-[calc(100vh-4rem)] max-w-6xl mx-auto py-6 px-4 gap-4">
      {/* Sidebar */}
      <Card className="w-1/3 flex flex-col overflow-hidden border-border/50 shadow-sm">
        <div className="p-4 border-b bg-muted/30 flex justify-between items-center">
          <h2 className="font-semibold text-lg">Chats</h2>
          <NewChatDialog onChatCreated={(id) => setActiveThreadId(id)} />
        </div>
        <ScrollArea className="flex-1">
          {threadsLoading ? (
            <div className="p-4 flex justify-center"><Loader2 className="animate-spin h-6 w-6 text-muted-foreground" /></div>
          ) : threads?.length === 0 ? (
            <div className="p-4 flex flex-col items-center justify-center text-center h-40 text-muted-foreground">
              <p className="mb-2">No active chats</p>
              <p className="text-sm">Click the + icon to start a new conversation.</p>
            </div>
          ) : (
            <div className="p-2 flex flex-col gap-1">
              {threads?.map((thread: any) => {
                const threadName = thread.name || thread.participants?.map((p: any) => p.username).filter((u: string) => u !== user?.username).join(", ") || "Direct Message";
                
                return (
                  <button
                    key={thread.id}
                    onClick={() => {
                      setActiveThreadId(thread.id);
                      queryClient.invalidateQueries({ queryKey: ["/api/messages/threads"] }); // Mark as read instantly on click
                    }}
                    className={`flex items-center gap-3 p-3 rounded-xl text-left transition-all ${activeThreadId === thread.id ? "bg-primary/10 hover:bg-primary/15" : "bg-transparent hover:bg-accent"}`}
                  >
                    <Avatar className="h-11 w-11 shadow-sm">
                      <AvatarFallback className={thread.isGroup ? "bg-indigo-100 text-indigo-700 dark:bg-indigo-900 dark:text-indigo-300" : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300"}>
                        {thread.isGroup ? <Hash className="h-5 w-5" /> : threadName.substring(0, 2).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 overflow-hidden">
                      <div className="flex justify-between items-center mb-1">
                        <div className={`font-semibold text-sm truncate ${thread.unreadCount > 0 && activeThreadId !== thread.id ? "text-foreground" : "text-foreground/80"}`}>
                          {threadName}
                        </div>
                      </div>
                      <div className="text-xs text-muted-foreground truncate">
                        {(typingUsers[thread.id]?.length || 0) > 0 ? (
                          <span className="text-primary italic">Typing...</span>
                        ) : thread.unreadCount > 0 && activeThreadId !== thread.id ? (
                          <span className="font-medium text-primary">{thread.unreadCount} new messages</span>
                        ) : (
                          "Click to view chat"
                        )}
                      </div>
                    </div>
                    {thread.unreadCount > 0 && activeThreadId !== thread.id && (
                      <div className="h-5 w-5 bg-primary text-primary-foreground rounded-full flex items-center justify-center text-[10px] font-bold">
                        {thread.unreadCount}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </ScrollArea>
      </Card>

      {/* Main Chat Area */}
      <Card className="flex-1 flex flex-col overflow-hidden border-border/50 shadow-sm relative bg-card/50">
        {activeThreadId ? (
          <>
            <div className="p-4 border-b bg-background/95 backdrop-blur z-10 shadow-sm flex items-center justify-between">
              <h2 className="font-semibold text-lg flex items-center gap-2">
                {threads?.find((t: any) => t.id === activeThreadId)?.name || 
                 threads?.find((t: any) => t.id === activeThreadId)?.participants?.map((p: any) => p.username).filter((u: string) => u !== user?.username).join(", ") || 
                 "Direct Message"}
              </h2>
              
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full">
                    <MoreVertical className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  <DropdownMenuItem onClick={() => {
                    const activeThread = threads?.find((t: any) => t.id === activeThreadId);
                    const names = activeThread?.participants?.map((p: any) => p.username).join(", ") || "None";
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
            
            <div className="flex-1 overflow-y-auto p-4 space-y-4" ref={scrollRef}>
              {messagesLoading ? (
                <div className="flex justify-center"><Loader2 className="animate-spin h-6 w-6 text-muted-foreground" /></div>
              ) : messages?.map((msg: any, index: number) => {
                const isMe = msg.senderId === user?.id;
                const prevMsg = index > 0 ? messages[index - 1] : null;
                const showAvatar = !prevMsg || prevMsg.senderId !== msg.senderId || new Date(msg.createdAt).getTime() - new Date(prevMsg.createdAt).getTime() > 5 * 60 * 1000;
                const isEditing = editingMessageId === msg.id;

                return (
                  <div key={msg.id} className={`flex gap-3 group ${isMe ? "ml-auto flex-row-reverse" : "mr-auto"}`}>
                    <div className="w-8 shrink-0 flex flex-col justify-end">
                      {showAvatar && !isMe && (
                        <Avatar className="h-8 w-8 mb-1">
                          <AvatarFallback className="text-xs bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                            {msg.senderName?.slice(0, 2).toUpperCase() || '?'}
                          </AvatarFallback>
                        </Avatar>
                      )}
                    </div>
                    
                    <div className={`flex flex-col gap-1 max-w-[75%] ${isMe ? "items-end" : "items-start"}`}>
                      {showAvatar && (
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xs font-medium text-foreground/80">{isMe ? "You" : msg.senderName}</span>
                          <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                            {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            {msg.isEdited && <span className="text-[9px] text-muted-foreground/60 italic">(edited)</span>}
                          </span>
                        </div>
                      )}
                      
                      <div className="flex items-center gap-2 group relative">
                        {!msg.isDeleted && !isEditing && (
                          <div className={`flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity absolute ${isMe ? "right-[100%] mr-2" : "left-[100%] ml-2"}`}>
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
                          <div>
                            <div className={`px-4 py-2.5 shadow-sm text-[15px] leading-relaxed
                              ${msg.isDeleted ? "bg-muted/50 text-muted-foreground italic rounded-2xl border border-dashed border-border" 
                              : isMe 
                                ? "bg-primary text-primary-foreground rounded-2xl rounded-tr-sm" 
                                : "bg-background border border-border/50 text-foreground rounded-2xl rounded-tl-sm"}`}>
                              {msg.isDeleted ? "This message was deleted." : msg.content}
                            </div>
                            {msg.isEdited && !showAvatar && (
                              <span className="text-[9px] text-muted-foreground/50 italic mt-0.5 block text-right pr-1">(edited)</span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
              
              {/* Typing indicator bubble */}
              {activeThreadId && (typingUsers[activeThreadId]?.length || 0) > 0 && (
                <div className="flex gap-3 mr-auto items-end animate-in fade-in slide-in-from-bottom-2 duration-300">
                  <Avatar className="h-8 w-8 mb-1 shrink-0">
                    <AvatarFallback className="text-xs bg-slate-200">
                      ...
                    </AvatarFallback>
                  </Avatar>
                  <div className="bg-background border border-border/50 text-foreground px-4 py-3 rounded-2xl rounded-tl-sm shadow-sm flex gap-1 items-center">
                    <span className="w-1.5 h-1.5 bg-slate-500 dark:bg-slate-400 rounded-full animate-bounce [animation-delay:-0.3s]"></span>
                    <span className="w-1.5 h-1.5 bg-slate-500 dark:bg-slate-400 rounded-full animate-bounce [animation-delay:-0.15s]"></span>
                    <span className="w-1.5 h-1.5 bg-slate-500 dark:bg-slate-400 rounded-full animate-bounce"></span>
                  </div>
                </div>
              )}
            </div>

            <div className="p-4 bg-background/95 backdrop-blur border-t z-10">
              <form 
                onSubmit={(e) => { e.preventDefault(); sendMessageMutation.mutate(); }}
                className="flex gap-2 relative items-center"
              >
                <Input 
                  placeholder="Type a message..." 
                  value={messageText}
                  onChange={handleTyping}
                  disabled={sendMessageMutation.isPending}
                  className="rounded-full bg-muted/50 border-transparent focus-visible:ring-1 focus-visible:bg-background pr-12 py-6 text-[15px] shadow-sm"
                />
                <Button 
                  type="submit" 
                  size="icon" 
                  className={`absolute right-1.5 rounded-full h-9 w-9 shrink-0 transition-all ${messageText.trim() ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`} 
                  disabled={!messageText.trim() || sendMessageMutation.isPending}
                >
                  {sendMessageMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4 ml-0.5" />}
                </Button>
              </form>
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground gap-4 bg-muted/5">
            <div className="h-20 w-20 rounded-full bg-primary/5 flex items-center justify-center">
              <Hash className="h-10 w-10 text-primary/20" />
            </div>
            <p className="text-lg font-medium text-foreground/80">Select a chat to start messaging</p>
            <p className="text-sm max-w-sm text-center">Choose a conversation from the sidebar or start a new one to connect with other tournament players.</p>
          </div>
        )}
      </Card>
    </div>
  );
}
