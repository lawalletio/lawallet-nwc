'use client'

import { useEffect, useRef, useState } from 'react'
import { PasskeyAccountPreview } from '@/components/shared/passkey-account-preview'
import { getPublicKeyFromPrivate } from '@/lib/nostr'
import { Fingerprint } from 'lucide-react'
import { toast } from 'sonner'
import { Button, type ButtonProps } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { useAuth } from '@/components/admin/auth-context'
import { createNsecSigner } from '@/lib/client/nostr-signer'
import {
  authenticateWithPasskey,
  isPasskeySupported,
  registerPasskeyAccount,
  translatePasskeyError
} from '@/lib/client/passkey-api'
import {
  forgetRememberedSource,
  readRememberedSource,
  rememberSource,
  signInWithRememberedSource,
  takeAccountSecret,
  type ImportedPasskey
} from '@/lib/client/passkey-import'
import type { PasskeyImportSource } from '@/lib/passkey-import-sources'
import {
  bytesToHex,
  hexToBytes,
  defaultStoredAccount,
  wipeStoredAccounts,
  type StoredAccount
} from '@/lib/passkey-store'
import {
  PasskeyImportPanel,
  StoredAccountPicker
} from '@/components/shared/passkey-import-panel'
import { useT } from '@/lib/client/i18n'
import { errorText } from '@/lib/client/i18n/errors'

interface PasskeyLoginButtonProps {
  /**
   * `authenticate` signs in with an existing passkey (username-less);
   * `register` creates a brand-new account whose Nostr key is derived from
   * the passkey via the WebAuthn PRF extension — the same key on every
   * device the passkey syncs to.
   */
  mode: 'authenticate' | 'register'
  onSuccess?: () => void
  label?: string
  variant?: ButtonProps['variant']
  className?: string
  /** Renders the cross-device hint copy under the button. */
  showCrossDeviceHint?: boolean
  disabled?: boolean
  /**
   * Show the "prompt was closed" line (inline, never a toast) so a cancelled
   * ceremony has an obvious retry. On Android `NotAllowedError` also means
   * "no passkey on this device", a provider failure or no screen lock, so
   * login surfaces opt in too — staying silent there reads as a dead button.
   */
  surfaceCancel?: boolean
  /**
   * Replaces the default duplicate-credential copy. Card activation uses this
   * to point at the "I already have a passkey" button on the same screen.
   */
  duplicateMessage?: string
  /** Configured import sources, for the relays of a remembered one. */
  importSources?: PasskeyImportSource[]
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
 *
 * When this device remembers another app's passkey (the "keep" choice of
 * the import), sign-in asks that passkey, pinned, for the remembered
 * account; if it no longer holds that account the user picks one.
 */
export function PasskeyLoginButton({
  mode,
  onSuccess,
  label,
  variant = 'default',
  className,
  showCrossDeviceHint = false,
  disabled = false,
  surfaceCancel = false,
  duplicateMessage,
  importSources
}: PasskeyLoginButtonProps) {
  const t = useT()
  const { login } = useAuth()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Support is browser-dependent but stable for the page's lifetime.
  const [supported] = useState(() => isPasskeySupported())
  const [choosingSource, setChoosingSource] = useState(false)
  const [picking, setPicking] = useState<ImportedPasskey | null>(null)
  const [picked, setPicked] = useState<StoredAccount | null>(null)
  const held = useRef<StoredAccount[]>([])

  const pendingSecret = useRef<Uint8Array | null>(null)
  const [pendingPubkey, setPendingPubkey] = useState<string | null>(null)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      wipeStoredAccounts(held.current)
      pendingSecret.current?.fill(0)
      pendingSecret.current = null
    }
  }, [])

  function clearConfirmation() {
    pendingSecret.current?.fill(0)
    pendingSecret.current = null
    setPendingPubkey(null)
  }

  function confirmIdentity(secretHex: string) {
    if (!mounted.current) return
    clearConfirmation()
    pendingSecret.current = hexToBytes(secretHex)
    setPendingPubkey(getPublicKeyFromPrivate(secretHex))
  }

  if (!supported) return null

  const buttonLabel =
    label ??
    (mode === 'register'
      ? t.auth.createWithPasskey
      : t.auth.continueWithPasskey)

  function fail(err: unknown) {
    const passkeyError = translatePasskeyError(err)
    const { kind } = passkeyError
    const localized = errorText(t, passkeyError, passkeyError.message)
    if (kind === 'cancelled') {
      if (surfaceCancel) setError(localized)
      return
    }
    const message =
      kind === 'duplicate' && duplicateMessage ? duplicateMessage : localized
    setError(message)
    toast.error(message)
  }

  function clearPicker() {
    wipeStoredAccounts(held.current)
    held.current = []
    setPicking(null)
    setPicked(null)
  }

  async function signIn(secretHex: string, temporary = false) {
    // Imported keys and their tokens stay in memory; a new session unlocks again.
    await login(createNsecSigner(secretHex), 'passkey', {
      secret: secretHex,
      ...(temporary ? { persistence: 'memory' as const } : {})
    })
    onSuccess?.()
  }

  async function handleClick(useAnother = false) {
    setChoosingSource(false)
    clearConfirmation()
    setError(null)
    clearPicker()
    setBusy(true)
    const remembered =
      mode === 'authenticate' && !useAnother ? readRememberedSource() : null
    try {
      if (remembered) {
        const result = await signInWithRememberedSource(
          remembered,
          importSources
        )
        const warnings =
          'imported' in result ? result.imported.warnings : result.warnings
        if (warnings?.length) toast.warning(warnings[0])
        if ('imported' in result) {
          held.current = result.imported.accounts
          setPicking(result.imported)
          setPicked(defaultStoredAccount(result.imported.accounts))
          return
        }
        confirmIdentity(result.secretHex)
        return
      }
      const identity =
        mode === 'register'
          ? await registerPasskeyAccount()
          : await authenticateWithPasskey()
      if (mode === 'authenticate') confirmIdentity(identity.secretHex)
      else await signIn(identity.secretHex, true)
    } catch (err) {
      fail(err)
    } finally {
      setBusy(false)
    }
  }

  async function handlePick() {
    const remembered = readRememberedSource()
    if (!picking || !picked || !remembered) return
    setError(null)
    setBusy(true)
    const pubkey = picked.pubkey
    const secretHex = takeAccountSecret(picking.accounts, pubkey)!
    held.current = []
    setPicking(null)
    setPicked(null)
    try {
      await signIn(secretHex, true)
      rememberSource({ ...remembered, pubkey })
    } catch (err) {
      fail(err)
    } finally {
      setBusy(false)
    }
  }

  function chooseSource() {
    clearConfirmation()
    clearPicker()
    setError(null)
    setChoosingSource(true)
  }

  if (choosingSource) {
    return (
      <PasskeyImportPanel
        sources={importSources ?? []}
        mode="signin"
        onDone={onSuccess}
        onUseLocal={() => {
          forgetRememberedSource()
          void handleClick(true)
        }}
      />
    )
  }

  if (pendingPubkey) {
    return (
      <div className="space-y-3">
        <PasskeyAccountPreview pubkey={pendingPubkey} />
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
        <Button
          type="button"
          variant={variant}
          className={className}
          disabled={busy}
          onClick={async () => {
            if (!pendingSecret.current) return
            setBusy(true)
            setError(null)
            try {
              await signIn(bytesToHex(pendingSecret.current), true)
              clearConfirmation()
            } catch (err) {
              fail(err)
            } finally {
              setBusy(false)
            }
          }}
        >
          {busy ? <Spinner size={16} /> : <Fingerprint className="size-4" />}
          {busy ? t.auth.signingIn : t.auth.passkeyImport.confirm}
        </Button>
        <Button
          type="button"
          variant="link"
          className="h-auto p-0 text-sm"
          disabled={busy}
          onClick={chooseSource}
        >
          {t.auth.passkeyImport.useAnother}
        </Button>
      </div>
    )
  }

  if (picking) {
    return (
      <div className="space-y-3">
        <StoredAccountPicker
          accounts={picking.accounts}
          selected={picked}
          onSelect={setPicked}
          disabled={busy}
          prompt={t.auth.passkeyImport.pickAgain}
        />
        <Button
          type="button"
          variant={variant}
          className={className}
          onClick={() => void handlePick()}
          disabled={busy || !picked}
        >
          {busy ? <Spinner size={16} /> : <Fingerprint className="size-4" />}
          {busy ? t.auth.waitingForDevice : t.auth.passkeyImport.continue}
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <Button
        type="button"
        variant={variant}
        className={className}
        onClick={() => void handleClick()}
        disabled={busy || disabled}
      >
        {busy ? <Spinner size={16} /> : <Fingerprint className="size-4" />}
        {busy ? t.auth.waitingForDevice : buttonLabel}
      </Button>
      {error && <p className="text-xs text-destructive">{error}</p>}
      {mode === 'authenticate' && (
        <Button
          type="button"
          variant="link"
          className="h-auto p-0 text-xs"
          onClick={chooseSource}
        >
          {t.auth.passkeyImport.useAnother}
        </Button>
      )}
      {showCrossDeviceHint && (
        <p className="text-xs text-muted-foreground">
          {t.auth.crossDeviceHint}
        </p>
      )}
    </div>
  )
}
