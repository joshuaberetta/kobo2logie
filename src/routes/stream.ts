import { Hono } from "hono";
import type { Env } from "../types.js";

const stream = new Hono<{ Bindings: Env }>();

stream.get("/:formUID", async (c) => {
  const formUID = c.req.param("formUID");

  // Reject non-WebSocket requests
  const upgradeHeader = c.req.header("Upgrade");
  if (upgradeHeader !== "websocket") {
    return c.text("Expected WebSocket upgrade", 426);
  }

  // Validate Origin to prevent cross-site WebSocket hijacking
  const origin = c.req.header("Origin") ?? "";
  const workerUrl = new URL(c.req.url);
  if (origin && new URL(origin).hostname !== workerUrl.hostname) {
    return c.text("Forbidden origin", 403);
  }

  // Forward the WebSocket upgrade to the Durable Object
  const id = c.env.FORM_SESSION.idFromName(formUID);
  const stub = c.env.FORM_SESSION.get(id);

  return stub.fetch("https://do/ws", {
    headers: c.req.raw.headers,
  }) as Promise<Response>;
});

export default stream;
