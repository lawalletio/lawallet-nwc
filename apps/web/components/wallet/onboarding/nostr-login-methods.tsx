'use client'

import { useRouter } from 'next/navigation'
import { NostrConnectForm } from '@/components/shared/nostr-connect-form'
import { ScreenHeader } from '@/components/wallet/shared/screen-header'

/**
 * The Nostr sign-in methods, split out of the login screen so `/wallet/login`
 * stays a two-option choice (passkey or Nostr). Everything key-shaped —
 * private key, bunker, browser extension — lives here.
 *
 * Back goes to `/wallet/login` explicitly rather than `router.back()` so a
 * deep link into this screen still lands somewhere useful.
 */
export function NostrLoginMethods() {
  const router = useRouter()

  return (
    <div className="flex flex-1 flex-col">
      <ScreenHeader onBack={() => router.push('/wallet/login')} />

      <div className="flex flex-1 flex-col gap-8 pb-8 pt-2">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold text-foreground">
            Continue with Nostr
          </h1>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Choose how you want to connect your Nostr key.
          </p>
        </div>

        <NostrConnectForm
          submitLabel="Login"
          loadingLabel="Signing in..."
          onSuccess={() => router.replace('/wallet')}
        />
      </div>
    </div>
  )
}
