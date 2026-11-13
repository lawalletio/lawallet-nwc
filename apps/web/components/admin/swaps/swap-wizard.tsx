'use client'

import { useEffect, useRef, useState } from 'react'
import { AlertCircle, ArrowLeft, Lock, Zap } from 'lucide-react'
import { useAuth } from '@/components/admin/auth-context'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { useDebouncedValue } from '@/lib/client/hooks/use-debounced-value'
import { useSettings } from '@/lib/client/hooks/use-settings'
import { cn } from '@/lib/utils'
import { swapRecipients } from '@/lib/client/swap-recipients-store'
import {
  BankAccountCard,
  BankAvatar,
  ErrorMark,
  PROVIDER_NAMES,
  StepBar,
  StepState,
  formatArs,
  formatRate,
  formatSatRate,
  PROVIDER_ETA,
  formatSats,
  type BankAccount,
  type Swap,
  type SwapProvider,
  type SwapQuote
} from './swap-shared'
import { RecipientInput, recipientQuery } from './recipient-input'
import { INVOICE, WalletPicker, useSwapPayment } from './swap-pay'

type Step = 'account' | 'amount' | 'review' | 'processing' | 'error'
const FLOW: Step[] = ['account', 'amount', 'review']
const ROUND_AMOUNTS = [10_000, 20_000, 50_000, 100_000, 150_000, 200_000]
const DEST_RE = /^(\d{22}|[a-zA-Z0-9.-]{6,20})$/

const errMessage = (err: unknown, fallback: string) =>
  err instanceof Error && err.message ? err.message : fallback

/**
 * Lightning → ARS swap wizard, after gorilla-bank's withdraw flow:
 * account (alias lookup) → amount (live quotes) → review (order frozen,
 * wallet picked) → processing (real phases) → hands off to the tracker.
 */
export function SwapWizard({
  onDone,
  onBusyChange,
  bare
}: {
  onDone: (swapId: string) => void
  /** True while a payment is in flight — the host must not unmount it. */
  onBusyChange?: (busy: boolean) => void
  /** Drop the card chrome (border/shadow) when hosted inside a dialog. */
  bare?: boolean
}) {
  const { apiClient } = useAuth()
  const { data: settings } = useSettings()
  const aliasEnabled = settings?.integration_alias === 'true'

  const [step, setStep] = useState<Step>('account')
  useEffect(() => {
    onBusyChange?.(step === 'processing')
  }, [step, onBusyChange])
  const [direction, setDirection] = useState<'forward' | 'back'>('forward')
  const go = (next: Step, dir: 'forward' | 'back' = 'forward') => {
    setDirection(dir)
    setStep(next)
  }

  /* ------------------------------ account ------------------------------ */
  const [query, setQuery] = useState('')
  const [manualHolder, setManualHolder] = useState('')
  const dest = query.trim()
  const destValid = DEST_RE.test(dest)
  const lookupKey = useDebouncedValue(
    aliasEnabled && destValid ? dest : '',
    450
  )
  const [lookup, setLookup] = useState<{
    key: string
    account: BankAccount | null
    error?: string
  } | null>(null)
  useEffect(() => {
    if (!lookupKey) return
    let cancelled = false
    apiClient
      .get<BankAccount>(`/api/wallet/alias/${encodeURIComponent(lookupKey)}`)
      .then(account => {
        if (!cancelled) setLookup({ key: lookupKey, account })
      })
      .catch(err => {
        if (!cancelled) {
          setLookup({
            key: lookupKey,
            account: null,
            error: errMessage(err, 'Account not found')
          })
        }
      })
    return () => {
      cancelled = true
    }
  }, [apiClient, lookupKey])
  const lookupState =
    !aliasEnabled || !destValid
      ? null
      : lookup?.key !== dest
        ? 'loading'
        : lookup.account
          ? 'found'
          : 'missing'
  const account = lookupState === 'found' ? lookup!.account : null
  // A resolved account pays to its CVU (Bull Bitcoin needs 22 digits).
  const destination = account?.cvu || dest
  const holderName = account?.owners[0]?.name || manualHolder.trim()
  const accountReady = aliasEnabled
    ? Boolean(account)
    : destValid && holderName !== ''

  function continueFromAccount() {
    if (!accountReady) return
    if (account) {
      swapRecipients.remember({
        ...account,
        // A CBU lookup has no alias; keep the one the user typed.
        alias: account.alias ?? (/^\d{22}$/.test(dest) ? null : dest)
      })
    }
    go('amount')
  }

  /* ------------------------------- amount ------------------------------ */
  const [amount, setAmount] = useState('')
  const amountArs = Number(amount) || 0
  const quoteKey = useDebouncedValue(amountArs, 500)
  const [quoteResult, setQuoteResult] = useState<{
    amount: number
    quotes: SwapQuote[]
  } | null>(null)
  useEffect(() => {
    if (step !== 'amount' || quoteKey <= 0) return
    let cancelled = false
    apiClient
      .get<SwapQuote[]>(`/api/wallet/swaps/quote?amountArs=${quoteKey}`)
      .catch(() => [] as SwapQuote[])
      .then(quotes => {
        if (!cancelled) setQuoteResult({ amount: quoteKey, quotes })
      })
    return () => {
      cancelled = true
    }
  }, [apiClient, quoteKey, step])
  const quotes =
    quoteResult?.amount === amountArs && amountArs > 0
      ? quoteResult.quotes
      : null
  const [picked, setPicked] = useState<SwapProvider | null>(null)

  function blocker(q: SwapQuote): string | null {
    if (q.error || q.sats == null) return 'Unavailable right now'
    if (q.minArs && amountArs < q.minArs)
      return `Minimum ${formatArs(q.minArs)}`
    if (q.provider === 'bullbitcoin' && !/^\d{22}$/.test(destination)) {
      return 'Needs a CBU/CVU'
    }
    return null
  }
  const usable = quotes?.filter(q => !blocker(q)) ?? []
  // Default to the cheapest usable provider; keep a valid manual pick.
  const provider =
    (picked && usable.find(q => q.provider === picked)?.provider) ??
    [...usable].sort((a, b) => a.sats! - b.sats!)[0]?.provider ??
    null
  const chosenQuote = usable.find(q => q.provider === provider)

  /* ------------------------------- review ------------------------------ */
  const orderKey = `${provider}|${amountArs}|${destination}|${holderName}`
  const [order, setOrder] = useState<{
    key: string
    swap: Swap | null
    error?: string
  } | null>(null)
  const [orderAttempt, setOrderAttempt] = useState(0)
  const orderRef = useRef(order)
  useEffect(() => {
    orderRef.current = order
  })
  useEffect(() => {
    if (step !== 'review' || !provider) return
    // Back-and-forth with unchanged inputs reuses the frozen order.
    const frozen = orderRef.current
    if (frozen?.key === orderKey && frozen.swap) return
    let cancelled = false
    apiClient
      .post<Swap>('/api/wallet/swaps', {
        provider,
        amountArs,
        destination,
        holderName: holderName || undefined
      })
      .then(swap => {
        if (!cancelled) setOrder({ key: orderKey, swap })
      })
      .catch(err => {
        if (!cancelled) {
          setOrder({
            key: orderKey,
            swap: null,
            error: errMessage(err, 'Could not create the order')
          })
        }
      })
    return () => {
      cancelled = true
    }
    // The order is frozen once per (provider, amount, destination); a retry
    // bumps `orderAttempt`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, orderKey, orderAttempt])
  const currentOrder = order?.key === orderKey ? order : null
  const swap = currentOrder?.swap ?? null

  const payment = useSwapPayment(swap?.amountSats ?? null)

  /* ----------------------------- processing ---------------------------- */
  const [phase, setPhase] = useState(0)
  const [failure, setFailure] = useState<string | null>(null)
  const sending = useRef(false)
  const PHASES = [
    `Order locked with ${provider ? PROVIDER_NAMES[provider] : 'provider'}`,
    `Connecting to ${payment.payerName}`,
    swap ? `Paying ${formatSats(swap.amountSats)} over Lightning` : 'Paying',
    'Confirming the payment'
  ]

  async function send() {
    if (!swap || !payment.canPay || sending.current) return
    sending.current = true
    setFailure(null)
    go('processing')
    try {
      await payment.pay(swap, setPhase)
      setPhase(4)
      onDone(swap.id)
    } catch (err) {
      setFailure(errMessage(err, 'The payment did not go through'))
      go('error')
    } finally {
      sending.current = false
    }
  }

  /* -------------------------------- view ------------------------------- */
  const flowIndex = FLOW.indexOf(step)
  const stepAnim = cn(
    'animate-in fade-in duration-300 ease-out',
    direction === 'forward' ? 'slide-in-from-right-6' : 'slide-in-from-left-6'
  )

  return (
    <section
      className={cn(
        'flex flex-col overflow-hidden bg-card',
        !bare && 'rounded-2xl border shadow-sm'
      )}
    >
      {flowIndex >= 0 && (
        <header
          className={cn('space-y-3 border-b px-5 pb-4 pt-5', bare && 'pr-12')}
        >
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>
              Step {flowIndex + 1} of {FLOW.length}
            </span>
            <span>
              {step === 'account'
                ? 'Recipient'
                : step === 'amount'
                  ? 'Amount'
                  : 'Review & send'}
            </span>
          </div>
          <StepBar active={flowIndex} total={FLOW.length} />
        </header>
      )}

      <div className="min-h-[380px] px-5 py-6">
        {step === 'account' && (
          <div key="account" className={cn('space-y-4', stepAnim)}>
            <div>
              <h2 className="text-lg font-semibold">Who are you paying?</h2>
              <p className="text-sm text-muted-foreground">
                Enter their bank alias, CBU or CVU.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="swap-alias">Alias, CBU or CVU</Label>
              <RecipientInput
                value={query}
                onChange={setQuery}
                onPick={r => {
                  // Show the saved account at once; the debounced lookup
                  // still re-checks it against the alias API.
                  const q = recipientQuery(r)
                  setQuery(q)
                  setLookup({ key: q, account: r })
                }}
                onSubmit={continueFromAccount}
                invalid={dest !== '' && !destValid}
              />
              {dest !== '' && !destValid && (
                <p className="text-xs text-destructive">
                  A CBU/CVU has 22 digits; an alias has 6–20 letters, numbers,
                  dots or hyphens.
                </p>
              )}
            </div>

            {lookupState === 'loading' && (
              <div className="flex items-center gap-3 rounded-xl border px-4 py-3">
                <Skeleton className="size-12 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-2/3" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              </div>
            )}
            {lookupState === 'found' && account && (
              <BankAccountCard account={account} />
            )}
            {lookupState === 'missing' && (
              <p className="flex items-center gap-2 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive animate-in fade-in">
                <AlertCircle className="size-4 shrink-0" />
                {lookup?.error ?? 'Account not found'}
              </p>
            )}
            {!aliasEnabled && (
              <div className="space-y-1.5">
                <Label htmlFor="swap-holder">Account holder</Label>
                <Input
                  id="swap-holder"
                  value={manualHolder}
                  onChange={e => setManualHolder(e.target.value)}
                />
              </div>
            )}
          </div>
        )}

        {step === 'amount' && (
          <div key="amount" className={cn('space-y-5', stepAnim)}>
            {account ? (
              <BankAccountCard account={account} compact />
            ) : (
              <p className="text-sm text-muted-foreground">
                To <span className="font-medium">{holderName}</span> ·{' '}
                <span className="font-mono">{destination}</span>
              </p>
            )}
            <div>
              <h2 className="text-lg font-semibold">How many pesos?</h2>
              <p className="text-sm text-muted-foreground">
                The exact sats are locked on the next step.
              </p>
            </div>
            <div className="relative">
              <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-xl text-muted-foreground">
                $
              </span>
              <Input
                autoFocus
                inputMode="decimal"
                placeholder="0"
                aria-label="Amount in ARS"
                value={amount}
                onChange={e => setAmount(e.target.value.replace(/[^\d.]/g, ''))}
                className="h-14 pl-9 pr-16 text-center text-2xl font-semibold tabular-nums"
              />
              <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                ARS
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {ROUND_AMOUNTS.map(n => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setAmount(String(n))}
                  className={cn(
                    'rounded-lg border px-3 py-2 text-sm tabular-nums transition-colors hover:border-primary/60',
                    amountArs === n &&
                      'border-primary bg-primary/10 text-primary'
                  )}
                >
                  {n.toLocaleString('es-AR')}
                </button>
              ))}
            </div>

            {amountArs > 0 && (
              <div className="space-y-2 animate-in fade-in duration-300">
                <Label>Provider</Label>
                {!quotes &&
                  [0, 1].map(i => (
                    <Skeleton key={i} className="h-[58px] w-full rounded-xl" />
                  ))}
                {quotes?.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    No provider is available right now.
                  </p>
                )}
                {quotes?.map(q => {
                  const why = blocker(q)
                  const active = provider === q.provider
                  return (
                    <button
                      key={q.provider}
                      type="button"
                      disabled={why !== null}
                      aria-pressed={active}
                      onClick={() => setPicked(q.provider)}
                      className={cn(
                        'flex w-full items-center justify-between gap-3 rounded-xl border px-4 py-3 text-left transition-all animate-in fade-in slide-in-from-bottom-1 disabled:cursor-not-allowed disabled:opacity-50',
                        active
                          ? 'border-primary bg-primary/5 ring-1 ring-primary/40'
                          : 'hover:border-primary/50'
                      )}
                    >
                      <span>
                        <span className="block text-sm font-medium">
                          {PROVIDER_NAMES[q.provider]}
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          {why ??
                            [
                              q.arsPerBtc
                                ? formatSatRate(q.arsPerBtc / 1e8)
                                : null,
                              PROVIDER_ETA[q.provider] &&
                                `arrives in ${PROVIDER_ETA[q.provider]}`
                            ]
                              .filter(Boolean)
                              .join(' · ')}
                        </span>
                      </span>
                      {q.sats != null && !why && (
                        <span className="text-right">
                          <span className="block text-sm font-semibold tabular-nums">
                            ≈ {formatSats(q.sats)}
                          </span>
                          <span className="block text-xs text-muted-foreground">
                            you pay
                          </span>
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {step === 'review' && (
          <div key="review" className={cn('space-y-5', stepAnim)}>
            <div>
              <h2 className="text-lg font-semibold">Review & send</h2>
              <p className="text-sm text-muted-foreground">
                {provider && PROVIDER_NAMES[provider]} converts your sats and
                wires the pesos.
              </p>
            </div>

            {!currentOrder && (
              <div className="space-y-3 rounded-xl border p-4">
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Spinner size={16} /> Locking the rate with{' '}
                  {provider && PROVIDER_NAMES[provider]}…
                </p>
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-4/5" />
                <Skeleton className="h-4 w-3/5" />
              </div>
            )}

            {currentOrder?.error && (
              <div className="space-y-3 rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive animate-in fade-in">
                <p className="flex items-center gap-2">
                  <AlertCircle className="size-4 shrink-0" />
                  {currentOrder.error}
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setOrder(null)
                    setOrderAttempt(n => n + 1)
                  }}
                >
                  Try again
                </Button>
              </div>
            )}

            {swap && (
              <div className="animate-in fade-in zoom-in-95 duration-300">
                <div className="rounded-xl border bg-muted/30 p-4">
                  <div className="flex items-center gap-3">
                    {account ? (
                      <BankAvatar account={account} className="size-10" />
                    ) : null}
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">
                        {swap.holderName ?? 'Recipient'}
                      </p>
                      <p className="truncate font-mono text-xs text-muted-foreground">
                        {swap.destination}
                      </p>
                    </div>
                  </div>
                  <dl className="mt-4 space-y-2 border-t pt-3 text-sm">
                    <Row
                      label="They receive"
                      value={formatArs(swap.amountArs)}
                      strong
                    />
                    <Row
                      label="You pay"
                      value={formatSats(swap.amountSats)}
                      strong
                    />
                    <Row
                      label="Rate (sats/ARS)"
                      value={formatRate(swap.amountArs, swap.amountSats)}
                    />
                    <Row
                      label="Provider"
                      value={PROVIDER_NAMES[swap.provider]}
                    />
                    {PROVIDER_ETA[swap.provider] && (
                      <Row
                        label="Estimated arrival"
                        value={PROVIDER_ETA[swap.provider]!}
                      />
                    )}
                  </dl>
                </div>
                {swap.expiresAt && (
                  <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Lock className="size-3" /> Rate locked until{' '}
                    {new Date(swap.expiresAt).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit'
                    })}
                  </p>
                )}
              </div>
            )}

            <WalletPicker payment={payment} bolt11={swap?.bolt11} />
          </div>
        )}

        {step === 'processing' && (
          <div key="processing" className={cn('space-y-6 py-2', stepAnim)}>
            <div className="flex items-center gap-3">
              <span className="flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Zap className="size-5 animate-pulse" />
              </span>
              <div>
                <p className="font-semibold">
                  Sending with {provider && PROVIDER_NAMES[provider]}
                </p>
                <p className="text-xs text-muted-foreground">
                  Keep this page open.
                </p>
              </div>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-700 ease-out"
                style={{
                  width: `${(Math.min(phase + 1, PHASES.length) / PHASES.length) * 100}%`
                }}
              />
            </div>
            <ol className="space-y-3">
              {PHASES.map((label, i) => (
                <li
                  key={label}
                  className="flex items-center gap-3 text-sm animate-in fade-in slide-in-from-left-2"
                  style={{
                    animationDelay: `${i * 60}ms`,
                    animationFillMode: 'both'
                  }}
                >
                  <StepState
                    state={
                      i < phase ? 'done' : i === phase ? 'active' : 'pending'
                    }
                  />
                  <span
                    className={cn(
                      i === phase
                        ? 'font-medium'
                        : i < phase
                          ? 'text-muted-foreground'
                          : 'text-muted-foreground/60'
                    )}
                  >
                    {label}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        )}

        {step === 'error' && (
          <div
            key="error"
            className={cn(
              'flex flex-col items-center py-4 text-center',
              stepAnim
            )}
          >
            <ErrorMark />
            <h2 className="mt-5 text-lg font-semibold">Payment failed</h2>
            <p className="mt-2 max-w-sm text-sm text-destructive">{failure}</p>
            <p className="mt-2 max-w-sm text-xs text-muted-foreground">
              Lightning payments can&apos;t go through twice, so it&apos;s safe
              to retry. If you&apos;re unsure, check the swap status first.
            </p>
          </div>
        )}
      </div>

      {step !== 'processing' && (
        <footer className="flex gap-2 border-t px-5 py-4">
          {step === 'account' && (
            <Button
              className="h-11 flex-1"
              disabled={!accountReady}
              onClick={continueFromAccount}
            >
              Continue
            </Button>
          )}
          {step === 'amount' && (
            <>
              <BackButton onClick={() => go('account', 'back')} />
              <Button
                className="h-11 flex-1"
                disabled={!chosenQuote}
                onClick={() => go('review')}
              >
                Review
              </Button>
            </>
          )}
          {step === 'review' && (
            <>
              <BackButton onClick={() => go('amount', 'back')} />
              {payment.method === INVOICE ? (
                // Paid from elsewhere: hand off to the tracker, which keeps
                // the QR up until the provider sees the payment.
                <Button
                  className="h-11 flex-1"
                  disabled={!swap}
                  onClick={() => swap && onDone(swap.id)}
                >
                  Track order
                </Button>
              ) : (
                <Button
                  className="h-11 flex-1"
                  disabled={!swap || !payment.canPay}
                  onClick={send}
                >
                  <Zap className="size-4" />
                  {swap ? `Send ${formatSats(swap.amountSats)}` : 'Send'}
                </Button>
              )}
            </>
          )}
          {step === 'error' && (
            <>
              {swap && (
                <Button
                  variant="outline"
                  className="h-11 flex-1"
                  onClick={() => onDone(swap.id)}
                >
                  Check status
                </Button>
              )}
              <Button
                className="h-11 flex-1"
                onClick={() => go('review', 'back')}
              >
                Try again
              </Button>
            </>
          )}
        </footer>
      )}
    </section>
  )
}

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <Button variant="outline" className="h-11" onClick={onClick}>
      <ArrowLeft className="size-4" />
      Back
    </Button>
  )
}

function Row({
  label,
  value,
  strong
}: {
  label: string
  value: string
  strong?: boolean
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          'text-right tabular-nums',
          strong ? 'text-base font-semibold' : 'font-medium'
        )}
      >
        {value}
      </dd>
    </div>
  )
}
