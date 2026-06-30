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
    .token-notes { background: #f8faff; border: 1.5px solid #dbeafe; border-radius: 8px; padding: .65rem .9rem; margin-top: .5rem; font-size: .81rem; color: #374151; display: flex; flex-direction: column; gap: .3rem; }
    .token-notes ul { margin: .15rem 0 0 0; padding-left: 1.1rem; display: flex; flex-direction: column; gap: .2rem; }
    .token-notes code { font-family: monospace; background: #eff6ff; padding: .05em .3em; border-radius: 3px; font-size: .92em; }
    .exists-banner { background: #f0fdf4; border: 1.5px solid #bbf7d0; border-radius: 8px; padding: .65rem .9rem; font-size: .85rem; color: #15803d; display: none; }
    .exists-banner-row { display: flex; align-items: center; justify-content: space-between; gap: .75rem; }
    .recreate-link { background: none; border: none; font-size: .8rem; font-weight: 600; color: #15803d; text-decoration: underline; cursor: pointer; padding: 0; flex-shrink: 0; }
    .recreate-link:hover { color: #14532d; }
    .recreate-panel { margin-top: .65rem; padding-top: .65rem; border-top: 1px solid #bbf7d0; display: none; flex-direction: column; gap: .5rem; }
    .recreate-panel input { border-color: #bbf7d0; background: #fff; }
    .recreate-panel input:focus { border-color: #16a34a; }
    .recreate-btn { padding: .4rem .85rem; background: #16a34a; color: #fff; border: none; border-radius: 7px; font-size: .82rem; font-weight: 600; cursor: pointer; align-self: flex-start; }
    .recreate-btn:hover { background: #15803d; }
    .recreate-btn:disabled { background: #86efac; cursor: not-allowed; }
    .recreate-status { font-size: .8rem; min-height: 1rem; }
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
      <div id="token-section" style="display:none">
        <label for="token">API Token</label>
        <input id="token" type="password" placeholder="your KoboToolbox API token" autocomplete="off" />
        <div class="token-notes">
          <div>This is the project owner&rsquo;s API key &mdash; it is <strong>not stored</strong> and is only used for this one-time setup.</div>
          <div>When you click <strong>Set up integration</strong>:</div>
          <ul>
            <li>A <code>wfp_logie</code> user is added to the project with <em>View Submissions</em> permissions</li>
            <li>A REST Service webhook is configured to forward new submissions to this integration</li>
          </ul>
        </div>
      </div>
      <div class="exists-banner" id="exists-banner">
        <div class="exists-banner-row">
          <span>&#10003; A configuration already exists for this project.</span>
          <button type="button" class="recreate-link" onclick="toggleRecreatePanel()">Recreate REST service</button>
        </div>
        <div class="recreate-panel" id="recreate-panel">
          <label for="recreate-token" style="color:#374151;margin-bottom:.2rem">API Token</label>
          <input id="recreate-token" type="password" placeholder="your KoboToolbox API token" autocomplete="off" />
          <div style="display:flex;align-items:center;gap:.75rem">
            <button type="button" class="recreate-btn" id="recreate-btn" onclick="recreateRestService()">Register now</button>
            <span class="recreate-status" id="recreate-status"></span>
          </div>
        </div>
      </div>
    </div>

    <button type="button" class="action-btn" id="setup-btn" style="display:none" onclick="setupIntegration()">Set up integration</button>

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
    let _configExists = false;
    let _checkTimer = null;

    function updateRootState(exists, uidPresent) {
      _configExists = exists;
      document.getElementById('token-section').style.display = (!exists && uidPresent) ? '' : 'none';
      document.getElementById('exists-banner').style.display = exists ? 'block' : 'none';
      document.getElementById('setup-btn').style.display = uidPresent ? '' : 'none';
      document.getElementById('setup-btn').textContent = exists ? 'Go to project \u2192' : 'Set up integration';
      document.getElementById('results').style.display = 'none';
      document.getElementById('continue-btn').style.display = 'none';
      document.getElementById('recreate-panel').style.display = 'none';
      document.getElementById('recreate-token').value = '';
      document.getElementById('recreate-status').textContent = '';
    }

    async function checkConfig(uid) {
      if (!uid) { updateRootState(false, false); return; }
      try {
        const res = await fetch('/api/configure/project/' + encodeURIComponent(uid));
        if (res.ok) {
          const data = await res.json();
          // The endpoint always returns 200 with defaults; treat it as existing only if
          // 'server' is non-empty (written during the rest-service setup step)
          if (data && data.server) {
            const sel = document.getElementById('server');
            if ([...sel.options].some(o => o.value === data.server)) sel.value = data.server;
          }
          updateRootState(!!(data && data.server), true);
        } else {
          updateRootState(false, true);
        }
      } catch {
        updateRootState(false, true);
      }
    }

    document.getElementById('uid').addEventListener('input', function() {
      clearTimeout(_checkTimer);
      const uid = this.value.trim();
      if (!uid) { updateRootState(false); return; }
      _checkTimer = setTimeout(function() { checkConfig(uid); }, 450);
    });

    document.getElementById('uid').addEventListener('blur', function() {
      clearTimeout(_checkTimer);
      const uid = this.value.trim();
      if (uid) checkConfig(uid);
    });

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

    function toggleRecreatePanel() {
      const panel = document.getElementById('recreate-panel');
      const open = panel.style.display === 'flex';
      panel.style.display = open ? 'none' : 'flex';
      if (!open) document.getElementById('recreate-token').focus();
    }

    async function recreateRestService() {
      const server = document.getElementById('server').value;
      const uid = document.getElementById('uid').value.trim();
      const token = document.getElementById('recreate-token').value.trim();
      const statusEl = document.getElementById('recreate-status');
      const btn = document.getElementById('recreate-btn');
      if (!token) { statusEl.style.color = '#dc2626'; statusEl.textContent = 'API token required.'; return; }
      btn.disabled = true;
      statusEl.style.color = '#6b7280';
      statusEl.textContent = 'Registering…';
      try {
        const res = await fetch('/api/configure/rest-service', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ server, uid, token }),
        });
        if (res.ok) {
          const data = await res.json();
          statusEl.style.color = '#15803d';
          statusEl.textContent = data.already_exists ? '✓ Already registered' : '✓ Registered: ' + (data.endpoint ?? '');
        } else {
          const text = await res.text();
          statusEl.style.color = '#dc2626';
          statusEl.textContent = 'Error ' + res.status + ': ' + text.slice(0, 200);
        }
      } catch (e) {
        statusEl.style.color = '#dc2626';
        statusEl.textContent = 'Network error: ' + e.message;
      } finally {
        btn.disabled = false;
      }
    }

    async function setupIntegration() {
      if (_configExists) { goToProject(); return; }
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

    @keyframes spin { to { transform: rotate(360deg); } }
    @keyframes shimmer { 0%,100% { opacity: .45; } 50% { opacity: .85; } }
    .q-skeleton-row { display: flex; align-items: center; gap: .5rem; padding: .38rem .25rem; }
    .q-skeleton-bar { background: #e5e7eb; border-radius: 4px; animation: shimmer 1.5s ease-in-out infinite; }
    .spinner { width: .85rem; height: .85rem; border: 2px solid #d1d5db; border-top-color: #6b7280; border-radius: 50%; animation: spin .7s linear infinite; flex-shrink: 0; }
    .field-list-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: .4rem; }
    .field-list-header label { margin-bottom: 0; font-size: 1.05rem; font-weight: 700; color: #111827; }
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
    .question-list-box { min-height: 7rem; max-height: 19rem; overflow-y: auto; border: 1.5px solid #e5e7eb; border-radius: 8px; padding: .3rem .5rem; display: flex; flex-direction: column; gap: 0; }
    .q-row { display: flex; align-items: center; gap: .5rem; padding: .2rem .25rem; border-radius: 6px; font-size: .85rem; }
    .q-row:hover { background: #f9fafb; }
    .q-row input[type="checkbox"] { width: 1rem; height: 1rem; cursor: pointer; accent-color: #2563eb; flex-shrink: 0; }
    .q-include { display: flex; align-items: center; gap: .4rem; flex: 1; min-width: 0; cursor: pointer; overflow: hidden; }
    .q-label { font-weight: 500; color: #374151; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
    .q-xpath { font-family: monospace; font-size: .74rem; color: #9ca3af; flex-shrink: 0; max-width: 9rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .q-badge { font-size: .65rem; font-weight: 700; letter-spacing: .04em; padding: .1rem .35rem; border-radius: 4px; flex-shrink: 0; width: 3.2rem; text-align: center; }
    .q-badge--audio { background: #fef3c7; color: #92400e; }
    .q-badge--image { background: #dbeafe; color: #1e40af; }
    .q-badge--text { background: #f1f5f9; color: #475569; }
    .q-badge--geo { background: #d1fae5; color: #065f46; }
    .q-pills { display: flex; gap: .25rem; flex-shrink: 0; align-items: center; }
    .q-pill { font-size: .73rem; padding: .15rem .55rem; border-radius: 999px; border: 1.5px solid #e5e7eb; background: #fff; color: #6b7280; cursor: pointer; white-space: nowrap; transition: background .1s, border-color .1s, color .1s; }
    .q-pill:hover { border-color: #9ca3af; color: #374151; }
    .q-pill[aria-pressed="true"] { background: #eff6ff; border-color: #93c5fd; color: #1d4ed8; font-weight: 600; }
    .q-prompt-btn { background: none; border: 1.5px solid #e5e7eb; border-radius: 4px; font-size: .7rem; color: #9ca3af; cursor: pointer; padding: .08rem .3rem; line-height: 1.4; flex-shrink: 0; transition: border-color .1s, color .1s; }
    .q-prompt-btn:hover { border-color: #9ca3af; color: #374151; }
    .q-prompt-btn.has-prompt { border-color: #93c5fd; color: #2563eb; background: #eff6ff; }

    .save-row { display: flex; align-items: center; gap: .75rem; padding-top: .35rem; flex-shrink: 0; }
    .save-btn { padding: .5rem 1.5rem; background: #2563eb; color: #fff; border: none; border-radius: 8px; font-size: .9rem; font-weight: 600; cursor: pointer; transition: background .15s; white-space: nowrap; }
    .save-btn:hover { background: #1d4ed8; }
    .save-btn:disabled { background: #93c5fd; cursor: not-allowed; }
    .status-msg { font-size: .85rem; min-height: 1.2rem; }
    .status-msg.success { color: #15803d; }
    .status-msg.error { color: #dc2626; }
    .status-msg.unsaved { color: #b45309; }
    .card { transition: box-shadow .2s; }
    .card.dirty { box-shadow: 0 2px 12px rgba(180,83,9,.35); }

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
    .log-skel-row td { padding: .38rem .5rem; border-bottom: 1px solid #f3f4f6; }
    .log-skel-row:last-child td { border-bottom: none; }
    .log-skel-bar { display: inline-block; height: .65rem; border-radius: 4px; background: #e5e7eb; animation: shimmer 1.5s ease-in-out infinite; vertical-align: middle; }
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
    .advanced-body { padding: .75rem .9rem 1rem; border-top: 1.5px solid #e5e7eb; display: flex; flex-direction: column; gap: 0; }
    .adv-group { display: flex; flex-direction: column; gap: 1.25rem; }
    .adv-group + .adv-group { padding-top: 1.5rem; margin-top: 1.5rem; border-top: 1.5px solid #f3f4f6; }
    .adv-group-title { font-size: .72rem; font-weight: 700; color: #9ca3af; text-transform: uppercase; letter-spacing: .06em; display: flex; align-items: center; gap: .3rem; }
    textarea { width: 100%; padding: .6rem .8rem; border: 1.5px solid #ddd; border-radius: 8px; font-size: .88rem; font-family: inherit; color: #1a1a1a; outline: none; resize: vertical; transition: border-color .15s; box-sizing: border-box; }
    textarea:focus { border-color: #2563eb; }
    .kv-editor { display: flex; flex-direction: column; gap: .4rem; }
    .kv-row { display: grid; grid-template-columns: 1fr 1.5fr auto; gap: .4rem; align-items: center; }
    .kv-row input { min-width: 0; }
    .kv-row textarea { min-width: 0; font-size: .82rem; padding: .35rem .55rem; border-radius: 6px; resize: vertical; }
    #prompt-modal-fields .kv-row { align-items: start; }
    .kv-remove { background: none; border: 1.5px solid #e5e7eb; border-radius: 6px; font-size: 1rem; color: #9ca3af; cursor: pointer; padding: .25rem .45rem; line-height: 1; }
    .kv-remove:hover { border-color: #fca5a5; color: #dc2626; }
    .kv-add { background: none; border: 1.5px dashed #d1d5db; border-radius: 6px; font-size: .8rem; font-weight: 600; color: #6b7280; cursor: pointer; padding: .35rem .6rem; align-self: flex-start; margin-top: .15rem; }
    .kv-add:hover { border-color: #9ca3af; color: #374151; }
    .kv-col-headers { display: grid; grid-template-columns: 1fr 1.5fr auto; gap: .4rem; padding-bottom: .1rem; }
    .kv-col-header { font-size: .72rem; font-weight: 700; color: #9ca3af; text-transform: uppercase; letter-spacing: .04em; }
    /* ── Condition builder ─────────────────────────────────────────────── */
    .cond-section { border: 1.5px solid #e5e7eb; border-radius: 8px; margin-top: .5rem; }
    .cond-section > summary { font-size: .82rem; font-weight: 600; color: #444; padding: .55rem .75rem; cursor: pointer; list-style: none; display: flex; align-items: center; gap: .4rem; }
    .cond-section > summary::-webkit-details-marker { display: none; }
    .cond-section > summary::before { content: '\\203A'; font-size: .65rem; color: #9ca3af; transition: transform .15s; }
    .cond-section[open] > summary::before { transform: rotate(90deg); }
    .cond-section-body { padding: .65rem .75rem; display: flex; flex-direction: column; gap: .6rem; }
    .cond-ai-panel { background: #f9fafb; border: 1.5px solid #e5e7eb; border-radius: 7px; padding: .6rem .7rem; display: flex; flex-direction: column; gap: .45rem; }
    .cond-ai-label { font-size: .75rem; font-weight: 700; color: #6b7280; text-transform: uppercase; letter-spacing: .05em; }
    .cond-ai-textarea { width: 100%; border: 1.5px solid #e5e7eb; border-radius: 6px; padding: .45rem .6rem; font-size: .82rem; font-family: inherit; resize: vertical; min-height: 60px; max-height: 180px; field-sizing: content; }
    .cond-ai-textarea:focus { outline: none; border-color: #2563eb; }
    .cond-ai-row { display: flex; align-items: center; gap: .5rem; flex-wrap: wrap; }
    .cond-ai-btn { background: #2563eb; color: #fff; border: none; border-radius: 6px; font-size: .78rem; font-weight: 600; padding: .3rem .7rem; cursor: pointer; }
    .cond-ai-btn:hover { background: #1d4ed8; }
    .cond-ai-btn:disabled { background: #93c5fd; cursor: not-allowed; }
    .cond-ai-clear { background: none; border: 1.5px solid #e5e7eb; border-radius: 6px; font-size: .78rem; color: #6b7280; padding: .28rem .6rem; cursor: pointer; }
    .cond-ai-clear:hover { border-color: #9ca3af; color: #374151; }
    .cond-ai-err { font-size: .75rem; color: #dc2626; }
    .cond-group { border: 1.5px solid #e5e7eb; border-radius: 7px; padding: .5rem .6rem; display: flex; flex-direction: column; gap: .4rem; }
    .cond-group--root { border-color: transparent; padding: 0; }
    .cond-group-header { display: flex; align-items: center; gap: .4rem; }
    .cond-combinator-label { font-size: .75rem; font-weight: 600; color: #9ca3af; }
    .cond-combinator { background: #eff6ff; border: 1.5px solid #bfdbfe; border-radius: 5px; font-size: .78rem; font-weight: 700; color: #2563eb; padding: .2rem .55rem; cursor: pointer; }
    .cond-combinator:hover { background: #dbeafe; }
    .cond-remove-group { background: none; border: none; color: #9ca3af; cursor: pointer; font-size: 1rem; line-height: 1; margin-left: auto; padding: .1rem .3rem; }
    .cond-remove-group:hover { color: #dc2626; }
    .cond-rules { display: flex; flex-direction: column; gap: .35rem; padding-left: .5rem; border-left: 2px solid #f3f4f6; }
    .cond-rule { display: grid; grid-template-columns: 1.5fr 1.4fr 1.5fr auto; gap: .35rem; align-items: center; }
    .cond-field-input, .cond-value-input { min-width: 0; padding: .3rem .5rem; border: 1.5px solid #e5e7eb; border-radius: 5px; font-size: .8rem; font-family: inherit; }
    .cond-field-input:focus, .cond-value-input:focus { outline: none; border-color: #2563eb; }
    .cond-op-select { min-width: 0; padding: .3rem .4rem; border: 1.5px solid #e5e7eb; border-radius: 5px; font-size: .78rem; background: #fff; }
    .cond-op-select:focus { outline: none; border-color: #2563eb; }
    .cond-rule-remove { background: none; border: 1.5px solid #e5e7eb; border-radius: 5px; color: #9ca3af; cursor: pointer; padding: .25rem .4rem; font-size: .9rem; line-height: 1; }
    .cond-rule-remove:hover { border-color: #fca5a5; color: #dc2626; }
    .cond-add-row { display: flex; gap: .4rem; margin-top: .2rem; }
    .cond-add-btn { background: none; border: 1.5px dashed #d1d5db; border-radius: 5px; font-size: .76rem; font-weight: 600; color: #6b7280; cursor: pointer; padding: .25rem .55rem; }
    .cond-add-btn:hover { border-color: #9ca3af; color: #374151; }
    .cond-empty-hint { font-size: .76rem; color: #9ca3af; font-style: italic; }
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

        <!-- Hook URL -->
        <div class="adv-group">
          <div class="adv-group-title">Webhook</div>
          <div>
            <label>Hook URL<span class="label-hint">the endpoint KoboToolbox sends submissions to &mdash; copy and paste this into any external REST Service configuration</span></label>
            <div style="display:flex;gap:.4rem;align-items:stretch;margin-top:.1rem">
              <input id="hook-url-input" type="text" readonly style="font-family:monospace;font-size:.82rem;color:#374151;background:#f9fafb;flex:1" />
              <button type="button" id="copy-hook-btn" class="select-btn" onclick="copyHookUrl()" style="flex-shrink:0;white-space:nowrap">Copy</button>
            </div>
          </div>
        </div>

        <!-- Forwarding -->
        <div class="adv-group">
          <div class="adv-group-title">Forwarding</div>
          <div>
            <label class="checkbox-row"><input type="checkbox" id="forward-to-logie" autocomplete="off" /><span>Forward directly to LogIE</span></label>
            <p class="label-hint" style="margin-top:.3rem;margin-left:1.55rem">Send each submission to the LogIE service configured via <code style="font-family:monospace;background:#f3f4f6;padding:.05em .25em;border-radius:3px;font-size:.9em">LOGIE_API_URL</code> and <code style="font-family:monospace;background:#f3f4f6;padding:.05em .25em;border-radius:3px;font-size:.9em">LOGIE_API_KEY</code> environment variables. When enabled, the URL and token fields below are ignored.</p>
          </div>
          <div id="forward-custom-fields">
          <div>
            <label for="forward-url">Forwarding URL<span class="label-hint">optional — relay submissions to another service</span></label>
            <input id="forward-url" type="url" placeholder="https://your-service.example.com/webhook" autocomplete="off" spellcheck="false" />
          </div>
          <div>
            <label for="forward-token">Bearer token<span class="label-hint">optional — sent as Authorization: Bearer &lt;token&gt;</span></label>
            <input id="forward-token" type="password" placeholder="••••••••••••••••" autocomplete="off" spellcheck="false" />
          </div>
          </div>
          <div>
            <label>Append to payload<span class="label-hint">static key-value pairs added under <code style="font-family:monospace;background:#f3f4f6;padding:.05em .25em;border-radius:3px;font-size:.9em">_metadata</code> in the forwarded JSON — e.g. context=mozambique</span></label>
            <div class="kv-col-headers"><span class="kv-col-header">Key</span><span class="kv-col-header">Value</span><span></span></div>
            <div class="kv-editor" id="kv-editor"></div>
            <button type="button" class="kv-add" onclick="addKVRow()">+ Add field</button>
          </div>
          <div>
            <label class="checkbox-row"><input type="checkbox" id="append-project-metadata" autocomplete="off" /><span>Append project metadata</span></label>
            <p class="label-hint" style="margin-top:.3rem;margin-left:1.55rem">Add the Kobo project's <code style="font-family:monospace;background:#f3f4f6;padding:.05em .25em;border-radius:3px;font-size:.9em">project_uid</code>, <code style="font-family:monospace;background:#f3f4f6;padding:.05em .25em;border-radius:3px;font-size:.9em">project_name</code>, <code style="font-family:monospace;background:#f3f4f6;padding:.05em .25em;border-radius:3px;font-size:.9em">project_owner_username</code> and <code style="font-family:monospace;background:#f3f4f6;padding:.05em .25em;border-radius:3px;font-size:.9em">project_server_url</code> under <code style="font-family:monospace;background:#f3f4f6;padding:.05em .25em;border-radius:3px;font-size:.9em">_metadata</code>. On by default when forwarding to LogIE.</p>
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
          <details class="cond-section" id="forward-cond-section">
            <summary>Condition <span class="label-hint" style="margin-left:.3rem;font-weight:400">leave empty to always forward</span></summary>
            <div class="cond-section-body">
              <div class="cond-ai-panel">
                <div class="cond-ai-label">Describe with AI</div>
                <textarea id="forward-condition-prompt" class="cond-ai-textarea" placeholder='e.g. "Only forward when status equals approved and region contains north"'></textarea>
                <div class="cond-ai-row">
                  <button type="button" id="forward-condition-generate-btn" class="cond-ai-btn" onclick="condGenerateAI('forward')">Generate</button>
                  <button type="button" class="cond-ai-clear" onclick="document.getElementById('forward-condition-prompt').value=''">Clear prompt</button>
                  <span id="forward-condition-ai-err" class="cond-ai-err"></span>
                </div>
              </div>
              <div id="forward-condition-builder"></div>
            </div>
          </details>
        </div>

        <!-- AI processing -->
        <div class="adv-group">
          <div class="adv-group-title"><svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/><path d="M20 3v4"/><path d="M22 5h-4"/><path d="M4 17v2"/><path d="M5 18H3"/></svg>AI processing</div>
          <div>
            <label for="transcribe-prompt">Transcription instruction<span class="label-hint">optional — context hint sent to the AI model to guide transcription</span></label>
            <textarea id="transcribe-prompt" rows="2" placeholder="e.g. The speaker may use field-specific terminology such as GPS coordinates and village names."></textarea>
          </div>
          <div>
            <label for="transcribe-translate">Translate transcript to<span class="label-hint">optional — translate every transcript into this language</span></label>
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
        </div>

        <!-- Actions -->
        <div class="adv-group">
          <div class="adv-group-title">Actions</div>
          <div>
            <label class="checkbox-row"><input type="checkbox" id="edit-original" /><span>Edit original submission</span></label>
            <p class="label-hint" style="margin-top:.3rem;margin-left:1.55rem">Write computed values (transcripts, descriptions, appended fields) back to the original KoboToolbox submission. Requires API token configured during setup.</p>
          </div>

          <div>
            <div style="display:flex;align-items:center;gap:.75rem;flex-wrap:wrap">
              <label class="checkbox-row"><input type="checkbox" id="validate-submission" autocomplete="off" /><span>Validate submission with AI</span></label>
              <button type="button" class="select-btn" id="validate-configure-btn" style="display:none" onclick="openValidateModal()">Configure&hellip;</button>
            </div>
            <p class="label-hint" style="margin-top:.3rem;margin-left:1.55rem">Use AI to review the submission and set its validation status (Approved, Not Approved, On Hold) in KoboToolbox. Requires API token configured during setup.</p>
          </div>

          <div>
            <div style="display:flex;align-items:center;gap:.75rem;flex-wrap:wrap">
              <label class="checkbox-row"><input type="checkbox" id="email-notification-enabled" autocomplete="off" /><span>Email notifications</span></label>
              <button type="button" class="select-btn" id="email-configure-btn" style="display:none" onclick="openEmailModal()">Configure&hellip;</button>
            </div>
            <p class="label-hint" style="margin-top:.3rem;margin-left:1.55rem">Send an email via Resend on every new submission. Requires <code style="font-family:monospace;background:#f3f4f6;padding:.05em .25em;border-radius:3px;font-size:.9em">RESEND_API_KEY</code> to be set as a Worker secret. Use <code style="font-family:monospace;background:#f3f4f6;padding:.05em .25em;border-radius:3px;font-size:.9em">{{_uuid}}</code>, <code style="font-family:monospace;background:#f3f4f6;padding:.05em .25em;border-radius:3px;font-size:.9em">{{field_name}}</code> as placeholders in subject and body.</p>
          </div>

          <div>
            <div style="display:flex;align-items:center;gap:.75rem;flex-wrap:wrap">
              <label class="checkbox-row"><input type="checkbox" id="failure-notification-enabled" autocomplete="off" /><span>Failure notifications</span></label>
              <button type="button" class="select-btn" id="failure-configure-btn" style="display:none" onclick="openFailureModal()">Configure&hellip;</button>
            </div>
            <p class="label-hint" style="margin-top:.3rem;margin-left:1.55rem">Send an alert email when a submission fails to forward. Requires <code style="font-family:monospace;background:#f3f4f6;padding:.05em .25em;border-radius:3px;font-size:.9em">RESEND_API_KEY</code>. Use <code style="font-family:monospace;background:#f3f4f6;padding:.05em .25em;border-radius:3px;font-size:.9em">{{_uuid}}</code> and <code style="font-family:monospace;background:#f3f4f6;padding:.05em .25em;border-radius:3px;font-size:.9em">{{error}}</code> as placeholders.</p>
          </div>
        </div>

      </div>
    </details>

    <div style="margin-top:1.75rem">
      <div class="field-list-header">
        <label style="margin-bottom:0">Fields</label>
        <span style="display:flex;gap:.4rem;align-items:center;flex-shrink:0">
          <span id="fields-count" class="fields-count"></span>
          <button type="button" class="select-btn" onclick="selectAllFields()">Select all</button>
          <button type="button" class="select-btn" onclick="deselectAllFields()">Deselect all</button>
        </span>
      </div>
      <div id="fields-list" class="question-list-box" aria-live="polite"></div>
    </div>

    <div class="log-header">
      <button type="button" class="log-title-btn" id="log-toggle" onclick="toggleLog()"><svg class="log-chevron" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>Submission log</button>
      <div class="log-actions">
        <button type="button" class="log-refresh-btn" onclick="refreshLogs(true)">Refresh</button>
        <button type="button" class="log-refresh-btn" onclick="exportLogs()" id="log-export-btn">Export</button>
      </div>
    </div>
    <div class="log-body" id="log-body">
      <div class="log-scroll" id="log-scroll">
        <div id="logs-container"></div>
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

  <div class="modal-overlay" id="prompt-modal" onclick="closeQPromptModal(event)">
    <div class="modal" style="max-width:520px">
      <div class="modal-header">
        <span class="modal-title" id="prompt-modal-title">Analysis instructions</span>
        <button type="button" class="modal-close" onclick="closePromptModal()">&times;</button>
      </div>
      <div class="modal-body" style="gap:1rem">
        <div class="modal-row">
          <span class="modal-label">Question</span>
          <span class="modal-value" id="prompt-modal-question"></span>
        </div>
        <div>
          <label for="prompt-modal-description" style="font-size:.82rem;font-weight:600;color:#444;margin-bottom:.4rem;display:block">Context<span class="label-hint">optional — describe what the content is so the model knows what it's looking at</span></label>
          <textarea id="prompt-modal-description" rows="2" placeholder="e.g. This image is a business card. The audio is a field interview recorded outdoors."></textarea>
        </div>
        <div>
          <label style="font-size:.82rem;font-weight:600;color:#444;margin-bottom:.5rem;display:block">Output fields<span class="label-hint">each row defines one field written back to the submission</span></label>
          <div class="kv-col-headers">
            <span class="kv-col-header">Key (field name)</span>
            <span class="kv-col-header">What to extract</span>
            <span></span>
          </div>
          <div class="kv-editor" id="prompt-modal-fields"></div>
          <button type="button" class="kv-add" onclick="addPromptField()">+ Add field</button>
        </div>
        <div style="display:flex;gap:.5rem;justify-content:flex-end;padding-top:.25rem">
          <button type="button" class="select-btn" onclick="closePromptModal()">Cancel</button>
          <button type="button" class="save-btn" style="width:auto;padding:.45rem 1rem" onclick="saveQPrompt()">Save</button>
        </div>
      </div>
    </div>
  </div>

  <div class="modal-overlay" id="email-modal" onclick="closeEmailOverlay(event)">
    <div class="modal" style="max-width:520px">
      <div class="modal-header">
        <span class="modal-title">Email notification settings</span>
        <button type="button" class="modal-close" onclick="closeEmailModal(false)">&times;</button>
      </div>
      <div class="modal-body" style="gap:.9rem">
        <div>
          <div style="display:flex; justify-content:space-between; align-items:flex-end; margin-bottom:.4rem;">
            <label style="font-size:.82rem;font-weight:600;color:#444;margin:0">To <span style="color:#dc2626">*</span></label>
            <div style="display:flex; gap:.75rem; font-size:.72rem;">
              <label style="display:flex; align-items:center; gap:.25rem; margin:0; cursor:pointer"><input type="radio" name="email-to-mode" value="static" checked> Static emails</label>
              <label style="display:flex; align-items:center; gap:.25rem; margin:0; cursor:pointer"><input type="radio" name="email-to-mode" value="xpath"> Form fields (XPath)</label>
            </div>
          </div>
          <input id="email-to" type="text" placeholder="recipient@example.com, another@example.com" autocomplete="off" spellcheck="false" />
          <input id="email-to-xpaths" type="text" placeholder="respondent/email, contact.email" autocomplete="off" spellcheck="false" style="display:none;" />
          <div id="email-to-hint" style="font-size:.75rem;font-weight:400;color:#9ca3af;margin-top:.25rem">comma-separated static emails</div>
        </div>
        <div>
          <div style="display:flex; justify-content:space-between; align-items:flex-end; margin-bottom:.4rem;">
            <label style="font-size:.82rem;font-weight:600;color:#444;margin:0">CC</label>
            <div style="display:flex; gap:.75rem; font-size:.72rem;">
              <label style="display:flex; align-items:center; gap:.25rem; margin:0; cursor:pointer"><input type="radio" name="email-cc-mode" value="static" checked> Static emails</label>
              <label style="display:flex; align-items:center; gap:.25rem; margin:0; cursor:pointer"><input type="radio" name="email-cc-mode" value="xpath"> Form fields (XPath)</label>
            </div>
          </div>
          <input id="email-cc" type="text" placeholder="cc@example.com" autocomplete="off" spellcheck="false" />
          <input id="email-cc-xpaths" type="text" placeholder="managers/reviewer_email" autocomplete="off" spellcheck="false" style="display:none;" />
          <div id="email-cc-hint" style="font-size:.75rem;font-weight:400;color:#9ca3af;margin-top:.25rem">comma-separated static emails, optional</div>
        </div>
        <div>
          <div style="display:flex; justify-content:space-between; align-items:flex-end; margin-bottom:.4rem;">
            <label style="font-size:.82rem;font-weight:600;color:#444;margin:0">BCC</label>
            <div style="display:flex; gap:.75rem; font-size:.72rem;">
              <label style="display:flex; align-items:center; gap:.25rem; margin:0; cursor:pointer"><input type="radio" name="email-bcc-mode" value="static" checked> Static emails</label>
              <label style="display:flex; align-items:center; gap:.25rem; margin:0; cursor:pointer"><input type="radio" name="email-bcc-mode" value="xpath"> Form fields (XPath)</label>
            </div>
          </div>
          <input id="email-bcc" type="text" placeholder="bcc@example.com" autocomplete="off" spellcheck="false" />
          <input id="email-bcc-xpaths" type="text" placeholder="approver/email" autocomplete="off" spellcheck="false" style="display:none;" />
          <div id="email-bcc-hint" style="font-size:.75rem;font-weight:400;color:#9ca3af;margin-top:.25rem">comma-separated static emails, optional</div>
        </div>
        <div>
          <label for="email-subject" style="font-size:.82rem;font-weight:600;color:#444;margin-bottom:.4rem;display:block">Subject <span style="color:#dc2626">*</span><span class="label-hint">use {{field_name}} for submission values</span></label>
          <input id="email-subject" type="text" placeholder="New Kobo submission: {{_uuid}}" autocomplete="off" spellcheck="false" />
        </div>
        <div style="border:1.5px solid #e5e7eb;border-radius:8px;padding:.65rem .75rem">
          <label class="checkbox-row" style="margin-bottom:0"><input type="checkbox" id="email-ai-enabled" autocomplete="off" /><span style="font-size:.85rem;font-weight:600;color:#444">Generate body with AI</span></label>
          <p style="font-size:.78rem;color:#6b7280;margin:.3rem 0 0 1.55rem">Uses AI to compose an HTML email from the submission data based on your instructions.</p>
        </div>
        <div id="email-ai-section">
          <label for="email-ai-instructions" style="font-size:.82rem;font-weight:600;color:#444;margin-bottom:.4rem;display:block">AI instructions</label>
          <textarea id="email-ai-instructions" rows="5" placeholder="Describe how the email should be structured&hellip;"></textarea>
        </div>
        <div id="email-body-section">
          <label for="email-body" style="font-size:.82rem;font-weight:600;color:#444;margin-bottom:.4rem;display:block">Body<span class="label-hint">use {{field_name}} for submission values</span></label>
          <textarea id="email-body" rows="5" placeholder="A new submission was received."></textarea>
        </div>
        <div id="email-attachments-section" style="display:none">
          <label style="font-size:.82rem;font-weight:600;color:#444;margin-bottom:.4rem;display:block">Attach media files<span class="label-hint">fetched from Kobo and attached to the email (max 40 MB total)</span></label>
          <div id="email-attachments-list" style="display:flex;flex-direction:column;gap:.1rem"></div>
        </div>
        <div id="email-attach-pdf-section">
          <label class="checkbox-row" style="margin-bottom:.4rem"><input type="checkbox" id="email-pdf-enabled" autocomplete="off" /><span style="font-size:.83rem;color:#374151;font-weight:600">Generate PDF report &amp; attach</span></label>
          <div id="email-pdf-fields" style="display:none">
            <div style="margin-top:.5rem;padding-left:1.4rem;border-left:2px solid #e5e7eb;display:flex;flex-direction:column;gap:.7rem">
              <div>
                <label for="email-pdf-form-title" style="font-size:.82rem;font-weight:600;color:#444;margin-bottom:.4rem;display:block">Form title<span class="label-hint">shown in PDF header, optional</span></label>
                <input id="email-pdf-form-title" type="text" placeholder="Household Assessment" autocomplete="off" spellcheck="false" />
              </div>
              <div>
                <label for="email-pdf-template" style="font-size:.82rem;font-weight:600;color:#444;margin-bottom:.4rem;display:block">Template<span class="label-hint">defaults to &ldquo;submission&rdquo;</span></label>
                <input id="email-pdf-template" type="text" placeholder="submission" autocomplete="off" spellcheck="false" />
              </div>
            </div>
          </div>
        </div>
        <details class="cond-section" id="email-cond-section">
          <summary>Condition <span class="label-hint" style="margin-left:.3rem;font-weight:400">leave empty to always send</span></summary>
          <div class="cond-section-body">
            <div class="cond-ai-panel">
              <div class="cond-ai-label">Describe with AI</div>
              <textarea id="email-condition-prompt" class="cond-ai-textarea" placeholder='e.g. "Send only when status equals approved"'></textarea>
              <div class="cond-ai-row">
                <button type="button" id="email-condition-generate-btn" class="cond-ai-btn" onclick="condGenerateAI('email')">Generate</button>
                <button type="button" class="cond-ai-clear" onclick="document.getElementById('email-condition-prompt').value=''">Clear prompt</button>
                <span id="email-condition-ai-err" class="cond-ai-err"></span>
              </div>
            </div>
            <div id="email-condition-builder"></div>
          </div>
        </details>
        <div style="display:flex;gap:.5rem;justify-content:flex-end;padding-top:.25rem">
          <button type="button" class="select-btn" onclick="closeEmailModal(false)">Cancel</button>
          <button type="button" class="save-btn" style="width:auto;padding:.45rem 1rem" onclick="saveEmailModal()">Save email settings</button>
        </div>
      </div>
    </div>
  </div>

  <div class="modal-overlay" id="failure-modal" onclick="closeFailureOverlay(event)">
    <div class="modal" style="max-width:520px">
      <div class="modal-header">
        <span class="modal-title">Failure notification settings</span>
        <button type="button" class="modal-close" onclick="closeFailureModal(false)">&times;</button>
      </div>
      <div class="modal-body" style="gap:.9rem">
        <div>
          <label for="failure-to" style="font-size:.82rem;font-weight:600;color:#444;margin-bottom:.4rem;display:block">To <span style="color:#dc2626">*</span></label>
          <input id="failure-to" type="text" placeholder="alerts@example.com, another@example.com" autocomplete="off" spellcheck="false" />
          <div style="font-size:.75rem;font-weight:400;color:#9ca3af;margin-top:.25rem">comma-separated emails</div>
        </div>
        <div>
          <label for="failure-cc" style="font-size:.82rem;font-weight:600;color:#444;margin-bottom:.4rem;display:block">CC</label>
          <input id="failure-cc" type="text" placeholder="cc@example.com" autocomplete="off" spellcheck="false" />
          <div style="font-size:.75rem;font-weight:400;color:#9ca3af;margin-top:.25rem">comma-separated emails, optional</div>
        </div>
        <div>
          <label for="failure-bcc" style="font-size:.82rem;font-weight:600;color:#444;margin-bottom:.4rem;display:block">BCC</label>
          <input id="failure-bcc" type="text" placeholder="bcc@example.com" autocomplete="off" spellcheck="false" />
          <div style="font-size:.75rem;font-weight:400;color:#9ca3af;margin-top:.25rem">comma-separated emails, optional</div>
        </div>
        <div>
          <label for="failure-subject" style="font-size:.82rem;font-weight:600;color:#444;margin-bottom:.4rem;display:block">Subject <span style="color:#dc2626">*</span><span class="label-hint">use {{_uuid}} and {{error}} as placeholders</span></label>
          <input id="failure-subject" type="text" placeholder="Submission forwarding failed: {{_uuid}}" autocomplete="off" spellcheck="false" />
        </div>
        <div>
          <label for="failure-body" style="font-size:.82rem;font-weight:600;color:#444;margin-bottom:.4rem;display:block">Body<span class="label-hint">use {{_uuid}} and {{error}} as placeholders</span></label>
          <textarea id="failure-body" rows="5" placeholder="A submission failed to forward."></textarea>
        </div>
        <div style="display:flex;gap:.5rem;justify-content:flex-end;padding-top:.25rem">
          <button type="button" class="select-btn" onclick="closeFailureModal(false)">Cancel</button>
          <button type="button" class="save-btn" style="width:auto;padding:.45rem 1rem" onclick="saveFailureModal()">Save</button>
        </div>
      </div>
    </div>
  </div>

  <div class="modal-overlay" id="validate-modal" onclick="closeValidateOverlay(event)">
    <div class="modal" style="max-width:520px">
      <div class="modal-header">
        <span class="modal-title">AI validation settings</span>
        <button type="button" class="modal-close" onclick="closeValidateModal(false)">&times;</button>
      </div>
      <div class="modal-body" style="gap:.9rem">
        <div>
          <label for="validate-instructions" style="font-size:.82rem;font-weight:600;color:#444;margin-bottom:.4rem;display:block">Instructions<span class="label-hint">overall context to give the model about this form</span></label>
          <textarea id="validate-instructions" rows="3" placeholder="e.g. This is a field assessment completed by a data collector in the field&hellip;"></textarea>
        </div>
        <div>
          <label style="font-size:.82rem;font-weight:600;color:#444;margin-bottom:.4rem;display:block">Approved<span class="label-hint">describe what qualifies a submission as Approved</span></label>
          <textarea id="validate-opt-approved" rows="2" placeholder="e.g. All required fields are filled and responses are consistent with no contradictions."></textarea>
        </div>
        <div>
          <label style="font-size:.82rem;font-weight:600;color:#444;margin-bottom:.4rem;display:block">Not Approved<span class="label-hint">describe what qualifies a submission as Not Approved</span></label>
          <textarea id="validate-opt-not-approved" rows="2" placeholder="e.g. Critical fields are missing or responses clearly contradict each other."></textarea>
        </div>
        <div>
          <label style="font-size:.82rem;font-weight:600;color:#444;margin-bottom:.4rem;display:block">On Hold<span class="label-hint">describe what qualifies a submission as On Hold</span></label>
          <textarea id="validate-opt-on-hold" rows="2" placeholder="e.g. Minor issues present that require follow-up before a final decision."></textarea>
        </div>
        <div style="border:1.5px solid #e5e7eb;border-radius:8px;padding:.65rem .75rem">
          <label class="checkbox-row" style="margin-bottom:0"><input type="checkbox" id="validate-include-reasoning" autocomplete="off" checked /><span style="font-size:.85rem;font-weight:600;color:#444">Include reasoning in submission</span></label>
          <p style="font-size:.78rem;color:#6b7280;margin:.3rem 0 0 1.55rem">Writes the AI&rsquo;s explanation back to the submission as <code style="font-family:monospace;background:#f3f4f6;padding:.05em .25em;border-radius:3px;font-size:.9em">_ai_validation_reasoning</code>.</p>
        </div>
        <details class="cond-section" id="validate-cond-section">
          <summary>Condition <span class="label-hint" style="margin-left:.3rem;font-weight:400">leave empty to always validate</span></summary>
          <div class="cond-section-body">
            <div class="cond-ai-panel">
              <div class="cond-ai-label">Describe with AI</div>
              <textarea id="validate-condition-prompt" class="cond-ai-textarea" placeholder='e.g. "Only validate when form_type equals field_report"'></textarea>
              <div class="cond-ai-row">
                <button type="button" id="validate-condition-generate-btn" class="cond-ai-btn" onclick="condGenerateAI('validate')">Generate</button>
                <button type="button" class="cond-ai-clear" onclick="document.getElementById('validate-condition-prompt').value=''">Clear prompt</button>
                <span id="validate-condition-ai-err" class="cond-ai-err"></span>
              </div>
            </div>
            <div id="validate-condition-builder"></div>
          </div>
        </details>
        <div style="display:flex;gap:.5rem;justify-content:flex-end;padding-top:.25rem">
          <button type="button" class="select-btn" onclick="closeValidateModal(false)">Cancel</button>
          <button type="button" class="save-btn" style="width:auto;padding:.45rem 1rem" onclick="closeValidateModal(true)">Save</button>
        </div>
      </div>
    </div>
  </div>

  <script>
    const UID = ${raw(JSON.stringify(uid))};
    document.getElementById('hook-url-input').value = window.location.origin + '/api/hook/' + UID;

    async function copyHookUrl() {
      const url = document.getElementById('hook-url-input').value;
      const btn = document.getElementById('copy-hook-btn');
      try {
        await navigator.clipboard.writeText(url);
        btn.textContent = 'Copied!';
        setTimeout(function() { btn.textContent = 'Copy'; }, 1800);
      } catch {
        document.getElementById('hook-url-input').select();
      }
    }

    const SPARKLE_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/><path d="M20 3v4"/><path d="M22 5h-4"/><path d="M4 17v2"/><path d="M5 18H3"/></svg>';
    let allQuestions = [];      // { xpath, label, type }[]
    let geocodeXpath = null;    // xpath of the geopoint question selected for geocoding
    let configFields = [];      // persisted fields subset
    let configTranscribeQs = []; // persisted transcribe xpath list
    let configExtractQs = [];    // persisted extract xpath list
    let configAnalyzeAudioQs = []; // persisted analyzeAudio xpath list
    let configExtractTextQs = []; // persisted extractText xpath list
    let configGeocodeAddressQs = []; // persisted geocodeAddressFields xpath list

    // Per-question analysis prompts (type → xpath → {description?: string, fields: [{key, instruction}]})
    const questionPrompts = { extract: {}, analyzeAudio: {}, extractText: {} };

    // Email notification config (null = disabled)
    let emailNotificationConfig = null;
    // Failure notification config (null = disabled)
    let failureNotificationConfig = null;
    // Validate submission config (null = disabled)
    let validateConfig = null;

    // ── LogIE checkbox toggle ─────────────────────────────────────────────
    document.getElementById('forward-to-logie').addEventListener('change', function() {
      document.getElementById('forward-custom-fields').style.display = this.checked ? 'none' : '';
      // Default project metadata on when forwarding to LogIE
      if (this.checked) document.getElementById('append-project-metadata').checked = true;
    });

    // ── Condition builder ─────────────────────────────────────────────────────
    const conditionState = {
      email:    { type: 'group', combinator: 'and', rules: [] },
      validate: { type: 'group', combinator: 'and', rules: [] },
      forward:  { type: 'group', combinator: 'and', rules: [] },
    };
    const OPERATORS = [
      ['equals', 'equals'], ['not_equals', 'does not equal'],
      ['contains', 'contains'], ['not_contains', 'does not contain'],
      ['starts_with', 'starts with'], ['ends_with', 'ends with'],
      ['is_empty', 'is empty'], ['is_not_empty', 'is not empty'],
      ['greater_than', '\u003e'], ['less_than', '\u003c'],
      ['greater_than_or_equal', '\u2265'], ['less_than_or_equal', '\u2264'],
    ];
    const NO_VALUE_OPS = new Set(['is_empty', 'is_not_empty']);

    function condGetNode(id, path) {
      let node = conditionState[id];
      for (const i of path) node = node.rules[i];
      return node;
    }
    function condSetCondition(id, condition) {
      conditionState[id] = (condition && condition.type === 'group' && Array.isArray(condition.rules))
        ? JSON.parse(JSON.stringify(condition))
        : { type: 'group', combinator: 'and', rules: [] };
    }
    function getCondition(id) {
      const g = conditionState[id];
      if (!g || g.rules.length === 0) return null;
      return g;
    }
    function jq(v) { return JSON.stringify(v).replace(/"/g, '&quot;'); }
    function renderConditionBuilder(id) {
      const root = document.getElementById(id + '-condition-builder');
      if (!root) return;
      const g = conditionState[id];
      root.innerHTML = renderCondGroup(id, g, [], true);
    }
    function renderCondGroup(id, group, path, isRoot) {
      const ps = JSON.stringify(path);
      const combLabel = group.combinator === 'and' ? 'All of' : 'Any of';
      let html = '<div class="cond-group' + (isRoot ? ' cond-group--root' : '') + '">';
      html += '<div class="cond-group-header">';
      html += '<span class="cond-combinator-label">Where</span>';
      html += '<button type="button" class="cond-combinator" onclick="condToggleCombinator(' + jq(id) + ',' + ps + ')">' + combLabel + '</button>';
      if (!isRoot) html += '<button type="button" class="cond-remove-group" onclick="condRemoveNode(' + jq(id) + ',' + ps + ')" title="Remove group">&times;</button>';
      html += '</div>';
      if (group.rules.length > 0) {
        html += '<div class="cond-rules">';
        group.rules.forEach(function(r, i) {
          const cp = path.concat([i]);
          html += r.type === 'rule' ? renderCondRule(id, r, cp) : renderCondGroup(id, r, cp, false);
        });
        html += '</div>';
      } else if (!isRoot) {
        html += '<div class="cond-empty-hint">No rules yet \u2014 add one below.</div>';
      }
      html += '<div class="cond-add-row">';
      html += '<button type="button" class="cond-add-btn" onclick="condAddRule(' + jq(id) + ',' + ps + ')">+ Add rule</button>';
      html += '<button type="button" class="cond-add-btn" onclick="condAddGroup(' + jq(id) + ',' + ps + ')">+ Add group</button>';
      if (isRoot && group.rules.length === 0) html += '<span class="cond-empty-hint" style="margin-left:.4rem">No condition \u2014 always runs</span>';
      html += '</div>';
      html += '</div>';
      return html;
    }
    function renderCondRule(id, rule, path) {
      const ps = JSON.stringify(path);
      const noVal = NO_VALUE_OPS.has(rule.operator);
      let html = '<div class="cond-rule">';
      html += '<input class="cond-field-input" type="text" placeholder="field or xpath" value="' + escHtml(rule.field || '') + '" oninput="condUpdateRule(' + jq(id) + ',' + ps + ',&quot;field&quot;,this.value)" autocomplete="off" spellcheck="false" />';
      html += '<select class="cond-op-select" onchange="condUpdateRule(' + jq(id) + ',' + ps + ',&quot;operator&quot;,this.value)">';
      OPERATORS.forEach(function(op) {
        html += '<option value="' + op[0] + '"' + (rule.operator === op[0] ? ' selected' : '') + '>' + op[1] + '</option>';
      });
      html += '</select>';
      html += '<input class="cond-value-input" type="text" placeholder="value" value="' + escHtml(rule.value || '') + '" oninput="condUpdateRule(' + jq(id) + ',' + ps + ',&quot;value&quot;,this.value)" autocomplete="off" spellcheck="false"' + (noVal ? ' disabled style="visibility:hidden"' : '') + ' />';
      html += '<button type="button" class="cond-rule-remove" onclick="condRemoveNode(' + jq(id) + ',' + ps + ')" title="Remove">&times;</button>';
      html += '</div>';
      return html;
    }
    function condToggleCombinator(id, path) {
      const node = condGetNode(id, path);
      node.combinator = node.combinator === 'and' ? 'or' : 'and';
      renderConditionBuilder(id);
    }
    function condAddRule(id, path) {
      condGetNode(id, path).rules.push({ type: 'rule', field: '', operator: 'equals', value: '' });
      renderConditionBuilder(id);
    }
    function condAddGroup(id, path) {
      condGetNode(id, path).rules.push({ type: 'group', combinator: 'and', rules: [] });
      renderConditionBuilder(id);
    }
    function condRemoveNode(id, path) {
      const parent = condGetNode(id, path.slice(0, -1));
      parent.rules.splice(path[path.length - 1], 1);
      renderConditionBuilder(id);
    }
    function condUpdateRule(id, path, field, value) {
      const rule = condGetNode(id, path);
      rule[field] = value;
      if (field === 'operator') renderConditionBuilder(id);
    }
    async function condGenerateAI(id) {
      const promptEl = document.getElementById(id + '-condition-prompt');
      const errEl = document.getElementById(id + '-condition-ai-err');
      const btn = document.getElementById(id + '-condition-generate-btn');
      if (!promptEl || !errEl || !btn) return;
      const prompt = promptEl.value.trim();
      if (!prompt) { errEl.textContent = 'Enter a description first.'; return; }
      errEl.textContent = '';
      btn.disabled = true;
      btn.textContent = 'Generating\u2026';
      try {
        const currentCondition = getCondition(id);
        const res = await fetch('/api/configure/condition/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt, ...(currentCondition ? { currentCondition } : {}) }),
        });
        const data = await res.json();
        if (!res.ok || data.error) { errEl.textContent = data.error || 'AI request failed'; return; }
        condSetCondition(id, data.condition);
        renderConditionBuilder(id);
      } catch (e) {
        errEl.textContent = 'Network error: ' + e.message;
      } finally {
        btn.disabled = false;
        btn.textContent = 'Generate';
      }
    }

    // Current state for the prompt modal
    let _promptXpath = null;
    let _promptType = null;

    // Dirty state — true when there are unsaved config changes
    let isDirty = false;
    function markDirty() {
      if (isDirty) return;
      isDirty = true;
      const btn = document.getElementById('save-btn');
      if (btn) btn.textContent = 'Save';
      document.querySelector('.card')?.classList.add('dirty');
      setStatus('unsaved', 'Unsaved changes');
    }
    function markClean() {
      isDirty = false;
      document.querySelector('.card')?.classList.remove('dirty');
    }

    // ── Rendering ────────────────────────────────────────────────────────────
    function renderFieldsList() {
      const list = document.getElementById('fields-list');
      if (allQuestions.length === 0) return;
      const hasFilter = configFields.length > 0;
      // _uuid and _submission_time are always first and always locked
      const makeLockedRow = (name) => '<div class="q-row">' +
        '<input type="checkbox" name="field-locked" value="' + name + '" checked disabled style="accent-color:#93c5fd;cursor:not-allowed" />' +
        '<span class="q-label" style="color:#9ca3af;flex:1;min-width:0">' + name + '</span>' +
        '<span style="font-size:.72rem;color:#d1d5db;flex-shrink:0">(always included)</span>' +
        '</div>';
      list.innerHTML = makeLockedRow('_uuid') + makeLockedRow('_submission_time') + allQuestions.map(q => {
        const checked = (!hasFilter || configFields.includes(q.xpath)) ? ' checked' : '';
        const xpathSpan = (q.label !== q.xpath)
          ? '<span class="q-xpath">' + escHtml(q.xpath) + '</span>' : '';
        let badge = '';
        let pills = '';
        if (q.type === 'audio') {
          badge = '<span class="q-badge q-badge--audio">AUDIO</span>';
          const analyzeOn = configAnalyzeAudioQs.includes(q.xpath);
          const tPressed = (configTranscribeQs.includes(q.xpath) || analyzeOn) ? 'true' : 'false';
          const aPressed = analyzeOn ? 'true' : 'false';
          const aFields = questionPrompts.analyzeAudio[q.xpath];
          const aHasPrompt = !!(aFields && (aFields.description || (Array.isArray(aFields.fields) && aFields.fields.length > 0)));
          pills = '<div class="q-pills">' +
            '<button type="button" class="q-pill" aria-pressed="' + tPressed + '" data-feature="transcribe" data-xpath="' + escHtml(q.xpath) + '">' + SPARKLE_SVG + ' Transcribe</button>' +
            '<button type="button" class="q-pill" aria-pressed="' + aPressed + '" data-feature="analyze" data-type="analyzeAudio" data-xpath="' + escHtml(q.xpath) + '">' + SPARKLE_SVG + ' Analyze</button>' +
            '<button type="button" class="q-prompt-btn' + (aHasPrompt ? ' has-prompt' : '') + '" data-feature="prompt" data-type="analyzeAudio" data-xpath="' + escHtml(q.xpath) + '" title="' + (aHasPrompt ? 'Edit instructions (set)' : 'Add instructions') + '">\u270e</button>' +
            '</div>';
        } else if (q.type === 'image' || q.type === 'photo') {
          badge = '<span class="q-badge q-badge--image">IMAGE</span>';
          const ePressed = configExtractQs.includes(q.xpath) ? 'true' : 'false';
          const eFields = questionPrompts.extract[q.xpath];
          const eHasPrompt = !!(eFields && (eFields.description || (Array.isArray(eFields.fields) && eFields.fields.length > 0)));
          pills = '<div class="q-pills">' +
            '<button type="button" class="q-pill" aria-pressed="' + ePressed + '" data-feature="analyze" data-type="extract" data-xpath="' + escHtml(q.xpath) + '">' + SPARKLE_SVG + ' Analyze</button>' +
            '<button type="button" class="q-prompt-btn' + (eHasPrompt ? ' has-prompt' : '') + '" data-feature="prompt" data-type="extract" data-xpath="' + escHtml(q.xpath) + '" title="' + (eHasPrompt ? 'Edit instructions (set)' : 'Add instructions') + '">\u270e</button>' +
            '</div>';
        } else if (q.type === 'text') {
          badge = '<span class="q-badge q-badge--text">TEXT</span>';
          const tPressed = configExtractTextQs.includes(q.xpath) ? 'true' : 'false';
          const tFields = questionPrompts.extractText[q.xpath];
          const tHasPrompt = !!(tFields && (tFields.description || (Array.isArray(tFields.fields) && tFields.fields.length > 0)));
          const gaPressed = configGeocodeAddressQs.includes(q.xpath) ? 'true' : 'false';
          pills = '<div class="q-pills">' +
            '<button type="button" class="q-pill" aria-pressed="' + tPressed + '" data-feature="analyze" data-type="extractText" data-xpath="' + escHtml(q.xpath) + '">' + SPARKLE_SVG + ' Analyze</button>' +
            '<button type="button" class="q-prompt-btn' + (tHasPrompt ? ' has-prompt' : '') + '" data-feature="prompt" data-type="extractText" data-xpath="' + escHtml(q.xpath) + '" title="' + (tHasPrompt ? 'Edit instructions (set)' : 'Add instructions') + '">\u270e</button>' +
            '<button type="button" class="q-pill" aria-pressed="' + gaPressed + '" data-feature="geocode-address" data-xpath="' + escHtml(q.xpath) + '">&#x1F4CD; Geocode</button>' +
            '</div>';
        } else if (q.type === 'geopoint') {
          badge = '<span class="q-badge q-badge--geo">GEO</span>';
          const gPressed = geocodeXpath === q.xpath ? 'true' : 'false';
          pills = '<div class="q-pills">' +
            '<button type="button" class="q-pill" aria-pressed="' + gPressed + '" data-feature="geocode" data-xpath="' + escHtml(q.xpath) + '">&#x1F4CD; Geocode</button>' +
            '</div>';
        }
        return '<div class="q-row" data-xpath="' + escHtml(q.xpath) + '">' +
          '<label class="q-include"><input type="checkbox" name="field" value="' + escHtml(q.xpath) + '"' + checked + ' />' +
          '<span class="q-label" title="' + escHtml(q.label) + '">' + escHtml(q.label) + '</span></label>' +
          xpathSpan + badge + pills +
          '</div>';
      }).join('');
      updateFieldsCount();
    }

    function getSelectedFields() {
      return Array.from(document.querySelectorAll('#fields-list input[name="field"]:checked')).map(cb => cb.value);
    }

    function getSelectedAudioQs() {
      return Array.from(document.querySelectorAll('#fields-list .q-pill[data-feature="transcribe"][aria-pressed="true"]')).map(b => b.dataset.xpath);
    }

    function getSelectedExtractQs() {
      return Array.from(document.querySelectorAll('#fields-list .q-pill[data-feature="analyze"][data-type="extract"][aria-pressed="true"]')).map(b => b.dataset.xpath);
    }

    function getSelectedAnalyzeAudioQs() {
      return Array.from(document.querySelectorAll('#fields-list .q-pill[data-feature="analyze"][data-type="analyzeAudio"][aria-pressed="true"]')).map(b => b.dataset.xpath);
    }

    function getSelectedExtractTextQs() {
      return Array.from(document.querySelectorAll('#fields-list .q-pill[data-feature="analyze"][data-type="extractText"][aria-pressed="true"]')).map(b => b.dataset.xpath);
    }

    function getSelectedGeocodeAddressQs() {
      return Array.from(document.querySelectorAll('#fields-list .q-pill[data-feature="geocode-address"][aria-pressed="true"]')).map(b => b.dataset.xpath);
    }

    // ── Per-question prompt modal ─────────────────────────────────────────────
    function promptFieldRowHtml(key, instruction) {
      return '<div class="kv-row">' +
        '<input type="text" class="pf-key" placeholder="e.g. group1/person_name" value="' + escHtml(key ?? '') + '" autocomplete="off" spellcheck="false" />' +
        '<textarea class="pf-desc" rows="2" placeholder="what to extract" autocomplete="off" spellcheck="false">' + escHtml(instruction ?? '') + '</textarea>' +
        '<button type="button" class="kv-remove" onclick="this.parentElement.remove()" title="Remove">&times;</button>' +
        '</div>';
    }

    function addPromptField() {
      const container = document.getElementById('prompt-modal-fields');
      container.insertAdjacentHTML('beforeend', promptFieldRowHtml('', ''));
      container.querySelector('.kv-row:last-child .pf-key')?.focus();
    }

    function openPromptModal(xpath, type) {
      _promptXpath = xpath;
      _promptType = type;
      const q = allQuestions.find(q => q.xpath === xpath);
      document.getElementById('prompt-modal-question').textContent = q ? q.label + (q.label !== xpath ? ' (' + xpath + ')' : '') : xpath;
      const typeLabels = { extract: 'Analyze (image)', analyzeAudio: 'Analyze (audio)', extractText: 'Analyze (text)' };
      document.getElementById('prompt-modal-title').textContent = (typeLabels[type] || type) + ' instructions';
      const stored = questionPrompts[type][xpath] || {};
      document.getElementById('prompt-modal-description').value = stored.description || '';
      const fields = stored.fields || [];
      const container = document.getElementById('prompt-modal-fields');
      container.innerHTML = fields.map(f => promptFieldRowHtml(f.key, f.instruction)).join('');
      if (fields.length === 0) container.insertAdjacentHTML('beforeend', promptFieldRowHtml('', ''));
      document.getElementById('prompt-modal').classList.add('open');
      document.getElementById('prompt-modal-description').focus();
    }

    function saveQPrompt() {
      if (!_promptXpath || !_promptType) return;
      const description = document.getElementById('prompt-modal-description').value.trim();
      const fields = Array.from(document.querySelectorAll('#prompt-modal-fields .kv-row')).reduce(function(acc, row) {
        const key = row.querySelector('.pf-key').value.trim();
        const instruction = row.querySelector('.pf-desc').value.trim();
        if (key) acc.push({ key, instruction });
        return acc;
      }, []);
      if (description || fields.length > 0) {
        questionPrompts[_promptType][_promptXpath] = { ...(description ? { description } : {}), fields };
      } else {
        delete questionPrompts[_promptType][_promptXpath];
      }
      document.getElementById('prompt-modal').classList.remove('open');
      // Targeted DOM update — avoid re-rendering the whole list
      const promptBtn = document.querySelector(
        '#fields-list .q-prompt-btn[data-type="' + CSS.escape(_promptType) + '"][data-xpath="' + CSS.escape(_promptXpath) + '"]'
      );
      if (promptBtn) {
        const stored = questionPrompts[_promptType][_promptXpath];
        const hasPrompt = !!(stored && (stored.description || (Array.isArray(stored.fields) && stored.fields.length > 0)));
        promptBtn.classList.toggle('has-prompt', hasPrompt);
        promptBtn.title = hasPrompt ? 'Edit instructions (set)' : 'Add instructions';
      }
      _promptXpath = null;
      _promptType = null;
      markDirty();
    }

    function closePromptModal() {
      document.getElementById('prompt-modal').classList.remove('open');
      _promptXpath = null;
      _promptType = null;
    }

    function closeQPromptModal(e) {
      if (e && e.target !== document.getElementById('prompt-modal')) return;
      closePromptModal();
    }

    // ── Email notification modal ──────────────────────────────────────────────
    document.getElementById('email-notification-enabled').addEventListener('change', function() {
      if (this.checked) {
        openEmailModal();
      } else {
        emailNotificationConfig = null;
        document.getElementById('email-configure-btn').style.display = 'none';
        markDirty();
      }
    });

    function closeEmailOverlay(e) {
      if (e && e.target !== document.getElementById('email-modal')) return;
      closeEmailModal(false);
    }

    function closeFailureOverlay(e) {
      if (e && e.target !== document.getElementById('failure-modal')) return;
      closeFailureModal(false);
    }

    document.getElementById('failure-notification-enabled').addEventListener('change', function() {
      if (this.checked) {
        openFailureModal();
      } else {
        failureNotificationConfig = null;
        document.getElementById('failure-configure-btn').style.display = 'none';
        markDirty();
      }
    });

    function openFailureModal() {
      var cfg = failureNotificationConfig || {};
      var parseCsv = function(s) { return s ? s.join(', ') : ''; };
      document.getElementById('failure-to').value = parseCsv(cfg.to);
      document.getElementById('failure-cc').value = parseCsv(cfg.cc);
      document.getElementById('failure-bcc').value = parseCsv(cfg.bcc);
      document.getElementById('failure-subject').value = cfg.subject || 'Submission forwarding failed: {{_uuid}}';
      document.getElementById('failure-body').value = cfg.body || 'A submission failed to forward.\\n\\nUUID: {{_uuid}}\\nError: {{error}}';
      document.getElementById('failure-modal').classList.add('open');
    }

    function closeFailureModal(saved) {
      document.getElementById('failure-modal').classList.remove('open');
      if (!saved && !failureNotificationConfig) {
        document.getElementById('failure-notification-enabled').checked = false;
      }
    }

    function saveFailureModal() {
      var parseCsv = function(s) { return s.split(',').map(function(e) { return e.trim(); }).filter(Boolean); };
      var to = parseCsv(document.getElementById('failure-to').value);
      var cc = parseCsv(document.getElementById('failure-cc').value);
      var bcc = parseCsv(document.getElementById('failure-bcc').value);
      var subject = document.getElementById('failure-subject').value.trim();
      var body = document.getElementById('failure-body').value.trim();
      if (!to.length || !subject) {
        alert('Subject is required, and To must include at least one email.');
        return;
      }
      failureNotificationConfig = { to, subject, body };
      if (cc.length) failureNotificationConfig.cc = cc;
      if (bcc.length) failureNotificationConfig.bcc = bcc;
      document.getElementById('failure-modal').classList.remove('open');
      document.getElementById('failure-notification-enabled').checked = true;
      document.getElementById('failure-configure-btn').style.display = '';
      markDirty();
    }

    function closeValidateOverlay(e) {
      if (e && e.target !== document.getElementById('validate-modal')) return;
      closeValidateModal(false);
    }

    function openValidateModal() {
      var cfg = validateConfig || {};
      document.getElementById('validate-instructions').value = cfg.instructions || '';
      document.getElementById('validate-opt-approved').value = (cfg.options && cfg.options.approved) || '';
      document.getElementById('validate-opt-not-approved').value = (cfg.options && cfg.options.notApproved) || '';
      document.getElementById('validate-opt-on-hold').value = (cfg.options && cfg.options.onHold) || '';
      document.getElementById('validate-include-reasoning').checked = cfg.includeReasoning !== false;
      condSetCondition('validate', cfg.condition || null);
      renderConditionBuilder('validate');
      document.getElementById('validate-modal').classList.add('open');
    }

    function closeValidateModal(save) {
      if (save) {
        validateConfig = {
          instructions: document.getElementById('validate-instructions').value.trim(),
          includeReasoning: document.getElementById('validate-include-reasoning').checked,
          options: {
            approved: document.getElementById('validate-opt-approved').value.trim(),
            notApproved: document.getElementById('validate-opt-not-approved').value.trim(),
            onHold: document.getElementById('validate-opt-on-hold').value.trim(),
          },
        };
        var vc = getCondition('validate');
        if (vc) validateConfig.condition = vc;
        markDirty();
      }
      document.getElementById('validate-modal').classList.remove('open');
    }

    document.getElementById('validate-submission').addEventListener('change', function() {
      document.getElementById('validate-configure-btn').style.display = this.checked ? '' : 'none';
      markDirty();
    });

    const EMAIL_AI_DEFAULT_INSTRUCTIONS = 'Write a clean, professional HTML notification email summarising the form submission.\\n\\nGuidelines:\\n- Start with a brief heading (e.g. "New submission received")\\n- Show key fields in a simple two-column table (label | value)\\n- Skip internal metadata fields that start with _ (except _uuid and _submission_time)\\n- End with a short note that this was sent automatically by the kobo2logie integration';

    document.getElementById('email-ai-enabled').addEventListener('change', function() {
      var useAi = this.checked;
      document.getElementById('email-ai-section').style.display = useAi ? '' : 'none';
      document.getElementById('email-body-section').style.display = useAi ? 'none' : '';
    });

    document.getElementById('email-pdf-enabled').addEventListener('change', function() {
      document.getElementById('email-pdf-fields').style.display = this.checked ? '' : 'none';
    });

    function setRecipientMode(prefix, mode) {
      if (mode === 'xpath') {
        document.getElementById(prefix).style.display = 'none';
        document.getElementById(prefix).value = '';
        document.getElementById(prefix + '-xpaths').style.display = '';
        document.getElementById(prefix + '-hint').textContent = 'comma-separated fields in submission JSON';
      } else {
        document.getElementById(prefix).style.display = '';
        document.getElementById(prefix + '-xpaths').style.display = 'none';
        document.getElementById(prefix + '-xpaths').value = '';
        var isOptional = prefix !== 'email-to';
        document.getElementById(prefix + '-hint').textContent = 'comma-separated static emails' + (isOptional ? ', optional' : '');
      }
    }

    ['email-to', 'email-cc', 'email-bcc'].forEach(function(prefix) {
      document.querySelectorAll('input[name="' + prefix + '-mode"]').forEach(function(radio) {
        radio.addEventListener('change', function() {
          if (this.checked) setRecipientMode(prefix, this.value);
        });
      });
    });

    function openEmailModal() {
      var cfg = emailNotificationConfig || {};
      document.getElementById('email-to').value = (cfg.to || []).join(', ');
      document.getElementById('email-to-xpaths').value = (cfg.toXPaths || []).join(', ');
      document.getElementById('email-cc').value = (cfg.cc || []).join(', ');
      document.getElementById('email-cc-xpaths').value = (cfg.ccXPaths || []).join(', ');
      document.getElementById('email-bcc').value = (cfg.bcc || []).join(', ');
      document.getElementById('email-bcc-xpaths').value = (cfg.bccXPaths || []).join(', ');
      document.getElementById('email-subject').value = cfg.subject || 'New Kobo submission: {{_uuid}}';
      var hasAi = !!(cfg.aiBody);
      var aiCb = document.getElementById('email-ai-enabled');
      aiCb.checked = hasAi;
      document.getElementById('email-ai-section').style.display = hasAi ? '' : 'none';
      document.getElementById('email-body-section').style.display = hasAi ? 'none' : '';
      document.getElementById('email-ai-instructions').value = (cfg.aiBody && cfg.aiBody.instructions) || EMAIL_AI_DEFAULT_INSTRUCTIONS;
      document.getElementById('email-body').value = cfg.body || 'A new submission was received.\\n\\nUUID: {{_uuid}}\\nTime: {{_submission_time}}';
      // Populate attachment checkboxes for media questions
      var MEDIA_TYPES = new Set(['image', 'audio', 'video', 'file']);
      var mediaQs = allQuestions.filter(function(q) { return MEDIA_TYPES.has(q.type); });
      var attSection = document.getElementById('email-attachments-section');
      if (mediaQs.length === 0) {
        attSection.style.display = 'none';
      } else {
        attSection.style.display = '';
        var savedAtts = cfg.attachments || [];
        document.getElementById('email-attachments-list').innerHTML = mediaQs.map(function(q) {
          var chk = savedAtts.indexOf(q.xpath) !== -1 ? ' checked' : '';
          var badgeClass = q.type === 'audio' ? 'q-badge--audio' : q.type === 'image' || q.type === 'photo' ? 'q-badge--image' : 'q-badge--text';
          var badgeLabel = q.type === 'audio' ? 'AUDIO' : q.type === 'image' || q.type === 'photo' ? 'IMAGE' : q.type.toUpperCase();
          var badge = '<span class="q-badge ' + badgeClass + '">' + badgeLabel + '</span>';
          return '<div style="display:flex;align-items:center;gap:.5rem;margin-bottom:.2rem"><label class="checkbox-row" style="margin-bottom:0"><input type="checkbox" name="email-attachment" value="' + escHtml(q.xpath) + '"' + chk + ' autocomplete="off" /><span style="font-size:.83rem;color:#374151">' + escHtml(q.label || q.xpath) + '</span></label>' + badge + '</div>';
        }).join('');
      }
      var pdfEnabled = !!(cfg.pdfReport);
      document.getElementById('email-pdf-enabled').checked = pdfEnabled;
      document.getElementById('email-pdf-fields').style.display = pdfEnabled ? '' : 'none';
      document.getElementById('email-pdf-form-title').value = (cfg.pdfReport && cfg.pdfReport.formTitle) || '';
      document.getElementById('email-pdf-template').value = (cfg.pdfReport && cfg.pdfReport.template) || '';
      ['email-to', 'email-cc', 'email-bcc'].forEach(function(prefix) {
        var hasXpath = document.getElementById(prefix + '-xpaths').value.trim().length > 0;
        var mode = hasXpath ? 'xpath' : 'static';
        document.querySelector('input[name="' + prefix + '-mode"][value="' + mode + '"]').checked = true;
        setRecipientMode(prefix, mode);
      });
      condSetCondition('email', cfg.condition || null);
      renderConditionBuilder('email');
      document.getElementById('email-modal').classList.add('open');
    }

    function closeEmailModal(saved) {
      document.getElementById('email-modal').classList.remove('open');
      if (!saved && !emailNotificationConfig) {
        document.getElementById('email-notification-enabled').checked = false;
      }
    }

    function saveEmailModal() {
      var toRaw = document.getElementById('email-to').value.trim();
      var toXpathsRaw = document.getElementById('email-to-xpaths').value.trim();
      var ccRaw = document.getElementById('email-cc').value.trim();
      var ccXpathsRaw = document.getElementById('email-cc-xpaths').value.trim();
      var bccRaw = document.getElementById('email-bcc').value.trim();
      var bccXpathsRaw = document.getElementById('email-bcc-xpaths').value.trim();
      var subject = document.getElementById('email-subject').value.trim();
      var useAi = document.getElementById('email-ai-enabled').checked;
      var aiInstructions = document.getElementById('email-ai-instructions').value.trim();
      var body = document.getElementById('email-body').value.trim();
      var parseCsv = function(s) { return s.split(',').map(function(e) { return e.trim(); }).filter(Boolean); };
      var to = parseCsv(toRaw);
      var toXPaths = parseCsv(toXpathsRaw);
      var cc = parseCsv(ccRaw);
      var ccXPaths = parseCsv(ccXpathsRaw);
      var bcc = parseCsv(bccRaw);
      var bccXPaths = parseCsv(bccXpathsRaw);
      if ((!to.length && !toXPaths.length) || !subject) {
        alert('Subject is required, and To must include at least one email or one XPath.');
        return;
      }
      emailNotificationConfig = { to: to };
      if (toXPaths.length) emailNotificationConfig.toXPaths = toXPaths;
      if (cc.length) emailNotificationConfig.cc = cc;
      if (ccXPaths.length) emailNotificationConfig.ccXPaths = ccXPaths;
      if (bcc.length) emailNotificationConfig.bcc = bcc;
      if (bccXPaths.length) emailNotificationConfig.bccXPaths = bccXPaths;
      emailNotificationConfig.subject = subject;
      if (useAi) {
        emailNotificationConfig.aiBody = { instructions: aiInstructions };
      } else {
        emailNotificationConfig.body = body;
      }
      var attChecked = Array.from(document.querySelectorAll('#email-attachments-list input[name="email-attachment"]:checked')).map(function(cb) { return cb.value; });
      if (attChecked.length) emailNotificationConfig.attachments = attChecked;
      if (document.getElementById('email-pdf-enabled').checked) {
        var pdfConfig = {};
        var pdfFormTitle = document.getElementById('email-pdf-form-title').value.trim();
        var pdfTemplate = document.getElementById('email-pdf-template').value.trim();
        if (pdfFormTitle) pdfConfig.formTitle = pdfFormTitle;
        if (pdfTemplate) pdfConfig.template = pdfTemplate;
        emailNotificationConfig.pdfReport = pdfConfig;
      }
      var ec = getCondition('email');
      if (ec) emailNotificationConfig.condition = ec;
      document.getElementById('email-modal').classList.remove('open');
      document.getElementById('email-notification-enabled').checked = true;
      document.getElementById('email-configure-btn').style.display = '';
      markDirty();
    }

    // ── PDF report modal ──────────────────────────────────────────────────────
    function selectAllFields() {
      document.querySelectorAll('#fields-list input[name="field"]').forEach(cb => { cb.checked = true; });
      updateFieldsCount();
      markDirty();
    }

    function deselectAllFields() {
      document.querySelectorAll('#fields-list input[name="field"]').forEach(cb => { cb.checked = false; });
      updateFieldsCount();
      markDirty();
    }

    function updateFieldsCount() {
      const total = document.querySelectorAll('#fields-list input[name="field"]').length;
      const checked = document.querySelectorAll('#fields-list input[name="field"]:checked').length;
      const badge = document.getElementById('fields-count');
      badge.textContent = total > 0 ? checked + ' / ' + total : '';
    }

    document.addEventListener('input', markDirty);
    document.addEventListener('change', markDirty);
    document.addEventListener('click', function(e) {
      if (e.target && e.target.classList.contains('kv-remove')) markDirty();
    });

    document.getElementById('fields-list').addEventListener('change', function(e) {
      if (e.target && e.target.name === 'field') updateFieldsCount();
    });

    document.getElementById('fields-list').addEventListener('click', function(e) {
      const target = e.target;
      if (!target) return;
      // Pill toggle
      if (target.classList.contains('q-pill')) {
        const feature = target.dataset.feature;
        const row = target.closest('.q-row');
        if (feature === 'transcribe') {
          const pressed = target.getAttribute('aria-pressed') === 'true';
          // Don't allow unchecking transcribe while analyze is active (analyze forces it on)
          if (pressed && row) {
            const analyzeBtn = row.querySelector('.q-pill[data-feature="analyze"]');
            if (analyzeBtn && analyzeBtn.getAttribute('aria-pressed') === 'true') return;
          }
          target.setAttribute('aria-pressed', String(!pressed));
          markDirty();
        } else if (feature === 'analyze') {
          const pressed = target.getAttribute('aria-pressed') === 'true';
          target.setAttribute('aria-pressed', String(!pressed));
          // Turning on analyzeAudio forces transcribe on too
          if (!pressed && target.dataset.type === 'analyzeAudio' && row) {
            const transcribeBtn = row.querySelector('.q-pill[data-feature="transcribe"]');
            if (transcribeBtn) transcribeBtn.setAttribute('aria-pressed', 'true');
          }
          markDirty();
        } else if (feature === 'geocode') {
          const xpath = target.dataset.xpath;
          // Radio-button style: selecting another geopoint clears the previous one
          geocodeXpath = (geocodeXpath === xpath) ? null : xpath;
          renderFieldsList();
          markDirty();
        } else if (feature === 'geocode-address') {
          const pressed = target.getAttribute('aria-pressed') === 'true';
          target.setAttribute('aria-pressed', String(!pressed));
          markDirty();
        }
      }
      // Prompt button
      if (target.classList.contains('q-prompt-btn')) {
        openPromptModal(target.dataset.xpath, target.dataset.type);
      }
    });

    // ── Survey load (auto on page load) ──────────────────────────────────────
    function fieldSkeletonHtml() {
      return [72, 55, 85, 48, 68].map(function(w) {
        return '<div class="q-skeleton-row">' +
          '<div class="q-skeleton-bar" style="width:1rem;height:1rem;border-radius:3px;flex-shrink:0"></div>' +
          '<div class="q-skeleton-bar" style="width:' + w + '%;height:.7rem"></div>' +
          '</div>';
      }).join('');
    }

    async function loadSurvey() {
      const list = document.getElementById('fields-list');
      list.innerHTML = fieldSkeletonHtml();
      try {
        const res = await fetch('/api/configure/survey/' + UID);
        if (!res.ok) {
          const d = await res.json().catch(() => ({}));
          list.innerHTML = '<p class="log-empty" style="color:#dc2626">Could not load questions: ' + escHtml(d.error ?? String(res.status)) + '</p>';
          return;
        }
        const data = await res.json();
        allQuestions = data.questions ?? [];
        if (allQuestions.length === 0) {
          list.innerHTML = '<p class="log-empty">No questions found in this form.</p>';
          return;
        }
        renderFieldsList();
      } catch {
        list.innerHTML = '<p class="log-empty" style="color:#dc2626">Could not load form questions.</p>';
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
      markDirty();
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
        const forwardToLogie = !!data.forwardToLogie;
        document.getElementById('forward-to-logie').checked = forwardToLogie;
        document.getElementById('forward-custom-fields').style.display = forwardToLogie ? 'none' : '';
        // Default project metadata on when forwarding to LogIE and nothing saved yet
        document.getElementById('append-project-metadata').checked =
          data.appendProjectMetadata != null ? !!data.appendProjectMetadata : forwardToLogie;
        if (data.transcribe?.prompt) {
          document.getElementById('transcribe-prompt').value = data.transcribe.prompt;
        }
        if (data.transcribe?.translateTo) {
          document.getElementById('transcribe-translate').value = data.transcribe.translateTo;
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
        if (data.extract && Array.isArray(data.extract.questions)) {
          configExtractQs = data.extract.questions;
        }
        if (data.extract?.prompts && typeof data.extract.prompts === 'object') {
          Object.assign(questionPrompts.extract, data.extract.prompts);
        }
        if (data.analyzeAudio && Array.isArray(data.analyzeAudio.questions)) {
          configAnalyzeAudioQs = data.analyzeAudio.questions;
        }
        if (data.analyzeAudio?.prompts && typeof data.analyzeAudio.prompts === 'object') {
          Object.assign(questionPrompts.analyzeAudio, data.analyzeAudio.prompts);
        }
        if (data.extractText && Array.isArray(data.extractText.questions)) {
          configExtractTextQs = data.extractText.questions;
        }
        if (data.extractText?.prompts && typeof data.extractText.prompts === 'object') {
          Object.assign(questionPrompts.extractText, data.extractText.prompts);
        }
        document.getElementById('edit-original').checked = !!data.editOriginal;
        geocodeXpath = data.geocodeField || null;
        configGeocodeAddressQs = Array.isArray(data.geocodeAddressFields) ? data.geocodeAddressFields : [];
        renderKVEditor(Array.isArray(data.appendValues) ? data.appendValues : []);
        if (data.validateSubmission) {
          validateConfig = data.validateSubmission;
          document.getElementById('validate-submission').checked = true;
          document.getElementById('validate-configure-btn').style.display = '';
        }
        if (data.emailNotification) {
          emailNotificationConfig = data.emailNotification;
          document.getElementById('email-notification-enabled').checked = true;
          document.getElementById('email-configure-btn').style.display = '';
        }
        if (data.failureNotification) {
          failureNotificationConfig = data.failureNotification;
          document.getElementById('failure-notification-enabled').checked = true;
          document.getElementById('failure-configure-btn').style.display = '';
        }
        if (data.forwardCondition) {
          condSetCondition('forward', data.forwardCondition);
          renderConditionBuilder('forward');
        }
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
      const editOriginal = document.getElementById('edit-original').checked;
      const geocodeField = geocodeXpath || '';
      const geocode = !!geocodeField;
      const selected = getSelectedFields();
      // _uuid and _submission_time are always included; treat "every non-locked question checked" as "forward all" (empty array)
      const allChecked = allQuestions.length > 0 && selected.length === allQuestions.length;
      const alwaysIncluded = ['_uuid', '_submission_time'];
      const fields = allChecked ? [] : [...alwaysIncluded, ...selected.filter(f => !alwaysIncluded.includes(f))];
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
      const selectedExtract = getSelectedExtractQs();
      const extractPrompts = selectedExtract.reduce((a, x) => { const f = questionPrompts.extract[x]; if (f && (f.description || (Array.isArray(f.fields) && f.fields.length > 0))) a[x] = f; return a; }, {});
      const extract = selectedExtract.length > 0
        ? { questions: selectedExtract, ...(Object.keys(extractPrompts).length > 0 ? { prompts: extractPrompts } : {}) }
        : null;
      const selectedAnalyzeAudio = getSelectedAnalyzeAudioQs();
      const analyzeAudioPrompts = selectedAnalyzeAudio.reduce((a, x) => { const f = questionPrompts.analyzeAudio[x]; if (f && (f.description || (Array.isArray(f.fields) && f.fields.length > 0))) a[x] = f; return a; }, {});
      const analyzeAudio = selectedAnalyzeAudio.length > 0
        ? { questions: selectedAnalyzeAudio, ...(Object.keys(analyzeAudioPrompts).length > 0 ? { prompts: analyzeAudioPrompts } : {}) }
        : null;
      const selectedExtractText = getSelectedExtractTextQs();
      const extractTextPrompts = selectedExtractText.reduce((a, x) => { const f = questionPrompts.extractText[x]; if (f && (f.description || (Array.isArray(f.fields) && f.fields.length > 0))) a[x] = f; return a; }, {});
      const extractText = selectedExtractText.length > 0
        ? { questions: selectedExtractText, ...(Object.keys(extractTextPrompts).length > 0 ? { prompts: extractTextPrompts } : {}) }
        : null;
      const geocodeAddressFields = getSelectedGeocodeAddressQs();
      const btn = document.getElementById('save-btn');
      btn.disabled = true;
      setStatus('', '');
      try {
        const res = await fetch('/api/configure/project/' + UID, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ forwardUrl, forwardToken, forwardToLogie: document.getElementById('forward-to-logie').checked, fields, transcribe, extract, analyzeAudio, extractText, forwardMedia, appendValues, appendProjectMetadata: document.getElementById('append-project-metadata').checked, editOriginal, geocode, geocodeField, geocodeAddressFields, validateSubmission: document.getElementById('validate-submission').checked && validateConfig ? validateConfig : null, emailNotification: emailNotificationConfig, failureNotification: document.getElementById('failure-notification-enabled').checked && failureNotificationConfig ? failureNotificationConfig : null, forwardCondition: getCondition('forward') }),
        });
        if (res.ok) {
          setStatus('success', '\u2713 Saved');
          markClean();
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
      if (e.editOk !== undefined) {
        rows += '<div class="modal-row"><span class="modal-label">Edit result</span><span class="modal-value">' + (e.editOk ? '\u2713 Written back' : '\u2717 Failed') + '</span></div>';
        if (e.editHttpStatus != null) rows += '<div class="modal-row"><span class="modal-label">Edit HTTP</span><span class="modal-value">HTTP ' + escHtml(String(e.editHttpStatus)) + '</span></div>';
        if (e.editError) rows += '<div class="modal-row"><span class="modal-label">Edit error</span><pre class="modal-pre">' + escHtml(e.editError) + '</pre></div>';
      }
      if (e.validateOk !== undefined) {
        rows += '<div class="modal-row"><span class="modal-label">Validate result</span><span class="modal-value">' + (e.validateOk ? '\u2713 Status set' : '\u2717 Failed') + '</span></div>';
        if (e.validateHttpStatus != null) rows += '<div class="modal-row"><span class="modal-label">Validate HTTP</span><span class="modal-value">HTTP ' + escHtml(String(e.validateHttpStatus)) + '</span></div>';
        if (e.validateError) rows += '<div class="modal-row"><span class="modal-label">Validate error</span><pre class="modal-pre">' + escHtml(e.validateError) + '</pre></div>';
      }
      if (e.geocodeOk !== undefined) {
        rows += '<div class="modal-row"><span class="modal-label">Geocode</span><span class="modal-value">' + (e.geocodeOk ? '\u2713 P-codes resolved' : '\u2717 Failed') + '</span></div>';
        if (e.geocodeError) rows += '<div class="modal-row"><span class="modal-label">Geocode error</span><pre class="modal-pre">' + escHtml(e.geocodeError) + '</pre></div>';
      }
      if (e.emailOk !== undefined) {
        rows += '<div class="modal-row"><span class="modal-label">Email notification</span><span class="modal-value">' + (e.emailOk ? '\u2713 Sent' : '\u2717 Failed') + '</span></div>';
        if (e.emailError) rows += '<div class="modal-row"><span class="modal-label">Email error</span><pre class="modal-pre">' + escHtml(e.emailError) + '</pre></div>';
      }
      if (e.failureEmailOk !== undefined) {
        rows += '<div class="modal-row"><span class="modal-label">Failure notification</span><span class="modal-value">' + (e.failureEmailOk ? '\u2713 Sent' : '\u2717 Failed') + '</span></div>';
        if (e.failureEmailError) rows += '<div class="modal-row"><span class="modal-label">Failure email error</span><pre class="modal-pre">' + escHtml(e.failureEmailError) + '</pre></div>';
      }
      // \u2500\u2500 Enrichment steps \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
      var renderStepGroup = function(label, stepMap) {
        if (!stepMap || Object.keys(stepMap).length === 0) return '';
        var out = '<div style="margin-top:.75rem"><span class="modal-label" style="display:block;margin-bottom:.35rem">' + escHtml(label) + '</span>';
        for (var xpath in stepMap) {
          var s = stepMap[xpath];
          var icon = s.ok ? '\u2713' : '\u2717';
          var color = s.ok ? '#15803d' : '#dc2626';
          out += '<div style="display:flex;gap:.5rem;align-items:baseline;padding:.15rem 0;padding-left:.75rem">';
          out += '<span style="font-weight:700;color:' + color + ';flex-shrink:0">' + icon + '</span>';
          out += '<span style="font-size:.8rem;color:#d1d5db;word-break:break-all">' + escHtml(xpath) + '</span>';
          if (s.ok && s.keys && s.keys.length > 0) {
            out += '<span style="font-size:.75rem;color:#6b7280;margin-left:.25rem">\u2192 ' + escHtml(s.keys.join(', ')) + '</span>';
          } else if (!s.ok && s.error) {
            out += '<span style="font-size:.75rem;color:#dc2626;margin-left:.25rem">' + escHtml(s.error) + '</span>';
          }
          out += '</div>';
        }
        out += '</div>';
        return out;
      };
      rows += renderStepGroup('Transcription', e.transcribeSteps);
      rows += renderStepGroup('Audio analysis', e.analyzeAudioSteps);
      rows += renderStepGroup('Image extraction', e.extractSteps);
      rows += renderStepGroup('Text extraction', e.extractTextSteps);
      rows += renderStepGroup('Address geocoding', e.geocodeAddressSteps);
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
        const editBadge = e.editOk === true
          ? '<span class="log-badge ok">\u2713 OK</span>'
          : e.editOk === false
            ? '<span class="log-badge fail">\u2717 Fail</span>'
            : '\u2014';
        const validateBadge = e.validateOk === true
          ? '<span class="log-badge ok">\u2713 OK</span>'
          : e.validateOk === false
            ? '<span class="log-badge fail">\u2717 Fail</span>'
            : '\u2014';
        const httpCell = e.httpStatus != null ? escHtml(String(e.httpStatus)) : '\u2014';
        const subId = escHtml(e.uuid ? e.uuid.slice(0, 8) + '\u2026' : (e.id != null ? String(e.id) : '\u2014'));
        return '<tr>' +
          '<td>' + escHtml(timeStr) + '</td>' +
          '<td title="' + escHtml(e.uuid ?? '') + '">' + subId + '</td>' +
          '<td>' + badge + '</td>' +
          '<td>' + editBadge + '</td>' +
          '<td>' + validateBadge + '</td>' +
          '<td style="color:#6b7280">' + httpCell + '</td>' +
          '<td style="display:flex;gap:.35rem;justify-content:flex-end">' +
            (!e.ok && e.uuid ? '<button type="button" class="log-detail-btn" id="retry-btn-' + idx + '" onclick="retrySubmission(' + idx + ')">Retry</button>' : '') +
            '<button type="button" class="log-detail-btn" onclick="openLogDetail(' + idx + ')">Details</button>' +
          '</td>' +
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

    function logSkeletonHtml() {
      const widths = [[55,30],[60,28],[50,32],[58,29],[52,31]];
      const headerRow = '<thead><tr><th>Time</th><th>Submission ID</th><th>Fwd</th><th>Edit</th><th>HTTP</th><th></th></tr></thead>';
      const rows = widths.map(function(w) {
        return '<tr class="log-skel-row">' +
          '<td><span class="log-skel-bar" style="width:' + w[0] + '%"></span></td>' +
          '<td><span class="log-skel-bar" style="width:' + w[1] + '%"></span></td>' +
          '<td><span class="log-skel-bar" style="width:2.2rem"></span></td>' +
          '<td><span class="log-skel-bar" style="width:.8rem"></span></td>' +
          '<td><span class="log-skel-bar" style="width:1.8rem"></span></td>' +
          '<td></td>' +
          '</tr>';
      }).join('');
      return '<table class="log-table">' + headerRow + '<tbody>' + rows + '</tbody></table>';
    }

    async function refreshLogs(reset) {
      if (reset) { logEntries = []; logOffset = 0; logHasMore = false; }
      const container = document.getElementById('logs-container');
      container.innerHTML = logSkeletonHtml();
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
          '<th>Time</th><th>Submission ID</th><th>Fwd</th><th>Edit</th><th>Validate</th><th>HTTP</th><th></th>' +
          '</tr></thead><tbody>' + renderLogRows(logEntries, 0) + '</tbody></table>';
        if (logHasMore) {
          container.insertAdjacentHTML('beforeend',
            '<button type="button" class="log-load-more" id="log-more-btn" onclick="loadMoreLogs()">Load more</button>');
        }
      } catch {
        container.innerHTML = '<p class="log-empty">Could not load logs.</p>';
      }
    }

    async function retrySubmission(idx) {
      const e = logEntries[idx];
      if (!e?.uuid) return;
      const btn = document.getElementById('retry-btn-' + idx);
      if (btn) { btn.disabled = true; btn.textContent = '…'; }
      try {
        const res = await fetch('/api/retry/' + UID, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ uuid: e.uuid })
        });
        if (res.ok) {
          setTimeout(() => refreshLogs(true), 1500);
        } else {
          const data = await res.json().catch(() => ({}));
          alert('Retry failed: ' + (data.error || res.status));
          if (btn) { btn.disabled = false; btn.textContent = 'Retry'; }
        }
      } catch (err) {
        alert('Retry failed: ' + err);
        if (btn) { btn.disabled = false; btn.textContent = 'Retry'; }
      }
    }

    async function exportLogs() {
      const btn = document.getElementById('log-export-btn');
      if (btn) { btn.disabled = true; btn.textContent = 'Exporting…'; }
      try {
        const all = [];
        let offset = 0;
        const limit = 100;
        while (true) {
          const res = await fetch('/api/logs/' + UID + '?offset=' + offset + '&limit=' + limit);
          if (!res.ok) break;
          const data = await res.json();
          const page = Array.isArray(data.entries) ? data.entries : [];
          all.push(...page);
          if (!data.hasMore || page.length === 0) break;
          offset += page.length;
        }
        const blob = new Blob([JSON.stringify(all, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'submission-log-' + UID + '-' + new Date().toISOString().slice(0, 10) + '.json';
        a.click();
        URL.revokeObjectURL(url);
      } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Export'; }
      }
    }

    (async () => { await loadConfig(); loadSurvey(); refreshLogs(true); renderConditionBuilder('forward'); })();
  </script>
</body>
</html>`
  );
});

export default ui;
