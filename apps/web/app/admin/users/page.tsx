'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Search } from 'lucide-react'
import { AdminTopbar } from '@/components/admin/admin-topbar'
import { StatCard } from '@/components/admin/stat-card'
import { DataTablePagination } from '@/components/admin/data-table-pagination'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useUsers, type AdminUser } from '@/lib/client/hooks/use-users'
import { useNostrProfile } from '@/lib/client/nostr-profile'
import { truncateNpub, formatRelativeTime } from '@/lib/client/format'
import { Role } from '@/lib/auth/permissions'

const ROLE_VARIANT: Record<Role, 'default' | 'secondary' | 'outline'> = {
  ADMIN: 'default',
  OPERATOR: 'secondary',
  VIEWER: 'secondary',
  USER: 'outline',
}

export default function UsersPage() {
  const router = useRouter()
  const { data: users, loading } = useUsers()
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const pageSize = 10

  const filtered =
    users?.filter(u => {
      const q = search.toLowerCase()
      return (
        u.pubkey.toLowerCase().includes(q) ||
        (u.primaryAddress?.toLowerCase().includes(q) ?? false)
      )
    }) ?? []

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const paginated = filtered.slice((page - 1) * pageSize, page * pageSize)

  const totals = {
    total: users?.length ?? 0,
    admins: users?.filter(u => u.role === Role.ADMIN).length ?? 0,
    withNwc: users?.filter(u => u.hasNwc).length ?? 0,
    withAddress: users?.filter(u => u.addressCount > 0).length ?? 0,
  }

  function handleSearch(value: string) {
    setSearch(value)
    setPage(1)
  }

  return (
    <div className="flex flex-col">
      <AdminTopbar title="Users" subtitle="Everyone who has signed in." />

      <div className="flex flex-col gap-6 p-6">
        <div className="grid grid-cols-2 gap-2 sm:gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            title="Total users"
            value={totals.total}
            description="Signed-in pubkeys."
            loading={loading}
          />
          <StatCard
            title="With address"
            value={totals.withAddress}
            description="Own at least one lightning address."
            loading={loading}
          />
          <StatCard
            title="With NWC"
            value={totals.withNwc}
            description="Have an NWC wallet configured."
            loading={loading}
          />
          <StatCard
            title="Admins"
            value={totals.admins}
            description="Users with ADMIN role."
            loading={loading}
          />
        </div>

        {/* min-w-0 lets the table's internal overflow:auto actually kick in
            inside this flex column — without it the section expands to fit
            the table's natural width and pushes the whole page past the
            viewport on mobile. */}
        <div className="flex min-w-0 flex-col gap-4">
          <div className="relative max-w-sm">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search by pubkey or address..."
              value={search}
              onChange={e => handleSearch(e.target.value)}
              className="pl-9"
            />
          </div>

          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Primary address</TableHead>
                  <TableHead>Role</TableHead>
                  {/* Joined column is low-priority metadata; drop it on
                      narrow screens so the higher-signal columns (avatar,
                      address, role) can keep their own widths. */}
                  <TableHead className="hidden sm:table-cell">
                    Joined
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell
                      colSpan={4}
                      className="py-8 text-center text-muted-foreground"
                    >
                      Loading...
                    </TableCell>
                  </TableRow>
                ) : paginated.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={4}
                      className="py-8 text-center text-muted-foreground"
                    >
                      No users found.
                    </TableCell>
                  </TableRow>
                ) : (
                  paginated.map(user => (
                    <UserRow
                      key={user.id}
                      user={user}
                      onClick={() => router.push(`/admin/users/${user.id}`)}
                    />
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

/**
 * Row-level component so each user's kind-0 profile is fetched in its own
 * hook instance — keeping the table parent re-render free when a single
 * profile resolves. Avatar falls back to the first 2 chars of the npub.
 */
function UserRow({ user, onClick }: { user: AdminUser; onClick: () => void }) {
  const { profile } = useNostrProfile(user.pubkey)
  const displayName =
    profile?.displayName || profile?.name || truncateNpub(user.pubkey)
  const fallback = (profile?.name || profile?.displayName || user.pubkey)
    .slice(0, 2)
    .toUpperCase()

  return (
    <TableRow
      onClick={onClick}
      className="cursor-pointer hover:bg-muted/50"
    >
      <TableCell>
        <div className="flex items-center gap-3">
          <Avatar className="size-8 shrink-0">
            {profile?.picture && (
              <AvatarImage src={profile.picture} alt={displayName} />
            )}
            <AvatarFallback className="text-xs">{fallback}</AvatarFallback>
          </Avatar>
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-sm font-medium">{displayName}</span>
            {/* Two variants so we don't need a runtime media query: the
                short 4-char truncation renders on phones, the more
                readable 8-char version kicks in from `sm` up. Both carry
                the full pubkey in `title` for hover. */}
            <span
              className="truncate font-mono text-[10px] text-muted-foreground sm:hidden"
              title={user.pubkey}
            >
              {truncateNpub(user.pubkey, 4)}
            </span>
            <span
              className="hidden truncate font-mono text-[10px] text-muted-foreground sm:inline"
              title={user.pubkey}
            >
              {truncateNpub(user.pubkey)}
            </span>
          </div>
        </div>
      </TableCell>
      <TableCell>
        {user.primaryAddress ? (
          <span className="text-sm">{user.primaryAddress}</span>
        ) : (
          <span className="text-sm text-muted-foreground">—</span>
        )}
        {user.addressCount > 1 && (
          <span className="ml-2 text-xs text-muted-foreground">
            +{user.addressCount - 1} more
          </span>
        )}
      </TableCell>
      <TableCell>
        <Badge variant={ROLE_VARIANT[user.role]} className="text-xs">
          {user.role}
        </Badge>
      </TableCell>
      <TableCell className="hidden text-sm text-muted-foreground sm:table-cell">
        {formatRelativeTime(user.createdAt)}
      </TableCell>
    </TableRow>
  )
}
