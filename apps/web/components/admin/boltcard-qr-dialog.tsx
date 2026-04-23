'use client'

import React, { useEffect, useState } from 'react'
import { Copy, QrCode } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

/**
 * Modal that renders a BoltCard-spec QR pointing at this card's `/write`
 * endpoint. The boltcard-nfc-card-creator app (and compatible tooling)
 * scans it, fetches the JSON payload returned by GET /api/cards/:id/write
 * — containing the NTAG424 keys + lnurlw_base — and programs the card.
 *
 * Rendered client-side because the endpoint must be absolute (`https://…/…`)
 * so the phone app can reach the server from outside the admin's browser
 * context. We derive `window.location.origin` after mount to avoid an SSR
 * hydration mismatch with the empty initial render.
 */
export function BoltcardQrDialog({
  cardId,
  open,
  onOpenChange,
}: {
  cardId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [origin, setOrigin] = useState<string | null>(null)

  useEffect(() => {
    setOrigin(window.location.origin)
  }, [])

  const url = origin ? `${origin}/api/cards/${cardId}/write` : ''

  async function handleCopy() {
    if (!url) return
    try {
      await navigator.clipboard.writeText(url)
      toast.success('URL copied')
    } catch {
      toast.error('Could not copy')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader className="items-center text-center">
          <div className="mb-2 flex size-10 items-center justify-center rounded-md bg-muted">
            <QrCode className="size-5 text-muted-foreground" aria-hidden />
          </div>
          <DialogTitle>Program BoltCard</DialogTitle>
          <DialogDescription>
            Scan with the BoltCard NFC Card Creator app (or any
            BoltCard-compatible tool) to program the NTAG424 keys and
            lnurlw URL onto a fresh card.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center gap-4 py-2">
          <div className="rounded-lg bg-white p-3">
            {url ? (
              <QRCodeSVG value={url} size={240} />
            ) : (
              <div className="size-[240px] animate-pulse bg-muted/40" />
            )}
          </div>

          <div className="w-full overflow-hidden rounded-md border bg-muted/40 px-3 py-2">
            <p
              className="truncate font-mono text-xs text-muted-foreground"
              title={url}
            >
              {url || '…'}
            </p>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={handleCopy} disabled={!url}>
            <Copy className="mr-2 size-4" />
            Copy URL
          </Button>
          <Button variant="theme" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
