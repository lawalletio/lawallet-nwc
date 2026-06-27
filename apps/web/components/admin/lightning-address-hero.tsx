'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  Check,
  Copy,
  Zap
} from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

/**
 * Centered Lightning Address display: a pill that copies the address on click
 * (the trailing icon flips to a check / red alert for 3s), with the username as
 * the predominant part and the `@`/domain de-emphasized in their own colors.
 *
 * Shared between the admin dashboard (`/admin`) and the per-address edit page
 * so both render the exact same address treatment. Pass `configureHref` to
 * reveal a "Configure" shortcut below the pill for 4s after a click — the
 * dashboard uses it; the edit page omits it (you're already configuring).
 */
export function LightningAddressHero({
  address,
  label = 'Your Lightning Address',
  configureHref
}: {
  address: string
  /** Eyebrow label above the pill. Pass an empty string to hide it. */
  label?: string
  /** When set, clicking the pill reveals a "Configure" link below for 4s. */
  configureHref?: string
}) {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle')
  const [showConfigure, setShowConfigure] = useState(false)
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const configureTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (copiedTimer.current) clearTimeout(copiedTimer.current)
      if (configureTimer.current) clearTimeout(configureTimer.current)
    },
    []
  )

  const needsDomainSetup = address.endsWith('@undefined')
  const displayAddress = needsDomainSetup
    ? address.replace(/@undefined$/, '@…')
    : address
  // Split into username / @ / domain so the username reads as the predominant
  // part, with the @ and domain de-emphasized in their own colors.
  const atIndex = displayAddress.indexOf('@')
  const namePart =
    atIndex >= 0 ? displayAddress.slice(0, atIndex) : displayAddress
  const domainPart = atIndex >= 0 ? displayAddress.slice(atIndex + 1) : ''

  // Reflect the copy outcome in the trailing icon for 3s: check on success,
  // a red alert on failure.
  function markCopyResult(result: 'copied' | 'error') {
    setCopyState(result)
    if (copiedTimer.current) clearTimeout(copiedTimer.current)
    copiedTimer.current = setTimeout(() => setCopyState('idle'), 3000)
  }

  function handleClick() {
    // Reveal the Configure link for 4s (only when a target is provided).
    if (configureHref) {
      setShowConfigure(true)
      if (configureTimer.current) clearTimeout(configureTimer.current)
      configureTimer.current = setTimeout(() => setShowConfigure(false), 4000)
    }

    const text = address
    if (!navigator.clipboard?.writeText) {
      // Fallback for non-secure contexts.
      try {
        const ta = document.createElement('textarea')
        ta.value = text
        ta.style.position = 'fixed'
        ta.style.opacity = '0'
        document.body.appendChild(ta)
        ta.select()
        const ok = document.execCommand('copy')
        document.body.removeChild(ta)
        if (ok) {
          toast.success('Copied to clipboard')
          markCopyResult('copied')
        } else {
          toast.error('Copy failed')
          markCopyResult('error')
        }
      } catch {
        toast.error('Copy failed')
        markCopyResult('error')
      }
      return
    }
    navigator.clipboard.writeText(text).then(
      () => {
        toast.success('Copied to clipboard')
        markCopyResult('copied')
      },
      () => {
        toast.error('Copy failed')
        markCopyResult('error')
      }
    )
  }

  return (
    <div className="flex w-full flex-col items-center gap-2 text-center">
      {label && (
        <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
          {label}
        </p>
      )}
      <button
        type="button"
        onClick={handleClick}
        aria-label="Copy your Lightning Address"
        className="group inline-flex max-w-full items-center gap-2.5 rounded-full border border-border bg-card px-5 py-2.5 text-foreground shadow-sm transition-colors hover:border-ring hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        <Zap className="size-4 shrink-0 text-yellow-500" />
        <span className="truncate text-lg tracking-tight sm:text-xl">
          <span className="font-semibold text-foreground">{namePart}</span>
          {domainPart && (
            <>
              <span className="font-semibold text-yellow-500">@</span>
              <span className="font-medium text-[var(--theme-400)]">
                {domainPart}
              </span>
            </>
          )}
        </span>
        {/* Copy → Check (success) / red alert (failure), cross-faded in place
            so the pill width stays stable. */}
        <span className="relative size-4 shrink-0">
          <Copy
            className={cn(
              'absolute inset-0 size-4 text-muted-foreground transition-all duration-200 group-hover:text-foreground',
              copyState === 'idle' ? 'scale-100 opacity-100' : 'scale-75 opacity-0'
            )}
          />
          <Check
            className={cn(
              'absolute inset-0 size-4 text-green-500 transition-all duration-200',
              copyState === 'copied' ? 'scale-100 opacity-100' : 'scale-75 opacity-0'
            )}
          />
          <AlertCircle
            className={cn(
              'absolute inset-0 size-4 text-red-500 transition-all duration-200',
              copyState === 'error' ? 'scale-100 opacity-100' : 'scale-75 opacity-0'
            )}
          />
        </span>
      </button>

      {/* Configure shortcut: slides + fades in on click, stays 4s, then leaves.
          grid-rows 0fr→1fr gives a smooth height transition with no magic
          max-height; the inner link adds a slight vertical slide. */}
      {configureHref && (
        <div
          className={cn(
            'grid w-full justify-items-center transition-all duration-300 ease-out',
            showConfigure
              ? 'grid-rows-[1fr] opacity-100'
              : 'grid-rows-[0fr] opacity-0'
          )}
        >
          <div className="overflow-hidden">
            <Link
              href={configureHref}
              tabIndex={showConfigure ? 0 : -1}
              aria-hidden={!showConfigure}
              className={cn(
                'inline-flex items-center gap-1 pt-1 text-xs font-medium text-muted-foreground underline-offset-4 transition-transform duration-300 ease-out hover:text-foreground hover:underline',
                showConfigure ? 'translate-y-0' : '-translate-y-1'
              )}
            >
              Configure
              <ArrowRight className="size-3" />
            </Link>
          </div>
        </div>
      )}

      {needsDomainSetup && (
        <Badge
          variant="secondary"
          className="border border-yellow-500/20 bg-yellow-500/10 text-xs text-yellow-600 hover:bg-yellow-500/15 dark:text-yellow-500"
        >
          <AlertTriangle className="mr-1 size-3" />
          Needs Domain setup
        </Badge>
      )}
    </div>
  )
}
