'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { BrowserMultiFormatReader } from '@zxing/library'
import { AlertCircle, Camera, ExternalLink } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { ScreenHeader } from '@/components/wallet/shared/screen-header'
import {
  parseDestination,
  type ParsedDestination,
} from '@/lib/client/nwc/parse-destination'
import { parseActivationUrl, isSameInstanceHost } from '@/lib/client/activation-url'
import { looksLikeLnurl, resolveLnurl } from '@/lib/client/lnurl-scan'
import {
  sendActions,
  withdrawActions,
  type ResolvedRecipient,
} from '@/lib/client/wallet-flow-store'
import { trackEvent } from '@/lib/analytics/gtag'
import { AnalyticsEvent } from '@/lib/analytics/events'

/**
 * Auto-opening QR scanner reachable from the home tabbar's center button.
 *
 * Dispatches a scanned payload to the right flow:
 *  - **Card activation URL** (`<host>/wallet/activate/<id>`) — same-instance
 *    codes route in-app (client navigation preserves the wallet session, so an
 *    already-logged-in user gets the activation confirmation instead of a
 *    logged-out "create account" screen); a foreign host surfaces an error with
 *    an "open externally" escape hatch.
 *  - **LNURL** — resolved to pay vs withdraw (a network round-trip), then routed
 *    into the send flow or the withdraw claim flow respectively.
 *  - **Invoice / Lightning address / npub** — parsed and sent into the send flow.
 *
 * Anything unrecognized surfaces a toast and keeps the camera running.
 */
export function ScanScreen() {
  const router = useRouter()
  const videoRef = useRef<HTMLVideoElement>(null)
  const readerRef = useRef<BrowserMultiFormatReader | null>(null)
  const cancelledRef = useRef(false)
  // Guards so the per-frame decode callback can't double-fire while an async
  // classification (LNURL fetch) is in flight or after we've committed to a route.
  const handledRef = useRef(false)
  const processingRef = useRef(false)

  const [permission, setPermission] = useState<
    'idle' | 'requesting' | 'granted' | 'denied'
  >('idle')
  const [error, setError] = useState<string | null>(null)
  const [resolving, setResolving] = useState(false)
  const [notice, setNotice] = useState<{ message: string; url: string } | null>(
    null,
  )
  // Bumped by "Scan another" to re-run the scanner effect after the notice
  // panel is dismissed and the <video> is back in the tree.
  const [restartKey, setRestartKey] = useState(0)

  const stopScanner = useCallback(() => {
    readerRef.current?.reset()
    readerRef.current = null
  }, [])

  const routeInvoiceOrAddress = useCallback(
    (text: string, destination: ParsedDestination) => {
      const recipient: ResolvedRecipient = { raw: text.trim(), destination }
      sendActions.setRecipient(recipient)
      if (
        destination.kind === 'invoice' &&
        destination.amountSats !== null &&
        destination.amountSats > 0
      ) {
        sendActions.setAmount(destination.amountSats)
        router.replace('/wallet/send/preview')
      } else {
        router.replace('/wallet/send/amount')
      }
    },
    [router],
  )

  const handleResult = useCallback(
    async (text: string) => {
      if (handledRef.current || processingRef.current) return

      // 1. Card activation URL — same-instance routes in-app, foreign warns.
      const activation = parseActivationUrl(text)
      if (activation) {
        handledRef.current = true
        stopScanner()
        if (isSameInstanceHost(activation.host)) {
          trackEvent(AnalyticsEvent.WALLET_SCAN_USED, { kind: 'activation' })
          router.replace(`/wallet/activate/${activation.tokenId}`)
        } else {
          setNotice({
            message: `This card belongs to ${activation.host}, not ${window.location.host}. Open it there to activate.`,
            url: text.trim(),
          })
        }
        return
      }

      // 2. LNURL — classify pay vs withdraw with a network round-trip.
      if (looksLikeLnurl(text)) {
        processingRef.current = true
        setResolving(true)
        try {
          const resolved = await resolveLnurl(text)
          if (cancelledRef.current) return
          if (resolved?.kind === 'withdraw') {
            handledRef.current = true
            stopScanner()
            trackEvent(AnalyticsEvent.WALLET_SCAN_USED, { kind: 'withdraw' })
            withdrawActions.setParams(resolved.params)
            router.replace('/wallet/withdraw')
            return
          }
          if (resolved?.kind === 'pay') {
            handledRef.current = true
            stopScanner()
            trackEvent(AnalyticsEvent.WALLET_SCAN_USED, { kind: 'lnurl-pay' })
            routeInvoiceOrAddress(text, {
              kind: 'lnurl-pay',
              lnurlpUrl: resolved.lnurlpUrl,
              address: null,
              username: null,
              host: null,
            })
            return
          }
        } catch (err) {
          const message =
            err instanceof Error ? err.message : 'Unrecognized LNURL'
          toast.error(message)
        } finally {
          processingRef.current = false
          setResolving(false)
        }
        return
      }

      // 3. Invoice / Lightning address / npub.
      try {
        const destination = parseDestination(text)
        handledRef.current = true
        stopScanner()
        trackEvent(AnalyticsEvent.WALLET_SCAN_USED, { kind: destination.kind })
        routeInvoiceOrAddress(text, destination)
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Unrecognized QR code'
        toast.error(message)
      }
    },
    [router, routeInvoiceOrAddress, stopScanner],
  )

  const startScanner = useCallback(async () => {
    setPermission('requesting')
    setError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      })
      stream.getTracks().forEach(t => t.stop())
      if (cancelledRef.current) return
      setPermission('granted')

      // Load the (heavy) zxing decoder only now that the scan screen is open,
      // keeping it out of the shared wallet bundle.
      const { BrowserMultiFormatReader } = await import('@zxing/library')
      if (cancelledRef.current) return
      const reader = new BrowserMultiFormatReader()
      readerRef.current = reader
      await reader.decodeFromVideoDevice(null, videoRef.current!, (result, err) => {
        if (cancelledRef.current) return
        if (result) void handleResult(result.getText())
        // Ignore NotFoundException — fires every frame without a match.
        if (err && err.name !== 'NotFoundException') {
          console.warn('[scan]', err)
        }
      })
    } catch (err) {
      if (cancelledRef.current) return
      setPermission('denied')
      setError(err instanceof Error ? err.message : 'Camera unavailable')
    }
  }, [handleResult])

  // Start the camera whenever we're in the scanning view. Skipped while the
  // foreign-domain notice is up (the <video> is unmounted then); "Scan another"
  // clears the notice and bumps `restartKey`, re-running this with the element
  // back in the tree.
  useEffect(() => {
    if (notice) return
    cancelledRef.current = false
    handledRef.current = false
    processingRef.current = false
    startScanner()

    return () => {
      cancelledRef.current = true
      readerRef.current?.reset()
      readerRef.current = null
    }
  }, [notice, restartKey, startScanner])

  // Reset after a foreign-domain warning so the user can scan another code.
  const scanAgain = useCallback(() => {
    setNotice(null)
    setRestartKey(k => k + 1)
  }, [])

  if (notice) {
    return (
      <div className="flex flex-1 flex-col bg-background">
        <ScreenHeader
          title="Scan"
          closeStyle
          onBack={() => router.replace('/wallet')}
        />
        <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 pb-10 text-center">
          <AlertCircle className="size-10 text-lw-gold" />
          <h2 className="text-base font-semibold text-foreground">
            Different community
          </h2>
          <p className="max-w-xs text-sm text-muted-foreground">
            {notice.message}
          </p>
          <div className="flex w-full max-w-xs flex-col gap-2 pt-2">
            <Button
              onClick={() => window.open(notice.url, '_blank', 'noopener')}
            >
              <ExternalLink className="size-4" />
              Open link
            </Button>
            <Button variant="secondary" onClick={scanAgain}>
              Scan another
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col bg-background">
      <ScreenHeader title="Scan" closeStyle onBack={() => router.replace('/wallet')} />

      <div className="relative flex flex-1 flex-col items-center justify-center gap-6 px-6 pb-10">
        {permission === 'denied' ? (
          <div className="flex flex-col items-center gap-3 text-center">
            <AlertCircle className="size-10 text-destructive" />
            <h2 className="text-base font-semibold text-foreground">
              Camera unavailable
            </h2>
            <p className="text-sm text-muted-foreground">{error}</p>
            <Button variant="secondary" onClick={() => router.replace('/wallet')}>
              Back to wallet
            </Button>
          </div>
        ) : (
          <>
            <div className="relative aspect-square w-full max-w-sm overflow-hidden rounded-3xl border border-border bg-black">
              <video
                ref={videoRef}
                playsInline
                muted
                className="h-full w-full object-cover"
              />
              <ScannerFrame />
              {permission !== 'granted' && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/70 text-center text-muted-foreground">
                  <Camera className="size-10" />
                  <span className="text-sm">Requesting camera access…</span>
                </div>
              )}
              {resolving && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/70 text-center text-muted-foreground">
                  <Spinner size={32} />
                  <span className="text-sm">Reading code…</span>
                </div>
              )}
            </div>

            <p className="text-center text-sm text-muted-foreground">
              Point your camera at a Lightning invoice, address, LNURL, or card QR.
            </p>
          </>
        )}
      </div>
    </div>
  )
}

function ScannerFrame() {
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
      <div className="size-3/4 rounded-2xl border-2 border-foreground/40 shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]" />
    </div>
  )
}
