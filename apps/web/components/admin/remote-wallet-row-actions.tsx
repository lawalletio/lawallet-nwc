'use client'

import React, { useState } from 'react'
import { MoreHorizontal, Star, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
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

interface RemoteWalletRowActionsProps {
  wallet: RemoteWalletData
  /** Called after a successful action so the list can refetch. */
  onChanged?: () => void
}

/**
 * Per-row actions menu for the Remote Wallets table.
 *
 * Two actions today, kept deliberately narrow:
 *  - **Set as Primary** — PATCH `isDefault: true`. Hidden when the
 *    wallet is already the default (no point offering a no-op) and
 *    when the wallet is REVOKED (can't promote a dead wallet).
 *  - **Delete** — DELETE → soft delete (status flips to REVOKED).
 *    Always behind an `AlertDialog` confirmation because the wallet
 *    may be wired up to lightning addresses or cards via
 *    `Card.remoteWalletId` / `LightningAddress.remoteWalletId`, and
 *    revoking it routes those resources back to the default wallet
 *    (or unconfigured, if none).
 *
 * Rename / disable / re-enable aren't here yet — they need an inline
 * edit dialog, which lands in a follow-up.
 */
export function RemoteWalletRowActions({ wallet, onChanged }: RemoteWalletRowActionsProps) {
  const [confirmOpen, setConfirmOpen] = useState(false)
  const { setPrimary, deleteWallet, loading } = useRemoteWalletMutations()

  const canSetPrimary = !wallet.isDefault && wallet.status === 'ACTIVE'

  async function handleSetPrimary() {
    try {
      await setPrimary(wallet.id)
      toast.success(`“${wallet.name}” is now your primary wallet`)
      onChanged?.()
    } catch (err) {
      toast.error(messageFor(err, 'Couldn’t set wallet as primary'))
    }
  }

  async function handleDelete() {
    try {
      await deleteWallet(wallet.id)
      toast.success(`“${wallet.name}” deleted`)
      setConfirmOpen(false)
      onChanged?.()
    } catch (err) {
      toast.error(messageFor(err, 'Couldn’t delete wallet'))
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            aria-label={`Actions for ${wallet.name}`}
            disabled={loading}
          >
            {loading ? <Spinner className="size-4" /> : <MoreHorizontal className="size-4" />}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          {canSetPrimary && (
            <DropdownMenuItem onSelect={handleSetPrimary}>
              <Star className="mr-2 size-4" />
              Set as Primary
            </DropdownMenuItem>
          )}
          {canSetPrimary && <DropdownMenuSeparator />}
          <DropdownMenuItem
            onSelect={() => setConfirmOpen(true)}
            className="text-destructive focus:text-destructive"
          >
            <Trash2 className="mr-2 size-4" />
            Delete…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{wallet.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              The wallet is soft-deleted: it disappears from this list and any
              Lightning addresses or Cards bound to it will fall back to your
              primary wallet (or become unconfigured if you have none). The
              underlying record is kept for audit and cannot be re-enabled.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={loading}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={e => {
                // Prevent the default close-on-click so we control it
                // ourselves after the network round-trip resolves.
                e.preventDefault()
                handleDelete()
              }}
              disabled={loading}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {loading && <Spinner className="mr-2 size-4" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

/**
 * Lift the most useful message off an `ApiClientError` (status-aware) and
 * fall back to a generic line otherwise. Centralised here so both action
 * handlers share the same error vocabulary.
 */
function messageFor(err: unknown, fallback: string): string {
  if (err instanceof ApiClientError) {
    if (err.status === 404) return 'Wallet not found'
    if (err.status === 409) return err.message
    if (err.message) return err.message
  }
  if (err instanceof Error && err.message) return err.message
  return fallback
}
