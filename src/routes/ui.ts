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
    .question-list-box { max-height: 9.5rem; overflow-y: auto; border: 1.5px solid #e5e7eb; border-radius: 8px; padding: .4rem .6rem; display: flex; flex-direction: column; gap: .2rem; }
    .question-item { display: flex; align-items: baseline; gap: .5rem; font-size: .85rem; cursor: pointer; padding: .15rem 0; }
    .question-item input[type="checkbox"] { width: 1rem; height: 1rem; cursor: pointer; accent-color: #2563eb; flex-shrink: 0; margin-top: .1rem; }
    .question-item .q-label { font-weight: 500; color: #374151; }
    .question-item .q-xpath { font-family: monospace; font-size: .76rem; color: #9ca3af; }
    .question-item .q-output { font-family: monospace; font-size: .76rem; color: #d1d5db; margin-left: auto; }

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
    textarea { width: 100%; padding: .6rem .8rem; border: 1.5px solid #ddd; border-radius: 8px; font-size: .88rem; font-family: inherit; color: #1a1a1a; outline: none; resize: vertical; transition: border-color .15s; box-sizing: border-box; }
    textarea:focus { border-color: #2563eb; }
  </style>
</head>
<body>
  <div class="card">
    <a class="back" href="/">← Back</a>
    <h1>Project settings</h1>
    <span class="uid-badge">${uid}</span>

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
          <label for="transcribe-prompt">Transcription instruction<span class="label-hint">optional — context hint sent to OpenAI to guide transcription</span></label>
          <textarea id="transcribe-prompt" rows="2" placeholder="e.g. The speaker may use field-specific terminology such as GPS coordinates and village names."></textarea>
        </div>
        <div>
          <label for="describe-prompt">Image description instruction<span class="label-hint">optional — prompt sent to OpenAI with each image</span></label>
          <textarea id="describe-prompt" rows="2" placeholder="e.g. Describe this image concisely and factually. Focus on visible damage, location features, and any text present."></textarea>
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

    <div class="transcribe-section">
      <label class="checkbox-row" for="transcribe-enabled">
        <input type="checkbox" id="transcribe-enabled" onchange="toggleTranscribe()" />
        <span>Transcribe audio</span>
      </label>
      <div id="transcribe-sub" class="transcribe-sub" style="display:none">
        <div>
          <label>Audio questions</label>
          <div id="audio-list" class="question-list"></div>
          <div class="load-status" id="audio-load-status"></div>
        </div>
        <!-- Model selector hidden for now; defaults to gpt-4o-mini-transcribe
        <div>
          <label for="transcribe-model">Model</label>
          <select id="transcribe-model">
            <option value="gpt-4o-mini-transcribe">gpt-4o-mini-transcribe</option>
            <option value="gpt-4o-transcribe">gpt-4o-transcribe</option>
          </select>
        </div>
        -->
      </div>
    </div>

    <div class="transcribe-section">
      <label class="checkbox-row" for="describe-enabled">
        <input type="checkbox" id="describe-enabled" onchange="toggleDescribe()" />
        <span>Describe images</span>
      </label>
      <div id="describe-sub" class="transcribe-sub" style="display:none">
        <div>
          <label>Image questions</label>
          <div id="image-list" class="question-list"></div>
          <div class="load-status" id="image-load-status"></div>
        </div>
        <!-- Model selector hidden for now; defaults to gpt-4o-mini
        <div>
          <label for="describe-model">Model</label>
          <select id="describe-model">
            <option value="gpt-4o-mini">gpt-4o-mini</option>
            <option value="gpt-4o">gpt-4o</option>
          </select>
        </div>
        -->
      </div>
    </div>

    <button class="save-btn" id="save-btn" onclick="save()">Save</button>
    <div class="status-msg" id="status-msg"></div>
  </div>

  <script>
    const UID = ${raw(JSON.stringify(uid))};
    let allQuestions = [];      // { xpath, label, type }[]
    let configFields = [];      // persisted fields subset
    let configTranscribeQs = []; // persisted transcribe xpath list
    let configDescribeQs = [];   // persisted describe xpath list

    // ── Rendering ────────────────────────────────────────────────────────────
    function renderFieldsList() {
      const list = document.getElementById('fields-list');
      if (allQuestions.length === 0) return;
      const hasFilter = configFields.length > 0;
      list.innerHTML = allQuestions.map(q => {
        const checked = (!hasFilter || configFields.includes(q.xpath)) ? ' checked' : '';
        const xpathSpan = (q.label !== q.xpath)
          ? '<span class="q-xpath">' + escHtml(q.xpath) + '</span>' : '';
        return '<label class="question-item"><input type="checkbox" name="field" value="' +
          escHtml(q.xpath) + '"' + checked + '/><span class="q-label">' +
          escHtml(q.label) + '</span>' + xpathSpan + '</label>';
      }).join('');
      updateFieldsCount();
    }

    function renderAudioList() {
      const list = document.getElementById('audio-list');
      const status = document.getElementById('audio-load-status');
      const audioQs = allQuestions.filter(q => q.type === 'audio');
      if (audioQs.length === 0) {
        list.innerHTML = '';
        status.textContent = allQuestions.length > 0 ? 'No audio questions in this form.' : '';
        return;
      }
      status.textContent = '';
      const hasFilter = configTranscribeQs.length > 0;
      list.innerHTML = audioQs.map(q => {
        const checked = (!hasFilter || configTranscribeQs.includes(q.xpath)) ? ' checked' : '';
        return '<label class="question-item"><input type="checkbox" name="audio-q" value="' +
          escHtml(q.xpath) + '"' + checked + '/><span class="q-label">' + escHtml(q.label) +
          '</span><span class="q-xpath">' + escHtml(q.xpath) +
          '</span><span class="q-output">\u2192 ' + escHtml(q.xpath) + '_transcript</span></label>';
      }).join('');
    }

    function renderImageList() {
      const list = document.getElementById('image-list');
      const status = document.getElementById('image-load-status');
      const imageQs = allQuestions.filter(q => q.type === 'image' || q.type === 'photo');
      if (imageQs.length === 0) {
        list.innerHTML = '';
        status.textContent = allQuestions.length > 0 ? 'No image questions in this form.' : '';
        return;
      }
      status.textContent = '';
      const hasFilter = configDescribeQs.length > 0;
      list.innerHTML = imageQs.map(q => {
        const checked = (!hasFilter || configDescribeQs.includes(q.xpath)) ? ' checked' : '';
        return '<label class="question-item"><input type="checkbox" name="image-q" value="' +
          escHtml(q.xpath) + '"' + checked + '/><span class="q-label">' + escHtml(q.label) +
          '</span><span class="q-xpath">' + escHtml(q.xpath) +
          '</span><span class="q-output">\u2192 ' + escHtml(q.xpath) + '_description</span></label>';
      }).join('');
    }

    function getSelectedFields() {
      return Array.from(document.querySelectorAll('#fields-list input[type="checkbox"]:checked')).map(cb => cb.value);
    }

    function getSelectedAudioQs() {
      return Array.from(document.querySelectorAll('#audio-list input[type="checkbox"]:checked')).map(cb => cb.value);
    }

    function getSelectedImageQs() {
      return Array.from(document.querySelectorAll('#image-list input[type="checkbox"]:checked')).map(cb => cb.value);
    }

    function selectAllFields() {
      document.querySelectorAll('#fields-list input[type="checkbox"]').forEach(cb => { cb.checked = true; });
      updateFieldsCount();
    }

    function deselectAllFields() {
      document.querySelectorAll('#fields-list input[type="checkbox"]').forEach(cb => { cb.checked = false; });
      updateFieldsCount();
    }

    function updateFieldsCount() {
      const total = document.querySelectorAll('#fields-list input[type="checkbox"]').length;
      const checked = document.querySelectorAll('#fields-list input[type="checkbox"]:checked').length;
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
        renderAudioList();
        renderImageList();
      } catch {
        statusEl.className = 'survey-status error';
        statusEl.textContent = 'Could not load form questions.';
      }
    }

    function toggleTranscribe() {
      const enabled = document.getElementById('transcribe-enabled').checked;
      document.getElementById('transcribe-sub').style.display = enabled ? 'flex' : 'none';
    }

    function toggleDescribe() {
      const enabled = document.getElementById('describe-enabled').checked;
      document.getElementById('describe-sub').style.display = enabled ? 'flex' : 'none';
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
        if (fwdUrl || data.forwardToken) document.getElementById('advanced').open = true;
        if (data.transcribe?.prompt) {
          document.getElementById('transcribe-prompt').value = data.transcribe.prompt;
          document.getElementById('advanced').open = true;
        }
        if (data.describe?.prompt) {
          document.getElementById('describe-prompt').value = data.describe.prompt;
          document.getElementById('advanced').open = true;
        }
        configFields = Array.isArray(data.fields) ? data.fields : [];
        if (data.transcribe && Array.isArray(data.transcribe.questions) && data.transcribe.questions.length > 0) {
          configTranscribeQs = data.transcribe.questions;
          document.getElementById('transcribe-enabled').checked = true;
          document.getElementById('transcribe-sub').style.display = 'flex';
        }
        if (data.describe && Array.isArray(data.describe.questions) && data.describe.questions.length > 0) {
          configDescribeQs = data.describe.questions;
          document.getElementById('describe-enabled').checked = true;
          document.getElementById('describe-sub').style.display = 'flex';
        }
      } catch {}
    }

    // ── Save ──────────────────────────────────────────────────────────────────
    async function save() {
      const forwardUrl = document.getElementById('forward-url').value.trim();
      const forwardToken = document.getElementById('forward-token').value.trim();
      const selected = getSelectedFields();
      // Empty array = forward all; treat "every question checked" as "all"
      const fields = (allQuestions.length > 0 && selected.length === allQuestions.length) ? [] : selected;
      const transcribeEnabled = document.getElementById('transcribe-enabled').checked;
      const selectedAudio = getSelectedAudioQs();
      const transcribePrompt = document.getElementById('transcribe-prompt').value.trim();
      const transcribe = (transcribeEnabled && selectedAudio.length > 0)
        ? { questions: selectedAudio, ...(transcribePrompt ? { prompt: transcribePrompt } : {}) }
        : null;
      const describeEnabled = document.getElementById('describe-enabled').checked;
      const selectedImages = getSelectedImageQs();
      const describePrompt = document.getElementById('describe-prompt').value.trim();
      const describe = (describeEnabled && selectedImages.length > 0)
        ? { questions: selectedImages, ...(describePrompt ? { prompt: describePrompt } : {}) }
        : null;
      const btn = document.getElementById('save-btn');
      btn.disabled = true;
      setStatus('', '');
      try {
        const res = await fetch('/api/configure/project/' + UID, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ forwardUrl, forwardToken, fields, transcribe, describe }),
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

    (async () => { await loadConfig(); loadSurvey(); })();
  </script>
</body>
</html>`
  );
});

export default ui;
