'use client'

import React, { useState } from 'react'
import Link from 'next/link'
import { Forward, Pencil, ArrowRight } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { useAddressMutations } from '@/lib/client/hooks/use-wallet-addresses'
import { isLightningAddress } from '@/lib/ln-address'

export interface ForwardingCardProps {
  /** Username of the primary lightning address (the LHS of user@domain). */
  username: string
  /** Current configured mode — this card only renders for IDLE / ALIAS. */
  mode: 'IDLE' | 'ALIAS'
  /** Current redirect target when mode is ALIAS; ignored for IDLE. */
  redirect: string | null
  /** Fires after a successful update so the parent can refetch `/api/users/me`. */
  onUpdated?: () => void | Promise<void>
}

/**
 * Dashboard card shown in place of NwcCard when the user's primary
 * lightning address is IDLE or ALIAS — i.e. doesn't route to an NWC
 * wallet, so a live balance / connection widget would be misleading.
 *
 * IDLE: inline input that flips the address to ALIAS with the entered
 * lightning address as redirect. One submit covers both the mode change
 * and the redirect value.
 *
 * ALIAS: read-only display of the current forwarding target with an
 * Edit affordance that jumps to the full address edit page (keeps this
 * card focused on the common cases — actually changing the target
 * belongs on the detail page with the full mode picker).
 */
export function ForwardingCard({
  username,
  mode,
  redirect,
  onUpdated,
}: ForwardingCardProps) {
  const { updateAddress } = useAddressMutations()
  const [input, setInput] = useState('')
  const [saving, setSaving] = useState(false)

  const trimmed = input.trim().toLowerCase()
  const inputInvalid = trimmed.length > 0 && !isLightningAddress(trimmed)
  const canSubmit = !saving && trimmed.length > 0 && !inputInvalid

  async function handleSetForwarding() {
    if (!canSubmit) return
    setSaving(true)
    try {
      await updateAddress(username, {
        mode: 'ALIAS',
        redirect: trimmed,
        // Explicitly clear any previously-linked NWCConnection so the
        // address has a single clear state — pure alias forward.
        nwcConnectionId: null,
      })
      toast.success('Forwarding set')
      setInput('')
      await onUpdated?.()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to set forwarding')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-xl border border-border bg-card p-5 space-y-4">
      <div className="flex items-start gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
          <Forward className="size-5 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold">
            {mode === 'ALIAS' ? 'Forwarding enabled' : 'Forward payments'}
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {mode === 'ALIAS'
              ? 'Incoming payments to your primary address are forwarded to another lightning address.'
              : 'Your primary address is disabled. Enter another lightning address below to forward payments to it.'}
          </p>
        </div>
      </div>

      {mode === 'ALIAS' ? (
        <div className="flex items-center justify-between gap-3 rounded-md bg-muted/40 px-4 py-3">
          <div className="flex items-center gap-2 min-w-0">
            <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
            <span
              className="truncate font-mono text-sm"
              title={redirect ?? ''}
            >
              {redirect || 'Not set'}
            </span>
          </div>
          <Button asChild variant="outline" size="sm">
            <Link href={`/admin/addresses/${encodeURIComponent(username)}`}>
              <Pencil className="size-3.5 mr-1" />
              Edit
            </Link>
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Input
              id="forwarding-target"
              placeholder="someone@example.com"
              value={input}
              disabled={saving}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && canSubmit) handleSetForwarding()
              }}
              className={inputInvalid ? 'border-destructive' : undefined}
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
            />
            <Button
              variant="theme"
              disabled={!canSubmit}
              onClick={handleSetForwarding}
            >
              {saving && <Spinner size={16} className="mr-2" />}
              Forward
            </Button>
          </div>
          {inputInvalid ? (
            <p className="text-xs text-destructive">
              Enter a valid lightning address (user@host).
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              Payments to @{username} will be forwarded to the address you
              enter. You can change it later from the address settings.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
