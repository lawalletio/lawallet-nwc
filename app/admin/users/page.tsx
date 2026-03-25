'use client'

import { useState } from 'react'
import { Search, MoreHorizontal } from 'lucide-react'
import { AdminTopbar } from '@/components/admin/admin-topbar'
import { StatCard } from '@/components/admin/stat-card'
import { DataTablePagination } from '@/components/admin/data-table-pagination'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useAddresses, useAddressCounts } from '@/lib/client/hooks/use-addresses'
import { truncateNpub, formatRelativeTime } from '@/lib/client/format'

export default function UsersPage() {
  const { data: counts, loading: countsLoading } = useAddressCounts()
  const { data: addresses, loading: addressesLoading } = useAddresses()
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const pageSize = 10

  const filtered = addresses?.filter((a) =>
    a.username.toLowerCase().includes(search.toLowerCase()) ||
    a.pubkey.toLowerCase().includes(search.toLowerCase())
  ) ?? []

  const totalPages = Math.ceil(filtered.length / pageSize)
  const paginated = filtered.slice((page - 1) * pageSize, page * pageSize)

  const handleSearch = (value: string) => {
    setSearch(value)
    setPage(1)
  }

  return (
    <div className="flex flex-col">
      <AdminTopbar
        title="Users"
        actions={<Button>Invite user</Button>}
      />

      <div className="p-6 flex flex-col gap-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            title="Total users / address"
            value={counts?.total}
            secondary={`/ ${counts?.total ?? 0}`}
            description="Total number of registered."
            loading={countsLoading}
          />
          <StatCard
            title="Redirect Address"
            value={counts?.total}
            description="Lightning Addresses conf..."
            loading={countsLoading}
          />
          <StatCard
            title="NWC Hosted"
            value={counts?.withNWC}
            description="Users operating with host..."
            loading={countsLoading}
          />
          <StatCard
            title="NWC Configured"
            value={counts?.withoutNWC}
            description="Users who have successf..."
            loading={countsLoading}
          />
        </div>

        <div className="flex flex-col gap-4">
          <div>
            <h3 className="text-lg font-semibold">Lightning Address</h3>
            <p className="text-sm text-muted-foreground">
              Total Lightning Addresses issued within this community domain.
            </p>
          </div>

          <div className="relative max-w-sm">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search by username or pubkey..."
              value={search}
              onChange={(e) => handleSearch(e.target.value)}
              className="pl-9"
            />
          </div>

          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Identity</TableHead>
                  <TableHead>Pubkey</TableHead>
                  <TableHead>Last used</TableHead>
                  <TableHead className="w-[50px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {addressesLoading ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                      Loading...
                    </TableCell>
                  </TableRow>
                ) : paginated.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                      No data available
                    </TableCell>
                  </TableRow>
                ) : (
                  paginated.map((address) => (
                    <TableRow key={address.username}>
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="text-sm font-medium">{address.username}</span>
                          <span className="text-xs text-muted-foreground">
                            {formatRelativeTime(address.createdAt)}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-sm text-muted-foreground">
                        {truncateNpub(address.pubkey)}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {formatRelativeTime(address.updatedAt)}
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="size-8">
                              <MoreHorizontal className="size-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem>View details</DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          <DataTablePagination
            page={page}
            totalPages={totalPages}
            onPageChange={setPage}
          />
        </div>
      </div>
    </div>
  )
}
