'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  Search,
  MoreHorizontal,
  RefreshCw,
  Upload,
  Archive,
  Trash2,
  RotateCcw,
} from 'lucide-react'
import { toast } from 'sonner'
import { AdminTopbar } from '@/components/admin/admin-topbar'
import { CreateCardDialog } from '@/components/admin/create-card-dialog'
import { PermissionGuard } from '@/components/admin/permission-guard'
import { StatCard } from '@/components/admin/stat-card'
import { TableSkeleton } from '@/components/admin/skeletons/table-skeleton'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { Permission } from '@/lib/auth/permissions'
import { useCards, useCardCounts } from '@/lib/client/hooks/use-cards'
import { useDesigns, useDesignMutations } from '@/lib/client/hooks/use-designs'
import { useSettings } from '@/lib/client/hooks/use-settings'
import { truncateNpub, formatRelativeTime, truncateHex } from '@/lib/client/format'

const PAGE_SIZE = 10

export default function CardsPage() {
  const router = useRouter()
  const { data: settings } = useSettings()
  const { data: cards, loading: cardsLoading, refetch: refetchCards } = useCards()
  const { data: counts, loading: countsLoading } = useCardCounts()
  const { data: designs, loading: designsLoading, refetch: refetchDesigns } = useDesigns()
  const { importDesigns, loading: importing } = useDesignMutations()

  const [search, setSearch] = useState('')
  const [designFilter, setDesignFilter] = useState('all')
  const [page, setPage] = useState(1)
  const [designTab, setDesignTab] = useState('active')

  const filtered = useMemo(() => {
    if (!cards) return []
    let result = cards

    if (search.trim()) {
      const q = search.toLowerCase()
      result = result.filter(
        (card) =>
          card.id.toLowerCase().includes(q) ||
          card.lightningAddress?.pubkey?.toLowerCase().includes(q) ||
          card.lightningAddress?.username?.toLowerCase().includes(q),
      )
    }

    if (designFilter !== 'all') {
      result = result.filter((card) => card.designId === designFilter)
    }

    return result
  }, [cards, search, designFilter])

  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE)

  function handleSearchChange(value: string) {
    setSearch(value)
    setPage(1)
  }

  function handleDesignFilterChange(value: string) {
    setDesignFilter(value)
    setPage(1)
  }

  async function handleSyncDesigns() {
    try {
      await importDesigns()
      toast.success('Designs synced successfully')
      refetchDesigns()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to sync designs')
    }
  }

  const showDomainAlert = settings && !settings.domain

  return (
    <div className="flex flex-col">
      <AdminTopbar
        title="Cards"
        alert={
          showDomainAlert
            ? {
                title: 'Configure your domain',
                message: 'This action is required to use this function',
                action: 'Configure now',
                onAction: () => router.push('/admin/settings?tab=infrastructure'),
              }
            : undefined
        }
        actions={
          <PermissionGuard permission={Permission.CARDS_WRITE}>
            <CreateCardDialog onSuccess={refetchCards} />
          </PermissionGuard>
        }
      />

      <div className="p-6 flex flex-col gap-6">
        {/* Stats */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <StatCard
            title="Total cards"
            value={counts?.total}
            description="Cards written and saved in database"
            loading={countsLoading}
          />
          <StatCard
            title="Paired cards"
            value={counts?.paired}
            description="Activated cards (by user)"
            loading={countsLoading}
          />
          <StatCard
            title="Paused cards"
            value={
              counts ? counts.total - counts.paired : undefined
            }
            description="Cards temporarily disabled"
            loading={countsLoading}
          />
        </div>

        {/* Search + Filter */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input
              placeholder="Search cards by title or pubkey..."
              className="pl-9"
              value={search}
              onChange={(e) => handleSearchChange(e.target.value)}
            />
          </div>
          <Select value={designFilter} onValueChange={handleDesignFilterChange}>
            <SelectTrigger className="w-full sm:w-[200px]">
              <SelectValue placeholder="All designs" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All designs</SelectItem>
              {designs?.map((design) => (
                <SelectItem key={design.id} value={design.id}>
                  {design.description || design.id}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Cards Table */}
        {cardsLoading ? (
          <TableSkeleton rows={5} columns={4} />
        ) : !paginated.length ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <p className="text-sm text-muted-foreground">
              {search || designFilter !== 'all' ? 'No cards match your filters' : 'No cards found'}
            </p>
          </div>
        ) : (
          <>
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Card</TableHead>
                    <TableHead>Identity</TableHead>
                    <TableHead>Last used</TableHead>
                    <TableHead className="w-[50px]" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paginated.map((card) => {
                    const isPaired = !!card.lightningAddress

                    return (
                      <TableRow key={card.id}>
                        <TableCell>
                          <div className="flex items-center gap-3">
                            {card.design?.image ? (
                              <img
                                src={card.design.image}
                                alt={card.design.description || 'Design'}
                                className="size-10 rounded object-cover"
                              />
                            ) : (
                              <div className="size-10 rounded bg-muted flex items-center justify-center">
                                <span className="text-xs text-muted-foreground">—</span>
                              </div>
                            )}
                            <div className="flex flex-col gap-0.5">
                              <Link
                                href={`/admin/cards/${card.id}`}
                                className="text-sm font-medium hover:underline"
                              >
                                {truncateHex(card.id)}
                              </Link>
                              <div className="flex items-center gap-1.5">
                                <Badge
                                  variant={isPaired ? 'default' : 'secondary'}
                                  className="text-xs"
                                >
                                  {isPaired ? 'Paired' : 'Unpaired'}
                                </Badge>
                                <span className="text-xs text-muted-foreground">
                                  {formatRelativeTime(card.createdAt)}
                                </span>
                              </div>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="text-sm font-mono">
                          {card.lightningAddress?.pubkey
                            ? truncateNpub(card.lightningAddress.pubkey)
                            : '—'}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {formatRelativeTime(card.updatedAt)}
                        </TableCell>
                        <TableCell>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="size-8">
                                <MoreHorizontal className="size-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem asChild>
                                <Link href={`/admin/cards/${card.id}`}>View Details</Link>
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  Showing {(page - 1) * PAGE_SIZE + 1}–
                  {Math.min(page * PAGE_SIZE, filtered.length)} of {filtered.length}
                </p>
                <div className="flex items-center gap-1">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page === 1}
                    onClick={() => setPage(page - 1)}
                  >
                    Previous
                  </Button>
                  {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
                    <Button
                      key={p}
                      variant={p === page ? 'default' : 'outline'}
                      size="sm"
                      className="w-9"
                      onClick={() => setPage(p)}
                    >
                      {p}
                    </Button>
                  ))}
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page === totalPages}
                    onClick={() => setPage(page + 1)}
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </>
        )}

        {/* Designs Section */}
        <div className="mt-4 flex flex-col gap-4">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold">Designs</h2>
              <p className="text-sm text-muted-foreground">
                Manage your card design templates and artwork
              </p>
            </div>
            <div className="flex items-center gap-2">
              <PermissionGuard permission={Permission.CARD_DESIGNS_WRITE}>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleSyncDesigns}
                  disabled={importing}
                >
                  {importing ? (
                    <Spinner size={16} className="mr-2" />
                  ) : (
                    <RefreshCw className="mr-2 size-4" />
                  )}
                  Sync
                </Button>
                <Button variant="outline" size="sm">
                  <Upload className="mr-2 size-4" />
                  Upload design
                </Button>
              </PermissionGuard>
            </div>
          </div>

          <Tabs value={designTab} onValueChange={setDesignTab}>
            <TabsList>
              <TabsTrigger value="active">Active</TabsTrigger>
              <TabsTrigger value="archived">Archived</TabsTrigger>
            </TabsList>
          </Tabs>

          {designsLoading ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-56 w-full rounded-lg" />
              ))}
            </div>
          ) : designTab === 'archived' ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <p className="text-sm text-muted-foreground">No archived designs</p>
            </div>
          ) : !designs?.length ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <p className="text-sm text-muted-foreground">No designs found</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {designs.map((design) => (
                <Card key={design.id} className="overflow-hidden">
                  <CardHeader className="flex flex-row items-center justify-between p-4 pb-0">
                    <div className="flex flex-col gap-0.5">
                      <CardTitle className="text-sm font-medium">
                        {design.description || 'Untitled'}
                      </CardTitle>
                      <p className="text-xs text-muted-foreground">
                        {formatRelativeTime(design.createdAt)}
                      </p>
                    </div>
                    <PermissionGuard permission={Permission.CARD_DESIGNS_WRITE}>
                      <Button variant="ghost" size="sm">
                        <Archive className="mr-2 size-4" />
                        Archive
                      </Button>
                    </PermissionGuard>
                  </CardHeader>
                  <CardContent className="p-4">
                    {design.image ? (
                      <div className="aspect-video rounded-md overflow-hidden bg-muted">
                        <img
                          src={design.image}
                          alt={design.description || 'Card design'}
                          className="size-full object-cover"
                        />
                      </div>
                    ) : (
                      <div className="aspect-video rounded-md bg-muted flex items-center justify-center">
                        <span className="text-sm text-muted-foreground">No image</span>
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
