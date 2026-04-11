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

  // Persist the server choice so the survey endpoint can use it without re-asking
  const projRaw = await c.env.FORWARD_CONFIG.get(uid);
  const projCurrent = projRaw ? (JSON.parse(projRaw) as Record<string, unknown>) : {};
  await c.env.FORWARD_CONFIG.put(uid, JSON.stringify({ ...projCurrent, server }));

  const workerOrigin = new URL(c.req.url).origin;
  const webhookUrl = `${workerOrigin}/api/hook/${uid}`;
  const hooksUrl = `${server}/api/v2/assets/${uid}/hooks/`;
  const authHeaders = {
    Authorization: `Token ${token}`,
    "Content-Type": "application/json",
  };

  // Check for an existing "LogIE Integration" hook before creating a new one
  const listRes = await fetch(hooksUrl, {
    headers: { Authorization: `Token ${token}` },
  });
  if (!listRes.ok) {
    const body = await listRes.text();
    return new Response(body, {
      status: listRes.status,
      headers: { "Content-Type": listRes.headers.get("Content-Type") ?? "application/json" },
    });
  }
  const listData = await listRes.json<{ results: Array<{ name: string; uid: string; url: string }> }>();
  const existing = listData.results.find((h) => h.name === "LogIE Integration");
  if (existing) {
    return c.json({ already_exists: true, uid: existing.uid, url: existing.url }, 200);
  }

  const res = await fetch(hooksUrl, {
    method: "POST",
    headers: authHeaders,
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

  const permsUrl = `${server}/api/v2/assets/${uid}/permission-assignments/`;
  const authHeaders = {
    Authorization: `Token ${token}`,
    "Content-Type": "application/json",
  };
  const newUser = `${server}/api/v2/users/wfp_logie/`;
  const newPerm = `${server}/api/v2/permissions/view_submissions/`;

  // Fetch the asset to determine the owner username
  const assetRes = await fetch(`${server}/api/v2/assets/${uid}/`, {
    headers: { Authorization: `Token ${token}` },
  });
  if (!assetRes.ok) {
    const body = await assetRes.text();
    return new Response(body, {
      status: assetRes.status,
      headers: { "Content-Type": assetRes.headers.get("Content-Type") ?? "application/json" },
    });
  }
  const asset = await assetRes.json<{ owner__username: string }>();
  const ownerUserUrl = `${server}/api/v2/users/${asset.owner__username}/`;

  // Fetch existing permissions so we can preserve them in the bulk POST
  const listRes = await fetch(permsUrl, { headers: { Authorization: `Token ${token}` } });
  if (!listRes.ok) {
    const body = await listRes.text();
    return new Response(body, {
      status: listRes.status,
      headers: { "Content-Type": listRes.headers.get("Content-Type") ?? "application/json" },
    });
  }
  const existing = await listRes.json<Array<{ user: string; permission: string }>>();

  // Check if the permission already exists
  const alreadyGranted = existing.some(
    (p) => p.user === newUser && p.permission === newPerm
  );
  if (alreadyGranted) {
    return c.json({ already_exists: true }, 200);
  }

  // Merge: keep non-owner existing entries and append the new one
  const merged = [
    ...existing
      .filter((p) => p.user !== ownerUserUrl)
      .map((p) => ({ user: p.user, permission: p.permission })),
    { user: newUser, permission: newPerm },
  ];

  const res = await fetch(`${permsUrl}bulk/`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify(merged),
  });

  const body = await res.text();
  return new Response(body, {
    status: res.status,
    headers: { "Content-Type": res.headers.get("Content-Type") ?? "application/json" },
  });
});

// ── POST /api/configure/forward ───────────────────────────────────────────────

configure.post("/forward", async (c) => {
  const { uid, forwardUrl } = await c.req.json<{
    uid: string;
    forwardUrl: string;
  }>();

  if (!uid) {
    return c.json({ error: "uid is required" }, 400);
  }

  if (forwardUrl) {
    let parsed: URL;
    try {
      parsed = new URL(forwardUrl);
    } catch {
      return c.json({ error: "forwardUrl is not a valid URL" }, 400);
    }
    if (parsed.protocol !== "https:") {
      return c.json({ error: "forwardUrl must use https://" }, 400);
    }
    await c.env.FORWARD_CONFIG.put(uid, JSON.stringify({ forwardUrl }));
  } else {
    await c.env.FORWARD_CONFIG.delete(uid);
  }

  return c.json({ ok: true });
});

// ── GET /api/configure/project/:uid ──────────────────────────────────────────

configure.get("/project/:uid", async (c) => {
  const uid = c.req.param("uid");
  const raw = await c.env.FORWARD_CONFIG.get(uid);
  const config = raw
    ? (JSON.parse(raw) as {
        server?: string;
        forwardUrl?: string;
        forwardToken?: string;
        fields?: string[];
        transcribe?: { questions: string[]; model?: string; prompt?: string; translateTo?: string };
        describe?: { questions: string[]; model?: string; prompt?: string };
        forwardMedia?: string[];
        appendValues?: Array<{ key: string; value: string }>;
      })
    : {};
  return c.json({
    server: config.server ?? "",
    forwardUrl: config.forwardUrl ?? "",
    forwardToken: config.forwardToken ?? "",
    fields: config.fields ?? [],
    transcribe: config.transcribe ?? null,
    describe: config.describe ?? null,
    forwardMedia: config.forwardMedia ?? null,
    appendValues: config.appendValues ?? [],
  });
});

// ── POST /api/configure/project/:uid ─────────────────────────────────────────

configure.post("/project/:uid", async (c) => {
  const uid = c.req.param("uid");
  const { forwardUrl, forwardToken, fields, transcribe, describe, forwardMedia, appendValues } = await c.req.json<{
    forwardUrl?: string;
    forwardToken?: string;
    fields?: string[];
    transcribe?: { questions: string[]; model?: string; prompt?: string; translateTo?: string } | null;
    describe?: { questions: string[]; model?: string; prompt?: string } | null;
    forwardMedia?: string[] | null;
    appendValues?: Array<{ key: string; value: string }> | null;
  }>();

  if (forwardUrl) {
    let parsed: URL;
    try {
      parsed = new URL(forwardUrl);
    } catch {
      return c.json({ error: "forwardUrl is not a valid URL" }, 400);
    }
    if (parsed.protocol !== "https:") {
      return c.json({ error: "forwardUrl must use https://" }, 400);
    }
  }

  // Validate transcribe config if provided
  let safeTranscribe: { questions: string[]; model?: string; prompt?: string; translateTo?: string } | undefined;
  if (transcribe != null) {
    if (!Array.isArray(transcribe.questions)) {
      return c.json({ error: "transcribe.questions must be an array" }, 400);
    }
    const safeQuestions = transcribe.questions
      .map((q) => String(q).trim())
      .filter(Boolean);
    safeTranscribe = {
      questions: safeQuestions,
      ...(transcribe.model ? { model: String(transcribe.model).trim() } : {}),
      ...(transcribe.prompt ? { prompt: String(transcribe.prompt).trim() } : {}),
      ...(transcribe.translateTo ? { translateTo: String(transcribe.translateTo).trim() } : {}),
    };
  }

  // Validate describe config if provided
  let safeDescribe: { questions: string[]; model?: string; prompt?: string } | undefined;
  if (describe != null) {
    if (!Array.isArray(describe.questions)) {
      return c.json({ error: "describe.questions must be an array" }, 400);
    }
    const safeQuestions = describe.questions
      .map((q) => String(q).trim())
      .filter(Boolean);
    safeDescribe = {
      questions: safeQuestions,
      ...(describe.model ? { model: String(describe.model).trim() } : {}),
      ...(describe.prompt ? { prompt: String(describe.prompt).trim() } : {}),
    };
  }

  const safeFields = Array.isArray(fields)
    ? fields.map((f) => String(f).trim()).filter(Boolean)
    : [];
  const safeUrl = forwardUrl?.trim() ?? "";
  const safeToken = forwardToken?.trim() ?? "";
  const ALLOWED_MEDIA = new Set(["image", "audio", "video", "application"]);
  const safeForwardMedia = Array.isArray(forwardMedia)
    ? forwardMedia.map((m) => String(m).trim()).filter((m) => ALLOWED_MEDIA.has(m))
    : null;

  let safeAppendValues: Array<{ key: string; value: string }> | undefined;
  if (appendValues != null) {
    if (!Array.isArray(appendValues)) {
      return c.json({ error: "appendValues must be an array" }, 400);
    }
    safeAppendValues = appendValues
      .filter((e) => e && typeof e.key === "string" && typeof e.value === "string")
      .map((e) => ({ key: String(e.key).trim(), value: String(e.value).trim() }))
      .filter((e) => e.key.length > 0);
  }

  if (!safeUrl && !safeToken && safeFields.length === 0 && safeTranscribe === undefined && safeDescribe === undefined && safeForwardMedia === null && (!safeAppendValues || safeAppendValues.length === 0)) {
    await c.env.FORWARD_CONFIG.delete(uid);
  } else {
    // Preserve any other keys already in the config (e.g. set by /forward)
    const existing = await c.env.FORWARD_CONFIG.get(uid);
    const current = existing ? (JSON.parse(existing) as Record<string, unknown>) : {};
    const next: Record<string, unknown> = {
      ...current,
      forwardUrl: safeUrl,
      forwardToken: safeToken,
      fields: safeFields,
    };
    // transcribe: null means "clear", undefined means "don't touch"
    if (transcribe === null) {
      delete next.transcribe;
    } else if (safeTranscribe !== undefined) {
      next.transcribe = safeTranscribe;
    }
    // describe: null means "clear", undefined means "don't touch"
    if (describe === null) {
      delete next.describe;
    } else if (safeDescribe !== undefined) {
      next.describe = safeDescribe;
    }
    // forwardMedia: null = forward all (clear restriction), array = restrict
    if (forwardMedia === null) {
      delete next.forwardMedia;
    } else if (safeForwardMedia !== null) {
      next.forwardMedia = safeForwardMedia;
    }
    // appendValues: empty = clear, entries = set
    if (appendValues !== undefined) {
      if (safeAppendValues && safeAppendValues.length > 0) {
        next.appendValues = safeAppendValues;
      } else {
        delete next.appendValues;
      }
    }
    await c.env.FORWARD_CONFIG.put(uid, JSON.stringify(next));
  }

  return c.json({ ok: true });
});

// ── POST /api/configure/survey/:uid ─────────────────────────────────────────
// Proxies to the Kobo asset API using the wfp_logie server token.

configure.get("/survey/:uid", async (c) => {
  const uid = c.req.param("uid");

  // Read the server stored during REST service setup; fall back to env default
  const raw = await c.env.FORWARD_CONFIG.get(uid);
  const config = raw ? (JSON.parse(raw) as { server?: string }) : {};
  const server =
    config.server && ALLOWED_SERVERS.has(config.server)
      ? config.server
      : c.env.DEFAULT_KOBO_BASE_URL;

  const token =
    new URL(server).hostname === "eu.kobotoolbox.org"
      ? c.env.KOBO_API_TOKEN_EU
      : c.env.KOBO_API_TOKEN_GLOBAL;

  const res = await fetch(`${server}/api/v2/assets/${uid}/`, {
    headers: { Authorization: `Token ${token}` },
  });
  if (!res.ok) {
    const body = await res.text();
    return new Response(body, {
      status: res.status,
      headers: { "Content-Type": res.headers.get("Content-Type") ?? "application/json" },
    });
  }

  const asset = await res.json<{
    content?: {
      survey?: Array<{ type: string; $xpath: string; label?: string[] }>;
    };
  }>();

  const SKIP = new Set(["begin_group", "end_group", "begin_repeat", "end_repeat"]);
  const questions = (asset.content?.survey ?? [])
    .filter((q) => q.$xpath && !SKIP.has(q.type))
    .map((q) => ({ xpath: q.$xpath, label: q.label?.[0] ?? q.$xpath, type: q.type }));

  return c.json({ questions });
});

export default configure;
