'use client'

import React, { useEffect, useRef, useState } from 'react'
import { AlertTriangle, ArrowDownToLine, ArrowLeftRight, Check, Lock, Plus } from 'lucide-react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { InputWithQrScanner } from '@/components/ui/input-with-qr-scanner'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Spinner } from '@/components/ui/spinner'
import {
  useRemoteWalletMutations,
  type RemoteWalletData,
} from '@/lib/client/hooks/use-remote-wallets'
import { ApiClientError } from '@/lib/client/api-client'
import {
  probeNwcCapabilities,
  type NwcCapabilities,
} from '@/lib/client/nwc/probe-capabilities'

/**
 * Driver types known to the platform. `NWC` is the only one that's
 * implemented today — the others render as disabled preview options in
 * the picker so the user sees what's coming without us hiding the roadmap.
 */
const DRIVER_OPTIONS: ReadonlyArray<{
  value: RemoteWalletData['type']
  label: string
  enabled: boolean
  hint?: string
}> = [
  { value: 'NWC', label: 'NWC (Nostr Wallet Connect)', enabled: true },
  { value: 'LND', label: 'LND', enabled: false, hint: 'Coming soon' },
  { value: 'CLN', label: 'CLN', enabled: false, hint: 'Coming soon' },
  { value: 'BTCPAY', label: 'BTCPay Server', enabled: false, hint: 'Coming soon' },
]

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
  onCreated?: () => void
}

/**
 * Auto-detection lifecycle. We deliberately surface every state to the
 * UI — silent failures here would mean the user submits with a fallback
 * `mode` without knowing the wallet wasn't actually reachable.
 */
type ProbeState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'success'; capabilities: NwcCapabilities }
  | { status: 'error'; message: string }

const PROBE_DEBOUNCE_MS = 600

export function CreateRemoteWalletDialog({ onCreated }: CreateRemoteWalletDialogProps) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [type, setType] = useState<RemoteWalletData['type']>('NWC')
  const [connectionString, setConnectionString] = useState('')
  const [isDefault, setIsDefault] = useState(false)
  const [probe, setProbe] = useState<ProbeState>({ status: 'idle' })
  const { createWallet, loading } = useRemoteWalletMutations()

  const trimmedName = name.trim()
  const trimmedUri = connectionString.trim()
  const canSubmit =
    !loading &&
    trimmedName.length > 0 &&
    trimmedName.length <= 120 &&
    type === 'NWC' && // only NWC writes today; switch unlocks once other drivers ship
    trimmedUri.length > 0 &&
    looksLikeNwcUri(trimmedUri)

  // ── Auto-probe ────────────────────────────────────────────────────────
  //
  // Whenever the URI changes to something that *looks* like a valid NWC
  // pairing string, kick off `get_info` against the wallet to discover
  // which methods it exposes. Debounced so a paste doesn't trigger a
  // probe per intermediate keystroke; `AbortController` cancels the
  // previous probe if the user keeps editing.
  const abortRef = useRef<AbortController | null>(null)
  useEffect(() => {
    if (type !== 'NWC' || !looksLikeNwcUri(trimmedUri)) {
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
      setProbe({ status: 'checking' })
      try {
        const capabilities = await probeNwcCapabilities(trimmedUri, {
          signal: controller.signal,
        })
        if (!controller.signal.aborted) {
          setProbe({ status: 'success', capabilities })
        }
      } catch (err) {
        if (controller.signal.aborted) return
        const message =
          err instanceof Error
            ? err.name === 'TimeoutError'
              ? 'Wallet didn’t respond in time'
              : err.message
            : 'Couldn’t detect wallet capabilities'
        setProbe({ status: 'error', message })
      }
    }, PROBE_DEBOUNCE_MS)

    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [trimmedUri, type])

  function resetForm() {
    setName('')
    setType('NWC')
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
   * (when that lands).
   */
  const submitMode: 'RECEIVE' | 'SEND_RECEIVE' =
    probe.status === 'success' ? probe.capabilities.mode : 'RECEIVE'

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit) return

    try {
      await createWallet({
        name: trimmedName,
        type,
        config: { connectionString: trimmedUri, mode: submitMode },
        isDefault,
      })
      toast.success('Wallet added')
      setOpen(false)
      resetForm()
      onCreated?.()
    } catch (err) {
      // Server hands back structured errors via `ApiClientError`. Map the
      // ones the user can actually act on; everything else falls through
      // to a generic toast so we don't expose internals.
      if (err instanceof ApiClientError) {
        if (err.status === 409) {
          toast.error('A wallet with that name already exists')
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

  return (
    <Dialog
      open={open}
      onOpenChange={next => {
        setOpen(next)
        if (!next) resetForm()
      }}
    >
      <DialogTrigger asChild>
        <Button className="gap-2">
          <Plus className="size-4" />
          Add wallet
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add a wallet</DialogTitle>
          <DialogDescription>
            Connect an external Lightning wallet so your addresses and Cards
            can route payments through it.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="wallet-name">Name</Label>
            <Input
              id="wallet-name"
              placeholder="e.g. Alby Hub"
              value={name}
              onChange={e => setName(e.target.value)}
              maxLength={120}
              autoFocus
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="wallet-type">Type</Label>
            <Select value={type} onValueChange={v => setType(v as RemoteWalletData['type'])}>
              <SelectTrigger id="wallet-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DRIVER_OPTIONS.map(opt => (
                  <SelectItem key={opt.value} value={opt.value} disabled={!opt.enabled}>
                    <span className="flex items-center gap-2">
                      {!opt.enabled && <Lock className="size-3.5 text-muted-foreground" />}
                      <span>{opt.label}</span>
                      {opt.hint && (
                        <span className="text-xs text-muted-foreground">— {opt.hint}</span>
                      )}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {type === 'NWC' && (
            <>
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
                  onChange={setConnectionString}
                  onScan={text => setConnectionString(text.trim())}
                  onScanError={err => toast.error(err)}
                  scanLabel="Scan NWC QR code"
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck={false}
                  disabled={loading}
                />
                <p className="text-xs text-muted-foreground">
                  Paste or scan the NWC pairing QR from your wallet (Alby,
                  Mutiny, Phoenix, …). It’s stored encrypted and never
                  displayed again.
                </p>
              </div>

              {/* Only surface Capabilities once there's a URI worth probing —
                  the section stays hidden while the field is empty or the
                  input doesn't yet look like an NWC URI (probe `idle`). */}
              {probe.status !== 'idle' && (
                <div className="flex flex-col gap-2">
                  <Label>Capabilities</Label>
                  <CapabilitiesPanel probe={probe} />
                  <p className="text-xs text-muted-foreground">
                    Detected automatically from the wallet’s NIP-47 <code>get_info</code>{' '}
                    response. We use this to decide whether the wallet can both send
                    and receive, or receive only.
                  </p>
                </div>
              )}
            </>
          )}

          <div className="flex items-center justify-between rounded-md border p-3">
            <div className="flex flex-col gap-0.5">
              <Label htmlFor="wallet-default" className="cursor-pointer">
                Set as default
              </Label>
              <p className="text-xs text-muted-foreground">
                Lightning addresses with no explicit wallet will route through
                this one.
              </p>
            </div>
            <Switch
              id="wallet-default"
              checked={isDefault}
              onCheckedChange={setIsDefault}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit} className="gap-2">
              {loading && <Spinner className="size-4" />}
              Add wallet
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
function CapabilitiesPanel({ probe }: { probe: Exclude<ProbeState, { status: 'idle' }> }) {
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

  // success — show the detected mode + wallet alias if reported
  const { capabilities } = probe
  const isSendReceive = capabilities.mode === 'SEND_RECEIVE'
  const Icon = isSendReceive ? ArrowLeftRight : ArrowDownToLine
  return (
    <div className="flex h-10 items-center justify-between rounded-md border border-green-500/40 bg-green-500/5 px-3 text-sm">
      <div className="flex items-center gap-2">
        <Icon className="size-4 text-green-600 dark:text-green-400" />
        <span className="font-medium">
          {isSendReceive ? 'Send and receive' : 'Receive only'}
        </span>
        {capabilities.alias && (
          <span className="text-muted-foreground">· {capabilities.alias}</span>
        )}
      </div>
      <Check className="size-4 text-green-600 dark:text-green-400" />
    </div>
  )
}
