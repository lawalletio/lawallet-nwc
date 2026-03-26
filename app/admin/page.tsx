'use client'

import { Monitor, CreditCard, AtSign, ShieldAlert } from 'lucide-react'
import { AdminTopbar } from '@/components/admin/admin-topbar'
import { StatCard } from '@/components/admin/stat-card'
import { Badge } from '@/components/ui/badge'
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
import { SetupBanner } from '@/components/admin/setup-banner'

const sourceIcons = {
  App: Monitor,
  Card: CreditCard,
  Address: AtSign,
} as const

export default function AdminDashboardPage() {
  const { isAuthorized, role } = useAuth()
  const canViewStats = isAuthorized(Permission.ADDRESSES_READ)

  const { data: userCounts, loading: usersLoading } = useTotalUsers()
  const { data: volume, loading: volumeLoading } = useVolume()
  const { data: systemStatus, loading: systemLoading } = useSystemStatus()
  const { data: onboarding } = useRecentOnboarding()
  const { data: transactions } = useRecentTransactions()

  return (
    <div className="flex flex-col">
      <AdminTopbar title="Home" />

      <div className="p-6 flex flex-col gap-6">
        <SetupBanner />

        {!canViewStats ? (
          <div className="flex flex-col items-center justify-center py-24 text-center gap-4">
            <div className="flex size-16 items-center justify-center rounded-full bg-muted">
              <ShieldAlert className="size-8 text-muted-foreground" />
            </div>
            <div className="space-y-1">
              <h2 className="text-lg font-semibold">No access</h2>
              <p className="text-sm text-muted-foreground max-w-sm">
                Your account doesn&apos;t have permission to view dashboard statistics.
                Contact an administrator to request access.
              </p>
            </div>
            {role && (
              <Badge variant="secondary" className="text-xs">
                Role: {role}
              </Badge>
            )}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <StatCard
                title="Total users"
                value={userCounts?.total}
                description="The number of registered users."
                loading={usersLoading}
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
      </div>
    </div>
  )
}
