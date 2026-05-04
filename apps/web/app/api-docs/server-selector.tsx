'use client'

import { useEffect, useRef, useState } from 'react'

export interface ServerOption {
  /** Stable identity used for storage / lookup. */
  id: string
  /** Short label shown in the dropdown. */
  label: string
  /** Full URL Scalar should call. */
  url: string
  /** Built-in (locked) options can't be deleted from the UI. */
  builtIn?: boolean
}

const STORAGE_KEY = 'lawallet-nwc.api-docs.server-selection'
const CUSTOM_KEY = 'lawallet-nwc.api-docs.custom-servers'

const DEFAULTS: ServerOption[] = [
  { id: 'lawallet-prod', label: 'lawallet.io (production)', url: 'https://lawallet.io', builtIn: true },
]

interface Props {
  /** URL of this docs site, used as the default "Local" entry. */
  localUrl: string
  /** Currently selected URL. */
  value: string
  /** Called whenever the user picks a different server. */
  onChange: (url: string) => void
}

interface CustomServer {
  id: string
  label: string
  url: string
}

function loadCustomServers(): CustomServer[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(CUSTOM_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (e): e is CustomServer =>
        e && typeof e.id === 'string' && typeof e.label === 'string' && typeof e.url === 'string',
    )
  } catch {
    return []
  }
}

function saveCustomServers(list: CustomServer[]) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(CUSTOM_KEY, JSON.stringify(list))
  } catch {
    /* ignore quota errors */
  }
}

function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

export function ServerSelector({ localUrl, value, onChange }: Props) {
  const [open, setOpen] = useState(false)
  const [customs, setCustoms] = useState<CustomServer[]>([])
  const [adding, setAdding] = useState(false)
  const [draftLabel, setDraftLabel] = useState('')
  const [draftUrl, setDraftUrl] = useState('')
  const [error, setError] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setCustoms(loadCustomServers())
  }, [])

  // Close on outside click / Esc.
  useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const localOption: ServerOption = {
    id: 'local',
    label: 'Local development',
    url: localUrl,
    builtIn: true,
  }
  const allOptions: ServerOption[] = [
    localOption,
    ...DEFAULTS,
    ...customs.map(c => ({ id: c.id, label: c.label, url: c.url })),
  ]

  function pick(url: string) {
    onChange(url)
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.setItem(STORAGE_KEY, url)
      } catch {
        /* ignore */
      }
    }
    setOpen(false)
  }

  function addCustom() {
    setError(null)
    const url = draftUrl.trim()
    const label = draftLabel.trim() || url
    if (!isHttpUrl(url)) {
      setError('Enter a valid http(s) URL.')
      return
    }
    if (allOptions.some(o => o.url === url)) {
      setError('That server is already in the list.')
      return
    }
    const entry: CustomServer = {
      id: `custom-${Date.now()}`,
      label,
      url,
    }
    const next = [...customs, entry]
    setCustoms(next)
    saveCustomServers(next)
    setDraftLabel('')
    setDraftUrl('')
    setAdding(false)
    pick(url)
  }

  function removeCustom(id: string) {
    const next = customs.filter(c => c.id !== id)
    setCustoms(next)
    saveCustomServers(next)
  }

  const current =
    allOptions.find(o => o.url === value) ??
    ({ id: 'unknown', label: value, url: value } as ServerOption)

  return (
    <div
      ref={rootRef}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        color: 'var(--scalar-color-1)',
        fontFamily: 'var(--scalar-font, inherit)',
        fontSize: 13,
      }}
    >
      <span style={{ color: 'var(--scalar-color-2)', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4, fontWeight: 600 }}>
        API Server
      </span>

      <div style={{ position: 'relative' }}>
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          aria-haspopup="listbox"
          aria-expanded={open}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '4px 10px',
            borderRadius: 6,
            border: '1px solid var(--scalar-border-color)',
            background: 'var(--scalar-background-2)',
            color: 'var(--scalar-color-1)',
            cursor: 'pointer',
            fontFamily: 'var(--scalar-font-code, ui-monospace, SFMono-Regular, Menlo, monospace)',
            fontSize: 12,
            maxWidth: 360,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={current.url}
        >
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{current.url}</span>
          <span aria-hidden style={{ opacity: 0.6 }}>▾</span>
        </button>

        {open && (
          <div
            role="listbox"
            style={{
              position: 'absolute',
              top: '100%',
              left: 0,
              marginTop: 4,
              minWidth: 320,
              maxWidth: 480,
              background: 'var(--scalar-background-1)',
              border: '1px solid var(--scalar-border-color)',
              borderRadius: 8,
              boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
              padding: 4,
              maxHeight: '60vh',
              overflowY: 'auto',
            }}
          >
            {allOptions.map(opt => {
              const selected = opt.url === value
              return (
                <div
                  key={opt.id}
                  style={{ display: 'flex', alignItems: 'center', gap: 4 }}
                >
                  <button
                    type="button"
                    role="option"
                    aria-selected={selected}
                    onClick={() => pick(opt.url)}
                    style={{
                      flex: 1,
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'flex-start',
                      gap: 2,
                      padding: '6px 10px',
                      border: 0,
                      background: selected
                        ? 'color-mix(in srgb, var(--scalar-color-accent) 14%, transparent)'
                        : 'transparent',
                      color: 'var(--scalar-color-1)',
                      borderRadius: 6,
                      cursor: 'pointer',
                      textAlign: 'left',
                    }}
                  >
                    <span style={{ fontSize: 12, fontWeight: 600 }}>
                      {selected ? '✓ ' : ''}
                      {opt.label}
                    </span>
                    <span
                      style={{
                        fontSize: 11,
                        color: 'var(--scalar-color-2)',
                        fontFamily:
                          'var(--scalar-font-code, ui-monospace, SFMono-Regular, Menlo, monospace)',
                      }}
                    >
                      {opt.url}
                    </span>
                  </button>
                  {!opt.builtIn && (
                    <button
                      type="button"
                      onClick={() => removeCustom(opt.id)}
                      title="Remove this custom server"
                      aria-label={`Remove ${opt.label}`}
                      style={{
                        padding: '4px 8px',
                        background: 'transparent',
                        border: '1px solid transparent',
                        color: 'var(--scalar-color-2)',
                        cursor: 'pointer',
                        borderRadius: 6,
                      }}
                    >
                      ×
                    </button>
                  )}
                </div>
              )
            })}

            <div
              style={{ borderTop: '1px solid var(--scalar-border-color)', margin: '4px 0' }}
            />

            {!adding ? (
              <button
                type="button"
                onClick={() => {
                  setError(null)
                  setAdding(true)
                }}
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  padding: '6px 10px',
                  border: 0,
                  background: 'transparent',
                  color: 'var(--scalar-color-accent)',
                  cursor: 'pointer',
                  fontSize: 12,
                  fontWeight: 600,
                  borderRadius: 6,
                }}
              >
                + Add custom server…
              </button>
            ) : (
              <div style={{ padding: 8, display: 'grid', gap: 6 }}>
                <input
                  autoFocus
                  type="text"
                  value={draftLabel}
                  onChange={e => setDraftLabel(e.target.value)}
                  placeholder="Label (optional)"
                  style={inputStyle()}
                />
                <input
                  type="url"
                  value={draftUrl}
                  onChange={e => setDraftUrl(e.target.value)}
                  placeholder="https://api.example.com"
                  style={inputStyle()}
                  onKeyDown={e => {
                    if (e.key === 'Enter') addCustom()
                  }}
                />
                {error && (
                  <div
                    style={{
                      fontSize: 11,
                      color: 'var(--scalar-color-red, #ef4444)',
                    }}
                  >
                    {error}
                  </div>
                )}
                <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                  <button
                    type="button"
                    onClick={() => {
                      setAdding(false)
                      setError(null)
                      setDraftLabel('')
                      setDraftUrl('')
                    }}
                    style={ghostBtnStyle()}
                  >
                    Cancel
                  </button>
                  <button type="button" onClick={addCustom} style={primaryBtnStyle()}>
                    Save & select
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * Look up the user's last picked server URL from localStorage. Returns null
 * if none / SSR / parse error.
 */
export function loadStoredServer(): string | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

function inputStyle(): React.CSSProperties {
  return {
    padding: '6px 8px',
    background: 'var(--scalar-background-2)',
    color: 'var(--scalar-color-1)',
    border: '1px solid var(--scalar-border-color)',
    borderRadius: 6,
    fontSize: 12,
    fontFamily: 'var(--scalar-font, inherit)',
    outline: 'none',
  }
}

function primaryBtnStyle(): React.CSSProperties {
  return {
    padding: '6px 12px',
    border: '1px solid transparent',
    borderRadius: 6,
    background: 'var(--scalar-button-1, var(--scalar-color-accent))',
    color: 'var(--scalar-button-1-color, white)',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
  }
}

function ghostBtnStyle(): React.CSSProperties {
  return {
    padding: '6px 12px',
    border: '1px solid var(--scalar-border-color)',
    borderRadius: 6,
    background: 'transparent',
    color: 'var(--scalar-color-1)',
    fontSize: 12,
    fontWeight: 500,
    cursor: 'pointer',
  }
}
