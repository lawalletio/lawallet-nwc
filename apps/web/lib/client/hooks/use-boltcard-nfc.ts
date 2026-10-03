'use client'

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore
} from 'react'
import {
  BoltcardPayError,
  payDisplayedInvoiceFromCard
} from '@/lib/client/boltcard-pay'
import { firstBoltcardUrl } from '@/lib/client/ndef-url'
import {
  classifyNfcStartError,
  getNDEFReader,
  isNfcAbortError,
  readNfcPermission,
  type NDEFReaderConstructor,
  type NDEFReaderLike,
  type NDEFReadingEvent
} from '@/lib/client/web-nfc'

export type BoltcardNfcPhase =
  | 'checking'
  | 'unsupported'
  | 'needs-permission'
  | 'denied'
  | 'scanning'
  | 'charging'
  | 'accepted'
  | 'error'

/** Keep the tap celebration on screen long enough to read before summary. */
export const BOLTCARD_SUCCESS_HOLD_MS = 1100

const READ_ERROR = 'Could not read the card. Hold it steady and try again.'
const NO_LINK = 'This tag has no BoltCard link.'
const START_ERROR = 'Could not start NFC. Try again.'

type NfcSupport = 'unknown' | 'yes' | 'no'

function subscribeNfcSupport() {
  return () => {}
}

function getNfcSupport(): NfcSupport {
  return getNDEFReader() ? 'yes' : 'no'
}

export interface BoltcardNfcSession {
  phase: BoltcardNfcPhase
  /** Readable failure copy. Null while scanning or after a successful tap. */
  detail: string | null
  /** User-gesture entry when the browser will not start a scan on mount. */
  enable: () => void
  /** Clear an error and listen for another tap, restarting the scan if it died. */
  retry: () => void
}

/**
 * Web NFC session for the receive-invoice screen.
 *
 * Starts as soon as an invoice is on screen (mobile-pos starts when the
 * invoice is ready). Chrome still requires a transient user activation for
 * `scan()` on a fresh permission, so a failed mount start surfaces an Allow
 * NFC button instead of failing closed. Leaving the screen aborts the reader.
 */
export function useBoltcardNfc(input: {
  active: boolean
  bolt11: string | null
  amountSats: number | null
  onAccepted?: () => void
}): BoltcardNfcSession {
  const { active, bolt11, amountSats, onAccepted } = input
  const support = useSyncExternalStore(
    subscribeNfcSupport,
    getNfcSupport,
    (): NfcSupport => 'unknown'
  )
  const [sessionPhase, setPhase] = useState<BoltcardNfcPhase>('checking')
  const [detail, setDetail] = useState<string | null>(null)

  const abortRef = useRef<AbortController | null>(null)
  const readerRef = useRef<NDEFReaderLike | null>(null)
  const onReadingRef = useRef<((event: NDEFReadingEvent) => void) | null>(null)
  const onErrorRef = useRef<((event: Event) => void) | null>(null)
  const generationRef = useRef(0)
  const busyRef = useRef(false)
  const acceptedRef = useRef(false)
  const listeningRef = useRef(false)
  const invoiceRef = useRef({ bolt11, amountSats })
  const onAcceptedRef = useRef(onAccepted)

  useEffect(() => {
    invoiceRef.current = { bolt11, amountSats }
    onAcceptedRef.current = onAccepted
  }, [bolt11, amountSats, onAccepted])

  const detachReader = useCallback(() => {
    const reader = readerRef.current
    const onReading = onReadingRef.current
    const onError = onErrorRef.current
    if (reader && onReading) {
      reader.removeEventListener('reading', onReading as EventListener)
    }
    if (reader && onError) {
      reader.removeEventListener('readingerror', onError as EventListener)
    }
    readerRef.current = null
    onReadingRef.current = null
    onErrorRef.current = null
    listeningRef.current = false
  }, [])

  const stop = useCallback(() => {
    generationRef.current += 1
    abortRef.current?.abort()
    abortRef.current = null
    detachReader()
  }, [detachReader])

  const begin = useCallback(
    async (Ctor: NDEFReaderConstructor) => {
      stop()
      const generation = generationRef.current
      busyRef.current = false

      // scan() must run in the same turn as the click that allowed it. Awaiting
      // the Permissions API first drops Chrome's transient user activation, so
      // a denied permission is classified from the scan() rejection instead.
      const controller = new AbortController()
      abortRef.current = controller
      const reader = new Ctor()
      readerRef.current = reader

      const onReading = (event: NDEFReadingEvent) => {
        if (generation !== generationRef.current) return
        if (busyRef.current || acceptedRef.current) return
        const url = firstBoltcardUrl(event.message?.records)
        if (!url) {
          setDetail(NO_LINK)
          setPhase('error')
          return
        }
        const invoice = invoiceRef.current
        if (!invoice.bolt11 || invoice.amountSats == null) return
        busyRef.current = true
        setDetail(null)
        setPhase('charging')
        void payDisplayedInvoiceFromCard({
          cardUrl: url,
          bolt11: invoice.bolt11,
          amountSats: invoice.amountSats
        })
          .then(() => {
            if (generation !== generationRef.current) return
            acceptedRef.current = true
            setDetail(null)
            setPhase('accepted')
            abortRef.current?.abort()
            abortRef.current = null
            detachReader()
            onAcceptedRef.current?.()
          })
          .catch(err => {
            if (generation !== generationRef.current) return
            busyRef.current = false
            setDetail(
              err instanceof BoltcardPayError
                ? err.message
                : 'The card payment was rejected.'
            )
            setPhase('error')
          })
      }

      const onReadingError = () => {
        if (generation !== generationRef.current) return
        if (busyRef.current || acceptedRef.current) return
        setDetail(READ_ERROR)
        setPhase('error')
      }

      onReadingRef.current = onReading
      onErrorRef.current = onReadingError
      reader.addEventListener('reading', onReading)
      reader.addEventListener('readingerror', onReadingError)

      try {
        await reader.scan({ signal: controller.signal })
        if (generation !== generationRef.current || controller.signal.aborted) {
          return
        }
        listeningRef.current = true
        setDetail(null)
        setPhase('scanning')
      } catch (err) {
        if (
          generation !== generationRef.current ||
          controller.signal.aborted ||
          isNfcAbortError(err)
        ) {
          return
        }
        detachReader()
        const latestPermission = await readNfcPermission()
        if (generation !== generationRef.current) return
        const kind = classifyNfcStartError(err, latestPermission)
        if (kind === 'aborted') return
        if (kind === 'unsupported') {
          setDetail(null)
          setPhase('unsupported')
          return
        }
        if (kind === 'needs-permission') {
          setDetail(null)
          setPhase('needs-permission')
          return
        }
        if (kind === 'denied') {
          setDetail(
            'NFC permission was blocked. Allow it in the browser, then try again.'
          )
          setPhase('denied')
          return
        }
        const message = err instanceof Error ? err.message : START_ERROR
        setDetail(message || START_ERROR)
        setPhase('error')
      }
    },
    [detachReader, stop]
  )

  useEffect(() => {
    if (!active || !bolt11 || support !== 'yes') {
      stop()
      return
    }
    acceptedRef.current = false
    const Ctor = getNDEFReader()
    if (!Ctor) return
    // Defer past this effect so the reader start is not a synchronous
    // setState in the effect body. `enable()` still calls `begin` directly
    // from the click so Chrome keeps the user gesture.
    const timer = window.setTimeout(() => {
      void begin(Ctor)
    }, 0)
    return () => {
      window.clearTimeout(timer)
      stop()
    }
  }, [active, bolt11, support, begin, stop])

  const enable = useCallback(() => {
    const Ctor = getNDEFReader()
    if (!Ctor) {
      setPhase('unsupported')
      return
    }
    acceptedRef.current = false
    void begin(Ctor)
  }, [begin])

  const retry = useCallback(() => {
    if (listeningRef.current) {
      busyRef.current = false
      setDetail(null)
      setPhase('scanning')
      return
    }
    enable()
  }, [enable])

  const phase: BoltcardNfcPhase =
    support === 'no'
      ? 'unsupported'
      : support === 'unknown'
        ? 'checking'
        : sessionPhase

  return {
    phase,
    detail: phase === 'unsupported' ? null : detail,
    enable,
    retry
  }
}
