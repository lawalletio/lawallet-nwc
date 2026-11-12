'use client'

import { useState } from 'react'
import { Mail, MailCheck, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
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
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { useAccount } from '@/lib/client/hooks/use-account'
import { useSettings } from '@/lib/client/hooks/use-settings'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Linked emails on the Account page. Adding one emails a confirmation link;
 * opening it links the email — or, when the email already signs in to
 * another account, lands back here with that account ready to merge.
 */
export function EmailsSection() {
  const { data: settings } = useSettings()
  const {
    emails,
    loading,
    linkEmail,
    unlinkEmail,
    linkingEmail,
    unlinkingEmail
  } = useAccount()
  const [draft, setDraft] = useState('')
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [removeTarget, setRemoveTarget] = useState<string | null>(null)

  if (settings && settings.email_login_enabled !== 'true') {
    return (
      <p className="text-sm text-muted-foreground">
        Email sign-in is turned off for this community.
      </p>
    )
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    const email = draft.trim().toLowerCase()
    if (!EMAIL_PATTERN.test(email)) {
      toast.error('Enter a valid email address')
      return
    }
    try {
      await linkEmail(email)
      setSentTo(email)
      setDraft('')
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Could not send the link'
      )
    }
  }

  async function handleRemove() {
    if (!removeTarget) return
    try {
      await unlinkEmail(removeTarget)
      toast.success('Email removed')
    } catch (err) {
      // 409 when it's the last way in — the server explains why.
      toast.error(err instanceof Error ? err.message : 'Could not remove email')
    } finally {
      setRemoveTarget(null)
    }
  }

  return (
    <div className="space-y-4">
      {loading ? (
        <div className="flex min-h-12 items-center justify-center">
          <Spinner size={24} />
        </div>
      ) : emails.length > 0 ? (
        <div className="flex flex-col rounded-md border">
          {emails.map(({ email, createdAt }) => (
            <div
              key={email}
              className="flex items-center gap-3 border-b px-3 py-2.5 last:border-b-0"
            >
              <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-green-500/10 text-green-400">
                <Mail className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{email}</p>
                <p className="text-xs text-muted-foreground">
                  Added {new Date(createdAt).toLocaleDateString()}
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-8 text-muted-foreground hover:text-destructive"
                aria-label={`Remove ${email}`}
                disabled={unlinkingEmail}
                onClick={() => setRemoveTarget(email)}
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">No emails linked yet.</p>
      )}

      {sentTo ? (
        <div
          role="status"
          className="flex items-start gap-3 rounded-md border border-primary/30 bg-primary/5 p-3"
        >
          <MailCheck className="mt-0.5 size-4 shrink-0 text-primary" />
          <div className="min-w-0 flex-1 text-sm">
            <p className="font-medium">Check {sentTo}</p>
            <p className="text-muted-foreground">
              Open the link to finish. If this email already signs in to another
              account, you&apos;ll be able to merge it into this one.
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setSentTo(null)}
          >
            Done
          </Button>
        </div>
      ) : (
        <form onSubmit={handleAdd} className="flex gap-2">
          <Input
            type="email"
            inputMode="email"
            autoComplete="email"
            placeholder="you@example.com"
            value={draft}
            onChange={e => setDraft(e.target.value)}
            disabled={linkingEmail}
            aria-label="Email to link"
          />
          <Button
            type="submit"
            variant="secondary"
            disabled={linkingEmail || !draft.trim()}
          >
            {linkingEmail ? <Spinner size={16} /> : <Plus className="size-4" />}
            Add email
          </Button>
        </form>
      )}

      <AlertDialog
        open={!!removeTarget}
        onOpenChange={open => {
          if (!open) setRemoveTarget(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this email?</AlertDialogTitle>
            <AlertDialogDescription>
              {removeTarget} will no longer sign you in to this account.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void handleRemove()}>
              {unlinkingEmail ? <Spinner size={16} /> : null}
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
