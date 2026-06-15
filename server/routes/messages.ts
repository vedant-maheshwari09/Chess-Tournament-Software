import express from "express";
import { eq, or, and, desc, asc, ne, inArray, ilike, sql } from "drizzle-orm";
import { db } from "../db";
import { chatThreads, chatParticipants, chatMessages, users } from "../../shared/schema";
import { addSSEClient, broadcastMessage } from "../sse";
import { requireAuth } from "../auth";

export const applyMessagesRoutes = (app: express.Express) => {
  const router = express.Router();

  // Use requireAuth to parse session tokens and populate req.user
  router.use(requireAuth);

  // SSE Endpoint
  router.get("/stream", (req, res) => {
    addSSEClient(req, res, req.user!.id);
  });

  // Get user's threads
  router.get("/threads", async (req, res) => {
    const userId = req.user!.id;
    const participants = await db
      .select({ threadId: chatParticipants.threadId, lastReadAt: chatParticipants.lastReadAt })
      .from(chatParticipants)
      .where(eq(chatParticipants.userId, userId));
      
    if (participants.length === 0) {
      return res.json([]);
    }

    const threadIds = participants.map((p) => p.threadId);
    
    // Fetch threads along with other participants
    const threads = await db
      .select({
        id: chatThreads.id,
        name: chatThreads.name,
        isGroup: chatThreads.isGroup,
        tournamentId: chatThreads.tournamentId,
        participantId: chatParticipants.userId,
        participantName: users.username,
      })
      .from(chatThreads)
      .innerJoin(chatParticipants, eq(chatParticipants.threadId, chatThreads.id))
      .leftJoin(users, eq(users.id, chatParticipants.userId))
      .where(inArray(chatThreads.id, threadIds));

    // Group by thread
    const threadsMap = new Map();
    for (const t of threads) {
      if (!threadsMap.has(t.id)) {
        const userParticipant = participants.find(p => p.threadId === t.id);
        const lastReadAt = userParticipant?.lastReadAt || new Date(0);

        const unreadQuery = await db
          .select({ count: sql<number>`cast(count(*) as integer)` })
          .from(chatMessages)
          .where(and(
             eq(chatMessages.threadId, t.id),
             sql`${chatMessages.createdAt} > ${lastReadAt}`
          ));

        threadsMap.set(t.id, {
          id: t.id,
          name: t.name,
          isGroup: t.isGroup,
          tournamentId: t.tournamentId,
          unreadCount: unreadQuery[0]?.count || 0,
          participants: [],
        });
      }
      threadsMap.get(t.id).participants.push({
        id: t.participantId,
        username: t.participantName,
      });
    }

    res.json(Array.from(threadsMap.values()));
  });

  // Fetch messages for a thread
  router.get("/threads/:threadId/messages", async (req, res) => {
    const userId = req.user!.id;
    const threadId = parseInt(req.params.threadId);

    // Verify access
    const membership = await db
      .select()
      .from(chatParticipants)
      .where(and(eq(chatParticipants.threadId, threadId), eq(chatParticipants.userId, userId)))
      .limit(1);

    if (membership.length === 0) {
      return res.status(403).json({ message: "Not a participant" });
    }

    const messages = await db
      .select({
        id: chatMessages.id,
        content: chatMessages.content,
        createdAt: chatMessages.createdAt,
        senderId: chatMessages.senderId,
        senderName: users.username,
        isDeleted: chatMessages.isDeleted,
        isEdited: chatMessages.isEdited,
      })
      .from(chatMessages)
      .leftJoin(users, eq(users.id, chatMessages.senderId))
      .where(eq(chatMessages.threadId, threadId))
      .orderBy(asc(chatMessages.createdAt))
      .limit(200);

    // Update lastReadAt
    await db
      .update(chatParticipants)
      .set({ lastReadAt: new Date() })
      .where(and(eq(chatParticipants.threadId, threadId), eq(chatParticipants.userId, userId)));

    res.json(messages);
  });

  // Create thread
  router.post("/threads", async (req, res) => {
    const { name, isGroup, participantIds, tournamentId } = req.body;
    const userId = req.user!.id;

    if (!participantIds || !Array.isArray(participantIds)) {
      return res.status(400).json({ message: "participantIds array is required" });
    }

    // Enforce messaging restrictions
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

    // Add current user to participants
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
      participants: allParticipants.map(id => ({ id })) // Simplistic return, can be refetched by client
    });
  });

  // Send message
  router.post("/send", async (req, res) => {
    const userId = req.user!.id;
    const { threadId, content } = req.body;

    // Verify access
    const membership = await db
      .select()
      .from(chatParticipants)
      .where(and(eq(chatParticipants.threadId, threadId), eq(chatParticipants.userId, userId)))
      .limit(1);

    if (membership.length === 0) {
      return res.status(403).json({ message: "Not a participant" });
    }

    const newMessage = await db.insert(chatMessages).values({
      threadId,
      senderId: userId,
      content,
    }).returning();

    // Fetch sender info for broadcast
    const sender = await db.select({ username: users.username }).from(users).where(eq(users.id, userId)).limit(1);

    const messageObj = {
      id: newMessage[0].id,
      threadId: newMessage[0].threadId,
      content: newMessage[0].content,
      createdAt: newMessage[0].createdAt,
      isDeleted: newMessage[0].isDeleted,
      senderId: userId,
      senderName: sender[0]?.username,
    };

    // Broadcast to all participants
    const allParticipants = await db
      .select({ userId: chatParticipants.userId })
      .from(chatParticipants)
      .where(eq(chatParticipants.threadId, threadId));

    const participantIds = allParticipants.map((p) => p.userId);
    broadcastMessage(participantIds, {
      type: "new_message",
      message: messageObj,
    });

    res.json(messageObj);
  });

  // Typing indicator
  router.post("/typing", async (req, res) => {
    const userId = req.user!.id;
    const { threadId, isTyping } = req.body;

    // Verify access
    const membership = await db
      .select()
      .from(chatParticipants)
      .where(and(eq(chatParticipants.threadId, threadId), eq(chatParticipants.userId, userId)))
      .limit(1);

    if (membership.length === 0) {
      return res.status(403).json({ message: "Not a participant" });
    }

    const sender = await db.select({ username: users.username }).from(users).where(eq(users.id, userId)).limit(1);

    // Broadcast to all participants EXCEPT sender
    const allParticipants = await db
      .select({ userId: chatParticipants.userId })
      .from(chatParticipants)
      .where(eq(chatParticipants.threadId, threadId));

    const participantIds = allParticipants.map((p) => p.userId).filter(id => id !== userId);
    if (participantIds.length > 0) {
      broadcastMessage(participantIds, {
        type: "typing",
        threadId,
        userId,
        username: sender[0]?.username,
        isTyping: !!isTyping
      });
    }

    res.json({ success: true });
  });

  // Delete message
  router.delete("/:id", async (req, res) => {
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
      .set({ isDeleted: true, content: "" })
      .where(eq(chatMessages.id, messageId))
      .returning();

    // Broadcast delete event
    const allParticipants = await db
      .select({ userId: chatParticipants.userId })
      .from(chatParticipants)
      .where(eq(chatParticipants.threadId, message[0].threadId));

    const participantIds = allParticipants.map((p) => p.userId);
    broadcastMessage(participantIds, {
      type: "message_deleted",
      messageId,
      threadId: message[0].threadId
    });

    res.json(updated[0]);
  });

  // Edit message
  router.patch("/:id", async (req, res) => {
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
    const allParticipants = await db
      .select({ userId: chatParticipants.userId })
      .from(chatParticipants)
      .where(eq(chatParticipants.threadId, message[0].threadId));

    const participantIds = allParticipants.map((p) => p.userId);
    
    // Fetch sender info for broadcast
    const sender = await db.select({ username: users.username }).from(users).where(eq(users.id, userId)).limit(1);

    broadcastMessage(participantIds, {
      type: "message_edited",
      message: {
        id: updated[0].id,
        threadId: updated[0].threadId,
        content: updated[0].content,
        createdAt: updated[0].createdAt,
        isDeleted: updated[0].isDeleted,
        isEdited: updated[0].isEdited,
        senderId: userId,
        senderName: sender[0]?.username,
      }
    });

    res.json(updated[0]);
  });

  // Search users for new chat
  router.get("/users/search", async (req, res) => {
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
      })
      .from(users)
      .where(and(...searchConditions))
      .limit(20);

    res.json(results);
  });

  app.use("/api/messages", router);
};
