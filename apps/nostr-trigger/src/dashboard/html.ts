/**
 * Self-contained single-page dashboard. Vanilla JS, no build step, no
 * external deps. Served directly as a string from /dashboard.
 */
export function dashboardHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>nostr-trigger dashboard</title>
<style>
  :root {
    color-scheme: dark;
    --bg: #0b0d10;
    --panel: #15181d;
    --panel-2: #1c2027;
    --border: #262b33;
    --text: #e6e8ec;
    --muted: #8a92a0;
    --accent: #6ee7b7;
    --accent-2: #93c5fd;
    --danger: #f87171;
    --warn: #fbbf24;
    --ok: #34d399;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI",
      Roboto, Helvetica, Arial, sans-serif;
    background: var(--bg); color: var(--text); font-size: 14px;
    line-height: 1.5;
  }
  header {
    padding: 14px 20px;
    border-bottom: 1px solid var(--border);
    display: flex; align-items: center; gap: 16px; flex-wrap: wrap;
    background: var(--panel);
  }
  header h1 { margin: 0; font-size: 16px; font-weight: 600; letter-spacing: 0.2px; }
  header .badge {
    font-size: 11px; padding: 2px 8px; border-radius: 10px;
    background: var(--panel-2); color: var(--muted); border: 1px solid var(--border);
  }
  header .spacer { flex: 1; }
  header input[type=password] {
    background: var(--panel-2); color: var(--text);
    border: 1px solid var(--border); border-radius: 6px;
    padding: 6px 10px; font-size: 13px; min-width: 280px;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  header button {
    background: var(--accent); color: #063322;
    border: none; border-radius: 6px; padding: 6px 12px;
    font-size: 13px; font-weight: 600; cursor: pointer;
  }
  header button.ghost {
    background: var(--panel-2); color: var(--text);
    border: 1px solid var(--border); font-weight: 400;
  }
  nav { display: flex; gap: 2px; padding: 0 20px; border-bottom: 1px solid var(--border); background: var(--panel); }
  nav button {
    background: none; border: none; color: var(--muted);
    padding: 10px 16px; font-size: 13px; cursor: pointer;
    border-bottom: 2px solid transparent;
  }
  nav button.active { color: var(--text); border-bottom-color: var(--accent); }
  main { padding: 20px; max-width: 1200px; }
  .tab { display: none; }
  .tab.active { display: block; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; }
  .card {
    background: var(--panel); border: 1px solid var(--border);
    border-radius: 8px; padding: 16px;
  }
  .card h3 { margin: 0 0 6px; font-size: 11px; font-weight: 500;
    letter-spacing: 0.6px; text-transform: uppercase; color: var(--muted); }
  .card .v { font-size: 20px; font-weight: 600; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  .card .v.small { font-size: 14px; font-weight: 400; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--border); }
  th { color: var(--muted); font-weight: 500; font-size: 11px; letter-spacing: 0.4px; text-transform: uppercase; }
  td.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
  td.muted { color: var(--muted); }
  .pill {
    display: inline-block; padding: 2px 8px; border-radius: 10px;
    font-size: 11px; font-weight: 500;
    background: var(--panel-2); border: 1px solid var(--border);
  }
  .pill.ok { color: var(--ok); border-color: #0f3e2e; background: #0a1d16; }
  .pill.warn { color: var(--warn); border-color: #3e2c0f; background: #1d140a; }
  .pill.bad { color: var(--danger); border-color: #3e0f0f; background: #1d0a0a; }
  form.stack { display: flex; flex-direction: column; gap: 10px; max-width: 600px; }
  form.stack label { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--muted); }
  form.stack input, form.stack textarea {
    background: var(--panel-2); color: var(--text);
    border: 1px solid var(--border); border-radius: 6px;
    padding: 8px 10px; font-size: 13px;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  form.stack textarea { min-height: 80px; resize: vertical; }
  form.stack button {
    background: var(--accent); color: #063322;
    border: none; border-radius: 6px; padding: 8px 14px;
    font-size: 13px; font-weight: 600; cursor: pointer;
    align-self: flex-start;
  }
  form.stack button:disabled { opacity: 0.6; cursor: wait; }
  .events {
    background: var(--panel); border: 1px solid var(--border);
    border-radius: 8px; max-height: 60vh; overflow-y: auto;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 12px; line-height: 1.6;
  }
  .events .row { padding: 6px 12px; border-bottom: 1px solid var(--border); display: grid; grid-template-columns: 80px 110px 1fr; gap: 10px; align-items: baseline; }
  .events .row:last-child { border-bottom: none; }
  .events .ts { color: var(--muted); }
  .events .type { font-weight: 600; }
  .events .type.notification { color: var(--accent-2); }
  .events .type.webhook { color: var(--accent); }
  .events .type.zap { color: var(--warn); }
  .events .body { overflow-x: auto; white-space: nowrap; text-overflow: ellipsis; }
  .muted { color: var(--muted); }
  .error { color: var(--danger); padding: 10px 0; font-size: 12px; }
  .empty { color: var(--muted); padding: 20px; text-align: center; }
  .btn-small {
    background: var(--panel-2); color: var(--text);
    border: 1px solid var(--border); border-radius: 5px;
    padding: 3px 8px; font-size: 11px; cursor: pointer;
  }
  .btn-small.danger { color: var(--danger); }
  .btn-small:hover { border-color: var(--accent); }
  .live-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: var(--danger); margin-right: 6px; vertical-align: middle; }
  .live-dot.on { background: var(--ok); box-shadow: 0 0 6px var(--ok); }
</style>
</head>
<body>
  <header>
    <h1>⚡ nostr-trigger</h1>
    <span class="badge" id="mode-badge">loading…</span>
    <div class="spacer"></div>
    <input type="password" id="token" placeholder="admin bearer token" autocomplete="off" />
    <button id="save-token">save</button>
    <button class="ghost" id="clear-token">clear</button>
  </header>
  <nav>
    <button data-tab="status" class="active">Status</button>
    <button data-tab="connections">Connections</button>
    <button data-tab="add">Add NWC</button>
    <button data-tab="events"><span class="live-dot" id="live-dot"></span>Live Events</button>
  </nav>
  <main>
    <section class="tab active" data-tab="status">
      <div class="grid">
        <div class="card"><h3>Uptime</h3><div class="v" id="stat-uptime">—</div></div>
        <div class="card"><h3>Active subscriptions</h3><div class="v" id="stat-subs">—</div></div>
        <div class="card"><h3>Relays connected</h3><div class="v" id="stat-relays">—</div></div>
        <div class="card"><h3>Queue — waiting</h3><div class="v" id="stat-q-waiting">—</div></div>
        <div class="card"><h3>Queue — active</h3><div class="v" id="stat-q-active">—</div></div>
        <div class="card"><h3>Queue — delayed</h3><div class="v" id="stat-q-delayed">—</div></div>
        <div class="card"><h3>Queue — failed</h3><div class="v" id="stat-q-failed">—</div></div>
      </div>
      <h3 style="margin-top: 24px; font-size: 11px; letter-spacing: 0.6px; text-transform: uppercase; color: var(--muted);">Relays</h3>
      <div class="card" style="padding: 0;">
        <table><thead><tr><th>URL</th><th>State</th><th>Subs</th><th>Last error</th></tr></thead>
        <tbody id="relay-rows"><tr><td colspan="4" class="empty">no data yet</td></tr></tbody></table>
      </div>
      <div class="error" id="status-error"></div>
    </section>

    <section class="tab" data-tab="connections">
      <div class="card" style="padding: 0;">
        <table>
          <thead><tr><th>Label</th><th>Wallet pubkey</th><th>Relays</th><th>State</th><th>Created</th><th></th></tr></thead>
          <tbody id="conn-rows"><tr><td colspan="6" class="empty">loading…</td></tr></tbody>
        </table>
      </div>
      <div class="error" id="conn-error"></div>
    </section>

    <section class="tab" data-tab="add">
      <form class="stack" id="add-form">
        <label>Label <input type="text" name="label" placeholder="alice wallet" required /></label>
        <label>NWC URI
          <textarea name="nwcUri" placeholder="nostr+walletconnect://..." required></textarea>
        </label>
        <label><input type="checkbox" name="enabled" checked /> Enable immediately</label>
        <button type="submit">Create NWC connection</button>
      </form>
      <div class="error" id="add-error"></div>
      <div class="muted" id="add-ok" style="margin-top: 12px;"></div>
    </section>

    <section class="tab" data-tab="events">
      <div class="muted" style="margin-bottom: 10px;" id="events-hint">
        streaming <code>/api/v1/events/stream</code> — keep this tab open to watch incoming payments.
      </div>
      <div class="events" id="events-log"><div class="empty">no events yet</div></div>
    </section>
  </main>
  <script>
  (() => {
    const qs = s => document.querySelector(s);
    const qsa = s => Array.from(document.querySelectorAll(s));
    const TOKEN_KEY = 'nt_admin_token';
    let token = localStorage.getItem(TOKEN_KEY) || '';
    qs('#token').value = token;

    qs('#save-token').onclick = () => {
      token = qs('#token').value.trim();
      localStorage.setItem(TOKEN_KEY, token);
      refreshAll();
      connectSse();
    };
    qs('#clear-token').onclick = () => {
      token = '';
      localStorage.removeItem(TOKEN_KEY);
      qs('#token').value = '';
    };

    qsa('nav button').forEach(b => {
      b.onclick = () => {
        qsa('nav button').forEach(x => x.classList.remove('active'));
        qsa('.tab').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        qs('.tab[data-tab="' + b.dataset.tab + '"]').classList.add('active');
      };
    });

    const authHeaders = () => token ? { 'Authorization': 'Bearer ' + token } : {};
    const api = async (path, init = {}) => {
      const res = await fetch(path, {
        ...init,
        headers: { 'Content-Type': 'application/json', ...authHeaders(), ...(init.headers || {}) }
      });
      const text = await res.text();
      let body;
      try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text }; }
      if (!res.ok) {
        const msg = (body && body.error && body.error.message) || ('HTTP ' + res.status);
        throw new Error(msg);
      }
      return body.data;
    };

    // --- mode badge (public /health + /ready tells us nothing about auth) ---
    const refreshMode = async () => {
      try {
        const r = await fetch('/health');
        if (r.ok) qs('#mode-badge').textContent = 'service up';
      } catch {
        qs('#mode-badge').textContent = 'service down';
      }
    };

    // --- status ---
    const formatUptime = sec => {
      sec = Math.floor(sec);
      const h = Math.floor(sec / 3600);
      const m = Math.floor((sec % 3600) / 60);
      const s = sec % 60;
      return h + 'h ' + m + 'm ' + s + 's';
    };
    const refreshStatus = async () => {
      qs('#status-error').textContent = '';
      try {
        const data = await api('/api/v1/status');
        qs('#stat-uptime').textContent = formatUptime(data.uptimeSeconds || 0);
        qs('#stat-subs').textContent = data.activeSubs ?? '—';
        qs('#stat-relays').textContent = (data.relays || []).filter(r => r.connected).length + ' / ' + (data.relays || []).length;
        const q = data.queue || {};
        qs('#stat-q-waiting').textContent = q.waiting ?? '—';
        qs('#stat-q-active').textContent = q.active ?? '—';
        qs('#stat-q-delayed').textContent = q.delayed ?? '—';
        qs('#stat-q-failed').textContent = q.failed ?? '—';
        const rows = (data.relays || []).map(r =>
          '<tr><td class="mono">' + escape(r.url) + '</td>' +
          '<td>' + (r.connected ? '<span class="pill ok">connected</span>' : '<span class="pill bad">down</span>') + '</td>' +
          '<td class="mono">' + (r.inflightSubs ?? 0) + '</td>' +
          '<td class="muted mono">' + escape(r.lastError || '') + '</td></tr>'
        ).join('');
        qs('#relay-rows').innerHTML = rows || '<tr><td colspan="4" class="empty">no relays</td></tr>';
      } catch (err) {
        qs('#status-error').textContent = err.message;
      }
    };

    // --- connections ---
    const refreshConnections = async () => {
      qs('#conn-error').textContent = '';
      try {
        const rows = await api('/api/v1/nwc-connections');
        qs('#conn-rows').innerHTML = rows.length === 0
          ? '<tr><td colspan="6" class="empty">no NWC connections yet</td></tr>'
          : rows.map(c =>
            '<tr>' +
            '<td>' + escape(c.label) + '</td>' +
            '<td class="mono">' + shortHex(c.walletPubkey) + '</td>' +
            '<td class="mono muted">' + c.relays.join(', ') + '</td>' +
            '<td>' + (c.enabled ? '<span class="pill ok">enabled</span>' : '<span class="pill warn">disabled</span>') + '</td>' +
            '<td class="muted">' + new Date(c.createdAt).toLocaleString() + '</td>' +
            '<td><button class="btn-small danger" data-delete="' + c.id + '">delete</button></td>' +
            '</tr>'
          ).join('');
        qsa('[data-delete]').forEach(b => {
          b.onclick = async () => {
            if (!confirm('Delete this NWC connection?')) return;
            try {
              await api('/api/v1/nwc-connections/' + b.dataset.delete, { method: 'DELETE' });
              refreshConnections();
            } catch (err) { qs('#conn-error').textContent = err.message; }
          };
        });
      } catch (err) {
        qs('#conn-error').textContent = err.message;
      }
    };

    // --- add nwc ---
    qs('#add-form').onsubmit = async e => {
      e.preventDefault();
      qs('#add-error').textContent = '';
      qs('#add-ok').textContent = '';
      const btn = qs('#add-form button[type=submit]');
      btn.disabled = true;
      const form = new FormData(e.target);
      try {
        const created = await api('/api/v1/nwc-connections', {
          method: 'POST',
          body: JSON.stringify({
            label: form.get('label'),
            nwcUri: form.get('nwcUri'),
            enabled: !!form.get('enabled')
          })
        });
        qs('#add-ok').textContent = 'created: ' + created.id;
        e.target.reset();
        qs('#add-form [name=enabled]').checked = true;
        refreshConnections();
      } catch (err) {
        qs('#add-error').textContent = err.message;
      } finally {
        btn.disabled = false;
      }
    };

    // --- live events (SSE with ?token=) ---
    let es = null;
    let eventLog = [];
    const connectSse = () => {
      if (es) { es.close(); es = null; }
      qs('#live-dot').classList.remove('on');
      const url = '/api/v1/events/stream' + (token ? '?token=' + encodeURIComponent(token) : '');
      try {
        es = new EventSource(url);
        es.addEventListener('hello', () => { qs('#live-dot').classList.add('on'); });
        ['notification', 'webhook', 'zap'].forEach(t => {
          es.addEventListener(t, ev => {
            let parsed;
            try { parsed = JSON.parse(ev.data); } catch { return; }
            eventLog.unshift(parsed);
            if (eventLog.length > 100) eventLog.pop();
            renderEvents();
          });
        });
        es.onerror = () => { qs('#live-dot').classList.remove('on'); };
      } catch (err) {
        qs('#live-dot').classList.remove('on');
      }
    };
    const renderEvents = () => {
      if (eventLog.length === 0) {
        qs('#events-log').innerHTML = '<div class="empty">no events yet</div>';
        return;
      }
      qs('#events-log').innerHTML = eventLog.map(e => {
        const ts = new Date(e.ts || Date.now()).toLocaleTimeString();
        const type = escape(e.type || 'event');
        const summary = summarize(e);
        return '<div class="row">' +
          '<span class="ts">' + ts + '</span>' +
          '<span class="type ' + type + '">' + type + '</span>' +
          '<span class="body">' + summary + '</span>' +
        '</div>';
      }).join('');
    };
    const summarize = e => {
      if (e.type === 'notification') {
        return 'nwc=' + shortId(e.nwcConnectionId) + ' · kind=' + e.eventKind +
          ' · id=' + shortHex(e.eventId) + ' · ' + escape(e.relayUrl || '');
      }
      if (e.type === 'webhook') {
        return e.outcome + ' · ep=' + shortId(e.webhookEndpointId) +
          ' · eid=' + shortHex(e.eventId) +
          (e.status != null ? ' · status=' + e.status : '') +
          (e.reason ? ' · ' + escape(e.reason) : '');
      }
      if (e.type === 'zap') {
        return 'eventId=' + shortHex(e.eventId) + ' · to=' + shortHex(e.recipient) +
          ' · relays=' + (e.relays || []).length;
      }
      return escape(JSON.stringify(e));
    };

    const shortHex = s => typeof s === 'string' && s.length > 12 ? s.slice(0, 8) + '…' + s.slice(-4) : (s || '');
    const shortId = s => typeof s === 'string' && s.length > 10 ? s.slice(0, 6) + '…' : (s || '');
    const escape = s => String(s ?? '').replace(/[&<>\"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    const refreshAll = () => {
      refreshMode();
      refreshStatus();
      refreshConnections();
    };

    refreshAll();
    connectSse();
    setInterval(refreshStatus, 3000);
    setInterval(refreshConnections, 7000);
  })();
  </script>
</body>
</html>`
}
