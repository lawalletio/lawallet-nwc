'use client'

import { useEffect, useRef, useState } from 'react'
import { PasskeyAccountPreview } from '@/components/shared/passkey-account-preview'
import { Check, Fingerprint } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Spinner } from '@/components/ui/spinner'
import { useAuth } from '@/components/admin/auth-context'
import type { NostrSigner } from '@nostrify/nostrify'
import {
  createPasskeyProviderSigner,
  closePasskeyProviderSigner
} from '@/lib/client/passkey-provider'
import { createNsecSigner } from '@/lib/client/nostr-signer'
import { translatePasskeyError } from '@/lib/client/passkey-api'
import {
  forgetRememberedSource,
  linkKeptKey,
  protectImportedKey,
  readImportSource,
  readRememberedSource,
  rememberSource,
  type ImportedPasskey
} from '@/lib/client/passkey-import'
import {
  passkeyImportSourceSchema,
  type PasskeyImportSource
} from '@/lib/passkey-import-sources'
import {
  bytesToHex,
  defaultStoredAccount,
  wipeStoredAccounts,
  type StoredAccount
} from '@/lib/passkey-store'
import { toNpub } from '@/lib/client/format'
import { useT } from '@/lib/client/i18n'
import { errorText } from '@/lib/client/i18n/errors'
import { cn } from '@/lib/utils'

interface PasskeyImportPanelProps {
  sources: PasskeyImportSource[]
  /**
   * `signin` creates or opens the account by the imported pubkey and logs
   * in with it; `link` adds it to the signed-in account (needs `token`).
   */
  mode: 'signin' | 'link'
  token?: string
  onDone?: () => void
  onUseLocal?: () => void
}

type Choice = 'keep' | 'copy'

/**
 * The import of an identity held in another app's passkey: unlock that
 * passkey, pick an account if it keeps several, confirm the public key,
 * then use it for this session. Remembering the public account is optional.
 * In signed-in security settings, "keep" remembers only the source and
 * account; "copy" protects the key with a new LaWallet passkey.
 * Every ceremony runs inside a click handler (Safari/iOS transient
 * activation). Decrypted keys are wiped when the flow ends or the panel
 * unmounts.
 */
export function PasskeyImportPanel({
  sources,
  mode,
  token,
  onDone,
  onUseLocal
}: PasskeyImportPanelProps) {
  const tAll = useT()
  const t = tAll.auth.passkeyImport
  const { login } = useAuth()
  const [imported, setImported] = useState<ImportedPasskey | null>(null)
  const [selected, setSelected] = useState<StoredAccount | null>(null)
  const [confirmed, setConfirmed] = useState(false)
  const [choice, setChoice] = useState<Choice>('keep')
  const [busy, setBusy] = useState(false)
  const [remember, setRemember] = useState(false)
  const [search, setSearch] = useState('')
  const [error, setError] = useState<string | null>(null)
  const held = useRef<StoredAccount[]>([])
  const provider = useRef<NostrSigner | null>(null)
  const [providerSelected, setProviderSelected] = useState(false)
  const generation = useRef(0)
  const attemptController = useRef<AbortController | null>(null)
  const fileVersion = useRef(0)
  const [backups, setBackups] = useState<Record<string, string>>({})

  useEffect(
    () => () => {
      generation.current++
      attemptController.current?.abort()
      fileVersion.current++
      wipeStoredAccounts(held.current)
      closePasskeyProviderSigner(provider.current)
      provider.current = null
    },
    []
  )

  function reset() {
    generation.current++
    attemptController.current?.abort()
    attemptController.current = null
    closePasskeyProviderSigner(provider.current)
    provider.current = null
    setProviderSelected(false)
    wipeStoredAccounts(held.current)
    held.current = []
    setImported(null)
    setSelected(null)
    setConfirmed(false)
    setChoice('keep')
  }

  function fail(err: unknown) {
    const passkeyError = translatePasskeyError(err)
    const message = errorText(tAll, passkeyError, passkeyError.message)
    setError(message)
    if (passkeyError.kind !== 'cancelled') toast.error(message)
  }

  async function handleUnlock(
    source: PasskeyImportSource,
    useProvider = false
  ) {
    setError(null)
    setBusy(true)
    reset()
    const attempt = generation.current
    const controller = new AbortController()
    attemptController.current = controller
    try {
      if (useProvider && source.iframeUrl && mode === 'signin') {
        const signer = await createPasskeyProviderSigner(
          source.iframeUrl,
          controller.signal
        )
        if (generation.current !== attempt) {
          closePasskeyProviderSigner(signer)
          return
        }
        provider.current = signer
        setProviderSelected(true)
        const pubkey = await signer.getPublicKey()
        if (generation.current !== attempt) {
          closePasskeyProviderSigner(signer)
          return
        }
        const accounts = [{ pubkey, secret: new Uint8Array(), default: true }]
        setImported({ source, author: pubkey, credentialId: '', accounts })
        setSelected(accounts[0])
        return
      }
      const result = await (source.format === 'nosskey'
        ? readImportSource(source, backups[source.rpId])
        : readImportSource(source))
      if (generation.current !== attempt) {
        wipeStoredAccounts(result.accounts)
        return
      }
      held.current = result.accounts
      setImported(result)
      setSelected(defaultStoredAccount(result.accounts))
    } catch (err) {
      if (generation.current === attempt) fail(err)
    } finally {
      if (generation.current === attempt) setBusy(false)
    }
  }

  async function handleContinue() {
    if (!imported || !selected) return
    setError(null)
    setBusy(true)
    try {
      if (provider.current) {
        const signer = provider.current
        await login(signer, 'passkey', {
          secret: '',
          persistence: 'memory',
          signal: attemptController.current?.signal
        })
        attemptController.current = null
        provider.current = null // AuthProvider owns teardown after successful login.
        reset()
        onDone?.()
        return
      }
      if (choice === 'keep') {
        const entry = {
          rpId: imported.source.rpId,
          credentialId: imported.credentialId,
          pubkey: selected.pubkey,
          ...(imported.nosskey ? { nosskey: imported.nosskey } : {})
        }
        const secretHex = bytesToHex(selected.secret)
        reset()
        if (mode === 'signin') {
          const controller = new AbortController()
          attemptController.current = controller
          await login(createNsecSigner(secretHex), 'passkey', {
            secret: secretHex,
            persistence: 'memory',
            signal: controller.signal
          })
          attemptController.current = null
        } else {
          await linkKeptKey(secretHex, token!)
          toast.success(t.kept)
        }
        if (mode === 'link' || remember) rememberSource(entry)
        else forgetRememberedSource()
      } else {
        const identity = await protectImportedKey(
          selected,
          mode === 'link' ? token : undefined
        )
        // A LaWallet copy of the remembered passkey replaces it.
        if (readRememberedSource()?.credentialId === imported.credentialId) {
          forgetRememberedSource()
        }
        reset()
        if (mode === 'signin') {
          await login(createNsecSigner(identity.secretHex), 'passkey', {
            secret: identity.secretHex,
            persistence: 'memory'
          })
        } else {
          toast.success(t.saved)
        }
      }
      onDone?.()
    } catch (err) {
      fail(err)
    } finally {
      setBusy(false)
    }
  }

  if (!imported || !selected) {
    return (
      <div className="space-y-3">
        <p className="font-medium">{t.chooseSource}</p>
        <Input
          aria-label={t.searchSources}
          placeholder={t.searchSources}
          value={search}
          onChange={event => setSearch(event.target.value)}
          autoCapitalize="none"
          autoCorrect="off"
          disabled={busy}
        />
        {onUseLocal &&
          `${t.thisApp} ${typeof window === 'undefined' ? '' : window.location.hostname}`
            .toLowerCase()
            .includes(search.trim().toLowerCase()) && (
            <Button
              type="button"
              variant="secondary"
              className="h-14 w-full justify-start"
              disabled={busy}
              onClick={onUseLocal}
              aria-label={t.thisApp}
            >
              <SourceLabel
                label={t.thisApp}
                domain={
                  typeof window === 'undefined' ? '' : window.location.hostname
                }
              />
            </Button>
          )}
        {sources
          .filter(source =>
            `${source.label} ${source.rpId}`
              .toLowerCase()
              .includes(search.trim().toLowerCase())
          )
          .slice(0, 5)
          .map(source => (
            <div key={source.rpId} className="space-y-2">
              {source.format === 'nosskey' && (
                <label className="block text-sm">
                  {t.backupFile}
                  <Input
                    type="file"
                    accept="application/json,.json"
                    disabled={busy}
                    onChange={async event => {
                      const file = event.target.files?.[0]
                      const version = ++fileVersion.current
                      setBackups(value => ({ ...value, [source.rpId]: '' }))
                      if (!file) return
                      if (file.size > 8192) {
                        setError(t.backupInvalid)
                        return
                      }
                      try {
                        const text = await file.text()
                        if (version !== fileVersion.current) return
                        setBackups(value => ({ ...value, [source.rpId]: text }))
                      } catch {
                        setError(t.backupInvalid)
                      }
                    }}
                  />
                </label>
              )}
              {source.iframeUrl && mode === 'signin' && (
                <Button
                  type="button"
                  variant="theme"
                  className="h-12 w-full"
                  disabled={busy}
                  onClick={() => void handleUnlock(source, true)}
                >
                  {t.signWithProvider(source.label)}
                </Button>
              )}
              <Button
                key={source.rpId}
                type="button"
                variant="secondary"
                className="h-14 w-full justify-start"
                onClick={() => void handleUnlock(source)}
                disabled={
                  busy || (source.format === 'nosskey' && !backups[source.rpId])
                }
              >
                {busy ? (
                  <>
                    <Spinner size={16} />
                    {t.waiting}
                  </>
                ) : (
                  <SourceLabel label={source.label} domain={source.rpId} />
                )}
              </Button>
            </div>
          ))}
        <p className="text-xs text-muted-foreground">
          {sources.some(source => source.iframeUrl) && mode === 'signin'
            ? t.providerSourceNotice
            : t.accessNotice}
        </p>
        {search.trim() &&
          !sources.some(source =>
            `${source.label} ${source.rpId}`
              .toLowerCase()
              .includes(search.trim().toLowerCase())
          ) && (
            <form
              className="mt-3 space-y-2"
              onSubmit={event => {
                event.preventDefault()
                const parsed = passkeyImportSourceSchema.safeParse({
                  label: search.trim(),
                  rpId: search.trim()
                })
                if (!parsed.success) {
                  setError(t.invalidDomain)
                  return
                }
                setRemember(false)
                void handleUnlock(
                  sources.find(source => source.rpId === parsed.data.rpId) ??
                    parsed.data
                )
              }}
            >
              <Button
                type="submit"
                variant="secondary"
                disabled={busy || !search.trim()}
              >
                {t.continue}
              </Button>
            </form>
          )}
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
    )
  }

  if (confirmed && mode === 'signin') {
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          {providerSelected ? t.providerNotice : t.temporaryBody}
        </p>
        {!providerSelected &&
          sources.some(source => source.rpId === imported.source.rpId) && (
            <label className="flex items-center gap-3 text-sm">
              <Checkbox
                checked={remember}
                onCheckedChange={value => setRemember(value === true)}
                disabled={busy}
              />
              {imported.nosskey ? t.rememberBackup : t.rememberAccount}
            </label>
          )}
        {error && <p className="text-xs text-destructive">{error}</p>}
        <Button
          type="button"
          variant="theme"
          className="h-12 w-full"
          onClick={() => void handleContinue()}
          disabled={busy}
        >
          {busy ? <Spinner size={16} /> : <Fingerprint className="size-4" />}
          {busy ? t.waiting : t.useThisTime}
        </Button>
      </div>
    )
  }

  if (confirmed) {
    return (
      <div className="space-y-4">
        <p className="text-base font-medium text-foreground">{t.choiceTitle}</p>
        <div className="flex flex-col rounded-2xl bg-card" role="radiogroup">
          {(['keep', 'copy'] as const).map(option => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={choice === option}
              onClick={() => setChoice(option)}
              disabled={busy}
              className={cn(
                'flex w-full items-start justify-between gap-3 border-b border-border/40 px-4 py-3 text-left transition-colors last:border-b-0 hover:bg-accent/40',
                choice === option && 'bg-accent/40'
              )}
            >
              <div className="min-w-0 space-y-1">
                <p className="text-base font-medium text-foreground">
                  {option === 'keep' ? t.keepTitle : t.copyTitle}
                </p>
                <p className="text-sm text-muted-foreground">
                  {option === 'keep' ? t.keepBody : t.copyBody}
                </p>
              </div>
              {choice === option && <Check className="mt-1 size-4 shrink-0" />}
            </button>
          ))}
        </div>

        {error && <p className="text-xs text-destructive">{error}</p>}

        <Button
          type="button"
          variant="theme"
          className="h-12 w-full"
          onClick={() => void handleContinue()}
          disabled={busy}
        >
          {busy ? <Spinner size={16} /> : <Fingerprint className="size-4" />}
          {busy ? t.waiting : t.continue}
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {imported.warnings?.map((warning, index) => (
        <p key={index} role="status" className="text-sm text-amber-700">
          {warning}
        </p>
      ))}
      {imported.accounts.length > 1 && (
        <StoredAccountPicker
          accounts={imported.accounts}
          selected={selected}
          onSelect={setSelected}
          disabled={busy}
        />
      )}

      <PasskeyAccountPreview pubkey={selected.pubkey} />

      {error && <p className="text-xs text-destructive">{error}</p>}

      <div className="space-y-3">
        <Button
          type="button"
          variant="theme"
          className="h-12 w-full"
          onClick={() => setConfirmed(true)}
          disabled={busy}
        >
          <Check className="size-4" />
          {t.confirm}
        </Button>
        <Button
          type="button"
          variant="secondary"
          className="h-12 w-full"
          onClick={() => {
            reset()
            setError(null)
          }}
          disabled={busy}
        >
          {t.notMine}
        </Button>
      </div>
    </div>
  )
}

/** The accounts a vault passkey keeps, as a radio list. */
export function StoredAccountPicker({
  accounts,
  selected,
  onSelect,
  disabled,
  prompt
}: {
  accounts: StoredAccount[]
  selected: StoredAccount | null
  onSelect: (account: StoredAccount) => void
  disabled?: boolean
  prompt?: string
}) {
  const t = useT().auth.passkeyImport
  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">{prompt ?? t.pickAccount}</p>
      <div className="flex flex-col rounded-2xl bg-card" role="radiogroup">
        {accounts.map((account, i) => (
          <button
            key={account.pubkey}
            type="button"
            role="radio"
            aria-checked={account === selected}
            onClick={() => onSelect(account)}
            disabled={disabled}
            className={cn(
              'flex min-h-14 w-full items-center justify-between gap-3 border-b border-border/40 px-4 text-left transition-colors last:border-b-0 hover:bg-accent/40',
              account === selected && 'bg-accent/40'
            )}
          >
            <div className="min-w-0">
              <p className="truncate text-base font-medium text-foreground">
                {account.label || t.account(i + 1)}
              </p>
              <p className="truncate font-mono text-[11px] text-muted-foreground/80">
                {toNpub(account.pubkey)}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {account.default && (
                <Badge variant="secondary">{t.defaultAccount}</Badge>
              )}
              {account === selected && <Check className="size-4" />}
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}

function SourceLabel({ label, domain }: { label: string; domain: string }) {
  return (
    <>
      <span className="relative flex size-8 shrink-0 items-center justify-center rounded bg-muted">
        <Fingerprint className="size-4" />
        <img
          src={`https://${domain}/favicon.ico`}
          alt=""
          referrerPolicy="no-referrer"
          className="absolute size-6 rounded bg-muted"
          onError={event => {
            event.currentTarget.style.display = 'none'
          }}
        />
      </span>
      <span className="min-w-0 text-left">
        <span className="block truncate">{label}</span>
        <span className="block truncate text-xs font-normal text-muted-foreground">
          {domain}
        </span>
      </span>
    </>
  )
}
