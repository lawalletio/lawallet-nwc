'use client'

import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { ScreenHeader } from '@/components/wallet/shared/screen-header'

/**
 * Choice screen between `landing` and the actual account/login flows.
 * Lets a brand-new user opt into a freshly generated key, while existing
 * Nostr users skip straight to the signer-pick screen.
 */
export function NostrLoginChoice() {
  return (
    <div className="flex flex-1 flex-col">
      <ScreenHeader />
      <div className="flex flex-1 flex-col justify-between pb-6 pt-2">
        <div className="space-y-3 pt-4">
          <h1 className="text-2xl font-semibold text-foreground">
            Nostr login
          </h1>
          <p className="text-sm leading-relaxed text-muted-foreground">
            LaWallet uses Nostr for identity. Pick how you want to sign in.
          </p>
        </div>

        <div className="space-y-3">
          <Button asChild variant="theme" className="h-12 w-full">
            <Link href="/wallet/create-account">Create a random key</Link>
          </Button>
          <Button asChild variant="secondary" className="h-12 w-full">
            <Link href="/wallet/login">I already have a random key</Link>
          </Button>
        </div>
      </div>
    </div>
  )
}
