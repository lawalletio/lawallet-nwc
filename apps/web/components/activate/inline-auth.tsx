'use client'

import { useMemo, useState } from 'react'
import { ArrowLeft, Check, Copy, Eye, EyeOff, KeyRound, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { generateSecretKey } from 'nostr-tools/pure'
import { nip19 } from 'nostr-tools'
import { bytesToHex } from 'nostr-tools/utils'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Spinner } from '@/components/ui/spinner'
import { useAuth } from '@/components/admin/auth-context'
import { NostrConnectForm } from '@/components/shared/nostr-connect-form'
import { createNsecSigner } from '@/lib/client/nostr-signer'
import { cn } from '@/lib/utils'

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
  const [revealed, setRevealed] = useState(false)
  const [copied, setCopied] = useState(false)
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

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(nsec)
      setCopied(true)
      toast.success('Private key copied')
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error('Copy failed — reveal and write the key down')
    }
  }

  if (mode === 'choose') {
    return (
      <div className="w-full space-y-3">
        <p className="text-center text-sm text-muted-foreground">
          Connect a wallet to activate this card.
        </p>
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

        <div className="rounded-xl border border-border bg-card px-4 py-3">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                'flex-1 break-all font-mono text-xs text-foreground',
                !revealed && 'select-none blur-sm'
              )}
            >
              {nsec}
            </span>
            <button
              type="button"
              onClick={() => setRevealed(v => !v)}
              aria-label={revealed ? 'Hide private key' : 'Reveal private key'}
              className="shrink-0 text-muted-foreground hover:text-foreground"
            >
              {revealed ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
        </div>

        <Button
          variant="secondary"
          className="w-full"
          onClick={handleCopy}
          disabled={loading}
        >
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
          {copied ? 'Copied' : 'Copy private key'}
        </Button>

        <label className="flex items-start gap-3 rounded-xl border border-border bg-card/50 p-3 text-xs text-foreground">
          <Checkbox
            checked={confirmed}
            onCheckedChange={v => setConfirmed(v === true)}
            disabled={loading}
            className="mt-0.5"
          />
          <span className="leading-snug">
            I&apos;ve saved my private key and understand it can&apos;t be
            recovered.
          </span>
        </label>

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
