'use client'

import React, { useState } from 'react'
import Link from 'next/link'
import { Undo2, UserX, Users } from 'lucide-react'
import { toast } from 'sonner'
import { DataTablePagination } from '@/components/admin/data-table-pagination'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table'
import { useApi, useMutation } from '@/lib/client/hooks/use-api'
import {
  formatDateTime,
  formatRelativeTime,
  truncateNpub
} from '@/lib/client/format'
import { cn } from '@/lib/utils'

const PAGE_SIZE = 10

interface Voter {
  userId: string
  lightningAddress?: string
  npub: string
  responseCount: number
  lastVoteAt: string | null
  dismissed?: true
}

interface VotersPage {
  items: Voter[]
  total: number
  page: number
  pageSize: number
}

/** Users who answered the most polls; dismissing one excludes them everywhere. */
export function TopVotersCard({
  pollCount,
  onChange
}: {
  pollCount: number
  /** Dismiss/restore changes every poll's counts — let the page refetch. */
  onChange: () => void
}) {
  const [page, setPage] = useState(1)
  const { data, loading, refetch } = useApi<VotersPage>(
    `/api/admin/polls/voters?page=${page}&pageSize=${PAGE_SIZE}`
  )
  const { mutate } = useMutation<unknown, unknown>(['/api/admin/polls'])
  const [busy, setBusy] = useState<string | null>(null)

  async function toggle(voter: Voter) {
    const dismissed = !voter.dismissed
    setBusy(voter.userId)
    try {
      await mutate('patch', `/api/admin/polls/voters/${voter.userId}`, {
        dismissed
      })
      toast.success(
        dismissed ? 'Voter dismissed from all polls' : 'Voter restored'
      )
      await refetch()
      onChange()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Update failed')
    } finally {
      setBusy(null)
    }
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Users className="size-4" /> Top voters
        </CardTitle>
        <CardDescription className="text-sm font-normal tracking-normal">
          {data
            ? `${data.total} people answered at least one poll. Dismissing a voter leaves them out of every poll’s results.`
            : ' '}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 px-0 sm:px-6">
        {loading && !data ? (
          <Skeleton className="mx-4 h-40 sm:mx-0" />
        ) : !data?.items.length ? (
          <p className="px-4 text-sm text-muted-foreground sm:px-0">
            No votes yet.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10 text-right">#</TableHead>
                <TableHead>Voter</TableHead>
                <TableHead className="text-right">Polls answered</TableHead>
                <TableHead className="text-right">Last vote</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.items.map((v, index) => (
                <TableRow
                  key={v.userId}
                  className={cn(v.dismissed && 'text-muted-foreground')}
                >
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {(page - 1) * PAGE_SIZE + index + 1}
                  </TableCell>
                  <TableCell className="min-w-[180px] max-w-[280px]">
                    <div className="flex items-start gap-1">
                      <Link
                        href={`/admin/users/${v.userId}`}
                        className={cn(
                          'flex min-w-0 flex-col hover:underline',
                          v.dismissed && 'line-through'
                        )}
                      >
                        <span className="truncate font-medium">
                          {v.lightningAddress ?? truncateNpub(v.npub)}
                        </span>
                        {v.lightningAddress && (
                          <span className="truncate font-mono text-xs text-muted-foreground">
                            {truncateNpub(v.npub)}
                          </span>
                        )}
                      </Link>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7 shrink-0"
                        disabled={busy === v.userId}
                        aria-label={
                          v.dismissed ? 'Restore voter' : 'Dismiss voter'
                        }
                        title={
                          v.dismissed
                            ? 'Restore — count this voter in every poll again'
                            : 'Dismiss — stop counting this voter in every poll'
                        }
                        onClick={() => void toggle(v)}
                      >
                        {v.dismissed ? (
                          <Undo2 className="size-4" />
                        ) : (
                          <UserX className="size-4" />
                        )}
                      </Button>
                    </div>
                    {v.dismissed && (
                      <span className="text-xs font-medium text-muted-foreground">
                        Dismissed · not counted in any poll
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-right tabular-nums">
                    <span className="font-medium">{v.responseCount}</span>
                    <span className="text-muted-foreground">
                      {' '}
                      / {pollCount}
                    </span>
                  </TableCell>
                  <TableCell
                    className="whitespace-nowrap text-right text-xs text-muted-foreground"
                    title={v.lastVoteAt ? formatDateTime(v.lastVoteAt) : ''}
                  >
                    {v.lastVoteAt ? formatRelativeTime(v.lastVoteAt) : '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <DataTablePagination
          page={page}
          totalPages={totalPages}
          onPageChange={setPage}
        />
      </CardContent>
    </Card>
  )
}
