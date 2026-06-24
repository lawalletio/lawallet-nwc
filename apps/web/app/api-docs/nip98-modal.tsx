'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { NostrSigner } from '@nostrify/nostrify'
import { createBrowserSigner } from '@/lib/client/nostr-signer'
import { createNip98Token } from '@/lib/nip98-client'

export interface Nip98ModalProps {
  method: string
  path: string
  defaultBody?: string
  onClose: () => void
}

interface SendResult {
  status: number
  statusText: string
  body: string
}

export function Nip98Modal({ method, path, defaultBody, onClose }: Nip98ModalProps) {
  const [signer, setSigner] = useState<NostrSigner | null>(null)
  const [pubkey, setPubkey] = useState<string | null>(null)
  const [body, setBody] = useState(defaultBody ?? '')
  const [authHeader, setAuthHeader] = useState<string | null>(null)
  const [response, setResponse] = useState<SendResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<'connect' | 'sign' | 'send' | null>(null)
  const dialogRef = useRef<HTMLDivElement>(null)

  const bodyRequired = method !== 'GET' && method !== 'DELETE' && method !== 'HEAD'

  // Auto-connect on mount: if a NIP-07 extension is present the user almost
  // certainly opened this modal to sign, so save them a click.
  useEffect(() => {
    if (typeof window === 'undefined' || !(window as { nostr?: unknown }).nostr) return
    void connect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Esc to close
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function connect() {
    setError(null)
    setBusy('connect')
    try {
      const s = createBrowserSigner()
      const pk = await s.getPublicKey()
      setSigner(s)
      setPubkey(pk)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  async function sign() {
    setError(null)
    setResponse(null)
    if (!signer) {
      setError('Connect to a Nostr browser extension first.')
      return
    }
    setBusy('sign')
    try {
      const url = new URL(path, window.location.origin).toString()
      const init: RequestInit = { method }
      if (bodyRequired && body.trim()) init.body = body
      setAuthHeader(await createNip98Token(url, init, signer))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  async function send() {
    setError(null)
    setResponse(null)
    if (!authHeader) {
      setError('Sign the request first.')
      return
    }
    setBusy('send')
    try {
      const init: RequestInit = {
        method,
        headers: {
          Authorization: authHeader,
          'Content-Type': 'application/json',
        },
      }
      if (bodyRequired && body.trim()) init.body = body
      const res = await fetch(path, init)
      const text = await res.text()
      setResponse({
        status: res.status,
        statusText: res.statusText,
        body: tryFormatJson(text),
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  async function copy() {
    if (!authHeader) return
    await navigator.clipboard.writeText(authHeader)
  }

  // All inline styles use Scalar's CSS custom properties so the modal blends
  // with whatever theme Scalar is rendering (light / dark, custom).
  const modal = (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="nip98-modal-title"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.55)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        padding: '5vh 1rem',
        zIndex: 9999,
        backdropFilter: 'blur(2px)',
      }}
    >
      <div
        ref={dialogRef}
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--scalar-background-1)',
          color: 'var(--scalar-color-1)',
          border: '1px solid var(--scalar-border-color)',
          borderRadius: 12,
          width: 'min(640px, 100%)',
          maxHeight: '90vh',
          overflow: 'auto',
          fontFamily: 'var(--scalar-font, inherit)',
          fontSize: 14,
          boxShadow: '0 24px 64px rgba(0,0,0,0.35)',
        }}
      >
        <header
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '16px 20px',
            borderBottom: '1px solid var(--scalar-border-color)',
          }}
        >
          <div>
            <h2
              id="nip98-modal-title"
              style={{ margin: 0, fontSize: 16, fontWeight: 600 }}
            >
              Sign with NIP-07
            </h2>
            <p
              style={{
                margin: '4px 0 0',
                fontSize: 12,
                color: 'var(--scalar-color-2)',
              }}
            >
              Build a NIP-98 signed request using your browser&apos;s Nostr
              extension.
            </p>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            style={iconBtnStyle()}
          >
            ×
          </button>
        </header>

        <div style={{ padding: 20, display: 'grid', gap: 16 }}>
          <RowGrid>
            <LabelText>Method</LabelText>
            <code style={codeChipStyle()}>{method}</code>
            <LabelText>Path</LabelText>
            <code style={codeChipStyle()}>{path}</code>
          </RowGrid>

          <div>
            <LabelText>Connection</LabelText>
            <div
              style={{
                marginTop: 6,
                display: 'flex',
                alignItems: 'center',
                gap: 12,
              }}
            >
              {signer && pubkey ? (
                <>
                  <span style={dotStyle('var(--scalar-color-green, #22c55e)')} />
                  <span style={{ fontSize: 13 }}>
                    Connected as{' '}
                    <code style={inlineCodeStyle()}>
                      {pubkey.slice(0, 8)}…{pubkey.slice(-8)}
                    </code>
                  </span>
                </>
              ) : (
                <button
                  type="button"
                  onClick={connect}
                  disabled={busy !== null}
                  style={btnStyle('outline')}
                >
                  {busy === 'connect' ? 'Connecting…' : 'Connect browser extension'}
                </button>
              )}
            </div>
          </div>

          {bodyRequired && (
            <div>
              <LabelText>Body (JSON, optional)</LabelText>
              <textarea
                value={body}
                onChange={e => setBody(e.target.value)}
                rows={4}
                spellCheck={false}
                style={inputStyle({ font: 'mono' })}
              />
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={sign}
              disabled={!signer || busy !== null}
              style={btnStyle('primary')}
            >
              {busy === 'sign' ? 'Signing…' : 'Sign'}
            </button>
            <button
              type="button"
              onClick={send}
              disabled={!authHeader || busy !== null}
              style={btnStyle('secondary')}
            >
              {busy === 'send' ? 'Sending…' : 'Send request'}
            </button>
            <button
              type="button"
              onClick={copy}
              disabled={!authHeader}
              style={btnStyle('outline')}
            >
              Copy header
            </button>
          </div>

          {authHeader && (
            <div>
              <LabelText>Authorization header</LabelText>
              <textarea
                readOnly
                value={authHeader}
                rows={3}
                style={inputStyle({ font: 'mono', readonly: true })}
              />
            </div>
          )}

          {response && (
            <div>
              <LabelText>
                Response —{' '}
                <span
                  style={{
                    color:
                      response.status < 400
                        ? 'var(--scalar-color-green, #22c55e)'
                        : 'var(--scalar-color-red, #ef4444)',
                  }}
                >
                  {response.status} {response.statusText}
                </span>
              </LabelText>
              <textarea
                readOnly
                value={response.body}
                rows={8}
                style={inputStyle({ font: 'mono', readonly: true })}
              />
            </div>
          )}

          {error && (
            <div
              role="alert"
              style={{
                padding: '10px 12px',
                borderRadius: 8,
                border: '1px solid var(--scalar-color-red, #ef4444)',
                background: 'color-mix(in srgb, var(--scalar-color-red, #ef4444) 12%, transparent)',
                color: 'var(--scalar-color-red, #ef4444)',
                fontSize: 13,
              }}
            >
              {error}
            </div>
          )}
        </div>
      </div>
    </div>
  )

  if (typeof document === 'undefined') return null
  return createPortal(modal, document.body)
}

// ── Styling helpers (kept in this file to avoid leaking into the project's
// shadcn/ui tokens — the modal must stay aligned with Scalar's own theme). ──

function LabelText({ children }: { children: React.ReactNode }) {
  return (
    <label
      style={{
        display: 'block',
        fontSize: 12,
        fontWeight: 600,
        color: 'var(--scalar-color-2)',
        textTransform: 'uppercase',
        letterSpacing: 0.4,
      }}
    >
      {children}
    </label>
  )
}

function RowGrid({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'auto 1fr',
        rowGap: 6,
        columnGap: 12,
        alignItems: 'center',
      }}
    >
      {children}
    </div>
  )
}

function inputStyle({
  font = 'sans',
  readonly = false,
}: {
  font?: 'sans' | 'mono'
  readonly?: boolean
} = {}): React.CSSProperties {
  return {
    width: '100%',
    marginTop: 6,
    padding: '8px 10px',
    background: readonly
      ? 'var(--scalar-background-2)'
      : 'var(--scalar-background-2)',
    color: 'var(--scalar-color-1)',
    border: '1px solid var(--scalar-border-color)',
    borderRadius: 6,
    fontSize: 12,
    fontFamily:
      font === 'mono'
        ? 'var(--scalar-font-code, ui-monospace, SFMono-Regular, Menlo, monospace)'
        : 'var(--scalar-font, inherit)',
    resize: 'vertical',
    outline: 'none',
  }
}

function btnStyle(
  variant: 'primary' | 'secondary' | 'outline',
): React.CSSProperties {
  const base: React.CSSProperties = {
    padding: '8px 14px',
    borderRadius: 6,
    fontSize: 13,
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'opacity 120ms',
    border: '1px solid transparent',
  }
  if (variant === 'primary') {
    return {
      ...base,
      background: 'var(--scalar-button-1, var(--scalar-color-accent))',
      color: 'var(--scalar-button-1-color, white)',
    }
  }
  if (variant === 'secondary') {
    return {
      ...base,
      background: 'var(--scalar-background-3)',
      color: 'var(--scalar-color-1)',
      border: '1px solid var(--scalar-border-color)',
    }
  }
  return {
    ...base,
    background: 'transparent',
    color: 'var(--scalar-color-1)',
    border: '1px solid var(--scalar-border-color)',
  }
}

function iconBtnStyle(): React.CSSProperties {
  return {
    width: 28,
    height: 28,
    fontSize: 20,
    lineHeight: 1,
    border: '1px solid var(--scalar-border-color)',
    background: 'transparent',
    color: 'var(--scalar-color-2)',
    borderRadius: 6,
    cursor: 'pointer',
  }
}

function codeChipStyle(): React.CSSProperties {
  return {
    padding: '2px 8px',
    background: 'var(--scalar-background-2)',
    border: '1px solid var(--scalar-border-color)',
    borderRadius: 4,
    fontSize: 12,
    fontFamily:
      'var(--scalar-font-code, ui-monospace, SFMono-Regular, Menlo, monospace)',
    width: 'fit-content',
  }
}

function inlineCodeStyle(): React.CSSProperties {
  return {
    padding: '1px 5px',
    background: 'var(--scalar-background-2)',
    borderRadius: 3,
    fontSize: 12,
    fontFamily:
      'var(--scalar-font-code, ui-monospace, SFMono-Regular, Menlo, monospace)',
  }
}

function dotStyle(color: string): React.CSSProperties {
  return {
    display: 'inline-block',
    width: 8,
    height: 8,
    borderRadius: '50%',
    background: color,
  }
}

function tryFormatJson(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2)
  } catch {
    return text
  }
}
