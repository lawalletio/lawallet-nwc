'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowDownToLine, Check, Wallet } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import {
  AmountKeypad,
  parseKeypadValue,
} from '@/components/wallet/shared/amount-keypad'
import { AmountDisplay } from '@/components/wallet/shared/amount-display'
import { useApi } from '@/lib/client/hooks/use-api'
import { resolveUserNwc } from '@/lib/client/wallet-nwc'
import { makeInvoice, lookupInvoice, describeNwcError } from '@/lib/client/nwc'
import { submitLnurlWithdraw, LnurlError } from '@/lib/client/lnurl-scan'
import {
  useWithdrawFlow,
  withdrawActions,
} from '@/lib/client/wallet-flow-store'
import { trackEvent } from '@/lib/analytics/gtag'
import { AnalyticsEvent } from '@/lib/analytics/events'

interface UserMeResponse {
  effectiveNwcString: string | null
  nwcString: string
}

// How long to watch the minted invoice for the incoming withdraw before we
// stop blocking and tell the user it's on the way (LNURL-withdraw settles
// asynchronously — the service pays our invoice out-of-band).
const SETTLE_TIMEOUT_MS = 45_000
const SETTLE_POLL_MS = 3_000

type Phase = 'confirm' | 'claiming' | 'success'

export function WithdrawScreen() {
  const router = useRouter()
  const flow = useWithdrawFlow()
  const { data: me } = useApi<UserMeResponse>('/api/users/me')
  const nwc = resolveUserNwc(me)

  const params = flow.params
  const fixed =
    !!params && params.minWithdrawableSats === params.maxWithdrawableSats

  const [phase, setPhase] = useState<Phase>('confirm')
  const [value, setValue] = useState<string>(() =>
    params ? String(params.maxWithdrawableSats) : '0',
  )
  const [error, setError] = useState<string | null>(null)
  const cancelledRef = useRef(false)

  useEffect(() => {
    return () => {
      cancelledRef.current = true
    }
  }, [])

  // No voucher in the store (deep link / refresh) — nothing to claim.
  useEffect(() => {
    if (!params) router.replace('/wallet')
  }, [params, router])

  useEffect(() => {
    trackEvent(AnalyticsEvent.WALLET_RECEIVE_STARTED)
  }, [])

  const amountSats = useMemo(() => {
    if (!params) return null
    if (fixed) return params.maxWithdrawableSats
    return parseKeypadValue(value)
  }, [params, fixed, value])

  const amountValid =
    !!params &&
    amountSats !== null &&
    amountSats >= params.minWithdrawableSats &&
    amountSats <= params.maxWithdrawableSats

  if (!params) return null

  async function claim() {
    if (!params || amountSats === null || !amountValid) return
    if (!nwc) return

    setError(null)
    setPhase('claiming')
    withdrawActions.setAmount(amountSats)

    try {
      const description = params.defaultDescription || 'LNURL withdraw'
      const invoice = await makeInvoice(nwc, amountSats, description)
      await submitLnurlWithdraw(params.callback, params.k1, invoice.bolt11)

      const settled = await waitForSettlement(nwc, invoice.paymentHash)
      if (cancelledRef.current) return

      withdrawActions.setResult({ amountSats, settled })
      setPhase('success')
      trackEvent(AnalyticsEvent.WALLET_RECEIVE_COMPLETED)
    } catch (err) {
      if (cancelledRef.current) return
      const message =
        err instanceof LnurlError
          ? err.message
          : describeNwcError(err)
      setError(message)
      toast.error(message)
      setPhase('confirm')
    }
  }

  if (phase === 'success') {
    return (
      <WithdrawSuccess
        amountSats={flow.result?.amountSats ?? amountSats ?? 0}
        settled={flow.result?.settled ?? false}
        onDone={() => {
          withdrawActions.reset()
          router.replace('/wallet')
        }}
      />
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 px-4 pb-6">
      <VoucherPreview host={params.host} description={params.defaultDescription} />

      {!nwc ? (
        <NoWalletNotice />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col justify-between gap-5">
          <div className="flex flex-col items-center gap-2">
            {fixed ? (
              <AmountDisplay
                value={String(params.maxWithdrawableSats)}
                unit="sats"
                className="py-6"
                subline="Fixed voucher amount"
              />
            ) : (
              <>
                <AmountDisplay value={value} unit="sats" className="py-2" />
                <p className="text-xs text-muted-foreground">
                  {params.minWithdrawableSats.toLocaleString()}–
                  {params.maxWithdrawableSats.toLocaleString()} sats
                </p>
              </>
            )}
          </div>

          {!fixed && (
            <AmountKeypad
              value={value}
              onChange={next => {
                setValue(next)
                setError(null)
              }}
              integerOnly
              className="min-h-0 flex-1 grid-rows-4 gap-3"
              buttonClassName="h-full min-h-[58px] rounded-2xl bg-card/90 text-3xl"
              disabled={phase === 'claiming'}
            />
          )}

          <div className="space-y-2 pt-1">
            {error && (
              <p className="text-center text-xs text-destructive">{error}</p>
            )}
            <Button
              type="button"
              onClick={claim}
              disabled={!amountValid || phase === 'claiming'}
              className="h-12 w-full"
            >
              {phase === 'claiming' ? (
                <>
                  <Spinner size={16} />
                  Claiming…
                </>
              ) : (
                <>
                  <ArrowDownToLine className="size-4" />
                  Withdraw
                  {amountSats ? ` ${amountSats.toLocaleString()} sats` : ''}
                </>
              )}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Polls the minted invoice for the incoming withdraw. Resolves `true` once the
 * wallet reports it settled, or `false` after {@link SETTLE_TIMEOUT_MS} — the
 * request was accepted, the payment just hasn't landed yet.
 */
async function waitForSettlement(
  nwc: string,
  paymentHash: string,
): Promise<boolean> {
  const deadline = Date.now() + SETTLE_TIMEOUT_MS
  while (Date.now() < deadline) {
    try {
      const status = await lookupInvoice(nwc, paymentHash)
      if (status.settled) return true
    } catch {
      // Transient relay/transport error — keep polling until the deadline.
    }
    await delay(SETTLE_POLL_MS)
  }
  return false
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function VoucherPreview({
  host,
  description,
}: {
  host: string
  description: string
}) {
  return (
    <section className="rounded-3xl border border-border/70 bg-card/80 p-3 shadow-sm">
      <div className="flex items-center gap-3">
        <span className="flex size-12 items-center justify-center rounded-full border border-border/70 bg-background text-muted-foreground">
          <ArrowDownToLine className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
            Withdraw from
          </p>
          <p className="truncate text-base font-semibold text-foreground">
            {host || 'Lightning voucher'}
          </p>
          {description && (
            <p className="truncate text-xs text-muted-foreground">
              {description}
            </p>
          )}
        </div>
      </div>
    </section>
  )
}

function NoWalletNotice() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
      <span className="flex size-14 items-center justify-center rounded-full bg-card text-muted-foreground">
        <Wallet className="size-7" />
      </span>
      <h2 className="text-base font-semibold text-foreground">
        No wallet connected
      </h2>
      <p className="max-w-xs text-sm text-muted-foreground">
        Connect a wallet that can receive payments to claim this voucher.
      </p>
      <Button asChild variant="secondary" className="mt-1">
        <Link href="/wallet/settings/remote-wallets">Manage wallets</Link>
      </Button>
    </div>
  )
}

function WithdrawSuccess({
  amountSats,
  settled,
  onDone,
}: {
  amountSats: number
  settled: boolean
  onDone: () => void
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-between px-4 pb-6 pt-10 text-center">
      <div className="flex flex-col items-center gap-6">
        <div className="flex size-20 items-center justify-center rounded-full bg-green-500/10 text-green-500">
          <Check className="size-10" />
        </div>
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold text-foreground">
            {settled ? 'Funds received' : 'Withdraw requested'}
          </h1>
          <p className="text-sm text-muted-foreground">
            {settled
              ? `${amountSats.toLocaleString()} sats landed in your wallet.`
              : `${amountSats.toLocaleString()} sats are on the way — they'll appear once the sender pays.`}
          </p>
        </div>
      </div>

      <div className="flex w-full flex-col gap-2">
        <Button asChild variant="secondary" className="h-12 w-full">
          <Link href="/wallet/activity">View activity</Link>
        </Button>
        <Button onClick={onDone} className="h-12 w-full">
          Done
        </Button>
      </div>
    </div>
  )
}
