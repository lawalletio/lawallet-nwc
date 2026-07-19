'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Cloud, Fingerprint, KeyRound } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { ScreenHeader } from '@/components/wallet/shared/screen-header'
import { useAuth } from '@/components/admin/auth-context'
import {
  registerPasskeyAccount,
  translatePasskeyError,
} from '@/lib/client/passkey-api'

/**
 * Create-account flow for passkey users. Unlike `CreateAccountFlow` there is
 * no forced key backup step — the server custodies the account's Nostr key,
 * which stays exportable any time from Settings → Security. The whole
 * WebAuthn ceremony runs inside the button's click handler (Safari/iOS
 * transient-activation requirement).
 */
export function PasskeyCreateFlow() {
  const router = useRouter()
  const { loginWithToken } = useAuth()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleCreate() {
    setError(null)
    setBusy(true)
    try {
      const session = await registerPasskeyAccount()
      await loginWithToken(session.token, 'passkey', session.signerKey)
      router.replace('/wallet/welcome')
    } catch (err) {
      const passkeyError = translatePasskeyError(err)
      if (passkeyError.kind !== 'cancelled') {
        setError(passkeyError.message)
        toast.error(passkeyError.message)
      }
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-1 flex-col">
      <ScreenHeader />
      <div className="flex flex-1 flex-col justify-between pb-6 pt-2">
        <div className="space-y-6 pt-4">
          <div className="space-y-3">
            <h1 className="text-2xl font-semibold text-foreground">
              Create with a passkey
            </h1>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Your device creates a passkey — Face ID, Touch ID, or screen
              lock. No passwords, nothing to write down.
            </p>
          </div>

          <ul className="space-y-4">
            <Benefit icon={<Fingerprint className="size-4" />}>
              Sign in with just your fingerprint, face, or device PIN.
            </Benefit>
            <Benefit icon={<Cloud className="size-4" />}>
              Works across your devices — synced passkeys sign in anywhere,
              and any browser can use a phone via QR.
            </Benefit>
            <Benefit icon={<KeyRound className="size-4" />}>
              Your Nostr key is kept safe for you. Export it any time from
              Settings → Security to take your identity elsewhere.
            </Benefit>
          </ul>

          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>

        <Button
          type="button"
          variant="theme"
          className="h-12 w-full"
          onClick={handleCreate}
          disabled={busy}
        >
          {busy ? <Spinner size={16} /> : <Fingerprint className="size-4" />}
          {busy ? 'Waiting for your device…' : 'Create my account'}
        </Button>
      </div>
    </div>
  )
}

function Benefit({
  icon,
  children,
}: {
  icon: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <li className="flex items-start gap-3">
      <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-card text-foreground">
        {icon}
      </span>
      <span className="text-sm leading-snug text-muted-foreground">
        {children}
      </span>
    </li>
  )
}
