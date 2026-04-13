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
        extract?: { questions: string[]; model?: string; prompts?: Record<string, { description?: string; fields: Array<{ key: string; instruction: string }> }> };
        analyzeAudio?: { questions: string[]; model?: string; prompts?: Record<string, { description?: string; fields: Array<{ key: string; instruction: string }> }> };
        extractText?: { questions: string[]; model?: string; prompts?: Record<string, { description?: string; fields: Array<{ key: string; instruction: string }> }> };
        forwardMedia?: string[];
        appendValues?: Array<{ key: string; value: string }>;
        editOriginal?: boolean;
        geocode?: boolean;
        geocodeField?: string;
        emailNotification?: { to: string[]; cc?: string[]; bcc?: string[]; subject: string; body?: string; aiBody?: { instructions: string } | null; attachments?: string[]; pdfReport?: { template?: string; formTitle?: string } };
        validateSubmission?: { instructions: string; includeReasoning: boolean; options: { approved: string; notApproved: string; onHold: string } };
      })
    : {};
  return c.json({
    server: config.server ?? "",
    forwardUrl: config.forwardUrl ?? "",
    forwardToken: config.forwardToken ?? "",
    fields: config.fields ?? [],
    transcribe: config.transcribe ?? null,
    extract: config.extract ?? null,
    analyzeAudio: config.analyzeAudio ?? null,
    extractText: config.extractText ?? null,
    forwardMedia: config.forwardMedia ?? null,
    appendValues: config.appendValues ?? [],
    editOriginal: config.editOriginal ?? false,
    geocode: config.geocode ?? false,
    geocodeField: config.geocodeField ?? "",
    emailNotification: config.emailNotification ?? null,
    validateSubmission: config.validateSubmission ?? null,
  });
});

// ── POST /api/configure/project/:uid ─────────────────────────────────────────

configure.post("/project/:uid", async (c) => {
  const uid = c.req.param("uid");
  const { forwardUrl, forwardToken, fields, transcribe, extract, analyzeAudio, extractText, forwardMedia, appendValues, editOriginal, geocode, geocodeField, emailNotification, validateSubmission } = await c.req.json<{
    forwardUrl?: string;
    forwardToken?: string;
    fields?: string[];
    transcribe?: { questions: string[]; model?: string; prompt?: string; translateTo?: string } | null;
    extract?: { questions: string[]; model?: string; prompts?: Record<string, { description?: string; fields: Array<{ key: string; instruction: string }> }> } | null;
    analyzeAudio?: { questions: string[]; model?: string; prompts?: Record<string, { description?: string; fields: Array<{ key: string; instruction: string }> }> } | null;
    extractText?: { questions: string[]; model?: string; prompts?: Record<string, { description?: string; fields: Array<{ key: string; instruction: string }> }> } | null;
    forwardMedia?: string[] | null;
    appendValues?: Array<{ key: string; value: string }> | null;
    editOriginal?: boolean;
    geocode?: boolean;
    geocodeField?: string;
    emailNotification?: { to: string[]; cc?: string[]; bcc?: string[]; subject: string; body?: string; aiBody?: { instructions: string } | null; attachments?: string[]; pdfReport?: { template?: string; formTitle?: string } } | null;
    validateSubmission?: { instructions: string; includeReasoning: boolean; options: { approved: string; notApproved: string; onHold: string } } | null;
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

  // Validate extract config if provided
  let safeExtract: { questions: string[]; model?: string; prompts?: Record<string, { description?: string; fields: Array<{ key: string; instruction: string }> }> } | undefined;
  if (extract != null) {
    if (!Array.isArray(extract.questions)) {
      return c.json({ error: "extract.questions must be an array" }, 400);
    }
    const safeQuestions = extract.questions
      .map((q) => String(q).trim())
      .filter(Boolean);
    const safePrompts: Record<string, { description?: string; fields: Array<{ key: string; instruction: string }> }> = {};
    if (extract.prompts && typeof extract.prompts === "object" && !Array.isArray(extract.prompts)) {
      for (const [questionXpath, stored] of Object.entries(extract.prompts as Record<string, unknown>)) {
        if (typeof questionXpath !== "string" || !questionXpath.trim()) continue;
        if (!stored || typeof stored !== "object" || Array.isArray(stored)) continue;
        const s = stored as Record<string, unknown>;
        const description = typeof s.description === "string" ? s.description.trim() : undefined;
        const fields = Array.isArray(s.fields) ? s.fields : [];
        const safeFields = (fields as unknown[]).reduce<Array<{ key: string; instruction: string }>>((acc, f) => {
          if (f && typeof f === "object" && !Array.isArray(f)) {
            const key = String((f as Record<string, unknown>).key ?? "").trim();
            const instruction = String((f as Record<string, unknown>).instruction ?? "").trim();
            if (key) acc.push({ key, instruction });
          }
          return acc;
        }, []);
        if (description || safeFields.length > 0) {
          safePrompts[questionXpath.trim()] = { ...(description ? { description } : {}), fields: safeFields };
        }
      }
    }
    safeExtract = {
      questions: safeQuestions,
      ...(extract.model ? { model: String(extract.model).trim() } : {}),
      ...(Object.keys(safePrompts).length > 0 ? { prompts: safePrompts } : {}),
    };
  }

  // Validate analyzeAudio config if provided
  let safeAnalyzeAudio: { questions: string[]; model?: string; prompts?: Record<string, { description?: string; fields: Array<{ key: string; instruction: string }> }> } | undefined;
  if (analyzeAudio != null) {
    if (!Array.isArray(analyzeAudio.questions)) {
      return c.json({ error: "analyzeAudio.questions must be an array" }, 400);
    }
    const safeQuestions = analyzeAudio.questions
      .map((q) => String(q).trim())
      .filter(Boolean);
    const safePrompts: Record<string, { description?: string; fields: Array<{ key: string; instruction: string }> }> = {};
    if (analyzeAudio.prompts && typeof analyzeAudio.prompts === "object" && !Array.isArray(analyzeAudio.prompts)) {
      for (const [questionXpath, stored] of Object.entries(analyzeAudio.prompts as Record<string, unknown>)) {
        if (typeof questionXpath !== "string" || !questionXpath.trim()) continue;
        if (!stored || typeof stored !== "object" || Array.isArray(stored)) continue;
        const s = stored as Record<string, unknown>;
        const description = typeof s.description === "string" ? s.description.trim() : undefined;
        const fields = Array.isArray(s.fields) ? s.fields : [];
        const safeFields = (fields as unknown[]).reduce<Array<{ key: string; instruction: string }>>((acc, f) => {
          if (f && typeof f === "object" && !Array.isArray(f)) {
            const key = String((f as Record<string, unknown>).key ?? "").trim();
            const instruction = String((f as Record<string, unknown>).instruction ?? "").trim();
            if (key) acc.push({ key, instruction });
          }
          return acc;
        }, []);
        if (description || safeFields.length > 0) {
          safePrompts[questionXpath.trim()] = { ...(description ? { description } : {}), fields: safeFields };
        }
      }
    }
    safeAnalyzeAudio = {
      questions: safeQuestions,
      ...(analyzeAudio.model ? { model: String(analyzeAudio.model).trim() } : {}),
      ...(Object.keys(safePrompts).length > 0 ? { prompts: safePrompts } : {}),
    };
  }

  // Validate extractText config if provided
  let safeExtractText: { questions: string[]; model?: string; prompts?: Record<string, { description?: string; fields: Array<{ key: string; instruction: string }> }> } | undefined;
  if (extractText != null) {
    if (!Array.isArray(extractText.questions)) {
      return c.json({ error: "extractText.questions must be an array" }, 400);
    }
    const safeQuestions = extractText.questions
      .map((q) => String(q).trim())
      .filter(Boolean);
    const safePrompts: Record<string, { description?: string; fields: Array<{ key: string; instruction: string }> }> = {};
    if (extractText.prompts && typeof extractText.prompts === "object" && !Array.isArray(extractText.prompts)) {
      for (const [questionXpath, stored] of Object.entries(extractText.prompts as Record<string, unknown>)) {
        if (typeof questionXpath !== "string" || !questionXpath.trim()) continue;
        if (!stored || typeof stored !== "object" || Array.isArray(stored)) continue;
        const s = stored as Record<string, unknown>;
        const description = typeof s.description === "string" ? s.description.trim() : undefined;
        const fields = Array.isArray(s.fields) ? s.fields : [];
        const safeFields = (fields as unknown[]).reduce<Array<{ key: string; instruction: string }>>((acc, f) => {
          if (f && typeof f === "object" && !Array.isArray(f)) {
            const key = String((f as Record<string, unknown>).key ?? "").trim();
            const instruction = String((f as Record<string, unknown>).instruction ?? "").trim();
            if (key) acc.push({ key, instruction });
          }
          return acc;
        }, []);
        if (description || safeFields.length > 0) {
          safePrompts[questionXpath.trim()] = { ...(description ? { description } : {}), fields: safeFields };
        }
      }
    }
    safeExtractText = {
      questions: safeQuestions,
      ...(extractText.model ? { model: String(extractText.model).trim() } : {}),
      ...(Object.keys(safePrompts).length > 0 ? { prompts: safePrompts } : {}),
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

  let safeEmailNotification: { to: string[]; cc?: string[]; bcc?: string[]; subject: string; body?: string; aiBody?: { instructions: string }; attachments?: string[]; pdfReport?: { template?: string; formTitle?: string } } | undefined;
  if (emailNotification != null) {
    const { to, cc, bcc, subject, body, aiBody, attachments, pdfReport: emailPdfReport } = emailNotification;
    if (!Array.isArray(to) || to.length === 0) {
      return c.json({ error: "emailNotification.to must be a non-empty array" }, 400);
    }
    const safeTo = (to as unknown[]).map((e) => String(e).trim()).filter(Boolean);
    if (safeTo.length === 0) {
      return c.json({ error: "emailNotification.to must contain at least one email" }, 400);
    }
    const safeSubject = String(subject ?? "").trim();
    if (!safeSubject) {
      return c.json({ error: "emailNotification.subject is required" }, 400);
    }
    const safeCc = Array.isArray(cc) ? (cc as unknown[]).map((e) => String(e).trim()).filter(Boolean) : undefined;
    const safeBcc = Array.isArray(bcc) ? (bcc as unknown[]).map((e) => String(e).trim()).filter(Boolean) : undefined;
    let safeAiBody: { instructions: string } | undefined;
    if (aiBody != null && typeof aiBody === "object") {
      const instructions = String((aiBody as Record<string, unknown>).instructions ?? "").trim();
      if (instructions) safeAiBody = { instructions };
    }
    const safeAttachments = Array.isArray(attachments)
      ? (attachments as unknown[]).map((x) => String(x).trim()).filter(Boolean)
      : undefined;
    safeEmailNotification = {
      to: safeTo,
      ...(safeCc?.length ? { cc: safeCc } : {}),
      ...(safeBcc?.length ? { bcc: safeBcc } : {}),
      subject: safeSubject,
      ...(safeAiBody ? { aiBody: safeAiBody } : { body: String(body ?? "").trim() }),
      ...(safeAttachments?.length ? { attachments: safeAttachments } : {}),
    };
    if (emailPdfReport != null) {
      safeEmailNotification.pdfReport = {
        ...(emailPdfReport.template ? { template: String(emailPdfReport.template).trim() } : {}),
        ...(emailPdfReport.formTitle ? { formTitle: String(emailPdfReport.formTitle).trim() } : {}),
      };
    }
  }

  // Sanitise validateSubmission config if provided
  let safeValidateSubmission: { instructions: string; includeReasoning: boolean; options: { approved: string; notApproved: string; onHold: string } } | undefined;
  if (validateSubmission != null) {
    safeValidateSubmission = {
      instructions: String(validateSubmission.instructions ?? "").trim(),
      includeReasoning: validateSubmission.includeReasoning !== false,
      options: {
        approved:    String(validateSubmission.options?.approved    ?? "").trim(),
        notApproved: String(validateSubmission.options?.notApproved ?? "").trim(),
        onHold:      String(validateSubmission.options?.onHold      ?? "").trim(),
      },
    };
  }

  if (!safeUrl && !safeToken && safeFields.length === 0 && safeTranscribe === undefined && safeExtract === undefined && safeAnalyzeAudio === undefined && safeExtractText === undefined && safeForwardMedia === null && (!safeAppendValues || safeAppendValues.length === 0) && !editOriginal && !geocode && safeEmailNotification === undefined && safeValidateSubmission === undefined) {
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
      editOriginal: editOriginal === true,
      geocode: geocode === true,
      ...(geocodeField?.trim() ? { geocodeField: geocodeField.trim() } : {}),
    };
    // transcribe: null means "clear", undefined means "don't touch"
    if (transcribe === null) {
      delete next.transcribe;
    } else if (safeTranscribe !== undefined) {
      next.transcribe = safeTranscribe;
    }
    // extract: null means "clear", undefined means "don't touch"
    if (extract === null) {
      delete next.extract;
    } else if (safeExtract !== undefined) {
      next.extract = safeExtract;
    }
    // analyzeAudio: null means "clear", undefined means "don't touch"
    if (analyzeAudio === null) {
      delete next.analyzeAudio;
    } else if (safeAnalyzeAudio !== undefined) {
      next.analyzeAudio = safeAnalyzeAudio;
    }
    // extractText: null means "clear", undefined means "don't touch"
    if (extractText === null) {
      delete next.extractText;
    } else if (safeExtractText !== undefined) {
      next.extractText = safeExtractText;
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
    // emailNotification: null means "clear", undefined means "don't touch"
    if (emailNotification === null) {
      delete next.emailNotification;
    } else if (safeEmailNotification !== undefined) {
      next.emailNotification = safeEmailNotification;
    }
    // validateSubmission: null means "clear", undefined means "don't touch"
    if (validateSubmission === null) {
      delete next.validateSubmission;
    } else if (safeValidateSubmission !== undefined) {
      next.validateSubmission = safeValidateSubmission;
    }
    // geocode: always written (boolean, defaults to false)
    next.geocode = geocode === true;
    // geocodeField: empty string = clear (use _geolocation default)
    if (geocodeField?.trim()) {
      next.geocodeField = geocodeField.trim();
    } else {
      delete next.geocodeField;
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
