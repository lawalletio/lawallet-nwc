'use client'

import Link from 'next/link'
import { ArrowUpRight, ArrowDownLeft, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

interface PrimaryActionButtonProps {
  href: string
  label: string
  icon: LucideIcon
  className?: string
  disabled?: boolean
}

/**
 * Rounded pill used for the home-screen Send / Receive primary actions.
 * Visually the Figma treats these as the dominant CTA — a capsule with
 * an icon, a label, and a generous hit target.
 */
export function PrimaryActionButton({
  href,
  label,
  icon: Icon,
  className,
  disabled,
}: PrimaryActionButtonProps) {
  const content = (
    <>
      <Icon className="size-5" />
      <span className="text-sm font-semibold">{label}</span>
    </>
  )

  if (disabled) {
    return (
      <button
        type="button"
        disabled
        className={cn(
          'flex flex-1 items-center justify-center gap-2 rounded-full bg-card px-4 py-4 text-muted-foreground opacity-50',
          className,
        )}
      >
        {content}
      </button>
    )
  }

  return (
    <Link
      href={href}
      className={cn(
        'flex flex-1 items-center justify-center gap-2 rounded-full bg-card px-4 py-4 text-foreground transition-colors hover:bg-accent active:scale-[0.98]',
        className,
      )}
    >
      {content}
    </Link>
  )
}

export { ArrowUpRight, ArrowDownLeft }
