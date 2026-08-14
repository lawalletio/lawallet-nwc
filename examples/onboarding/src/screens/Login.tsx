import { hasBrowserExtension, useAuth } from '@lawallet-nwc/react'
import { useState } from 'react'

/**
 * Nostr-first login: a NIP-07 extension, a brand-new generated identity
 * (nsec shown once for backup), or a pasted nsec. No passwords, no emails,
 * no JWT — the signer is the session.
 */
export function Login({ onBack }: { onBack: () => void }) {
  const auth = useAuth()
  const [nsecInput, setNsecInput] = useState('')
  const [remember, setRemember] = useState(true)
  const [backup, setBackup] = useState<{ nsec: string; npub: string } | null>(
    null
  )
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    try {
      await fn()
    } catch {
      // auth.error carries the message
    } finally {
      setBusy(false)
    }
  }

  // A freshly generated key pauses here until the user confirms the backup.
  if (backup) {
    return (
      <main className="shell center">
        <h1>Save your key</h1>
        <p className="muted">
          This secret key <strong>is</strong> your account. Store it in a
          password manager — it is shown only once.
        </p>
        <code className="nsec-box">{backup.nsec}</code>
        <button
          className="secondary"
          onClick={() => {
            navigator.clipboard?.writeText(backup.nsec)
            setCopied(true)
          }}
        >
          {copied ? 'Copied ✓' : 'Copy to clipboard'}
        </button>
        <button className="primary" onClick={() => setBackup(null)}>
          I saved it — continue
        </button>
      </main>
    )
  }

  return (
    <main className="shell">
      <button className="link" onClick={onBack}>
        ← Back
      </button>
      <h1>Sign in with Nostr</h1>

      {hasBrowserExtension() && (
        <section className="card">
          <h2>Browser extension</h2>
          <p className="muted">
            Use your NIP-07 extension (Alby, nos2x…). Your key never leaves it —
            each request is signed by the extension.
          </p>
          <button
            className="primary"
            disabled={busy}
            onClick={() => run(() => auth.loginWithExtension())}
          >
            Connect extension
          </button>
        </section>
      )}

      <section className="card">
        <h2>New to Nostr?</h2>
        <p className="muted">
          Generate a fresh identity in one click. You get the key — back it up
          and it works in every Nostr app.
        </p>
        <button
          className="primary"
          disabled={busy}
          onClick={() =>
            run(async () => {
              const generated = await auth.loginWithNewKey({ remember: true })
              setBackup(generated)
            })
          }
        >
          Create my Nostr identity
        </button>
      </section>

      <section className="card">
        <h2>I have an nsec</h2>
        <input
          type="password"
          placeholder="nsec1…"
          value={nsecInput}
          onChange={e => setNsecInput(e.target.value)}
        />
        <label className="checkbox">
          <input
            type="checkbox"
            checked={remember}
            onChange={e => setRemember(e.target.checked)}
          />
          Remember me on this device
        </label>
        <button
          className="primary"
          disabled={busy || !nsecInput.startsWith('nsec1')}
          onClick={() => run(() => auth.loginWithNsec(nsecInput, { remember }))}
        >
          Sign in
        </button>
      </section>

      {auth.error && <p className="error">{auth.error.message}</p>}
    </main>
  )
}
