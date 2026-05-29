import type { Request, Response } from "express";

export interface Sse {
  // Express handler for GET /api/events.
  handler: (req: Request, res: Response) => void;
  // Notify all connected clients that data changed.
  broadcast: () => void;
}

// Server-Sent Events fan-out. Each connected dashboard tab holds one streaming
// response; broadcast() pings them all so they refetch.
export function createSse(): Sse {
  const clients = new Set<Response>();

  function handler(req: Request, res: Response): void {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.write(":\n\n"); // SSE comment to establish the connection
    clients.add(res);
    req.on("close", () => clients.delete(res));
  }

  function broadcast(): void {
    const data = JSON.stringify({ type: "update", timestamp: Date.now() });
    for (const client of clients) {
      try {
        client.write(`data: ${data}\n\n`);
      } catch {
        // Socket already gone but `close` hasn't fired yet — drop it so a dead
        // client can't throw out of an otherwise-completed request handler.
        clients.delete(client);
      }
    }
  }

  return { handler, broadcast };
}
