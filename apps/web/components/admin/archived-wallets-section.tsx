'use client'

import React, { useState } from 'react'
import { Skull, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Spinner } from '@/components/ui/spinner'
import {
  useRemoteWalletMutations,
  type RemoteWalletData,
} from '@/lib/client/hooks/use-remote-wallets'
import { ApiClientError } from '@/lib/client/api-client'

/**
 * The "graveyard" for disposable LNCurl wallets that ran out of sats and were
 * destroyed by the provider (status `DEAD`). They're read-only tombstones:
 * they can't receive or be assigned to anything, and exist only so the user
 * can see how long each one lived before permanently removing it.
 *
 * Fetched separately from the live list (the API hides DEAD by default), so
 * the section only renders when there's at least one archived wallet.
 */
export function ArchivedWalletsSection({
  wallets,
  onChanged,
}: {
  wallets: RemoteWalletData[]
  onChanged: () => void
}) {
  if (!wallets.length) return null

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Skull className="size-4 text-muted-foreground" />
        <h2 className="text-lg font-semibold">Archived wallets</h2>
      </div>
      <p className="text-sm text-muted-foreground">
        Disposable LNCurl wallets that ran out of sats and were destroyed. They
        can’t receive payments or be assigned to anything — they’re kept only so
        you can see how long they lived. Remove them permanently when you’re
        done.
      </p>
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Born</TableHead>
              <TableHead>Died</TableHead>
              <TableHead>Lifespan</TableHead>
              <TableHead className="w-0 text-right">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {wallets.map(w => (
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
                <TableCell className="tabular-nums">
                  {w.diedAt ? formatLifespan(w.createdAt, w.diedAt) : '—'}
                </TableCell>
                <TableCell className="text-right">
                  <RemovePermanently wallet={w} onChanged={onChanged} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </section>
  )
}

function RemovePermanently({
  wallet,
  onChanged,
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
        {loading ? <Spinner className="size-4" /> : <Trash2 className="size-4" />}
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove “{wallet.name}” permanently?</AlertDialogTitle>
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

function formatDateTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
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
