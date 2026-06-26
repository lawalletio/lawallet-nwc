'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  Monitor,
  CreditCard,
  AtSign,
  ShieldAlert,
  Zap,
  Copy,
  Check,
  AlertCircle,
  ArrowRight,
  AlertTriangle,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { AdminTopbar } from '@/components/admin/admin-topbar'
import { StatCard } from '@/components/admin/stat-card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  useTotalUsers,
  useVolume,
  useSystemStatus,
  useRecentOnboarding,
  useRecentTransactions,
} from '@/lib/client/hooks/use-home-stats'
import { useAuth } from '@/components/admin/auth-context'
import { Permission } from '@/lib/auth/permissions'
import { RegisterAddressBanner } from '@/components/admin/register-address-banner'
import { EndpointError } from '@/components/admin/endpoint-error'
import { IdentityCircles } from '@/components/admin/identity-circles'
import { NwcCard } from '@/components/admin/nwc-card'
import {
  AddressRoutingShortcuts,
  AddressRedirectCard,
} from '@/components/admin/address-routing-shortcuts'
import { useApi } from '@/lib/client/hooks/use-api'

const sourceIcons = {
  App: Monitor,
  Card: CreditCard,
  Address: AtSign,
} as const

/**
 * The user's primary Lightning Address, centered under the identity circles.
 * The whole pill copies on click: the copy icon flips to a check for 3s, and a
 * "Configure" shortcut slides + fades in below for 4s before sliding away.
 */
function LightningAddressDisplay({ address }: { address: string }) {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle')
  const [showConfigure, setShowConfigure] = useState(false)
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const configureTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (copiedTimer.current) clearTimeout(copiedTimer.current)
      if (configureTimer.current) clearTimeout(configureTimer.current)
    },
    [],
  )

  const needsDomainSetup = address.endsWith('@undefined')
  const displayAddress = needsDomainSetup
    ? address.replace(/@undefined$/, '@…')
    : address
  // Split into username / @ / domain so the username reads as the predominant
  // part, with the @ and domain de-emphasized in their own colors.
  const atIndex = displayAddress.indexOf('@')
  const namePart =
    atIndex >= 0 ? displayAddress.slice(0, atIndex) : displayAddress
  const domainPart = atIndex >= 0 ? displayAddress.slice(atIndex + 1) : ''
  const username = address.split('@')[0]

  // Reflect the copy outcome in the trailing icon for 3s: check on success,
  // a red alert on failure.
  function markCopyResult(result: 'copied' | 'error') {
    setCopyState(result)
    if (copiedTimer.current) clearTimeout(copiedTimer.current)
    copiedTimer.current = setTimeout(() => setCopyState('idle'), 3000)
  }

  function handleClick() {
    // Reveal the Configure link for 4s regardless of the copy outcome.
    setShowConfigure(true)
    if (configureTimer.current) clearTimeout(configureTimer.current)
    configureTimer.current = setTimeout(() => setShowConfigure(false), 4000)

    const text = address
    if (!navigator.clipboard?.writeText) {
      // Fallback for non-secure contexts.
      try {
        const ta = document.createElement('textarea')
        ta.value = text
        ta.style.position = 'fixed'
        ta.style.opacity = '0'
        document.body.appendChild(ta)
        ta.select()
        const ok = document.execCommand('copy')
        document.body.removeChild(ta)
        if (ok) {
          toast.success('Copied to clipboard')
          markCopyResult('copied')
        } else {
          toast.error('Copy failed')
          markCopyResult('error')
        }
      } catch {
        toast.error('Copy failed')
        markCopyResult('error')
      }
      return
    }
    navigator.clipboard.writeText(text).then(
      () => {
        toast.success('Copied to clipboard')
        markCopyResult('copied')
      },
      () => {
        toast.error('Copy failed')
        markCopyResult('error')
      },
    )
  }

  return (
    <div className="flex w-full flex-col items-center gap-2 text-center">
      <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
        Your Lightning Address
      </p>
      <button
        type="button"
        onClick={handleClick}
        aria-label="Copy your Lightning Address"
        className="group inline-flex max-w-full items-center gap-2.5 rounded-full border border-border bg-card px-5 py-2.5 text-foreground shadow-sm transition-colors hover:border-ring hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        <Zap className="size-4 shrink-0 text-yellow-500" />
        <span className="truncate text-lg tracking-tight sm:text-xl">
          <span className="font-semibold text-foreground">{namePart}</span>
          {domainPart && (
            <>
              <span className="font-semibold text-yellow-500">@</span>
              <span className="font-medium text-[var(--theme-400)]">
                {domainPart}
              </span>
            </>
          )}
        </span>
        {/* Copy → Check (success) / red alert (failure), cross-faded in place
            so the pill width stays stable. */}
        <span className="relative size-4 shrink-0">
          <Copy
            className={cn(
              'absolute inset-0 size-4 text-muted-foreground transition-all duration-200 group-hover:text-foreground',
              copyState === 'idle' ? 'scale-100 opacity-100' : 'scale-75 opacity-0',
            )}
          />
          <Check
            className={cn(
              'absolute inset-0 size-4 text-green-500 transition-all duration-200',
              copyState === 'copied' ? 'scale-100 opacity-100' : 'scale-75 opacity-0',
            )}
          />
          <AlertCircle
            className={cn(
              'absolute inset-0 size-4 text-red-500 transition-all duration-200',
              copyState === 'error' ? 'scale-100 opacity-100' : 'scale-75 opacity-0',
            )}
          />
        </span>
      </button>

      {/* Configure shortcut: slides + fades in on click, stays 6s, then leaves.
          grid-rows 0fr→1fr gives a smooth height transition with no magic
          max-height; the inner link adds a slight vertical slide. */}
      <div
        className={cn(
          'grid w-full justify-items-center transition-all duration-300 ease-out',
          showConfigure ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0',
        )}
      >
        <div className="overflow-hidden">
          <Link
            href={`/admin/addresses/${encodeURIComponent(username)}`}
            tabIndex={showConfigure ? 0 : -1}
            aria-hidden={!showConfigure}
            className={cn(
              'inline-flex items-center gap-1 pt-1 text-xs font-medium text-muted-foreground underline-offset-4 transition-transform duration-300 ease-out hover:text-foreground hover:underline',
              showConfigure ? 'translate-y-0' : '-translate-y-1',
            )}
          >
            Configure
            <ArrowRight className="size-3" />
          </Link>
        </div>
      </div>

      {needsDomainSetup && (
        <Badge
          variant="secondary"
          className="text-xs bg-yellow-500/10 text-yellow-600 dark:text-yellow-500 border border-yellow-500/20 hover:bg-yellow-500/15"
        >
          <AlertTriangle className="size-3 mr-1" />
          Needs Domain setup
        </Badge>
      )}
    </div>
  )
}

export default function AdminDashboardPage() {
  const { isAuthorized, role, status } = useAuth()
  const router = useRouter()

  // Track loading + error too. If `/api/users/me` (our core identity call)
  // fails or is still in flight, we hide every downstream card/banner so we
  // don't render UI built on assumptions about data we never successfully
  // loaded (wrong "no lightning address" CTAs, stat-cards with `null`, etc.).
  const {
    data: me,
    error: meError,
    loading: meLoading,
    refetch: refetchMe,
  } = useApi<{
    userId: string
    lightningAddress: string | null
    // The primary address's configured mode drives which card renders
    // below — NwcCard for NWC-ish modes, ForwardingCard for IDLE/ALIAS.
    // Null when the user has no primary address yet.
    primaryAddressMode:
      | 'IDLE'
      | 'ALIAS'
      | 'CUSTOM_NWC'
      | 'DEFAULT_NWC'
      | null
    primaryUsername: string | null
    primaryRedirect: string | null
  }>(status === 'authenticated' ? '/api/users/me' : null)
  const canViewStats = isAuthorized(Permission.ADDRESSES_READ)

  const { data: userCounts, loading: usersLoading } = useTotalUsers()
  const { data: volume, loading: volumeLoading } = useVolume()
  const { data: systemStatus, loading: systemLoading } = useSystemStatus()
  const { data: onboarding } = useRecentOnboarding()
  const { data: transactions } = useRecentTransactions()

  return (
    <div className="flex flex-col">
      {/* No title: the home page leads with the brand logo + identity block,
          so a redundant "Home" heading is omitted (chromeless topbar). */}
      <AdminTopbar />

      <div className="px-4 py-6 sm:px-6 flex flex-col gap-6">
        {/* Hard gate: render nothing downstream until `/api/users/me`
            resolves successfully. Prevents flashing wrong empty states and
            stat cards full of `null` when the API / DB is unreachable. The
            error and loading branches live in their own short-circuit so
            the happy-path markup below can keep assuming `me` is available. */}
        {meError ? (
          <EndpointError
            error={meError}
            label="Couldn't load your account"
            onRetry={refetchMe}
          />
        ) : meLoading || !me ? (
          <div className="flex items-center justify-center py-24">
            <Spinner size={24} />
          </div>
        ) : (
          <>
        <RegisterAddressBanner lightningAddress={me?.lightningAddress ?? null} />

        {me?.lightningAddress && (
          <div className="flex flex-col items-center gap-4 py-2">
            <IdentityCircles />
            <LightningAddressDisplay address={me.lightningAddress} />
          </div>
        )}

        {/* IDLE / ALIAS primary addresses don't use NWC — swap the
            balance-and-wallet card for a purpose-built forwarding card.
            NwcCard stays for CUSTOM_NWC / DEFAULT_NWC (and legacy users
            with no primary address mode recorded), preserving the
            "set up your NWC wallet" flow it ships. */}
        {me?.primaryAddressMode === 'IDLE' ||
        me?.primaryAddressMode === 'ALIAS' ? (
          me.primaryUsername ? (
            // Already forwarding (ALIAS + a target) → show where it points
            // instead of the Connect-wallet / Redirect choice cards.
            me.primaryAddressMode === 'ALIAS' && me.primaryRedirect ? (
              <AddressRedirectCard
                username={me.primaryUsername}
                redirect={me.primaryRedirect}
              />
            ) : (
              <AddressRoutingShortcuts username={me.primaryUsername} />
            )
          ) : null
        ) : (
          <NwcCard username={me.primaryUsername} />
        )}

        {!canViewStats ? (
          // Only promote the "register your address" empty state when we
          // actually got a response back and it said the user has none.
          // An endpoint error (DB down, network, 5xx) is handled by the
          // EndpointError banner above; showing this below it would
          // contradict the true problem.
          !meError && !me?.lightningAddress ? (
            <div className="flex flex-col items-center justify-center py-24 text-center gap-4">
              <div className="flex size-16 items-center justify-center rounded-full bg-yellow-500/10">
                <Zap className="size-8 text-yellow-500" />
              </div>
              <div className="space-y-1">
                <h2 className="text-lg font-semibold">Set up your Lightning Address</h2>
                <p className="text-sm text-muted-foreground max-w-sm">
                  You need to configure a Lightning Address to get started
                  receiving payments on this platform.
                </p>
              </div>
              <Button
                variant="theme"
                onClick={() => router.push('/admin/addresses/register')}
              >
                Register now
              </Button>
            </div>
          ) : null
        ) : (
          <>
            <div className="grid grid-cols-3 gap-2 sm:gap-4">
              <StatCard
                title="Total users"
                value={userCounts?.total}
                description="The number of registered users."
                loading={usersLoading}
                href="/admin/users"
              />
              <StatCard
                title="Volume"
                value={volume?.total?.toLocaleString()}
                unit="SATs"
                badge={{ label: 'Estimated' }}
                description="Economic activity, not confirmed."
                loading={volumeLoading}
              />
              <StatCard
                title="System"
                value={systemStatus?.status}
                badge={{ label: 'Stable' }}
                description={systemStatus?.lastIncident}
                loading={systemLoading}
              />
            </div>

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <div className="flex flex-col gap-2">
                <h3 className="text-lg font-semibold">Recent Onboarding</h3>
                <p className="text-sm text-muted-foreground">
                  Latest user registrations and card pairings.
                </p>
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Identity</TableHead>
                        <TableHead>Method</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {onboarding.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={2} className="text-center text-muted-foreground py-8">
                            No data available
                          </TableCell>
                        </TableRow>
                      ) : (
                        onboarding.map((item, i) => (
                          <TableRow key={i}>
                            <TableCell className="text-sm">{item.identity}</TableCell>
                            <TableCell>
                              <Badge variant="secondary">{item.method}</Badge>
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <h3 className="text-lg font-semibold">Recent Transactions</h3>
                <p className="text-sm text-muted-foreground">
                  Latest economic activity across the platform.
                </p>
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Source</TableHead>
                        <TableHead>Identity</TableHead>
                        <TableHead>Method</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {transactions.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                            No data available
                          </TableCell>
                        </TableRow>
                      ) : (
                        transactions.map((tx, i) => {
                          const SourceIcon = sourceIcons[tx.source]
                          return (
                            <TableRow key={i}>
                              <TableCell>
                                <div className="flex items-center gap-2">
                                  <SourceIcon className="size-4 text-muted-foreground" />
                                  <span className="text-sm">{tx.source}</span>
                                </div>
                              </TableCell>
                              <TableCell className="text-sm">{tx.identity}</TableCell>
                              <TableCell>
                                <Badge variant="secondary">{tx.method}</Badge>
                              </TableCell>
                              <TableCell className="text-right text-sm">
                                {tx.amount.toLocaleString()} SATs
                              </TableCell>
                            </TableRow>
                          )
                        })
                      )}
                    </TableBody>
                  </Table>
                </div>
              </div>
            </div>
          </>
        )}
          </>
        )}
      </div>
    </div>
  )
}
