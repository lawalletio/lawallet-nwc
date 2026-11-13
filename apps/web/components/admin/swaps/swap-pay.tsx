'use client'

import { useMemo, useState, useSyncExternalStore } from 'react'
import Link from 'next/link'
import { Puzzle, QrCode, Wallet } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { useAuth } from '@/components/admin/auth-context'
import { CopyButton } from '@/components/ui/copy-button'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { invalidateApiPath } from '@/lib/client/hooks/use-api'
import {
  useRemoteWalletBalance,
  useRemoteWallets
} from '@/lib/client/hooks/use-remote-wallets'
import { payInvoice } from '@/lib/client/nwc'
import { cn } from '@/lib/utils'
import { formatSats, type Swap } from './swap-shared'

const noop = () => () => {}
/** Re-read on every render, so a late-injecting extension still shows up. */
const useHasWebLn = () =>
  useSyncExternalStore(
    noop,
    () => !!window.webln,
    () => false
  )

/** An NWC wallet id, the browser extension, or "show me the invoice". */
export const WEBLN = 'webln'
export const INVOICE = 'invoice'

/**
 * Pays a swap's invoice from one of the user's NWC wallets (primary by
 * default) or a WebLN extension, then proves it to the server with the
 * preimage. The INVOICE method pays nothing here — the user scans the QR.
 */
export function useSwapPayment(amountSats: number | null) {
  const { apiClient } = useAuth()
  const { data: wallets, loading: walletsLoading } = useRemoteWallets({
    status: 'ACTIVE'
  })
  const payable = useMemo(
    () => (wallets ?? []).filter(w => w.type === 'NWC'),
    [wallets]
  )
  const hasWebLn = useHasWebLn()
  const [choice, setMethod] = useState<string | null>(null)
  const valid = (m: string | null) =>
    m === INVOICE || (m === WEBLN && hasWebLn) || payable.some(w => w.id === m)
  const fallback =
    payable.find(w => w.isDefault)?.id ??
    payable[0]?.id ??
    (walletsLoading && !wallets ? null : hasWebLn ? WEBLN : INVOICE)
  const method = valid(choice) ? choice : fallback
  const selectedWallet = payable.find(w => w.id === method) ?? null
  const { data: balance } = useRemoteWalletBalance(selectedWallet?.id ?? null)
  const insufficient =
    !!selectedWallet &&
    amountSats != null &&
    balance?.reachable !== false &&
    balance?.balanceSats != null &&
    balance.balanceSats < amountSats

  /** `onStep`: 1 connecting, 2 paying, 3 confirming. */
  async function pay(
    swap: Pick<Swap, 'id' | 'bolt11'>,
    onStep?: (step: number) => void
  ) {
    let preimage: string
    onStep?.(1)
    if (method === WEBLN) {
      const webln = window.webln
      if (!webln) throw new Error('No browser extension found')
      await webln.enable()
      onStep?.(2)
      ;({ preimage } = await webln.sendPayment(swap.bolt11))
    } else if (selectedWallet) {
      const { connectionString } = await apiClient.get<{
        connectionString: string
      }>(`/api/remote-wallets/${selectedWallet.id}/connection-string`)
      onStep?.(2)
      ;({ preimage } = await payInvoice(connectionString, swap.bolt11))
    } else {
      throw new Error('Choose a wallet first')
    }
    onStep?.(3)
    // Paid either way; the provider check catches up if this proof fails.
    await apiClient
      .post(`/api/wallet/swaps/${swap.id}/paid`, { preimage })
      .catch(() => {})
    invalidateApiPath('/api/wallet/swaps')
  }

  return {
    wallets,
    walletsLoading,
    payable,
    hasWebLn,
    method,
    setMethod,
    selectedWallet,
    /** Human name of what pays, for progress copy. */
    payerName:
      method === WEBLN ? 'your extension' : (selectedWallet?.name ?? 'wallet'),
    balance,
    insufficient,
    /** A pay button can fire (INVOICE never does — the user scans). */
    canPay: method === WEBLN || (!!selectedWallet && !insufficient),
    pay
  }
}

export type SwapPayment = ReturnType<typeof useSwapPayment>

/**
 * "Pay from" dropdown: NWC wallets, the browser extension when one is
 * present, or the raw invoice as a QR for any other wallet.
 */
export function WalletPicker({
  payment,
  bolt11
}: {
  payment: SwapPayment
  /** Shown as a QR when the user picks "Show invoice". */
  bolt11?: string | null
}) {
  const {
    wallets,
    walletsLoading,
    payable,
    hasWebLn,
    method,
    setMethod,
    selectedWallet,
    balance,
    insufficient
  } = payment
  return (
    <div className="space-y-1.5">
      <Label>Pay from</Label>
      {walletsLoading && !wallets ? (
        <Skeleton className="h-11 w-full" />
      ) : (
        <Select value={method ?? undefined} onValueChange={setMethod}>
          <SelectTrigger className="h-11">
            <SelectValue placeholder="Choose how to pay" />
          </SelectTrigger>
          <SelectContent>
            {payable.length > 0 && (
              <>
                <SelectGroup>
                  <SelectLabel className="text-xs font-medium text-muted-foreground">
                    Remote wallets
                  </SelectLabel>
                  {payable.map(w => (
                    <SelectItem key={w.id} value={w.id}>
                      <span className="flex items-center gap-2">
                        <Wallet className="size-4 text-muted-foreground" />
                        {w.name}
                        {w.isDefault && (
                          <span className="rounded bg-primary/10 px-1.5 text-[10px] font-medium uppercase text-primary">
                            Primary
                          </span>
                        )}
                      </span>
                    </SelectItem>
                  ))}
                </SelectGroup>
                <SelectSeparator />
              </>
            )}
            <SelectGroup>
              <SelectLabel className="text-xs font-medium text-muted-foreground">
                Pay from this device
              </SelectLabel>
              {hasWebLn && (
                <SelectItem value={WEBLN}>
                  <span className="flex items-center gap-2">
                    <Puzzle className="size-4 text-muted-foreground" />
                    Browser extension
                  </span>
                </SelectItem>
              )}
              <SelectItem value={INVOICE}>
                <span className="flex items-center gap-2">
                  <QrCode className="size-4 text-muted-foreground" />
                  Show invoice
                </span>
              </SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
      )}
      {selectedWallet && (
        <p
          className={cn(
            'text-xs',
            insufficient ? 'text-destructive' : 'text-muted-foreground'
          )}
        >
          {balance?.balanceSats != null && balance.reachable !== false
            ? `Balance: ${formatSats(balance.balanceSats)}${insufficient ? ' — not enough for this swap' : ''}`
            : 'Checking balance…'}
        </p>
      )}
      {!walletsLoading && payable.length === 0 && method !== INVOICE && (
        <p className="text-xs text-muted-foreground">
          No NWC wallet connected.{' '}
          <Link
            href="/admin/remote-wallets"
            className="text-primary underline underline-offset-2"
          >
            Connect one
          </Link>
        </p>
      )}
      {method === INVOICE && bolt11 && <InvoiceQr bolt11={bolt11} />}
    </div>
  )
}

/** The order invoice as a QR, for paying from any Lightning wallet. */
function InvoiceQr({ bolt11 }: { bolt11: string }) {
  return (
    <div className="space-y-3 pt-2 animate-in fade-in zoom-in-95 duration-300">
      {/* White tile keeps it scannable on the dark theme; uppercase packs
          bolt11 into denser modules. */}
      <a
        href={`lightning:${bolt11}`}
        className="mx-auto block w-fit rounded-xl bg-white p-3"
        aria-label="Open invoice in a Lightning wallet"
      >
        <QRCodeSVG value={bolt11.toUpperCase()} size={208} level="M" />
      </a>
      <div className="flex items-center gap-2">
        <code className="flex-1 truncate rounded-md bg-background px-2 py-1.5 font-mono text-xs">
          {bolt11}
        </code>
        <CopyButton value={bolt11} label="Invoice" variant="secondary" />
      </div>
      <p className="text-center text-xs text-muted-foreground">
        Scan with any Lightning wallet. This page updates once the provider sees
        the payment.
      </p>
    </div>
  )
}
