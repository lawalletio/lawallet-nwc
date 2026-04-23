'use client'

import React, { useEffect, useRef, useState } from 'react'
import { Nfc, AlertTriangle } from 'lucide-react'
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
import { formatCardId } from '@/lib/client/nfc-card-id'

/**
 * Web NFC types — only Chrome for Android ships `NDEFReader` at the moment,
 * so the type isn't in the default `lib.dom`. Declare the narrow surface we
 * use so TypeScript compiles everywhere and we can feature-detect at
 * runtime.
 */
type NDEFReadingEvent = Event & {
  serialNumber?: string
}
interface NDEFReaderLike {
  scan(opts?: { signal?: AbortSignal }): Promise<void>
  addEventListener(
    type: 'reading',
    listener: (event: NDEFReadingEvent) => void,
  ): void
  addEventListener(type: 'readingerror', listener: (event: Event) => void): void
  removeEventListener(type: string, listener: EventListener): void
}
interface NDEFReaderConstructor {
  new (): NDEFReaderLike
}

function getNDEFReader(): NDEFReaderConstructor | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as { NDEFReader?: NDEFReaderConstructor }
  return w.NDEFReader ?? null
}

type ScanState = 'idle' | 'scanning' | 'unsupported' | 'error'

/**
 * Modal that scans an NFC tag via the Web NFC API and hands the card UID
 * back to the parent. Requires Chrome for Android (plus user gesture + HTTPS
 * or localhost); on unsupported browsers we explain and let the user fall
 * back to the manual field.
 */
export function NfcScanDialog({
  open,
  onOpenChange,
  onDetected,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onDetected: (cardId: string) => void
}) {
  const [state, setState] = useState<ScanState>('idle')
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const readerRef = useRef<NDEFReaderLike | null>(null)

  // Detect support lazily so SSR doesn't explode.
  useEffect(() => {
    if (!open) return
    const Ctor = getNDEFReader()
    if (!Ctor) {
      setState('unsupported')
      return
    }
    start(Ctor)
    return () => {
      abortRef.current?.abort()
      abortRef.current = null
      readerRef.current = null
    }
    // We intentionally re-run on `open` so closing + reopening tries again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  async function start(Ctor: NDEFReaderConstructor) {
    setError(null)
    setState('scanning')

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    const reader = new Ctor()
    readerRef.current = reader

    const handleReading = (event: NDEFReadingEvent) => {
      const raw = event.serialNumber
      if (!raw) return
      const canonical = formatCardId(raw)
      if (!canonical) {
        // Some readers expose a non-standard UID length; surface it
        // clearly rather than silently dropping the read.
        setError(`Unrecognised card UID: ${raw}`)
        setState('error')
        return
      }
      onDetected(canonical)
      abortRef.current?.abort()
      onOpenChange(false)
    }

    const handleError = () => {
      setError('Could not read card. Try again.')
      setState('error')
    }

    reader.addEventListener('reading', handleReading)
    reader.addEventListener('readingerror', handleError)

    try {
      await reader.scan({ signal: controller.signal })
    } catch (err) {
      if (controller.signal.aborted) return
      const message =
        err instanceof Error ? err.message : 'Failed to start NFC scan'
      setError(message)
      setState('error')
      // Don't keep a dead reader around.
      reader.removeEventListener('reading', handleReading as EventListener)
      reader.removeEventListener('readingerror', handleError)
    }
  }

  function handleOpenChange(next: boolean) {
    if (!next) {
      abortRef.current?.abort()
      abortRef.current = null
      readerRef.current = null
      setState('idle')
      setError(null)
    }
    onOpenChange(next)
  }

  function handleRetry() {
    const Ctor = getNDEFReader()
    if (Ctor) start(Ctor)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader className="items-center text-center">
          <div className="mb-2 flex size-10 items-center justify-center rounded-md bg-muted">
            {state === 'unsupported' || state === 'error' ? (
              <AlertTriangle
                className="size-5 text-muted-foreground"
                aria-hidden
              />
            ) : (
              <Nfc className="size-5 text-muted-foreground" aria-hidden />
            )}
          </div>
          <DialogTitle>
            {state === 'unsupported'
              ? 'NFC not supported'
              : state === 'error'
                ? 'Scan failed'
                : 'Scan NFC card'}
          </DialogTitle>
          <DialogDescription>
            {state === 'unsupported'
              ? 'This browser doesn’t expose Web NFC. Use Chrome on Android, or enter the card UID manually.'
              : state === 'error'
                ? error ?? 'Could not read the card.'
                : 'Hold an NFC card close to the back of your device.'}
          </DialogDescription>
        </DialogHeader>

        {state === 'scanning' && (
          <div className="flex flex-col items-center gap-3 py-4">
            <div className="relative flex size-24 items-center justify-center">
              <span className="absolute inset-0 animate-ping rounded-full bg-primary/10" />
              <span className="absolute inset-2 animate-pulse rounded-full bg-primary/10" />
              <Nfc className="relative size-10 text-primary" aria-hidden />
            </div>
            <p className="text-xs text-muted-foreground">
              Waiting for a card…
            </p>
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            {state === 'scanning' ? 'Cancel' : 'Close'}
          </Button>
          {state === 'error' && (
            <Button variant="theme" onClick={handleRetry}>
              Try again
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Convenience helper for call-sites that want to show a friendly toast
 * without importing the detection function directly.
 */
export function isWebNfcSupported(): boolean {
  return getNDEFReader() !== null
}
