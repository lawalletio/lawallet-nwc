import { once } from 'node:events'
import http from 'node:http'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_TARGET = 'http://127.0.0.1:3100'
const DEFAULT_HOST = '127.0.0.1'

const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'content-encoding',
  'content-length',
  'host',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
])

function normalizeTarget(value) {
  const raw = value?.trim() || DEFAULT_TARGET
  const url = new URL(raw)
  url.pathname = ''
  url.search = ''
  url.hash = ''
  return url.toString().replace(/\/+$/, '')
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
  })
  res.end(payload)
}

function sendText(res, status, body, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(status, {
    'content-type': contentType,
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

function readBody(req) {
  return new Promise((resolveBody, reject) => {
    const chunks = []
    req.on('data', chunk => chunks.push(chunk))
    req.on('end', () => resolveBody(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

async function readJson(req) {
  const body = await readBody(req)
  if (body.length === 0) return null
  return JSON.parse(body.toString('utf8'))
}

function responseHeaders(upstream) {
  const headers = {}
  upstream.headers.forEach((value, key) => {
    if (!HOP_BY_HOP_HEADERS.has(key.toLowerCase())) {
      headers[key] = value
    }
  })
  return headers
}

function requestHeaders(req) {
  const headers = new Headers()
  for (const [key, value] of Object.entries(req.headers)) {
    if (HOP_BY_HOP_HEADERS.has(key.toLowerCase()) || value === undefined) continue
    headers.set(key, Array.isArray(value) ? value.join(', ') : value)
  }
  if (req.headers.host) {
    headers.set('x-forwarded-host', req.headers.host)
  }
  headers.set('x-forwarded-proto', 'https')
  headers.set('x-lawallet-domain-tester', '1')
  return headers
}

function statusFor(server, state) {
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : null
  return {
    rewriteEnabled: state.rewriteEnabled,
    target: state.target,
    port,
    localUrl: port ? `http://${state.host}:${port}` : null,
  }
}

function renderIndex(state, status) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>LaWallet Domain Tester</title>
  <style>
    :root { color-scheme: light dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #101820; color: #f7fafc; }
    main { width: min(520px, calc(100vw - 32px)); border: 1px solid #30445a; border-radius: 8px; padding: 24px; background: #162332; }
    h1 { margin: 0 0 16px; font-size: 20px; }
    dl { display: grid; grid-template-columns: max-content 1fr; gap: 10px 16px; margin: 0 0 20px; }
    dt { color: #9fb3c8; }
    dd { margin: 0; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; overflow-wrap: anywhere; }
    button { border: 0; border-radius: 6px; padding: 10px 14px; font-weight: 700; cursor: pointer; }
    .on { background: #22c55e; color: #052e16; }
    .off { background: #f59e0b; color: #451a03; }
  </style>
</head>
<body>
  <main>
    <h1>LaWallet Domain Tester</h1>
    <dl>
      <dt>Rewrite</dt><dd id="rewrite">${state.rewriteEnabled ? 'enabled' : 'disabled'}</dd>
      <dt>Target</dt><dd>${state.target}</dd>
      <dt>Local</dt><dd>${status.localUrl ?? 'starting'}</dd>
    </dl>
    <button id="toggle" class="${state.rewriteEnabled ? 'off' : 'on'}">
      ${state.rewriteEnabled ? 'Disable .well-known rewrite' : 'Enable .well-known rewrite'}
    </button>
  </main>
  <script>
    document.getElementById('toggle').addEventListener('click', async () => {
      const current = document.getElementById('rewrite').textContent === 'enabled'
      await fetch('/__control/rewrite', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled: !current }),
      })
      location.reload()
    })
  </script>
</body>
</html>`
}

async function proxyWellKnown(req, res, state) {
  if (!state.rewriteEnabled) {
    sendJson(res, 404, {
      error: 'well-known rewrite disabled',
      service: 'lawallet-domain-tester',
    })
    return
  }

  const incoming = new URL(req.url ?? '/', 'http://domain-tester.local')
  const upstreamUrl = new URL(incoming.pathname + incoming.search, `${state.target}/`)
  const method = req.method ?? 'GET'
  const init = {
    method,
    headers: requestHeaders(req),
  }

  if (method !== 'GET' && method !== 'HEAD') {
    init.body = await readBody(req)
  }

  const upstream = await fetch(upstreamUrl, init)
  const body = method === 'HEAD' ? null : Buffer.from(await upstream.arrayBuffer())
  res.writeHead(upstream.status, responseHeaders(upstream))
  res.end(body)
}

export function createDomainTesterServer(options = {}) {
  const state = {
    host: options.host ?? process.env.DOMAIN_TESTER_HOST ?? DEFAULT_HOST,
    rewriteEnabled:
      options.rewriteEnabled ??
      ['1', 'true', 'yes'].includes((process.env.REWRITE_ENABLED ?? '').toLowerCase()),
    target: normalizeTarget(options.target ?? process.env.LAWALLET_TARGET ?? process.env.E2E_BASE_URL),
  }

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://domain-tester.local')

      if (req.method === 'GET' && url.pathname === '/') {
        sendText(res, 200, renderIndex(state, statusFor(server, state)), 'text/html; charset=utf-8')
        return
      }

      if (req.method === 'GET' && url.pathname === '/__control/status') {
        sendJson(res, 200, statusFor(server, state))
        return
      }

      if (url.pathname === '/__control/rewrite') {
        if (req.method !== 'POST') {
          sendJson(res, 405, { error: 'method not allowed' })
          return
        }
        const body = await readJson(req)
        if (typeof body?.enabled !== 'boolean') {
          sendJson(res, 400, { error: 'enabled must be a boolean' })
          return
        }
        state.rewriteEnabled = body.enabled
        sendJson(res, 200, statusFor(server, state))
        return
      }

      if (url.pathname.startsWith('/.well-known/')) {
        await proxyWellKnown(req, res, state)
        return
      }

      sendJson(res, 404, { error: 'not found' })
    } catch (error) {
      sendJson(res, 500, {
        error: error instanceof Error ? error.message : 'unexpected domain tester error',
      })
    }
  })

  return { server, state, getStatus: () => statusFor(server, state) }
}

export async function listen(server, { host = DEFAULT_HOST, port = 0 } = {}) {
  server.listen(port, host)
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address !== 'object') {
    throw new Error('Domain tester did not bind to a TCP port')
  }
  return {
    port: address.port,
    localUrl: `http://${host}:${address.port}`,
  }
}

export async function closeServer(server) {
  if (!server.listening) return
  server.close()
  await once(server, 'close')
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || process.env.DOMAIN_TESTER_PORT || 0)
  const host = process.env.DOMAIN_TESTER_HOST || DEFAULT_HOST
  const { server, getStatus } = createDomainTesterServer({ host })
  await listen(server, { host, port })
  console.log(`Domain tester listening: ${JSON.stringify(getStatus())}`)
}
