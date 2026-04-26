'use client'

import { useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { Copy, Check, Share2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface QrDisplayProps {
  value: string
  /** Short label shown below the QR (truncated address, invoice preview, …). */
  caption?: string
  /** When true, upper-cases the payload for denser QR rendering (bolt11-safe). */
  uppercasePayload?: boolean
  className?: string
  size?: number
}

export function QrDisplay({
  value,
  caption,
  uppercasePayload = false,
  className,
  size = 240,
}: QrDisplayProps) {
  const [copied, setCopied] = useState(false)
  const encoded = uppercasePayload ? value.toUpperCase() : value

  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      toast.success('Copied')
      setTimeout(() => setCopied(false), 1500)
    } catch {
      toast.error('Copy failed')
    }
  }

  async function share() {
    if (typeof navigator === 'undefined' || !navigator.share) {
      await copy()
      return
    }
    try {
      await navigator.share({ text: value })
    } catch {
      // user dismissed
    }
  }

  const canShare = typeof navigator !== 'undefined' && 'share' in navigator

  return (
    <div className={cn('flex flex-col items-center gap-4', className)}>
      <div className="rounded-2xl bg-white p-4 shadow-lg">
        <QRCodeSVG value={encoded} size={size} level="M" />
      </div>

      {caption && (
        <p className="text-center text-sm text-muted-foreground break-all px-4">
          {caption}
        </p>
      )}

      <div className="flex w-full gap-2">
        <Button
          type="button"
          variant="secondary"
          onClick={copy}
          className="flex-1"
        >
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
          {copied ? 'Copied' : 'Copy'}
        </Button>
        {canShare && (
          <Button
            type="button"
            variant="secondary"
            onClick={share}
            className="flex-1"
          >
            <Share2 className="size-4" />
            Share
          </Button>
        )}
      </div>
    </div>
  )
}
