import { Request, Response } from "express";

interface SSEClient {
  userId: number;
  res: Response;
}

const clients = new Set<SSEClient>();

export const addSSEClient = (req: Request, res: Response, userId: number) => {
  const client: SSEClient = { userId, res };
  clients.add(client);
  
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  // Keep-alive heartbeat
  const interval = setInterval(() => {
    res.write(":\n\n");
  }, 15000);

  // Send initial connected event
  res.write(`data: ${JSON.stringify({ type: "connected" })}\n\n`);

  req.on("close", () => {
    clearInterval(interval);
    clients.delete(client);
  });
};

/**
 * Broadcasts an SSE payload to specific user IDs.
 */
export const broadcastMessage = (userIds: number[], payload: any) => {
  clients.forEach(client => {
    if (userIds.includes(client.userId)) {
      client.res.write(`data: ${JSON.stringify(payload)}\n\n`);
    }
  });
};
