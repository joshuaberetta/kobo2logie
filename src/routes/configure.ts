import { Hono } from "hono";
import type { Env } from "../types.js";

const configure = new Hono<{ Bindings: Env }>();

// Only these two servers are allowed — prevents SSRF to arbitrary hosts
const ALLOWED_SERVERS = new Set([
  "https://kf.kobotoolbox.org",
  "https://eu.kobotoolbox.org",
]);

// ── POST /api/configure/rest-service ─────────────────────────────────────────

configure.post("/rest-service", async (c) => {
  const { server, uid, token } = await c.req.json<{
    server: string;
    uid: string;
    token: string;
  }>();

  if (!ALLOWED_SERVERS.has(server)) {
    return c.json({ error: "Invalid server" }, 400);
  }
  if (!uid || !token) {
    return c.json({ error: "uid and token are required" }, 400);
  }

  const workerOrigin = new URL(c.req.url).origin;
  const webhookUrl = `${workerOrigin}/api/hook/${uid}`;

  const res = await fetch(`${server}/api/v2/assets/${uid}/hooks/`, {
    method: "POST",
    headers: {
      Authorization: `Token ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: "LogIE Integration",
      endpoint: webhookUrl,
      active: true,
      subset_fields: [],
      email_notification: true,
      export_type: "json",
      auth_level: "no_auth",
      settings: { custom_headers: {} },
      payload_template: "",
    }),
  });

  const body = await res.text();
  return new Response(body, {
    status: res.status,
    headers: { "Content-Type": res.headers.get("Content-Type") ?? "application/json" },
  });
});

// ── POST /api/configure/permissions ──────────────────────────────────────────

configure.post("/permissions", async (c) => {
  const { server, uid, token } = await c.req.json<{
    server: string;
    uid: string;
    token: string;
  }>();

  if (!ALLOWED_SERVERS.has(server)) {
    return c.json({ error: "Invalid server" }, 400);
  }
  if (!uid || !token) {
    return c.json({ error: "uid and token are required" }, 400);
  }

  const res = await fetch(
    `${server}/api/v2/assets/${uid}/permission-assignments/bulk/`,
    {
      method: "POST",
      headers: {
        Authorization: `Token ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify([
        {
          user: `${server}/api/v2/users/wfp_logie/`,
          permission: `${server}/api/v2/permissions/view_submissions/`,
        },
      ]),
    }
  );

  const body = await res.text();
  return new Response(body, {
    status: res.status,
    headers: { "Content-Type": res.headers.get("Content-Type") ?? "application/json" },
  });
});

export default configure;
