'use client'

import React, { useState } from 'react'
import { Ban, CircleCheck, MoreHorizontal, Pencil, Star, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
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
 * Actions, gated on the wallet's current state:
 *  - **Use for primary address** — PATCH `isDefault: true`. This binds the
 *    account primary Lightning Address to the wallet, then the server
 *    synchronizes the display flag from that binding. Hidden when the wallet
 *    already carries the synchronized primary marker and when status ≠ ACTIVE.
 *  - **Rename** — opens a small dialog; PATCH `name`. Available for
 *    any non-revoked wallet.
 *  - **Disable / Enable** — PATCH `status`. Toggles ACTIVE ⇄ DISABLED.
 *    A disabled wallet stays in the list (re-enableable) but shouldn't
 *    be picked for new routes. Not shown for REVOKED (terminal).
 *  - **Delete** — DELETE → soft delete (status flips to REVOKED).
 *    Always behind an `AlertDialog` confirmation because the wallet
 *    may be wired up to lightning addresses or cards via
 *    `Card.remoteWalletId` / `LightningAddress.remoteWalletId`, and
 *    revoking it leaves those resources unconfigured or routed through the
 *    primary-address wallet when they are implicit bindings
 *    (or unconfigured, if none).
 */
export function RemoteWalletRowActions({ wallet, onChanged }: RemoteWalletRowActionsProps) {
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [renameOpen, setRenameOpen] = useState(false)
  const [renameValue, setRenameValue] = useState(wallet.name)
  const { setPrimary, renameWallet, setStatus, deleteWallet, loading } =
    useRemoteWalletMutations()

  const isRevoked = wallet.status === 'REVOKED'
  const canSetPrimary = !wallet.isDefault && wallet.status === 'ACTIVE'

  const trimmedRename = renameValue.trim()
  const canRename =
    !loading &&
    trimmedRename.length > 0 &&
    trimmedRename.length <= 120 &&
    trimmedRename !== wallet.name

  async function handleSetPrimary() {
    try {
      await setPrimary(wallet.id)
      toast.success(`Primary address now uses “${wallet.name}”`)
      onChanged?.()
    } catch (err) {
      toast.error(messageFor(err, 'Couldn’t use wallet for primary address'))
    }
  }

  async function handleRename(e: React.FormEvent) {
    e.preventDefault()
    if (!canRename) return
    try {
      await renameWallet(wallet.id, trimmedRename)
      toast.success('Wallet renamed')
      setRenameOpen(false)
      onChanged?.()
    } catch (err) {
      toast.error(messageFor(err, 'Couldn’t rename wallet'))
    }
  }

  async function handleToggleStatus() {
    const next = wallet.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE'
    try {
      await setStatus(wallet.id, next)
      toast.success(next === 'DISABLED' ? `“${wallet.name}” disabled` : `“${wallet.name}” enabled`)
      onChanged?.()
    } catch (err) {
      toast.error(messageFor(err, 'Couldn’t update wallet'))
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
              Use for primary address
            </DropdownMenuItem>
          )}
          {!isRevoked && (
            <DropdownMenuItem
              onSelect={() => {
                setRenameValue(wallet.name)
                setRenameOpen(true)
              }}
            >
              <Pencil className="mr-2 size-4" />
              Rename…
            </DropdownMenuItem>
          )}
          {!isRevoked && (
            <DropdownMenuItem onSelect={handleToggleStatus}>
              {wallet.status === 'ACTIVE' ? (
                <>
                  <Ban className="mr-2 size-4" />
                  Disable
                </>
              ) : (
                <>
                  <CircleCheck className="mr-2 size-4" />
                  Enable
                </>
              )}
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => setConfirmOpen(true)}
            className="text-destructive focus:text-destructive"
          >
            <Trash2 className="mr-2 size-4" />
            Delete…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Rename wallet</DialogTitle>
            <DialogDescription>
              Give this wallet a name that’s easy to recognise in pickers and
              the connection map.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleRename} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor={`rename-${wallet.id}`}>Name</Label>
              <Input
                id={`rename-${wallet.id}`}
                value={renameValue}
                onChange={e => setRenameValue(e.target.value)}
                maxLength={120}
                autoFocus
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setRenameOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={!canRename} className="gap-2">
                {loading && <Spinner className="size-4" />}
                Save
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

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
