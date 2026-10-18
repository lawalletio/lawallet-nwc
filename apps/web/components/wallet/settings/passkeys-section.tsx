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
import { truncateNpub } from '@/lib/client/format'
import { useLocale, useT } from '@/lib/client/i18n'

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 31_536_000],
  ['month', 2_592_000],
  ['day', 86_400],
  ['hour', 3_600],
  ['minute', 60]
]

function relativeTime(iso: string, locale: string) {
  const rtf = new Intl.RelativeTimeFormat(locale, {
    numeric: 'auto',
    style: 'short'
  })
  const sec = (new Date(iso).getTime() - Date.now()) / 1000
  const [unit, size] = UNITS.find(([, s]) => Math.abs(sec) >= s) ?? [
    'second',
    1
  ]
  return rtf.format(Math.round(sec / size), unit)
}

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
  const t = useT()
  const p = t.settings.passkeysScreen
  const locale = useLocale()
  const credentialName = (credential: PasskeyCredentialSummary) =>
    credential.label ||
    p.untitled(new Date(credential.createdAt).toLocaleDateString(locale))

  const [supported] = useState(() => isPasskeySupported())
  const [selected, setSelected] = useState<PasskeyCredentialSummary | null>(
    null
  )
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
      toast.success(p.added)
    } catch (err) {
      const error = err as { kind?: string; message?: string }
      if (error.kind === 'duplicate' && onDuplicatePasskey) {
        onDuplicatePasskey()
      } else if (error.kind !== 'cancelled') {
        toast.error(error.message || p.addFailed)
      }
    }
  }

  async function handleRename() {
    if (!selected) return
    try {
      await renameCredential(selected.id, label.trim())
      toast.success(p.renamed)
      setSelected(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : p.renameFailed)
    }
  }

  async function handleDelete() {
    if (!selected) return
    try {
      await deleteCredential(selected.id)
      toast.success(p.deleted)
      setConfirmingDelete(false)
      setSelected(null)
    } catch (err) {
      setConfirmingDelete(false)
      const message = err instanceof Error ? err.message : p.deleteFailed
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
            {p.empty}
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
                    ? p.lastUsed(relativeTime(credential.lastUsedAt, locale))
                    : p.addedAgo(relativeTime(credential.createdAt, locale))}
                </p>
                {credential.pubkey && (
                  <p className="truncate font-mono text-[11px] text-muted-foreground/80">
                    {truncateNpub(credential.pubkey)}
                  </p>
                )}
              </div>
            </div>
            {credential.deviceType === 'multiDevice' && credential.backedUp && (
              <Badge variant="secondary">{p.synced}</Badge>
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
          {adding ? p.waiting : p.add}
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
            <DialogTitle>{p.manage}</DialogTitle>
            <DialogDescription>
              {selected ? credentialName(selected) : ''}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="passkey-label">{p.name}</Label>
              <Input
                id="passkey-label"
                value={label}
                onChange={e => setLabel(e.target.value)}
                placeholder={p.namePlaceholder}
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
              {p.saveName}
            </Button>
            <Button
              type="button"
              variant="destructive"
              className="w-full"
              onClick={() => setConfirmingDelete(true)}
              disabled={deleting}
            >
              <Trash2 className="size-4" />
              {p.delete}
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
              {isLastCredential ? p.deleteOnlyTitle : p.deleteTitle}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {isLastCredential ? p.deleteOnlyBody : p.deleteBody}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t.common.cancel}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void handleDelete()}>
              {deleting ? <Spinner size={16} /> : null}
              {p.deleteConfirm}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
