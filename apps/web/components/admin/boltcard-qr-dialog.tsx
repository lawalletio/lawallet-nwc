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
import { Spinner } from '@/components/ui/spinner'
import { useAuth } from '@/components/admin/auth-context'
import { ApiClientError } from '@/lib/client/api-client'

type MintState = 'loading' | 'ready' | 'used' | 'error'

/**
 * Modal that renders a single-use, replay-protected BoltCard programming QR.
 *
 * Each time it opens it asks the server (POST /api/cards/:id/write-token) to
 * mint a fresh one-time token and returns the tokenized
 * `GET /api/cards/:id/write?token=…` URL. The boltcard-nfc-card-creator app
 * scans it, fetches the keys + lnurlw_base, and programs the card — and that
 * first fetch consumes the token, so the URL can't be replayed to re-extract
 * the keys.
 *
 * Minting is only possible while the card is still "fresh" (never tapped); a
 * card already in use returns 409 and we show the locked state instead of a QR.
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
  const { apiClient } = useAuth()
  const [state, setState] = useState<MintState>('loading')
  const [url, setUrl] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  // Mint a fresh token every time the dialog opens. Re-opening invalidates the
  // previous QR (the server replaces the outstanding token), so an old
  // screenshot stops working — part of the replay protection.
  useEffect(() => {
    if (!open) return
    let cancelled = false
    setState('loading')
    setUrl(null)
    setErrorMsg(null)

    apiClient
      .post<{ url: string; expiresAt: string }>(
        `/api/cards/${cardId}/write-token`,
        {},
      )
      .then(res => {
        if (cancelled) return
        setUrl(res.url)
        setState('ready')
      })
      .catch(err => {
        if (cancelled) return
        if (err instanceof ApiClientError && err.status === 409) {
          setState('used')
        } else {
          setErrorMsg(
            err instanceof Error
              ? err.message
              : 'Could not generate the programming link.',
          )
          setState('error')
        }
      })

    return () => {
      cancelled = true
    }
  }, [open, cardId, apiClient])

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
            BoltCard-compatible tool) to program the NTAG424 keys and lnurlw URL
            onto a fresh card. The link is single-use.
          </DialogDescription>
        </DialogHeader>

        {state === 'used' ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            This card has already been tapped, so its keys are locked and it
            can&apos;t be re-programmed. Reset it first (Delete → Reset) to issue
            a fresh card.
          </p>
        ) : state === 'error' ? (
          <p className="py-6 text-center text-sm text-destructive">
            {errorMsg}
          </p>
        ) : (
          // `min-w-0` lets this grid item shrink to the dialog width — without
          // it the long, unbreakable token URL forces the column to its
          // intrinsic width and the field + QR spill past the modal's edge.
          <div className="flex w-full min-w-0 flex-col items-center gap-4 py-2">
            <div className="rounded-lg bg-white p-3">
              {state === 'ready' && url ? (
                <QRCodeSVG value={url} size={208} />
              ) : (
                <div className="flex size-52 items-center justify-center bg-muted/40">
                  <Spinner size={24} className="text-muted-foreground" />
                </div>
              )}
            </div>

            <div className="w-full min-w-0 overflow-hidden rounded-md border bg-muted/40 px-3 py-2">
              <p
                className="truncate font-mono text-xs text-muted-foreground"
                title={url ?? ''}
              >
                {url ?? 'Generating one-time link…'}
              </p>
            </div>
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-2">
          {state === 'ready' && (
            <Button variant="outline" onClick={handleCopy} disabled={!url}>
              <Copy className="mr-2 size-4" />
              Copy URL
            </Button>
          )}
          <Button variant="theme" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
