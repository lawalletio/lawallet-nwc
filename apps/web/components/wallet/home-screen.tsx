'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import {
  ArrowDownLeft,
  ArrowUpRight,
  Eye,
  EyeOff,
  QrCode,
  Sparkles,
} from 'lucide-react'
import { useApi } from '@/lib/client/hooks/use-api'
import { useNwcBalance } from '@/lib/client/use-nwc-balance'
import { listTransactions, type NwcTransaction } from '@/lib/client/nwc'
import { nwcCacheKey } from '@/lib/client/cache/key'
import {
  readRecent as readRecentTxs,
  upsertMany as upsertTxs,
} from '@/lib/client/cache/activity-cache'
import { useAuth } from '@/components/admin/auth-context'
import { useBrandLogotypes } from '@/lib/client/hooks/use-brand'
import { useNostrProfile } from '@/lib/client/nostr-profile'
import {
  convertSats,
  useYadioRates,
  type BtcRates,
} from '@/lib/client/use-yadio-ticker'
import {
  useActiveCurrencies,
  type Currency as CurrencyDef,
} from '@/lib/client/currencies-store'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { NavTabbar } from '@/components/wallet/shared/nav-tabbar'
import { RelayErrorBadge } from '@/components/wallet/shared/relay-error-badge'
import { TransactionRow } from '@/components/wallet/shared/transaction-row'
import { AddressShareDialog } from '@/components/wallet/home/address-share-dialog'
import { cn } from '@/lib/utils'

interface UserMeResponse {
  userId: string
  lightningAddress: string | null
  nwcString: string
  effectiveNwcString: string | null
  primaryAddressMode: string | null
  primaryUsername: string | null
}


export function HomeScreen() {
  const { logout, pubkey } = useAuth()
  const { isotypo, logotype } = useBrandLogotypes()
  const { profile } = useNostrProfile(pubkey)
  const { rates } = useYadioRates()
  const activeCurrencies = useActiveCurrencies()
  const { data: me, loading: meLoading } = useApi<UserMeResponse>('/api/users/me')
  const effectiveNwc = me?.effectiveNwcString ?? null
  // Bump on each NIP-47 notification so the recent-activity preview can
  // refetch without spinning up its own relay subscription. `useNwcBalance`
  // already maintains one — piggyback on that.
  const [txTick, setTxTick] = useState(0)
  const {
    sats,
    error,
    loading,
    fromCache,
    status,
    refetch,
  } = useNwcBalance(effectiveNwc, {
    onTransaction: () => setTxTick(t => t + 1),
  })

  const hasAddress = Boolean(me?.lightningAddress)
  const hasNwc = Boolean(effectiveNwc)
  // Only show the first-paint spinner when there's literally nothing to
  // render. With cached `sats` we want the cached number visible
  // immediately, animated via the pulse state inside `BalanceText`.
  const showSpinner =
    (loading || meLoading) && sats === null && !error && !fromCache
  const pulseBalance = loading && fromCache && sats !== null

  const [currencyCode, setCurrencyCode] = useState<string>(
    () => activeCurrencies[0]?.code ?? 'SAT',
  )
  const [balanceHidden, setBalanceHidden] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)

  const avatarSrc = profile?.picture || isotypo

  // Snap back to the first active currency if the user removes the one
  // currently displayed (otherwise we'd render `—` forever).
  const selectedCurrency =
    activeCurrencies.find(c => c.code === currencyCode) ?? activeCurrencies[0]
  const activeCode = selectedCurrency?.code ?? 'SAT'

  return (
    <div className="flex flex-1 flex-col">
      <header className="flex items-center justify-between gap-3 px-4 pt-4">
        <button
          type="button"
          onClick={logout}
          aria-label={pubkey ? `Logged in as ${pubkey.slice(0, 8)}…${pubkey.slice(-4)}` : 'Profile'}
          className="relative flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-full bg-card transition-colors hover:opacity-90"
        >
          <Image
            src={avatarSrc}
            alt=""
            fill
            sizes="44px"
            className={cn(
              profile?.picture ? 'object-cover' : 'object-contain p-1.5',
            )}
            unoptimized
          />
        </button>

        <div className="relative flex h-11 flex-1 items-center justify-center rounded-2xl bg-card px-4">
          <Image
            src={logotype}
            alt="Community"
            width={88}
            height={20}
            className="h-5 w-auto object-contain"
            unoptimized
          />
        </div>

        <button
          type="button"
          onClick={() => setBalanceHidden(v => !v)}
          aria-label={balanceHidden ? 'Show balance' : 'Hide balance'}
          aria-pressed={balanceHidden}
          className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-card text-foreground transition-colors hover:bg-accent"
        >
          {balanceHidden ? <EyeOff className="size-5" /> : <Eye className="size-5" />}
        </button>
      </header>

      <section className="flex flex-col items-center gap-3 px-4 pb-4 pt-8">
        <div className="flex items-center gap-2">
          <span className="text-xs uppercase tracking-wider text-muted-foreground">
            Your balance
          </span>
          <RelayErrorBadge
            status={status}
            error={error}
            hasCachedValue={sats !== null}
            onRetry={refetch}
          />
        </div>

        <div className="flex items-baseline gap-2 tabular-nums">
          {showSpinner ? (
            <Spinner size={32} className="text-muted-foreground" />
          ) : sats === null && error ? (
            <span className="text-base text-destructive">Unavailable</span>
          ) : (
            <>
              <BalanceText
                hidden={balanceHidden}
                sats={sats}
                code={activeCode}
                rates={rates}
                pulse={pulseBalance}
              />
              <span className="text-base font-normal text-muted-foreground">
                {activeCode === 'SAT' ? 'sats' : activeCode}
              </span>
            </>
          )}
        </div>

        <CurrencyChips
          currencies={activeCurrencies}
          value={activeCode}
          onChange={setCurrencyCode}
        />
      </section>

      <div className="flex gap-3 px-4">
        <Button
          asChild={hasNwc && hasAddress}
          variant="secondary"
          className="h-12 flex-1"
          disabled={!hasNwc || !hasAddress}
        >
          {hasNwc && hasAddress ? (
            <Link href="/wallet/receive">Receive</Link>
          ) : (
            <span>Receive</span>
          )}
        </Button>
        <Button
          asChild={hasNwc}
          variant="theme"
          className="h-12 flex-1"
          disabled={!hasNwc}
        >
          {hasNwc ? <Link href="/wallet/send">Send</Link> : <span>Send</span>}
        </Button>
      </div>

      {hasAddress && me?.lightningAddress && (
        <>
          <button
            type="button"
            onClick={() => setShareOpen(true)}
            className="mx-4 mt-4 flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 text-left transition-colors hover:bg-accent/40"
          >
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="text-xs text-muted-foreground">
                Address
              </span>
              <span className="truncate text-base font-semibold text-foreground">
                {me.lightningAddress}
              </span>
            </div>
            <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-background text-muted-foreground">
              <QrCode className="size-5" />
            </span>
          </button>

          <AddressShareDialog
            open={shareOpen}
            onOpenChange={setShareOpen}
            lightningAddress={me.lightningAddress}
            // Only inset the avatar when the user actually has a Nostr
            // profile picture. Falling back to the community isotype here
            // would overlay every QR with a generic LaWallet mark — keeps
            // the QR clean and uninterrupted in that case.
            avatarSrc={profile?.picture || undefined}
          />
        </>
      )}

      {!hasAddress && !meLoading && (
        <Link
          href="/wallet/claim-username"
          className="mx-4 mt-4 flex items-center gap-3 rounded-xl border border-dashed border-nwc-purple/40 bg-nwc-purple/5 px-4 py-3 text-sm text-foreground transition-colors hover:bg-nwc-purple/10"
        >
          <Sparkles className="size-4 text-nwc-purple" />
          <span className="flex-1">Claim your free Lightning address</span>
          <span className="text-xs text-muted-foreground">→</span>
        </Link>
      )}

      {!hasNwc && !meLoading && (
        <div className="mx-4 mt-4 rounded-xl border border-border bg-card/60 p-4 text-sm text-muted-foreground">
          <p className="font-medium text-foreground">No wallet connected</p>
          <p className="mt-1 text-xs">
            Connect a Nostr Wallet Connect URI from the admin settings page to
            start sending and receiving.
          </p>
          <Button asChild variant="secondary" size="sm" className="mt-3">
            <Link href="/admin">Open admin</Link>
          </Button>
        </div>
      )}

      <ActivityPreview nwcString={effectiveNwc} refreshKey={txTick} />

      <NavTabbar />
    </div>
  )
}

/**
 * Formats a sats amount for the requested display currency. Returns `—`
 * when the fiat rate isn't available yet so the layout doesn't shift
 * between `0` and the real number on first paint.
 *
 * `code` is a 3-letter ticker from `CURRENCY_CATALOG`. The conversion is
 * delegated to `convertSats`; this function only handles formatting:
 *   - `SAT`  → integer with thousands separators
 *   - `BTC`  → 8 fractional digits
 *   - fiat   → 2 fractional digits
 */
function formatAmount(
  sats: number,
  code: string,
  rates: BtcRates | null,
): string {
  const value = convertSats(sats, code, rates)
  if (value === null) return '—'
  if (code === 'SAT') return value.toLocaleString()
  if (code === 'BTC') {
    return value.toLocaleString(undefined, {
      minimumFractionDigits: 8,
      maximumFractionDigits: 8,
    })
  }
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

/**
 * Renders the big balance number. For BTC we visually mute the leading-
 * zero prefix (everything up to the first non-zero fractional digit) so
 * the sats-significant tail pops — e.g. `0.00001000` shows `0.0000` in
 * muted-foreground and `1000` in foreground for a 1,000-sat balance.
 */
function BalanceText({
  hidden,
  sats,
  code,
  rates,
  pulse = false,
}: {
  hidden: boolean
  sats: number | null
  code: string
  rates: BtcRates | null
  /**
   * Apply a Tailwind `animate-pulse` to the digits so a cached value
   * visibly indicates "refreshing" without dropping the number out for a
   * spinner. Set by the parent when `loading && fromCache && sats !== null`.
   */
  pulse?: boolean
}) {
  // The pulse class lives on the outer wrapper so it covers the gray
  // prefix + white tail in the BTC case. Opacity dip + animation keeps
  // the digits clearly readable while signalling staleness.
  const wrapClass = cn(
    'text-5xl font-semibold leading-none',
    pulse && 'animate-pulse opacity-70',
  )

  if (hidden) {
    return <span className={cn(wrapClass, 'text-foreground')}>•••••</span>
  }
  if (sats === null) {
    return <span className={cn(wrapClass, 'text-foreground')}>—</span>
  }

  const formatted = formatAmount(sats, code, rates)

  if (code !== 'BTC') {
    return <span className={cn(wrapClass, 'text-foreground')}>{formatted}</span>
  }

  const { gray, white } = splitBtcForEmphasis(formatted)
  return (
    <span className={wrapClass}>
      {gray && <span className="text-muted-foreground">{gray}</span>}
      <span className="text-foreground">{white}</span>
    </span>
  )
}

/**
 * Splits a BTC display string into its non-significant leading-zero
 * prefix and the rest. Cases:
 *   `1.23456789`  →  gray=""           white="1.23456789"
 *   `0.00001000`  →  gray="0.0000"     white="1000"
 *   `0.00000001`  →  gray="0.0000000"  white="1"
 *   `0.00000000`  →  gray="0.00000000" white=""
 */
export function splitBtcForEmphasis(formatted: string): { gray: string; white: string } {
  const dotIdx = formatted.indexOf('.')
  if (dotIdx === -1) {
    return { gray: '', white: formatted }
  }
  const intPart = formatted.slice(0, dotIdx)
  if (intPart !== '0') {
    return { gray: '', white: formatted }
  }
  const fraction = formatted.slice(dotIdx + 1)
  const leadingZeros = fraction.match(/^0*/)?.[0] ?? ''
  if (leadingZeros.length === fraction.length) {
    return { gray: formatted, white: '' }
  }
  return {
    gray: '0.' + leadingZeros,
    white: fraction.slice(leadingZeros.length),
  }
}

function CurrencyChips({
  currencies,
  value,
  onChange,
}: {
  currencies: CurrencyDef[]
  value: string
  onChange: (next: string) => void
}) {
  if (currencies.length <= 1) return null
  return (
    <div className="flex items-center gap-1 rounded-full bg-card p-1">
      {currencies.map(currency => {
        const label = currency.code === 'SAT' ? 'sats' : currency.code
        return (
          <button
            key={currency.code}
            type="button"
            onClick={() => onChange(currency.code)}
            className={cn(
              'rounded-full px-3 py-1 text-xs font-medium transition-colors',
              value === currency.code
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {label}
          </button>
        )
      })}
    </div>
  )
}

/**
 * Compact recent-activity preview at the bottom of the home screen.
 *
 * Pulls the most recent 5 transactions from NWC `list_transactions`,
 * rendered with the shared `TransactionRow`. The Activity tab shows
 * everything; Transfers narrows to outgoing payments. The list refetches
 * when `refreshKey` bumps — the parent home screen drives that off the
 * existing NIP-47 notification subscription so we don't open a second
 * relay connection just for this widget. The full paginated feed lives
 * at `/wallet/activity` (phase 2).
 */
function ActivityPreview({
  nwcString,
  refreshKey,
}: {
  nwcString: string | null
  refreshKey: number
}) {
  // Tab pair stays in state for future expansion, but the Transfers
  // button is currently disabled — no path can set tab to 'transfers'.
  const [tab, setTab] = useState<'activity' | 'transfers'>('activity')
  const [transactions, setTransactions] = useState<NwcTransaction[] | null>(
    null,
  )
  const [loadingTx, setLoadingTx] = useState(false)
  const [txError, setTxError] = useState<Error | null>(null)

  useEffect(() => {
    if (!nwcString) {
      setTransactions(null)
      setTxError(null)
      setLoadingTx(false)
      return
    }
    let cancelled = false
    setLoadingTx(true)
    setTxError(null)

    const cacheKey = nwcCacheKey(nwcString)

    // Hydrate from cache in parallel with the live fetch — the cached
    // five rows render before the relay round-trip resolves.
    readRecentTxs(cacheKey, 5).then(cached => {
      if (cancelled) return
      if (cached.length > 0) {
        setTransactions(prev => mergeFiveNewerFirst(prev, cached))
      }
    })

    listTransactions(nwcString, { limit: 5 })
      .then(list => {
        if (cancelled) return
        setTransactions(prev => mergeFiveNewerFirst(prev, list))
        upsertTxs(cacheKey, list)
      })
      .catch(err => {
        if (cancelled) return
        setTxError(err instanceof Error ? err : new Error('Failed to load'))
      })
      .finally(() => {
        if (cancelled) return
        setLoadingTx(false)
      })
    return () => {
      cancelled = true
    }
  }, [nwcString, refreshKey])

  const filtered = (transactions ?? []).filter(tx =>
    tab === 'transfers' ? tx.type === 'outgoing' : true,
  )

  return (
    <section className="mx-4 mt-6 flex flex-col gap-3 pb-32">
      <div className="flex items-center justify-between">
        <div className="flex gap-1 rounded-full bg-card p-1">
          <button
            type="button"
            onClick={() => setTab('activity')}
            className={cn(
              'rounded-full px-3 py-1 text-xs font-medium transition-colors',
              tab === 'activity'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            Activity
          </button>
          <button
            type="button"
            disabled
            aria-disabled
            className="cursor-not-allowed rounded-full px-3 py-1 text-xs font-medium text-muted-foreground/50"
          >
            Transfers
          </button>
        </div>

        <Link
          href="/wallet/activity"
          className="text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          View all
        </Link>
      </div>

      <ActivityList
        nwcString={nwcString}
        loading={loadingTx}
        error={txError}
        transactions={filtered}
        emptyLabel={tab === 'activity' ? 'activity' : 'transfers'}
      />
    </section>
  )
}

/**
 * Same shape as the activity-screen merger but caps to the home preview
 * size (5 rows) so the section never grows beyond what fits above the
 * tabbar on mobile.
 */
function mergeFiveNewerFirst(
  current: NwcTransaction[] | null,
  incoming: NwcTransaction[],
): NwcTransaction[] {
  const seen = new Map<string, NwcTransaction>()
  for (const tx of current ?? []) seen.set(tx.paymentHash, tx)
  for (const tx of incoming) seen.set(tx.paymentHash, tx)
  return Array.from(seen.values())
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 5)
}

function ActivityList({
  nwcString,
  loading,
  error,
  transactions,
  emptyLabel,
}: {
  nwcString: string | null
  loading: boolean
  error: Error | null
  transactions: NwcTransaction[]
  emptyLabel: string
}) {
  if (!nwcString) {
    return (
      <div className="rounded-xl border border-border bg-card/40 px-4 py-8 text-center text-sm text-muted-foreground">
        Connect a wallet to see your {emptyLabel}.
      </div>
    )
  }
  if (loading && transactions.length === 0) {
    return (
      <div className="flex items-center justify-center rounded-xl border border-border bg-card/40 px-4 py-8 text-sm text-muted-foreground">
        <Spinner size={16} className="mr-2" />
        Loading {emptyLabel}…
      </div>
    )
  }
  if (error && transactions.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card/40 px-4 py-8 text-center text-sm text-destructive">
        Couldn’t load {emptyLabel}.
      </div>
    )
  }
  if (transactions.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card/40 px-4 py-8 text-center text-sm text-muted-foreground">
        No {emptyLabel} yet.
      </div>
    )
  }

  return (
    <div className="flex flex-col rounded-xl bg-card/40">
      {transactions.map((tx, i) => (
        <div
          key={tx.paymentHash || i}
          className={cn(
            'border-b border-border/40 last:border-b-0',
          )}
        >
          <TransactionRow tx={tx} />
        </div>
      ))}
    </div>
  )
}
