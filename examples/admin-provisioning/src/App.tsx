import { hasBrowserExtension, type NostrSigner } from '@lawallet-nwc/sdk'
import { useEffect, useState } from 'react'
import { publicClient } from './main'
import { Connect } from './screens/Connect'
import { Provision } from './screens/Provision'

export interface Identity {
  signer: NostrSigner
  pubkey: string
}

export function App() {
  const [identity, setIdentity] = useState<Identity | null>(null)
  const [domain, setDomain] = useState<string | null>(null)

  useEffect(() => {
    publicClient.settings
      .get()
      .then(settings => setDomain(settings.domain))
      .catch(() => setDomain(null))
  }, [])

  return identity ? (
    <Provision identity={identity} domain={domain} />
  ) : (
    <Connect
      domain={domain}
      hasExtension={hasBrowserExtension()}
      onConnected={setIdentity}
    />
  )
}
