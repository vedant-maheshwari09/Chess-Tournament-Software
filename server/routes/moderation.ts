import express from "express";
import { eq, and, or, ilike } from "drizzle-orm";
import { db } from "../db";
import { blocks, users } from "../../shared/schema";
import { requireAuth } from "../auth";

export const applyModerationRoutes = (app: express.Express) => {
  const router = express.Router();

  router.use(requireAuth);

  // Get blocked players
  router.get("/", async (req, res) => {
    try {
      const list = await db.select({
        id: users.id,
        username: users.username,
        firstName: users.firstName,
        lastName: users.lastName,
        email: users.email,
        profilePicture: users.profilePicture
      })
      .from(blocks)
      .innerJoin(users, eq(blocks.blockedId, users.id))
      .where(eq(blocks.blockerId, req.user!.id));
      res.json(list);
    } catch (err) {
      console.error("Get blocked players error:", err);
      res.status(500).json({ message: "Failed to get blocked players" });
    }
  });

  // Search player accounts to block (by name/username/email)
  router.get("/search-players", async (req, res) => {
    try {
      const query = req.query.q as string;
      if (!query || query.length < 2) {
        return res.json([]);
      }

      const searchConditions = [
        or(
          ilike(users.username, `%${query}%`),
          ilike(users.firstName, `%${query}%`),
          ilike(users.lastName, `%${query}%`),
          ilike(users.email, `%${query}%`)
        ),
        eq(users.role, "player") // Only search players
      ];

      const results = await db
         .select({
           id: users.id,
           username: users.username,
           firstName: users.firstName,
           lastName: users.lastName,
           email: users.email,
           profilePicture: users.profilePicture
         })
         .from(users)
         .where(and(...searchConditions))
         .limit(20);

      res.json(results);
    } catch (err) {
      console.error("Search players to block error:", err);
      res.status(500).json({ message: "Failed to search players" });
    }
  });

  // Block a player
  router.post("/:userId", async (req, res) => {
    try {
      const blockedId = parseInt(req.params.userId);
      const blockerId = req.user!.id;
      if (isNaN(blockedId)) {
        return res.status(400).json({ message: "Invalid user ID" });
      }
      if (blockedId === blockerId) {
        return res.status(400).json({ message: "You cannot block yourself" });
      }

      // Check if already blocked
      const existing = await db.select()
        .from(blocks)
        .where(and(eq(blocks.blockerId, blockerId), eq(blocks.blockedId, blockedId)))
        .limit(1);

      if (existing.length > 0) {
        return res.json({ success: true, message: "User already blocked" });
      }

      await db.insert(blocks).values({ blockerId, blockedId });
      res.json({ success: true });
    } catch (err) {
      console.error("Block player error:", err);
      res.status(500).json({ message: "Failed to block user" });
    }
  });

  // Unblock a player
  router.delete("/:userId", async (req, res) => {
    try {
      const blockedId = parseInt(req.params.userId);
      const blockerId = req.user!.id;
      if (isNaN(blockedId)) {
        return res.status(400).json({ message: "Invalid user ID" });
      }

      await db.delete(blocks)
        .where(and(eq(blocks.blockerId, blockerId), eq(blocks.blockedId, blockedId)));
      res.json({ success: true });
    } catch (err) {
      console.error("Unblock player error:", err);
      res.status(500).json({ message: "Failed to unblock user" });
    }
  });

  app.use("/api/blocks", router);
};
