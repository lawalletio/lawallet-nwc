'use client'

import { useMemo, useState } from 'react'
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

type Mode = 'choose' | 'create'

/**
 * Compact connect/register panel rendered inline on the activate page so the
 * user never leaves the flow. `login()` (from the shared auth context) only
 * sets session state — it does not redirect — so when it resolves the parent's
 * status flips to `authenticated` and the claim auto-fires. `onAuthStart` lets
 * the parent arm that auto-activation.
 */
export function InlineAuth({ onAuthStart }: { onAuthStart: () => void }) {
  const { login } = useAuth()
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
      const message = err instanceof Error ? err.message : 'Could not connect'
      setError(message)
      toast.error(message)
      setLoading(false)
    }
  }

  if (mode === 'choose') {
    return (
      <div className="w-full space-y-3">
        <p className="text-center text-sm text-muted-foreground">
          {passkeySupported
            ? 'Activate this card with a new passkey or a new Nostr key.'
            : 'This browser cannot create a passkey. Open this page in Safari or Chrome, or continue with a Nostr key.'}
        </p>
        <PasskeyLoginButton
          mode="register"
          variant="theme"
          className="h-12 w-full"
          label="Passkey"
          surfaceCancel
          duplicateMessage="This device already has a passkey."
          onSuccess={onAuthStart}
        />
        <Button
          variant="secondary"
          className="h-12 w-full"
          onClick={() => setMode('create')}
        >
          <KeyRound className="size-4" />
          Nostr
        </Button>
      </div>
    )
  }

  return (
    <div className="w-full space-y-4">
      <BackButton onClick={() => setMode('choose')} disabled={loading} />
      <div className="space-y-1">
        <h2 className="text-base font-semibold text-foreground">
          Your new Nostr key
        </h2>
        <p className="text-xs text-muted-foreground">
          Save it somewhere safe — it&apos;s the only way back into your wallet
          and the card&apos;s funds.
        </p>
      </div>

      <SecretKeyReveal
        nsec={nsec}
        disabled={loading}
        confirmed={confirmed}
        onConfirmedChange={setConfirmed}
        confirmLabel="I've saved my private key and understand it can't be recovered."
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
        {loading ? 'Activating…' : 'Create & activate'}
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
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
    >
      <ArrowLeft className="size-3.5" />
      Back
    </button>
  )
}
