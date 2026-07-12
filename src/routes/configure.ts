import { Hono } from "hono";
import type { Env, Condition, ConditionGroup, FailureNotification } from "../types.js";

const configure = new Hono<{ Bindings: Env }>();

// Only these two servers are allowed — prevents SSRF to arbitrary hosts
const ALLOWED_SERVERS = new Set([
  "https://kf.kobotoolbox.org",
  "https://eu.kobotoolbox.org",
]);

// Lightweight structural check — enough to guard against arbitrary objects being stored
function isValidCondition(c: unknown): c is Condition {
  if (!c || typeof c !== "object" || Array.isArray(c)) return false;
  const g = c as Record<string, unknown>;
  return g.type === "group"
    && (g.combinator === "and" || g.combinator === "or")
    && Array.isArray(g.rules);
}

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
        forwardToLogie?: boolean;
        fields?: string[];
        transcribe?: { questions: string[]; model?: string; prompt?: string; translateTo?: string };
        extract?: { questions: string[]; model?: string; prompts?: Record<string, { description?: string; fields: Array<{ key: string; instruction: string; geocode?: boolean }> }> };
        analyzeAudio?: { questions: string[]; model?: string; prompts?: Record<string, { description?: string; fields: Array<{ key: string; instruction: string; geocode?: boolean }> }> };
        extractText?: { questions: string[]; model?: string; prompts?: Record<string, { description?: string; fields: Array<{ key: string; instruction: string; geocode?: boolean }> }> };
        forwardMedia?: string[];
        appendValues?: Array<{ key: string; value: string }>;
        appendProjectMetadata?: boolean;
        projectMetadata?: { project_uid?: string; project_name?: string; project_owner_username?: string; project_server_url?: string };
        editOriginal?: boolean;
        geocode?: boolean;
        geocodeField?: string;
        geocodeAddressFields?: string[];
        emailNotification?: { to: string[]; toXPaths?: string[]; cc?: string[]; ccXPaths?: string[]; bcc?: string[]; bccXPaths?: string[]; subject: string; body?: string; aiBody?: { instructions: string } | null; attachments?: string[]; pdfReport?: { template?: string; formTitle?: string }; condition?: Condition };
        validateSubmission?: { instructions: string; includeReasoning: boolean; options: { approved: string; notApproved: string; onHold: string }; condition?: Condition };
        failureNotification?: FailureNotification;
        forwardCondition?: Condition;
        geocodeCondition?: Condition;
      })
    : {};
  return c.json({
    server: config.server ?? "",
    forwardUrl: config.forwardUrl ?? "",
    forwardToken: config.forwardToken ?? "",
    forwardToLogie: config.forwardToLogie ?? false,
    fields: config.fields ?? [],
    transcribe: config.transcribe ?? null,
    extract: config.extract ?? null,
    analyzeAudio: config.analyzeAudio ?? null,
    extractText: config.extractText ?? null,
    forwardMedia: config.forwardMedia ?? null,
    appendValues: config.appendValues ?? [],
    appendProjectMetadata: config.appendProjectMetadata ?? false,
    projectMetadata: config.projectMetadata ?? null,
    editOriginal: config.editOriginal ?? false,
    geocode: config.geocode ?? false,
    geocodeField: config.geocodeField ?? "",
    geocodeAddressFields: config.geocodeAddressFields ?? [],
    emailNotification: config.emailNotification ?? null,
    validateSubmission: config.validateSubmission ?? null,
    failureNotification: config.failureNotification ?? null,
    forwardCondition: config.forwardCondition ?? null,
    geocodeCondition: config.geocodeCondition ?? null,
  });
});

// ── POST /api/configure/project/:uid ─────────────────────────────────────────

configure.post("/project/:uid", async (c) => {
  const uid = c.req.param("uid");
  const { forwardUrl, forwardToken, forwardToLogie, fields, transcribe, extract, analyzeAudio, extractText, forwardMedia, appendValues, appendProjectMetadata, editOriginal, geocode, geocodeField, geocodeAddressFields, emailNotification, validateSubmission, failureNotification, forwardCondition, geocodeCondition } = await c.req.json<{
    forwardUrl?: string;
    forwardToken?: string;
    forwardToLogie?: boolean;
    fields?: string[];
    transcribe?: { questions: string[]; model?: string; prompt?: string; translateTo?: string } | null;
    extract?: { questions: string[]; model?: string; prompts?: Record<string, { description?: string; fields: Array<{ key: string; instruction: string; geocode?: boolean }> }> } | null;
    analyzeAudio?: { questions: string[]; model?: string; prompts?: Record<string, { description?: string; fields: Array<{ key: string; instruction: string; geocode?: boolean }> }> } | null;
    extractText?: { questions: string[]; model?: string; prompts?: Record<string, { description?: string; fields: Array<{ key: string; instruction: string; geocode?: boolean }> }> } | null;
    forwardMedia?: string[] | null;
    appendValues?: Array<{ key: string; value: string }> | null;
    appendProjectMetadata?: boolean;
    editOriginal?: boolean;
    geocode?: boolean;
    geocodeField?: string;
    geocodeAddressFields?: string[];
    emailNotification?: { to: string[]; toXPaths?: string[]; cc?: string[]; ccXPaths?: string[]; bcc?: string[]; bccXPaths?: string[]; subject: string; body?: string; aiBody?: { instructions: string } | null; attachments?: string[]; pdfReport?: { template?: string; formTitle?: string }; condition?: Condition } | null;
    validateSubmission?: { instructions: string; includeReasoning: boolean; options: { approved: string; notApproved: string; onHold: string }; condition?: Condition } | null;
    failureNotification?: { to: string[]; cc?: string[]; bcc?: string[]; subject: string; body: string } | null;
    forwardCondition?: Condition | null;
    geocodeCondition?: Condition | null;
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
  let safeExtract: { questions: string[]; model?: string; prompts?: Record<string, { description?: string; fields: Array<{ key: string; instruction: string; geocode?: boolean }> }> } | undefined;
  if (extract != null) {
    if (!Array.isArray(extract.questions)) {
      return c.json({ error: "extract.questions must be an array" }, 400);
    }
    const safeQuestions = extract.questions
      .map((q) => String(q).trim())
      .filter(Boolean);
    const safePrompts: Record<string, { description?: string; fields: Array<{ key: string; instruction: string; geocode?: boolean }> }> = {};
    if (extract.prompts && typeof extract.prompts === "object" && !Array.isArray(extract.prompts)) {
      for (const [questionXpath, stored] of Object.entries(extract.prompts as Record<string, unknown>)) {
        if (typeof questionXpath !== "string" || !questionXpath.trim()) continue;
        if (!stored || typeof stored !== "object" || Array.isArray(stored)) continue;
        const s = stored as Record<string, unknown>;
        const description = typeof s.description === "string" ? s.description.trim() : undefined;
        const fields = Array.isArray(s.fields) ? s.fields : [];
        const safeFields = (fields as unknown[]).reduce<Array<{ key: string; instruction: string; geocode?: boolean }>>((acc, f) => {
          if (f && typeof f === "object" && !Array.isArray(f)) {
            const key = String((f as Record<string, unknown>).key ?? "").trim();
            const instruction = String((f as Record<string, unknown>).instruction ?? "").trim();
            const geocode = (f as Record<string, unknown>).geocode === true;
            if (key) acc.push({ key, instruction, ...(geocode ? { geocode: true } : {}) });
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
  let safeAnalyzeAudio: { questions: string[]; model?: string; prompts?: Record<string, { description?: string; fields: Array<{ key: string; instruction: string; geocode?: boolean }> }> } | undefined;
  if (analyzeAudio != null) {
    if (!Array.isArray(analyzeAudio.questions)) {
      return c.json({ error: "analyzeAudio.questions must be an array" }, 400);
    }
    const safeQuestions = analyzeAudio.questions
      .map((q) => String(q).trim())
      .filter(Boolean);
    const safePrompts: Record<string, { description?: string; fields: Array<{ key: string; instruction: string; geocode?: boolean }> }> = {};
    if (analyzeAudio.prompts && typeof analyzeAudio.prompts === "object" && !Array.isArray(analyzeAudio.prompts)) {
      for (const [questionXpath, stored] of Object.entries(analyzeAudio.prompts as Record<string, unknown>)) {
        if (typeof questionXpath !== "string" || !questionXpath.trim()) continue;
        if (!stored || typeof stored !== "object" || Array.isArray(stored)) continue;
        const s = stored as Record<string, unknown>;
        const description = typeof s.description === "string" ? s.description.trim() : undefined;
        const fields = Array.isArray(s.fields) ? s.fields : [];
        const safeFields = (fields as unknown[]).reduce<Array<{ key: string; instruction: string; geocode?: boolean }>>((acc, f) => {
          if (f && typeof f === "object" && !Array.isArray(f)) {
            const key = String((f as Record<string, unknown>).key ?? "").trim();
            const instruction = String((f as Record<string, unknown>).instruction ?? "").trim();
            const geocode = (f as Record<string, unknown>).geocode === true;
            if (key) acc.push({ key, instruction, ...(geocode ? { geocode: true } : {}) });
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
  let safeExtractText: { questions: string[]; model?: string; prompts?: Record<string, { description?: string; fields: Array<{ key: string; instruction: string; geocode?: boolean }> }> } | undefined;
  if (extractText != null) {
    if (!Array.isArray(extractText.questions)) {
      return c.json({ error: "extractText.questions must be an array" }, 400);
    }
    const safeQuestions = extractText.questions
      .map((q) => String(q).trim())
      .filter(Boolean);
    const safePrompts: Record<string, { description?: string; fields: Array<{ key: string; instruction: string; geocode?: boolean }> }> = {};
    if (extractText.prompts && typeof extractText.prompts === "object" && !Array.isArray(extractText.prompts)) {
      for (const [questionXpath, stored] of Object.entries(extractText.prompts as Record<string, unknown>)) {
        if (typeof questionXpath !== "string" || !questionXpath.trim()) continue;
        if (!stored || typeof stored !== "object" || Array.isArray(stored)) continue;
        const s = stored as Record<string, unknown>;
        const description = typeof s.description === "string" ? s.description.trim() : undefined;
        const fields = Array.isArray(s.fields) ? s.fields : [];
        const safeFields = (fields as unknown[]).reduce<Array<{ key: string; instruction: string; geocode?: boolean }>>((acc, f) => {
          if (f && typeof f === "object" && !Array.isArray(f)) {
            const key = String((f as Record<string, unknown>).key ?? "").trim();
            const instruction = String((f as Record<string, unknown>).instruction ?? "").trim();
            const geocode = (f as Record<string, unknown>).geocode === true;
            if (key) acc.push({ key, instruction, ...(geocode ? { geocode: true } : {}) });
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

  let safeEmailNotification: { to: string[]; toXPaths?: string[]; cc?: string[]; ccXPaths?: string[]; bcc?: string[]; bccXPaths?: string[]; subject: string; body?: string; aiBody?: { instructions: string }; attachments?: string[]; pdfReport?: { template?: string; formTitle?: string } } | undefined;
  if (emailNotification != null) {
    const { to, toXPaths, cc, ccXPaths, bcc, bccXPaths, subject, aiBody, attachments, pdfReport: emailPdfReport } = emailNotification;
    const safeTo = Array.isArray(to) ? (to as unknown[]).map((e) => String(e).trim()).filter(Boolean) : [];
    const safeToXPaths = Array.isArray(toXPaths) ? (toXPaths as unknown[]).map((x) => String(x).trim()).filter(Boolean) : [];
    if (safeTo.length === 0 && safeToXPaths.length === 0) {
      return c.json({ error: "emailNotification requires at least one To email or To XPath" }, 400);
    }
    const safeSubject = String(subject ?? "").trim();
    if (!safeSubject) {
      return c.json({ error: "emailNotification.subject is required" }, 400);
    }
    const safeCc = Array.isArray(cc) ? (cc as unknown[]).map((e) => String(e).trim()).filter(Boolean) : undefined;
    const safeCcXPaths = Array.isArray(ccXPaths) ? (ccXPaths as unknown[]).map((x) => String(x).trim()).filter(Boolean) : undefined;
    const safeBcc = Array.isArray(bcc) ? (bcc as unknown[]).map((e) => String(e).trim()).filter(Boolean) : undefined;
    const safeBccXPaths = Array.isArray(bccXPaths) ? (bccXPaths as unknown[]).map((x) => String(x).trim()).filter(Boolean) : undefined;
    if (safeTo.length > 0 && safeToXPaths.length > 0) {
      return c.json({ error: "emailNotification.to cannot include both static emails and XPaths" }, 400);
    }
    if ((safeCc?.length ?? 0) > 0 && (safeCcXPaths?.length ?? 0) > 0) {
      return c.json({ error: "emailNotification.cc cannot include both static emails and XPaths" }, 400);
    }
    if ((safeBcc?.length ?? 0) > 0 && (safeBccXPaths?.length ?? 0) > 0) {
      return c.json({ error: "emailNotification.bcc cannot include both static emails and XPaths" }, 400);
    }
    let safeAiBody: { instructions: string } | undefined;
    if (aiBody != null && typeof aiBody === "object") {
      const instructions = String((aiBody as Record<string, unknown>).instructions ?? "").trim();
      if (instructions) safeAiBody = { instructions };
    }
    const safeAttachments = Array.isArray(attachments)
      ? (attachments as unknown[]).map((x) => String(x).trim()).filter(Boolean)
      : undefined;
    const safeEmailCondition: Condition | undefined = isValidCondition(emailNotification?.condition) ? emailNotification!.condition : undefined;
    safeEmailNotification = {
      to: safeTo,
      ...(safeToXPaths.length ? { toXPaths: safeToXPaths } : {}),
      ...(safeCc?.length ? { cc: safeCc } : {}),
      ...(safeCcXPaths?.length ? { ccXPaths: safeCcXPaths } : {}),
      ...(safeBcc?.length ? { bcc: safeBcc } : {}),
      ...(safeBccXPaths?.length ? { bccXPaths: safeBccXPaths } : {}),
      subject: safeSubject,
      ...(safeAiBody ? { aiBody: safeAiBody } : { body: String(emailNotification.body ?? "").trim() }),
      ...(safeAttachments?.length ? { attachments: safeAttachments } : {}),
      ...(safeEmailCondition ? { condition: safeEmailCondition } : {}),
    };
    if (emailPdfReport != null) {
      safeEmailNotification.pdfReport = {
        ...(emailPdfReport.template ? { template: String(emailPdfReport.template).trim() } : {}),
        ...(emailPdfReport.formTitle ? { formTitle: String(emailPdfReport.formTitle).trim() } : {}),
      };
    }
  }

  // Sanitise validateSubmission config if provided
  let safeValidateSubmission: { instructions: string; includeReasoning: boolean; options: { approved: string; notApproved: string; onHold: string }; condition?: Condition } | undefined;
  if (validateSubmission != null) {
    const safeValCondition: Condition | undefined = isValidCondition(validateSubmission.condition) ? validateSubmission.condition : undefined;
    safeValidateSubmission = {
      instructions: String(validateSubmission.instructions ?? "").trim(),
      includeReasoning: validateSubmission.includeReasoning !== false,
      options: {
        approved:    String(validateSubmission.options?.approved    ?? "").trim(),
        notApproved: String(validateSubmission.options?.notApproved ?? "").trim(),
        onHold:      String(validateSubmission.options?.onHold      ?? "").trim(),
      },
      ...(safeValCondition ? { condition: safeValCondition } : {}),
    };
  }

  let safeFailureNotification: FailureNotification | undefined;
  if (failureNotification != null) {
    const { to, cc, bcc, subject, body } = failureNotification;
    const safeTo = Array.isArray(to) ? (to as unknown[]).map((e) => String(e).trim()).filter(Boolean) : [];
    if (safeTo.length === 0) {
      return c.json({ error: "failureNotification requires at least one To email" }, 400);
    }
    const safeSubject = String(subject ?? "").trim();
    if (!safeSubject) {
      return c.json({ error: "failureNotification.subject is required" }, 400);
    }
    const safeCc = Array.isArray(cc) ? (cc as unknown[]).map((e) => String(e).trim()).filter(Boolean) : undefined;
    const safeBcc = Array.isArray(bcc) ? (bcc as unknown[]).map((e) => String(e).trim()).filter(Boolean) : undefined;
    safeFailureNotification = {
      to: safeTo,
      ...(safeCc?.length ? { cc: safeCc } : {}),
      ...(safeBcc?.length ? { bcc: safeBcc } : {}),
      subject: safeSubject,
      body: String(body ?? "").trim(),
    };
  }

  const safeGeocodeAddressFields = Array.isArray(geocodeAddressFields)
    ? geocodeAddressFields.map((f) => String(f).trim()).filter(Boolean)
    : [];

  if (!safeUrl && !safeToken && forwardToLogie !== true && safeFields.length === 0 && safeTranscribe === undefined && safeExtract === undefined && safeAnalyzeAudio === undefined && safeExtractText === undefined && safeForwardMedia === null && (!safeAppendValues || safeAppendValues.length === 0) && appendProjectMetadata !== true && !editOriginal && !geocode && safeGeocodeAddressFields.length === 0 && safeEmailNotification === undefined && safeValidateSubmission === undefined) {
    await c.env.FORWARD_CONFIG.delete(uid);
  } else {
    // Preserve any other keys already in the config (e.g. set by /forward)
    const existing = await c.env.FORWARD_CONFIG.get(uid);
    const current = existing ? (JSON.parse(existing) as Record<string, unknown>) : {};
    const next: Record<string, unknown> = {
      ...current,
      forwardUrl: safeUrl,
      forwardToken: safeToken,
      forwardToLogie: forwardToLogie === true,
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
    // appendProjectMetadata: when enabled, capture the Kobo project details now so the
    // forward path can append them under _metadata without an extra fetch per submission.
    if (appendProjectMetadata === true) {
      next.appendProjectMetadata = true;
      const server =
        typeof next.server === "string" && ALLOWED_SERVERS.has(next.server)
          ? next.server
          : c.env.DEFAULT_KOBO_BASE_URL;
      const token =
        new URL(server).hostname === "eu.kobotoolbox.org"
          ? c.env.KOBO_API_TOKEN_EU
          : c.env.KOBO_API_TOKEN_GLOBAL;
      try {
        const assetRes = await fetch(`${server}/api/v2/assets/${uid}/`, {
          headers: { Authorization: `Token ${token}` },
        });
        if (assetRes.ok) {
          const asset = await assetRes.json<{ uid?: string; name?: string; owner__username?: string }>();
          next.projectMetadata = {
            project_uid: asset.uid ?? uid,
            ...(asset.name ? { project_name: asset.name } : {}),
            ...(asset.owner__username ? { project_owner_username: asset.owner__username } : {}),
            project_server_url: server,
          };
        }
      } catch (err) {
        console.error("[configure] Failed to fetch project metadata:", err);
      }
    } else {
      delete next.appendProjectMetadata;
      delete next.projectMetadata;
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
    // failureNotification: null means "clear", undefined means "don't touch"
    if (failureNotification === null) {
      delete next.failureNotification;
    } else if (safeFailureNotification !== undefined) {
      next.failureNotification = safeFailureNotification;
    }
    // geocode: always written (boolean, defaults to false)
    next.geocode = geocode === true;
    // geocodeField: empty string = clear (use _geolocation default)
    if (geocodeField?.trim()) {
      next.geocodeField = geocodeField.trim();
    } else {
      delete next.geocodeField;
    }
    // geocodeAddressFields: empty array = clear
    if (safeGeocodeAddressFields.length > 0) {
      next.geocodeAddressFields = safeGeocodeAddressFields;
    } else {
      delete next.geocodeAddressFields;
    }
    // forwardCondition: null = clear, undefined = don't touch, object = set
    if (forwardCondition === null) {
      delete next.forwardCondition;
    } else if (isValidCondition(forwardCondition)) {
      next.forwardCondition = forwardCondition;
    }
    // geocodeCondition: null = clear, undefined = don't touch, object = set
    if (geocodeCondition === null) {
      delete next.geocodeCondition;
    } else if (isValidCondition(geocodeCondition)) {
      next.geocodeCondition = geocodeCondition;
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

// ── POST /api/configure/condition/generate ────────────────────────────────────

configure.post("/condition/generate", async (c) => {
  if (!c.env.OPENAI_API_KEY) {
    return c.json({ error: "AI not configured" }, 501);
  }

  const { prompt, currentCondition } = await c.req.json<{
    prompt: string;
    currentCondition?: Condition;
  }>();

  if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
    return c.json({ error: "prompt is required" }, 400);
  }

  const systemPrompt = `You are a filter-rule builder. The user describes a filter condition in plain language.
Return ONLY valid JSON matching this TypeScript type (no explanation, no markdown fences):

type Operator = "equals" | "not_equals" | "contains" | "not_contains" | "starts_with"
              | "ends_with" | "is_empty" | "is_not_empty" | "greater_than" | "less_than"
              | "greater_than_or_equal" | "less_than_or_equal";
interface ConditionRule { type: "rule"; field: string; operator: Operator; value?: string; }
type Combinator = "and" | "or";
interface ConditionGroup { type: "group"; combinator: Combinator; rules: Array<ConditionRule | ConditionGroup>; }

Field names must be taken verbatim from the user's description (do not alter capitalisation or spacing).
If the user's prompt is a refinement of an existing condition, incorporate that condition as a starting point.`;

  const userMessage = currentCondition
    ? `Current condition:\n${JSON.stringify(currentCondition, null, 2)}\n\nUser request: ${prompt.trim()}`
    : prompt.trim();

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${c.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ],
        max_tokens: 1024,
        response_format: { type: "json_object" },
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      console.error(`[condition/generate] OpenAI error ${res.status}: ${text.slice(0, 200)}`);
      return c.json({ error: "AI request failed" }, 502);
    }

    const data = await res.json<{ choices: Array<{ message: { content: string } }> }>();
    const raw = data.choices?.[0]?.message?.content?.trim();
    if (!raw) return c.json({ error: "AI returned no content" }, 502);

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return c.json({ error: "AI returned invalid JSON" }, 502);
    }

    if (!isValidCondition(parsed)) {
      return c.json({ error: "AI returned unexpected structure" }, 502);
    }

    return c.json({ condition: parsed as ConditionGroup });
  } catch (e) {
    console.error(`[condition/generate] Error: ${e}`);
    return c.json({ error: "Internal error" }, 500);
  }
});

export default configure;
