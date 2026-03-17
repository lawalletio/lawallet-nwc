'use client'

import { useState } from 'react'
import Link from 'next/link'
import { MoreHorizontal } from 'lucide-react'
import { AdminTopbar } from '@/components/admin/admin-topbar'
import { CreateCardDialog } from '@/components/admin/create-card-dialog'
import { PermissionGuard } from '@/components/admin/permission-guard'
import { TableSkeleton } from '@/components/admin/skeletons/table-skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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
import { Permission } from '@/lib/auth/permissions'
import { useCards, type CardFilters } from '@/lib/client/hooks/use-cards'
import { truncateHex } from '@/lib/client/format'

type FilterTab = 'all' | 'paired' | 'unpaired' | 'used' | 'unused'

const tabToFilters: Record<FilterTab, CardFilters | undefined> = {
  all: undefined,
  paired: { paired: true },
  unpaired: { paired: false },
  used: { used: true },
  unused: { used: false },
}

export default function CardsPage() {
  const [activeTab, setActiveTab] = useState<FilterTab>('all')
  const { data: cards, loading, refetch } = useCards(tabToFilters[activeTab])

  return (
    <div className="flex flex-col">
      <AdminTopbar
        title="Cards"
        subtitle="Manage BoltCards"
        actions={
          <PermissionGuard permission={Permission.CARDS_WRITE}>
            <CreateCardDialog onSuccess={refetch} />
          </PermissionGuard>
        }
      />

      <div className="p-6 flex flex-col gap-4">
        <Tabs
          value={activeTab}
          onValueChange={(v) => setActiveTab(v as FilterTab)}
        >
          <TabsList>
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="paired">Paired</TabsTrigger>
            <TabsTrigger value="unpaired">Unpaired</TabsTrigger>
            <TabsTrigger value="used">Used</TabsTrigger>
            <TabsTrigger value="unused">Unused</TabsTrigger>
          </TabsList>
        </Tabs>

        {loading ? (
          <TableSkeleton rows={5} columns={5} />
        ) : !cards?.length ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <p className="text-sm text-muted-foreground">No cards found</p>
          </div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Card ID</TableHead>
                  <TableHead>Design</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>User</TableHead>
                  <TableHead className="w-[50px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {cards.map((card) => {
                  const isPaired = !!card.lightningAddress
                  const isUsed = card.ntag424 ? card.ntag424.ctr > 0 : false

                  return (
                    <TableRow key={card.id}>
                      <TableCell className="font-mono text-sm">
                        <Link
                          href={`/admin/cards/${card.id}`}
                          className="hover:underline"
                        >
                          {truncateHex(card.id)}
                        </Link>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {card.design?.description || '—'}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1.5">
                          <Badge variant={isPaired ? 'default' : 'secondary'}>
                            {isPaired ? 'Paired' : 'Unpaired'}
                          </Badge>
                          {isUsed && (
                            <Badge variant="outline">Used</Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm">
                        {card.lightningAddress?.username || '—'}
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
                              <Link href={`/admin/cards/${card.id}`}>
                                View Details
                              </Link>
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
        )}
      </div>
    </div>
  )
}
