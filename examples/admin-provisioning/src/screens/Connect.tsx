import { browserSigner, nsecSigner } from '@lawallet-nwc/sdk'
import { useState } from 'react'
import type { Identity } from '../App'

/**
 * Step 1 — establish which key the visitor holds.
 *
 * A signer is non-negotiable: provisioning requires a signature proving
 * control of the npub, so pasting an npub alone can't work. That's the
 * property that stops anyone claiming a reserved name for someone else's key.
 */
export function Connect({
  domain,
  hasExtension,
  onConnected
}: {
  domain: string | null
  hasExtension: boolean
  onConnected: (identity: Identity) => void
}) {
  const [nsec, setNsec] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const connect = async (make: () => ReturnType<typeof nsecSigner>) => {
    setBusy(true)
    setError(null)
    try {
      const signer = make()
      onConnected({ signer, pubkey: await signer.getPublicKey() })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read that key')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="shell">
      <h1>Claim your reserved address</h1>
      <p className="muted">
        Addresses on <strong>{domain ?? 'this instance'}</strong> are issued by
        the operator. Prove you hold your Nostr key and yours will be created.
      </p>

      {hasExtension && (
        <section className="card">
          <h2>Browser extension</h2>
          <p className="muted">
            Sign with your NIP-07 extension. Your key never leaves it.
          </p>
          <button
            className="primary"
            disabled={busy}
            onClick={() => connect(() => browserSigner())}
          >
            Connect extension
          </button>
        </section>
      )}

      <section className="card">
        <h2>Use your nsec</h2>
        <input
          type="password"
          placeholder="nsec1…"
          value={nsec}
          onChange={e => setNsec(e.target.value)}
        />
        <button
          className="primary"
          disabled={busy || !nsec.startsWith('nsec1')}
          onClick={() => connect(() => nsecSigner(nsec))}
        >
          Continue
        </button>
      </section>

      {error && <p className="error">{error}</p>}
    </main>
  )
}
