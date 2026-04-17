'use client'

import React, { useState, useEffect } from 'react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import { useSettings } from '@/lib/client/hooks/use-settings'
import { useAddressMutations } from '@/lib/client/hooks/use-wallet-addresses'

const USERNAME_RE = /^[a-z0-9]+$/

interface NewAddressDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: () => void
}

/**
 * Username chooser for a new lightning address. Validates format inline and
 * checks availability via the existing public `/api/lightning-addresses/check`
 * endpoint with light debouncing so the user gets fast feedback before submit.
 */
export function NewAddressDialog({ open, onOpenChange, onCreated }: NewAddressDialogProps) {
  const { data: settings } = useSettings()
  const { createAddress, creating } = useAddressMutations()
  const [username, setUsername] = useState('')
  const [available, setAvailable] = useState<boolean | null>(null)
  const [checking, setChecking] = useState(false)

  const domain = settings?.domain || 'your-domain'
  const formatError =
    username.length === 0
      ? null
      : username.length > 16
        ? 'Max 16 characters.'
        : !USERNAME_RE.test(username)
          ? 'Lowercase letters and numbers only.'
          : null

  // Debounced availability check. The endpoint is public and cheap; we keep
  // it simple rather than introducing a generic debounce hook.
  useEffect(() => {
    if (!open) return
    if (formatError || !username) {
      setAvailable(null)
      return
    }
    let cancelled = false
    setChecking(true)
    const handle = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/lightning-addresses/check?username=${encodeURIComponent(username)}`,
        )
        const body = (await res.json()) as { available?: boolean }
        if (!cancelled) setAvailable(Boolean(body.available))
      } catch {
        if (!cancelled) setAvailable(null)
      } finally {
        if (!cancelled) setChecking(false)
      }
    }, 300)
    return () => {
      cancelled = true
      clearTimeout(handle)
    }
  }, [username, formatError, open])

  // Reset state when the dialog closes so reopening doesn't show stale info.
  useEffect(() => {
    if (!open) {
      setUsername('')
      setAvailable(null)
      setChecking(false)
    }
  }, [open])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (formatError || !username || available === false) return
    try {
      await createAddress({ username })
      toast.success(`Created ${username}@${domain}`)
      onOpenChange(false)
      onCreated()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create address')
    }
  }

  const submitDisabled =
    creating || checking || !!formatError || username.length === 0 || available === false

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>New address</DialogTitle>
            <DialogDescription>
              Pick a username for your new lightning address. You can change its
              behavior afterwards.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="username">Username</Label>
            <div className="flex items-center rounded-md border border-input bg-background focus-within:ring-2 focus-within:ring-ring">
              <Input
                id="username"
                autoFocus
                value={username}
                onChange={e => setUsername(e.target.value.toLowerCase())}
                placeholder="satoshi"
                maxLength={16}
                className="flex-1 border-0 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
              />
              <span className="px-3 text-sm text-muted-foreground">@{domain}</span>
            </div>
            <p className="min-h-4 text-xs">
              {formatError ? (
                <span className="text-destructive">{formatError}</span>
              ) : checking ? (
                <span className="text-muted-foreground">Checking availability…</span>
              ) : available === false ? (
                <span className="text-destructive">That username is taken.</span>
              ) : available === true ? (
                <span className="text-green-600 dark:text-green-500">Available</span>
              ) : (
                <span className="text-muted-foreground">
                  Lowercase letters and numbers, max 16 characters.
                </span>
              )}
            </p>
          </div>

          {/* Force row layout on all viewports — the default DialogFooter
              stacks as flex-col-reverse on mobile, which pushed Cancel below
              Create. tailwind-merge in cn() lets our `flex-row` win over
              the default `flex-col-reverse`. `space-x-2` replaces the
              default `sm:space-x-2` so the gap exists at every breakpoint. */}
          <DialogFooter className="flex-row justify-end space-x-2">
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="theme" disabled={submitDisabled}>
              {creating && <Spinner size={16} className="mr-2" />}
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
