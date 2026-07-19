'use client'

import { useState } from 'react'
import { Fingerprint } from 'lucide-react'
import { toast } from 'sonner'
import { Button, type ButtonProps } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { useAuth } from '@/components/admin/auth-context'
import {
  authenticateWithPasskey,
  isPasskeySupported,
  registerPasskeyAccount,
  translatePasskeyError,
} from '@/lib/client/passkey-api'

interface PasskeyLoginButtonProps {
  /**
   * `authenticate` signs in with an existing passkey (username-less);
   * `register` creates a brand-new account with a server-custodied Nostr key.
   */
  mode: 'authenticate' | 'register'
  onSuccess?: () => void
  label?: string
  variant?: ButtonProps['variant']
  className?: string
  /** Renders the cross-device hint copy under the button. */
  showCrossDeviceHint?: boolean
  disabled?: boolean
}

/**
 * The single passkey entry point every login surface reuses (admin modal,
 * wallet login, onboarding, card activation). Renders nothing when the
 * browser lacks WebAuthn, so unsupported devices see the existing UI
 * unchanged.
 *
 * The whole ceremony (begin fetch → browser prompt → verify → session
 * commit) runs inside the click handler — Safari/iOS require WebAuthn calls
 * within transient user activation, so never move this into an effect.
 */
export function PasskeyLoginButton({
  mode,
  onSuccess,
  label,
  variant = 'default',
  className,
  showCrossDeviceHint = false,
  disabled = false,
}: PasskeyLoginButtonProps) {
  const { loginWithToken } = useAuth()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Support is browser-dependent but stable for the page's lifetime.
  const [supported] = useState(() => isPasskeySupported())

  if (!supported) return null

  const buttonLabel =
    label ?? (mode === 'register' ? 'Create with a passkey' : 'Continue with passkey')

  async function handleClick() {
    setError(null)
    setBusy(true)
    try {
      const session =
        mode === 'register'
          ? await registerPasskeyAccount()
          : await authenticateWithPasskey()
      await loginWithToken(session.token, 'passkey', session.signerKey)
      onSuccess?.()
    } catch (err) {
      const passkeyError = translatePasskeyError(err)
      if (passkeyError.kind !== 'cancelled') {
        setError(passkeyError.message)
        toast.error(passkeyError.message)
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2">
      <Button
        type="button"
        variant={variant}
        className={className}
        onClick={handleClick}
        disabled={busy || disabled}
      >
        {busy ? <Spinner size={16} /> : <Fingerprint className="size-4" />}
        {busy ? 'Waiting for your device…' : buttonLabel}
      </Button>
      {error && <p className="text-xs text-destructive">{error}</p>}
      {showCrossDeviceHint && (
        <p className="text-xs text-muted-foreground">
          No passkey on this device? Choose &ldquo;use a phone or tablet&rdquo;
          when prompted and scan the QR with the device that has one.
        </p>
      )}
    </div>
  )
}
