'use client'

import { useMemo, useState } from 'react'
import { ArrowLeft, KeyRound, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { generateSecretKey } from 'nostr-tools/pure'
import { nip19 } from 'nostr-tools'
import { bytesToHex } from 'nostr-tools/utils'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { useAuth } from '@/components/admin/auth-context'
import { NostrConnectForm } from '@/components/shared/nostr-connect-form'
import { PasskeyLoginButton } from '@/components/shared/passkey-login-button'
import { SecretKeyReveal } from '@/components/shared/secret-key-reveal'
import { createNsecSigner } from '@/lib/client/nostr-signer'

type Mode = 'choose' | 'create' | 'existing'

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
          Connect a wallet to activate this card.
        </p>
        <PasskeyLoginButton
          mode="authenticate"
          className="h-12 w-full"
          onSuccess={onAuthStart}
        />
        <Button
          className="h-12 w-full"
          onClick={() => setMode('create')}
        >
          <Plus className="size-4" />
          Create a new wallet
        </Button>
        <Button
          variant="secondary"
          className="h-12 w-full"
          onClick={() => setMode('existing')}
        >
          <KeyRound className="size-4" />
          I already have a wallet
        </Button>
      </div>
    )
  }

  if (mode === 'create') {
    return (
      <div className="w-full space-y-4">
        <BackButton onClick={() => setMode('choose')} disabled={loading} />
        <div className="space-y-1">
          <h2 className="text-base font-semibold text-foreground">
            Your new private key
          </h2>
          <p className="text-xs text-muted-foreground">
            Save it somewhere safe — it&apos;s the only way back into your
            wallet and the card&apos;s funds.
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

  // mode === 'existing' — reuse the shared wallet login system (private key,
  // remote signer / bunker, or browser extension), the same component the
  // /wallet login screen renders. Its default handler runs the full NIP-98 →
  // JWT exchange via `useAuth().login`; `onSuccess` arms the parent's
  // auto-activation so the claim fires the moment the session is live.
  return (
    <div className="w-full space-y-4">
      <BackButton onClick={() => setMode('choose')} disabled={loading} />
      <div className="space-y-1">
        <h2 className="text-base font-semibold text-foreground">
          Connect your wallet
        </h2>
        <p className="text-xs text-muted-foreground">
          Sign in with your private key, a remote signer (bunker), or a browser
          extension — your key never leaves your device.
        </p>
      </div>

      <NostrConnectForm
        submitLabel="Connect & activate"
        loadingLabel="Activating…"
        onSuccess={onAuthStart}
      />
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
