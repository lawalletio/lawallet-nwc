'use client'

import React, { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import {
  ArrowDownLeft,
  ArrowUpRight,
  ArrowRight,
  Copy,
  ExternalLink,
  Star,
  Wallet,
  X,
  Zap,
} from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/lib/utils'
import { formatRelativeTime } from '@/lib/client/format'
import {
  useLiveRemoteWalletBalance,
  useRemoteWalletConnectionString,
  type RemoteWalletData,
} from '@/lib/client/hooks/use-remote-wallets'
import { useAnimatedNumber } from '@/lib/client/hooks/use-animated-number'
import type { WalletAddress } from '@/lib/client/hooks/use-wallet-addresses'
import type { CardData } from '@/lib/client/hooks/use-cards'
import { makeInvoice, type MakeInvoiceResult } from '@/lib/client/nwc'
import { toast } from 'sonner'
import { InfoField } from './info-field'

interface Props {
  wallet: RemoteWalletData
  /** Caller's full LA list — used to count how many bind to this wallet. */
  addresses: WalletAddress[]
  /** Caller's full card list — used to count how many bind to this wallet. */
  cards: CardData[]
  onClose: () => void
}

// WebLN provider shape — mirrors the inline declaration in
// `new-address-dialog.tsx`. Kept lightweight (only what we call).
interface WebLnProvider {
  enable(): Promise<void>
  sendPayment(bolt11: string): Promise<{ preimage: string }>
}
type WebLnWindow = Window & { webln?: WebLnProvider }

/**
 * Remote Wallet detail dialog. Redesigned to lead with the balance —
 * the wallet's reason for existing — rather than buryin it in a grid
 * of metadata fields. Mirrors the visual hierarchy of a real wallet:
 *
 *   [balance hero, big tabular number]
 *   [wallet name + Default badge]
 *   [Receive / Send actions]   ← morph in place into receive flow
 *   ─────────────────
 *   compact metadata
 *
 * Receive flow: clicking Receive swaps the buttons row for an inline
 * "enter amount → mint invoice → show + WebLN pay" sequence. The
 * invoice is minted CLIENT-SIDE via NWC against this specific wallet's
 * connection URI (fetched on demand from the connection-string
 * endpoint), so the invoice routes to the wallet the user is actually
 * looking at — not their default wallet.
 *
 * Send hops to `/wallet/send` for now (the existing send page works
 * against the default wallet; per-wallet send is a larger flow).
 */
export function WalletDetailDialog({ wallet, addresses, cards, onClose }: Props) {
  const isLive = wallet.status !== 'REVOKED'
  const balance = useLiveRemoteWalletBalance(isLive ? wallet.id : null)
  const animatedSats = useAnimatedNumber(balance.data?.balanceSats ?? null)

  // Match the LA edge logic in buildGraph.
  const boundLas = addresses.filter(a => {
    if (a.mode === 'CUSTOM_NWC') return a.remoteWalletId === wallet.id
    if (a.mode === 'DEFAULT_NWC') return wallet.isDefault
    return false
  })
  const boundCards = cards.filter(c => c.remoteWalletId === wallet.id)

  const hasBalance = isLive && balance.data != null
  const state: 'searching' | 'connected' | 'error' | 'disabled' = !isLive
    ? 'disabled'
    : balance.error
      ? 'error'
      : hasBalance
        ? 'connected'
        : 'searching'
  const stateLabel = {
    connected: 'Connected',
    searching: 'Searching…',
    error: 'Unavailable',
    disabled: 'Disabled',
  }[state]

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wallet className="size-4 text-amber-400" />
            Remote Wallet
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* HERO — balance card. Gradient surface + a soft amber glow
              in the corner gives it some weight without screaming. */}
          <div className="relative overflow-hidden rounded-lg border border-border bg-gradient-to-br from-card to-card/40 p-5">
            {/* Decorative glow — pointer-events-none so it doesn't
                interfere with the action buttons below. */}
            <div className="pointer-events-none absolute -right-16 -top-16 size-56 rounded-full bg-amber-400/10 blur-3xl" />

            {/* Balance row */}
            <div className="relative space-y-1">
              <div className="text-xs uppercase tracking-wider text-muted-foreground">
                Balance
              </div>
              <div
                className="flex items-baseline gap-2 tabular-nums"
                aria-label={`Balance ${state}`}
              >
                <span className="text-4xl font-semibold leading-none">
                  {hasBalance ? animatedSats.toLocaleString() : '—'}
                </span>
                <span className="text-base text-muted-foreground">sats</span>
              </div>
              {/* Connection status — small row, dot + label. */}
              <div className="flex items-center gap-1.5 pt-1 text-xs text-muted-foreground">
                <span
                  className={cn(
                    'inline-block size-1.5 shrink-0 rounded-full',
                    state === 'connected' && 'bg-emerald-400',
                    state === 'searching' && 'animate-pulse bg-amber-400',
                    state === 'error' && 'bg-destructive',
                    state === 'disabled' && 'bg-muted-foreground',
                  )}
                />
                {stateLabel}
              </div>
            </div>

            {/* Wallet name + Default badge — secondary line. */}
            <div className="relative mt-5 flex items-center gap-2 text-sm font-medium">
              <Wallet className="size-4 shrink-0 text-amber-400" />
              <span className="truncate">{wallet.name}</span>
              {wallet.isDefault && (
                <Badge variant="secondary" className="gap-1">
                  <Star className="size-3 fill-amber-400 text-amber-400" />
                  Default
                </Badge>
              )}
            </div>

            {/* Actions — Receive morphs in place into an amount input +
                invoice display; Send stays static (it routes to the
                existing /wallet/send flow which is default-wallet only
                today). */}
            <div className="relative mt-4">
              <WalletActions
                walletId={wallet.id}
                walletName={wallet.name}
                disabled={!isLive}
                onClose={onClose}
              />
            </div>
          </div>

          {/* Compact metadata strip. */}
          <div className="grid grid-cols-2 gap-4">
            <InfoField label="Type" value={<Badge variant="outline">{wallet.type}</Badge>} />
            <InfoField
              label="Status"
              value={<Badge variant="outline">{wallet.status}</Badge>}
            />

            <InfoField
              label="Bound addresses"
              value={
                boundLas.length === 0 ? (
                  <span className="text-muted-foreground">None</span>
                ) : (
                  <span>{boundLas.length}</span>
                )
              }
            />
            <InfoField
              label="Bound cards"
              value={
                boundCards.length === 0 ? (
                  <span className="text-muted-foreground">None</span>
                ) : (
                  <span>{boundCards.length}</span>
                )
              }
            />

            <InfoField
              label="Created"
              value={formatRelativeTime(wallet.createdAt)}
            />
            <InfoField
              label="Updated"
              value={formatRelativeTime(wallet.updatedAt)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="secondary" asChild onClick={onClose}>
            <Link href="/admin/remote-wallets">
              Manage wallet
              <ExternalLink className="ml-1 size-3" />
            </Link>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Receive + Send actions with inline receive flow ──────────────────────

type ReceiveMode = 'idle' | 'amount' | 'invoice'

/**
 * Receive / Send action row with an inline receive sub-flow.
 *
 * - idle  : two big buttons (Receive | Send), matching the home-screen
 *           pattern (variant secondary + theme, h-11).
 * - amount: the Receive button morphs into an X-cancel + numeric input
 *           + arrow-confirm; Send stays clickable. Enter submits.
 * - invoice: the buttons row is replaced by a compact "minted invoice"
 *           card with the truncated bolt11, copy, optional WebLN pay,
 *           and a Done button that returns to idle.
 *
 * The wallet's NWC URI is fetched lazily through `useRemoteWalletConnectionString`
 * (passes `null` while idle so the GET only fires once the user
 * actually starts a receive). The mint itself happens client-side via
 * `makeInvoice` — same code path the existing /wallet/receive page
 * uses, just scoped to this wallet instead of the user's default.
 */
function WalletActions({
  walletId,
  walletName,
  disabled,
  onClose,
}: {
  walletId: string
  walletName: string
  disabled: boolean
  onClose: () => void
}) {
  const [mode, setMode] = useState<ReceiveMode>('idle')
  const [amount, setAmount] = useState('')
  const [minting, setMinting] = useState(false)
  const [invoice, setInvoice] = useState<MakeInvoiceResult | null>(null)
  const [hasWebLn, setHasWebLn] = useState(false)
  const [paying, setPaying] = useState(false)

  // Only fetch the NWC URI once the user enters the receive flow.
  // `useApi(null)` is a no-op so this stays cheap while idle.
  const connection = useRemoteWalletConnectionString(
    mode === 'idle' ? null : walletId,
  )

  // Detect WebLN whenever the invoice appears — covers the case where
  // the extension was injected after the dialog mounted.
  useEffect(() => {
    if (typeof window === 'undefined') return
    setHasWebLn(!!(window as WebLnWindow).webln)
  }, [mode])

  const resetReceive = useCallback(() => {
    setMode('idle')
    setAmount('')
    setInvoice(null)
    setPaying(false)
  }, [])

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      const sats = Number(amount)
      if (!Number.isFinite(sats) || sats <= 0) {
        toast.error('Enter a positive amount')
        return
      }
      const nwc = connection.data?.connectionString
      if (!nwc) {
        toast.error('Wallet connection unavailable')
        return
      }
      setMinting(true)
      try {
        const inv = await makeInvoice(nwc, sats, `Receive to ${walletName}`)
        setInvoice(inv)
        setMode('invoice')
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Could not mint invoice'
        toast.error(msg)
      } finally {
        setMinting(false)
      }
    },
    [amount, connection.data, walletName],
  )

  const handleCopy = useCallback(async () => {
    if (!invoice) return
    try {
      await navigator.clipboard.writeText(invoice.bolt11)
      toast.success('Invoice copied')
    } catch {
      toast.error('Copy failed')
    }
  }, [invoice])

  const handleWebLnPay = useCallback(async () => {
    if (!invoice) return
    const w = window as WebLnWindow
    if (!w.webln) return
    setPaying(true)
    try {
      await w.webln.enable()
      await w.webln.sendPayment(invoice.bolt11)
      toast.success('Payment sent')
      resetReceive()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'WebLN payment failed'
      toast.error(msg)
    } finally {
      setPaying(false)
    }
  }, [invoice, resetReceive])

  // ── Render: invoice state takes over the whole action area ────────
  if (mode === 'invoice' && invoice) {
    const preview =
      invoice.bolt11.length > 22
        ? `${invoice.bolt11.slice(0, 12)}…${invoice.bolt11.slice(-8)}`
        : invoice.bolt11
    return (
      <div
        className="flex flex-col gap-3 rounded-md border border-border bg-muted/40 p-3 animate-in fade-in-0 slide-in-from-bottom-1 duration-200"
      >
        <div className="flex items-center justify-between gap-2 text-xs">
          <span className="text-muted-foreground">Invoice</span>
          <span className="tabular-nums font-medium">
            {invoice.amountSats.toLocaleString()} sats
          </span>
        </div>
        <div className="flex items-center gap-2">
          <code className="flex-1 truncate rounded bg-background px-2 py-1.5 font-mono text-xs">
            {preview}
          </code>
          <Button
            type="button"
            variant="secondary"
            size="icon"
            className="size-9 shrink-0"
            onClick={handleCopy}
            aria-label="Copy invoice"
          >
            <Copy className="size-4" />
          </Button>
        </div>
        <div className="flex gap-2">
          {hasWebLn && (
            <Button
              type="button"
              variant="theme"
              className="h-10 flex-1"
              onClick={handleWebLnPay}
              disabled={paying}
            >
              {paying ? (
                <Spinner size={16} />
              ) : (
                <>
                  <Zap className="size-4" />
                  Pay with WebLN
                </>
              )}
            </Button>
          )}
          <Button
            type="button"
            variant="secondary"
            className={cn('h-10', hasWebLn ? '' : 'flex-1')}
            onClick={resetReceive}
          >
            Done
          </Button>
        </div>
      </div>
    )
  }

  // ── Render: amount state inline, replacing only the Receive button.
  if (mode === 'amount') {
    return (
      <form
        onSubmit={handleSubmit}
        className="flex gap-2 animate-in fade-in-0 slide-in-from-left-1 duration-200"
      >
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-11 shrink-0"
          onClick={resetReceive}
          aria-label="Cancel"
        >
          <X className="size-4" />
        </Button>
        <Input
          type="number"
          inputMode="numeric"
          min={1}
          step={1}
          autoFocus
          placeholder="sats"
          value={amount}
          onChange={e => setAmount(e.target.value)}
          className="h-11 flex-1 tabular-nums"
        />
        <Button
          type="submit"
          variant="theme"
          size="icon"
          className="h-11 shrink-0"
          disabled={minting || !amount || connection.loading}
          aria-label="Generate invoice"
        >
          {minting || connection.loading ? (
            <Spinner size={16} />
          ) : (
            <ArrowRight className="size-4" />
          )}
        </Button>
      </form>
    )
  }

  // ── Render: idle state (default) — Receive + Send side by side.
  return (
    <div className="flex gap-2">
      <Button
        type="button"
        variant="secondary"
        className="h-11 flex-1"
        disabled={disabled}
        onClick={() => setMode('amount')}
      >
        <ArrowDownLeft className="size-4" />
        Receive
      </Button>
      <Button
        variant="theme"
        className="h-11 flex-1"
        disabled={disabled}
        asChild={!disabled}
        onClick={onClose}
      >
        {disabled ? (
          <span>
            <ArrowUpRight className="size-4" />
            Send
          </span>
        ) : (
          <Link href="/wallet/send">
            <ArrowUpRight className="size-4" />
            Send
          </Link>
        )}
      </Button>
    </div>
  )
}
