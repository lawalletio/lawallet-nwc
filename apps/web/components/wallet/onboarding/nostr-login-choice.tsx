'use client'

import Link from 'next/link'
import { useState } from 'react'
import { Fingerprint } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ScreenHeader } from '@/components/wallet/shared/screen-header'
import { isPasskeySupported } from '@/lib/client/passkey-api'

/**
 * Choice screen between `landing` and the actual account/login flows.
 * Passkey-first for mainstream users (hidden when the browser lacks
 * WebAuthn); Nostr users can still generate or bring their own key.
 */
export function NostrLoginChoice() {
  const [passkeySupported] = useState(() => isPasskeySupported())

  return (
    <div className="flex flex-1 flex-col">
      <ScreenHeader />
      <div className="flex flex-1 flex-col justify-between pb-6 pt-2">
        <div className="space-y-3 pt-4">
          <h1 className="text-2xl font-semibold text-foreground">
            Create your account
          </h1>
          <p className="text-sm leading-relaxed text-muted-foreground">
            {passkeySupported
              ? 'Use a passkey for the simplest start — or pick a Nostr key if you know your way around.'
              : 'LaWallet uses Nostr for identity. Pick how you want to sign in.'}
          </p>
        </div>

        <div className="space-y-3">
          {passkeySupported && (
            <Button asChild variant="theme" className="h-12 w-full">
              <Link href="/wallet/create-passkey">
                <Fingerprint className="size-4" />
                Create with a passkey
              </Link>
            </Button>
          )}
          <Button
            asChild
            variant={passkeySupported ? 'secondary' : 'theme'}
            className="h-12 w-full"
          >
            <Link href="/wallet/create-account">Create a random key</Link>
          </Button>
          <Button asChild variant="secondary" className="h-12 w-full">
            <Link href="/wallet/login">I already have a key</Link>
          </Button>
        </div>
      </div>
    </div>
  )
}
