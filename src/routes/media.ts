import { Hono } from "hono";
import { isAllowedMediaHost } from "../lib/kobo.js";
import type { Env } from "../types.js";

const media = new Hono<{ Bindings: Env }>();

media.get("/", async (c) => {
  const rawUrl = c.req.query("url");
  const token = c.req.query("token");
  const base = c.req.query("base") ?? c.env.DEFAULT_KOBO_BASE_URL;

  if (!rawUrl) {
    return c.text("Missing url param", 400);
  }
  if (!token) {
    return c.text("Missing token param", 400);
  }

  // SSRF guard — only proxy URLs on the same host as the configured base
  if (!isAllowedMediaHost(rawUrl, base)) {
    return c.text("Disallowed media host", 400);
  }

  let targetUrl: URL;
  try {
    targetUrl = new URL(rawUrl);
  } catch {
    return c.text("Invalid url param", 400);
  }

  // Only allow https
  if (targetUrl.protocol !== "https:") {
    return c.text("Only HTTPS media URLs are allowed", 400);
  }

  const upstream = await fetch(targetUrl.toString(), {
    headers: {
      Authorization: `Token ${token}`,
    },
  });

  if (!upstream.ok) {
    return c.text(`Kobo returned ${upstream.status}`, upstream.status as 400 | 401 | 403 | 404 | 500);
  }

  const contentType = upstream.headers.get("content-type") ?? "application/octet-stream";

  return new Response(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      // Allow browser to cache media within a session
      "Cache-Control": "private, max-age=3600",
    },
  });
});

export default media;
