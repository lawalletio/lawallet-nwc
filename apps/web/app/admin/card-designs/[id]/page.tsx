'use client'

import { use, useMemo } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { AdminTopbar } from '@/components/admin/admin-topbar'
import { Card3D } from '@/components/activate/card-3d'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { TableSkeleton } from '@/components/admin/skeletons/table-skeleton'
import { useAuth } from '@/components/admin/auth-context'
import { Permission } from '@/lib/auth/permissions'
import { useCards } from '@/lib/client/hooks/use-cards'
import { useDesigns } from '@/lib/client/hooks/use-designs'
import { useNostrProfile } from '@/lib/client/nostr-profile'
import {
  truncateNpub,
  truncateHex,
  formatRelativeTime,
  npubInitials,
} from '@/lib/client/format'

export default function CardDesignDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = use(params)
  const router = useRouter()
  const { isAuthorized } = useAuth()
  const canReadCards = isAuthorized(Permission.CARDS_READ)
  const canReadDesigns = isAuthorized(Permission.CARD_DESIGNS_READ)

  const { data: designs, loading: designsLoading } = useDesigns({
    enabled: canReadDesigns,
  })
  const { data: cards, loading: cardsLoading } = useCards(undefined, {
    enabled: canReadCards,
  })

  const design = useMemo(
    () => designs?.find(d => d.id === id) ?? null,
    [designs, id],
  )

  // Every card instance minted from this design. The admin `/api/cards` feed
  // already carries design + owner + chip + blocked state, so we filter
  // client-side — no extra endpoint, and the SSE `cards:updated` event keeps
  // this list live.
  const instances = useMemo(
    () => (cards ?? []).filter(c => c.designId === id),
    [cards, id],
  )

  const pairedCount = instances.filter(c => c.lightningAddress).length
  const usedCount = instances.filter(c => (c.ntag424?.ctr ?? 0) > 0).length

  const showNotFound = canReadDesigns && !designsLoading && !design

  return (
    <div className="flex flex-col">
      <AdminTopbar
        title="Card Design"
        type="subpage"
        onBack={() => router.push('/admin/cards')}
      />

      <div className="flex flex-col gap-6 px-4 py-6 sm:px-6">
        {!canReadDesigns ? (
          <div className="py-12 text-center">
            <p className="text-muted-foreground">
              You don&apos;t have permission to view card designs.
            </p>
          </div>
        ) : showNotFound ? (
          <div className="py-12 text-center">
            <p className="text-muted-foreground">Design not found</p>
          </div>
        ) : (
          <>
            {/* Hero — floating 3D card + design meta */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  Card Design
                  {design ? `: ${design.description || 'Untitled'}` : ''}
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col items-center gap-6 sm:flex-row sm:items-stretch">
                <div className="flex shrink-0 items-center justify-center py-2 sm:w-80">
                  {design ? (
                    <Card3D imageUrl={design.image} />
                  ) : (
                    <Skeleton className="h-48 w-72 rounded-2xl" />
                  )}
                </div>
                <div className="grid w-full grid-cols-1 gap-4 self-center sm:grid-cols-2">
                  <Meta
                    label="Design name"
                    value={
                      design ? design.description || 'Untitled' : undefined
                    }
                  />
                  <Meta label="Design ID" value={design?.id} mono />
                  <Meta
                    label="Created"
                    value={
                      design
                        ? new Date(design.createdAt).toLocaleString()
                        : undefined
                    }
                  />
                  <Meta
                    label="State"
                    value={design?.archivedAt ? 'Archived' : 'Active'}
                  />
                </div>
              </CardContent>
            </Card>

            {/* Instance stats */}
            {canReadCards && (
              <div className="grid grid-cols-3 gap-2 sm:gap-4">
                <MiniStat
                  label="Instances"
                  value={instances.length}
                  loading={cardsLoading}
                />
                <MiniStat
                  label="Paired"
                  value={pairedCount}
                  loading={cardsLoading}
                />
                <MiniStat
                  label="Used"
                  value={usedCount}
                  loading={cardsLoading}
                />
              </div>
            )}

            {/* Instances table */}
            <div className="flex flex-col gap-3">
              <div>
                <h2 className="text-lg font-semibold">Card instances</h2>
                <p className="text-sm text-muted-foreground">
                  Every card printed with this design, its status, and the user
                  it&apos;s paired to.
                </p>
              </div>

              {!canReadCards ? (
                <div className="py-12 text-center">
                  <p className="text-sm text-muted-foreground">
                    You don&apos;t have permission to view card instances.
                  </p>
                </div>
              ) : cardsLoading ? (
                <TableSkeleton rows={4} columns={4} />
              ) : instances.length === 0 ? (
                <div className="py-12 text-center">
                  <p className="text-sm text-muted-foreground">
                    No cards use this design yet.
                  </p>
                </div>
              ) : (
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Card</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>User</TableHead>
                        <TableHead>Last used</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {instances.map(card => {
                        const isPaired = !!card.lightningAddress
                        const isUsed = (card.ntag424?.ctr ?? 0) > 0
                        return (
                          <TableRow key={card.id}>
                            <TableCell>
                              <Link
                                href={`/admin/cards/${card.id}`}
                                className="font-mono text-sm font-medium hover:underline"
                              >
                                {truncateHex(card.id)}
                              </Link>
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-1.5">
                                <Badge
                                  variant={
                                    card.blocked
                                      ? 'destructive'
                                      : isPaired
                                        ? 'default'
                                        : 'secondary'
                                  }
                                  className="text-xs"
                                >
                                  {card.blocked
                                    ? 'Blocked'
                                    : isPaired
                                      ? 'Paired'
                                      : 'Unpaired'}
                                </Badge>
                                {isUsed && (
                                  <Badge variant="outline" className="text-xs">
                                    Used
                                  </Badge>
                                )}
                              </div>
                            </TableCell>
                            <TableCell className="text-sm">
                              <InstanceUser
                                lightningAddress={card.lightningAddress}
                              />
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground">
                              {formatRelativeTime(card.updatedAt)}
                            </TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

/**
 * Renders the paired holder with their Nostr avatar, or a muted dash when the
 * card is unpaired. Splitting the avatar into its own component keeps the
 * `useNostrProfile` hook out of any conditional path (hooks rule) and isolates
 * each row's kind-0 fetch so one resolving profile doesn't re-render the table.
 */
function InstanceUser({
  lightningAddress,
}: {
  lightningAddress: { username: string | null; pubkey: string } | null
}) {
  if (!lightningAddress) {
    return <span className="text-muted-foreground">—</span>
  }
  return <InstanceUserAvatar {...lightningAddress} />
}

function InstanceUserAvatar({
  username,
  pubkey,
}: {
  username: string | null
  pubkey: string
}) {
  const { profile } = useNostrProfile(pubkey)
  // Keep the card identity (lightning-address local part) as the label, falling
  // back to a truncated npub; the avatar/alt come from the kind-0 profile.
  const label = username || truncateNpub(pubkey)
  const alt = profile?.displayName || profile?.name || label
  return (
    <div className="flex items-center gap-2">
      <Avatar className="size-7 shrink-0">
        {profile?.picture && <AvatarImage src={profile.picture} alt={alt} />}
        <AvatarFallback className="text-[10px]">
          {npubInitials(pubkey)}
        </AvatarFallback>
      </Avatar>
      <span className="truncate font-mono">{label}</span>
    </div>
  )
}

function Meta({
  label,
  value,
  mono,
}: {
  label: string
  value?: string
  mono?: boolean
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      {value === undefined ? (
        <Skeleton className="h-5 w-32" />
      ) : (
        <span className={mono ? 'break-all font-mono text-sm' : 'text-sm'}>
          {value}
        </span>
      )}
    </div>
  )
}

function MiniStat({
  label,
  value,
  loading,
}: {
  label: string
  value: number
  loading?: boolean
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      {loading ? (
        <Skeleton className="mt-1 h-7 w-10" />
      ) : (
        <p className="text-2xl font-semibold">{value}</p>
      )}
    </div>
  )
}
