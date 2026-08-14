import { signChallengeEvent, toNpub } from '@lawallet-nwc/sdk'
import { useEffect, useState } from 'react'
import type { Identity } from '../App'
import { publicClient } from '../main'

interface Provisioned {
  username: string
  isPrimary: boolean
  mode: string
  authMode: 'nip98' | 'jwt'
}

const USERNAME_RE = /^[a-z0-9]+$/

/**
 * Step 2 — pick a name, prove the key, get provisioned.
 *
 * Availability is read straight from the instance (a public endpoint), while
 * the claim itself goes to this app's backend, which is the only party that
 * can talk to LaWallet with an admin credential.
 */
export function Provision({
  identity,
  domain,
  onProvisioned
}: {
  identity: Identity
  domain: string | null
  /** Hands the new name to the app so the owner can configure it. */
  onProvisioned: (username: string) => void
}) {
  const [username, setUsername] = useState('')
  const [available, setAvailable] = useState<boolean | null>(null)
  const [checking, setChecking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<Provisioned | null>(null)

  const formatError =
    username.length === 0
      ? null
      : username.length > 16
        ? 'Max 16 characters.'
        : !USERNAME_RE.test(username)
          ? 'Lowercase letters and numbers only.'
          : null

  useEffect(() => {
    if (formatError || !username) {
      setAvailable(null)
      return
    }
    let cancelled = false
    setChecking(true)
    const handle = setTimeout(async () => {
      try {
        const res = await publicClient.addresses.checkAvailability(username)
        if (!cancelled) setAvailable(Boolean(res.available))
      } catch {
        if (!cancelled) setAvailable(null)
      } finally {
        if (!cancelled) setChecking(false)
      }
    }, 300)
    return () => {
      cancelled = true
      clearTimeout(handle)
    }
  }, [username, formatError])

  const claim = async () => {
    setBusy(true)
    setError(null)
    try {
      // 1. Ask the operator's backend for a challenge bound to this key.
      const { challenge, nonce } = await post('/api/challenge', {
        pubkey: identity.pubkey
      })

      // 2. Sign it — this is the proof of control.
      const event = await signChallengeEvent(nonce, identity.signer)

      // 3. The backend verifies the proof, then provisions as admin.
      const provisioned = await post('/api/provision', {
        challenge,
        event,
        username
      })
      setResult(provisioned)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not provision')
    } finally {
      setBusy(false)
    }
  }

  if (result) {
    return (
      <main className="shell center">
        <h1>
          ⚡ {result.username}@{domain}
        </h1>
        <p className="muted">
          Provisioned for {toNpub(identity.pubkey).slice(0, 16)}… ·{' '}
          {result.isPrimary ? 'primary address' : 'additional address'} ·
          routing {result.mode}
        </p>
        <span className="badge">
          operator authenticated via {result.authMode}
        </span>
        <button
          className="primary"
          onClick={() => onProvisioned(result.username)}
        >
          Set it up
        </button>
      </main>
    )
  }

  return (
    <main className="shell center">
      <h1>Choose your address</h1>
      <p className="muted">
        Signing in as {toNpub(identity.pubkey).slice(0, 16)}…
      </p>
      <div className="claim-form">
        <div className="username-input">
          <input
            autoFocus
            placeholder="reserved"
            value={username}
            onChange={e => setUsername(e.target.value.toLowerCase())}
          />
          <span className="domain">@{domain ?? '…'}</span>
        </div>
        <p className="hint">
          {formatError ??
            (checking
              ? 'Checking availability…'
              : available === true
                ? '✓ Available'
                : available === false
                  ? '✗ Taken'
                  : ' ')}
        </p>
        <button
          className="primary"
          disabled={
            busy ||
            checking ||
            !!formatError ||
            !username ||
            available === false
          }
          onClick={claim}
        >
          {busy ? 'Signing…' : 'Prove my key & claim'}
        </button>
      </div>
      {error && <p className="error">{error}</p>}
    </main>
  )
}

async function post(path: string, body: unknown) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  const payload = await res.json().catch(() => null)
  if (!res.ok) {
    throw new Error(payload?.error?.message ?? `Request failed (${res.status})`)
  }
  return payload
}
