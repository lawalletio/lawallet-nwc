'use client'

import React, { useEffect, useMemo, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ChevronLeft, CreditCard, Link2, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { NavTabbar } from '@/components/wallet/shared/nav-tabbar'
import {
  useMyCardMutations,
  useMyCards,
  type CardData
} from '@/lib/client/hooks/use-cards'
import { cn } from '@/lib/utils'

type CardStatus = 'Active' | 'Disabled' | 'Blocked'

const STATUS_BADGE_WIDTH: Record<CardStatus, string> = {
  Active: '5rem',
  Disabled: '6.25rem',
  Blocked: '5.5rem'
}

export function CardsScreen() {
  const router = useRouter()
  const { data: cards, loading, error, refetch } = useMyCards()
  const { linkCardToDefaultWallet, setCardEnabled } = useMyCardMutations()
  const [pending, setPending] = useState<Set<string>>(() => new Set())
  const [linkPending, setLinkPending] = useState<Set<string>>(() => new Set())
  const [enabledOverrides, setEnabledOverrides] = useState<
    Record<string, boolean | undefined>
  >({})
  const [linkedOverrides, setLinkedOverrides] = useState<
    Record<string, boolean | undefined>
  >({})

  const sortedCards = useMemo(
    () =>
      [...(cards ?? [])].sort((a, b) => {
        if (a.blocked !== b.blocked) return a.blocked ? 1 : -1
        if (a.disabled !== b.disabled) return a.disabled ? 1 : -1
        return cardName(a).localeCompare(cardName(b))
      }),
    [cards]
  )

  useEffect(() => {
    if (!cards) return

    setEnabledOverrides(prev => {
      let changed = false
      const next = { ...prev }

      for (const [id, enabled] of Object.entries(prev)) {
        if (enabled === undefined) continue

        const card = cards.find(item => item.id === id)
        const serverEnabled = card ? !card.disabled && !card.blocked : null

        if (serverEnabled === enabled) {
          next[id] = undefined
          changed = true
        }
      }

      return changed ? next : prev
    })

    setLinkedOverrides(prev => {
      let changed = false
      const next = { ...prev }

      for (const [id, linked] of Object.entries(prev)) {
        if (linked === undefined) continue

        const card = cards.find(item => item.id === id)
        const serverLinked =
          Boolean(card?.defaultRemoteWalletId) &&
          card?.remoteWalletId === card?.defaultRemoteWalletId

        if (serverLinked === linked) {
          next[id] = undefined
          changed = true
        }
      }

      return changed ? next : prev
    })
  }, [cards])

  async function handleToggle(card: CardData, enabled: boolean) {
    setPending(prev => new Set(prev).add(card.id))
    setEnabledOverrides(prev => ({ ...prev, [card.id]: enabled }))

    try {
      await setCardEnabled(card.id, enabled)
      toast.success(`${cardName(card)} ${enabled ? 'enabled' : 'disabled'}`)
    } catch (err) {
      setEnabledOverrides(prev => ({ ...prev, [card.id]: undefined }))
      toast.error(
        err instanceof Error ? err.message : 'Could not update this card'
      )
    } finally {
      setPending(prev => {
        const next = new Set(prev)
        next.delete(card.id)
        return next
      })
    }
  }

  async function handleLinkWallet(card: CardData) {
    if (!card.defaultRemoteWalletId) return

    setLinkPending(prev => new Set(prev).add(card.id))
    setLinkedOverrides(prev => ({ ...prev, [card.id]: true }))

    try {
      await linkCardToDefaultWallet(card.id)
      toast.success(`${cardName(card)} linked to this wallet`)
    } catch (err) {
      setLinkedOverrides(prev => ({ ...prev, [card.id]: undefined }))
      toast.error(
        err instanceof Error ? err.message : 'Could not link this card'
      )
    } finally {
      setLinkPending(prev => {
        const next = new Set(prev)
        next.delete(card.id)
        return next
      })
    }
  }

  return (
    <div className="flex flex-1 flex-col pb-32">
      <header className="sticky top-0 z-20 grid h-14 grid-cols-3 items-center bg-background/80 px-3 backdrop-blur-xl">
        <button
          type="button"
          onClick={() => router.back()}
          className="flex h-9 w-fit items-center gap-1.5 rounded-full bg-card px-3 text-sm font-medium text-foreground transition-colors hover:bg-accent"
        >
          <ChevronLeft className="size-4" />
          Back
        </button>
        <h1 className="text-center text-base font-semibold text-foreground">
          My Cards
        </h1>
        <span aria-hidden />
      </header>

      <main className="flex flex-1 flex-col gap-4 px-4 pt-4">
        {loading && !cards ? (
          <CardsSkeleton />
        ) : error ? (
          <ErrorState onRetry={refetch} />
        ) : sortedCards.length === 0 ? (
          <EmptyState />
        ) : (
          <section className="flex flex-col gap-3" aria-label="Available cards">
            {sortedCards.map(card => {
              const isPending = pending.has(card.id)
              const isLinkPending = linkPending.has(card.id)
              const enabled =
                enabledOverrides[card.id] ?? (!card.disabled && !card.blocked)
              const linkedToDefault =
                linkedOverrides[card.id] ??
                (Boolean(card.defaultRemoteWalletId) &&
                  card.remoteWalletId === card.defaultRemoteWalletId)
              const linkNeeded =
                Boolean(card.defaultRemoteWalletId) &&
                !card.blocked &&
                !linkedToDefault

              return (
                <CardRow
                  key={card.id}
                  card={card}
                  enabled={enabled}
                  pending={isPending}
                  linkNeeded={linkNeeded}
                  linkPending={isLinkPending}
                  onToggle={next => handleToggle(card, next)}
                  onLinkWallet={() => handleLinkWallet(card)}
                />
              )
            })}
          </section>
        )}
      </main>

      <NavTabbar />
    </div>
  )
}

function CardRow({
  card,
  enabled,
  pending,
  linkNeeded,
  linkPending,
  onLinkWallet,
  onToggle
}: {
  card: CardData
  enabled: boolean
  pending: boolean
  linkNeeded: boolean
  linkPending: boolean
  onLinkWallet: () => void
  onToggle: (enabled: boolean) => void
}) {
  const blocked = card.blocked
  const dimmed = blocked || !enabled
  const status: CardStatus = blocked ? 'Blocked' : enabled ? 'Active' : 'Disabled'

  return (
    <article className="relative isolate aspect-[1.55] min-h-44 overflow-hidden rounded-2xl bg-card shadow-sm ring-1 ring-border/40">
      <CardArtwork card={card} dimmed={dimmed} />
      <div className="absolute inset-0 bg-gradient-to-t from-background/85 via-background/30 to-background/5" />

      <div className="relative flex h-full flex-col justify-between p-4">
        <div className="flex justify-end">
          <div className="flex flex-col items-end gap-2">
            <StatusBadge status={status} />
            {linkNeeded && (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={linkPending}
                onClick={onLinkWallet}
                className="h-9 rounded-full bg-background/75 px-3 text-xs font-semibold text-foreground shadow-sm ring-1 ring-border/40 backdrop-blur-md transition-all duration-200 hover:bg-background/90 disabled:opacity-70"
              >
                {linkPending ? (
                  <RefreshCw
                    data-icon="inline-start"
                    className="animate-spin"
                  />
                ) : (
                  <Link2 data-icon="inline-start" />
                )}
                Link to this wallet
              </Button>
            )}
          </div>
        </div>

        <div className="flex min-w-0 items-end justify-between gap-3">
          <div className="min-w-0 rounded-xl bg-background/65 px-3 py-2 shadow-sm ring-1 ring-border/30 backdrop-blur-md">
            <h2 className="truncate text-lg font-semibold text-foreground">
              {cardName(card)}
            </h2>
            <p className="truncate text-xs text-muted-foreground">
              {card.design?.description || shortCardId(card.id)}
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-2 rounded-full bg-background/70 px-2.5 py-2 shadow-sm ring-1 ring-border/40 backdrop-blur-md">
            <span className="hidden text-xs font-medium text-muted-foreground sm:inline">
              Tap payments
            </span>
            <Switch
              checked={enabled}
              disabled={pending || blocked}
              aria-label={`${enabled ? 'Disable' : 'Enable'} ${cardName(card)}`}
              onCheckedChange={onToggle}
            />
          </div>
        </div>
      </div>
    </article>
  )
}

function StatusBadge({ status }: { status: CardStatus }) {
  return (
    <Badge
      variant={status === 'Active' ? 'default' : 'secondary'}
      aria-label={`Card status: ${status}`}
      className="grid h-8 shrink-0 place-items-center overflow-hidden px-0 text-center shadow-sm backdrop-blur-md transition-all duration-300 ease-out will-change-[width,border-radius]"
      style={{ width: STATUS_BADGE_WIDTH[status] }}
    >
      {(['Active', 'Disabled', 'Blocked'] as const).map(label => (
        <span
          key={label}
          aria-hidden
          className={cn(
            'col-start-1 row-start-1 transition-all duration-200 ease-out',
            status === label
              ? 'translate-y-0 scale-100 opacity-100'
              : 'translate-y-1 scale-95 opacity-0'
          )}
        >
          {label}
        </span>
      ))}
    </Badge>
  )
}

function CardArtwork({
  card,
  dimmed
}: {
  card: CardData
  dimmed: boolean
}) {
  const image = card.design?.image

  return (
    <div
      className={cn(
        'absolute inset-0 bg-muted transition duration-200',
        dimmed && 'opacity-80 grayscale'
      )}
    >
      {image ? (
        <Image
          src={image}
          alt=""
          fill
          sizes="(max-width: 768px) calc(100vw - 2rem), 640px"
          className="object-cover"
          unoptimized
        />
      ) : (
        <div className="flex h-full items-center justify-center">
          <CreditCard className="size-8 text-muted-foreground" />
        </div>
      )}
    </div>
  )
}

function CardsSkeleton() {
  return (
    <section className="flex flex-col gap-3" aria-label="Loading cards">
      {Array.from({ length: 3 }).map((_, index) => (
        <div key={index} className="flex gap-3 rounded-2xl bg-card p-3">
          <Skeleton className="aspect-[1.55] w-24 rounded-xl" />
          <div className="flex flex-1 flex-col justify-between py-1">
            <div className="flex flex-col gap-2">
              <Skeleton className="h-5 w-28" />
              <Skeleton className="h-4 w-36" />
            </div>
            <div className="flex items-center justify-between">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-6 w-11 rounded-full" />
            </div>
          </div>
        </div>
      ))}
    </section>
  )
}

function EmptyState() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border bg-card/40 px-6 py-12 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-card ring-1 ring-border/50">
        <CreditCard className="size-6 text-muted-foreground" />
      </div>
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold text-foreground">
          No cards yet
        </h2>
        <p className="max-w-64 text-sm leading-relaxed text-muted-foreground">
          Cards paired to your wallet will appear here.
        </p>
      </div>
      <Button asChild variant="outline">
        <Link href="/admin/cards">
          <CreditCard data-icon="inline-start" />
          Manage cards
        </Link>
      </Button>
    </div>
  )
}

function ErrorState({ onRetry }: { onRetry: () => Promise<void> }) {
  return (
    <div className="flex flex-col items-center gap-4 rounded-2xl bg-card px-6 py-10 text-center">
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold text-foreground">
          Cards unavailable
        </h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Try again in a moment.
        </p>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button type="button" variant="outline" onClick={() => void onRetry()}>
          <RefreshCw data-icon="inline-start" />
          Retry
        </Button>
        <Button asChild variant="outline">
          <Link href="/admin/cards">
            <CreditCard data-icon="inline-start" />
            Manage cards
          </Link>
        </Button>
      </div>
    </div>
  )
}

function cardName(card: CardData) {
  return card.title?.trim() || card.design?.description?.trim() || 'Card'
}

function shortCardId(id: string) {
  return id.length <= 12 ? id : `${id.slice(0, 6)}...${id.slice(-4)}`
}
