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

    <button class="action-btn" id="setup-btn" onclick="setupIntegration()">Set up integration</button>

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

    <button class="continue-btn" id="continue-btn" onclick="goToProject()">Configure project &rarr;</button>
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
    .uid-badge { font-family: monospace; font-size: .78rem; background: #f3f4f6; color: #555; padding: .2rem .55rem; border-radius: 5px; display: inline-block; margin-bottom: 1.75rem; }
    .fields { display: flex; flex-direction: column; gap: 1.25rem; }
    label { display: block; font-size: .85rem; font-weight: 600; color: #444; margin-bottom: .4rem; }
    .label-hint { font-size: .75rem; font-weight: 400; color: #9ca3af; margin-left: .4rem; }
    input[type="url"] { width: 100%; padding: .6rem .8rem; border: 1.5px solid #ddd; border-radius: 8px; font-size: .95rem; outline: none; transition: border-color .15s; }
    input[type="url"]:focus { border-color: #2563eb; }

    /* Tag input */
    .tag-box { display: flex; flex-wrap: wrap; gap: .4rem; padding: .55rem .7rem; border: 1.5px solid #ddd; border-radius: 8px; cursor: text; transition: border-color .15s; min-height: 2.8rem; align-items: flex-start; }
    .tag-box:focus-within { border-color: #2563eb; }
    .tag { display: inline-flex; align-items: center; gap: .3rem; background: #e5e7eb; color: #374151; font-size: .82rem; padding: .2rem .55rem; border-radius: 5px; }
    .tag-remove { background: none; border: none; cursor: pointer; color: #6b7280; font-size: .85rem; line-height: 1; padding: 0 .1rem; }
    .tag-remove:hover { color: #111; }
    .tag-input { border: none; outline: none; font-size: .9rem; background: transparent; padding: .1rem .1rem; min-width: 120px; flex: 1; color: #1a1a1a; }
    .tag-input::placeholder { color: #9ca3af; }

    .save-btn { margin-top: .75rem; width: 100%; padding: .7rem; background: #2563eb; color: #fff; border: none; border-radius: 8px; font-size: 1rem; font-weight: 600; cursor: pointer; transition: background .15s; }
    .save-btn:hover { background: #1d4ed8; }
    .save-btn:disabled { background: #93c5fd; cursor: not-allowed; }
    .status-msg { margin-top: .9rem; font-size: .85rem; text-align: center; min-height: 1.2rem; }
    .status-msg.success { color: #15803d; }
    .status-msg.error { color: #dc2626; }

    /* Advanced settings */
    details { margin-top: 1.5rem; border: 1.5px solid #e5e7eb; border-radius: 8px; }
    summary { padding: .65rem .9rem; font-size: .85rem; font-weight: 600; color: #6b7280; cursor: pointer; user-select: none; list-style: none; display: flex; align-items: center; gap: .4rem; }
    summary::-webkit-details-marker { display: none; }
    summary::before { content: '\\203A'; display: inline-block; transition: transform .15s; font-size: 1rem; line-height: 1; }
    details[open] summary::before { transform: rotate(90deg); }
    summary:hover { color: #374151; }
    .advanced-body { padding: .75rem .9rem 1rem; border-top: 1.5px solid #e5e7eb; display: flex; flex-direction: column; gap: 1.25rem; }
  </style>
</head>
<body>
  <div class="card">
    <a class="back" href="/">← Back</a>
    <h1>Project settings</h1>
    <span class="uid-badge">${uid}</span>

    <div class="fields">
      <div>
        <label>Fields subset<span class="label-hint">optional — leave empty to forward all fields</span></label>
        <div class="tag-box" id="tag-box" onclick="document.getElementById('tag-input').focus()">
          <input class="tag-input" id="tag-input" type="text" placeholder="Add field(s)" autocomplete="off" spellcheck="false" />
        </div>
      </div>
    </div>

    <details id="advanced">
      <summary>Advanced settings</summary>
      <div class="advanced-body">
        <div>
          <label for="forward-url">Forwarding URL<span class="label-hint">optional — relay submissions to another service</span></label>
          <input id="forward-url" type="url" placeholder="https://your-service.example.com/webhook" autocomplete="off" spellcheck="false" />
        </div>
      </div>
    </details>

    <button class="save-btn" id="save-btn" onclick="save()">Save</button>
    <div class="status-msg" id="status-msg"></div>
  </div>

  <script>
    const UID = ${raw(JSON.stringify(uid))};
    let fields = [];

    // ── Tag input ─────────────────────────────────────────────────────────────
    const tagBox = document.getElementById('tag-box');
    const tagInput = document.getElementById('tag-input');

    function addTag(value) {
      const trimmed = value.trim().replace(/,+$/, '');
      if (!trimmed || fields.includes(trimmed)) return;
      fields.push(trimmed);
      renderTags();
    }

    function removeTag(index) {
      fields.splice(index, 1);
      renderTags();
    }

    function renderTags() {
      // Remove existing tag elements (keep the input)
      Array.from(tagBox.querySelectorAll('.tag')).forEach(el => el.remove());
      fields.forEach((f, i) => {
        const tag = document.createElement('span');
        tag.className = 'tag';
        tag.innerHTML =
          escHtml(f) +
          '<button class="tag-remove" type="button" aria-label="Remove">\u00d7</button>';
        tag.querySelector('button').addEventListener('click', () => removeTag(i));
        tagBox.insertBefore(tag, tagInput);
      });
    }

    tagInput.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ',') {
        e.preventDefault();
        addTag(tagInput.value);
        tagInput.value = '';
      } else if (e.key === 'Backspace' && tagInput.value === '' && fields.length > 0) {
        fields.pop();
        renderTags();
      }
    });

    tagInput.addEventListener('blur', () => {
      if (tagInput.value.trim()) {
        addTag(tagInput.value);
        tagInput.value = '';
      }
    });

    // ── Load current config ───────────────────────────────────────────────────
    async function loadConfig() {
      try {
        const res = await fetch('/api/configure/project/' + UID);
        if (!res.ok) return;
        const data = await res.json();
        const fwdUrl = data.forwardUrl ?? '';
        document.getElementById('forward-url').value = fwdUrl;
        if (fwdUrl) document.getElementById('advanced').open = true;
        fields = Array.isArray(data.fields) ? data.fields : [];
        renderTags();
      } catch {}
    }

    // ── Save ──────────────────────────────────────────────────────────────────
    async function save() {
      const forwardUrl = document.getElementById('forward-url').value.trim();
      // Flush any partially typed tag
      if (tagInput.value.trim()) {
        addTag(tagInput.value);
        tagInput.value = '';
      }
      const btn = document.getElementById('save-btn');
      btn.disabled = true;
      setStatus('', '');
      try {
        const res = await fetch('/api/configure/project/' + UID, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ forwardUrl, fields }),
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

    loadConfig();
  </script>
</body>
</html>`
  );
});

export default ui;
