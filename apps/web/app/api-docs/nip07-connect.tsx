'use client'

import { useState } from 'react'
import type { NostrSigner } from '@nostrify/nostrify'
import { createBrowserSigner } from '@/lib/client/nostr-signer'
import { createNip98Token } from '@/lib/nip98-client'

export interface Nip07Connection {
  signer: NostrSigner
  pubkey: string
  /** JWT minted via NIP-98 against the currently-selected API server. */
  jwt: string
  /** Server URL the JWT was minted against, for invalidation when the server changes. */
  jwtServerUrl: string
}

interface Props {
  /** Current API server (chosen in the ServerSelector). The JWT is minted against this. */
  serverUrl: string
  connection: Nip07Connection | null
  onChange: (next: Nip07Connection | null) => void
}

export function Nip07Connect({ serverUrl, connection, onChange }: Props) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function connect() {
    if (!serverUrl) return
    setError(null)
    setBusy(true)
    try {
      const signer = createBrowserSigner()
      const pubkey = await signer.getPublicKey()
      const jwt = await mintJwt(serverUrl, signer)
      onChange({ signer, pubkey, jwt, jwtServerUrl: serverUrl })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  function disconnect() {
    setError(null)
    onChange(null)
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, position: 'relative' }}>
      {connection ? (
        <>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '4px 10px',
              border: '1px solid color-mix(in srgb, var(--scalar-color-green) 35%, transparent)',
              background: 'color-mix(in srgb, var(--scalar-color-green) 14%, transparent)',
              color: 'var(--scalar-color-green)',
              borderRadius: 6,
              fontSize: 12,
              fontFamily: 'var(--scalar-font-code, ui-monospace, SFMono-Regular, Menlo, monospace)',
              fontWeight: 600,
              maxWidth: 220,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
            title={`Connected as ${connection.pubkey}`}
          >
            <span
              aria-hidden
              style={{
                display: 'inline-block',
                width: 7,
                height: 7,
                borderRadius: '50%',
                background: 'var(--scalar-color-green)',
              }}
            />
            {connection.pubkey.slice(0, 8)}…{connection.pubkey.slice(-4)}
          </span>
          <button
            type="button"
            onClick={disconnect}
            style={ghostBtn()}
            aria-label="Disconnect Nostr extension"
            title="Disconnect"
          >
            Disconnect
          </button>
        </>
      ) : (
        <button
          type="button"
          onClick={connect}
          disabled={busy || !serverUrl}
          style={primaryBtn()}
          title="Connect a Nostr browser extension (NIP-07) to auto-sign NIP-98 and mint a JWT"
        >
          {busy ? 'Connecting…' : 'Connect with extension (NIP-07)'}
        </button>
      )}
      {error && (
        <span
          role="alert"
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            marginTop: 4,
            padding: '4px 8px',
            background: 'color-mix(in srgb, var(--scalar-color-red, #ef4444) 14%, transparent)',
            border: '1px solid color-mix(in srgb, var(--scalar-color-red, #ef4444) 35%, transparent)',
            color: 'var(--scalar-color-red, #ef4444)',
            borderRadius: 6,
            fontSize: 11,
            whiteSpace: 'nowrap',
          }}
        >
          {error}
        </span>
      )}
    </div>
  )
}

async function mintJwt(serverUrl: string, signer: NostrSigner): Promise<string> {
  const url = `${serverUrl.replace(/\/$/, '')}/api/jwt`
  const body = JSON.stringify({ expiresIn: '24h' })
  const authHeader = await createNip98Token(url, { method: 'POST', body }, signer)
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
    body,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`/api/jwt returned ${res.status}: ${text.slice(0, 200)}`)
  }
  const data = (await res.json()) as { token?: string }
  if (!data.token) throw new Error('JWT response missing `token`')
  return data.token
}

function primaryBtn(): React.CSSProperties {
  return {
    padding: '4px 10px',
    border: '1px solid color-mix(in srgb, var(--scalar-color-accent) 60%, transparent)',
    borderRadius: 6,
    background: 'color-mix(in srgb, var(--scalar-color-accent) 14%, transparent)',
    color: 'var(--scalar-color-accent)',
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: 600,
    whiteSpace: 'nowrap',
  }
}

function ghostBtn(): React.CSSProperties {
  return {
    padding: '4px 10px',
    border: '1px solid var(--scalar-border-color)',
    borderRadius: 6,
    background: 'transparent',
    color: 'var(--scalar-color-2)',
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: 500,
  }
}
