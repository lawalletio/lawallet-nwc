'use client'

import { useEffect, useMemo, useState } from 'react'
import { ApiReferenceReact } from '@scalar/api-reference-react'
import '@scalar/api-reference-react/style.css'
import { Nip98Modal } from './nip98-modal'
import { ServerSelector, loadStoredServer } from './server-selector'
import { Nip07Connect, type Nip07Connection } from './nip07-connect'
import { createNip98Token } from '@/lib/nip98'

type RequiredRole = 'PUBLIC' | 'USER' | 'VIEWER' | 'OPERATOR' | 'ADMIN'

interface OpenedOperation {
  method: string
  path: string
  defaultBody?: string
}

interface OperationMeta {
  /** The Scalar DOM id for the operation panel — `api-1/tag/<tag>/<METHOD><path>`. */
  domId: string
  method: string
  path: string
  /** Operation summary — used to match Scalar's sidebar buttons (no aria-controls). */
  summary: string
  role: RequiredRole
  acceptsNip98: boolean
  defaultBody?: string
}

// Slug rule Scalar uses to build tag anchors: lowercase + spaces → hyphens.
function slugTag(tag: string): string {
  return tag.toLowerCase().replace(/\s+/g, '-')
}

// Build a sample JSON body from a JSON-Schema fragment. Pretty crude — handles
// the shapes our schemas use (object / string / number / boolean / enum, plus
// $ref dereferencing into components.schemas) which is enough to give the user
// a starting point.
function sampleFromSchema(
  schema: unknown,
  spec: Record<string, unknown>,
  seen = new Set<string>(),
): unknown {
  if (!schema || typeof schema !== 'object') return undefined
  const s = schema as Record<string, unknown>

  if (typeof s.$ref === 'string') {
    if (seen.has(s.$ref)) return undefined
    seen.add(s.$ref)
    const target = resolveRef(spec, s.$ref)
    return target ? sampleFromSchema(target, spec, seen) : undefined
  }

  if (Array.isArray(s.enum) && s.enum.length > 0) return s.enum[0]
  if (s.example !== undefined) return s.example
  if (s.default !== undefined) return s.default
  switch (s.type) {
    case 'string':
      return ''
    case 'number':
    case 'integer':
      return 0
    case 'boolean':
      return false
    case 'array':
      return []
    case 'object':
    default: {
      if (s.properties && typeof s.properties === 'object') {
        const out: Record<string, unknown> = {}
        for (const [k, v] of Object.entries(s.properties as Record<string, unknown>)) {
          out[k] = sampleFromSchema(v, spec, seen)
        }
        return out
      }
      return {}
    }
  }
}

function resolveRef(spec: Record<string, unknown>, ref: string): unknown {
  if (!ref.startsWith('#/')) return undefined
  const parts = ref.slice(2).split('/')
  let cur: unknown = spec
  for (const part of parts) {
    if (cur && typeof cur === 'object') {
      cur = (cur as Record<string, unknown>)[part]
    } else {
      return undefined
    }
  }
  return cur
}

function defaultBodyFor(
  operation: Record<string, unknown>,
  spec: Record<string, unknown>,
): string | undefined {
  const requestBody = operation.requestBody as
    | { content?: Record<string, { schema?: unknown }> }
    | undefined
  const schema = requestBody?.content?.['application/json']?.schema
  if (!schema) return undefined
  const sample = sampleFromSchema(schema, spec)
  if (sample === undefined) return undefined
  try {
    return JSON.stringify(sample, null, 2)
  } catch {
    return undefined
  }
}

const ROLE_COLORS: Record<RequiredRole, string> = {
  PUBLIC: 'var(--scalar-color-green)',
  USER: 'var(--scalar-color-blue)',
  VIEWER: 'var(--scalar-color-purple)',
  OPERATOR: 'var(--scalar-color-orange)',
  ADMIN: 'var(--scalar-color-red)',
}

const ROLE_TITLES: Record<RequiredRole, string> = {
  PUBLIC: 'No authentication required',
  USER: 'Any authenticated user',
  VIEWER: 'Requires VIEWER role or higher',
  OPERATOR: 'Requires OPERATOR role or higher',
  ADMIN: 'Requires ADMIN role',
}

function sidebarKey(method: string, summary: string): string {
  return `${method.toUpperCase()} ${summary.replace(/\s+/g, ' ').trim()}`
}

function isRequiredRole(value: unknown): value is RequiredRole {
  return (
    value === 'PUBLIC' ||
    value === 'USER' ||
    value === 'VIEWER' ||
    value === 'OPERATOR' ||
    value === 'ADMIN'
  )
}

export function ApiDocsClient() {
  const [opened, setOpened] = useState<OpenedOperation | null>(null)
  const [ops, setOps] = useState<OperationMeta[]>([])
  const [localUrl, setLocalUrl] = useState<string>('')
  const [serverUrl, setServerUrl] = useState<string>('')
  const [connection, setConnection] = useState<Nip07Connection | null>(null)

  // Initialize server URL from localStorage on mount; default to the host
  // this docs page is served from.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const local = window.location.origin
    setLocalUrl(local)
    setServerUrl(loadStoredServer() ?? local)
  }, [])

  // Spec URL passed to Scalar — when serverUrl differs from the default,
  // append it as a query so the route generator embeds it in the doc.
  const specUrl = useMemo(() => {
    if (!serverUrl || !localUrl) return '/api/openapi.json'
    if (serverUrl === localUrl) return '/api/openapi.json'
    return `/api/openapi.json?serverUrl=${encodeURIComponent(serverUrl)}`
  }, [serverUrl, localUrl])

  // Drop the JWT if the user switches the API server — credentials minted
  // against one host won't be honored by another.
  useEffect(() => {
    if (connection && connection.jwtServerUrl !== serverUrl) {
      setConnection(null)
    }
  }, [serverUrl, connection])

  // Build a quick lookup of `${METHOD} ${path}` for every operation that
  // accepts NIP-98. The fetch interceptor uses this to decide when to swap
  // the Authorization header out for a freshly signed Nostr event.
  const nip98Routes = useMemo(() => {
    const set = new Set<string>()
    for (const op of ops) {
      if (op.acceptsNip98) set.add(`${op.method} ${op.path}`)
    }
    return set
  }, [ops])

  // Install a global fetch interceptor while connected. Any request whose
  // URL matches a NIP-98-capable operation gets its Authorization header
  // replaced with a fresh signed Nostr event. Bearer-JWT routes are left
  // untouched since Scalar already attaches the JWT we set as a preset.
  useEffect(() => {
    if (!connection || nip98Routes.size === 0) return
    const originalFetch = window.fetch.bind(window)
    window.fetch = async (input, init) => {
      try {
        const req = normalizeRequest(input, init)
        if (req && shouldAutoSign(req, nip98Routes)) {
          const signed = await createNip98Token(
            req.url,
            { method: req.method, body: req.bodyForHash },
            connection.signer,
          )
          req.headers.set('Authorization', signed)
          return originalFetch(req.url, {
            method: req.method,
            headers: req.headers,
            body: req.realBody,
          })
        }
      } catch {
        // Fall through to the original fetch — never fail the user's request
        // just because our auto-sign helper threw.
      }
      return originalFetch(input as RequestInfo, init)
    }
    return () => {
      window.fetch = originalFetch
    }
  }, [connection, nip98Routes])

  // Step 1: load the spec, extract role + nip98 metadata for every operation,
  // and remember the Scalar DOM id we'll later inject badges into.
  useEffect(() => {
    if (!specUrl) return
    let cancelled = false
    fetch(specUrl)
      .then(r => r.json())
      .then((spec: Record<string, unknown>) => {
        if (cancelled) return
        const out: OperationMeta[] = []
        const paths = (spec.paths ?? {}) as Record<string, Record<string, unknown>>
        for (const [path, methods] of Object.entries(paths)) {
          for (const [method, opUnknown] of Object.entries(methods)) {
            if (!['get', 'post', 'put', 'delete', 'patch', 'options'].includes(method))
              continue
            const op = opUnknown as Record<string, unknown>
            const role = op['x-required-role']
            if (!isRequiredRole(role)) continue
            const security = op.security as Array<Record<string, unknown>> | undefined
            const acceptsNip98 = !!security?.some(entry => 'NIP98' in entry)
            const tag = (op.tags as string[] | undefined)?.[0] ?? 'default'
            const domId = `api-1/tag/${slugTag(tag)}/${method.toUpperCase()}${path}`
            out.push({
              domId,
              method: method.toUpperCase(),
              path,
              summary: typeof op.summary === 'string' ? op.summary : '',
              role,
              acceptsNip98,
              defaultBody: defaultBodyFor(op, spec),
            })
          }
        }
        setOps(out)
      })
      .catch(() => {
        // If the spec can't be loaded, the badges/modal are unavailable —
        // Scalar itself still works.
      })
    return () => {
      cancelled = true
    }
  }, [specUrl])

  // Step 2: watch the DOM for Scalar mounting operation panels (it lazy-renders
  // on scroll), then inject:
  //   - a colored role badge next to the operation title
  //   - a "Sign with NIP-07" trigger next to the Auth Required badge (only for
  //     operations that actually accept NIP-98)
  useEffect(() => {
    if (ops.length === 0) return

    const ROLE_MARKER = 'data-role-badge'
    const SIDEBAR_MARKER = 'data-role-badge-sidebar'
    const TRIGGER_MARKER = 'data-nip98-trigger'

    // Sidebar buttons don't carry an op id we can target, so build a lookup
    // by `${METHOD} ${summary}` — collisions are unlikely since each op has
    // a unique summary within its method.
    const opBySidebarKey = new Map<string, OperationMeta>()
    for (const op of ops) {
      if (!op.summary) continue
      opBySidebarKey.set(sidebarKey(op.method, op.summary), op)
    }

    function inject() {
      for (const op of ops) {
        const panel = document.getElementById(op.domId)
        if (!panel) continue
        injectRoleBadge(panel, op)
        if (op.acceptsNip98) injectNip98Trigger(panel, op)
      }
      injectSidebarBadges(opBySidebarKey)
    }

    function injectRoleBadge(panel: HTMLElement, op: OperationMeta) {
      if (panel.querySelector(`[${ROLE_MARKER}]`)) return
      const heading = panel.querySelector('h3, h2')
      if (!heading) return

      const badge = document.createElement('span')
      badge.setAttribute(ROLE_MARKER, '')
      badge.title = ROLE_TITLES[op.role]
      badge.style.cssText = [
        'display: inline-flex',
        'align-items: center',
        'gap: 4px',
        'padding: 2px 10px',
        'margin-left: 10px',
        'border-radius: 4px',
        `border: 1px solid color-mix(in srgb, ${ROLE_COLORS[op.role]} 60%, transparent)`,
        `background: color-mix(in srgb, ${ROLE_COLORS[op.role]} 18%, transparent)`,
        `color: ${ROLE_COLORS[op.role]}`,
        'font-size: 11px',
        'font-weight: 600',
        'letter-spacing: 0.4px',
        'vertical-align: middle',
        'white-space: nowrap',
      ].join(';')
      badge.textContent = op.role
      heading.appendChild(badge)
    }

    function injectSidebarBadges(lookup: Map<string, OperationMeta>) {
      // Each Scalar sidebar operation entry is a `<button>` whose label text
      // is the operation summary, with an HTTP-method chip styled via the
      // `sidebar-heading-type--<method>` class. We use both signals to find
      // the matching op, then append a small colored monogram next to the
      // method chip.
      const buttons = document.querySelectorAll<HTMLButtonElement>(
        'aside button:not([' + SIDEBAR_MARKER + '-applied])',
      )
      for (const btn of buttons) {
        const methodSpan = btn.querySelector<HTMLSpanElement>(
          'span[class*="sidebar-heading-type--"]',
        )
        if (!methodSpan) continue
        const methodMatch = methodSpan.className.match(/sidebar-heading-type--(\w+)/)
        if (!methodMatch) continue
        const method = methodMatch[1].toUpperCase()
        const labelEl = btn.querySelector<HTMLDivElement>('.group\\/button-label')
        const summary = (labelEl?.textContent || '').trim()
        if (!summary) continue

        const op = lookup.get(sidebarKey(method, summary))
        if (!op) continue

        // Mark so we don't re-process even if we don't find a match later.
        btn.setAttribute(SIDEBAR_MARKER + '-applied', '')

        const chip = document.createElement('span')
        chip.setAttribute(SIDEBAR_MARKER, '')
        chip.title = ROLE_TITLES[op.role]
        // Tinted background + colored text + soft border, matching the panel
        // badge style. Less shouty than a solid chip, blends with Scalar's
        // muted sidebar palette.
        chip.style.cssText = [
          'display: inline-flex',
          'align-items: center',
          'justify-content: center',
          'margin-left: 8px',
          'padding: 1px 6px',
          'border-radius: 3px',
          `background: color-mix(in srgb, ${ROLE_COLORS[op.role]} 14%, transparent)`,
          `border: 1px solid color-mix(in srgb, ${ROLE_COLORS[op.role]} 32%, transparent)`,
          `color: ${ROLE_COLORS[op.role]}`,
          'font-size: 9px',
          'font-weight: 600',
          'letter-spacing: 0.5px',
          'line-height: 1.2',
          'flex-shrink: 0',
          'align-self: start',
          'margin-top: 2px',
          'white-space: nowrap',
        ].join(';')
        chip.textContent = op.role
        // Sit between the label and the method chip — visually "right of the
        // endpoint title", with the method chip pushed to the row's far edge.
        methodSpan.insertAdjacentElement('beforebegin', chip)
      }
    }

    function injectNip98Trigger(panel: HTMLElement, op: OperationMeta) {
      if (panel.querySelector(`[${TRIGGER_MARKER}]`)) return
      const authBadge = panel.querySelector('button.security-requirement-badge')
      if (!authBadge || !authBadge.parentElement) return

      const trigger = document.createElement('button')
      trigger.setAttribute(TRIGGER_MARKER, '')
      trigger.type = 'button'
      // Match Scalar's badge typography so the chip blends in.
      trigger.className =
        'security-requirement-badge inline-flex w-fit items-center justify-center gap-1 text-sm font-medium'
      trigger.style.cssText = [
        'padding: 2px 10px',
        'border-radius: 4px',
        'border: 1px solid var(--scalar-color-accent)',
        'background: color-mix(in srgb, var(--scalar-color-accent) 14%, transparent)',
        'color: var(--scalar-color-accent)',
        'cursor: pointer',
      ].join(';')
      trigger.title = 'Sign this request with a NIP-07 browser extension'
      trigger.textContent = 'Sign with NIP-07'
      trigger.addEventListener('click', e => {
        e.preventDefault()
        e.stopPropagation()
        setOpened({
          method: op.method,
          path: op.path,
          defaultBody: op.defaultBody,
        })
      })

      authBadge.parentElement.insertBefore(trigger, authBadge.nextSibling)
    }

    // Debounce the injector with a microtask-level timer: each badge insert
    // triggers the observer, so without throttling we'd run inject N times
    // per Scalar render. setTimeout fires reliably in backgrounded tabs and
    // headless previews where rAF can stall.
    let timerId: ReturnType<typeof setTimeout> | null = null
    function schedule() {
      if (timerId !== null) return
      timerId = setTimeout(() => {
        timerId = null
        inject()
      }, 16)
    }

    inject()
    const observer = new MutationObserver(schedule)
    observer.observe(document.body, { childList: true, subtree: true })
    window.addEventListener('hashchange', schedule)
    return () => {
      observer.disconnect()
      window.removeEventListener('hashchange', schedule)
      if (timerId !== null) clearTimeout(timerId)
    }
  }, [ops])

  return (
    <div className="min-h-dvh">
      {localUrl && (
        <div
          style={{
            position: 'sticky',
            top: 0,
            zIndex: 50,
            display: 'flex',
            alignItems: 'center',
            gap: 16,
            flexWrap: 'wrap',
            background: 'var(--scalar-background-1)',
            borderBottom: '1px solid var(--scalar-border-color)',
          }}
        >
          <ServerSelector
            localUrl={localUrl}
            value={serverUrl}
            onChange={setServerUrl}
          />
          <Nip07Connect
            serverUrl={serverUrl}
            connection={connection}
            onChange={setConnection}
          />
        </div>
      )}
      {/* `key` forces Scalar to re-mount when the spec URL OR the connected
          JWT changes — the component caches its config internally and won't
          re-fetch otherwise. */}
      {specUrl && (
        <ApiReferenceReact
          key={`${specUrl}|${connection?.jwt ? 'auth' : 'noauth'}`}
          configuration={{
            url: specUrl,
            metaData: { title: 'LaWallet NWC API Reference' },
            authentication: connection?.jwt
              ? {
                  preferredSecurityScheme: 'BearerJWT',
                  securitySchemes: {
                    BearerJWT: { token: connection.jwt },
                  },
                }
              : undefined,
          }}
        />
      )}
      {opened && (
        <Nip98Modal
          method={opened.method}
          path={opened.path}
          defaultBody={opened.defaultBody}
          onClose={() => setOpened(null)}
        />
      )}
    </div>
  )
}

// ── fetch-interceptor helpers ─────────────────────────────────────────────

interface NormalizedRequest {
  url: string
  method: string
  headers: Headers
  /** What we feed back to the underlying `fetch` after rewriting the header. */
  realBody: BodyInit | null | undefined
  /** What we feed to `createNip98Token` for the payload hash. */
  bodyForHash: BodyInit | null | undefined
}

function normalizeRequest(
  input: RequestInfo | URL,
  init?: RequestInit,
): NormalizedRequest | null {
  // Request objects are immutable for body so we can only re-send if we
  // clone first. Skip them — Scalar's Try-It feature uses plain (input, init).
  if (input instanceof Request) {
    return {
      url: input.url,
      method: input.method,
      headers: new Headers(input.headers),
      realBody: undefined,
      bodyForHash: undefined,
    }
  }
  const urlString = typeof input === 'string' ? input : input.toString()
  const method = (init?.method ?? 'GET').toUpperCase()
  const headers = new Headers(init?.headers ?? {})
  return {
    url: urlString,
    method,
    headers,
    realBody: init?.body ?? null,
    bodyForHash: init?.body ?? undefined,
  }
}

function shouldAutoSign(req: NormalizedRequest, nip98Routes: Set<string>): boolean {
  let pathname: string
  try {
    pathname = new URL(req.url, window.location.origin).pathname
  } catch {
    return false
  }
  // Direct match.
  if (nip98Routes.has(`${req.method} ${pathname}`)) return true
  // Match parameterized paths (e.g. /api/cards/{id}) by treating each spec
  // segment that looks like `{xxx}` as a wildcard.
  for (const route of nip98Routes) {
    const [m, p] = route.split(' ')
    if (m !== req.method) continue
    if (matchTemplate(p, pathname)) return true
  }
  return false
}

function matchTemplate(template: string, actual: string): boolean {
  const tParts = template.split('/')
  const aParts = actual.split('/')
  if (tParts.length !== aParts.length) return false
  for (let i = 0; i < tParts.length; i++) {
    const t = tParts[i]
    if (t.startsWith('{') && t.endsWith('}')) continue
    if (t !== aParts[i]) return false
  }
  return true
}
