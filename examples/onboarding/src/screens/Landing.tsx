import { useInstanceInfo } from '@lawallet-nwc/react'

/**
 * Branding-aware landing: everything here comes from the instance's public
 * settings, fetched automatically by the provider — logo, community name,
 * cover image. Zero configuration in the app itself.
 */
export function Landing({ onStart }: { onStart: () => void }) {
  const { settings } = useInstanceInfo()
  const name = settings?.community_name || settings?.domain || 'this community'

  return (
    <main className="shell center">
      {settings?.logotype_url ? (
        <img className="logo" src={settings.logotype_url} alt={name} />
      ) : (
        <div className="logo-fallback">⚡</div>
      )}
      <h1>
        Your lightning address at <span className="accent">{name}</span>
      </h1>
      <p className="muted">
        Own a <code>you@{settings?.domain ?? 'domain'}</code> address tied to
        your Nostr identity. Receive sats from any wallet, get zaps, stay
        sovereign — your keys, your address.
      </p>
      <button className="primary" onClick={onStart}>
        Get started with Nostr
      </button>
    </main>
  )
}
