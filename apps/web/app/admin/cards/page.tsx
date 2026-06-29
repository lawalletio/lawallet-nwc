'use client'

import { useState, useMemo, useEffect, useRef } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  Search,
  MoreHorizontal,
  RefreshCw,
  Upload,
  Download,
  Archive,
  ArchiveRestore,
  Trash2,
  RotateCcw,
  Pencil,
  Check,
  Nfc,
  Smartphone,
  X as XIcon,
} from 'lucide-react'
import { toast } from 'sonner'
import { AdminTopbar } from '@/components/admin/admin-topbar'
import { CreateCardDialog } from '@/components/admin/create-card-dialog'
import { BulkCardGuideDialog } from '@/components/admin/bulk-card-guide-dialog'
import { DevRemoveAllCards } from '@/components/admin/dev-remove-all-cards'
import { UploadDesignDialog } from '@/components/admin/upload-design-dialog'
import { DesignImage } from '@/components/admin/design-image'
import { PermissionGuard } from '@/components/admin/permission-guard'
import { StatCard } from '@/components/admin/stat-card'
import { TableSkeleton } from '@/components/admin/skeletons/table-skeleton'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
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
import { Permission, Role } from '@/lib/auth/permissions'
import { useAuth } from '@/components/admin/auth-context'
import { useCards, useMyCards, useCardCounts } from '@/lib/client/hooks/use-cards'
import {
  useDesigns,
  useDesignMutations,
  type DesignData,
} from '@/lib/client/hooks/use-designs'
import { useSettings } from '@/lib/client/hooks/use-settings'
import { truncateNpub, formatRelativeTime, truncateHex } from '@/lib/client/format'
import { cn } from '@/lib/utils'
import { trackEvent } from '@/lib/analytics/gtag'
import { AnalyticsEvent } from '@/lib/analytics/events'

const PAGE_SIZE = 10
const DESIGN_PAGE_SIZE = 6

export default function CardsPage() {
  const router = useRouter()
  const { role, isAuthorized } = useAuth()
  // Plain users (Role.USER) reach this page too — they see only the cards
  // paired to themselves (per-caller `/api/wallet/cards`), with no Create
  // action, no instance-wide stats, and no Designs section. The admin roles
  // (which hold CARDS_READ) keep the full instance-wide view.
  const canReadAll = isAuthorized(Permission.CARDS_READ)
  const canReadDesigns = isAuthorized(Permission.CARD_DESIGNS_READ)
  // Default to the caller's OWN cards (the ones paired to them). Admins
  // (CARDS_READ) get a toggle to switch to the full instance-wide view —
  // all cards, stats, and the Designs section. The toggle is hidden for
  // everyone else (a plain user only ever sees their own cards).
  const [showAll, setShowAll] = useState(false)
  const viewingAll = canReadAll && showAll
  const { data: settings } = useSettings()
  const adminCards = useCards(undefined, { enabled: viewingAll })
  const ownCards = useMyCards({ enabled: !viewingAll })
  const cards = viewingAll ? adminCards.data : ownCards.data
  const cardsLoading = viewingAll ? adminCards.loading : ownCards.loading
  const refetchCards = viewingAll ? adminCards.refetch : ownCards.refetch
  const { data: counts, loading: countsLoading, refetch: refetchCounts } =
    useCardCounts({ enabled: viewingAll })
  const { data: designs, loading: designsLoading, refetch: refetchDesigns } =
    useDesigns({ enabled: canReadDesigns })
  const {
    importDesigns,
    importFromVeintiuno,
    removeFromVeintiuno,
    importing,
    importingVeintiuno,
    removingVeintiuno,
  } = useDesignMutations()

  const [search, setSearch] = useState('')
  const [designFilter, setDesignFilter] = useState('all')
  const [page, setPage] = useState(1)
  const [designTab, setDesignTab] = useState('active')
  const [designSearch, setDesignSearch] = useState('')
  const [designPage, setDesignPage] = useState(1)
  const [uploadDesignOpen, setUploadDesignOpen] = useState(false)
  const [bulkGuideOpen, setBulkGuideOpen] = useState(false)

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
      trackEvent(AnalyticsEvent.DESIGN_IMPORTED)
      toast.success('Designs synced successfully')
      refetchDesigns()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to sync designs')
    }
  }

  async function handleImportVeintiuno() {
    try {
      const result = await importFromVeintiuno()
      trackEvent(AnalyticsEvent.DESIGN_IMPORTED)
      toast.success(result?.message ?? 'Imported designs from veintiuno.lat')
      refetchDesigns()
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : 'Failed to import from veintiuno.lat',
      )
    }
  }

  async function handleRemoveVeintiuno() {
    try {
      const result = await removeFromVeintiuno()
      toast.success(result?.message ?? 'Removed imported designs')
      refetchDesigns()
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : 'Failed to remove imported designs',
      )
    }
  }

  // Domain setup is an admin concern (the alert links into admin settings), so
  // only surface it to callers with the full instance-wide cards view.
  const showDomainAlert =
    canReadAll &&
    settings &&
    (!settings.domain?.trim() || settings.domain_verified !== 'true')
  // The Sync button calls /api/card-designs/import, which pulls designs from
  // veintiuno.lat filtered by `community_id`. It rejects with a 400 when the
  // community isn't configured, so hide the button entirely until both
  // `is_community` and `community_id` are set.
  const hasCommunity =
    settings?.is_community === 'true' && !!settings?.community_id?.trim()
  // lawallet.io is the canonical instance that hosts the full veintiuno
  // catalog, so the "Import from veintiuno.lat" button is scoped to it.
  const isVeintiunoHost = settings?.domain === 'lawallet.io'
  // Designs imported from veintiuno (either source) carry a `veintiuno-` id.
  // Offer a "Remove imported" action whenever any are present.
  const hasVeintiunoDesigns =
    designs?.some(d => d.id.startsWith('veintiuno-')) ?? false

  return (
    <div className="flex flex-col">
      <AdminTopbar
        title="Cards"
        alert={
          showDomainAlert
            ? {
                title: 'Configure your domain',
                message: 'Verify domain routing to use this function',
                action: 'Configure now',
                onAction: () => router.push('/admin/settings?tab=infrastructure&domainSetup=open'),
              }
            : undefined
        }
        actions={
          <div className="flex items-center gap-2">
            {/* Dev-only: wipe all cards to re-test the flow. Tree-shaken out of
                production builds; the endpoint also 404s outside development.
                Also gated to the admin (all-cards) view — a plain user managing
                only their own cards shouldn't see an instance-wide wipe. */}
            {process.env.NODE_ENV === 'development' && canReadAll && (
              <DevRemoveAllCards
                onRemoved={() => {
                  refetchCards()
                  refetchCounts()
                }}
              />
            )}
            {/* ADMIN-only shortcut to the card emulator (forges NTAG424 taps
                with raw keys), matching the sidebar's tighter gating. */}
            {role === Role.ADMIN && (
              <Button variant="outline" size="sm" asChild>
                <Link href="/admin/emulator">
                  <Nfc className="size-4" />
                  Emulator
                </Link>
              </Button>
            )}
            <PermissionGuard permission={Permission.CARDS_WRITE}>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setBulkGuideOpen(true)}
              >
                <Smartphone className="size-4" />
                Bulk initialize
              </Button>
            </PermissionGuard>
            <PermissionGuard permission={Permission.CARDS_WRITE}>
              <CreateCardDialog onSuccess={refetchCards} />
            </PermissionGuard>
          </div>
        }
      />

      <div className="px-4 py-6 sm:px-6 flex flex-col gap-6">
        {/* View toggle — admins only. Off = the caller's own cards; on = the
            full instance-wide view (all cards + stats + Designs). */}
        {canReadAll && (
          <div className="flex items-center justify-end gap-2">
            <Label
              htmlFor="show-all-cards"
              className="text-sm text-muted-foreground"
            >
              Show all cards
            </Label>
            <Switch
              id="show-all-cards"
              checked={viewingAll}
              onCheckedChange={(next) => {
                setShowAll(next)
                setPage(1)
              }}
            />
          </div>
        )}

        {/* Stats — instance-wide aggregates, only in the all-cards view. */}
        {viewingAll && (
          <div className="grid grid-cols-3 gap-2 sm:gap-4">
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
              title="Blocked cards"
              value={counts?.blocked}
              description="Reset keys exposed — delete to remove"
              loading={countsLoading}
            />
          </div>
        )}

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
          {canReadDesigns && (
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
          )}
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
                              {/* The detail page reads the admin-scoped
                                  /api/cards/[id]; plain users (own-cards view)
                                  get the id as plain text, no broken link. */}
                              {canReadAll ? (
                                <Link
                                  href={`/admin/cards/${card.id}`}
                                  className="text-sm font-medium hover:underline"
                                >
                                  {truncateHex(card.id)}
                                </Link>
                              ) : (
                                <span className="text-sm font-medium">
                                  {truncateHex(card.id)}
                                </span>
                              )}
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
                                <span className="text-xs text-muted-foreground">
                                  {formatRelativeTime(card.createdAt)}
                                </span>
                              </div>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="text-sm font-mono">
                          {/* Prefer the owner's lightning address (resolved via
                              userId); fall back to the npub only when they
                              haven't claimed an address yet. */}
                          {card.lightningAddress?.username
                            ? card.lightningAddress.username
                            : card.lightningAddress?.pubkey
                              ? truncateNpub(card.lightningAddress.pubkey)
                              : '—'}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {formatRelativeTime(card.updatedAt)}
                        </TableCell>
                        <TableCell>
                          {canReadAll && (
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
                          )}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>

            <Pagination
              page={page}
              total={filtered.length}
              pageSize={PAGE_SIZE}
              onPage={setPage}
            />
          </>
        )}

        {/* Designs Section — instance-wide template management, shown only in
            the all-cards view and only to callers with CARD_DESIGNS_READ. */}
        {viewingAll && canReadDesigns && (
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
                {hasCommunity && (
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
                )}
                {isVeintiunoHost && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleImportVeintiuno}
                    disabled={importingVeintiuno}
                  >
                    {importingVeintiuno ? (
                      <Spinner size={16} className="mr-2" />
                    ) : (
                      <Download className="mr-2 size-4" />
                    )}
                    Import from veintiuno.lat
                  </Button>
                )}
                {hasVeintiunoDesigns && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleRemoveVeintiuno}
                    disabled={removingVeintiuno}
                  >
                    {removingVeintiuno ? (
                      <Spinner size={16} className="mr-2" />
                    ) : (
                      <Trash2 className="mr-2 size-4" />
                    )}
                    Remove imported
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setUploadDesignOpen(true)}
                >
                  <Upload className="mr-2 size-4" />
                  Upload design
                </Button>
              </PermissionGuard>
            </div>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <Tabs
              value={designTab}
              onValueChange={value => {
                setDesignTab(value)
                setDesignPage(1)
              }}
            >
              <TabsList>
                <TabsTrigger value="active">Active</TabsTrigger>
                <TabsTrigger value="archived">Archived</TabsTrigger>
              </TabsList>
            </Tabs>
            <div className="relative sm:w-64">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search designs..."
                className="pl-9"
                value={designSearch}
                onChange={e => {
                  setDesignSearch(e.target.value)
                  setDesignPage(1)
                }}
              />
            </div>
          </div>

          {(() => {
            // Filter by archive state (Active/Archived tab) and the search box,
            // then paginate client-side. The server returns every design; doing
            // it here keeps one fetch per page load and lets the SSE
            // `designs:updated` event refresh everything at once.
            const q = designSearch.trim().toLowerCase()
            const filteredDesigns = (designs ?? []).filter(d => {
              const matchesTab =
                designTab === 'archived' ? !!d.archivedAt : !d.archivedAt
              if (!matchesTab) return false
              if (!q) return true
              return (
                (d.description || '').toLowerCase().includes(q) ||
                d.id.toLowerCase().includes(q)
              )
            })
            const pageDesigns = filteredDesigns.slice(
              (designPage - 1) * DESIGN_PAGE_SIZE,
              designPage * DESIGN_PAGE_SIZE,
            )

            if (designsLoading) {
              return (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <Skeleton key={i} className="h-56 w-full rounded-lg" />
                  ))}
                </div>
              )
            }
            if (filteredDesigns.length === 0) {
              return (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <p className="text-sm text-muted-foreground">
                    {designSearch.trim()
                      ? 'No designs match your search'
                      : designTab === 'archived'
                        ? 'No archived designs'
                        : 'No designs found'}
                  </p>
                </div>
              )
            }
            return (
              <>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {pageDesigns.map(design => (
                    <Card key={design.id} className="overflow-hidden">
                      <DesignCardHeader
                        design={design}
                        onUpdated={refetchDesigns}
                      />
                      <CardContent className="p-4">
                        <Link
                          href={`/admin/card-designs/${design.id}`}
                          className="group block"
                          aria-label={`View cards using ${design.description || 'this design'}`}
                        >
                          <DesignImage
                            src={design.image}
                            alt={design.description || 'Card design'}
                            className="transition-transform duration-200 group-hover:scale-[1.02]"
                          />
                        </Link>
                      </CardContent>
                    </Card>
                  ))}
                </div>
                <Pagination
                  page={designPage}
                  total={filteredDesigns.length}
                  pageSize={DESIGN_PAGE_SIZE}
                  onPage={setDesignPage}
                />
              </>
            )
          })()}
        </div>
        )}
      </div>

      <UploadDesignDialog
        open={uploadDesignOpen}
        onOpenChange={setUploadDesignOpen}
        onCreated={refetchDesigns}
      />

      <BulkCardGuideDialog open={bulkGuideOpen} onOpenChange={setBulkGuideOpen} />
    </div>
  )
}

/**
 * Shared pager for the cards table and the designs grid: a "showing X–Y of N"
 * summary plus numbered page buttons. Renders nothing for a single page.
 */
function Pagination({
  page,
  total,
  pageSize,
  onPage,
}: {
  page: number
  total: number
  pageSize: number
  onPage: (page: number) => void
}) {
  const totalPages = Math.ceil(total / pageSize)
  if (totalPages <= 1) return null
  return (
    <div className="flex flex-col items-center justify-between gap-3 sm:flex-row">
      <p className="text-sm text-muted-foreground">
        Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of{' '}
        {total}
      </p>
      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="sm"
          disabled={page === 1}
          onClick={() => onPage(page - 1)}
        >
          Previous
        </Button>
        {Array.from({ length: totalPages }, (_, i) => i + 1).map(p => (
          <Button
            key={p}
            variant={p === page ? 'default' : 'outline'}
            size="sm"
            className="w-9"
            onClick={() => onPage(p)}
          >
            {p}
          </Button>
        ))}
        <Button
          variant="outline"
          size="sm"
          disabled={page === totalPages}
          onClick={() => onPage(page + 1)}
        >
          Next
        </Button>
      </div>
    </div>
  )
}

/**
 * Header row for a single design card. Shows the design's name + created
 * timestamp, an inline "Edit" affordance that swaps to an input on click,
 * and the existing Archive placeholder. Saves via PUT /api/card-designs/:id;
 * Enter commits, Escape cancels, and blur acts as Save so the user can
 * just click away.
 */
function DesignCardHeader({
  design,
  onUpdated,
}: {
  design: DesignData
  onUpdated: () => void
}) {
  const { updateDesign, updating } = useDesignMutations()
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(design.description ?? '')
  const inputRef = useRef<HTMLInputElement>(null)

  // Keep the local value in sync when the design refetches from the server.
  useEffect(() => {
    if (!editing) setValue(design.description ?? '')
  }, [design.description, editing])

  useEffect(() => {
    if (editing) inputRef.current?.focus()
  }, [editing])

  async function commit() {
    const next = value.trim()
    if (!next) {
      toast.error('Design name cannot be empty')
      return
    }
    if (next === (design.description ?? '').trim()) {
      setEditing(false)
      return
    }
    try {
      await updateDesign(design.id, { description: next })
      trackEvent(AnalyticsEvent.DESIGN_UPDATED, { field: 'description' })
      toast.success('Design updated')
      setEditing(false)
      onUpdated()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update design')
    }
  }

  function cancel() {
    setValue(design.description ?? '')
    setEditing(false)
  }

  const isArchived = !!design.archivedAt

  async function toggleArchive() {
    try {
      await updateDesign(design.id, { archived: !isArchived })
      trackEvent(AnalyticsEvent.DESIGN_UPDATED, {
        field: isArchived ? 'restored' : 'archived',
      })
      toast.success(isArchived ? 'Design restored' : 'Design archived')
      onUpdated()
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to update design',
      )
    }
  }

  return (
    <CardHeader className="flex flex-row items-start justify-between p-4 pb-0">
      <div className="flex min-w-0 flex-col gap-0.5">
        {editing ? (
          <div className="flex items-center gap-1">
            <Input
              ref={inputRef}
              value={value}
              onChange={e => setValue(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  commit()
                } else if (e.key === 'Escape') {
                  e.preventDefault()
                  cancel()
                }
              }}
              onBlur={commit}
              disabled={updating}
              className="h-8 text-sm"
              maxLength={120}
              placeholder="Design name"
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8"
              onMouseDown={e => e.preventDefault()}
              onClick={commit}
              disabled={updating}
              aria-label="Save"
            >
              <Check className="size-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8"
              onMouseDown={e => e.preventDefault()}
              onClick={cancel}
              disabled={updating}
              aria-label="Cancel"
            >
              <XIcon className="size-4" />
            </Button>
          </div>
        ) : (
          <CardTitle className="flex items-center gap-1.5 truncate text-sm font-medium">
            <span className="truncate">{design.description || 'Untitled'}</span>
            <PermissionGuard permission={Permission.CARD_DESIGNS_WRITE}>
              <button
                type="button"
                onClick={() => setEditing(true)}
                aria-label="Edit design name"
                className="flex size-6 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
              >
                <Pencil className="size-3.5" />
              </button>
            </PermissionGuard>
          </CardTitle>
        )}
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>{formatRelativeTime(design.createdAt)}</span>
          <Link
            href={`/admin/card-designs/${design.id}`}
            className="text-primary hover:underline"
          >
            View instances →
          </Link>
        </div>
      </div>
      <PermissionGuard permission={Permission.CARD_DESIGNS_WRITE}>
        <Button
          variant="ghost"
          size="sm"
          disabled={editing || updating}
          onClick={toggleArchive}
        >
          {isArchived ? (
            <>
              <ArchiveRestore className="mr-2 size-4" />
              Restore
            </>
          ) : (
            <>
              <Archive className="mr-2 size-4" />
              Archive
            </>
          )}
        </Button>
      </PermissionGuard>
    </CardHeader>
  )
}
