import {
  LaWalletClient,
  hasBrowserExtension,
  type NostrSigner
} from '@lawallet-nwc/sdk'
import { useEffect, useMemo, useState } from 'react'
import { endpoint, publicClient } from './main'
import { Connect } from './screens/Connect'
import { Manage } from './screens/Manage'
import { Provision } from './screens/Provision'

export interface Identity {
  signer: NostrSigner
  pubkey: string
}

export function App() {
  const [identity, setIdentity] = useState<Identity | null>(null)
  const [domain, setDomain] = useState<string | null>(null)
  const [username, setUsername] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)

  useEffect(() => {
    publicClient.settings
      .get()
      .then(settings => setDomain(settings.domain))
      .catch(() => setDomain(null))
  }, [])

  // Once the visitor connects a key, everything they do to their OWN address
  // is signed by it — the operator's credential is only ever spent to create
  // the address in the first place.
  const client = useMemo(
    () =>
      identity
        ? new LaWalletClient({ endpoint, signer: identity.signer })
        : null,
    [identity]
  )

  // A returning visitor already has an address; skip straight to managing it.
  useEffect(() => {
    if (!client) return
    setChecking(true)
    client.users
      .me()
      .then(me => setUsername(me.primaryUsername))
      .catch(() => setUsername(null))
      .finally(() => setChecking(false))
  }, [client])

  if (!identity || !client) {
    return (
      <Connect
        domain={domain}
        hasExtension={hasBrowserExtension()}
        onConnected={setIdentity}
      />
    )
  }

  if (checking) {
    return (
      <main className="shell center">
        <p className="muted">Checking your account…</p>
      </main>
    )
  }

  return username ? (
    <Manage client={client} username={username} domain={domain} />
  ) : (
    <Provision
      identity={identity}
      domain={domain}
      onProvisioned={setUsername}
    />
  )
}
