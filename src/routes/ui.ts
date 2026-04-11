import { Hono } from "hono";
import { html, raw } from "hono/html";
import type { Env } from "../types.js";

const ui = new Hono<{ Bindings: Env }>();

// ── Configure page ─────────────────────────────────────────────────────────

ui.get("/", (c) => {
  return c.html(
    html`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>kobo2logie — Configure</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui, sans-serif; background: #f5f5f5; color: #1a1a1a; min-height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 2rem; }
    .card { background: #fff; border-radius: 12px; padding: 2.5rem; max-width: 640px; width: 100%; box-shadow: 0 2px 12px rgba(0,0,0,.08); }
    h1 { font-size: 1.6rem; font-weight: 700; margin-bottom: .25rem; }
    .subtitle { color: #666; margin-bottom: 2rem; font-size: .95rem; }
    .fields { display: flex; flex-direction: column; gap: 1rem; margin-bottom: 2rem; }
    label { display: block; font-size: .85rem; font-weight: 600; color: #444; margin-bottom: .4rem; }
    input, select { width: 100%; padding: .6rem .8rem; border: 1.5px solid #ddd; border-radius: 8px; font-size: .95rem; outline: none; transition: border-color .15s; background: #fff; }
    input:focus, select:focus { border-color: #2563eb; }
    .action-btn { margin-top: .5rem; width: 100%; padding: .7rem; background: #2563eb; color: #fff; border: none; border-radius: 8px; font-size: 1rem; font-weight: 600; cursor: pointer; transition: background .15s; }
    .action-btn:hover { background: #1d4ed8; }
    .action-btn:disabled { background: #93c5fd; cursor: not-allowed; }
    .results { display: none; margin-top: 1.25rem; border: 1.5px solid #e5e7eb; border-radius: 10px; padding: 1rem 1.25rem; display: none; flex-direction: column; gap: .6rem; }
    .result-row { display: flex; align-items: baseline; gap: .75rem; }
    .result-label { font-size: .78rem; font-weight: 700; color: #6b7280; width: 100px; flex-shrink: 0; }
    .status { font-size: .82rem; line-height: 1.5; word-break: break-word; flex: 1; }
    .status.pending { color: #6b7280; }
    .status.success { color: #15803d; }
    .status.error { color: #dc2626; }
    .continue-btn { margin-top: 1.25rem; width: 100%; padding: .7rem; background: #16a34a; color: #fff; border: none; border-radius: 8px; font-size: 1rem; font-weight: 600; cursor: pointer; transition: background .15s; display: none; }
    .continue-btn:hover { background: #15803d; }
  </style>
</head>
<body>
  <div class="card">
    <h1>kobo2logie</h1>
    <p class="subtitle">Configure KoboToolbox integration</p>

    <div class="fields">
      <div>
        <label for="server">Server</label>
        <select id="server">
          <option value="https://kf.kobotoolbox.org">Global — kf.kobotoolbox.org</option>
          <option value="https://eu.kobotoolbox.org">EU — eu.kobotoolbox.org</option>
        </select>
      </div>
      <div>
        <label for="uid">Form UID</label>
        <input id="uid" type="text" placeholder="e.g. a6LDoopohAy6s2Vw9gWo8p" autocomplete="off" spellcheck="false" />
      </div>
      <div>
        <label for="token">API Token</label>
        <input id="token" type="password" placeholder="your KoboToolbox API token" autocomplete="off" />
      </div>
    </div>

    <button type="button" class="action-btn" id="setup-btn" onclick="setupIntegration()">Set up integration</button>

    <div class="results" id="results">
      <div class="result-row">
        <span class="result-label">REST Service</span>
        <div class="status" id="rest-status"></div>
      </div>
      <div class="result-row">
        <span class="result-label">Permissions</span>
        <div class="status" id="perm-status"></div>
      </div>
    </div>

    <button type="button" class="continue-btn" id="continue-btn" onclick="goToProject()">Configure project &rarr;</button>
  </div>

  <script>
    function getInputs() {
      return {
        server: document.getElementById('server').value,
        uid: document.getElementById('uid').value.trim(),
        token: document.getElementById('token').value.trim(),
      };
    }

    function setStatus(id, state, message) {
      const el = document.getElementById(id);
      el.className = 'status ' + state;
      el.textContent = message;
    }

    function goToProject() {
      const uid = document.getElementById('uid').value.trim();
      if (uid) window.location.href = '/' + uid;
    }

    async function setupIntegration() {
      const { server, uid, token } = getInputs();
      if (!uid || !token) {
        document.getElementById('results').style.display = 'flex';
        setStatus('rest-status', 'error', 'Form UID and API Token are required.');
        setStatus('perm-status', 'error', 'Form UID and API Token are required.');
        return;
      }
      const btn = document.getElementById('setup-btn');
      btn.disabled = true;
      document.getElementById('results').style.display = 'flex';
      document.getElementById('continue-btn').style.display = 'none';
      setStatus('rest-status', 'pending', 'Registering\u2026');
      setStatus('perm-status', 'pending', 'Applying permissions\u2026');

      const [restResult, permResult] = await Promise.allSettled([
        fetch('/api/configure/rest-service', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ server, uid, token }),
        }),
        fetch('/api/configure/permissions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ server, uid, token }),
        }),
      ]);

      let allOk = true;

      // REST Service result
      if (restResult.status === 'fulfilled') {
        const res = restResult.value;
        if (res.ok) {
          const data = await res.json();
          const msg = data.already_exists ? '\u2713 Already registered' : '\u2713 Registered: ' + (data.endpoint ?? '');
          setStatus('rest-status', 'success', msg);
        } else {
          const text = await res.text();
          setStatus('rest-status', 'error', 'Error ' + res.status + ': ' + text.slice(0, 200));
          allOk = false;
        }
      } else {
        setStatus('rest-status', 'error', 'Network error: ' + restResult.reason?.message);
        allOk = false;
      }

      // Permissions result
      if (permResult.status === 'fulfilled') {
        const res = permResult.value;
        if (res.ok) {
          const data = await res.json();
          const msg = data.already_exists ? '\u2713 Already applied' : '\u2713 Applied for wfp_logie';
          setStatus('perm-status', 'success', msg);
        } else {
          const text = await res.text();
          setStatus('perm-status', 'error', 'Error ' + res.status + ': ' + text.slice(0, 200));
          allOk = false;
        }
      } else {
        setStatus('perm-status', 'error', 'Network error: ' + permResult.reason?.message);
        allOk = false;
      }

      btn.disabled = false;
      if (allOk) {
        document.getElementById('continue-btn').style.display = 'block';
      }
    }
  </script>
</body>
</html>`
  );
});

// ── Project config page /:uid ─────────────────────────────────────────────────

ui.get("/:uid", (c) => {
  const uid = c.req.param("uid");
  return c.html(
    html`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>kobo2logie — ${uid}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui, sans-serif; background: #f5f5f5; color: #1a1a1a; min-height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 2rem; }
    .card { background: #fff; border-radius: 12px; padding: 2.5rem; max-width: 640px; width: 100%; box-shadow: 0 2px 12px rgba(0,0,0,.08); }
    .back { display: inline-block; font-size: .82rem; color: #2563eb; text-decoration: none; margin-bottom: 1.5rem; }
    .back:hover { text-decoration: underline; }
    h1 { font-size: 1.4rem; font-weight: 700; margin-bottom: .25rem; }
    .page-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; margin-bottom: .25rem; }
    .page-header-left {}
    .uid-badge { font-family: monospace; font-size: .78rem; background: #f3f4f6; color: #555; padding: .2rem .55rem; border-radius: 5px; display: inline-block; margin-bottom: 1.75rem; }
    .fields { display: flex; flex-direction: column; gap: 1.25rem; }
    label { display: block; font-size: .85rem; font-weight: 600; color: #444; margin-bottom: .4rem; }
    .label-hint { font-size: .75rem; font-weight: 400; color: #9ca3af; margin-left: .4rem; }
    input[type="url"], input[type="text"], input[type="password"] { width: 100%; padding: .6rem .8rem; border: 1.5px solid #ddd; border-radius: 8px; font-size: .95rem; outline: none; transition: border-color .15s; }
    input[type="url"]:focus, input[type="text"]:focus, input[type="password"]:focus { border-color: #2563eb; }

    .survey-status { display: flex; align-items: center; gap: .4rem; font-size: .8rem; color: #6b7280; margin-bottom: .4rem; min-height: 1rem; }
    .survey-status.error { color: #dc2626; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .spinner { width: .85rem; height: .85rem; border: 2px solid #d1d5db; border-top-color: #6b7280; border-radius: 50%; animation: spin .7s linear infinite; flex-shrink: 0; }
    .field-list-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: .4rem; }
    .field-list-header label { margin-bottom: 0; }
    .select-btn { background: none; border: 1.5px solid #d1d5db; border-radius: 6px; font-size: .76rem; font-weight: 600; color: #6b7280; padding: .2rem .55rem; cursor: pointer; }
    .select-btn:hover { border-color: #9ca3af; color: #374151; }
    .fields-count { font-size: .74rem; font-weight: 600; color: #6b7280; background: #f3f4f6; border-radius: 10px; padding: .1rem .5rem; margin-left: .35rem; white-space: nowrap; }
    .fields-toggle { background: none; border: none; cursor: pointer; color: #9ca3af; font-size: .85rem; padding: .1rem .25rem; line-height: 1; transition: color .15s; }
    .fields-toggle:hover { color: #374151; }

    select { width: 100%; padding: .6rem .8rem; border: 1.5px solid #ddd; border-radius: 8px; font-size: .95rem; color: #1a1a1a; background: #fff; outline: none; cursor: pointer; }
    select:focus { border-color: #2563eb; }
    .checkbox-row { display: flex; align-items: center; gap: .5rem; cursor: pointer; user-select: none; }
    .checkbox-row input[type="checkbox"] { width: 1rem; height: 1rem; cursor: pointer; accent-color: #2563eb; flex-shrink: 0; }
    .checkbox-row span { font-size: .85rem; font-weight: 600; color: #444; }
    .transcribe-section { border: 1.5px solid #e5e7eb; border-radius: 8px; padding: .75rem .9rem; margin-top: 1.5rem; }
    .transcribe-sub { display: flex; flex-direction: column; gap: 1rem; margin-top: .9rem; }
    .load-status { font-size: .78rem; margin-top: .35rem; color: #6b7280; min-height: 1.1rem; }
    .load-status.error { color: #dc2626; }
    .question-list { display: flex; flex-direction: column; gap: .25rem; }
    .question-list-box { max-height: 19rem; overflow-y: auto; border: 1.5px solid #e5e7eb; border-radius: 8px; padding: .4rem .6rem; display: flex; flex-direction: column; gap: .2rem; }
    .question-item { display: flex; align-items: baseline; gap: .5rem; font-size: .85rem; cursor: pointer; padding: .15rem 0; }
    .question-item input[type="checkbox"] { width: 1rem; height: 1rem; cursor: pointer; accent-color: #2563eb; flex-shrink: 0; margin-top: .1rem; }
    .question-item .q-label { font-weight: 500; color: #374151; }
    .question-item .q-xpath { font-family: monospace; font-size: .76rem; color: #9ca3af; }
    .question-item .q-output { font-family: monospace; font-size: .76rem; color: #d1d5db; margin-left: auto; }
    .question-sub-item { display: flex; align-items: center; gap: .5rem; font-size: .8rem; cursor: pointer; padding: .05rem 0 .25rem 1.55rem; color: #6b7280; }
    .question-sub-item input[type="checkbox"] { width: .85rem; height: .85rem; cursor: pointer; accent-color: #2563eb; flex-shrink: 0; }
    .question-sub-item .q-output { font-family: monospace; font-size: .74rem; color: #d1d5db; margin-left: auto; }

    .save-row { display: flex; align-items: center; gap: .75rem; padding-top: .35rem; flex-shrink: 0; }
    .save-btn { padding: .5rem 1.5rem; background: #2563eb; color: #fff; border: none; border-radius: 8px; font-size: .9rem; font-weight: 600; cursor: pointer; transition: background .15s; white-space: nowrap; }
    .save-btn:hover { background: #1d4ed8; }
    .save-btn:disabled { background: #93c5fd; cursor: not-allowed; }
    .status-msg { font-size: .85rem; min-height: 1.2rem; }
    .status-msg.success { color: #15803d; }
    .status-msg.error { color: #dc2626; }

    /* Submission log */
    .log-header { display: flex; align-items: center; justify-content: space-between; margin-top: 2rem; margin-bottom: .5rem; }
    .log-title-btn { background: none; border: none; padding: 0; font-size: .88rem; font-weight: 700; color: #374151; cursor: pointer; display: flex; align-items: center; gap: .35rem; }
    .log-title-btn .log-chevron { transition: transform .15s; flex-shrink: 0; }
    .log-title-btn.collapsed .log-chevron { transform: rotate(-90deg); }
    .log-actions { display: flex; gap: .4rem; }
    .log-refresh-btn { background: none; border: 1.5px solid #d1d5db; border-radius: 6px; font-size: .76rem; font-weight: 600; color: #6b7280; padding: .2rem .55rem; cursor: pointer; }
    .log-refresh-btn:hover { border-color: #9ca3af; color: #374151; }
    .log-body { overflow: hidden; }
    .log-scroll { max-height: 26rem; overflow-y: auto; }
    .log-table { width: 100%; border-collapse: collapse; font-size: .8rem; }
    .log-table th { text-align: left; font-size: .72rem; font-weight: 700; color: #9ca3af; text-transform: uppercase; letter-spacing: .03em; padding: .3rem .5rem; border-bottom: 1.5px solid #e5e7eb; }
    .log-table td { padding: .35rem .5rem; border-bottom: 1px solid #f3f4f6; vertical-align: middle; color: #374151; font-family: monospace; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 180px; }
    .log-table tr:last-child td { border-bottom: none; }
    .log-badge { display: inline-block; font-size: .72rem; font-weight: 700; border-radius: 4px; padding: .1rem .4rem; }
    .log-badge.ok { background: #dcfce7; color: #15803d; }
    .log-badge.fail { background: #fee2e2; color: #dc2626; }
    .log-empty { font-size: .82rem; color: #9ca3af; text-align: center; padding: 1rem 0; }
    .log-detail-btn { background: none; border: 1.5px solid #d1d5db; border-radius: 5px; font-size: .72rem; font-weight: 600; color: #6b7280; padding: .1rem .45rem; cursor: pointer; white-space: nowrap; }
    .log-detail-btn:hover { border-color: #9ca3af; color: #374151; }
    .log-load-more { width: 100%; padding: .45rem; background: none; border: 1.5px solid #e5e7eb; border-radius: 6px; font-size: .78rem; font-weight: 600; color: #6b7280; cursor: pointer; margin-top: .4rem; }
    .log-load-more:hover { border-color: #9ca3af; color: #374151; }
    /* Modal */
    .modal-overlay { display: none; position: fixed; inset: 0; background: rgba(0,0,0,.45); z-index: 100; align-items: center; justify-content: center; padding: 1.5rem; }
    .modal-overlay.open { display: flex; }
    .modal { background: #fff; border-radius: 12px; max-width: 600px; width: 100%; max-height: 80vh; display: flex; flex-direction: column; box-shadow: 0 8px 32px rgba(0,0,0,.18); }
    .modal-header { display: flex; align-items: center; justify-content: space-between; padding: 1rem 1.25rem .75rem; border-bottom: 1.5px solid #e5e7eb; flex-shrink: 0; }
    .modal-title { font-size: .95rem; font-weight: 700; color: #1a1a1a; }
    .modal-close { background: none; border: none; font-size: 1.25rem; line-height: 1; color: #9ca3af; cursor: pointer; padding: 0 .25rem; }
    .modal-close:hover { color: #374151; }
    .modal-body { overflow-y: auto; padding: 1rem 1.25rem; display: flex; flex-direction: column; gap: .75rem; }
    .modal-row { display: flex; flex-direction: column; gap: .2rem; }
    .modal-label { font-size: .72rem; font-weight: 700; color: #9ca3af; text-transform: uppercase; letter-spacing: .04em; }
    .modal-value { font-size: .85rem; color: #1a1a1a; word-break: break-all; }
    .modal-pre { background: #f3f4f6; border-radius: 6px; padding: .6rem .8rem; font-size: .78rem; font-family: monospace; color: #374151; white-space: pre-wrap; word-break: break-all; margin: 0; max-height: 14rem; overflow-y: auto; }

    /* Advanced settings */
    details { margin-top: 1.5rem; border: 1.5px solid #e5e7eb; border-radius: 8px; }
    summary { padding: .65rem .9rem; font-size: .85rem; font-weight: 600; color: #6b7280; cursor: pointer; user-select: none; list-style: none; display: flex; align-items: center; gap: .4rem; }
    summary::-webkit-details-marker { display: none; }
    summary::before { content: '\\203A'; display: inline-block; transition: transform .15s; font-size: 1rem; line-height: 1; }
    details[open] summary::before { transform: rotate(90deg); }
    summary:hover { color: #374151; }
    .advanced-body { padding: .75rem .9rem 1rem; border-top: 1.5px solid #e5e7eb; display: flex; flex-direction: column; gap: 1.25rem; }
    textarea { width: 100%; padding: .6rem .8rem; border: 1.5px solid #ddd; border-radius: 8px; font-size: .88rem; font-family: inherit; color: #1a1a1a; outline: none; resize: vertical; transition: border-color .15s; box-sizing: border-box; }
    textarea:focus { border-color: #2563eb; }
    .kv-editor { display: flex; flex-direction: column; gap: .4rem; }
    .kv-row { display: grid; grid-template-columns: 1fr 1.5fr auto; gap: .4rem; align-items: center; }
    .kv-row input { min-width: 0; }
    .kv-remove { background: none; border: 1.5px solid #e5e7eb; border-radius: 6px; font-size: 1rem; color: #9ca3af; cursor: pointer; padding: .25rem .45rem; line-height: 1; }
    .kv-remove:hover { border-color: #fca5a5; color: #dc2626; }
    .kv-add { background: none; border: 1.5px dashed #d1d5db; border-radius: 6px; font-size: .8rem; font-weight: 600; color: #6b7280; cursor: pointer; padding: .35rem .6rem; align-self: flex-start; margin-top: .15rem; }
    .kv-add:hover { border-color: #9ca3af; color: #374151; }
    .kv-col-headers { display: grid; grid-template-columns: 1fr 1.5fr auto; gap: .4rem; padding-bottom: .1rem; }
    .kv-col-header { font-size: .72rem; font-weight: 700; color: #9ca3af; text-transform: uppercase; letter-spacing: .04em; }
  </style>
</head>
<body>
  <div class="card">
    <a class="back" href="/">← Back</a>
    <div class="page-header">
      <div class="page-header-left">
        <h1>Project settings</h1>
        <span class="uid-badge">${uid}</span>
      </div>
      <div class="save-row">
        <div class="status-msg" id="status-msg"></div>
        <button type="button" class="save-btn" id="save-btn" onclick="save()">Save</button>
      </div>
    </div>

    <details id="advanced">
      <summary>Advanced settings</summary>
      <div class="advanced-body">
        <div>
          <label for="forward-url">Forwarding URL<span class="label-hint">optional — relay submissions to another service</span></label>
          <input id="forward-url" type="url" placeholder="https://your-service.example.com/webhook" autocomplete="off" spellcheck="false" />
        </div>
        <div>
          <label for="forward-token">Bearer token<span class="label-hint">optional — sent as Authorization: Bearer &lt;token&gt;</span></label>
          <input id="forward-token" type="password" placeholder="••••••••••••••••" autocomplete="off" spellcheck="false" />
        </div>
        <div>
          <label>Append to payload<span class="label-hint">static key-value pairs added under <code style="font-family:monospace;background:#f3f4f6;padding:.05em .25em;border-radius:3px;font-size:.9em">_metadata</code> in the forwarded JSON — e.g. context=mozambique</span></label>
          <div class="kv-col-headers"><span class="kv-col-header">Key</span><span class="kv-col-header">Value</span><span></span></div>
          <div class="kv-editor" id="kv-editor"></div>
          <button type="button" class="kv-add" onclick="addKVRow()">+ Add field</button>
        </div>
        <div>
          <label for="transcribe-prompt"><svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:.3rem"><path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/><path d="M20 3v4"/><path d="M22 5h-4"/><path d="M4 17v2"/><path d="M5 18H3"/></svg>Transcription instruction<span class="label-hint">optional — context hint sent to OpenAI to guide transcription</span></label>
          <textarea id="transcribe-prompt" rows="2" placeholder="e.g. The speaker may use field-specific terminology such as GPS coordinates and village names."></textarea>
        </div>
        <div>
          <label for="transcribe-translate"><svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:.3rem"><path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/><path d="M20 3v4"/><path d="M22 5h-4"/><path d="M4 17v2"/><path d="M5 18H3"/></svg>Translate transcript to<span class="label-hint">optional — translate every transcript into this language</span></label>
          <select id="transcribe-translate">
            <option value="">No translation</option>
            <option value="English">English</option>
            <option value="French">French</option>
            <option value="Spanish">Spanish</option>
            <option value="Arabic">Arabic</option>
            <option value="Portuguese">Portuguese</option>
            <option value="Russian">Russian</option>
            <option value="Chinese (Simplified)">Chinese (Simplified)</option>
            <option value="Turkish">Turkish</option>
            <option value="German">German</option>
            <option value="Italian">Italian</option>
            <option value="Ukrainian">Ukrainian</option>
            <option value="Swahili">Swahili</option>
            <option value="Hausa">Hausa</option>
            <option value="Somali">Somali</option>
            <option value="Dari">Dari</option>
            <option value="Pashto">Pashto</option>
            <option value="Burmese">Burmese</option>
          </select>
        </div>
        <div>
          <label for="describe-prompt"><svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:.3rem"><path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/><path d="M20 3v4"/><path d="M22 5h-4"/><path d="M4 17v2"/><path d="M5 18H3"/></svg>Image description instruction<span class="label-hint">optional — prompt sent to OpenAI with each image</span></label>
          <textarea id="describe-prompt" rows="2" placeholder="e.g. Describe this image concisely and factually. Focus on visible damage, location features, and any text present."></textarea>
        </div>
        <div>
          <label>Forward media types<span class="label-hint">which attachment types to forward as binary files — all types forwarded if none checked</span></label>
          <div style="display:flex;flex-wrap:wrap;gap:.5rem .9rem;margin-top:.3rem">
            <label class="checkbox-row"><input type="checkbox" name="fwd-media" value="image" /><span>Images</span></label>
            <label class="checkbox-row"><input type="checkbox" name="fwd-media" value="audio" /><span>Audio</span></label>
            <label class="checkbox-row"><input type="checkbox" name="fwd-media" value="video" /><span>Video</span></label>
            <label class="checkbox-row"><input type="checkbox" name="fwd-media" value="application" /><span>Files (PDF, etc.)</span></label>
          </div>
        </div>
      </div>
    </details>

    <div>
      <div id="survey-status" class="survey-status"></div>
      <div class="field-list-header">
        <label style="margin-bottom:0">Fields subset<span class="label-hint">optional — uncheck fields to exclude them</span></label>
        <span style="display:flex;gap:.4rem;align-items:center;flex-shrink:0">
          <span id="fields-count" class="fields-count"></span>
          <button type="button" class="select-btn" onclick="selectAllFields()">Select all</button>
          <button type="button" class="select-btn" onclick="deselectAllFields()">Deselect all</button>
          <button type="button" class="fields-toggle" id="fields-toggle" onclick="toggleFieldsList()" title="Show/hide fields">&#9660;</button>
        </span>
      </div>
      <div id="fields-list" class="question-list-box"></div>
    </div>

    <div class="log-header">
      <button type="button" class="log-title-btn" id="log-toggle" onclick="toggleLog()"><svg class="log-chevron" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>Submission log</button>
      <div class="log-actions">
        <button type="button" class="log-refresh-btn" onclick="refreshLogs(true)">Refresh</button>
      </div>
    </div>
    <div class="log-body" id="log-body">
      <div class="log-scroll" id="log-scroll">
        <div id="logs-container"><p class="log-empty">Loading&hellip;</p></div>
      </div>
    </div>
  </div>

  <div class="modal-overlay" id="log-modal" onclick="closeModal(event)">
    <div class="modal">
      <div class="modal-header">
        <span class="modal-title" id="modal-title">Submission detail</span>
        <button type="button" class="modal-close" onclick="document.getElementById('log-modal').classList.remove('open')">&times;</button>
      </div>
      <div class="modal-body" id="modal-body"></div>
    </div>
  </div>

  <script>
    const UID = ${raw(JSON.stringify(uid))};
    const SPARKLE_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/><path d="M20 3v4"/><path d="M22 5h-4"/><path d="M4 17v2"/><path d="M5 18H3"/></svg>';
    let allQuestions = [];      // { xpath, label, type }[]
    let configFields = [];      // persisted fields subset
    let configTranscribeQs = []; // persisted transcribe xpath list
    let configDescribeQs = [];   // persisted describe xpath list

    // ── Rendering ────────────────────────────────────────────────────────────
    function renderFieldsList() {
      const list = document.getElementById('fields-list');
      if (allQuestions.length === 0) return;
      const hasFilter = configFields.length > 0;
      // _uuid is always first and always locked
      const uuidRow = '<label class="question-item"><input type="checkbox" name="field-locked" value="_uuid" checked disabled style="accent-color:#93c5fd;cursor:not-allowed" /><span class="q-label" style="color:#9ca3af">_uuid</span><span style="font-size:.72rem;color:#d1d5db;margin-left:.4rem">(always included)</span></label>';
      list.innerHTML = uuidRow + allQuestions.map(q => {
        const checked = (!hasFilter || configFields.includes(q.xpath)) ? ' checked' : '';
        const xpathSpan = (q.label !== q.xpath)
          ? '<span class="q-xpath">' + escHtml(q.xpath) + '</span>' : '';
        const mainRow = '<label class="question-item"><input type="checkbox" name="field" value="' +
          escHtml(q.xpath) + '"' + checked + '/><span class="q-label">' +
          escHtml(q.label) + '</span>' + xpathSpan + '</label>';
        let subRow = '';
        if (q.type === 'audio') {
          const tChecked = configTranscribeQs.includes(q.xpath) ? ' checked' : '';
          subRow = '<label class="question-sub-item"><input type="checkbox" name="transcribe-q" value="' +
            escHtml(q.xpath) + '"' + tChecked + '/>' + SPARKLE_SVG + '<span>Transcribe</span>' +
            '<span class="q-output">\u2192 ' + escHtml(q.xpath) + '_transcript</span></label>';
        } else if (q.type === 'image' || q.type === 'photo') {
          const dChecked = configDescribeQs.includes(q.xpath) ? ' checked' : '';
          subRow = '<label class="question-sub-item"><input type="checkbox" name="describe-q" value="' +
            escHtml(q.xpath) + '"' + dChecked + '/>' + SPARKLE_SVG + '<span>Describe</span>' +
            '<span class="q-output">\u2192 ' + escHtml(q.xpath) + '_description</span></label>';
        }
        return subRow ? '<div>' + mainRow + subRow + '</div>' : mainRow;
      }).join('');
      updateFieldsCount();
    }

    function getSelectedFields() {
      return Array.from(document.querySelectorAll('#fields-list input[name="field"]:checked')).map(cb => cb.value);
    }

    function getSelectedAudioQs() {
      return Array.from(document.querySelectorAll('#fields-list input[name="transcribe-q"]:checked')).map(cb => cb.value);
    }

    function getSelectedImageQs() {
      return Array.from(document.querySelectorAll('#fields-list input[name="describe-q"]:checked')).map(cb => cb.value);
    }

    function selectAllFields() {
      document.querySelectorAll('#fields-list input[name="field"]').forEach(cb => { cb.checked = true; });
      updateFieldsCount();
    }

    function deselectAllFields() {
      document.querySelectorAll('#fields-list input[name="field"]').forEach(cb => { cb.checked = false; });
      updateFieldsCount();
    }

    function updateFieldsCount() {
      const total = document.querySelectorAll('#fields-list input[name="field"]').length;
      const checked = document.querySelectorAll('#fields-list input[name="field"]:checked').length;
      const badge = document.getElementById('fields-count');
      badge.textContent = total > 0 ? checked + ' / ' + total : '';
    }

    function toggleFieldsList() {
      const list = document.getElementById('fields-list');
      const btn = document.getElementById('fields-toggle');
      const hidden = list.style.display === 'none';
      list.style.display = hidden ? '' : 'none';
      btn.innerHTML = hidden ? '&#9660;' : '&#9654;';
    }

    document.getElementById('fields-list').addEventListener('change', updateFieldsCount);

    // ── Survey load (auto on page load) ──────────────────────────────────────
    async function loadSurvey() {
      const statusEl = document.getElementById('survey-status');
      statusEl.className = 'survey-status';
      statusEl.innerHTML = '<span class="spinner"></span><span>Loading form questions\u2026</span>';
      try {
        const res = await fetch('/api/configure/survey/' + UID);
        if (!res.ok) {
          const d = await res.json().catch(() => ({}));
          statusEl.className = 'survey-status error';
          statusEl.textContent = 'Could not load questions: ' + (d.error ?? res.status);
          return;
        }
        const data = await res.json();
        allQuestions = data.questions ?? [];
        statusEl.className = 'survey-status';
        statusEl.textContent = '';
        renderFieldsList();
      } catch {
        statusEl.className = 'survey-status error';
        statusEl.textContent = 'Could not load form questions.';
      }
    }

    // ── Key-value editor for payload append ──────────────────────────────────
    function kvRowHtml(key, value) {
      return '<div class="kv-row">' +
        '<input type="text" class="kv-key" placeholder="key" value="' + escHtml(key ?? '') + '" autocomplete="off" spellcheck="false" />' +
        '<input type="text" class="kv-val" placeholder="value" value="' + escHtml(value ?? '') + '" autocomplete="off" spellcheck="false" />' +
        '<button type="button" class="kv-remove" onclick="this.parentElement.remove()" title="Remove">&times;</button>' +
        '</div>';
    }
    function renderKVEditor(pairs) {
      document.getElementById('kv-editor').innerHTML = (pairs || []).map(function(p) { return kvRowHtml(p.key, p.value); }).join('');
    }
    function addKVRow() {
      document.getElementById('kv-editor').insertAdjacentHTML('beforeend', kvRowHtml('', ''));
    }
    function getAppendValues() {
      return Array.from(document.querySelectorAll('#kv-editor .kv-row')).reduce(function(acc, row) {
        var key = row.querySelector('.kv-key').value.trim();
        var value = row.querySelector('.kv-val').value.trim();
        if (key) acc.push({ key: key, value: value });
        return acc;
      }, []);
    }

    // ── Load current config ───────────────────────────────────────────────────
    async function loadConfig() {
      try {
        const res = await fetch('/api/configure/project/' + UID);
        if (!res.ok) return;
        const data = await res.json();
        const fwdUrl = data.forwardUrl ?? '';
        document.getElementById('forward-url').value = fwdUrl;
        document.getElementById('forward-token').value = data.forwardToken ?? '';
        if (data.transcribe?.prompt) {
          document.getElementById('transcribe-prompt').value = data.transcribe.prompt;
        }
        if (data.transcribe?.translateTo) {
          document.getElementById('transcribe-translate').value = data.transcribe.translateTo;
        }
        if (data.describe?.prompt) {
          document.getElementById('describe-prompt').value = data.describe.prompt;
        }
        if (Array.isArray(data.forwardMedia) && data.forwardMedia.length > 0) {
          document.querySelectorAll('input[name="fwd-media"]').forEach(cb => {
            cb.checked = data.forwardMedia.includes(cb.value);
          });
        }
        configFields = Array.isArray(data.fields) ? data.fields : [];
        if (data.transcribe && Array.isArray(data.transcribe.questions)) {
          configTranscribeQs = data.transcribe.questions;
        }
        if (data.describe && Array.isArray(data.describe.questions)) {
          configDescribeQs = data.describe.questions;
        }
        renderKVEditor(Array.isArray(data.appendValues) ? data.appendValues : []);
      } catch {}
    }

    // ── Save ──────────────────────────────────────────────────────────────────
    async function save() {
      const forwardUrl = document.getElementById('forward-url').value.trim();
      const forwardToken = document.getElementById('forward-token').value.trim();
      const appendValues = getAppendValues();
      const checkedMedia = Array.from(document.querySelectorAll('input[name="fwd-media"]:checked')).map(cb => cb.value);
      // null = forward all; array = restrict to checked types
      const forwardMedia = checkedMedia.length > 0 ? checkedMedia : null;
      const selected = getSelectedFields();
      // _uuid is always included; treat "every non-locked question checked" as "forward all" (empty array)
      const allChecked = allQuestions.length > 0 && selected.length === allQuestions.length;
      const fields = allChecked ? [] : ['_uuid', ...selected.filter(f => f !== '_uuid')];
      const selectedAudio = getSelectedAudioQs();
      const transcribePrompt = document.getElementById('transcribe-prompt').value.trim();
      const transcribeTranslate = document.getElementById('transcribe-translate').value.trim();
      const transcribe = selectedAudio.length > 0
        ? {
            questions: selectedAudio,
            ...(transcribePrompt ? { prompt: transcribePrompt } : {}),
            ...(transcribeTranslate ? { translateTo: transcribeTranslate } : {}),
          }
        : null;
      const selectedImages = getSelectedImageQs();
      const describePrompt = document.getElementById('describe-prompt').value.trim();
      const describe = selectedImages.length > 0
        ? { questions: selectedImages, ...(describePrompt ? { prompt: describePrompt } : {}) }
        : null;
      const btn = document.getElementById('save-btn');
      btn.disabled = true;
      setStatus('', '');
      try {
        const res = await fetch('/api/configure/project/' + UID, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ forwardUrl, forwardToken, fields, transcribe, describe, forwardMedia, appendValues }),
        });
        if (res.ok) {
          setStatus('success', '\u2713 Saved');
        } else {
          const data = await res.json();
          setStatus('error', 'Error: ' + (data.error ?? res.status));
        }
      } catch (err) {
        setStatus('error', 'Network error: ' + err.message);
      }
      btn.disabled = false;
    }

    function setStatus(type, msg) {
      const el = document.getElementById('status-msg');
      el.className = 'status-msg' + (type ? ' ' + type : '');
      el.textContent = msg;
    }

    function escHtml(str) {
      return String(str)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    // ── Submission log ────────────────────────────────────────────────────────
    const LOG_PAGE = 10;
    let logEntries = [];
    let logOffset = 0;
    let logHasMore = false;
    let logCollapsed = false;

    function toggleLog() {
      logCollapsed = !logCollapsed;
      document.getElementById('log-body').style.display = logCollapsed ? 'none' : '';
      document.getElementById('log-toggle').classList.toggle('collapsed', logCollapsed);
    }

    function openLogDetail(idx) {
      const e = logEntries[idx];
      if (!e) return;
      const d = new Date(e.ts);
      const timeStr = d.toLocaleString();
      let rows = '';
      rows += '<div class="modal-row"><span class="modal-label">Time</span><span class="modal-value">' + escHtml(timeStr) + '</span></div>';
      if (e.uuid) rows += '<div class="modal-row"><span class="modal-label">UUID</span><span class="modal-value">' + escHtml(e.uuid) + '</span></div>';
      if (e.id != null) rows += '<div class="modal-row"><span class="modal-label">Submission ID</span><span class="modal-value">' + escHtml(String(e.id)) + '</span></div>';
      rows += '<div class="modal-row"><span class="modal-label">Result</span><span class="modal-value">' + (e.ok ? '\u2713 Success' : '\u2717 Failed') + '</span></div>';
      if (e.httpStatus != null) rows += '<div class="modal-row"><span class="modal-label">HTTP Status</span><span class="modal-value">HTTP ' + escHtml(String(e.httpStatus)) + '</span></div>';
      if (e.error) rows += '<div class="modal-row"><span class="modal-label">Error</span><pre class="modal-pre">' + escHtml(e.error) + '</pre></div>';
      if (e.responseBody) {
        let pretty = e.responseBody;
        try { pretty = JSON.stringify(JSON.parse(e.responseBody), null, 2); } catch {}
        rows += '<div class="modal-row"><span class="modal-label">Response body</span><pre class="modal-pre">' + escHtml(pretty) + (e.responseBody.length >= 2048 ? '\\n\u2026 (truncated at 2 KB)' : '') + '</pre></div>';
      }
      document.getElementById('modal-title').textContent = e.ok ? '\u2713 Submission forwarded' : '\u2717 Forwarding failed';
      document.getElementById('modal-body').innerHTML = rows;
      document.getElementById('log-modal').classList.add('open');
    }

    function closeModal(event) {
      const overlay = document.getElementById('log-modal');
      if (event.target === overlay) overlay.classList.remove('open');
    }

    function renderLogRows(entries, startIdx) {
      return entries.map(function(e, i) {
        const idx = startIdx + i;
        const d = new Date(e.ts);
        const timeStr = d.toLocaleDateString(undefined, {month:'short',day:'numeric'}) + ' ' +
          d.toLocaleTimeString(undefined, {hour:'2-digit',minute:'2-digit',second:'2-digit'});
        const badge = e.ok
          ? '<span class="log-badge ok">\u2713 OK</span>'
          : '<span class="log-badge fail">\u2717 Failed</span>';
        const httpCell = e.httpStatus != null ? escHtml(String(e.httpStatus)) : '\u2014';
        const subId = escHtml(e.uuid ? e.uuid.slice(0, 8) + '\u2026' : (e.id != null ? String(e.id) : '\u2014'));
        return '<tr>' +
          '<td>' + escHtml(timeStr) + '</td>' +
          '<td title="' + escHtml(e.uuid ?? '') + '">' + subId + '</td>' +
          '<td>' + badge + '</td>' +
          '<td style="color:#6b7280">' + httpCell + '</td>' +
          '<td><button type="button" class="log-detail-btn" onclick="openLogDetail(' + idx + ')">Details</button></td>' +
          '</tr>';
      }).join('');
    }

    async function loadMoreLogs() {
      const btn = document.getElementById('log-more-btn');
      if (btn) btn.disabled = true;
      try {
        const res = await fetch('/api/logs/' + UID + '?offset=' + logOffset + '&limit=' + LOG_PAGE);
        if (!res.ok) return;
        const data = await res.json();
        const page = Array.isArray(data.entries) ? data.entries : [];
        logHasMore = !!data.hasMore;
        const startIdx = logEntries.length;
        logEntries = logEntries.concat(page);
        logOffset = logEntries.length;
        // append rows to existing tbody
        const tbody = document.querySelector('#logs-container tbody');
        if (tbody) tbody.insertAdjacentHTML('beforeend', renderLogRows(page, startIdx));
        // update or remove load-more button
        const existing = document.getElementById('log-more-btn');
        if (existing) existing.remove();
        if (logHasMore) {
          document.getElementById('logs-container').insertAdjacentHTML('beforeend',
            '<button type="button" class="log-load-more" id="log-more-btn" onclick="loadMoreLogs()">Load more</button>');
        }
      } catch {}
    }

    async function refreshLogs(reset) {
      if (reset) { logEntries = []; logOffset = 0; logHasMore = false; }
      const container = document.getElementById('logs-container');
      container.innerHTML = '';
      try {
        const res = await fetch('/api/logs/' + UID + '?offset=0&limit=' + LOG_PAGE);
        if (!res.ok) { container.innerHTML = '<p class="log-empty">Could not load logs.</p>'; return; }
        const data = await res.json();
        const page = Array.isArray(data.entries) ? data.entries : [];
        logHasMore = !!data.hasMore;
        logEntries = page;
        logOffset = page.length;
        if (logEntries.length === 0) {
          container.innerHTML = '<p class="log-empty">No submissions logged yet.</p>';
          return;
        }
        container.innerHTML =
          '<table class="log-table"><thead><tr>' +
          '<th>Time</th><th>Submission ID</th><th>Status</th><th>HTTP</th><th></th>' +
          '</tr></thead><tbody>' + renderLogRows(logEntries, 0) + '</tbody></table>';
        if (logHasMore) {
          container.insertAdjacentHTML('beforeend',
            '<button type="button" class="log-load-more" id="log-more-btn" onclick="loadMoreLogs()">Load more</button>');
        }
      } catch {
        container.innerHTML = '<p class="log-empty">Could not load logs.</p>';
      }
    }

    (async () => { await loadConfig(); loadSurvey(); refreshLogs(true); })();
  </script>
</body>
</html>`
  );
});

export default ui;
