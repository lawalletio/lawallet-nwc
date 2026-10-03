'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowDownToLine, Wallet } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { ClaimCelebration } from '@/components/wallet/withdraw/claim-celebration'
import { useWalletNwcOptional } from '@/components/wallet/nwc-provider'
import { unlockClaimSound } from '@/lib/client/claim-sound'
import {
  AmountKeypad,
  parseKeypadValue
} from '@/components/wallet/shared/amount-keypad'
import { AmountDisplay } from '@/components/wallet/shared/amount-display'
import { invalidateApiPath, useApi } from '@/lib/client/hooks/use-api'
import { resolveFreshUserNwc, resolveUserNwc } from '@/lib/client/wallet-nwc'
import { useAuth } from '@/components/admin/auth-context'
import { makeInvoice, lookupInvoice, describeNwcError } from '@/lib/client/nwc'
import { submitLnurlWithdraw, LnurlError } from '@/lib/client/lnurl-scan'
import {
  useWithdrawFlow,
  withdrawActions
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

// Deferred so React Strict Mode's sync unmount/remount in development does
// not wipe a freshly scanned voucher before the confirm screen can read it.
let pendingWithdrawReset: ReturnType<typeof setTimeout> | null = null

export function WithdrawScreen() {
  const router = useRouter()
  const flow = useWithdrawFlow()
  const { apiClient } = useAuth()
  const { data: me } = useApi<UserMeResponse>('/api/users/me')
  const wallet = useWalletNwcOptional()
  const nwc = resolveUserNwc(me)

  const params = flow.params
  const fixed =
    !!params && params.minWithdrawableSats === params.maxWithdrawableSats

  const [phase, setPhase] = useState<Phase>(() =>
    flow.result ? 'success' : 'confirm'
  )
  const [value, setValue] = useState<string>(() =>
    params ? String(params.maxWithdrawableSats) : '0'
  )
  const [error, setError] = useState<string | null>(null)
  const [balanceSnapshot, setBalanceSnapshot] = useState<number | null>(null)
  const [balanceCaptured, setBalanceCaptured] = useState(false)
  const cancelledRef = useRef(false)
  const claimingRef = useRef(false)

  useEffect(() => {
    cancelledRef.current = false
    if (pendingWithdrawReset) {
      clearTimeout(pendingWithdrawReset)
      pendingWithdrawReset = null
    }
    return () => {
      cancelledRef.current = true
      pendingWithdrawReset = setTimeout(() => {
        withdrawActions.reset()
        pendingWithdrawReset = null
      }, 0)
    }
  }, [])

  // No voucher in the store (deep link / refresh) — nothing to claim.
  // `?previewClaim=<sats>` is a development-only way to watch the strike.
  useEffect(() => {
    if (params) return
    const preview = readPreviewClaim()
    if (preview == null) {
      router.replace('/wallet')
      return
    }
    setBalanceSnapshot(wallet?.sats ?? preview * 4)
    setBalanceCaptured(true)
    withdrawActions.setParams({
      callback: 'https://preview.local/lnurl-withdraw',
      k1: 'preview',
      defaultDescription: 'Preview claim',
      minWithdrawableSats: preview,
      maxWithdrawableSats: preview,
      host: 'preview'
    })
    withdrawActions.setResult({ amountSats: preview, settled: true })
    setPhase('success')
  }, [params, router, wallet?.sats])

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
    if (flow.result || claimingRef.current) return

    claimingRef.current = true
    setError(null)
    setBalanceSnapshot(wallet?.sats ?? null)
    setBalanceCaptured(true)
    unlockClaimSound()
    setPhase('claiming')
    withdrawActions.setAmount(amountSats)

    try {
      const liveNwc = await resolveFreshUserNwc(
        () => apiClient.get<UserMeResponse>('/api/users/me'),
        nwc
      )
      invalidateApiPath('/api/users/me')
      if (!liveNwc) {
        throw new Error('No wallet connected')
      }
      const description = params.defaultDescription || 'LNURL withdraw'
      const invoice = await makeInvoice(liveNwc, amountSats, description)
      await submitLnurlWithdraw(params.callback, params.k1, invoice.bolt11)

      const settled = await waitForSettlement(liveNwc, invoice.paymentHash)
      if (cancelledRef.current) return

      withdrawActions.setResult({ amountSats, settled })
      setPhase('success')
      trackEvent(AnalyticsEvent.WALLET_RECEIVE_COMPLETED)
    } catch (err) {
      claimingRef.current = false
      if (cancelledRef.current) return
      const message =
        err instanceof LnurlError ? err.message : describeNwcError(err)
      setError(message)
      toast.error(message)
      setPhase('confirm')
    }
  }

  if (phase === 'claiming' || phase === 'success' || flow.result) {
    return (
      <ClaimCelebration
        phase={phase === 'claiming' && !flow.result ? 'charging' : 'celebrate'}
        amountSats={flow.result?.amountSats ?? amountSats ?? 0}
        settled={flow.result?.settled ?? false}
        snapshot={balanceSnapshot}
        captured={balanceCaptured}
        liveBalance={wallet?.sats ?? null}
        onDone={() => {
          withdrawActions.reset()
          router.replace('/wallet')
        }}
        onDismiss={() => router.back()}
      />
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 px-4 pb-6">
      <VoucherPreview
        host={params.host}
        description={params.defaultDescription}
      />

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
            />
          )}

          <div className="space-y-2 pt-1">
            {error && (
              <p className="text-center text-xs text-destructive">{error}</p>
            )}
            <Button
              type="button"
              onPointerDown={() => unlockClaimSound()}
              onClick={claim}
              disabled={!amountValid}
              className="h-12 w-full"
            >
              <ArrowDownToLine className="size-4" />
              Withdraw
              {amountSats ? ` ${amountSats.toLocaleString()} sats` : ''}
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
  paymentHash: string
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

/** Dev-only strike preview: `/wallet/withdraw?previewClaim=2100`. */
function readPreviewClaim(): number | null {
  if (process.env.NODE_ENV !== 'development') return null
  if (typeof window === 'undefined') return null
  const raw = new URLSearchParams(window.location.search).get('previewClaim')
  const amount = Number(raw)
  if (!Number.isFinite(amount) || amount <= 0) return null
  return Math.min(100_000_000, Math.floor(amount))
}

function VoucherPreview({
  host,
  description
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
