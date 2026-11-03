'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { KeyRound } from 'lucide-react'
import { BrandLogotype } from '@/components/ui/brand-logotype'
import { PasskeyLoginButton } from '@/components/shared/passkey-login-button'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { postAuthPath } from '@/lib/client/pending-activation'
import { useT } from '@/lib/client/i18n'
import type { PasskeyImportSource } from '@/lib/passkey-import-sources'

export function LoginOptions({
  importSources = []
}: {
  /** Offers the import from another app's passkey when non-empty. */
  importSources?: PasskeyImportSource[]
}) {
  const router = useRouter()
  const t = useT().onboarding.login

  return (
    <div className="flex flex-1 flex-col justify-between py-8">
      <div className="flex flex-col items-center gap-8">
        <BrandLogotype width={120} height={28} className="h-7 w-auto" />

        <div className="w-full space-y-2 text-center">
          <h1 className="text-2xl font-semibold text-foreground">{t.title}</h1>
          <p className="text-sm text-muted-foreground">{t.subtitle}</p>
        </div>

        <div className="w-full space-y-5">
          {/* Passkey-first: renders nothing on unsupported browsers, leaving
              the Nostr button as the only option. */}
          <PasskeyLoginButton
            mode="authenticate"
            variant="theme"
            className="h-12 w-full"
            label={t.passkey}
            showCrossDeviceHint
            surfaceCancel
            importSources={importSources}
            onSuccess={() => router.replace(postAuthPath('/wallet'))}
          />

          <div className="relative">
            <Separator />
            <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-background px-2 text-xs text-muted-foreground">
              {t.or}
            </span>
          </div>

          {/* The key-based methods (private key, bunker, extension) get their
              own screen so this one stays a simple two-option choice. */}
          <Button asChild variant="secondary" className="h-12 w-full">
            <Link href="/wallet/login/nostr">
              <KeyRound className="size-4" />
              {t.continueWithNostr}
            </Link>
          </Button>
        </div>
      </div>

      <div className="space-y-3 text-center">
        <p className="text-sm text-muted-foreground">{t.newHere}</p>
        <Link
          href="/wallet/signup"
          className="inline-flex h-11 w-full items-center justify-center rounded-md bg-secondary px-4 text-sm font-medium text-secondary-foreground transition-colors hover:bg-secondary/80"
        >
          {t.createAccount}
        </Link>
      </div>
    </div>
  )
}
