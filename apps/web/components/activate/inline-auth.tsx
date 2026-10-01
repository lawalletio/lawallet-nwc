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
import { useSettings } from '@/lib/client/hooks/use-settings'
import { isPasskeySupported } from '@/lib/client/passkey-api'
import { createNsecSigner } from '@/lib/client/nostr-signer'

type Mode = 'choose' | 'nostr' | 'create' | 'existing'

/**
 * Compact connect/register panel rendered inline on the activate page so the
 * user never leaves the flow. `login()` (from the shared auth context) only
 * sets session state — it does not redirect — so when it resolves the parent's
 * status flips to `authenticated` and the claim auto-fires. `onAuthStart` lets
 * the parent arm that auto-activation.
 */
export function InlineAuth({ onAuthStart }: { onAuthStart: () => void }) {
  const { login } = useAuth()
  const { data: settings } = useSettings()
  const [mode, setMode] = useState<Mode>('choose')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [passkeySupported] = useState(() => isPasskeySupported())
  const community = settings?.community_name?.trim() || null

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

  if (mode === 'choose' || mode === 'nostr') {
    return (
      <div className="w-full space-y-3">
        {mode === 'nostr' && (
          <BackButton onClick={() => setMode('choose')} disabled={loading} />
        )}
        {passkeySupported && mode === 'choose' ? (
          <PasskeyEnroll
            community={community}
            onAuthStart={onAuthStart}
            onNostr={() => setMode('nostr')}
          />
        ) : (
          <NostrFallback
            unsupported={!passkeySupported && mode === 'choose'}
            onCreate={() => setMode('create')}
            onExisting={() => setMode('existing')}
          />
        )}
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
            runLogin(() =>
              login(createNsecSigner(hex), 'nsec', { secret: nsec })
            )
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

/**
 * New accounts register with a passkey and stay on this page — the parent
 * claims the card as soon as the session exists, so the user never drops
 * onto a generic login screen. Existing passkeys use the login button.
 */
function PasskeyEnroll({
  community,
  onAuthStart,
  onNostr
}: {
  community: string | null
  onAuthStart: () => void
  onNostr: () => void
}) {
  return (
    <>
      <p className="text-center text-sm text-muted-foreground">
        {community
          ? `Create a passkey for ${community} to activate this card.`
          : 'Create a passkey to activate this card.'}
      </p>
      <PasskeyLoginButton
        mode="register"
        variant="theme"
        className="h-12 w-full"
        label="Create a passkey"
        surfaceCancel
        duplicateMessage="This device already has a passkey. Sign in with it below."
        onSuccess={onAuthStart}
      />
      <PasskeyLoginButton
        mode="authenticate"
        variant="secondary"
        className="h-12 w-full"
        label="I already have a passkey"
        onSuccess={onAuthStart}
      />
      <button
        type="button"
        onClick={onNostr}
        className="w-full py-1 text-center text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
      >
        Use a Nostr key instead
      </button>
    </>
  )
}

function NostrFallback({
  unsupported,
  onCreate,
  onExisting
}: {
  unsupported: boolean
  onCreate: () => void
  onExisting: () => void
}) {
  return (
    <>
      <p className="text-center text-sm text-muted-foreground">
        {unsupported
          ? 'This browser cannot create a passkey. Open this page in Safari or Chrome, or continue with a Nostr key.'
          : 'Sign in with a Nostr key to activate this card.'}
      </p>
      <Button className="h-12 w-full" onClick={onCreate}>
        <Plus className="size-4" />
        Create a new key
      </Button>
      <Button variant="secondary" className="h-12 w-full" onClick={onExisting}>
        <KeyRound className="size-4" />I already have a key
      </Button>
    </>
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
