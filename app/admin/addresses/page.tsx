'use client'

import { Zap, Wifi, WifiOff } from 'lucide-react'
import { AdminTopbar } from '@/components/admin/admin-topbar'
import { StatCard } from '@/components/admin/stat-card'
import { TableSkeleton } from '@/components/admin/skeletons/table-skeleton'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useAddresses, useAddressCounts } from '@/lib/client/hooks/use-addresses'
import { truncateNpub, formatRelativeTime } from '@/lib/client/format'

export default function AddressesPage() {
  const { data: addresses, loading } = useAddresses()
  const { data: counts, loading: countsLoading } = useAddressCounts()

  return (
    <div className="flex flex-col">
      <AdminTopbar
        title="Lightning Addresses"
        subtitle="Lightning address and NWC connections"
      />

      <div className="p-6 flex flex-col gap-6">
        {/* Stats */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <StatCard
            title="Total Addresses"
            value={counts?.total}
            icon={Zap}
            loading={countsLoading}
          />
          <StatCard
            title="With NWC"
            value={counts?.withNWC}
            icon={Wifi}
            loading={countsLoading}
          />
          <StatCard
            title="Without NWC"
            value={counts?.withoutNWC}
            icon={WifiOff}
            loading={countsLoading}
          />
        </div>

        {/* Table */}
        {loading ? (
          <TableSkeleton rows={5} columns={4} />
        ) : !addresses?.length ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <p className="text-sm text-muted-foreground">No lightning addresses found</p>
          </div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Username</TableHead>
                  <TableHead>Pubkey</TableHead>
                  <TableHead>NWC</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {addresses.map((addr) => (
                  <TableRow key={addr.username}>
                    <TableCell className="font-medium">{addr.username}</TableCell>
                    <TableCell className="font-mono text-sm text-muted-foreground">
                      {truncateNpub(addr.pubkey)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={addr.nwcString ? 'default' : 'secondary'}>
                        {addr.nwcString ? 'Connected' : 'Not connected'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatRelativeTime(addr.createdAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  )
}
