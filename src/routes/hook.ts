import { Hono } from "hono";
import type { Env } from "../types.js";

const hook = new Hono<{ Bindings: Env }>();

const MAX_BODY_BYTES = 1_048_576; // 1 MB

hook.post("/:formUID", async (c) => {
  const formUID = c.req.param("formUID");

  // Enforce body size limit
  const contentLength = Number(c.req.header("content-length") ?? "0");
  if (contentLength > MAX_BODY_BYTES) {
    return c.text("Payload too large", 413);
  }

  // Read body and validate JSON
  let body: unknown;
  try {
    const raw = await c.req.text();
    if (raw.length > MAX_BODY_BYTES) {
      return c.text("Payload too large", 413);
    }
    body = JSON.parse(raw);
  } catch {
    return c.text("Invalid JSON", 400);
  }

  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return c.text("Expected a JSON object", 400);
  }

  // Forward to the FormSession Durable Object for this formUID
  const id = c.env.FORM_SESSION.idFromName(formUID);
  const stub = c.env.FORM_SESSION.get(id);

  const doResponse = await stub.fetch("https://do/push", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!doResponse.ok) {
    return c.text("Failed to relay submission", 502);
  }

  return c.text("OK", 200);
});

export default hook;
