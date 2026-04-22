'use client'

import { use } from 'react'
import Link from 'next/link'
import { ArrowLeft, Copy, Forward, Star } from 'lucide-react'
import { toast } from 'sonner'
import { AdminTopbar } from '@/components/admin/admin-topbar'
import { StatCard } from '@/components/admin/stat-card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Spinner } from '@/components/ui/spinner'
import { useUser, useUserMutations } from '@/lib/client/hooks/use-users'
import { useSettings } from '@/lib/client/hooks/use-settings'
import { useNostrProfile } from '@/lib/client/nostr-profile'
import { useAuth } from '@/components/admin/auth-context'
import { truncateNpub, formatRelativeTime } from '@/lib/client/format'
import { Role, Permission } from '@/lib/auth/permissions'
import type { WalletAddress } from '@/lib/client/hooks/use-wallet-addresses'
import { cn } from '@/lib/utils'

const ROLE_OPTIONS: Role[] = [Role.ADMIN, Role.OPERATOR, Role.VIEWER, Role.USER]

const ROLE_VARIANT: Record<Role, 'default' | 'secondary' | 'outline'> = {
  ADMIN: 'default',
  OPERATOR: 'secondary',
  VIEWER: 'secondary',
  USER: 'outline',
}

const MODE_LABEL: Record<WalletAddress['mode'], string> = {
  IDLE: 'Idle',
  ALIAS: 'Alias',
  CUSTOM_NWC: 'Custom NWC',
  DEFAULT_NWC: 'Default NWC',
}

/**
 * /admin/users/[userId] — admin-only profile view for a single user.
 * Shows the Nostr kind-0 profile, their lightning addresses and a
 * transaction summary from the Invoice table.
 */
export default function UserDetailPage({
  params,
}: {
  params: Promise<{ userId: string }>
}) {
  const { userId } = use(params)
  const { data: user, loading, refetch } = useUser(userId)
  const { data: settings } = useSettings()
  const { profile } = useNostrProfile(user?.pubkey ?? null)
  const { pubkey: callerPubkey, role: callerRole, isAuthorized } = useAuth()
  const { updateUserRole, loading: roleUpdating } = useUserMutations()

  const canManageRoles = isAuthorized(Permission.USERS_MANAGE_ROLES)
  const isSelf = user?.pubkey === callerPubkey

  // ROLE_OPTIONS is ordered highest → lowest. Roles strictly "below" the
  // caller in the hierarchy sit at a higher index. Mirroring the server
  // guard here means admins never see (and therefore can't pick) ADMIN as
  // a target, so a failed round-trip doesn't leave the picker stuck on
  // a rejected value.
  const callerIndex = callerRole ? ROLE_OPTIONS.indexOf(callerRole) : -1
  function isAssignable(role: Role): boolean {
    if (callerIndex < 0) return false
    return ROLE_OPTIONS.indexOf(role) > callerIndex
  }

  async function handleRoleChange(next: Role) {
    if (!user || next === user.role) return
    try {
      await updateUserRole(user.id, next)
      toast.success(`Role updated to ${next}`)
      await refetch()
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to update role',
      )
      // Roll the Radix Select back to the server's truth — its internal
      // state already flipped to the rejected option and would otherwise
      // stay divergent until the user navigated away.
      await refetch()
    }
  }

  const domain = settings?.domain || 'your-domain'
  const displayName =
    profile?.displayName ||
    profile?.name ||
    (user ? truncateNpub(user.pubkey) : '')
  const fallback = ((profile?.name || profile?.displayName || user?.pubkey || 'U') as string)
    .slice(0, 2)
    .toUpperCase()

  async function handleCopyPubkey() {
    if (!user) return
    try {
      await navigator.clipboard.writeText(user.pubkey)
      toast.success('Pubkey copied')
    } catch {
      toast.error('Could not copy')
    }
  }

  return (
    <div className="flex flex-col">
      <AdminTopbar
        title="User"
        actions={
          <Button variant="outline" size="sm" asChild>
            <Link href="/admin/users">
              <ArrowLeft className="size-4" />
              Back
            </Link>
          </Button>
        }
      />

      <div className="flex flex-col gap-6 p-6">
        {loading || !user ? (
          <div className="flex h-48 items-center justify-center">
            <Spinner size={24} />
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-4 rounded-lg border bg-card p-6 sm:flex-row sm:items-center">
              <Avatar className="size-16 shrink-0">
                {profile?.picture && (
                  <AvatarImage src={profile.picture} alt={displayName} />
                )}
                <AvatarFallback>{fallback}</AvatarFallback>
              </Avatar>
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="truncate text-xl font-semibold">
                    {displayName}
                  </h2>
                  {canManageRoles ? (
                    <Select
                      value={user.role}
                      onValueChange={v => handleRoleChange(v as Role)}
                      // Disable self-demotion client-side; the server
                      // rejects it too, but hiding the affordance avoids
                      // a confusing toast.
                      disabled={roleUpdating || isSelf}
                    >
                      <SelectTrigger
                        aria-label="Change role"
                        className="h-7 w-auto gap-1.5 rounded-full border-input bg-secondary px-2.5 py-0 text-xs font-semibold"
                      >
                        <SelectValue>{user.role}</SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {ROLE_OPTIONS.map(role => {
                          // Disable unassignable options, but keep the
                          // target's *current* role enabled so the
                          // Select's selection can render correctly even
                          // when the caller can't re-assign it.
                          const disabled =
                            !isAssignable(role) && role !== user.role
                          return (
                            <SelectItem
                              key={role}
                              value={role}
                              disabled={disabled}
                            >
                              {role}
                            </SelectItem>
                          )
                        })}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Badge
                      variant={ROLE_VARIANT[user.role]}
                      className="text-xs"
                    >
                      {user.role}
                    </Badge>
                  )}
                </div>
                {profile?.nip05 && (
                  <span className="truncate text-sm text-muted-foreground">
                    {profile.nip05}
                  </span>
                )}
                <div className="flex items-center gap-1">
                  <span
                    className="truncate font-mono text-xs text-muted-foreground"
                    title={user.pubkey}
                  >
                    {truncateNpub(user.pubkey, 12)}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-6 text-muted-foreground hover:text-foreground"
                    onClick={handleCopyPubkey}
                    aria-label="Copy pubkey"
                  >
                    <Copy className="size-3" />
                  </Button>
                </div>
                {profile?.about && (
                  <p className="mt-1 text-sm text-muted-foreground">
                    {profile.about}
                  </p>
                )}
                <span className="mt-1 text-xs text-muted-foreground">
                  Joined {formatRelativeTime(user.createdAt)}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <StatCard
                title="Lightning addresses"
                value={user.addresses.length}
                description="Owned by this user."
              />
              <StatCard
                title="Transactions"
                value={user.transactions.total}
                description={`${user.transactions.paid} paid`}
              />
              <StatCard
                title="Paid volume"
                value={user.transactions.paidSats.toLocaleString()}
                description="Sats received in paid invoices."
              />
            </div>

            <div className="flex flex-col gap-3">
              <h3 className="text-lg font-semibold">Lightning addresses</h3>
              <div className="rounded-lg border bg-card">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Address</TableHead>
                      <TableHead>Mode</TableHead>
                      <TableHead>Created</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {user.addresses.length === 0 ? (
                      <TableRow>
                        <TableCell
                          colSpan={3}
                          className="py-8 text-center text-sm text-muted-foreground"
                        >
                          This user has no lightning addresses.
                        </TableCell>
                      </TableRow>
                    ) : (
                      user.addresses.map(addr => (
                        <TableRow key={addr.username}>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <span className="font-medium">
                                {addr.username}
                                {/* Domain is implied once you're on the
                                    user detail page — drop it on phones so
                                    the Address + Mode + Created columns
                                    have enough room without horizontal
                                    scroll. */}
                                <span className="hidden text-muted-foreground sm:inline">
                                  @{domain}
                                </span>
                              </span>
                              {addr.isPrimary && (
                                <Badge
                                  variant="secondary"
                                  className="items-center gap-1 text-xs"
                                >
                                  <Star
                                    className="size-3 fill-yellow-500 text-yellow-500"
                                    aria-hidden
                                  />
                                  Primary
                                </Badge>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            {addr.mode === 'ALIAS' && addr.redirect ? (
                              // Cap the badge width and truncate long
                              // redirect targets with an ellipsis —
                              // `break-all` alone wraps character-by-
                              // character in a narrow column and balloons
                              // the row to ~6 lines tall on phones. The
                              // full address still shows on hover via
                              // `title`.
                              <Badge
                                variant="outline"
                                title={addr.redirect}
                                className="inline-flex max-w-[160px] items-center gap-1 font-mono text-xs font-normal"
                              >
                                <Forward
                                  className="size-3 shrink-0"
                                  aria-hidden
                                />
                                <span className="truncate">
                                  {addr.redirect}
                                </span>
                              </Badge>
                            ) : (
                              <Badge
                                variant={
                                  addr.mode === 'IDLE' ? 'outline' : 'default'
                                }
                                className={cn(
                                  'text-xs',
                                  addr.mode === 'IDLE' &&
                                    'italic text-muted-foreground',
                                )}
                              >
                                {MODE_LABEL[addr.mode]}
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {formatRelativeTime(addr.createdAt)}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
