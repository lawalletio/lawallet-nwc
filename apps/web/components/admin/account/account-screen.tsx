'use client'

import { useState } from 'react'
import {
  Copy,
  KeyRound,
  Link2,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  Star,
  Unlink
} from 'lucide-react'
import { toast } from 'sonner'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import { AdminTopbar } from '@/components/admin/admin-topbar'
import { MergeDialog } from '@/components/admin/account/merge-dialog'
import { PasskeysSection } from '@/components/wallet/settings/passkeys-section'
import { ExportKeyDialog } from '@/components/wallet/settings/export-key-dialog'
import { useAccount } from '@/lib/client/hooks/use-account'
import { useNostrProfile } from '@/lib/client/nostr-profile'
import {
  formatRelativeTime,
  npubInitials,
  toNpub,
  truncateNpub
} from '@/lib/client/format'
import type { NostrIdentitySummary } from '@/lib/validation/schemas'

/**
 * `/admin/account` — the signed-in user's own login methods: linked Nostr
 * identities (primary/rename/unlink), passkeys, the server-custodied secret
 * key (when present), and the link-or-merge flow for absorbing another
 * account. Everything here is per-user; no admin permission is involved.
 */
export function AccountScreen() {
  const {
    identities,
    hasManagedKey,
    loading,
    error,
    refetch,
    setPrimary,
    renameIdentity,
    unlinkIdentity,
    updating,
    unlinking
  } = useAccount()

  const [exportOpen, setExportOpen] = useState(false)
  const [mergeOpen, setMergeOpen] = useState(false)
  const [renameTarget, setRenameTarget] = useState<NostrIdentitySummary | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [unlinkTarget, setUnlinkTarget] = useState<NostrIdentitySummary | null>(null)

  async function handleMakePrimary(identity: NostrIdentitySummary) {
    try {
      await setPrimary(identity.pubkey)
      toast.success('Primary identity updated')
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Could not update primary identity'
      )
    }
  }

  async function handleRename() {
    if (!renameTarget) return
    try {
      await renameIdentity(renameTarget.pubkey, renameValue.trim() || null)
      toast.success('Identity renamed')
      setRenameTarget(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Rename failed')
    }
  }

  async function handleUnlink() {
    if (!unlinkTarget) return
    try {
      await unlinkIdentity(unlinkTarget.pubkey)
      toast.success('Identity unlinked')
    } catch (err) {
      // The server rejects unlinking the primary or the last identity (409)
      // with an explanatory message — surface it instead of a generic error.
      toast.error(err instanceof Error ? err.message : 'Unlink failed')
    } finally {
      setUnlinkTarget(null)
    }
  }

  return (
    <div className="flex flex-col">
      <AdminTopbar
        title="Account Settings"
        subtitle="The identities and login methods that open this account"
      />

      <div className="flex w-full max-w-3xl flex-col gap-6 px-4 py-6 sm:px-6">
        {error ? (
          <Alert variant="destructive">
            <AlertTitle>Couldn&apos;t load your account</AlertTitle>
            <AlertDescription className="flex flex-col items-start gap-3">
              <span>{error.message}</span>
              <Button type="button" variant="outline" size="sm" onClick={() => void refetch()}>
                <RefreshCw className="size-3.5" />
                Retry
              </Button>
            </AlertDescription>
          </Alert>
        ) : (
          <>
            {/* ── Nostr identities ─────────────────────────────────────── */}
            <Card>
              <CardHeader>
                <CardTitle>Nostr identities</CardTitle>
                <CardDescription>
                  Public keys linked to this account. Any of them can sign you
                  in; the primary one is how the platform presents you.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <div className="flex min-h-20 items-center justify-center">
                    <Spinner size={24} />
                  </div>
                ) : (
                  <div className="flex flex-col rounded-md border">
                    {identities.map(identity => (
                      <IdentityRow
                        key={identity.pubkey}
                        identity={identity}
                        busy={updating || unlinking}
                        onMakePrimary={() => void handleMakePrimary(identity)}
                        onRename={() => {
                          setRenameTarget(identity)
                          setRenameValue(identity.label ?? '')
                        }}
                        onUnlink={() => setUnlinkTarget(identity)}
                      />
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* ── Passkeys ─────────────────────────────────────────────── */}
            <Card>
              <CardHeader>
                <CardTitle>Passkeys</CardTitle>
                <CardDescription>
                  Sign in with Face ID, Touch ID, or your device screen lock —
                  no keys to paste.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <PasskeysSection onExportRequest={() => setExportOpen(true)} />
              </CardContent>
            </Card>

            {/* ── Secret key (managed accounts only) ───────────────────── */}
            {hasManagedKey && (
              <Card>
                <CardHeader>
                  <CardTitle>Secret key</CardTitle>
                  <CardDescription>
                    Your Nostr secret key is held for you on this server,
                    unlocked only by your passkeys.
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
                  <p className="text-sm text-muted-foreground">
                    Export it to take self-custody or to use this identity in
                    other Nostr apps.
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setExportOpen(true)}
                  >
                    <KeyRound className="size-4" />
                    Export secret key
                  </Button>
                </CardContent>
              </Card>
            )}

            {/* ── Link / merge another account ─────────────────────────── */}
            <Card>
              <CardHeader>
                <CardTitle>Link another account</CardTitle>
                <CardDescription>
                  Merge another Nostr account or key into this one — prove you
                  control it by signing or with its passkey.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button type="button" variant="secondary" onClick={() => setMergeOpen(true)}>
                  <Link2 className="size-4" />
                  Link / merge account
                </Button>
              </CardContent>
            </Card>
          </>
        )}
      </div>

      <ExportKeyDialog open={exportOpen} onOpenChange={setExportOpen} />
      <MergeDialog open={mergeOpen} onOpenChange={setMergeOpen} />

      {/* Rename dialog */}
      <Dialog
        open={!!renameTarget}
        onOpenChange={open => {
          if (!open) setRenameTarget(null)
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Rename identity</DialogTitle>
            <DialogDescription className="font-mono text-xs">
              {renameTarget ? truncateNpub(renameTarget.pubkey) : ''}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="identity-label">Label</Label>
            <Input
              id="identity-label"
              value={renameValue}
              onChange={e => setRenameValue(e.target.value)}
              placeholder="e.g. Work key"
              maxLength={64}
            />
            <p className="text-xs text-muted-foreground">
              Leave empty to remove the label.
            </p>
          </div>
          <DialogFooter>
            <Button
              type="button"
              className="w-full"
              onClick={() => void handleRename()}
              disabled={updating}
            >
              {updating ? <Spinner size={16} /> : null}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Unlink confirmation */}
      <AlertDialog
        open={!!unlinkTarget}
        onOpenChange={open => {
          if (!open) setUnlinkTarget(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unlink this identity?</AlertDialogTitle>
            <AlertDialogDescription>
              {unlinkTarget ? `${truncateNpub(unlinkTarget.pubkey)} — ` : ''}
              you will no longer be able to sign in to this account with this
              key. The key itself is untouched.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void handleUnlink()}>
              {unlinking ? <Spinner size={16} /> : null}
              Unlink
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function IdentityRow({
  identity,
  busy,
  onMakePrimary,
  onRename,
  onUnlink
}: {
  identity: NostrIdentitySummary
  busy: boolean
  onMakePrimary: () => void
  onRename: () => void
  onUnlink: () => void
}) {
  const { profile } = useNostrProfile(identity.pubkey)

  function handleCopy() {
    navigator.clipboard.writeText(toNpub(identity.pubkey))
    toast.success('npub copied to clipboard')
  }

  return (
    <div className="flex items-center justify-between gap-3 border-b border-border/40 px-4 py-3 last:border-b-0">
      <div className="flex min-w-0 items-center gap-3">
        <Avatar className="size-9 shrink-0">
          {profile?.picture ? (
            <AvatarImage src={profile.picture} alt="" />
          ) : null}
          <AvatarFallback>{npubInitials(identity.pubkey)}</AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleCopy}
              title="Copy npub"
              className="group flex min-w-0 items-center gap-1.5 text-left font-mono text-sm text-foreground hover:text-primary"
            >
              <span className="truncate">{truncateNpub(identity.pubkey)}</span>
              <Copy className="size-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
            </button>
            {identity.isPrimary && <Badge>Primary</Badge>}
          </div>
          <p className="truncate text-xs text-muted-foreground">
            {identity.label ? `${identity.label} · ` : ''}
            Linked {formatRelativeTime(identity.createdAt)}
          </p>
        </div>
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            disabled={busy}
            aria-label="Identity actions"
          >
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {!identity.isPrimary && (
            <DropdownMenuItem onClick={onMakePrimary}>
              <Star className="size-4" />
              Make primary
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onClick={onRename}>
            <Pencil className="size-4" />
            Rename
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={onUnlink}
            className="text-destructive focus:text-destructive"
          >
            <Unlink className="size-4" />
            Unlink
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
