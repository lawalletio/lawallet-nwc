'use client'

import React, { useEffect, useRef, useState } from 'react'
import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowLeftRight,
  Check,
  Plus
} from 'lucide-react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { InputWithQrScanner } from '@/components/ui/input-with-qr-scanner'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/lib/utils'
import {
  useRemoteWalletMutations,
  useRemoteWallets,
  type RemoteWalletData
} from '@/lib/client/hooks/use-remote-wallets'
import { useSettings } from '@/lib/client/hooks/use-settings'
import { ApiClientError } from '@/lib/client/api-client'
import {
  nwcCapabilityKind,
  probeNwcCapabilities,
  type NwcCapabilities
} from '@/lib/client/nwc/probe-capabilities'

const NWC_SCHEMES = ['nostr+walletconnect://', 'nostrwalletconnect://']

/**
 * Cheap client-side guard so we can disable the submit button until the
 * URI at least *looks* like an NWC pairing string. The server runs the
 * authoritative driver schema; this just keeps a typo from costing a
 * round-trip.
 */
function looksLikeNwcUri(uri: string): boolean {
  const trimmed = uri.trim()
  return NWC_SCHEMES.some(p => trimmed.startsWith(p))
}

interface CreateRemoteWalletDialogProps {
  /** Called after a successful create. Page passes its `refetch` here. */
  onCreated?: (wallet: RemoteWalletData) => void | Promise<void>
  /** Optional controlled state for pages that open the shared modal from another control. */
  open?: boolean
  onOpenChange?: (open: boolean) => void
  /** Hide the built-in Add wallet trigger when another component opens the dialog. */
  showTrigger?: boolean
}

/**
 * Auto-detection lifecycle. We deliberately surface every state to the
 * UI — silent failures here would mean the user submits with a fallback
 * `mode` without knowing the wallet wasn't actually reachable.
 */
type ProbeState =
  | { status: 'idle' }
  | { status: 'checking'; uri: string }
  | { status: 'success'; uri: string; capabilities: NwcCapabilities }
  | { status: 'error'; uri: string; message: string }

const PROBE_DEBOUNCE_MS = 600
const WALLET_NAME_MAX = 120

/**
 * Display name for a pasted NWC pairing. Prefer the wallet's own `get_info`
 * alias; otherwise a short label from the wallet pubkey in the URI.
 */
export function walletNameFromNwcConnection(
  uri: string,
  alias: string | null | undefined
): string {
  const cleaned = alias?.trim()
  if (cleaned) return cleaned.slice(0, WALLET_NAME_MAX)

  const withoutScheme = uri
    .trim()
    .replace(/^(?:nostr\+walletconnect|nostrwalletconnect):\/\//i, '')
  const pubkey = withoutScheme.split(/[/?#]/)[0] ?? ''
  const short = pubkey.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8)
  return short ? `NWC ${short}` : 'NWC wallet'
}

/** Which connection method the dialog is currently in. */
type CreateMethod = 'nwc' | 'lncurl'

export function CreateRemoteWalletDialog({
  onCreated,
  open: controlledOpen,
  onOpenChange,
  showTrigger = true
}: CreateRemoteWalletDialogProps) {
  const { data: settings } = useSettings()
  const lncurlEnabled = settings?.lncurl_enabled === 'true'
  const { data: wallets } = useRemoteWallets()
  // A loaded empty list means this wallet will be the only one, so it is the
  // primary address wallet. An in-flight list must not be treated as empty.
  const onlyWallet = Array.isArray(wallets) && wallets.length === 0

  const [open, setOpen] = useState(false)
  const [method, setMethod] = useState<CreateMethod>('nwc')
  const [name, setName] = useState('')
  const [rename, setRename] = useState<string | null>(null)
  const [connectionString, setConnectionString] = useState('')
  const [isDefault, setIsDefault] = useState(false)
  const [probe, setProbe] = useState<ProbeState>({ status: 'idle' })
  const {
    createWallet,
    createLncurlWallet,
    loading: creating
  } = useRemoteWalletMutations()

  const trimmedName = name.trim()
  const trimmedUri = connectionString.trim()
  const probeForUri =
    probe.status !== 'idle' && probe.uri === trimmedUri ? probe : null
  const nwcName = walletNameFromNwcConnection(
    trimmedUri,
    probeForUri?.status === 'success' ? probeForUri.capabilities.alias : null
  )
  const nwcSubmitName = (rename ?? nwcName).trim().slice(0, WALLET_NAME_MAX)
  // LNCurl mints the connection server-side, so the only requirement is "not
  // already submitting" (the name is optional — the server defaults it).
  // NWC waits until the connection has been probed so the saved name can come
  // from the wallet's alias.
  const canSubmit =
    method === 'lncurl'
      ? !creating
      : !creating &&
        looksLikeNwcUri(trimmedUri) &&
        nwcSubmitName.length > 0 &&
        (probeForUri?.status === 'success' || probeForUri?.status === 'error')

  // ── Auto-probe ────────────────────────────────────────────────────────
  //
  // Whenever the URI changes to something that *looks* like a valid NWC
  // pairing string, kick off `get_info` against the wallet to discover
  // which methods it exposes. Debounced so a paste doesn't trigger a
  // probe per intermediate keystroke; `AbortController` cancels the
  // previous probe if the user keeps editing.
  const abortRef = useRef<AbortController | null>(null)
  useEffect(() => {
    if (!looksLikeNwcUri(trimmedUri)) {
      abortRef.current?.abort()
      abortRef.current = null
      // Functional update — React bails out when we're already idle, so
      // toggling URIs back and forth doesn't cascade re-renders.
      setProbe(prev => (prev.status === 'idle' ? prev : { status: 'idle' }))
      return
    }

    const controller = new AbortController()
    abortRef.current?.abort()
    abortRef.current = controller

    const timer = setTimeout(async () => {
      const probedUri = trimmedUri
      setProbe({ status: 'checking', uri: probedUri })
      try {
        const capabilities = await probeNwcCapabilities(trimmedUri, {
          signal: controller.signal
        })
        if (!controller.signal.aborted) {
          setProbe({ status: 'success', uri: probedUri, capabilities })
        }
      } catch (err) {
        if (controller.signal.aborted) return
        const message =
          err instanceof Error
            ? err.name === 'TimeoutError'
              ? 'Wallet didn’t respond in time'
              : err.message
            : 'Couldn’t detect wallet capabilities'
        setProbe({ status: 'error', uri: probedUri, message })
      }
    }, PROBE_DEBOUNCE_MS)

    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [trimmedUri])

  function resetForm() {
    // Default to the LNCurl flow when the operator has enabled it — that's the
    // frictionless path the feature exists to offer.
    setMethod(lncurlEnabled ? 'lncurl' : 'nwc')
    setName('')
    setRename(null)
    setConnectionString('')
    setIsDefault(false)
    setProbe({ status: 'idle' })
    abortRef.current?.abort()
    abortRef.current = null
  }

  /**
   * Mode the form will submit. Falls back to RECEIVE when detection
   * didn't complete — that's the strictly more limited capability, so
   * the worst-case outcome of a bad detect is a wallet flagged as
   * receive-only that the user can upgrade later via the per-row edit
   * (when that lands). Persisted `mode` is still the two-value enum;
   * a view-only pairing (`canReceive=false`) is not treated as receive-
   * capable — we refuse primary-address binding instead of inventing a
   * third stored mode that existing consumers don't understand.
   */
  const submitMode: 'RECEIVE' | 'SEND_RECEIVE' =
    probeForUri?.status === 'success'
      ? probeForUri.capabilities.mode
      : 'RECEIVE'

  const cannotReceive =
    method === 'nwc' &&
    probeForUri?.status === 'success' &&
    !probeForUri.capabilities.canReceive
  const primaryAllowed = !cannotReceive
  const submitIsDefault = primaryAllowed && (onlyWallet || isDefault)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit) return

    try {
      let created: RemoteWalletData
      if (method === 'lncurl') {
        created = await createLncurlWallet({
          name: trimmedName || undefined,
          isDefault: submitIsDefault
        })
        toast.success('LNCurl wallet created')
      } else {
        created = await createWallet({
          name: nwcSubmitName,
          type: 'NWC',
          config: { connectionString: trimmedUri, mode: submitMode },
          isDefault: submitIsDefault
        })
        toast.success('Wallet added')
      }
      setDialogOpen(false)
      resetForm()
      await onCreated?.(created)
    } catch (err) {
      // Server hands back structured errors via `ApiClientError`. Map the
      // ones the user can actually act on; everything else falls through
      // to a generic toast so we don't expose internals.
      if (err instanceof ApiClientError) {
        if (err.status === 409) {
          if (method === 'nwc') setRename(current => current ?? nwcName)
          toast.error(
            method === 'nwc'
              ? 'A wallet with that name already exists. Choose another name.'
              : 'A wallet with that name already exists'
          )
          return
        }
        if (err.status === 400) {
          toast.error(err.message || 'Invalid wallet details')
          return
        }
      }
      toast.error(err instanceof Error ? err.message : 'Failed to add wallet')
    }
  }

  const dialogOpen = controlledOpen ?? open
  const setDialogOpen = (next: boolean) => {
    if (controlledOpen === undefined) {
      setOpen(next)
    }
    onOpenChange?.(next)
  }

  return (
    <Dialog
      open={dialogOpen}
      onOpenChange={next => {
        setDialogOpen(next)
        if (next) setMethod(lncurlEnabled ? 'lncurl' : 'nwc')
        else resetForm()
      }}
    >
      {showTrigger && (
        <DialogTrigger asChild>
          <Button className="gap-2">
            <Plus className="size-4" />
            Add wallet
          </Button>
        </DialogTrigger>
      )}

      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add a wallet</DialogTitle>
          <DialogDescription>
            Connect an external Lightning wallet so your addresses and Cards can
            route payments through it.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {lncurlEnabled && (
            <div className="grid grid-cols-2 gap-2 rounded-lg border p-1">
              <button
                type="button"
                disabled={creating}
                onClick={() => setMethod('lncurl')}
                className={cn(
                  'rounded-md px-3 py-2 text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-60',
                  method === 'lncurl'
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-muted'
                )}
              >
                Create LNCurl wallet
              </button>
              <button
                type="button"
                disabled={creating}
                onClick={() => setMethod('nwc')}
                className={cn(
                  'rounded-md px-3 py-2 text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-60',
                  method === 'nwc'
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-muted'
                )}
              >
                Paste connection string
              </button>
            </div>
          )}

          {method === 'lncurl' && (
            <div className="flex flex-col gap-2">
              <Label htmlFor="wallet-name">
                Name
                <span className="font-normal text-muted-foreground">
                  {' '}
                  (optional)
                </span>
              </Label>
              <Input
                id="wallet-name"
                placeholder="LNCurl wallet"
                value={name}
                onChange={e => setName(e.target.value)}
                maxLength={120}
                autoFocus
                disabled={creating}
              />
            </div>
          )}

          {method === 'nwc' ? (
            <>
              {rename !== null && (
                <div className="flex flex-col gap-2">
                  <Label htmlFor="wallet-name">Name</Label>
                  <Input
                    id="wallet-name"
                    value={rename}
                    onChange={e => setRename(e.target.value)}
                    maxLength={WALLET_NAME_MAX}
                    autoFocus
                    disabled={creating}
                  />
                  <p className="text-xs text-muted-foreground">
                    That name is already used. Pick another.
                  </p>
                </div>
              )}
              <div className="flex flex-col gap-2">
                <Label htmlFor="wallet-uri">Connection string</Label>
                <InputWithQrScanner
                  id="wallet-uri"
                  // `type="password"` masks the URI on screen (it carries a
                  // shared secret) and disables browser autofill — matches
                  // the existing NWC input pattern in `nwc-card.tsx`.
                  type="password"
                  placeholder="nostr+walletconnect://..."
                  value={connectionString}
                  onChange={value => {
                    setConnectionString(value)
                    setRename(null)
                  }}
                  onScan={text => {
                    setConnectionString(text.trim())
                    setRename(null)
                  }}
                  onScanError={err => toast.error(err)}
                  scanLabel="Scan NWC QR code"
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck={false}
                  autoFocus
                  disabled={creating}
                />
                <p className="text-xs text-muted-foreground">
                  Paste or scan the NWC pairing QR from your wallet (Alby,
                  Mutiny, Phoenix, …). It’s stored encrypted and never displayed
                  again.
                </p>
              </div>

              {/* Only surface Capabilities once there's a URI worth probing —
                  the section stays hidden while the field is empty or the
                  input doesn't yet look like an NWC URI (probe `idle`). */}
              {probeForUri ? (
                <div className="flex flex-col gap-2">
                  <Label>Capabilities</Label>
                  <CapabilitiesPanel probe={probeForUri} />
                  <p className="text-xs text-muted-foreground">
                    Detected automatically from the wallet’s NIP-47{' '}
                    <code>get_info</code> response. We use this to decide
                    whether the wallet can both send and receive, or receive
                    only.
                  </p>
                </div>
              ) : null}

              {!onlyWallet && (
                <div className="flex items-center justify-between rounded-md border p-3">
                  <div className="flex flex-col gap-0.5">
                    <Label
                      htmlFor="wallet-default"
                      className={
                        primaryAllowed
                          ? 'cursor-pointer'
                          : 'cursor-not-allowed opacity-70'
                      }
                    >
                      Use for primary address
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      {cannotReceive
                        ? 'This wallet cannot receive payments, so it cannot be used for your primary Lightning Address.'
                        : 'If you have a primary address, it will be linked to this wallet.'}
                    </p>
                  </div>
                  <Switch
                    id="wallet-default"
                    checked={isDefault && primaryAllowed}
                    onCheckedChange={setIsDefault}
                    disabled={creating || !primaryAllowed}
                  />
                </div>
              )}
            </>
          ) : (
            <>
              <div className="flex items-start gap-2 rounded-md border border-yellow-500/40 bg-yellow-500/5 p-3 text-sm text-yellow-700 dark:text-yellow-400">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                <span>
                  LNCurl wallets cost <strong>1 sat per hour</strong> to stay
                  alive — your <strong>first hour is free</strong>. If the
                  balance runs out and hits{' '}
                  <strong>0 sats, the wallet is permanently destroyed</strong>.
                  Don’t store large amounts.
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                Create an empty disposable wallet first, then fund it before
                use.
              </p>
              {!onlyWallet && (
                <div className="flex items-center justify-between rounded-md border p-3">
                  <div className="flex flex-col gap-0.5">
                    <Label
                      htmlFor="wallet-default-lncurl"
                      className="cursor-pointer"
                    >
                      Use for primary address
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      If you have a primary address, it will be linked to this
                      wallet.
                    </p>
                  </div>
                  <Switch
                    id="wallet-default-lncurl"
                    checked={isDefault}
                    onCheckedChange={setIsDefault}
                    disabled={creating}
                  />
                </div>
              )}
            </>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={creating}
              onClick={() => setDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit} className="gap-2">
              {creating && <Spinner className="size-4" />}
              {method === 'lncurl' ? 'Create wallet' : 'Add wallet'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Renders the current state of the auto-probe in place of the manual
 * Capabilities select. Always occupies a fixed-height row so the form
 * doesn't reflow each time the state advances `checking → success`.
 *
 * The caller only mounts this once `probe.status !== 'idle'`, so the idle
 * state has no branch here.
 */
function CapabilitiesPanel({
  probe
}: {
  probe: Exclude<ProbeState, { status: 'idle' }>
}) {
  if (probe.status === 'checking') {
    return (
      <div className="flex h-10 items-center gap-2 rounded-md border px-3 text-sm text-muted-foreground">
        <Spinner className="size-4" />
        Detecting wallet capabilities…
      </div>
    )
  }
  if (probe.status === 'error') {
    return (
      <div className="flex h-10 items-center gap-2 rounded-md border border-yellow-500/40 bg-yellow-500/5 px-3 text-sm text-yellow-600 dark:text-yellow-400">
        <AlertTriangle className="size-4 shrink-0" />
        <span className="line-clamp-1">
          {probe.message}. Wallet will be saved as receive-only.
        </span>
      </div>
    )
  }

  // success — show the detected mode + wallet alias if reported.
  // View-only / send-only pairings grant no `make_invoice`; never present
  // those as a green “Receive only ✓” success.
  const { capabilities } = probe
  const kind = nwcCapabilityKind(capabilities)
  const alias = capabilities.alias ? (
    <span className="text-muted-foreground">· {capabilities.alias}</span>
  ) : null

  if (kind === 'VIEW_ONLY' || kind === 'SEND_ONLY') {
    return (
      <div className="flex items-start gap-2 rounded-md border border-yellow-500/40 bg-yellow-500/5 px-3 py-2 text-sm text-yellow-700 dark:text-yellow-400">
        <AlertTriangle className="mt-0.5 size-4 shrink-0" />
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="font-medium">
            {kind === 'SEND_ONLY' ? 'Send only' : 'View-only'}
            {alias}
          </span>
          <span className="text-xs text-yellow-700/90 dark:text-yellow-400/90">
            This wallet cannot receive payments. It cannot be used for your
            primary Lightning Address.
          </span>
        </div>
      </div>
    )
  }

  const isSendReceive = kind === 'SEND_RECEIVE'
  const Icon = isSendReceive ? ArrowLeftRight : ArrowDownToLine
  return (
    <div className="flex h-10 items-center justify-between rounded-md border border-green-500/40 bg-green-500/5 px-3 text-sm">
      <div className="flex items-center gap-2">
        <Icon className="size-4 text-green-600 dark:text-green-400" />
        <span className="font-medium">
          {isSendReceive ? 'Send and receive' : 'Receive only'}
        </span>
        {alias}
      </div>
      <Check className="size-4 text-green-600 dark:text-green-400" />
    </div>
  )
}
