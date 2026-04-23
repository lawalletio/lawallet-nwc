'use client'

import { use, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Copy, Forward, MoreHorizontal, Pencil, Star } from 'lucide-react'
import { toast } from 'sonner'
import { AdminTopbar } from '@/components/admin/admin-topbar'
import { StatCard } from '@/components/admin/stat-card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
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
import { EditProfileDialog } from '@/components/admin/edit-profile-dialog'
import { useAuth } from '@/components/admin/auth-context'
import { truncateNpub, formatRelativeTime } from '@/lib/client/format'
import { Role, Permission } from '@/lib/auth/permissions'
import {
  type WalletAddress,
  useAddressMutations,
} from '@/lib/client/hooks/use-wallet-addresses'
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
  const router = useRouter()
  const { userId } = use(params)
  const { data: user, loading, refetch } = useUser(userId)
  const { data: settings } = useSettings()
  const { profile, updateProfile } = useNostrProfile(user?.pubkey ?? null)
  const { pubkey: callerPubkey, role: callerRole, isAuthorized } = useAuth()
  const { updateUserRole, loading: roleUpdating } = useUserMutations()
  const { setAsPrimary, settingPrimary } = useAddressMutations()
  const [editingProfile, setEditingProfile] = useState(false)
  // Optimistic primary override so the star flips before the server
  // confirms, matching /admin/addresses. Only meaningful when isSelf.
  const [optimisticPrimary, setOptimisticPrimary] = useState<string | null>(null)

  const canManageRoles = isAuthorized(Permission.USERS_MANAGE_ROLES)
  const isSelf = user?.pubkey === callerPubkey
  const isAdmin = callerRole === Role.ADMIN
  // Permission to open an address row: viewing yourself or any ADMIN
  // viewing anyone. Non-admins viewing another user keep the read-only
  // table.
  const canManageAddresses = isSelf || isAdmin

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

  async function handleCopyAddress(username: string) {
    const full = `${username}@${domain}`
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(full)
      } else {
        // execCommand fallback for insecure contexts (http://localhost in dev).
        const ta = document.createElement('textarea')
        ta.value = full
        ta.style.position = 'fixed'
        ta.style.opacity = '0'
        document.body.appendChild(ta)
        ta.select()
        document.execCommand('copy')
        ta.remove()
      }
      toast.success(`Copied ${full}`)
    } catch {
      toast.error('Could not copy to clipboard')
    }
  }

  async function handleSetPrimary(username: string) {
    // Only makes sense when the viewer is the owner — the API is
    // pubkey-scoped. For admins viewing another user, the dropdown
    // hides the Set-as-primary action entirely.
    if (!isSelf) return
    setOptimisticPrimary(username)
    try {
      await setAsPrimary(username)
      await refetch()
      toast.success(`${username}@${domain} is now primary`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to set primary')
    } finally {
      setOptimisticPrimary(null)
    }
  }

  return (
    <div className="flex flex-col">
      <AdminTopbar
        actions={
          <Button variant="outline" size="sm" asChild>
            <Link href="/admin/users">
              <ArrowLeft className="size-4" />
              Back
            </Link>
          </Button>
        }
      />

      <div className="flex flex-col gap-6 px-4 pb-6 sm:px-6">
        {loading || !user ? (
          <div className="flex h-48 items-center justify-center">
            <Spinner size={24} />
          </div>
        ) : (
          <>
            <div className="overflow-hidden rounded-lg border bg-card">
              {/* Cover / banner. Uses the kind-0 banner if present;
                  otherwise a subtle gradient fallback so the layout doesn't
                  collapse for users who haven't set one. */}
              <div
                className="relative h-32 w-full bg-gradient-to-br from-primary/30 via-primary/10 to-muted sm:h-48"
                style={
                  profile?.banner
                    ? {
                        backgroundImage: `url("${profile.banner}")`,
                        backgroundSize: 'cover',
                        backgroundPosition: 'center',
                      }
                    : undefined
                }
              />

              <div className="relative px-4 pb-4 pt-0 sm:px-6 sm:pb-6">
                {/* Avatar overlaps the cover/body boundary. The ring creates
                    a clean cutout against the card bg, matching the common
                    social-media treatment. */}
                <Avatar className="absolute -top-10 left-4 size-20 shrink-0 ring-4 ring-card sm:-top-12 sm:left-6 sm:size-24">
                  {profile?.picture && (
                    <AvatarImage src={profile.picture} alt={displayName} />
                  )}
                  <AvatarFallback className="text-lg">{fallback}</AvatarFallback>
                </Avatar>

                {/* Action row sits to the right of the avatar so the
                    overlap doesn't steal space from the edit/role button. */}
                <div className="flex min-h-10 items-start justify-end gap-2 pt-3 sm:pt-4">
                  {isSelf && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setEditingProfile(true)}
                    >
                      <Pencil className="size-3.5" />
                      Edit profile
                    </Button>
                  )}
                </div>

                <div className="mt-1 flex min-w-0 flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="truncate text-xl font-semibold sm:text-2xl">
                      {displayName}
                    </h2>
                    {canManageRoles ? (
                      <Select
                        value={user.role}
                        onValueChange={v => handleRoleChange(v as Role)}
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
                    <p className="mt-2 whitespace-pre-wrap text-sm text-foreground">
                      {profile.about}
                    </p>
                  )}
                  <span className="mt-2 text-xs text-muted-foreground">
                    Joined {formatRelativeTime(user.createdAt)}
                  </span>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2 sm:gap-4">
              <StatCard
                title="Lightning addresses"
                titleMobile="Addresses"
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
                prefix="⚡"
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
                      <TableHead className="hidden sm:table-cell">Created</TableHead>
                      {canManageAddresses && (
                        <TableHead className="w-12 text-right">Actions</TableHead>
                      )}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {user.addresses.length === 0 ? (
                      <TableRow>
                        <TableCell
                          colSpan={canManageAddresses ? 4 : 3}
                          className="py-8 text-center text-sm text-muted-foreground"
                        >
                          This user has no lightning addresses.
                        </TableCell>
                      </TableRow>
                    ) : (
                      user.addresses.map(addr => {
                        // Apply the optimistic primary flip on top of the
                        // server data so the star moves to the row the
                        // viewer just clicked before the refetch lands.
                        const isPrimary =
                          isSelf && optimisticPrimary !== null
                            ? addr.username === optimisticPrimary
                            : addr.isPrimary
                        return (
                          <TableRow key={addr.username}>
                            <TableCell>
                              <div className="flex items-center gap-2">
                                {canManageAddresses ? (
                                  <Link
                                    href={`/admin/addresses/${encodeURIComponent(addr.username)}`}
                                    className="font-medium hover:underline underline-offset-4"
                                  >
                                    {addr.username}
                                    <span className="hidden text-muted-foreground sm:inline">
                                      @{domain}
                                    </span>
                                  </Link>
                                ) : (
                                  <span className="font-medium">
                                    {addr.username}
                                    <span className="hidden text-muted-foreground sm:inline">
                                      @{domain}
                                    </span>
                                  </span>
                                )}
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="size-7 text-muted-foreground hover:text-foreground"
                                  onClick={() => handleCopyAddress(addr.username)}
                                  aria-label={`Copy ${addr.username}@${domain}`}
                                >
                                  <Copy className="size-3.5" />
                                </Button>
                                {isPrimary && (
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
                            <TableCell className="hidden text-sm text-muted-foreground sm:table-cell">
                              {formatRelativeTime(addr.createdAt)}
                            </TableCell>
                            {canManageAddresses && (
                              <TableCell className="text-right">
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <Button variant="ghost" size="icon">
                                      <MoreHorizontal className="size-4" />
                                    </Button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end">
                                    <DropdownMenuItem
                                      onClick={() =>
                                        router.push(
                                          `/admin/addresses/${encodeURIComponent(addr.username)}`,
                                        )
                                      }
                                    >
                                      Edit
                                    </DropdownMenuItem>
                                    {/* Set-as-primary is intrinsically
                                        a user-scoped write — the API
                                        sets the caller's primary. Only
                                        offer it when viewing your own
                                        profile; admins looking at other
                                        users can edit but not reorder. */}
                                    {isSelf && (
                                      <DropdownMenuItem
                                        disabled={isPrimary || settingPrimary}
                                        onClick={() => handleSetPrimary(addr.username)}
                                      >
                                        Set as primary
                                      </DropdownMenuItem>
                                    )}
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              </TableCell>
                            )}
                          </TableRow>
                        )
                      })
                    )}
                  </TableBody>
                </Table>
              </div>
            </div>
          </>
        )}
      </div>

      {isSelf && user && (
        <EditProfileDialog
          open={editingProfile}
          onOpenChange={setEditingProfile}
          profile={profile}
          pubkey={user.pubkey}
          onPublished={next => updateProfile(next)}
        />
      )}
    </div>
  )
}
