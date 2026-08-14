import { useState } from 'react'

/**
 * A generated key IS the account, so this gate is rendered above the whole
 * app: the user must acknowledge the backup before continuing. Keeping it at
 * App level matters — the login screen unmounts the moment auth succeeds.
 */
export function Backup({
  nsec,
  onAcknowledge
}: {
  nsec: string
  onAcknowledge: () => void
}) {
  const [copied, setCopied] = useState(false)

  return (
    <main className="shell center">
      <h1>Save your key</h1>
      <p className="muted">
        This secret key <strong>is</strong> your account — it is shown only
        once. Store it in a password manager; it works in every Nostr app.
      </p>
      <code className="nsec-box">{nsec}</code>
      <button
        className="secondary"
        onClick={() => {
          navigator.clipboard?.writeText(nsec)
          setCopied(true)
        }}
      >
        {copied ? 'Copied ✓' : 'Copy to clipboard'}
      </button>
      <button className="primary" onClick={onAcknowledge}>
        I saved it — continue
      </button>
    </main>
  )
}
