import express from "express";
import { eq, or, and, desc, asc, ne, inArray, ilike, sql } from "drizzle-orm";
import { db } from "../db";
import { chatThreads, chatParticipants, chatMessages, users, tournaments, playerRegistrations, messageReactions } from "../../shared/schema";
import { addSSEClient, broadcastMessage } from "../sse";
import { requireAuth } from "../auth";
import multer from "multer";
import path from "path";
import fs from "fs/promises";

// Configure multer for chat attachments
const chatAttachmentsDir = path.join(process.cwd(), "uploads", "attachments");
const attachmentStorage = multer.diskStorage({
  destination: async (req, file, cb) => {
    await fs.mkdir(chatAttachmentsDir, { recursive: true });
    cb(null, chatAttachmentsDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'chat-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const uploadAttachment = multer({
  storage: attachmentStorage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB limit
});

export const applyMessagesRoutes = (app: express.Express) => {
  const router = express.Router();

  // Use requireAuth to parse session tokens and populate req.user
  router.use(requireAuth);

  // SSE Endpoint
  router.get("/stream", (req, res) => {
    addSSEClient(req, res, req.user!.id);
  });

  // Helper to ensure tournament chat channels exist
  const ensureTournamentChannels = async (tournamentId: number) => {
    // Check if announcements channel exists
    const [announcementChannel] = await db
      .select()
      .from(chatThreads)
      .where(and(eq(chatThreads.tournamentId, tournamentId), eq(chatThreads.name, "announcements")))
      .limit(1);

    if (!announcementChannel) {
      await db.insert(chatThreads).values({
        tournamentId,
        name: "announcements",
        isGroup: true,
        createdBy: null,
      });
    }

    // Check if general channel exists
    const [generalChannel] = await db
      .select()
      .from(chatThreads)
      .where(and(eq(chatThreads.tournamentId, tournamentId), eq(chatThreads.name, "general")))
      .limit(1);

    if (!generalChannel) {
      await db.insert(chatThreads).values({
        tournamentId,
        name: "general",
        isGroup: true,
        createdBy: null,
      });
    }
  };

  // Helper to check thread membership
  const checkThreadMembership = async (threadId: number, userId: number) => {
    // 1. Check direct participant membership
    const membership = await db
      .select()
      .from(chatParticipants)
      .where(and(eq(chatParticipants.threadId, threadId), eq(chatParticipants.userId, userId)))
      .limit(1);
    if (membership.length > 0) return true;

    // 2. Check tournament channel membership
    const [thread] = await db
      .select()
      .from(chatThreads)
      .where(eq(chatThreads.id, threadId))
      .limit(1);
    if (thread && thread.tournamentId) {
      const [tournament] = await db
        .select()
        .from(tournaments)
        .where(eq(tournaments.id, thread.tournamentId))
        .limit(1);
      if (tournament) {
        if (tournament.createdBy === userId) return true;
        const reg = await db
          .select()
          .from(playerRegistrations)
          .where(and(eq(playerRegistrations.tournamentId, thread.tournamentId), eq(playerRegistrations.userId, userId)))
          .limit(1);
        if (reg.length > 0) return true;
      }
    }
    return false;
  };

  // Helper to fetch participant IDs for broadcast
  const getThreadParticipantIds = async (threadId: number) => {
    // Direct participants
    const directParticipants = await db
      .select({ userId: chatParticipants.userId })
      .from(chatParticipants)
      .where(eq(chatParticipants.threadId, threadId));
    const ids = directParticipants.map((p) => p.userId);

    // Tournament participants
    const [thread] = await db
      .select()
      .from(chatThreads)
      .where(eq(chatThreads.id, threadId))
      .limit(1);
    if (thread && thread.tournamentId) {
      const [tournament] = await db
        .select()
        .from(tournaments)
        .where(eq(tournaments.id, thread.tournamentId))
        .limit(1);
      if (tournament) {
        if (!ids.includes(tournament.createdBy)) {
          ids.push(tournament.createdBy);
        }
        const regs = await db
          .select({ userId: playerRegistrations.userId })
          .from(playerRegistrations)
          .where(eq(playerRegistrations.tournamentId, thread.tournamentId));
        for (const reg of regs) {
          if (reg.userId && !ids.includes(reg.userId)) {
            ids.push(reg.userId);
          }
        }
      }
    }
    return ids;
  };

  const updateLastReadAt = async (threadId: number, userId: number) => {
    const [existingPart] = await db
      .select()
      .from(chatParticipants)
      .where(and(eq(chatParticipants.threadId, threadId), eq(chatParticipants.userId, userId)))
      .limit(1);

    if (existingPart) {
      await db
        .update(chatParticipants)
        .set({ lastReadAt: new Date() })
        .where(eq(chatParticipants.id, existingPart.id));
    } else {
      await db
        .insert(chatParticipants)
        .values({
          threadId,
          userId,
          lastReadAt: new Date(),
        });
    }
  };

  // Get user's threads (DMs + Tournament Server Channels)
  router.get("/threads", async (req, res) => {
    try {
      const userId = req.user!.id;

      // 1. Get tournaments related to the user (as creator or player)
      const tdTournaments = await db
        .select({
          id: tournaments.id,
          name: tournaments.name,
          roundTimings: tournaments.roundTimings,
          createdBy: tournaments.createdBy
        })
        .from(tournaments)
        .where(eq(tournaments.createdBy, userId));

      const playerRegs = await db
        .select({ tournamentId: playerRegistrations.tournamentId })
        .from(playerRegistrations)
        .where(eq(playerRegistrations.userId, userId));
      
      const registeredIds = playerRegs.map((r) => r.tournamentId);
      const playerTournaments = registeredIds.length > 0
        ? await db
            .select({
              id: tournaments.id,
              name: tournaments.name,
              roundTimings: tournaments.roundTimings,
              createdBy: tournaments.createdBy
            })
            .from(tournaments)
            .where(inArray(tournaments.id, registeredIds))
        : [];

      const allTournaments = [...tdTournaments, ...playerTournaments];

      // Filter tournaments where chat is enabled
      const chatEnabledTournaments = allTournaments.filter((tourney) => {
        const config = tourney.roundTimings as any;
        return config?.registers?.chatEnabled === true;
      });

      // Ensure threads exist for these tournaments
      for (const tourney of chatEnabledTournaments) {
        await ensureTournamentChannels(tourney.id);
      }

      // 2. Fetch direct participant threads
      const participants = await db
        .select({ threadId: chatParticipants.threadId, lastReadAt: chatParticipants.lastReadAt })
        .from(chatParticipants)
        .where(eq(chatParticipants.userId, userId));
      
      const directThreadIds = participants.map((p) => p.threadId);

      // 3. Fetch tournament threads
      const tourneyIds = chatEnabledTournaments.map((t) => t.id);
      const tourneyThreadIds: number[] = [];
      if (tourneyIds.length > 0) {
        const tThreads = await db
          .select({ id: chatThreads.id })
          .from(chatThreads)
          .where(inArray(chatThreads.tournamentId, tourneyIds));
        tourneyThreadIds.push(...tThreads.map((t) => t.id));
      }

      const allThreadIds = Array.from(new Set([...directThreadIds, ...tourneyThreadIds]));
      if (allThreadIds.length === 0) {
        return res.json([]);
      }

      // Fetch threads details
      const threads = await db
        .select({
          id: chatThreads.id,
          name: chatThreads.name,
          isGroup: chatThreads.isGroup,
          tournamentId: chatThreads.tournamentId,
          tournamentName: tournaments.name,
          participantId: chatParticipants.userId,
          participantName: users.username,
          participantFirstName: users.firstName,
          participantLastName: users.lastName,
          participantOrgName: users.organizationName,
          participantRole: users.role,
        })
        .from(chatThreads)
        .leftJoin(tournaments, eq(tournaments.id, chatThreads.tournamentId))
        .leftJoin(chatParticipants, eq(chatParticipants.threadId, chatThreads.id))
        .leftJoin(users, eq(users.id, chatParticipants.userId))
        .where(inArray(chatThreads.id, allThreadIds));

      // Group by thread
      const threadsMap = new Map();
      for (const t of threads) {
        if (!threadsMap.has(t.id)) {
          const userParticipant = participants.find((p) => p.threadId === t.id);
          const lastReadAt = userParticipant?.lastReadAt || new Date(0);

          const unreadQuery = await db
            .select({ count: sql<number>`cast(count(*) as integer)` })
            .from(chatMessages)
            .where(and(
               eq(chatMessages.threadId, t.id),
               ne(chatMessages.senderId, userId),
               sql`${chatMessages.createdAt} > ${lastReadAt}`
            ));

          threadsMap.set(t.id, {
            id: t.id,
            name: t.name,
            isGroup: t.isGroup,
            tournamentId: t.tournamentId,
            tournamentName: t.tournamentName || null,
            unreadCount: unreadQuery[0]?.count || 0,
            participants: [],
          });
        }
        
        if (t.participantId) {
          const dispName = t.participantOrgName || `${t.participantFirstName} ${t.participantLastName}`.trim() || t.participantName;
          threadsMap.get(t.id).participants.push({
            id: t.participantId,
            username: t.participantName,
            displayName: dispName,
            role: t.participantRole,
          });
        }
      }

      res.json(Array.from(threadsMap.values()));
    } catch (err) {
      console.error("Get threads error:", err);
      res.status(500).json({ message: "Failed to fetch threads" });
    }
  });

  // Fetch messages for a thread (handles optional query parameter `q` for search)
  router.get("/threads/:threadId/messages", async (req, res) => {
    try {
      const userId = req.user!.id;
      const threadId = parseInt(req.params.threadId);
      const queryText = req.query.q as string;

      // Verify access
      const isMember = await checkThreadMembership(threadId, userId);
      if (!isMember) {
        return res.status(403).json({ message: "Not a participant in this chat" });
      }

      // Base search condition
      const conditions = [eq(chatMessages.threadId, threadId)];
      if (queryText && queryText.trim()) {
        conditions.push(ilike(chatMessages.content, `%${queryText}%`));
      }

      const messages = await db
        .select({
          id: chatMessages.id,
          content: chatMessages.content,
          createdAt: chatMessages.createdAt,
          senderId: chatMessages.senderId,
          senderName: users.username,
          senderFirstName: users.firstName,
          senderLastName: users.lastName,
          senderOrgName: users.organizationName,
          isDeleted: chatMessages.isDeleted,
          isEdited: chatMessages.isEdited,
          isPinned: chatMessages.isPinned,
          attachmentUrl: chatMessages.attachmentUrl,
          attachmentType: chatMessages.attachmentType,
        })
        .from(chatMessages)
        .leftJoin(users, eq(users.id, chatMessages.senderId))
        .where(and(...conditions))
        .orderBy(asc(chatMessages.createdAt))
        .limit(200);

      // Fetch reactions for these messages
      let messagesWithReactions: any[] = [];
      if (messages.length > 0) {
        const msgIds = messages.map((m) => m.id);
        const reactionsList = await db
          .select({
            id: messageReactions.id,
            messageId: messageReactions.messageId,
            userId: messageReactions.userId,
            emoji: messageReactions.emoji,
            username: users.username,
            firstName: users.firstName,
            lastName: users.lastName,
            organizationName: users.organizationName,
          })
          .from(messageReactions)
          .innerJoin(users, eq(users.id, messageReactions.userId))
          .where(inArray(messageReactions.messageId, msgIds));

        messagesWithReactions = messages.map((msg) => {
          const msgReactions = reactionsList
            .filter((r) => r.messageId === msg.id)
            .map((r) => ({
              id: r.id,
              userId: r.userId,
              emoji: r.emoji,
              userDisplayName: r.organizationName || `${r.firstName} ${r.lastName}`.trim() || r.username,
            }));
          return {
            ...msg,
            senderDisplayName: msg.senderOrgName || `${msg.senderFirstName} ${msg.senderLastName}`.trim() || msg.senderName,
            reactions: msgReactions,
          };
        });
      }

      // Update lastReadAt for this participant
      await updateLastReadAt(threadId, userId);

      res.json(messagesWithReactions);
    } catch (err) {
      console.error("Fetch messages error:", err);
      res.status(500).json({ message: "Failed to fetch messages" });
    }
  });

  // Mark thread as read
  router.post("/threads/:threadId/read", async (req, res) => {
    try {
      const userId = req.user!.id;
      const threadId = parseInt(req.params.threadId);
      await updateLastReadAt(threadId, userId);
      res.json({ success: true });
    } catch (err) {
      console.error("Read thread error:", err);
      res.status(500).json({ message: "Failed to mark thread as read" });
    }
  });

  // Create thread
  router.post("/threads", async (req, res) => {
    try {
      const { name, isGroup, participantIds, tournamentId } = req.body;
      const userId = req.user!.id;

      if (!participantIds || !Array.isArray(participantIds)) {
        return res.status(400).json({ message: "participantIds array is required" });
      }

      const isGroupChat = !!isGroup || participantIds.length > 1;
      if (isGroupChat && req.user!.role !== "tournament_director") {
        return res.status(403).json({ message: "Only Tournament Directors can create group chats." });
      }

      if (!isGroupChat) {
        const otherId = participantIds[0];
        if (otherId && req.user!.role === "player") {
          const [otherUser] = await db.select().from(users).where(eq(users.id, otherId)).limit(1);
          if (otherUser && otherUser.role !== "tournament_director") {
            return res.status(403).json({ message: "Players can only create individual chats with tournament directors." });
          }
        }
      }

      const allParticipants = Array.from(new Set([...participantIds, userId]));

      const newThread = await db.insert(chatThreads).values({
        name: name || null,
        isGroup: isGroup || false,
        tournamentId: tournamentId || null,
        createdBy: userId,
      }).returning();

      const threadId = newThread[0].id;

      // Add participants
      for (const pId of allParticipants) {
        await db.insert(chatParticipants).values({
          threadId,
          userId: pId,
        });
      }

      res.json({
        ...newThread[0],
        participants: allParticipants.map(id => ({ id }))
      });
    } catch (err) {
      console.error("Create thread error:", err);
      res.status(500).json({ message: "Failed to create chat thread" });
    }
  });

  // Upload attachment file
  router.post("/upload", uploadAttachment.single("file"), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: "No file uploaded" });
      }
      
      const fileUrl = `/uploads/attachments/${req.file.filename}`;
      const isImage = req.file.mimetype.startsWith("image/");
      
      res.json({
        url: fileUrl,
        type: isImage ? "image" : "file",
        name: req.file.originalname,
      });
    } catch (err) {
      console.error("Chat upload error:", err);
      res.status(500).json({ message: "Failed to upload file" });
    }
  });

  // Send message
  router.post("/send", async (req, res) => {
    try {
      const userId = req.user!.id;
      const { threadId, content, attachmentUrl, attachmentType } = req.body;

      // Verify access
      const isMember = await checkThreadMembership(threadId, userId);
      if (!isMember) {
        return res.status(403).json({ message: "Not a participant in this chat" });
      }

      // Announcements restriction: only TDs can write in `#announcements` channels
      const [thread] = await db
        .select()
        .from(chatThreads)
        .where(eq(chatThreads.id, threadId))
        .limit(1);
      if (thread && thread.tournamentId && thread.name === "announcements" && req.user!.role !== "tournament_director") {
        return res.status(403).json({ message: "Only Tournament Directors can post in announcements" });
      }

      const newMessage = await db.insert(chatMessages).values({
        threadId,
        senderId: userId,
        content,
        attachmentUrl: attachmentUrl || null,
        attachmentType: attachmentType || null,
      }).returning();

      // Update sender's lastReadAt
      await updateLastReadAt(threadId, userId);

      // Fetch sender info for display name
      const [sender] = await db
        .select()
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

      const senderDispName = sender.organizationName || `${sender.firstName} ${sender.lastName}`.trim() || sender.username;

      const messageObj = {
        id: newMessage[0].id,
        threadId: newMessage[0].threadId,
        content: newMessage[0].content,
        createdAt: newMessage[0].createdAt,
        isDeleted: newMessage[0].isDeleted,
        isEdited: newMessage[0].isEdited,
        isPinned: newMessage[0].isPinned,
        attachmentUrl: newMessage[0].attachmentUrl,
        attachmentType: newMessage[0].attachmentType,
        senderId: userId,
        senderName: sender.username,
        senderDisplayName: senderDispName,
        reactions: [],
      };

      // Broadcast to all participants
      const participantIds = await getThreadParticipantIds(threadId);
      broadcastMessage(participantIds, {
        type: "new_message",
        message: messageObj,
      });

      res.json(messageObj);
    } catch (err) {
      console.error("Send message error:", err);
      res.status(500).json({ message: "Failed to send message" });
    }
  });

  // Typing indicator
  router.post("/typing", async (req, res) => {
    try {
      const userId = req.user!.id;
      const { threadId, isTyping } = req.body;

      // Verify access
      const isMember = await checkThreadMembership(threadId, userId);
      if (!isMember) {
        return res.status(403).json({ message: "Not a participant in this chat" });
      }

      const [sender] = await db
        .select()
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      
      const senderDispName = sender.organizationName || `${sender.firstName} ${sender.lastName}`.trim() || sender.username;

      // Broadcast to all participants EXCEPT sender
      const participantIds = await getThreadParticipantIds(threadId);
      const otherParticipantIds = participantIds.filter(id => id !== userId);
      if (otherParticipantIds.length > 0) {
        broadcastMessage(otherParticipantIds, {
          type: "typing",
          threadId,
          userId,
          username: sender.username,
          displayName: senderDispName,
          isTyping: !!isTyping
        });
      }

      res.json({ success: true });
    } catch (err) {
      console.error("Typing indicator error:", err);
      res.status(500).json({ message: "Failed to trigger typing indicator" });
    }
  });

  // Delete message
  router.delete("/:id", async (req, res) => {
    try {
      const userId = req.user!.id;
      const messageId = parseInt(req.params.id);

      const message = await db
        .select()
        .from(chatMessages)
        .where(eq(chatMessages.id, messageId))
        .limit(1);

      if (message.length === 0) {
        return res.status(404).json({ message: "Message not found" });
      }

      if (message[0].senderId !== userId) {
        return res.status(403).json({ message: "Cannot delete another user's message" });
      }

      const updated = await db
        .update(chatMessages)
        .set({ isDeleted: true, content: "", attachmentUrl: null, attachmentType: null })
        .where(eq(chatMessages.id, messageId))
        .returning();

      // Broadcast delete event
      const participantIds = await getThreadParticipantIds(message[0].threadId);
      broadcastMessage(participantIds, {
        type: "message_deleted",
        messageId,
        threadId: message[0].threadId
      });

      res.json(updated[0]);
    } catch (err) {
      console.error("Delete message error:", err);
      res.status(500).json({ message: "Failed to delete message" });
    }
  });

  // Edit message
  router.patch("/:id", async (req, res) => {
    try {
      const userId = req.user!.id;
      const messageId = parseInt(req.params.id);
      const { content } = req.body;

      if (!content || !content.trim()) {
        return res.status(400).json({ message: "Content cannot be empty" });
      }

      const message = await db
        .select()
        .from(chatMessages)
        .where(eq(chatMessages.id, messageId))
        .limit(1);

      if (message.length === 0) {
        return res.status(404).json({ message: "Message not found" });
      }

      if (message[0].senderId !== userId) {
        return res.status(403).json({ message: "Cannot edit another user's message" });
      }

      if (message[0].isDeleted) {
        return res.status(400).json({ message: "Cannot edit a deleted message" });
      }

      const updated = await db
        .update(chatMessages)
        .set({ content, isEdited: true })
        .where(eq(chatMessages.id, messageId))
        .returning();

      // Broadcast edit event
      const participantIds = await getThreadParticipantIds(message[0].threadId);
      const [sender] = await db
        .select()
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

      const senderDispName = sender.organizationName || `${sender.firstName} ${sender.lastName}`.trim() || sender.username;

      broadcastMessage(participantIds, {
        type: "message_edited",
        message: {
          id: updated[0].id,
          threadId: updated[0].threadId,
          content: updated[0].content,
          createdAt: updated[0].createdAt,
          isDeleted: updated[0].isDeleted,
          isEdited: updated[0].isEdited,
          isPinned: updated[0].isPinned,
          attachmentUrl: updated[0].attachmentUrl,
          attachmentType: updated[0].attachmentType,
          senderId: userId,
          senderName: sender.username,
          senderDisplayName: senderDispName,
        }
      });

      res.json(updated[0]);
    } catch (err) {
      console.error("Edit message error:", err);
      res.status(500).json({ message: "Failed to edit message" });
    }
  });

  // Pin a message
  router.post("/:id/pin", async (req, res) => {
    try {
      const userId = req.user!.id;
      const messageId = parseInt(req.params.id);

      const [message] = await db
        .select()
        .from(chatMessages)
        .where(eq(chatMessages.id, messageId))
        .limit(1);

      if (!message) {
        return res.status(404).json({ message: "Message not found" });
      }

      // Check access
      const isMember = await checkThreadMembership(message.threadId, userId);
      if (!isMember) {
        return res.status(403).json({ message: "Not a participant in this chat" });
      }

      await db
        .update(chatMessages)
        .set({ isPinned: true })
        .where(eq(chatMessages.id, messageId));

      const participantIds = await getThreadParticipantIds(message.threadId);
      broadcastMessage(participantIds, {
        type: "message_pin_updated",
        messageId,
        threadId: message.threadId,
        isPinned: true
      });

      res.json({ success: true });
    } catch (err) {
      console.error("Pin message error:", err);
      res.status(500).json({ message: "Failed to pin message" });
    }
  });

  // Unpin a message
  router.post("/:id/unpin", async (req, res) => {
    try {
      const userId = req.user!.id;
      const messageId = parseInt(req.params.id);

      const [message] = await db
        .select()
        .from(chatMessages)
        .where(eq(chatMessages.id, messageId))
        .limit(1);

      if (!message) {
        return res.status(404).json({ message: "Message not found" });
      }

      // Check access
      const isMember = await checkThreadMembership(message.threadId, userId);
      if (!isMember) {
        return res.status(403).json({ message: "Not a participant in this chat" });
      }

      await db
        .update(chatMessages)
        .set({ isPinned: false })
        .where(eq(chatMessages.id, messageId));

      const participantIds = await getThreadParticipantIds(message.threadId);
      broadcastMessage(participantIds, {
        type: "message_pin_updated",
        messageId,
        threadId: message.threadId,
        isPinned: false
      });

      res.json({ success: true });
    } catch (err) {
      console.error("Unpin message error:", err);
      res.status(500).json({ message: "Failed to unpin message" });
    }
  });

  // Add an emoji reaction to a message
  router.post("/:id/react", async (req, res) => {
    try {
      const userId = req.user!.id;
      const messageId = parseInt(req.params.id);
      const { emoji } = req.body;

      if (!emoji) {
        return res.status(400).json({ message: "Emoji is required" });
      }

      const [message] = await db
        .select()
        .from(chatMessages)
        .where(eq(chatMessages.id, messageId))
        .limit(1);

      if (!message) {
        return res.status(404).json({ message: "Message not found" });
      }

      // Check access
      const isMember = await checkThreadMembership(message.threadId, userId);
      if (!isMember) {
        return res.status(403).json({ message: "Not a participant in this chat" });
      }

      // Check if reaction already exists
      const existing = await db
        .select()
        .from(messageReactions)
        .where(and(
          eq(messageReactions.messageId, messageId),
          eq(messageReactions.userId, userId),
          eq(messageReactions.emoji, emoji)
        ))
        .limit(1);

      if (existing.length === 0) {
        await db.insert(messageReactions).values({
          messageId,
          userId,
          emoji,
        });
      }

      // Fetch all updated reactions for this message to broadcast
      const reactions = await db
        .select({
          id: messageReactions.id,
          userId: messageReactions.userId,
          emoji: messageReactions.emoji,
          username: users.username,
          firstName: users.firstName,
          lastName: users.lastName,
          organizationName: users.organizationName,
        })
        .from(messageReactions)
        .innerJoin(users, eq(users.id, messageReactions.userId))
        .where(eq(messageReactions.messageId, messageId));

      const reactionsMapped = reactions.map((r) => ({
        id: r.id,
        userId: r.userId,
        emoji: r.emoji,
        userDisplayName: r.organizationName || `${r.firstName} ${r.lastName}`.trim() || r.username,
      }));

      const participantIds = await getThreadParticipantIds(message.threadId);
      broadcastMessage(participantIds, {
        type: "message_reactions_updated",
        messageId,
        threadId: message.threadId,
        reactions: reactionsMapped,
      });

      res.json(reactionsMapped);
    } catch (err) {
      console.error("React to message error:", err);
      res.status(500).json({ message: "Failed to add reaction" });
    }
  });

  // Remove emoji reaction from a message
  router.delete("/:id/react", async (req, res) => {
    try {
      const userId = req.user!.id;
      const messageId = parseInt(req.params.id);
      const { emoji } = req.body;

      if (!emoji) {
        return res.status(400).json({ message: "Emoji is required" });
      }

      const [message] = await db
        .select()
        .from(chatMessages)
        .where(eq(chatMessages.id, messageId))
        .limit(1);

      if (!message) {
        return res.status(404).json({ message: "Message not found" });
      }

      // Check access
      const isMember = await checkThreadMembership(message.threadId, userId);
      if (!isMember) {
        return res.status(403).json({ message: "Not a participant in this chat" });
      }

      await db
        .delete(messageReactions)
        .where(and(
          eq(messageReactions.messageId, messageId),
          eq(messageReactions.userId, userId),
          eq(messageReactions.emoji, emoji)
        ));

      // Fetch all remaining reactions for this message to broadcast
      const reactions = await db
        .select({
          id: messageReactions.id,
          userId: messageReactions.userId,
          emoji: messageReactions.emoji,
          username: users.username,
          firstName: users.firstName,
          lastName: users.lastName,
          organizationName: users.organizationName,
        })
        .from(messageReactions)
        .innerJoin(users, eq(users.id, messageReactions.userId))
        .where(eq(messageReactions.messageId, messageId));

      const reactionsMapped = reactions.map((r) => ({
        id: r.id,
        userId: r.userId,
        emoji: r.emoji,
        userDisplayName: r.organizationName || `${r.firstName} ${r.lastName}`.trim() || r.username,
      }));

      const participantIds = await getThreadParticipantIds(message.threadId);
      broadcastMessage(participantIds, {
        type: "message_reactions_updated",
        messageId,
        threadId: message.threadId,
        reactions: reactionsMapped,
      });

      res.json(reactionsMapped);
    } catch (err) {
      console.error("Remove reaction error:", err);
      res.status(500).json({ message: "Failed to remove reaction" });
    }
  });

  // Search users for new chat
  router.get("/users/search", async (req, res) => {
    try {
      const query = req.query.q as string;
      if (!query || query.length < 2) {
        return res.json([]);
      }

      const searchConditions = [
        or(
          ilike(users.username, `%${query}%`),
          ilike(users.firstName, `%${query}%`),
          ilike(users.lastName, `%${query}%`)
        )
      ];

      if (req.user!.role === "player") {
        searchConditions.push(eq(users.role, "tournament_director"));
      }

      const results = await db
        .select({
          id: users.id,
          username: users.username,
          firstName: users.firstName,
          lastName: users.lastName,
          organizationName: users.organizationName,
        })
        .from(users)
        .where(and(...searchConditions))
        .limit(20);

      const resultsMapped = results.map((u) => ({
        id: u.id,
        username: u.username,
        displayName: u.organizationName || `${u.firstName} ${u.lastName}`.trim() || u.username,
      }));

      res.json(resultsMapped);
    } catch (err) {
      console.error("Search users error:", err);
      res.status(500).json({ message: "Failed to search users" });
    }
  });

  app.use("/api/messages", router);
};
