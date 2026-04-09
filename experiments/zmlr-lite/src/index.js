/**
 * ZMLR-Lite — Hono-based API experiment
 *
 * Minimal chat API compatible with OpenAI/Cursor format.
 * Direct access to req.raw.socket.remoteAddress (unlike Next.js).
 *
 * Run: node src/index.js  (or: bun run src/index.js)
 * Port: 20129 (avoids ZMLR's 20128)
 */

import { Hono } from "hono";
import { serve } from "@hono/node-server";

const PORT = parseInt(process.env.PORT || "20129", 10);

function getClientIp(c) {
  const req = c.req.raw;
  const socket = req?.socket;
  const directIp = req?.headers?.get("x-real-ip") || req?.headers?.get("remote_addr");
  if (directIp) return directIp;
  if (socket?.remoteAddress) return socket.remoteAddress.replace("::ffff:", "");
  return "unknown";
}

const app = new Hono();

app.use("*", async (c, next) => {
  c.set("clientIp", getClientIp(c));
  await next();
});

app.get("/api/health", (c) => {
  return c.json({
    status: "ok",
    runtime: typeof Bun !== "undefined" ? "bun" : "node",
    version: "0.0.1",
  });
});

app.get("/api/v1/models", (c) => {
  return c.json({
    object: "list",
    data: [
      { id: "zippymesh/Fast-Code", object: "model" },
      { id: "zippymesh/Default", object: "model" },
    ],
  });
});

app.post("/api/v1/chat/completions", async (c) => {
  const ip = c.get("clientIp");
  const body = await c.req.json().catch(() => ({}));
  const model = body.model || "unknown";

  if (!body.messages?.length) {
    return c.json({ error: { message: "Missing messages" } }, 400);
  }

  // Mock SSE response — real impl would use open-sse
  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      const msg = body.messages[body.messages.length - 1];
      const content = typeof msg.content === "string" ? msg.content : msg.content?.[0]?.text || "";
      const text = "[zmlr-lite] Echo: " + (content.slice(0, 80) || "(empty)") + "... (IP: " + ip + ")";
      controller.enqueue(encoder.encode("data: " + JSON.stringify({ choices: [{ delta: { content: text } }] }) + "\n\n"));
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
});

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: err.message }, 500);
});

console.log(`[zmlr-lite] Listening on http://0.0.0.0:${PORT} (${typeof Bun !== "undefined" ? "Bun" : "Node"})`);
serve({ fetch: app.fetch, port: PORT });
