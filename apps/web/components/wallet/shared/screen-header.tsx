'use client'

import React from 'react'
import { useRouter } from 'next/navigation'
import { ChevronLeft, X } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ScreenHeaderProps {
  title?: string
  /** Override the default "go back" behaviour. */
  onBack?: () => void
  /** Use X instead of chevron (for modal-like flow screens). */
  closeStyle?: boolean
  /** Right-side action (e.g. a "Skip" button). */
  trailing?: React.ReactNode
  className?: string
}

export function ScreenHeader({
  title,
  onBack,
  closeStyle = false,
  trailing,
  className,
}: ScreenHeaderProps) {
  const router = useRouter()
  const Icon = closeStyle ? X : ChevronLeft

  function back() {
    if (onBack) return onBack()
    router.back()
  }

  return (
    <header
      className={cn(
        'sticky top-0 z-20 flex h-14 items-center justify-between bg-background/80 px-3 backdrop-blur-xl',
        className,
      )}
    >
      <button
        type="button"
        onClick={back}
        aria-label="Go back"
        className="flex size-10 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Icon className="size-5" />
      </button>

      {title && (
        <h1 className="absolute left-1/2 -translate-x-1/2 text-base font-medium text-foreground">
          {title}
        </h1>
      )}

      <div className="flex min-w-10 items-center justify-end">{trailing}</div>
    </header>
  )
}
