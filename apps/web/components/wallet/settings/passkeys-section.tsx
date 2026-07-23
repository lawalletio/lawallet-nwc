'use client'

import { useState } from 'react'
import { Fingerprint, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
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
import { usePasskeys } from '@/lib/client/hooks/use-passkeys'
import {
  isPasskeySupported,
  type PasskeyCredentialSummary
} from '@/lib/client/passkey-api'
import { formatRelativeTime, truncateNpub } from '@/lib/client/format'

/**
 * Passkey management for the wallet security screen: list, rename, delete,
 * and add credentials. "Add a passkey" doubles as the link flow for
 * nsec/extension/bunker users. Deleting the last passkey of a managed
 * account whose key was never exported is rejected server-side (409) — the
 * dialog surfaces that with an export hint instead of a dead-end error.
 *
 * `onDuplicatePasskey` (optional) intercepts the "this passkey already
 * belongs to another account" failure so callers can offer an account
 * merge instead of a dead-end toast (the Account Settings page does).
 */
export function PasskeysSection({
  onDuplicatePasskey
}: {
  onDuplicatePasskey?: () => void
} = {}) {
  const {
    credentials,
    loading,
    addPasskey,
    renameCredential,
    deleteCredential,
    adding,
    renaming,
    deleting
  } = usePasskeys()

  const [supported] = useState(() => isPasskeySupported())
  const [selected, setSelected] = useState<PasskeyCredentialSummary | null>(null)
  const [label, setLabel] = useState('')
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const isLastCredential = credentials.length === 1
  // Only block the last-passkey delete while the custodied key has NOT been
  // exported yet — once exported, the user provably holds the key and the
  // server allows the delete, so the UI must too (otherwise export→delete
  // dead-ends).

  function openCredential(credential: PasskeyCredentialSummary) {
    setSelected(credential)
    setLabel(credential.label ?? '')
  }

  async function handleAdd() {
    try {
      await addPasskey()
      toast.success('Passkey added')
    } catch (err) {
      const error = err as { kind?: string; message?: string }
      if (error.kind === 'duplicate' && onDuplicatePasskey) {
        onDuplicatePasskey()
      } else if (error.kind !== 'cancelled') {
        toast.error(error.message || 'Could not add passkey')
      }
    }
  }

  async function handleRename() {
    if (!selected) return
    try {
      await renameCredential(selected.id, label.trim())
      toast.success('Passkey renamed')
      setSelected(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Rename failed')
    }
  }

  async function handleDelete() {
    if (!selected) return
    try {
      await deleteCredential(selected.id)
      toast.success('Passkey deleted')
      setConfirmingDelete(false)
      setSelected(null)
    } catch (err) {
      setConfirmingDelete(false)
      const message = err instanceof Error ? err.message : 'Delete failed'
      toast.error(message)
    }
  }

  return (
    <>
      <div className="flex flex-col rounded-2xl bg-card">
        {loading && credentials.length === 0 && (
          <div className="flex min-h-14 items-center justify-center">
            <Spinner size={16} />
          </div>
        )}

        {!loading && credentials.length === 0 && (
          <p className="px-4 py-4 text-sm text-muted-foreground">
            No passkeys yet. Add one to sign in with Face ID, Touch ID, or
            your device screen lock — no keys to paste.
          </p>
        )}

        {credentials.map(credential => (
          <button
            key={credential.id}
            type="button"
            onClick={() => openCredential(credential)}
            className="flex min-h-14 w-full items-center justify-between gap-3 border-b border-border/40 px-4 text-left transition-colors hover:bg-accent/40 active:bg-accent/60 last:border-b-0"
          >
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-background text-muted-foreground">
                <Fingerprint className="size-5" />
              </span>
              <div className="min-w-0">
                <p className="truncate text-base font-medium text-foreground">
                  {credentialName(credential)}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {credential.lastUsedAt
                    ? `Last used ${formatRelativeTime(credential.lastUsedAt)}`
                    : `Added ${formatRelativeTime(credential.createdAt)}`}
                </p>
                {credential.pubkey && (
                  <p className="truncate font-mono text-[11px] text-muted-foreground/80">
                    {truncateNpub(credential.pubkey)}
                  </p>
                )}
              </div>
            </div>
            {credential.deviceType === 'multiDevice' && credential.backedUp && (
              <Badge variant="secondary">Synced</Badge>
            )}
          </button>
        ))}
      </div>

      {supported && (
        <Button
          type="button"
          variant="secondary"
          className="h-12 w-full"
          onClick={() => void handleAdd()}
          disabled={adding}
        >
          {adding ? <Spinner size={16} /> : <Plus data-icon="inline-start" />}
          {adding ? 'Waiting for your device…' : 'Add a passkey'}
        </Button>
      )}

      {/* Rename / delete dialog for the tapped credential */}
      <Dialog
        open={!!selected && !confirmingDelete}
        onOpenChange={open => {
          if (!open) setSelected(null)
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Manage passkey</DialogTitle>
            <DialogDescription>
              {selected ? credentialName(selected) : ''}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="passkey-label">Name</Label>
              <Input
                id="passkey-label"
                value={label}
                onChange={e => setLabel(e.target.value)}
                placeholder="e.g. MacBook Touch ID"
                maxLength={64}
              />
            </div>
            <Button
              type="button"
              className="w-full"
              onClick={() => void handleRename()}
              disabled={renaming || !label.trim()}
            >
              {renaming ? <Spinner size={16} /> : null}
              Save name
            </Button>
            <Button
              type="button"
              variant="destructive"
              className="w-full"
              onClick={() => setConfirmingDelete(true)}
              disabled={deleting}
            >
              <Trash2 className="size-4" />
              Delete passkey
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation, escalated for the last credential */}
      <AlertDialog
        open={confirmingDelete}
        onOpenChange={open => {
          if (!open) setConfirmingDelete(false)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {isLastCredential ? 'Delete your only passkey?' : 'Delete this passkey?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {isLastCredential
                ? 'This is your only passkey. Its key stays derivable from the passkey itself, but make sure you can still sign in another way before removing it here.'
                : 'You can no longer sign in with this passkey after deleting it. The identity it derives stays linked to your account.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void handleDelete()}>
              {deleting ? <Spinner size={16} /> : null}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function credentialName(credential: PasskeyCredentialSummary) {
  if (credential.label) return credential.label
  const created = new Date(credential.createdAt)
  return `Passkey · ${created.toLocaleDateString()}`
}
