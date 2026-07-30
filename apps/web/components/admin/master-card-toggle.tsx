'use client'

import { useState } from 'react'
import Link from 'next/link'
import { KeyRound, MoreHorizontal } from 'lucide-react'
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Spinner } from '@/components/ui/spinner'
import { Switch } from '@/components/ui/switch'
import { truncateHex } from '@/lib/client/format'
import type { CardData, CardKind } from '@/lib/client/hooks/use-cards'

/**
 * Why a card can't be designated, or null when it can. The designation is
 * per-holder, so it needs a holder; a blocked card is decommissioned and its
 * server route rejects the change, so don't offer it either.
 */
export function masterCardIneligibleReason(card: CardData): string | null {
  if (card.blocked) return 'Blocked cards cannot be the master card'
  if (!card.lightningAddress) {
    return 'Pair this card to a user before making it the master card'
  }
  return null
}

interface UseMasterCardSwitchOptions {
  card: CardData
  onSetKind: (kind: CardKind) => Promise<unknown>
  /** Optimistically flip a local control while the request is in flight. */
  optimistic?: boolean
}

/**
 * Shared state machine behind both master-card affordances — the detail-page
 * switch and the list-row menu item.
 *
 * Promoting when the holder already has a *different* master opens a confirm
 * dialog first. The server would happily switch (it demotes the old card in a
 * transaction), but silently moving someone's account-recovery card is not a
 * thing to do without asking. Demoting needs no prompt: it takes the
 * designation away without touching another card.
 */
function useMasterCardSwitch({
  card,
  onSetKind,
  optimistic
}: UseMasterCardSwitchOptions) {
  const [pending, setPending] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [override, setOverride] = useState<boolean | null>(null)

  // Hold an optimistic flip until the refetch actually lands, then release it
  // — clearing on mutation-success instead would leave a frame where the
  // override is gone but the cached list still holds the pre-switch value.
  // This also picks up a demotion caused by acting on a *different* row, which
  // arrives over SSE (`cards:updated`).
  const serverIsMaster = card.kind === 'MASTER'
  const [lastServerValue, setLastServerValue] = useState(serverIsMaster)
  if (serverIsMaster !== lastServerValue) {
    setLastServerValue(serverIsMaster)
    setOverride(null)
  }

  const isMaster = override ?? serverIsMaster
  const reason = masterCardIneligibleReason(card)
  const displacedCardId =
    card.masterCardId && card.masterCardId !== card.id
      ? card.masterCardId
      : null

  async function apply(next: boolean) {
    if (optimistic) setOverride(next)
    setPending(true)
    try {
      await onSetKind(next ? 'MASTER' : 'SIMPLE')
      toast.success(
        next ? 'Master card updated' : 'This card is no longer the master card'
      )
    } catch (err) {
      setOverride(null)
      toast.error(
        err instanceof Error ? err.message : 'Failed to update the master card'
      )
    } finally {
      setPending(false)
    }
  }

  return {
    isMaster,
    reason,
    pending,
    displacedCardId,
    confirmOpen,
    setConfirmOpen,
    /** Entry point for both affordances — prompts only when it must. */
    request(next: boolean) {
      if (next && displacedCardId) {
        setConfirmOpen(true)
        return
      }
      void apply(next)
    },
    confirm: () => void apply(true).then(() => setConfirmOpen(false))
  }
}

type SwitchState = ReturnType<typeof useMasterCardSwitch>

/** The "you're about to move someone's recovery card" prompt. */
function SwitchConfirmDialog({ state }: { state: SwitchState }) {
  return (
    <AlertDialog open={state.confirmOpen} onOpenChange={state.setConfirmOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Switch master card?</AlertDialogTitle>
          <AlertDialogDescription>
            {state.displacedCardId
              ? truncateHex(state.displacedCardId)
              : 'Another card'}{' '}
            is currently this user&apos;s master card. Making this card the
            master takes that designation away from it — only one card per user
            can recover the account.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={state.pending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            // Close only once the round-trip settles, so the dialog can show
            // the pending state instead of flashing shut on a slow request.
            onClick={event => {
              event.preventDefault()
              state.confirm()
            }}
            disabled={state.pending}
          >
            {state.pending && <Spinner size={16} className="mr-2" />}
            Switch master card
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/**
 * Read-only marker for the list's Master column. The column reports state; the
 * change itself lives in the row's action menu, so there's nothing to click
 * here and nothing to keep in sync beyond `card.kind`.
 */
export function MasterCardIcon() {
  return (
    <span title="Master card — can recover this user's account">
      <KeyRound
        className="size-4 text-primary"
        role="img"
        aria-label="Master card"
      />
    </span>
  )
}

interface CardRowActionsProps {
  card: CardData
  /** Show the detail link — the detail page needs CARDS_READ. */
  canViewDetails: boolean
  /** Show the master-card action at all (permission gate). */
  canSetMaster: boolean
  onSetKind: (kind: CardKind) => Promise<unknown>
}

/**
 * The action menu for a row in the cards table.
 *
 * A component rather than inline JSX because it owns hook state, and rows are
 * produced in a `.map()` where hooks can't be called. The confirm dialog is a
 * *sibling* of the dropdown, not a child: Radix unmounts menu content on
 * select, which would tear a nested dialog down before it could open.
 */
export function CardRowActions({
  card,
  canViewDetails,
  canSetMaster,
  onSetKind
}: CardRowActionsProps) {
  const state = useMasterCardSwitch({ card, onSetKind })

  if (!canViewDetails && !canSetMaster) return null

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="size-8">
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {canViewDetails && (
            <DropdownMenuItem asChild>
              <Link href={`/admin/cards/${card.id}`}>View Details</Link>
            </DropdownMenuItem>
          )}
          {canSetMaster && (
            <DropdownMenuItem
              disabled={state.pending || state.reason !== null}
              title={state.reason ?? undefined}
              // `onSelect`, not `onClick` — Radix closes the menu afterwards
              // and the dialog lives outside it, so it survives that unmount.
              onSelect={() => state.request(!state.isMaster)}
            >
              <KeyRound className="mr-2 size-4" />
              {state.isMaster ? 'Remove Master' : 'Set to Master'}
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <SwitchConfirmDialog state={state} />
    </>
  )
}

interface MasterCardToggleProps {
  card: CardData
  /** Persists the new designation. Rejects → the optimistic flip reverts. */
  onSetKind: (kind: CardKind) => Promise<unknown>
  /** Extra gate on top of the paired/blocked rules (e.g. missing permission). */
  disabled?: boolean
}

/**
 * Switch form of the same action, for the card detail page where it reads as a
 * setting rather than a row action. Optimistic, mirroring `SettingSwitch`
 * (components/admin/settings/auto-save-controls.tsx).
 */
export function MasterCardToggle({
  card,
  onSetKind,
  disabled
}: MasterCardToggleProps) {
  const state = useMasterCardSwitch({ card, onSetKind, optimistic: true })

  return (
    <span className="inline-flex items-center gap-2">
      {state.pending && <Spinner size={16} className="text-muted-foreground" />}
      <Switch
        checked={state.isMaster}
        disabled={disabled || state.pending || state.reason !== null}
        onCheckedChange={state.request}
        aria-label={
          state.isMaster
            ? 'Remove the master card designation'
            : 'Make this the master card'
        }
        title={state.reason ?? undefined}
      />
      <SwitchConfirmDialog state={state} />
    </span>
  )
}
