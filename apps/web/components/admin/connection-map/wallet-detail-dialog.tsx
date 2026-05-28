'use client'

import React, { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import {
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
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
import {
  makeInvoice,
  parseDestination,
  payInvoice,
  payLnurl,
  type MakeInvoiceResult,
  type ParsedDestination,
} from '@/lib/client/nwc'
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

// WebLN provider shape. Lightweight — only the methods we actually call.
// `makeInvoice` is broader in the official spec but we only need the
// `paymentRequest` field back, so we type it tightly.
interface WebLnProvider {
  enable(): Promise<void>
  sendPayment(bolt11: string): Promise<{ preimage: string }>
  makeInvoice?(args: {
    amount: number
    defaultMemo?: string
  }): Promise<{ paymentRequest: string }>
}
type WebLnWindow = Window & { webln?: WebLnProvider }

/**
 * Remote Wallet detail dialog. Balance is the dominant element with
 * inline Receive + Send sub-flows, wallet-style.
 *
 * Receive flow: enter amount → mint invoice via NWC → show + WebLN pay.
 * Send    flow: paste destination → optional amount step → pay via NWC.
 *
 * Both flows are scoped to THIS wallet (not the user's default) — the
 * NWC URI is fetched on demand from `/api/remote-wallets/[id]/connection-string`.
 */
export function WalletDetailDialog({ wallet, addresses, cards, onClose }: Props) {
  const isLive = wallet.status !== 'REVOKED'
  const balance = useLiveRemoteWalletBalance(isLive ? wallet.id : null)
  const animatedSats = useAnimatedNumber(balance.data?.balanceSats ?? null)

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
          {/* HERO — balance card. */}
          <div className="relative overflow-hidden rounded-lg border border-border bg-gradient-to-br from-card to-card/40 p-5">
            <div className="pointer-events-none absolute -right-16 -top-16 size-56 rounded-full bg-amber-400/10 blur-3xl" />

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

            <div className="relative mt-4">
              <WalletActions
                walletId={wallet.id}
                walletName={wallet.name}
                disabled={!isLive}
              />
            </div>
          </div>

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

// ── Receive + Send inline actions ────────────────────────────────────────

type ReceiveStep = 'idle' | 'amount' | 'invoice'
type SendStep =
  | 'idle'
  // destination paste / type. WebLN shortcut also surfaces here.
  | 'destination'
  // amount input — used both for a regular LA destination AND for the
  // "Send to Alby" WebLN shortcut (the user enters how many sats to
  // send into their Alby wallet).
  | 'amount'
  | 'amount-alby'

/**
 * Receive + Send action row with inline sub-flows that morph in place
 * over the action buttons. Receive and Send are mutually exclusive —
 * starting one cancels the other.
 *
 * Receive:
 *   idle → amount input → mint via NWC → invoice card (copy + WebLN pay).
 *
 * Send:
 *   idle → destination paste box → (if LA / amount-less invoice) amount
 *   input → pay via NWC.
 *
 * Send to Alby (only when window.webln is present):
 *   idle → destination paste box (with "Send to Alby" pill) → amount
 *   input → webln.makeInvoice → pay the returned bolt11 via NWC. The
 *   amount step is identical to the LA path, just with a different
 *   submit handler.
 */
function WalletActions({
  walletId,
  walletName,
  disabled,
}: {
  walletId: string
  walletName: string
  disabled: boolean
}) {
  // Receive state
  const [receiveStep, setReceiveStep] = useState<ReceiveStep>('idle')
  const [receiveAmount, setReceiveAmount] = useState('')
  const [minting, setMinting] = useState(false)
  const [invoice, setInvoice] = useState<MakeInvoiceResult | null>(null)

  // Send state
  const [sendStep, setSendStep] = useState<SendStep>('idle')
  const [destinationInput, setDestinationInput] = useState('')
  const [destination, setDestination] = useState<ParsedDestination | null>(null)
  const [sendAmount, setSendAmount] = useState('')
  const [paying, setPaying] = useState(false)

  // Shared
  const [hasWebLn, setHasWebLn] = useState(false)
  const [payingWebLn, setPayingWebLn] = useState(false)

  const needsNwc = receiveStep !== 'idle' || sendStep !== 'idle'
  const connection = useRemoteWalletConnectionString(needsNwc ? walletId : null)

  // WebLN feature-detect on any mode change.
  useEffect(() => {
    if (typeof window === 'undefined') return
    setHasWebLn(!!(window as WebLnWindow).webln)
  }, [receiveStep, sendStep])

  // ── Resets ─────────────────────────────────────────────────────────
  const resetReceive = useCallback(() => {
    setReceiveStep('idle')
    setReceiveAmount('')
    setInvoice(null)
    setPayingWebLn(false)
  }, [])

  const resetSend = useCallback(() => {
    setSendStep('idle')
    setDestinationInput('')
    setDestination(null)
    setSendAmount('')
    setPaying(false)
  }, [])

  // Mutual exclusion: when opening one flow, ensure the other is idle.
  const openReceive = useCallback(() => {
    resetSend()
    setReceiveStep('amount')
  }, [resetSend])

  const openSend = useCallback(() => {
    resetReceive()
    setSendStep('destination')
  }, [resetReceive])

  // ── Receive: mint invoice via NWC ──────────────────────────────────
  const handleReceiveSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      const sats = Number(receiveAmount)
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
        setReceiveStep('invoice')
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Could not mint invoice')
      } finally {
        setMinting(false)
      }
    },
    [receiveAmount, connection.data, walletName],
  )

  const handleCopyInvoice = useCallback(async () => {
    if (!invoice) return
    try {
      await navigator.clipboard.writeText(invoice.bolt11)
      toast.success('Invoice copied')
    } catch {
      toast.error('Copy failed')
    }
  }, [invoice])

  const handleWebLnPayInvoice = useCallback(async () => {
    if (!invoice) return
    const w = window as WebLnWindow
    if (!w.webln) return
    setPayingWebLn(true)
    try {
      await w.webln.enable()
      await w.webln.sendPayment(invoice.bolt11)
      toast.success('Payment sent')
      resetReceive()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'WebLN payment failed')
    } finally {
      setPayingWebLn(false)
    }
  }, [invoice, resetReceive])

  // ── Send: pay a parsed destination ─────────────────────────────────
  // Declared first so `handleDestinationSubmit` can capture it cleanly
  // through its `useCallback` deps array (the rendered button always
  // sees the latest closure either way, but the deps are honest).
  const payDestination = useCallback(
    async (dest: ParsedDestination, amountSats: number) => {
      const nwc = connection.data?.connectionString
      if (!nwc) {
        toast.error('Wallet connection unavailable')
        return
      }
      setPaying(true)
      try {
        if (dest.kind === 'invoice') {
          await payInvoice(nwc, dest.bolt11, dest.amountSats ? undefined : amountSats)
        } else if (dest.kind === 'lnurl-pay') {
          await payLnurl(nwc, dest, amountSats)
        } else {
          throw new Error('Unsupported destination')
        }
        toast.success('Payment sent')
        resetSend()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Payment failed')
      } finally {
        setPaying(false)
      }
    },
    [connection.data, resetSend],
  )

  // ── Send: parse destination + dispatch to next step ────────────────
  const handleDestinationSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      const raw = destinationInput.trim()
      if (!raw) return
      let parsed: ParsedDestination
      try {
        parsed = parseDestination(raw)
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Invalid destination')
        return
      }
      setDestination(parsed)

      if (parsed.kind === 'npub') {
        toast.error('Sending to npub is not supported yet')
        return
      }
      if (parsed.kind === 'invoice' && parsed.amountSats) {
        // Invoice carries its own amount — pay immediately.
        await payDestination(parsed, parsed.amountSats)
        return
      }
      // Either an amount-less invoice (unusual) or an LNURL/LA — need
      // an amount from the user.
      setSendStep('amount')
    },
    [destinationInput, payDestination],
  )

  const handleSendAmountSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      const sats = Number(sendAmount)
      if (!Number.isFinite(sats) || sats <= 0) {
        toast.error('Enter a positive amount')
        return
      }

      // "Send to Alby" branch — no destination parsed; we ask WebLN to
      // mint an invoice FOR the user's Alby wallet, then pay it via
      // our NWC connection.
      if (sendStep === 'amount-alby') {
        const w = window as WebLnWindow
        if (!w.webln?.makeInvoice) {
          toast.error('WebLN unavailable')
          return
        }
        const nwc = connection.data?.connectionString
        if (!nwc) {
          toast.error('Wallet connection unavailable')
          return
        }
        setPaying(true)
        try {
          await w.webln.enable()
          const { paymentRequest } = await w.webln.makeInvoice({
            amount: sats,
            defaultMemo: `From ${walletName}`,
          })
          await payInvoice(nwc, paymentRequest)
          toast.success(`Sent ${sats.toLocaleString()} sats to Alby`)
          resetSend()
        } catch (err) {
          toast.error(err instanceof Error ? err.message : 'Send failed')
        } finally {
          setPaying(false)
        }
        return
      }

      // Standard branch — pay against the parsed destination.
      if (!destination) {
        toast.error('No destination')
        return
      }
      await payDestination(destination, sats)
    },
    [sendAmount, sendStep, destination, connection.data, walletName, payDestination, resetSend],
  )

  // ── Render: Receive INVOICE state (takes over the action area) ─────
  if (receiveStep === 'invoice' && invoice) {
    const preview =
      invoice.bolt11.length > 22
        ? `${invoice.bolt11.slice(0, 12)}…${invoice.bolt11.slice(-8)}`
        : invoice.bolt11
    return (
      <div className="flex flex-col gap-3 rounded-md border border-border bg-muted/40 p-3 animate-in fade-in-0 slide-in-from-bottom-1 duration-200">
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
            onClick={handleCopyInvoice}
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
              onClick={handleWebLnPayInvoice}
              disabled={payingWebLn}
            >
              {payingWebLn ? (
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

  // ── Render: Receive AMOUNT state (in place of the Receive button) ──
  if (receiveStep === 'amount') {
    // Lock the form while we're talking to the relay so the user
    // can't double-submit, edit the amount mid-mint, or cancel into a
    // weird state (cancel still resets the UI but blocks accidental
    // taps while the spinner is up).
    const busy = minting || connection.loading
    return (
      <form
        onSubmit={handleReceiveSubmit}
        className="flex flex-col gap-2 animate-in fade-in-0 slide-in-from-left-1 duration-200"
      >
        {/* Header — mirrors the "To <target>" line on the send amount
            step so the two flows read symmetrically: arrow + verb,
            small muted text. */}
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <ArrowDownLeft className="size-3.5" />
          <span>Deposit</span>
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-11 shrink-0"
            onClick={resetReceive}
            disabled={busy}
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
            value={receiveAmount}
            onChange={e => setReceiveAmount(e.target.value)}
            disabled={busy}
            className="h-11 flex-1 tabular-nums"
          />
          <Button
            type="submit"
            variant="theme"
            size="icon"
            className="h-11 shrink-0"
            disabled={busy || !receiveAmount}
            aria-label="Generate invoice"
          >
            {busy ? <Spinner size={16} /> : <ArrowRight className="size-4" />}
          </Button>
        </div>
      </form>
    )
  }

  // ── Render: Send AMOUNT state (LA destination, or amount-less invoice). ──
  // Also covers the "Send to Alby" shortcut (`amount-alby`).
  if (sendStep === 'amount' || sendStep === 'amount-alby') {
    const target =
      sendStep === 'amount-alby'
        ? 'Alby'
        : destination?.kind === 'lnurl-pay'
          ? destination.address ?? destination.host ?? 'recipient'
          : destination?.kind === 'invoice'
            ? 'invoice'
            : 'recipient'
    // Lock everything (input, cancel, submit) while a payment is in
    // flight. Without this the user could double-tap the arrow and
    // pay twice, or change the amount mid-NWC-call into a stale
    // toast.
    const busy = paying || connection.loading
    return (
      <form
        onSubmit={handleSendAmountSubmit}
        className="flex flex-col gap-2 animate-in fade-in-0 slide-in-from-bottom-1 duration-200"
      >
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <ArrowUpRight className="size-3.5" />
          <span>
            To <span className="text-foreground truncate">{target}</span>
          </span>
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-11 shrink-0"
            onClick={resetSend}
            disabled={busy}
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
            value={sendAmount}
            onChange={e => setSendAmount(e.target.value)}
            disabled={busy}
            className="h-11 flex-1 tabular-nums"
          />
          <Button
            type="submit"
            variant="theme"
            size="icon"
            className="h-11 shrink-0"
            disabled={busy || !sendAmount}
            aria-label="Send"
          >
            {busy ? <Spinner size={16} /> : <ArrowUpRight className="size-4" />}
          </Button>
        </div>
      </form>
    )
  }

  // ── Render: Send DESTINATION state (paste invoice / LA) ────────────
  if (sendStep === 'destination') {
    // Becomes busy when a bolt11 with embedded amount triggers
    // payment immediately on submit (no amount step to render).
    const busy = paying || connection.loading
    return (
      <div className="flex flex-col gap-2 animate-in fade-in-0 slide-in-from-bottom-1 duration-200">
        <form onSubmit={handleDestinationSubmit} className="flex gap-2">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-11 shrink-0"
            onClick={resetSend}
            disabled={busy}
            aria-label="Cancel"
          >
            <X className="size-4" />
          </Button>
          <Input
            type="text"
            autoFocus
            spellCheck={false}
            autoComplete="off"
            placeholder="Lightning address or invoice"
            value={destinationInput}
            onChange={e => setDestinationInput(e.target.value)}
            disabled={busy}
            className="h-11 flex-1 font-mono text-xs"
          />
          <Button
            type="submit"
            variant="theme"
            size="icon"
            className="h-11 shrink-0"
            disabled={busy || !destinationInput.trim()}
            aria-label="Continue"
          >
            {busy ? <Spinner size={16} /> : <ArrowRight className="size-4" />}
          </Button>
        </form>
        {hasWebLn && (
          // Shortcut: skip the destination input and use WebLN to mint
          // an invoice the user's Alby wallet receives. The amount step
          // is the same as the regular LA path.
          <Button
            type="button"
            variant="secondary"
            className="h-10 w-full justify-start gap-2 animate-in fade-in-0 duration-200"
            onClick={() => setSendStep('amount-alby')}
            disabled={busy}
          >
            <Image
              src="/logos/alby.png"
              alt=""
              width={16}
              height={16}
              className="size-4"
              aria-hidden
            />
            Send to Alby
          </Button>
        )}
      </div>
    )
  }

  // ── Render: idle (default) — Receive + Send side by side. ──────────
  return (
    <div className="flex gap-2">
      <Button
        type="button"
        variant="secondary"
        className="h-11 flex-1"
        disabled={disabled}
        onClick={openReceive}
      >
        <ArrowDownLeft className="size-4" />
        Receive
      </Button>
      <Button
        type="button"
        variant="theme"
        className="h-11 flex-1"
        disabled={disabled}
        onClick={openSend}
      >
        <ArrowUpRight className="size-4" />
        Send
      </Button>
    </div>
  )
}
