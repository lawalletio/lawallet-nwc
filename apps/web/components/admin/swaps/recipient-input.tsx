'use client'

import { useState } from 'react'
import { X } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import {
  swapRecipients,
  useSwapRecipients,
  type SwapRecipient
} from '@/lib/client/swap-recipients-store'
import { BankAvatar } from './swap-shared'

const MAX_SHOWN = 6

/** What goes in the input for a saved recipient. */
export const recipientQuery = (r: SwapRecipient) => r.alias ?? r.cvu

/**
 * Alias/CBU input with a dropdown of recently paid accounts (localStorage),
 * filtered as the user types. Arrow keys + Enter pick; Escape closes.
 */
export function RecipientInput({
  value,
  onChange,
  onPick,
  onSubmit,
  invalid
}: {
  value: string
  onChange: (value: string) => void
  onPick: (recipient: SwapRecipient) => void
  /** Enter with the dropdown closed. */
  onSubmit: () => void
  invalid: boolean
}) {
  const recipients = useSwapRecipients()
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)

  const q = value.trim().toLowerCase()
  const matches = recipients
    .filter(
      r =>
        !q ||
        r.cvu.includes(q) ||
        r.alias?.toLowerCase().includes(q) ||
        r.owners[0]?.name.toLowerCase().includes(q)
    )
    .slice(0, MAX_SHOWN)
  // Already picked/typed in full — nothing left to suggest.
  const picked = matches.some(r => r.cvu === q || r.alias?.toLowerCase() === q)
  const show = open && matches.length > 0 && !picked
  const current = Math.min(active, matches.length - 1)

  function pick(r: SwapRecipient) {
    setOpen(false)
    onPick(r)
  }

  return (
    <div className="relative @container">
      <Input
        id="swap-alias"
        autoFocus
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        placeholder="mi.alias.mp"
        value={value}
        role="combobox"
        aria-expanded={show}
        aria-controls="swap-recipient-list"
        aria-autocomplete="list"
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onChange={e => {
          onChange(e.target.value)
          setOpen(true)
          setActive(0)
        }}
        onKeyDown={e => {
          if (show && e.key === 'ArrowDown') {
            e.preventDefault()
            setActive((current + 1) % matches.length)
          } else if (show && e.key === 'ArrowUp') {
            e.preventDefault()
            setActive((current - 1 + matches.length) % matches.length)
          } else if (show && e.key === 'Enter') {
            e.preventDefault()
            pick(matches[current])
          } else if (e.key === 'Escape' && show) {
            e.stopPropagation() // keep the dialog open
            setOpen(false)
          } else if (e.key === 'Enter') {
            onSubmit()
          }
        }}
        aria-invalid={invalid}
        className="h-11 font-mono"
      />
      {show && (
        <ul
          id="swap-recipient-list"
          role="listbox"
          className="absolute inset-x-0 top-full z-50 mt-1 max-h-80 overflow-y-auto rounded-xl border bg-popover p-1 shadow-lg animate-in fade-in slide-in-from-top-1 duration-150"
        >
          <li className="px-2.5 pb-1 pt-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Recent
          </li>
          {matches.map((r, i) => (
            <li
              key={r.cvu}
              role="option"
              aria-selected={i === current}
              // Keep focus in the input so blur doesn't close before click.
              onMouseDown={e => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(r)}
              className={cn(
                'group flex cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2',
                i === current && 'bg-accent'
              )}
            >
              <BankAvatar account={r} className="size-9" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {r.owners[0]?.name || 'Unknown holder'}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {[r.alias, r.bank].filter(Boolean).join(' · ')}
                </p>
              </div>
              <span className="hidden shrink-0 font-mono text-xs text-muted-foreground @md:block">
                {r.cvu}
              </span>
              <button
                type="button"
                aria-label={`Forget ${r.owners[0]?.name ?? r.cvu}`}
                onClick={e => {
                  e.stopPropagation()
                  swapRecipients.forget(r.cvu)
                }}
                className="rounded-md p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-background hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
              >
                <X className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
