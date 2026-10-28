'use client'

import React, { useEffect, useState } from 'react'
import { ArchiveRestore, Skull, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table'
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
import { Spinner } from '@/components/ui/spinner'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { useAuth } from '@/components/admin/auth-context'
import {
  useRemoteWalletMutations,
  type RemoteWalletBalance,
  type RemoteWalletData
} from '@/lib/client/hooks/use-remote-wallets'
import { ApiClientError } from '@/lib/client/api-client'
import {
  CursorPagination,
  useLocalPagination
} from '@/components/wallet/shared/cursor-pagination'

/**
 * The "graveyard" for archived wallets (status `DEAD`): disposable LNCurl
 * wallets that ran out of sats and were destroyed by the provider, plus any
 * wallet the listener saw go more than 48h without a single sign of life —
 * including one whose NWC warm-up never succeeded. They're read-only
 * tombstones: they can't receive or be assigned to anything, and exist only so
 * the user can see how long each one lived (and why it went) before permanently
 * removing it.
 *
 * Fetched separately from the live list (the API hides DEAD by default), so
 * the section only renders when there's at least one archived wallet.
 */
const ARCHIVED_PAGE_SIZE = 10

export function ArchivedWalletsSection({
  wallets,
  onChanged
}: {
  wallets: RemoteWalletData[]
  onChanged: () => void
}) {
  const pagination = useLocalPagination(wallets, ARCHIVED_PAGE_SIZE)
  if (!wallets.length) return null

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Skull className="size-4 text-muted-foreground" />
        <h2 className="text-lg font-semibold">Archived wallets</h2>
      </div>
      <p className="text-sm text-muted-foreground">
        Wallets that were destroyed by their provider, or that went more than 48
        hours without a single sign of life. They can’t receive payments or be
        assigned to anything. If one was archived by mistake, restore it — its
        balance is checked first. Otherwise remove it permanently when you’re
        done.
      </p>
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Born</TableHead>
              <TableHead>Died</TableHead>
              <TableHead>Reason</TableHead>
              <TableHead>Lifespan</TableHead>
              <TableHead className="w-0 text-right">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pagination.items.map(w => (
              <TableRow key={w.id}>
                <TableCell className="font-medium">
                  <span className="flex items-center gap-1.5">
                    {w.name}
                    <Badge variant="outline">Dead</Badge>
                  </span>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {formatDateTime(w.createdAt)}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {w.diedAt ? formatDateTime(w.diedAt) : '—'}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {formatDiedReason(w.diedReason)}
                </TableCell>
                <TableCell className="tabular-nums">
                  {w.diedAt ? formatLifespan(w.createdAt, w.diedAt) : '—'}
                </TableCell>
                <TableCell className="text-right">
                  <span className="flex justify-end">
                    <RestoreWallet wallet={w} onChanged={onChanged} />
                    <RemovePermanently wallet={w} onChanged={onChanged} />
                  </span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <CursorPagination
          label="archived wallets"
          page={pagination.page}
          hasNext={pagination.hasNext}
          loading={false}
          onPrevious={pagination.previous}
          onNext={pagination.next}
        />
      </div>
    </section>
  )
}

type BalanceCheck =
  | { state: 'checking' }
  | { state: 'done'; balance: RemoteWalletBalance }
  | { state: 'failed' }

/**
 * Restore an archived wallet to ACTIVE. Opening the dialog dials the wallet
 * for its live balance first, so the owner sees whether it is alive — and how
 * much it holds — before bringing it back (optionally as their primary).
 */
function RestoreWallet({
  wallet,
  onChanged
}: {
  wallet: RemoteWalletData
  onChanged: () => void
}) {
  const [open, setOpen] = useState(false)
  const [check, setCheck] = useState<BalanceCheck>({ state: 'checking' })
  const [makePrimary, setMakePrimary] = useState(true)
  const { apiClient } = useAuth()
  const { restoreWallet, loading } = useRemoteWalletMutations()

  useEffect(() => {
    if (!open) return
    let cancelled = false
    apiClient
      .get<RemoteWalletBalance>(`/api/remote-wallets/${wallet.id}/balance`)
      .then(balance => {
        if (!cancelled) setCheck({ state: 'done', balance })
      })
      .catch(() => {
        if (!cancelled) setCheck({ state: 'failed' })
      })
    return () => {
      cancelled = true
    }
  }, [open, wallet.id, apiClient])

  const reachable = check.state === 'done' && check.balance.reachable !== false

  async function handleRestore() {
    try {
      await restoreWallet(wallet.id, makePrimary)
      toast.success(`“${wallet.name}” restored`)
      setOpen(false)
      onChanged()
    } catch (err) {
      const msg =
        err instanceof ApiClientError && err.message
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Couldn’t restore wallet'
      toast.error(msg)
    }
  }

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className="size-8"
        aria-label={`Restore ${wallet.name}`}
        disabled={loading}
        onClick={() => {
          setCheck({ state: 'checking' })
          setOpen(true)
        }}
      >
        <ArchiveRestore className="size-4" />
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restore “{wallet.name}”?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="flex flex-col gap-3">
                <span>
                  The wallet goes back to active and can receive payments
                  again.
                </span>
                <span
                  className="flex items-center gap-2 rounded-md border p-3 text-foreground"
                  aria-live="polite"
                >
                  {check.state === 'checking' ? (
                    <>
                      <Spinner className="size-4" />
                      Checking current balance…
                    </>
                  ) : reachable && check.state === 'done' ? (
                    <>
                      Current balance:{' '}
                      <strong className="tabular-nums">
                        {check.balance.balanceSats.toLocaleString()} sats
                      </strong>
                    </>
                  ) : (
                    <>
                      The wallet didn’t answer. It may really be gone — restore
                      only if you know it still works.
                    </>
                  )}
                </span>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex items-center gap-2">
            <Checkbox
              id={`restore-primary-${wallet.id}`}
              checked={makePrimary}
              onCheckedChange={v => setMakePrimary(v === true)}
            />
            <Label htmlFor={`restore-primary-${wallet.id}`}>
              Use it for my primary Lightning Address
            </Label>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={loading}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={e => {
                e.preventDefault()
                handleRestore()
              }}
              disabled={loading || check.state === 'checking'}
            >
              {loading && <Spinner className="mr-2 size-4" />}
              Restore
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function RemovePermanently({
  wallet,
  onChanged
}: {
  wallet: RemoteWalletData
  onChanged: () => void
}) {
  const [open, setOpen] = useState(false)
  const { permanentlyDeleteWallet, loading } = useRemoteWalletMutations()

  async function handleRemove() {
    try {
      await permanentlyDeleteWallet(wallet.id)
      toast.success(`“${wallet.name}” removed`)
      setOpen(false)
      onChanged()
    } catch (err) {
      const msg =
        err instanceof ApiClientError && err.message
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Couldn’t remove wallet'
      toast.error(msg)
    }
  }

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className="size-8 text-destructive hover:text-destructive"
        aria-label={`Remove ${wallet.name} permanently`}
        disabled={loading}
        onClick={() => setOpen(true)}
      >
        {loading ? (
          <Spinner className="size-4" />
        ) : (
          <Trash2 className="size-4" />
        )}
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Remove “{wallet.name}” permanently?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This deletes the archived wallet and its history for good. This
              can’t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={loading}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={e => {
                e.preventDefault()
                handleRemove()
              }}
              disabled={loading}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {loading && <Spinner className="mr-2 size-4" />}
              Remove permanently
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

/** Listener archive reasons, spelled out. Older rows carry no reason. */
function formatDiedReason(reason: string | null | undefined): string {
  switch (reason) {
    case 'unresponsive':
      return 'Stopped answering'
    case 'idle':
      return 'Idle over 48h'
    case 'warmup_failed':
      return 'Never connected'
    case 'replaced':
      return 'Replaced after a failed invoice'
    default:
      return '—'
  }
}

function formatDateTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

/** Human "Nd Nh Nm" lifespan between birth and death. */
function formatLifespan(fromIso: string, toIso: string): string {
  const from = new Date(fromIso).getTime()
  const to = new Date(toIso).getTime()
  if (Number.isNaN(from) || Number.isNaN(to) || to < from) return '—'
  const totalMinutes = Math.floor((to - from) / 60000)
  const days = Math.floor(totalMinutes / 1440)
  const hours = Math.floor((totalMinutes % 1440) / 60)
  const minutes = totalMinutes % 60
  const parts: string[] = []
  if (days) parts.push(`${days}d`)
  if (hours) parts.push(`${hours}h`)
  if (minutes || !parts.length) parts.push(`${minutes}m`)
  return parts.join(' ')
}
