'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Copy, ExternalLink, Printer, RefreshCw, Ticket } from 'lucide-react'
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

type MintState = 'loading' | 'ready' | 'blocked' | 'error'

interface ActivationTokenResponse {
  tokenId: string
  qrPayload: string
  qrKind: 'ONE_TIME' | 'FOREVER'
  expiresAt: string | null
}

/** Minimal HTML-escape for values interpolated into the print document. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Modal that mints and displays a one-time card **activation** link/QR.
 *
 * On open (and on "Regenerate") it asks the server
 * (`POST /api/cards/:id/activation-tokens`, `qrKind: ONE_TIME`) for a fresh
 * token and renders its `qrPayload` — the wallet-side
 * `<host>/wallet/activate/<tokenId>` URL the cardholder scans to claim the card
 * and transfer it to their account. Minting replaces any prior active token, so
 * the latest QR is always the live one.
 *
 * Beyond the QR the operator can copy the link, open it in a new tab, or print a
 * standalone sheet (QR + URL) to hand out with the physical card. Blocked cards
 * can't be activated, so the server's 409 is surfaced as a locked state.
 */
export function CardActivationDialog({
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
  const [token, setToken] = useState<ActivationTokenResponse | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const qrRef = useRef<HTMLDivElement>(null)

  const url = token?.qrPayload ?? null

  const mint = useCallback(() => {
    let cancelled = false
    setState('loading')
    setToken(null)
    setErrorMsg(null)

    apiClient
      .post<ActivationTokenResponse>(`/api/cards/${cardId}/activation-tokens`, {
        qrKind: 'ONE_TIME',
      })
      .then(res => {
        if (cancelled) return
        setToken(res)
        setState('ready')
      })
      .catch(err => {
        if (cancelled) return
        if (err instanceof ApiClientError && err.status === 409) {
          setErrorMsg(err.message)
          setState('blocked')
        } else {
          setErrorMsg(
            err instanceof Error
              ? err.message
              : 'Could not generate the activation link.',
          )
          setState('error')
        }
      })

    return () => {
      cancelled = true
    }
  }, [apiClient, cardId])

  // Mint a fresh token each time the dialog opens.
  useEffect(() => {
    if (!open) return
    return mint()
  }, [open, mint])

  async function handleCopy() {
    if (!url) return
    try {
      await navigator.clipboard.writeText(url)
      toast.success('Activation link copied')
    } catch {
      toast.error('Could not copy')
    }
  }

  function handleOpen() {
    if (!url) return
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  function handlePrint() {
    const svg = qrRef.current?.querySelector('svg')
    if (!url || !svg) return

    const win = window.open('', '_blank', 'width=460,height=640')
    if (!win) {
      toast.error('Could not open the print window — check your popup blocker')
      return
    }

    // Self-contained print sheet: the QR is inline SVG (no external assets), so
    // the trailing script can print as soon as the document parses. Printed on
    // white with black ink regardless of the app's theme.
    win.document.write(`<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Activate your card</title>
    <style>
      * { box-sizing: border-box; }
      body {
        margin: 0;
        padding: 40px 32px;
        font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
        color: #0a0a0a;
        background: #fff;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 20px;
      }
      h1 { font-size: 20px; margin: 0; }
      p { margin: 0; }
      .hint { font-size: 13px; color: #525252; text-align: center; max-width: 320px; }
      .qr { padding: 16px; border: 1px solid #e5e5e5; border-radius: 12px; }
      .qr svg { display: block; width: 256px; height: 256px; }
      .url {
        font-family: ui-monospace, "SF Mono", Menlo, monospace;
        font-size: 11px;
        color: #404040;
        text-align: center;
        word-break: break-all;
        max-width: 340px;
      }
      @media print { body { padding: 24px; } }
    </style>
  </head>
  <body>
    <h1>Activate your card</h1>
    <p class="hint">Scan this QR with your wallet app to activate the card and link it to your account.</p>
    <div class="qr">${svg.outerHTML}</div>
    <p class="url">${escapeHtml(url)}</p>
    <script>window.focus();window.print();</script>
  </body>
</html>`)
    win.document.close()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader className="items-center text-center">
          <div className="mb-2 flex size-10 items-center justify-center rounded-md bg-muted">
            <Ticket className="size-5 text-muted-foreground" aria-hidden />
          </div>
          <DialogTitle>Activate card</DialogTitle>
          <DialogDescription>
            Share this one-time link or QR with the cardholder. Scanning it with
            their wallet claims the card and transfers it to their account.
          </DialogDescription>
        </DialogHeader>

        {state === 'blocked' ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            {errorMsg ??
              'This card has been blocked and can no longer be activated — delete it instead.'}
          </p>
        ) : state === 'error' ? (
          <p className="py-6 text-center text-sm text-destructive">{errorMsg}</p>
        ) : (
          // `min-w-0` lets this column shrink to the dialog width so the long,
          // unbreakable activation URL truncates instead of forcing overflow.
          <div className="flex w-full min-w-0 flex-col items-center gap-4 py-2">
            <div ref={qrRef} className="rounded-lg bg-white p-3">
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
                {url ?? 'Generating activation link…'}
              </p>
            </div>

            <div className="grid w-full grid-cols-3 gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleCopy}
                disabled={!url}
              >
                <Copy className="mr-2 size-4" />
                Copy
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleOpen}
                disabled={!url}
              >
                <ExternalLink className="mr-2 size-4" />
                Open
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handlePrint}
                disabled={!url}
              >
                <Printer className="mr-2 size-4" />
                Print
              </Button>
            </div>
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-2">
          {state !== 'blocked' && (
            <Button
              variant="outline"
              onClick={mint}
              disabled={state === 'loading'}
            >
              <RefreshCw className="mr-2 size-4" />
              Regenerate
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
