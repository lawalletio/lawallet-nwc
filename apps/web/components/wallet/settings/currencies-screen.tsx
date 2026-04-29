'use client'

import React, { useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  ChevronLeft,
  GripVertical,
  Lock,
  Minus,
  Plus,
  Search,
} from 'lucide-react'
import { Input } from '@/components/ui/input'
import { NavTabbar } from '@/components/wallet/shared/nav-tabbar'
import {
  CURRENCY_CATALOG,
  currenciesActions,
  useActiveCurrencies,
  type Currency,
} from '@/lib/client/currencies-store'
import { cn } from '@/lib/utils'

export function CurrenciesScreen() {
  const router = useRouter()
  const active = useActiveCurrencies()
  const [query, setQuery] = useState('')

  // Pointer-based drag state for the Active Assets list. We mirror the
  // dragged + hovered codes into refs so the synchronous pointer handlers
  // can read the latest value without waiting for React to flush — a
  // pointermove that fires the same tick as a pointerdown must already
  // see the dragged code, otherwise the early-return aborts the gesture.
  const [draggedCode, setDraggedCode] = useState<string | null>(null)
  const [hoverCode, setHoverCode] = useState<string | null>(null)
  const draggedCodeRef = useRef<string | null>(null)
  const hoverCodeRef = useRef<string | null>(null)
  // Snapshot the active list at drag-start so concurrent store updates
  // (another tab, an SSE invalidate) don't shift indices mid-gesture.
  const dragOrderRef = useRef<string[]>([])

  // Floating-preview geometry. We capture the source row's bounding box
  // once at drag-start, plus the offset between the pointer and the row's
  // top edge, so the overlay follows the pointer without snapping its
  // grab-point to the row's origin.
  const [overlayTop, setOverlayTop] = useState(0)
  const overlayPointerOffsetRef = useRef(0)
  const sourceRectRef = useRef<DOMRect | null>(null)
  const [overlayRect, setOverlayRect] = useState<DOMRect | null>(null)

  const setDragged = (code: string | null) => {
    draggedCodeRef.current = code
    setDraggedCode(code)
  }
  const setHover = (code: string | null) => {
    hoverCodeRef.current = code
    setHoverCode(code)
  }

  const startDrag = (code: string, e: React.PointerEvent<HTMLElement>) => {
    if (CURRENCY_CATALOG.find(c => c.code === code)?.locked) return
    if (active.length < 2) return
    e.preventDefault()
    dragOrderRef.current = active.map(c => c.code)

    // Cache the source row's geometry so the overlay can match its width
    // exactly and the pointer feels anchored to the same spot inside it.
    const grip = e.currentTarget
    const row = grip.closest<HTMLElement>('[data-currency-code]')
    if (row) {
      const rect = row.getBoundingClientRect()
      sourceRectRef.current = rect
      setOverlayRect(rect)
      overlayPointerOffsetRef.current = e.clientY - rect.top
      setOverlayTop(e.clientY - overlayPointerOffsetRef.current)
    }

    setDragged(code)
    setHover(code)
    try {
      grip.setPointerCapture(e.pointerId)
    } catch {
      // pointer capture isn't supported in test environments
    }
  }

  const moveDrag = (e: React.PointerEvent<HTMLElement>) => {
    if (!draggedCodeRef.current) return
    setOverlayTop(e.clientY - overlayPointerOffsetRef.current)

    const target = document.elementFromPoint(e.clientX, e.clientY)
    const row = target?.closest<HTMLElement>('[data-currency-code]')
    const next = row?.dataset.currencyCode ?? null
    if (!next) return
    // Don't snap onto the locked SAT row — it must stay anchored at the
    // top so the source-of-truth unit can't be reordered away.
    const def = CURRENCY_CATALOG.find(c => c.code === next)
    if (def?.locked) return
    if (hoverCodeRef.current !== next) setHover(next)
  }

  const endDrag = () => {
    const dragged = draggedCodeRef.current
    const hover = hoverCodeRef.current
    if (dragged && hover && dragged !== hover) {
      const order = [...dragOrderRef.current]
      const from = order.indexOf(dragged)
      const to = order.indexOf(hover)
      if (from !== -1 && to !== -1) {
        const [moved] = order.splice(from, 1)
        order.splice(to, 0, moved)
        currenciesActions.reorder(order)
      }
    }
    setDragged(null)
    setHover(null)
    setOverlayRect(null)
    sourceRectRef.current = null
  }

  // While dragging, neighbouring rows translate up or down to make room
  // for the dragged item. `rowOffset(code)` returns the translateY in
  // pixels for any row in the list — the source row itself returns 0 (its
  // slot stays put; the floating overlay represents the visual position).
  const rowHeight = sourceRectRef.current?.height ?? 64
  function rowOffset(code: string): number {
    const dragged = draggedCode
    const hover = hoverCode
    if (!dragged || !hover || dragged === hover) return 0
    const order = dragOrderRef.current
    const from = order.indexOf(dragged)
    const to = order.indexOf(hover)
    const idx = order.indexOf(code)
    if (idx === -1 || idx === from) return 0
    if (from < to && idx > from && idx <= to) return -rowHeight
    if (from > to && idx >= to && idx < from) return rowHeight
    return 0
  }

  const activeCodes = useMemo(() => new Set(active.map(c => c.code)), [active])

  const term = query.trim().toLowerCase()
  const matchesQuery = (c: { code: string; name: string }) => {
    if (!term) return true
    return (
      c.code.toLowerCase().includes(term) ||
      c.name.toLowerCase().includes(term)
    )
  }

  // Active Assets is always shown in full — the search only narrows the
  // Available References list so the user can find a new currency to
  // add. Filtering Active Assets too would hide currencies the user has
  // already chosen from view, which is confusing.
  const filteredAvailable = useMemo(
    () =>
      CURRENCY_CATALOG.filter(c => !activeCodes.has(c.code)).filter(matchesQuery),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeCodes, term],
  )

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
          Currency
        </h1>
        <span aria-hidden />
      </header>

      <main className="flex flex-1 flex-col gap-6 px-4 pt-4">
        <Section title="Active Assets">
          <div className="flex flex-col rounded-2xl bg-card">
            {active.map((currency, idx) => (
              <ActiveRow
                key={currency.code}
                currency={currency}
                divider={idx < active.length - 1}
                onRemove={() => currenciesActions.remove(currency.code)}
                isDragging={draggedCode === currency.code}
                translateY={rowOffset(currency.code)}
                onGripPointerDown={e => startDrag(currency.code, e)}
                onGripPointerMove={moveDrag}
                onGripPointerUp={endDrag}
              />
            ))}
          </div>
          <p className="px-2 text-center text-xs leading-relaxed text-muted-foreground">
            Satoshi are your core assets. Add a reference currency to
            visualize the fiat value of your balance.
          </p>
        </Section>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search currency..."
            className="h-11 rounded-xl bg-card pl-10"
            autoCorrect="off"
            spellCheck={false}
          />
        </div>

        <Section title="Available References">
          {filteredAvailable.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border bg-card/40 px-4 py-8 text-center text-sm text-muted-foreground">
              No matching currency.
            </div>
          ) : (
            <div className="flex flex-col rounded-2xl bg-card">
              {filteredAvailable.map((currency, idx) => (
                <AvailableRow
                  key={currency.code}
                  currency={currency}
                  divider={idx < filteredAvailable.length - 1}
                  onAdd={() => currenciesActions.add(currency.code)}
                />
              ))}
            </div>
          )}
        </Section>
      </main>

      <NavTabbar />

      {draggedCode && overlayRect && (
        <DraggedPreview
          code={draggedCode}
          rect={overlayRect}
          top={overlayTop}
        />
      )}
    </div>
  )
}

function Section({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-medium text-muted-foreground">{title}</h2>
      {children}
    </section>
  )
}

function ActiveRow({
  currency,
  divider,
  onRemove,
  isDragging,
  translateY,
  onGripPointerDown,
  onGripPointerMove,
  onGripPointerUp,
}: {
  currency: Currency
  divider: boolean
  onRemove: () => void
  isDragging: boolean
  translateY: number
  onGripPointerDown: (e: React.PointerEvent<HTMLElement>) => void
  onGripPointerMove: (e: React.PointerEvent<HTMLElement>) => void
  onGripPointerUp: (e: React.PointerEvent<HTMLElement>) => void
}) {
  return (
    <div
      data-currency-code={currency.code}
      style={{
        transform: `translateY(${translateY}px)`,
        // Skip the easing while the row IS the one being dragged — the
        // overlay handles its visible motion and the placeholder snaps
        // back into place after the gesture without a wobble.
        transition: isDragging ? 'none' : 'transform 200ms ease',
      }}
      className={cn(
        'flex h-16 items-center gap-3 px-3',
        divider && 'border-b border-border/40',
        isDragging && 'opacity-0',
      )}
    >
      {currency.locked ? (
        <span
          aria-label="Always active"
          className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground"
        >
          <Lock className="size-4" />
        </span>
      ) : (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${currency.name}`}
          className="flex size-9 shrink-0 items-center justify-center rounded-md bg-destructive/90 text-destructive-foreground transition-colors hover:bg-destructive"
        >
          <Minus className="size-4" />
        </button>
      )}

      <CurrencyAvatar code={currency.code} />

      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium text-foreground">
          {currency.name}
        </span>
        <span className="text-xs text-muted-foreground">{currency.code}</span>
      </div>

      {currency.locked ? (
        <span
          aria-hidden
          className="flex size-9 shrink-0 items-center justify-center text-muted-foreground/40"
        >
          <GripVertical className="size-4" />
        </span>
      ) : (
        <span
          role="button"
          aria-label={`Reorder ${currency.name}`}
          onPointerDown={onGripPointerDown}
          onPointerMove={onGripPointerMove}
          onPointerUp={onGripPointerUp}
          onPointerCancel={onGripPointerUp}
          className="flex size-9 shrink-0 cursor-grab touch-none select-none items-center justify-center rounded-md text-muted-foreground hover:text-foreground active:cursor-grabbing active:bg-accent/60"
        >
          <GripVertical className="size-4" />
        </span>
      )}
    </div>
  )
}

function AvailableRow({
  currency,
  divider,
  onAdd,
}: {
  currency: Currency
  divider: boolean
  onAdd: () => void
}) {
  return (
    <div
      className={cn(
        'flex h-16 items-center gap-3 px-3',
        divider && 'border-b border-border/40',
      )}
    >
      <button
        type="button"
        onClick={onAdd}
        aria-label={`Add ${currency.name}`}
        className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-foreground transition-colors hover:bg-accent"
      >
        <Plus className="size-4" />
      </button>

      <CurrencyAvatar code={currency.code} />

      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium text-foreground">
          {currency.name}
        </span>
        <span className="text-xs text-muted-foreground">{currency.code}</span>
      </div>
    </div>
  )
}

/**
 * Floating clone of the active row that the user is currently dragging.
 * Anchored in `position: fixed` and matches the source row's width, so it
 * appears to lift cleanly out of the list. Pointer events are disabled so
 * the underlying `elementFromPoint` lookup in `moveDrag` still resolves
 * the row beneath the cursor instead of the overlay itself.
 */
function DraggedPreview({
  code,
  rect,
  top,
}: {
  code: string
  rect: DOMRect
  top: number
}) {
  const def = CURRENCY_CATALOG.find(c => c.code === code)
  if (!def) return null
  return (
    <div
      aria-hidden
      style={{
        position: 'fixed',
        top,
        left: rect.left,
        width: rect.width,
        height: rect.height,
      }}
      className="pointer-events-none z-50"
    >
      <div className="flex size-full items-center gap-3 rounded-2xl border border-border bg-card px-3 shadow-2xl ring-1 ring-foreground/5">
        {def.locked ? (
          <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
            <Lock className="size-4" />
          </span>
        ) : (
          <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-destructive/90 text-destructive-foreground">
            <Minus className="size-4" />
          </span>
        )}

        <CurrencyAvatar code={def.code} />

        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-medium text-foreground">
            {def.name}
          </span>
          <span className="text-xs text-muted-foreground">{def.code}</span>
        </div>

        <span className="flex size-9 shrink-0 items-center justify-center text-foreground">
          <GripVertical className="size-4" />
        </span>
      </div>
    </div>
  )
}

function CurrencyAvatar({ code }: { code: string }) {
  // Plain ticker chip in lieu of per-currency artwork. Keeps the row
  // visually balanced with the Figma's placeholder square slot without
  // shipping a binary asset for every currency we support.
  return (
    <span
      aria-hidden
      className="flex size-9 shrink-0 items-center justify-center rounded-md bg-background text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
    >
      {code.slice(0, 3)}
    </span>
  )
}
