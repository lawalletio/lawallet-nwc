'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2, Clock, ExternalLink, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '@/components/admin/auth-context'
import { ScreenHeader } from '@/components/wallet/shared/screen-header'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import { invalidateApiPath, useApi } from '@/lib/client/hooks/use-api'
import { useSettings } from '@/lib/client/hooks/use-settings'
import { payInvoice } from '@/lib/client/nwc'
import { resolveFreshUserNwc, resolveUserNwc } from '@/lib/client/wallet-nwc'
import { useT } from '@/lib/client/i18n'
import { errorText, nwcErrorText } from '@/lib/client/i18n/errors'
import { cn } from '@/lib/utils'

type Provider = 'bullbitcoin' | 'wapu'

interface Quote {
  provider: Provider
  sats: number | null
  arsPerBtc: number | null
  minArs: number | null
  error?: string
}

interface AliasLookup {
  cvu: string
  alias: string | null
  bank: string
  owners: { name: string }[]
}

interface Swap {
  id: string
  provider: Provider
  destination: string
  holderName: string | null
  amountArs: number
  amountSats: number
  bolt11: string
  status: 'PENDING' | 'COMPLETED' | 'FAILED' | 'EXPIRED' | 'CANCELED'
  receiptUrl: string | null
}

interface UserMeResponse {
  effectiveNwcString: string | null
  nwcString: string
}

const PROVIDER_NAMES: Record<Provider, string> = {
  bullbitcoin: 'Bull Bitcoin',
  wapu: 'Wapu'
}
const DEST_RE = /^(\d{22}|[a-zA-Z0-9.-]{6,20})$/
const CBU_RE = /^\d{22}$/
const POLL_MS = 5_000

/** Debounced copy of `value`. */
function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms)
    return () => clearTimeout(id)
  }, [value, ms])
  return v
}

export function CashOutHeader() {
  const t = useT()
  return <ScreenHeader title={t.cashOut.title} closeStyle />
}

export function CashOutScreen() {
  const t = useT()
  const router = useRouter()
  const { apiClient } = useAuth()
  const { data: settings } = useSettings()
  const { data: me } = useApi<UserMeResponse>('/api/users/me')
  const aliasEnabled = settings?.integration_alias === 'true'

  const [amount, setAmount] = useState('')
  const [destination, setDestination] = useState('')
  const [holderName, setHolderName] = useState('')
  const [provider, setProvider] = useState<Provider | null>(null)
  const [swap, setSwap] = useState<Swap | null>(null)
  const [step, setStep] = useState<'form' | 'confirm' | 'status'>('form')
  const [busy, setBusy] = useState(false)

  const amountArs = Number(amount)
  const dest = destination.trim()
  const destValid = DEST_RE.test(dest)
  const debouncedAmount = useDebounced(
    Number.isFinite(amountArs) && amountArs > 0 ? amountArs : 0,
    600
  )
  const debouncedDest = useDebounced(destValid ? dest : '', 500)

  // Quotes per provider for the typed amount. Results are keyed by the
  // amount they answer, so a stale answer reads as "still loading".
  const [quoteResult, setQuoteResult] = useState<{
    amount: number
    quotes: Quote[]
  } | null>(null)
  useEffect(() => {
    if (!debouncedAmount) return
    let cancelled = false
    apiClient
      .get<Quote[]>(`/api/wallet/swaps/quote?amountArs=${debouncedAmount}`)
      .catch(() => [] as Quote[])
      .then(q => {
        if (!cancelled) setQuoteResult({ amount: debouncedAmount, quotes: q })
      })
    return () => {
      cancelled = true
    }
  }, [apiClient, debouncedAmount])
  const quotes =
    quoteResult?.amount === debouncedAmount ? quoteResult.quotes : null

  // Owner + bank preview through the alias integration, keyed the same way.
  const lookupKey = aliasEnabled ? debouncedDest : ''
  const [lookupResult, setLookupResult] = useState<{
    key: string
    data: AliasLookup | null
  } | null>(null)
  useEffect(() => {
    if (!lookupKey) return
    let cancelled = false
    apiClient
      .get<AliasLookup>(`/api/wallet/alias/${encodeURIComponent(lookupKey)}`)
      .catch(() => null)
      .then(data => {
        if (cancelled) return
        setLookupResult({ key: lookupKey, data })
        const owner = data?.owners[0]?.name
        if (owner) setHolderName(owner)
      })
    return () => {
      cancelled = true
    }
  }, [apiClient, lookupKey])
  const lookup:
    | { status: 'idle' | 'loading' | 'missing' }
    | { status: 'found'; data: AliasLookup } = !lookupKey
    ? { status: 'idle' }
    : lookupResult?.key !== lookupKey
      ? { status: 'loading' }
      : lookupResult.data
        ? { status: 'found', data: lookupResult.data }
        : { status: 'missing' }

  // Poll the transfer until the provider settles it.
  useEffect(() => {
    if (step !== 'status' || !swap || swap.status !== 'PENDING') return
    const id = setInterval(() => {
      apiClient
        .get<Swap>(`/api/wallet/swaps/${swap.id}`)
        .then(setSwap)
        .catch(() => {})
    }, POLL_MS)
    return () => clearInterval(id)
  }, [apiClient, step, swap])

  function providerBlocker(q: Quote): string | null {
    if (q.error || q.sats == null) return t.cashOut.unavailable
    if (q.minArs && amountArs < q.minArs) {
      return t.cashOut.minimum(q.minArs.toLocaleString())
    }
    // Bull Bitcoin pays to CBU/CVU only; an alias works once resolved.
    if (
      q.provider === 'bullbitcoin' &&
      destValid &&
      !CBU_RE.test(dest) &&
      !(lookup.status === 'found' && lookup.data.cvu)
    ) {
      return t.cashOut.needsCbu
    }
    return null
  }

  const selected = quotes?.find(q => q.provider === provider)
  const canContinue =
    destValid &&
    amountArs > 0 &&
    holderName.trim() !== '' &&
    !!selected &&
    providerBlocker(selected) === null

  async function createOrder() {
    if (!canContinue || !provider) return
    setBusy(true)
    try {
      const created = await apiClient.post<Swap>('/api/wallet/swaps', {
        provider,
        amountArs,
        destination: dest,
        holderName: holderName.trim()
      })
      setSwap(created)
      setStep('confirm')
    } catch (err) {
      toast.error(errorText(t, err, t.cashOut.createFailed))
    } finally {
      setBusy(false)
    }
  }

  async function pay() {
    if (!swap || busy) return
    setBusy(true)
    try {
      const nwc = await resolveFreshUserNwc(
        () => apiClient.get<UserMeResponse>('/api/users/me'),
        resolveUserNwc(me)
      )
      invalidateApiPath('/api/users/me')
      if (!nwc) {
        toast.error(t.cashOut.noWallet)
        return
      }
      const { preimage } = await payInvoice(nwc, swap.bolt11)
      // Best effort: tracking still works off the provider status without it.
      await apiClient
        .post<Swap>(`/api/wallet/swaps/${swap.id}/paid`, { preimage })
        .then(setSwap)
        .catch(() => {})
      setStep('status')
    } catch (err) {
      toast.error(nwcErrorText(t, err, t.cashOut.paymentFailed))
    } finally {
      setBusy(false)
    }
  }

  if (step === 'status' && swap) {
    const Icon =
      swap.status === 'COMPLETED'
        ? CheckCircle2
        : swap.status === 'FAILED' ||
            swap.status === 'EXPIRED' ||
            swap.status === 'CANCELED'
          ? XCircle
          : Clock
    return (
      <div className="flex flex-1 flex-col items-center gap-4 px-4 py-10 text-center">
        <Icon
          className={cn(
            'size-14',
            swap.status === 'COMPLETED' && 'text-emerald-500',
            (swap.status === 'FAILED' ||
              swap.status === 'EXPIRED' ||
              swap.status === 'CANCELED') &&
              'text-destructive',
            swap.status === 'PENDING' && 'text-muted-foreground'
          )}
        />
        <h2 className="text-xl font-semibold">
          {t.cashOut.status[swap.status]}
        </h2>
        <p className="text-sm text-muted-foreground max-w-xs">
          {swap.status === 'COMPLETED'
            ? t.cashOut.completedBody
            : swap.status === 'FAILED'
              ? t.cashOut.failedBody
              : swap.status === 'EXPIRED' || swap.status === 'CANCELED'
                ? t.cashOut.expiredBody
                : t.cashOut.pendingBody}
        </p>
        <p className="text-2xl font-semibold tabular-nums">
          ARS {swap.amountArs.toLocaleString()}
        </p>
        {swap.status === 'PENDING' && <Spinner size={16} />}
        {swap.receiptUrl && (
          <a
            href={swap.receiptUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-sm underline underline-offset-2"
          >
            {t.cashOut.receipt} <ExternalLink className="size-3.5" />
          </a>
        )}
        <Button
          variant="theme"
          className="mt-4 h-12 w-full max-w-sm"
          onClick={() => router.replace('/wallet')}
        >
          {t.cashOut.done}
        </Button>
      </div>
    )
  }

  if (step === 'confirm' && swap) {
    const rows: [string, string][] = [
      [t.cashOut.theyReceive, `ARS ${swap.amountArs.toLocaleString()}`],
      [
        t.cashOut.to,
        swap.holderName
          ? `${swap.holderName} · ${swap.destination}`
          : swap.destination
      ],
      [t.cashOut.via, PROVIDER_NAMES[swap.provider]]
    ]
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-5 px-4 py-6">
        <section className="flex flex-col items-center gap-2 rounded-3xl border bg-card px-5 py-6 text-center">
          <span className="text-xs font-medium uppercase tracking-[0.22em] text-muted-foreground">
            {t.cashOut.youPay}
          </span>
          <div className="flex items-baseline gap-2 tabular-nums">
            <span className="text-5xl font-semibold">
              {swap.amountSats.toLocaleString()}
            </span>
            <span className="text-lg font-semibold text-muted-foreground">
              sats
            </span>
          </div>
        </section>
        <dl className="flex flex-col gap-3 rounded-xl border p-4 text-sm">
          {rows.map(([k, v]) => (
            <div key={k} className="flex justify-between gap-4">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="text-right font-medium break-all">{v}</dd>
            </div>
          ))}
        </dl>
        <Button
          variant="theme"
          className="mt-auto h-12"
          disabled={busy}
          onClick={pay}
        >
          {busy ? (
            <>
              <Spinner size={16} /> {t.cashOut.paying}
            </>
          ) : (
            t.cashOut.pay(swap.amountSats.toLocaleString())
          )}
        </Button>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 py-6">
      <div className="space-y-1.5">
        <Label htmlFor="cash-out-amount">{t.cashOut.amountLabel}</Label>
        <Input
          id="cash-out-amount"
          inputMode="decimal"
          placeholder={t.cashOut.amountPlaceholder}
          value={amount}
          onChange={e => setAmount(e.target.value.replace(/[^\d.]/g, ''))}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="cash-out-destination">
          {t.cashOut.destinationLabel}
        </Label>
        <Input
          id="cash-out-destination"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          placeholder={t.cashOut.destinationPlaceholder}
          value={destination}
          onChange={e => setDestination(e.target.value)}
          aria-invalid={dest !== '' && !destValid}
        />
        {dest !== '' && !destValid && (
          <p className="text-xs text-destructive">
            {t.cashOut.destinationInvalid}
          </p>
        )}
        {lookup.status === 'loading' && (
          <p className="text-xs text-muted-foreground">{t.cashOut.lookingUp}</p>
        )}
        {lookup.status === 'missing' && (
          <p className="text-xs text-destructive">{t.cashOut.notFound}</p>
        )}
        {lookup.status === 'found' && (
          <p className="text-xs text-muted-foreground">
            {lookup.data.owners[0]?.name} · {t.cashOut.bank(lookup.data.bank)}
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="cash-out-holder">{t.cashOut.holderLabel}</Label>
        <Input
          id="cash-out-holder"
          value={holderName}
          onChange={e => setHolderName(e.target.value)}
        />
      </div>

      {debouncedAmount > 0 && (
        <fieldset className="space-y-2">
          <legend className="mb-1.5 text-sm font-medium">
            {t.cashOut.providerLabel}
          </legend>
          {!quotes && (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <Spinner size={12} /> {t.cashOut.quoting}
            </p>
          )}
          {quotes?.length === 0 && (
            <p className="text-xs text-muted-foreground">
              {t.cashOut.noProviders}
            </p>
          )}
          {quotes?.map(q => {
            const blocker = providerBlocker(q)
            const active = provider === q.provider
            return (
              <button
                key={q.provider}
                type="button"
                disabled={blocker !== null}
                aria-pressed={active}
                onClick={() => setProvider(q.provider)}
                className={cn(
                  'flex w-full items-center justify-between rounded-xl border px-4 py-3 text-left text-sm transition-colors disabled:opacity-50',
                  active && 'border-primary bg-primary/5'
                )}
              >
                <span className="font-medium">
                  {PROVIDER_NAMES[q.provider]}
                </span>
                <span className="text-muted-foreground tabular-nums">
                  {blocker ??
                    t.cashOut.quoteSats((q.sats ?? 0).toLocaleString())}
                </span>
              </button>
            )
          })}
        </fieldset>
      )}

      <Button
        variant="theme"
        className="mt-auto h-12"
        disabled={!canContinue || busy}
        onClick={createOrder}
      >
        {busy ? (
          <>
            <Spinner size={16} /> {t.cashOut.creating}
          </>
        ) : (
          t.cashOut.continue
        )}
      </Button>
    </div>
  )
}
