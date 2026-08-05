'use client'

import { useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * Copy-to-clipboard button with a transient confirmation.
 *
 * `navigator.clipboard.writeText` rejects on an insecure origin or a denied
 * permission, so the write is always guarded — an unhandled rejection there
 * leaves the user with no feedback at all.
 */
export function CopyButton({
  value,
  label,
  className,
  variant = 'ghost',
  size = 'icon'
}: {
  value: string
  /** Used for the accessible name and the toast, e.g. "Payment hash". */
  label: string
  className?: string
  variant?: 'ghost' | 'outline' | 'secondary'
  size?: 'icon' | 'sm'
}) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
      toast.success(`${label} copied`)
    } catch {
      toast.error(`Could not copy ${label.toLowerCase()}`)
    }
  }

  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      onClick={() => void copy()}
      aria-label={`Copy ${label.toLowerCase()}`}
      className={cn(size === 'icon' && 'size-7 shrink-0', className)}
    >
      {copied ? (
        <Check data-icon="inline-start" />
      ) : (
        <Copy data-icon="inline-start" />
      )}
    </Button>
  )
}
