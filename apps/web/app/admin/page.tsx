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
import { LightningAddressHero } from '@/components/admin/lightning-address-hero'
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
            <LightningAddressHero
              address={me.lightningAddress}
              configureHref={`/admin/addresses/${encodeURIComponent(
                me.lightningAddress.split('@')[0],
              )}`}
            />
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
