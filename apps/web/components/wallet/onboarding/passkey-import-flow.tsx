'use client'

import { useRouter } from 'next/navigation'
import { ScreenHeader } from '@/components/wallet/shared/screen-header'
import { PasskeyImportPanel } from '@/components/shared/passkey-import-panel'
import type { PasskeyImportSource } from '@/lib/passkey-import-sources'
import { postAuthPath } from '@/lib/client/pending-activation'
import { useT } from '@/lib/client/i18n'

/**
 * Sign in with an identity another app's passkey keeps, then either keep
 * using that passkey or save a LaWallet copy, see PasskeyImportPanel. The
 * account is opened, or created, by the imported public key, exactly as
 * any Nostr or passkey login does.
 */
export function PasskeyImportFlow({
  sources
}: {
  sources: PasskeyImportSource[]
}) {
  const router = useRouter()
  const t = useT().auth.passkeyImport

  return (
    <div className="flex flex-1 flex-col">
      <ScreenHeader onBack={() => router.push('/wallet/login')} />
      <div className="flex flex-1 flex-col gap-8 pb-8 pt-2">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold text-foreground">{t.title}</h1>
          <p className="text-sm leading-relaxed text-muted-foreground">
            {t.subtitle}
          </p>
        </div>
        <PasskeyImportPanel
          sources={sources}
          mode="signin"
          onDone={() => router.replace(postAuthPath('/wallet'))}
        />
      </div>
    </div>
  )
}
