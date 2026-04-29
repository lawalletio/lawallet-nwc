'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { BrowserMultiFormatReader } from '@zxing/library'
import { AlertCircle, Camera } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { ScreenHeader } from '@/components/wallet/shared/screen-header'
import { parseDestination } from '@/lib/client/nwc/parse-destination'
import { sendActions, type ResolvedRecipient } from '@/lib/client/wallet-flow-store'

/**
 * Auto-opening QR scanner reachable from the home tabbar's center button.
 * On a successful scan, parses the payload as a Lightning destination and
 * routes into the send flow. Anything we can't parse surfaces a toast and
 * keeps the camera running so the user can try a different code.
 */
export function ScanScreen() {
  const router = useRouter()
  const videoRef = useRef<HTMLVideoElement>(null)
  const readerRef = useRef<BrowserMultiFormatReader | null>(null)
  const [permission, setPermission] = useState<'idle' | 'requesting' | 'granted' | 'denied'>('idle')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function start() {
      setPermission('requesting')
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
        })
        stream.getTracks().forEach(t => t.stop())
        if (cancelled) return
        setPermission('granted')

        const reader = new BrowserMultiFormatReader()
        readerRef.current = reader
        await reader.decodeFromVideoDevice(
          null,
          videoRef.current!,
          (result, err) => {
            if (cancelled) return
            if (result) handleResult(result.getText())
            // Ignore NotFoundException — fires every frame without a match.
            if (err && err.name !== 'NotFoundException') {
              console.warn('[scan]', err)
            }
          },
        )
      } catch (err) {
        if (cancelled) return
        setPermission('denied')
        setError(err instanceof Error ? err.message : 'Camera unavailable')
      }
    }

    start()

    return () => {
      cancelled = true
      readerRef.current?.reset()
      readerRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function handleResult(text: string) {
    try {
      const destination = parseDestination(text)
      const recipient: ResolvedRecipient = { raw: text.trim(), destination }
      sendActions.setRecipient(recipient)

      readerRef.current?.reset()

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
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unrecognized QR code'
      toast.error(message)
    }
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
            </div>

            <p className="text-center text-sm text-muted-foreground">
              Point your camera at a Lightning invoice, LNURL, or address QR.
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
