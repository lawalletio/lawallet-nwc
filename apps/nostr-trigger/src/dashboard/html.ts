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
  .events .row { padding: 6px 12px; border-bottom: 1px solid var(--border); display: grid; grid-template-columns: 80px 100px 150px 1fr; gap: 10px; align-items: baseline; cursor: pointer; }
  .events .row:hover { background: var(--panel-2); }
  .events .row:last-child { border-bottom: none; }
  .events .ts { color: var(--muted); }
  .events .type { font-weight: 600; }
  .events .type.notification { color: var(--accent-2); }
  .events .type.webhook { color: var(--accent); }
  .events .type.zap { color: var(--warn); }
  .events .subtype { color: var(--text); font-weight: 500; font-size: 11px; }
  .events .subtype.payment_received { color: var(--ok); }
  .events .subtype.payment_sent { color: var(--warn); }
  .events .subtype.success { color: var(--ok); }
  .events .subtype.retry, .events .subtype.terminal, .events .subtype.exhausted { color: var(--danger); }
  .events .body { overflow-x: hidden; white-space: nowrap; text-overflow: ellipsis; color: var(--muted); }
  .events .detail {
    border-bottom: 1px solid var(--border);
    background: #0a0c10;
    padding: 10px 16px 14px;
    font-size: 11px;
    color: var(--text);
    max-height: 320px;
    overflow: auto;
  }
  .events .detail pre { margin: 0; white-space: pre-wrap; word-break: break-all; }
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
  .modal-backdrop {
    position: fixed; inset: 0; background: rgba(0,0,0,0.7);
    display: none; align-items: center; justify-content: center; z-index: 100;
  }
  .modal-backdrop.open { display: flex; }
  .modal {
    background: var(--panel); border: 1px solid var(--border);
    border-radius: 10px; padding: 20px; width: 420px; max-width: 92vw;
    max-height: 90vh; overflow-y: auto;
  }
  .modal h2 { margin: 0 0 12px; font-size: 15px; font-weight: 600; }
  .modal .close-x {
    float: right; background: none; border: none; color: var(--muted);
    font-size: 18px; cursor: pointer; padding: 0 4px; line-height: 1;
  }
  .modal .qr-wrap {
    display: flex; justify-content: center; padding: 10px 0;
    background: var(--panel-2); border-radius: 8px; border: 1px solid var(--border);
  }
  .modal .qr-wrap svg { display: block; max-width: 100%; height: auto; }
  .modal .invoice-box {
    background: var(--panel-2); border: 1px solid var(--border);
    border-radius: 6px; padding: 10px; margin-top: 12px;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 10.5px; line-height: 1.4; word-break: break-all; color: var(--text);
    cursor: pointer; user-select: all;
  }
  .modal .invoice-box:hover { border-color: var(--accent); }
  .modal .meta { font-size: 12px; color: var(--muted); margin-top: 8px; }
  .modal .meta b { color: var(--text); font-weight: 500; }
  .modal .copied-flash {
    display: inline-block; margin-left: 8px; color: var(--ok); font-size: 11px;
    opacity: 0; transition: opacity 0.2s;
  }
  .modal .copied-flash.show { opacity: 1; }
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
    <button data-tab="settings">Settings</button>
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
          <thead><tr><th>Label</th><th>Wallet pubkey</th><th>Relays</th><th>State</th><th>Created</th><th style="min-width:160px"></th></tr></thead>
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

    <section class="tab" data-tab="settings">
      <h3 style="margin: 0 0 10px; font-size: 11px; letter-spacing: 0.6px; text-transform: uppercase; color: var(--muted);">Webhook notifications</h3>
      <div class="muted" style="margin-bottom: 12px; max-width: 720px;">
        Every NWC notification received by this service is POSTed to its configured webhook URLs with an <code>Idempotency-Key</code> header and an HMAC-SHA256 signature (<code>X-LaWallet-Signature</code>) of the body.
      </div>
      <div class="card" style="padding: 0; margin-bottom: 16px;">
        <table>
          <thead><tr><th>URL</th><th>Connection</th><th>Kinds</th><th>State</th><th>Created</th><th style="min-width:160px"></th></tr></thead>
          <tbody id="hook-rows"><tr><td colspan="6" class="empty">loading…</td></tr></tbody>
        </table>
      </div>
      <h3 style="margin: 18px 0 10px; font-size: 11px; letter-spacing: 0.6px; text-transform: uppercase; color: var(--muted);">Add webhook</h3>
      <form class="stack" id="hook-form">
        <label>URL
          <input type="url" name="url" placeholder="https://example.com/webhook" required />
        </label>
        <label>NWC connection
          <select name="nwcConnectionId" id="hook-nwc-select" required>
            <option value="">loading…</option>
          </select>
        </label>
        <button type="submit">Create webhook</button>
      </form>
      <div class="error" id="hook-error"></div>
      <div class="muted" id="hook-ok" style="margin-top: 12px;"></div>
    </section>
  </main>

  <div class="modal-backdrop" id="invoice-modal">
    <div class="modal">
      <button class="close-x" id="invoice-close">×</button>
      <h2 id="invoice-title">Generate invoice</h2>
      <form class="stack" id="invoice-form">
        <label>Amount (sats)
          <input type="number" name="amountSats" min="1" step="1" placeholder="1000" required />
        </label>
        <label>Description (optional)
          <input type="text" name="description" placeholder="memo" maxlength="500" />
        </label>
        <button type="submit">Generate</button>
      </form>
      <div class="error" id="invoice-error"></div>
      <div id="invoice-result" style="display:none;">
        <div class="qr-wrap" id="invoice-qr"></div>
        <div class="invoice-box" id="invoice-bolt11" title="click to select, then copy"></div>
        <button class="btn-small" id="invoice-copy" style="margin-top:8px;">copy</button>
        <span class="copied-flash" id="invoice-copied">copied</span>
        <div class="meta" id="invoice-meta"></div>
      </div>
    </div>
  </div>
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
            '<td>' +
              '<button class="btn-small" data-invoice="' + c.id + '" data-label="' + escape(c.label) + '">invoice</button> ' +
              '<button class="btn-small" data-info="' + c.id + '">info</button> ' +
              '<button class="btn-small danger" data-delete="' + c.id + '">delete</button>' +
            '</td>' +
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
        qsa('[data-invoice]').forEach(b => {
          b.onclick = () => openInvoiceModal(b.dataset.invoice, b.dataset.label);
        });
        qsa('[data-info]').forEach(b => {
          b.onclick = async () => {
            qs('#conn-error').textContent = '';
            b.textContent = 'probing…';
            b.disabled = true;
            try {
              const info = await api('/api/v1/nwc-connections/' + b.dataset.info + '/info');
              alert(renderInfoText(info));
            } catch (err) {
              qs('#conn-error').textContent = 'probe failed: ' + err.message;
            } finally {
              b.textContent = 'info';
              b.disabled = false;
            }
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
    const expandedIdx = new Set();
    const renderEvents = () => {
      if (eventLog.length === 0) {
        qs('#events-log').innerHTML = '<div class="empty">no events yet</div>';
        return;
      }
      qs('#events-log').innerHTML = eventLog.map((e, idx) => {
        const ts = new Date(e.ts || Date.now()).toLocaleTimeString();
        const type = escape(e.type || 'event');
        const subtypeRaw = subtypeOf(e);
        const subtypeCls = subtypeRaw ? escape(subtypeRaw) : '';
        const subtype = subtypeRaw ? '<span class="subtype ' + subtypeCls + '">' + escape(subtypeRaw) + '</span>' : '<span class="subtype"></span>';
        const summary = summarize(e);
        const expanded = expandedIdx.has(idx);
        const row = '<div class="row" data-idx="' + idx + '">' +
          '<span class="ts">' + ts + '</span>' +
          '<span class="type ' + type + '">' + type + '</span>' +
          subtype +
          '<span class="body">' + summary + '</span>' +
        '</div>';
        const detail = expanded
          ? '<div class="detail"><pre>' + escape(JSON.stringify(e, null, 2)) + '</pre></div>'
          : '';
        return row + detail;
      }).join('');
      qsa('#events-log .row').forEach(r => {
        r.onclick = () => {
          const idx = parseInt(r.dataset.idx, 10);
          if (expandedIdx.has(idx)) expandedIdx.delete(idx);
          else expandedIdx.add(idx);
          renderEvents();
        };
      });
    };
    const subtypeOf = e => {
      if (e.type === 'notification') return e.notificationType || '';
      if (e.type === 'webhook') return e.outcome || '';
      return '';
    };
    const fmtSats = msats => {
      if (msats == null) return null;
      const sats = Math.floor(msats / 1000);
      return sats.toLocaleString() + ' sats';
    };
    const summarize = e => {
      if (e.type === 'notification') {
        const bits = [];
        const sats = fmtSats(e.amount);
        if (sats) bits.push(sats);
        if (e.paymentHash) bits.push('hash ' + shortHex(e.paymentHash));
        if (e.description) bits.push('“' + escape(e.description.slice(0, 40)) + (e.description.length > 40 ? '…' : '') + '”');
        bits.push('kind ' + e.eventKind);
        return bits.join(' · ');
      }
      if (e.type === 'webhook') {
        return 'ep=' + shortId(e.webhookEndpointId) +
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

    // --- settings (webhooks) ---
    const refreshWebhooks = async () => {
      qs('#hook-error').textContent = '';
      try {
        const [hooks, conns] = await Promise.all([
          api('/api/v1/webhooks'),
          api('/api/v1/nwc-connections')
        ]);
        // populate NWC select
        const select = qs('#hook-nwc-select');
        const currentValue = select.value;
        select.innerHTML = '<option value="__ALL__">— apply to all connections —</option>' +
          conns.map(c => '<option value="' + escape(c.id) + '">' + escape(c.label) + '</option>').join('');
        if (currentValue) select.value = currentValue;

        qs('#hook-rows').innerHTML = hooks.length === 0
          ? '<tr><td colspan="6" class="empty">no webhooks configured</td></tr>'
          : hooks.map(h => {
            const label = h.nwcConnection?.label ?? shortId(h.nwcConnectionId);
            return '<tr>' +
              '<td class="mono" style="max-width: 320px; overflow: hidden; text-overflow: ellipsis;">' + escape(h.url) + '</td>' +
              '<td>' + escape(label) + '</td>' +
              '<td class="mono muted">' + (h.eventKinds || []).join(',') + '</td>' +
              '<td>' + (h.enabled ? '<span class="pill ok">enabled</span>' : '<span class="pill warn">disabled</span>') + '</td>' +
              '<td class="muted">' + new Date(h.createdAt).toLocaleString() + '</td>' +
              '<td>' +
                '<button class="btn-small" data-hook-test="' + h.id + '">test</button> ' +
                '<button class="btn-small danger" data-hook-delete="' + h.id + '">delete</button>' +
              '</td>' +
            '</tr>';
          }).join('');
        qsa('[data-hook-test]').forEach(b => {
          b.onclick = async () => {
            const prev = b.textContent; b.textContent = 'firing…'; b.disabled = true;
            try {
              await api('/api/v1/webhooks/' + b.dataset.hookTest + '/test', { method: 'POST' });
              b.textContent = 'sent';
              setTimeout(() => { b.textContent = prev; b.disabled = false; }, 1200);
            } catch (err) {
              qs('#hook-error').textContent = err.message;
              b.textContent = prev; b.disabled = false;
            }
          };
        });
        qsa('[data-hook-delete]').forEach(b => {
          b.onclick = async () => {
            if (!confirm('Delete this webhook?')) return;
            try {
              await api('/api/v1/webhooks/' + b.dataset.hookDelete, { method: 'DELETE' });
              refreshWebhooks();
            } catch (err) { qs('#hook-error').textContent = err.message; }
          };
        });
      } catch (err) {
        qs('#hook-error').textContent = err.message;
      }
    };
    qs('#hook-form').onsubmit = async ev => {
      ev.preventDefault();
      qs('#hook-error').textContent = '';
      qs('#hook-ok').textContent = '';
      const btn = qs('#hook-form button[type=submit]');
      btn.disabled = true;
      const form = new FormData(ev.target);
      const url = form.get('url');
      const nwcChoice = form.get('nwcConnectionId');
      try {
        if (nwcChoice === '__ALL__') {
          const conns = await api('/api/v1/nwc-connections');
          if (conns.length === 0) throw new Error('No NWC connections to attach to');
          let created = 0;
          for (const c of conns) {
            await api('/api/v1/webhooks', {
              method: 'POST',
              body: JSON.stringify({ nwcConnectionId: c.id, url })
            });
            created++;
          }
          qs('#hook-ok').textContent = 'created ' + created + ' webhook' + (created === 1 ? '' : 's');
        } else {
          const w = await api('/api/v1/webhooks', {
            method: 'POST',
            body: JSON.stringify({ nwcConnectionId: nwcChoice, url })
          });
          qs('#hook-ok').textContent = 'created webhook ' + w.id;
        }
        ev.target.reset();
        refreshWebhooks();
      } catch (err) {
        qs('#hook-error').textContent = err.message;
      } finally {
        btn.disabled = false;
      }
    };

    // --- invoice modal ---
    let currentInvoiceNwcId = null;
    const openInvoiceModal = (nwcId, label) => {
      currentInvoiceNwcId = nwcId;
      qs('#invoice-title').textContent = 'Generate invoice · ' + (label || '');
      qs('#invoice-form').style.display = 'flex';
      qs('#invoice-form').reset();
      qs('#invoice-error').textContent = '';
      qs('#invoice-result').style.display = 'none';
      qs('#invoice-modal').classList.add('open');
      qs('#invoice-form [name=amountSats]').focus();
    };
    const closeInvoiceModal = () => {
      qs('#invoice-modal').classList.remove('open');
      currentInvoiceNwcId = null;
    };
    qs('#invoice-close').onclick = closeInvoiceModal;
    qs('#invoice-modal').addEventListener('click', ev => {
      if (ev.target === qs('#invoice-modal')) closeInvoiceModal();
    });
    qs('#invoice-form').onsubmit = async ev => {
      ev.preventDefault();
      qs('#invoice-error').textContent = '';
      const btn = qs('#invoice-form button[type=submit]');
      btn.disabled = true;
      btn.textContent = 'generating…';
      const form = new FormData(ev.target);
      try {
        const result = await api('/api/v1/nwc-connections/' + currentInvoiceNwcId + '/make-invoice', {
          method: 'POST',
          body: JSON.stringify({
            amountSats: parseInt(form.get('amountSats'), 10),
            description: form.get('description') || undefined
          })
        });
        qs('#invoice-form').style.display = 'none';
        qs('#invoice-qr').innerHTML = result.qrSvg;
        qs('#invoice-bolt11').textContent = result.invoice;
        const metaParts = [
          '<b>' + result.amountSats.toLocaleString() + '</b> sats'
        ];
        if (result.expiresAt) {
          metaParts.push('expires ' + new Date(result.expiresAt * 1000).toLocaleTimeString());
        }
        if (result.paymentHash) {
          metaParts.push('hash ' + shortHex(result.paymentHash));
        }
        qs('#invoice-meta').innerHTML = metaParts.join(' · ');
        qs('#invoice-result').style.display = 'block';
      } catch (err) {
        qs('#invoice-error').textContent = err.message;
      } finally {
        btn.disabled = false;
        btn.textContent = 'Generate';
      }
    };
    qs('#invoice-copy').onclick = async () => {
      const text = qs('#invoice-bolt11').textContent;
      try {
        await navigator.clipboard.writeText(text);
        const f = qs('#invoice-copied');
        f.classList.add('show');
        setTimeout(() => f.classList.remove('show'), 1200);
      } catch {}
    };

    const renderInfoText = info => {
      if (!info.found) {
        return 'No kind-13194 info event was returned by any of the wallet\\'s relays.\\n\\n' +
          'Possible causes:\\n' +
          '  • The wallet is offline\\n' +
          '  • The wallet\\'s pubkey or relay URL in the NWC URI is wrong\\n' +
          '  • The wallet never publishes a NIP-47 info event';
      }
      const lines = [
        'Wallet info — kind-13194',
        '',
        'Supported methods:',
        info.supportedMethods.length ? '  ' + info.supportedMethods.join(', ') : '  (none listed)',
        '',
        'Notifications advertised:',
        info.notifications.length ? '  ' + info.notifications.join(', ') : '  ⚠ NONE — this wallet will not push live events',
        '',
        'Encryption:',
        '  ' + (info.encryption.length ? info.encryption.join(', ') : '(not specified → NIP-04 only)'),
        '',
        'Published ' + (info.createdAt ? new Date(info.createdAt * 1000).toLocaleString() : '—')
      ];
      return lines.join('\\n');
    };
    const shortHex = s => typeof s === 'string' && s.length > 12 ? s.slice(0, 8) + '…' + s.slice(-4) : (s || '');
    const shortId = s => typeof s === 'string' && s.length > 10 ? s.slice(0, 6) + '…' : (s || '');
    const escape = s => String(s ?? '').replace(/[&<>\"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    const refreshAll = () => {
      refreshMode();
      refreshStatus();
      refreshConnections();
      refreshWebhooks();
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
