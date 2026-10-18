'use client'

import { useState } from 'react'
import { Check, Copy, Eye, EyeOff } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { cn } from '@/lib/utils'
import { useT } from '@/lib/client/i18n'

interface SecretKeyRevealProps {
  /** The bech32 nsec (or any secret string) to reveal/copy. */
  nsec: string
  disabled?: boolean
  /**
   * When provided, renders the "I've saved my key" acknowledgment checkbox
   * and reports its state — used by flows that gate a continue button on it.
   */
  confirmed?: boolean
  onConfirmedChange?: (confirmed: boolean) => void
  confirmLabel?: string
}

/**
 * Blur-by-default secret reveal with copy + optional save-acknowledgment.
 * Shared by the create-account flows and the passkey nsec-export dialog so
 * every place a private key is shown behaves identically.
 */
export function SecretKeyReveal({
  nsec,
  disabled,
  confirmed,
  onConfirmedChange,
  confirmLabel
}: SecretKeyRevealProps) {
  const t = useT()
  const [revealed, setRevealed] = useState(false)
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(nsec)
      setCopied(true)
      toast.success(t.auth.keyCopied)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error(t.auth.keyCopyFailed)
    }
  }

  return (
    <div className="space-y-3">
      <div className="relative rounded-xl border border-border bg-card px-4 py-3">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              'flex-1 break-all text-xs font-mono text-foreground',
              !revealed && 'blur-sm select-none'
            )}
          >
            {nsec}
          </span>
          <button
            type="button"
            onClick={() => setRevealed(v => !v)}
            aria-label={revealed ? t.auth.hideKey : t.auth.revealKey}
            className="shrink-0 text-muted-foreground hover:text-foreground"
          >
            {revealed ? (
              <EyeOff className="size-4" />
            ) : (
              <Eye className="size-4" />
            )}
          </button>
        </div>
      </div>

      <Button
        type="button"
        variant="secondary"
        onClick={handleCopy}
        className="w-full"
        disabled={disabled}
      >
        {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
        {copied ? t.common.copied : t.auth.copyKey}
      </Button>

      {onConfirmedChange && (
        <label className="flex items-start gap-3 rounded-xl border border-border bg-card/50 p-4 text-sm text-foreground">
          <Checkbox
            checked={confirmed}
            onCheckedChange={v => onConfirmedChange(v === true)}
            disabled={disabled}
            className="mt-0.5"
          />
          <span className="leading-snug">
            {confirmLabel ?? t.auth.savedKeyConfirm}
          </span>
        </label>
      )}
    </div>
  )
}
