import { Hono } from "hono";
import { html, raw } from "hono/html";
import type { Env } from "../types.js";

const ui = new Hono<{ Bindings: Env }>();

// ── Home page ────────────────────────────────────────────────────────────────

ui.get("/", (c) => {
  return c.html(
    html`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>kobo2logie</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui, sans-serif; background: #f5f5f5; color: #1a1a1a; min-height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 2rem; }
    .card { background: #fff; border-radius: 12px; padding: 2.5rem; max-width: 560px; width: 100%; box-shadow: 0 2px 12px rgba(0,0,0,.08); }
    h1 { font-size: 1.6rem; font-weight: 700; margin-bottom: .25rem; }
    .subtitle { color: #666; margin-bottom: 2rem; font-size: .95rem; }
    label { display: block; font-size: .85rem; font-weight: 600; color: #444; margin-bottom: .4rem; }
    input { width: 100%; padding: .6rem .8rem; border: 1.5px solid #ddd; border-radius: 8px; font-size: .95rem; outline: none; transition: border-color .15s; }
    input:focus { border-color: #2563eb; }
    .generate-btn { margin-top: 1rem; width: 100%; padding: .7rem; background: #2563eb; color: #fff; border: none; border-radius: 8px; font-size: 1rem; font-weight: 600; cursor: pointer; transition: background .15s; }
    .generate-btn:hover { background: #1d4ed8; }
    .result { margin-top: 1.5rem; display: none; }
    .result-row { display: flex; align-items: center; gap: .5rem; margin-bottom: .75rem; }
    .result-label { font-size: .8rem; font-weight: 600; color: #666; width: 80px; flex-shrink: 0; }
    .result-url { font-size: .82rem; font-family: monospace; background: #f0f4ff; border: 1px solid #c7d7fd; border-radius: 6px; padding: .4rem .6rem; flex: 1; min-width: 0; overflow-x: auto; white-space: nowrap; color: #1e40af; }
    .copy-btn { flex-shrink: 0; padding: .35rem .65rem; font-size: .78rem; background: #e0e7ff; color: #3730a3; border: none; border-radius: 6px; cursor: pointer; font-weight: 600; width: auto; margin-top: 0; }
    .copy-btn:hover { background: #c7d7fd; }
    .view-link { display: inline-block; margin-top: .25rem; font-size: .85rem; color: #2563eb; text-decoration: none; }
    .view-link:hover { text-decoration: underline; }
    .configure-link-wrap { margin-top: 1.75rem; padding-top: 1rem; border-top: 1px solid #f0f0f0; text-align: center; }
    .configure-link { font-size: .82rem; color: #9ca3af; text-decoration: none; }
    .configure-link:hover { color: #2563eb; text-decoration: underline; }
  </style>
</head>
<body>
  <div class="card">
    <h1>kobo2logie</h1>
    <p class="subtitle">Real-time KoboToolbox webhook viewer</p>

    <label for="uid">KoboToolbox Form UID</label>
    <input id="uid" type="text" placeholder="e.g. a6LDoopohAy6s2Vw9gWo8p" autocomplete="off" spellcheck="false" />
    <button class="generate-btn" onclick="generate()">Generate URLs</button>

    <div class="result" id="result">
      <div class="result-row">
        <span class="result-label">Webhook</span>
        <span class="result-url" id="hook-url"></span>
        <button class="copy-btn" onclick="copy('hook-url', this)">Copy</button>
      </div>
      <div class="result-row">
        <span class="result-label">Viewer</span>
        <span class="result-url" id="view-url"></span>
        <button class="copy-btn" onclick="copy('view-url', this)">Copy</button>
      </div>
      <a id="view-link" class="view-link" href="#" target="_blank">Open viewer →</a>
    </div>
    <div class="configure-link-wrap">
      <a class="configure-link" href="/configure">⚙ Configure integration</a>
    </div>
  </div>

  <script>
    function generate() {
      const uid = document.getElementById('uid').value.trim();
      if (!uid) return;
      const base = location.origin;
      const hookUrl = base + '/api/hook/' + uid;
      const viewUrl = base + '/view/' + uid;
      document.getElementById('hook-url').textContent = hookUrl;
      document.getElementById('view-url').textContent = viewUrl;
      const link = document.getElementById('view-link');
      link.href = viewUrl;
      document.getElementById('result').style.display = 'block';
    }
    function copy(id, btn) {
      navigator.clipboard.writeText(document.getElementById(id).textContent);
      const orig = btn.textContent;
      btn.textContent = 'Copied!';
      setTimeout(() => btn.textContent = orig, 1500);
    }
    document.getElementById('uid').addEventListener('keydown', e => {
      if (e.key === 'Enter') generate();
    });
  </script>
</body>
</html>`
  );
});

// ── View page ────────────────────────────────────────────────────────────────

ui.get("/view/:formUID", (c) => {
  const formUID = c.req.param("formUID");
  const wsProto = c.req.url.startsWith("https://") ? "wss" : "ws";

  return c.html(
    html`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>kobo2logie — ${formUID}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui, sans-serif; background: #f0f2f5; color: #1a1a1a; height: 100vh; display: flex; flex-direction: column; overflow: hidden; }

    /* ── Header ── */
    header { background: #fff; border-bottom: 1px solid #e5e7eb; padding: .75rem 1.25rem; flex-shrink: 0; }
    .header-top { display: flex; align-items: center; gap: 1rem; flex-wrap: wrap; }
    h1 { font-size: 1.1rem; font-weight: 700; }
    .form-uid { font-family: monospace; font-size: .8rem; color: #555; background: #f3f4f6; padding: .2rem .5rem; border-radius: 4px; }
    .status { display: flex; align-items: center; gap: .4rem; font-size: .8rem; font-weight: 600; margin-left: auto; }
    .dot { width: 8px; height: 8px; border-radius: 50%; background: #9ca3af; }
    .dot.live { background: #22c55e; }
    .dot.reconnecting { background: #f59e0b; }
    .settings-toggle { background: none; border: 1.5px solid #e5e7eb; border-radius: 6px; padding: .3rem .6rem; font-size: .8rem; cursor: pointer; color: #555; }
    .settings-toggle:hover { background: #f9fafb; }

    /* ── Webhook URL bar ── */
    .hook-bar { display: flex; align-items: center; gap: .5rem; margin-top: .5rem; flex-wrap: wrap; }
    .hook-label { font-size: .75rem; font-weight: 600; color: #6b7280; }
    .hook-url { font-family: monospace; font-size: .78rem; color: #1d4ed8; background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 6px; padding: .25rem .5rem; }
    .copy-btn { padding: .25rem .55rem; font-size: .75rem; background: #e0e7ff; color: #3730a3; border: none; border-radius: 5px; cursor: pointer; font-weight: 600; }
    .copy-btn:hover { background: #c7d7fd; }

    /* ── Settings panel ── */
    .settings { display: none; border-top: 1px solid #e5e7eb; padding: .75rem 1.25rem; background: #fafafa; flex-shrink: 0; }
    .settings.open { display: flex; gap: 1rem; align-items: flex-end; flex-wrap: wrap; }
    .settings label { font-size: .78rem; font-weight: 600; color: #444; display: block; margin-bottom: .3rem; }
    .settings input { padding: .45rem .65rem; border: 1.5px solid #ddd; border-radius: 7px; font-size: .85rem; outline: none; width: 260px; }
    .settings input:focus { border-color: #2563eb; }
    .save-btn { padding: .45rem .9rem; background: #2563eb; color: #fff; border: none; border-radius: 7px; font-size: .85rem; font-weight: 600; cursor: pointer; }
    .save-btn:hover { background: #1d4ed8; }

    /* ── Main layout ── */
    .main { display: flex; flex: 1; min-height: 0; }

    /* ── Sidebar ── */
    .sidebar { width: 240px; flex-shrink: 0; background: #fff; border-right: 1px solid #e5e7eb; display: flex; flex-direction: column; }
    .sidebar-header { padding: .75rem 1rem; border-bottom: 1px solid #f0f0f0; display: flex; align-items: center; justify-content: space-between; }
    .sidebar-title { font-size: .85rem; font-weight: 700; }
    .refresh-btn { background: none; border: none; font-size: 1rem; cursor: pointer; color: #6b7280; padding: .2rem; border-radius: 4px; }
    .refresh-btn:hover { background: #f3f4f6; }
    .submission-list { overflow-y: auto; flex: 1; }
    .submission-item { padding: .65rem 1rem; border-bottom: 1px solid #f3f4f6; cursor: pointer; transition: background .1s; }
    .submission-item:hover { background: #f9fafb; }
    .submission-item.active { background: #eff6ff; border-left: 3px solid #2563eb; }
    .sub-id { font-size: .8rem; font-weight: 700; color: #1a1a1a; }
    .sub-time { font-size: .72rem; color: #9ca3af; margin-top: .1rem; }
    .sub-new { display: inline-block; background: #dcfce7; color: #15803d; font-size: .65rem; font-weight: 700; padding: .1rem .35rem; border-radius: 4px; margin-left: .3rem; }
    .empty-msg { padding: 1.5rem 1rem; text-align: center; color: #9ca3af; font-size: .82rem; }

    /* ── Detail panel ── */
    .detail { flex: 1; display: flex; flex-direction: column; min-width: 0; overflow: hidden; }
    .detail-placeholder { flex: 1; display: flex; align-items: center; justify-content: center; color: #9ca3af; font-size: .9rem; }

    /* ── JSON panel ── */
    .json-panel { flex: 0 0 auto; border-bottom: 1px solid #e5e7eb; display: flex; flex-direction: column; max-height: 45%; }
    .panel-header { padding: .5rem 1rem; background: #f9fafb; border-bottom: 1px solid #f0f0f0; display: flex; align-items: center; justify-content: space-between; flex-shrink: 0; }
    .panel-title { font-size: .78rem; font-weight: 700; color: #374151; }
    .json-body { overflow: auto; flex: 1; padding: .75rem 1rem; }
    pre { font-family: 'Fira Code', 'Cascadia Code', monospace; font-size: .78rem; line-height: 1.6; white-space: pre-wrap; word-break: break-all; color: #1e293b; }

    /* ── Attachments panel ── */
    .attachments-panel { flex: 1; display: flex; flex-direction: column; min-height: 0; }
    .attachments-body { flex: 1; overflow-y: auto; padding: .75rem 1rem; }
    .image-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: .75rem; }
    .image-cell { aspect-ratio: 1; border-radius: 8px; overflow: hidden; background: #f3f4f6; position: relative; cursor: pointer; }
    .image-cell img { width: 100%; height: 100%; object-fit: cover; display: block; border-radius: 8px; }
    .image-label { position: absolute; bottom: 0; left: 0; right: 0; background: rgba(0,0,0,.55); color: #fff; font-size: .65rem; padding: .2rem .4rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .file-link { display: flex; align-items: center; gap: .5rem; padding: .45rem .6rem; background: #f3f4f6; border-radius: 7px; text-decoration: none; color: #1a1a1a; font-size: .82rem; margin-bottom: .4rem; }
    .file-link:hover { background: #e5e7eb; }
    .no-media { color: #9ca3af; font-size: .82rem; }
    .token-prompt { color: #f59e0b; font-size: .82rem; }
  </style>
</head>
<body>
  <header>
    <div class="header-top">
      <h1>kobo2logie</h1>
      <span class="form-uid">${formUID}</span>
      <div class="status">
        <span class="dot" id="status-dot"></span>
        <span id="status-text">Connecting…</span>
      </div>
      <button class="settings-toggle" onclick="toggleSettings()">⚙ Settings</button>
    </div>
    <div class="hook-bar">
      <span class="hook-label">Webhook URL</span>
      <span class="hook-url" id="hook-url-display"></span>
      <button class="copy-btn" onclick="copyHookUrl(this)">Copy</button>
    </div>
  </header>

  <div class="settings" id="settings-panel">
    <div>
      <label for="token-input">Kobo API Token</label>
      <input id="token-input" type="password" placeholder="your token here" autocomplete="off" />
    </div>
    <div>
      <label for="base-input">Kobo Base URL</label>
      <input id="base-input" type="url" placeholder="https://kf.kobotoolbox.org" />
    </div>
    <button class="save-btn" onclick="saveSettings()">Save</button>
  </div>

  <div class="main">
    <aside class="sidebar">
      <div class="sidebar-header">
        <span class="sidebar-title">Submissions (<span id="count">0</span>)</span>
      </div>
      <div class="submission-list" id="submission-list">
        <div class="empty-msg" id="empty-msg">Waiting for submissions…</div>
      </div>
    </aside>

    <div class="detail" id="detail">
      <div class="detail-placeholder" id="placeholder">
        Select a submission to view details
      </div>
    </div>
  </div>

  <script>
    const FORM_UID = ${raw(JSON.stringify(formUID))};
    const WS_PROTO = ${raw(JSON.stringify(wsProto))};
    const host = location.host;

    // ── State ────────────────────────────────────────────────────────────────
    const submissions = [];
    let activeIndex = -1;
    let ws = null;
    let reconnectDelay = 1000;

    // ── Init ─────────────────────────────────────────────────────────────────
    document.getElementById('hook-url-display').textContent =
      location.origin + '/api/hook/' + FORM_UID;

    loadSettings();
    connect();

    // ── Image click delegation ────────────────────────────────────────────────
    document.addEventListener('click', function(e) {
      const cell = e.target.closest('.image-cell');
      if (cell && cell.dataset.fullUrl) window.open(cell.dataset.fullUrl, '_blank');
    });

    // ── Settings ─────────────────────────────────────────────────────────────
    function loadSettings() {
      document.getElementById('token-input').value = localStorage.getItem('kobo_token') ?? '';
      document.getElementById('base-input').value =
        localStorage.getItem('kobo_base_url') ?? 'https://kf.kobotoolbox.org';
    }

    function saveSettings() {
      localStorage.setItem('kobo_token', document.getElementById('token-input').value.trim());
      localStorage.setItem('kobo_base_url', document.getElementById('base-input').value.trim() || 'https://kf.kobotoolbox.org');
      toggleSettings();
      // Re-render active submission in case token changed
      if (activeIndex >= 0) renderDetail(activeIndex);
    }

    function toggleSettings() {
      const p = document.getElementById('settings-panel');
      p.classList.toggle('open');
    }

    // ── WebSocket ─────────────────────────────────────────────────────────────
    function connect() {
      setStatus('connecting');
      ws = new WebSocket(WS_PROTO + '://' + host + '/api/stream/' + FORM_UID);

      ws.onopen = () => {
        setStatus('live');
        reconnectDelay = 1000;
      };

      ws.onmessage = (e) => {
        try {
          const submission = JSON.parse(e.data);
          submissions.unshift(submission);
          renderList();
          // Auto-select if nothing selected or this is the first
          if (activeIndex === -1 || activeIndex === 0) {
            activeIndex = 0;
            renderDetail(0);
          } else {
            // Bump active index since we prepended
            activeIndex += 1;
          }
        } catch {}
      };

      ws.onclose = () => {
        setStatus('reconnecting');
        setTimeout(connect, reconnectDelay);
        reconnectDelay = Math.min(reconnectDelay * 2, 30000);
      };

      ws.onerror = () => ws.close();
    }

    function setStatus(state) {
      const dot = document.getElementById('status-dot');
      const text = document.getElementById('status-text');
      dot.className = 'dot';
      if (state === 'live') { dot.classList.add('live'); text.textContent = 'Live'; }
      else if (state === 'reconnecting') { dot.classList.add('reconnecting'); text.textContent = 'Reconnecting…'; }
      else { text.textContent = 'Connecting…'; }
    }

    // ── Submission list ───────────────────────────────────────────────────────
    function renderList() {
      const list = document.getElementById('submission-list');
      document.getElementById('count').textContent = submissions.length;

      if (submissions.length === 0) {
        list.innerHTML = '<div class="empty-msg" id="empty-msg">Waiting for submissions\u2026</div>';
        return;
      }

      list.innerHTML = submissions.map((s, i) => {
        const time = s._submission_time
          ? new Date(s._submission_time).toLocaleString('en-GB', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' })
          : '—';
        const isNew = i === 0 && submissions.length > 1 ? '<span class="sub-new">new</span>' : '';
        const active = i === activeIndex ? ' active' : '';
        return '<div class="submission-item' + active + '" onclick="selectSubmission(' + i + ')">' +
          '<div class="sub-id">#' + (s._id ?? s._uuid?.slice(0,8) ?? i) + isNew + '</div>' +
          '<div class="sub-time">' + time + '</div>' +
          '</div>';
      }).join('');
    }

    function selectSubmission(index) {
      activeIndex = index;
      renderList();
      renderDetail(index);
    }

    // ── Detail panel ──────────────────────────────────────────────────────────
    function renderDetail(index) {
      const s = submissions[index];
      if (!s) return;

      const token = localStorage.getItem('kobo_token') ?? '';
      const base = localStorage.getItem('kobo_base_url') ?? 'https://kf.kobotoolbox.org';

      const attachments = (s._attachments ?? []).filter(a => !a.is_deleted);
      const images = attachments.filter(a => a.mimetype && a.mimetype.startsWith('image/'));
      const files = attachments.filter(a => !a.mimetype || !a.mimetype.startsWith('image/'));

      const detail = document.getElementById('detail');
      detail.innerHTML =
        '<div class="json-panel">' +
          '<div class="panel-header">' +
            '<span class="panel-title">Raw JSON</span>' +
            '<button class="copy-btn" onclick="copyJson()">Copy</button>' +
          '</div>' +
          '<div class="json-body"><pre id="json-pre"></pre></div>' +
        '</div>' +
        '<div class="attachments-panel">' +
          '<div class="panel-header"><span class="panel-title">Attachments (' + attachments.length + ')</span></div>' +
          '<div class="attachments-body">' + renderAttachments(images, files, token, base) + '</div>' +
        '</div>';

      // Set JSON safely via textContent (no innerHTML XSS risk)
      document.getElementById('json-pre').textContent = JSON.stringify(s, null, 2);
    }

    function renderAttachments(images, files, token, base) {
      if (!token && images.length + files.length > 0) {
        return '<p class="token-prompt">⚠ Set your API token in Settings to preview media.</p>';
      }
      if (images.length + files.length === 0) {
        return '<p class="no-media">No attachments</p>';
      }

      let html = '';

      if (images.length > 0) {
        html += '<div class="image-grid">';
        for (const img of images) {
          const thumbUrl = buildMediaUrl(img.download_medium_url, token, base);
          const fullUrl = buildMediaUrl(img.download_large_url || img.download_url, token, base);
          const label = img.question_xpath || img.media_file_basename || '';
          html +=
            '<div class="image-cell" data-full-url="' + escAttr(fullUrl) + '">' +
              '<img src="' + escAttr(thumbUrl) + '" alt="' + escAttr(label) + '" loading="lazy" />' +
              '<div class="image-label">' + escHtml(label) + '</div>' +
            '</div>';
        }
        html += '</div>';
      }

      for (const file of files) {
        const fileUrl = buildMediaUrl(file.download_url, token, base);
        html +=
          '<a class="file-link" href="' + escAttr(fileUrl) + '" target="_blank" rel="noopener">' +
            '📎 ' + escHtml(file.media_file_basename || file.filename || 'file') +
            ' <small style="color:#6b7280">(' + escHtml(file.mimetype || '') + ')</small>' +
          '</a>';
      }

      return html;
    }

    function buildMediaUrl(koboUrl, token, base) {
      return '/api/media?url=' + encodeURIComponent(koboUrl) +
             '&token=' + encodeURIComponent(token) +
             '&base=' + encodeURIComponent(base);
    }

    function escHtml(str) {
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }

    function escAttr(str) {
      return String(str).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function copyJson() {
      const pre = document.getElementById('json-pre');
      if (pre) navigator.clipboard.writeText(pre.textContent);
    }

    function copyHookUrl(btn) {
      navigator.clipboard.writeText(document.getElementById('hook-url-display').textContent);
      const orig = btn.textContent;
      btn.textContent = 'Copied!';
      setTimeout(() => btn.textContent = orig, 1500);
    }
  </script>
</body>
</html>`
  );
});

// ── Configure page ──────────────────────────────────────────────────────────

ui.get("/configure", (c) => {
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
    .back-link { align-self: flex-start; margin-bottom: 1rem; font-size: .85rem; color: #2563eb; text-decoration: none; max-width: 640px; width: 100%; }
    .back-link:hover { text-decoration: underline; }
    .card { background: #fff; border-radius: 12px; padding: 2.5rem; max-width: 640px; width: 100%; box-shadow: 0 2px 12px rgba(0,0,0,.08); }
    h1 { font-size: 1.6rem; font-weight: 700; margin-bottom: .25rem; }
    .subtitle { color: #666; margin-bottom: 2rem; font-size: .95rem; }
    .fields { display: flex; flex-direction: column; gap: 1rem; margin-bottom: 2rem; }
    label { display: block; font-size: .85rem; font-weight: 600; color: #444; margin-bottom: .4rem; }
    input, select { width: 100%; padding: .6rem .8rem; border: 1.5px solid #ddd; border-radius: 8px; font-size: .95rem; outline: none; transition: border-color .15s; background: #fff; }
    input:focus, select:focus { border-color: #2563eb; }
    .actions { display: grid; grid-template-columns: 1fr 1fr; gap: 1.25rem; }
    @media (max-width: 520px) { .actions { grid-template-columns: 1fr; } }
    .action-section { border: 1.5px solid #e5e7eb; border-radius: 10px; padding: 1.25rem; display: flex; flex-direction: column; gap: .75rem; }
    .action-title { font-size: .9rem; font-weight: 700; color: #1a1a1a; }
    .action-desc { font-size: .8rem; color: #6b7280; line-height: 1.5; }
    .action-btn { padding: .65rem; background: #2563eb; color: #fff; border: none; border-radius: 8px; font-size: .9rem; font-weight: 600; cursor: pointer; transition: background .15s; }
    .action-btn:hover { background: #1d4ed8; }
    .action-btn:disabled { background: #93c5fd; cursor: not-allowed; }
    .status { font-size: .8rem; min-height: 1.5em; line-height: 1.5; word-break: break-word; }
    .status.pending { color: #6b7280; }
    .status.success { color: #15803d; }
    .status.error { color: #dc2626; }
  </style>
</head>
<body>
  <a class="back-link" href="/">← Home</a>
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

    <div class="actions">
      <div class="action-section">
        <div class="action-title">REST Service</div>
        <div class="action-desc">Registers this Worker&#39;s webhook URL as a REST Service on the Kobo project so submissions are forwarded automatically.</div>
        <button class="action-btn" id="rest-btn" onclick="configureRestService()">Configure REST Service</button>
        <div class="status" id="rest-status"></div>
      </div>

      <div class="action-section">
        <div class="action-title">User Permissions</div>
        <div class="action-desc">Grants <code>wfp_logie</code> view_submissions permission on this project so the app can authenticate requests.</div>
        <button class="action-btn" id="perm-btn" onclick="configurePermissions()">Configure Permissions</button>
        <div class="status" id="perm-status"></div>
      </div>
    </div>
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

    async function configureRestService() {
      const { server, uid, token } = getInputs();
      if (!uid || !token) {
        setStatus('rest-status', 'error', 'Form UID and API Token are required.');
        return;
      }
      const btn = document.getElementById('rest-btn');
      btn.disabled = true;
      setStatus('rest-status', 'pending', 'Registering\u2026');
      const webhookUrl = location.origin + '/api/hook/' + uid;
      try {
        const res = await fetch(server + '/api/v2/assets/' + uid + '/hooks/', {
          method: 'POST',
          headers: {
            'Authorization': 'Token ' + token,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            name: 'LogIE Integration',
            endpoint: webhookUrl,
            active: true,
            subset_fields: [],
            email_notification: true,
            export_type: 'json',
            auth_level: 'no_auth',
            settings: { custom_headers: {} },
            payload_template: '',
          }),
        });
        if (res.ok) {
          const data = await res.json();
          setStatus('rest-status', 'success', '\u2713 Registered: ' + (data.endpoint ?? webhookUrl));
        } else {
          const text = await res.text();
          setStatus('rest-status', 'error', 'Error ' + res.status + ': ' + text.slice(0, 200));
        }
      } catch (err) {
        setStatus('rest-status', 'error', 'Network error: ' + err.message);
      } finally {
        btn.disabled = false;
      }
    }

    async function configurePermissions() {
      const { server, uid, token } = getInputs();
      if (!uid || !token) {
        setStatus('perm-status', 'error', 'Form UID and API Token are required.');
        return;
      }
      const btn = document.getElementById('perm-btn');
      btn.disabled = true;
      setStatus('perm-status', 'pending', 'Applying permissions\u2026');
      try {
        const res = await fetch(server + '/api/v2/assets/' + uid + '/permission-assignments/bulk/', {
          method: 'POST',
          headers: {
            'Authorization': 'Token ' + token,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify([
            {
              user: server + '/api/v2/users/wfp_logie/',
              permission: server + '/api/v2/permissions/view_submissions/',
            },
          ]),
        });
        if (res.ok) {
          setStatus('perm-status', 'success', '\u2713 Permissions applied for wfp_logie');
        } else {
          const text = await res.text();
          setStatus('perm-status', 'error', 'Error ' + res.status + ': ' + text.slice(0, 200));
        }
      } catch (err) {
        setStatus('perm-status', 'error', 'Network error: ' + err.message);
      } finally {
        btn.disabled = false;
      }
    }
  </script>
</body>
</html>`
  );
});

export default ui;
