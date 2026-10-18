'use client'

import Link from 'next/link'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Fingerprint } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ScreenHeader } from '@/components/wallet/shared/screen-header'
import { isPasskeySupported } from '@/lib/client/passkey-api'
import { useT } from '@/lib/client/i18n'

/**
 * Sign-up chooser sitting between `landing` and the concrete account
 * creation flows. Passkey-first for mainstream users (hidden when the
 * browser lacks WebAuthn); Nostr users can still generate a random key, or
 * bail out to `/wallet/login` if they already have one.
 *
 * Back goes to `/wallet/landing` explicitly — `router.back()` can leave the
 * wallet (to `/` or `/admin`) depending on how the user got here.
 */
export function SignupChoice() {
  const router = useRouter()
  const [passkeySupported] = useState(() => isPasskeySupported())
  const t = useT().onboarding.signup

  return (
    <div className="flex flex-1 flex-col">
      <ScreenHeader onBack={() => router.push('/wallet/landing')} />
      <div className="flex flex-1 flex-col justify-between pb-6 pt-2">
        <div className="space-y-3 pt-4">
          <h1 className="text-2xl font-semibold text-foreground">{t.title}</h1>
          <p className="text-sm leading-relaxed text-muted-foreground">
            {passkeySupported ? t.subtitlePasskey : t.subtitleNostr}
          </p>
        </div>

        <div className="space-y-3">
          {passkeySupported && (
            <Button asChild variant="theme" className="h-12 w-full">
              <Link href="/wallet/create-passkey">
                <Fingerprint className="size-4" />
                {t.passkey}
              </Link>
            </Button>
          )}
          <Button
            asChild
            variant={passkeySupported ? 'secondary' : 'theme'}
            className="h-12 w-full"
          >
            <Link href="/wallet/create-account">{t.randomKey}</Link>
          </Button>
          <Button asChild variant="secondary" className="h-12 w-full">
            <Link href="/wallet/login">{t.haveKey}</Link>
          </Button>
        </div>
      </div>
    </div>
  )
}
