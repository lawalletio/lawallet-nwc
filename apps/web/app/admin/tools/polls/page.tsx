'use client'

import React, { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  BarChart3,
  ListOrdered,
  Lock,
  MoreHorizontal,
  Pencil,
  Play,
  Plus,
  Square,
  Trash2,
  Vote
} from 'lucide-react'
import { toast } from 'sonner'
import { AdminTopbar } from '@/components/admin/admin-topbar'
import { useAuth } from '@/components/admin/auth-context'
import {
  POLL_TYPE_LABEL,
  PollFormDialog,
  type AdminPoll
} from '@/components/admin/polls/poll-form-dialog'
import { PollStatusBadge } from '@/components/admin/polls/poll-status-badge'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Skeleton } from '@/components/ui/skeleton'
import { Role } from '@/lib/auth/permissions'
import { useApi, useMutation } from '@/lib/client/hooks/use-api'
import { formatRelativeTime } from '@/lib/client/format'

export default function PollsPage() {
  const router = useRouter()
  const { status, role } = useAuth()
  const allowed = status === 'authenticated' && role === Role.ADMIN

  useEffect(() => {
    if (status === 'authenticated' && !allowed) {
      toast.error('Only administrators can manage polls.', {
        id: 'polls-admin-only'
      })
      router.replace('/admin/tools')
    }
  }, [status, allowed, router])

  const { data, loading, refetch } = useApi<AdminPoll[]>(
    allowed ? '/api/admin/polls' : null
  )
  const { mutate } = useMutation<unknown, AdminPoll>(['/api/admin/polls'])
  const [editing, setEditing] = useState<AdminPoll | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [deleting, setDeleting] = useState<AdminPoll | null>(null)

  function openForm(poll: AdminPoll | null) {
    setEditing(poll)
    setFormOpen(true)
  }

  async function setStatus(poll: AdminPoll, next: AdminPoll['status']) {
    try {
      await mutate('patch', `/api/admin/polls/${poll.id}`, { status: next })
      toast.success(next === 'OPEN' ? 'Poll is open' : 'Poll closed')
      await refetch()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Update failed')
    }
  }

  async function confirmDelete() {
    if (!deleting) return
    try {
      await mutate('del', `/api/admin/polls/${deleting.id}`)
      toast.success('Poll deleted')
      await refetch()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Delete failed')
    } finally {
      setDeleting(null)
    }
  }

  return (
    <div className="flex flex-col">
      <AdminTopbar
        title="Polls"
        subtitle="Ask your community what to build next."
        actions={
          allowed && (
            <Button size="sm" onClick={() => openForm(null)}>
              <Plus className="size-4" /> New poll
            </Button>
          )
        }
      />

      <div className="flex max-w-4xl flex-col gap-3 px-4 py-6 sm:px-6">
        {(!allowed || (loading && !data)) &&
          [0, 1].map(i => <Skeleton key={i} className="h-28 rounded-xl" />)}

        {data?.length === 0 && (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
              <Vote className="size-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                No polls yet. Create one and users answer it from the wallet.
              </p>
              <Button size="sm" onClick={() => openForm(null)}>
                <Plus className="size-4" /> New poll
              </Button>
            </CardContent>
          </Card>
        )}

        {data?.map(poll => (
          <Card
            key={poll.id}
            className="group transition-colors hover:border-foreground/20"
          >
            <CardContent className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:p-5">
              <Link
                href={`/admin/tools/polls/${poll.id}`}
                className="flex min-w-0 flex-1 flex-col gap-2"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="truncate text-base font-semibold">
                    {poll.title}
                  </h3>
                  <PollStatusBadge status={poll.status} />
                  {!poll.updatable && (
                    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                      <Lock className="size-3" /> one-time
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <code>{poll.slug}</code>
                  <span className="inline-flex items-center gap-1">
                    <ListOrdered className="size-3" />
                    {POLL_TYPE_LABEL[poll.type]}
                    {poll.type !== 'TEXT' &&
                      ` · ${poll.options.length} options${poll.allowCustom ? ' + custom' : ''}`}
                  </span>
                </div>
              </Link>

              <div className="flex items-center gap-4 sm:gap-6">
                <div className="flex flex-col items-end">
                  <span className="text-2xl font-semibold tabular-nums">
                    {poll.responseCount}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {poll.lastResponseAt
                      ? `last ${formatRelativeTime(poll.lastResponseAt)}`
                      : 'responses'}
                  </span>
                </div>
                <Button variant="outline" size="sm" asChild>
                  <Link href={`/admin/tools/polls/${poll.id}`}>
                    <BarChart3 className="size-4" /> Results
                  </Link>
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" aria-label="Actions">
                      <MoreHorizontal className="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => openForm(poll)}>
                      <Pencil className="size-4" /> Edit
                    </DropdownMenuItem>
                    {poll.status === 'OPEN' ? (
                      <DropdownMenuItem
                        onClick={() => setStatus(poll, 'CLOSED')}
                      >
                        <Square className="size-4" /> Close
                      </DropdownMenuItem>
                    ) : (
                      <DropdownMenuItem onClick={() => setStatus(poll, 'OPEN')}>
                        <Play className="size-4" />
                        {poll.status === 'DRAFT' ? 'Publish' : 'Reopen'}
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="text-destructive focus:text-destructive"
                      onClick={() => setDeleting(poll)}
                    >
                      <Trash2 className="size-4" /> Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <PollFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        poll={editing}
        onSaved={() => void refetch()}
      />

      <AlertDialog
        open={!!deleting}
        onOpenChange={open => !open && setDeleting(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{deleting?.title}”?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the poll and its {deleting?.responseCount ?? 0}{' '}
              responses. It cannot be undone — close the poll instead to keep
              the results.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
