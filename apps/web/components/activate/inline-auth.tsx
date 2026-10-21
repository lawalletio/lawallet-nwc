'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, KeyRound } from 'lucide-react'
import { toast } from 'sonner'
import { generateSecretKey } from 'nostr-tools/pure'
import { nip19 } from 'nostr-tools'
import { bytesToHex } from 'nostr-tools/utils'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { useAuth } from '@/components/admin/auth-context'
import { PasskeyLoginButton } from '@/components/shared/passkey-login-button'
import { SecretKeyReveal } from '@/components/shared/secret-key-reveal'
import { isPasskeySupported } from '@/lib/client/passkey-api'
import { createNsecSigner } from '@/lib/client/nostr-signer'
import { useT } from '@/lib/client/i18n'

type Mode = 'choose' | 'create'

/**
 * Compact connect/register panel rendered inline on the activate page so the
 * user never leaves the flow. `login()` (from the shared auth context) only
 * sets session state — it does not redirect — so when it resolves the parent's
 * status flips to `authenticated` and the claim auto-fires. `onAuthStart` lets
 * the parent arm that auto-activation.
 */
export function InlineAuth({
  onAuthStart,
  intent = 'activate'
}: {
  onAuthStart: () => void
  /** `recover` swaps the copy for a RECOVER QR; the flow is the same. */
  intent?: 'activate' | 'recover'
}) {
  const { login } = useAuth()
  const dict = useT().activate
  const t =
    intent === 'recover'
      ? {
          ...dict.inlineAuth,
          intro: dict.recover.intro,
          introNoPasskey: dict.recover.introNoPasskey,
          activating: dict.recover.working,
          createAndActivate: dict.recover.createAndRecover
        }
      : dict.inlineAuth
  const [mode, setMode] = useState<Mode>('choose')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [passkeySupported] = useState(() => isPasskeySupported())

  // Freshly-generated key for the create flow
  const { nsec, hex } = useMemo(() => {
    const secretKey = generateSecretKey()
    return { nsec: nip19.nsecEncode(secretKey), hex: bytesToHex(secretKey) }
  }, [])
  const [confirmed, setConfirmed] = useState(false)

  async function runLogin(make: () => Promise<void> | void) {
    setError(null)
    setLoading(true)
    onAuthStart()
    try {
      await make()
      // success → parent effect claims; keep the spinner up through the flip.
    } catch (err) {
      const message = err instanceof Error ? err.message : t.connectFailed
      setError(message)
      toast.error(message)
      setLoading(false)
    }
  }

  if (mode === 'choose') {
    return (
      <div className="w-full space-y-3">
        <p className="text-center text-sm text-muted-foreground">
          {passkeySupported ? t.intro : t.introNoPasskey}
        </p>
        <PasskeyLoginButton
          mode="register"
          variant="theme"
          className="h-12 w-full"
          label={t.passkey}
          surfaceCancel
          duplicateMessage={t.duplicate}
          onSuccess={onAuthStart}
        />
        <Button
          variant="secondary"
          className="h-12 w-full"
          onClick={() => setMode('create')}
        >
          <KeyRound className="size-4" />
          {t.nostr}
        </Button>
        {/* The card is remembered (pending-activation), so login returns here. */}
        <Button asChild variant="ghost" className="h-10 w-full">
          <Link href="/wallet/login">{t.haveAccount}</Link>
        </Button>
      </div>
    )
  }

  return (
    <div className="w-full space-y-4">
      <BackButton onClick={() => setMode('choose')} disabled={loading} />
      <div className="space-y-1">
        <h2 className="text-base font-semibold text-foreground">
          {t.newKeyTitle}
        </h2>
        <p className="text-xs text-muted-foreground">{t.newKeyBody}</p>
      </div>

      <SecretKeyReveal
        nsec={nsec}
        disabled={loading}
        confirmed={confirmed}
        onConfirmedChange={setConfirmed}
        confirmLabel={t.confirmLabel}
      />

      {error && <p className="text-xs text-destructive">{error}</p>}

      <Button
        className="h-12 w-full"
        disabled={!confirmed || loading}
        onClick={() =>
          runLogin(() => login(createNsecSigner(hex), 'nsec', { secret: nsec }))
        }
      >
        {loading ? <Spinner size={16} /> : null}
        {loading ? t.activating : t.createAndActivate}
      </Button>
    </div>
  )
}

function BackButton({
  onClick,
  disabled
}: {
  onClick: () => void
  disabled?: boolean
}) {
  const t = useT()
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
    >
      <ArrowLeft className="size-3.5" />
      {t.common.back}
    </button>
  )
}
