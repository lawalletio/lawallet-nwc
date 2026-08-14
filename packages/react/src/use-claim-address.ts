'use client'

import {
  LaWalletError,
  checkVerifyOnce,
  pollVerifyUrl,
  type RegistrationInvoice
} from '@lawallet-nwc/sdk'
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { useLaWalletContext } from './provider'

export const USERNAME_RE = /^[a-z0-9]+$/

// Key under which the in-flight invoice is stashed so a page refresh (or an
// accidental tab reload after a network drop) can restore the QR and resume
// polling instead of stranding a user who already paid. sessionStorage, not
// localStorage: scoped to the tab, cleared when it closes.
const PENDING_INVOICE_KEY = 'lawallet:pending-invoice'

/** Minimal WebLN surface — `enable` + `sendPayment` is all the flow needs. */
interface WebLnProvider {
  enable(): Promise<void>
  sendPayment(bolt11: string): Promise<{ preimage: string }>
}
type WebLnWindow = Window & { webln?: WebLnProvider }

export type ClaimAddressStep = 'username' | 'payment' | 'success'

type StoredInvoice = RegistrationInvoice & { username?: string }

export interface UseClaimAddressOptions {
  /**
   * Whether the flow is live — pass a dialog's `open` prop, or `true` for a
   * full-screen flow. Flipping to `false` resets all state.
   */
  active?: boolean
  initialUsername?: string
  /** Fired once the address is created (free path) or claimed (paid path). */
  onCreated?: (lightningAddress: string) => void
}

export interface ClaimAddressState {
  step: ClaimAddressStep
  username: string
  setUsername: (value: string) => void
  available: boolean | null
  checking: boolean
  formatError: string | null
  submitting: boolean
  submitDisabled: boolean
  domain: string
  /** Errors that would have been toasts in a full app — render as you like. */
  error: string | null
  handleSubmit: (e?: FormEvent) => Promise<void>
  // Payment step
  invoice: RegistrationInvoice | null
  paymentStatus: 'waiting' | 'detected' | 'expired'
  hasWebLn: boolean
  payingWithWallet: boolean
  manualChecking: boolean
  handleWebLnPay: () => Promise<void>
  handleManualCheck: () => Promise<void>
  /** Abort the payment attempt and return to the username picker. */
  backFromPayment: () => void
  // Success step
  claimedAddress: string | null
}

/**
 * Headless claim-a-lightning-address flow: choose username → optional paid
 * QR payment (402 → invoice → LUD-21 verify → preimage claim) → success.
 * A near-verbatim port of the LaWallet wallet's own claim screen, driven by
 * the SDK — render the returned state however fits your app.
 */
export function useClaimAddress({
  active = true,
  initialUsername = '',
  onCreated
}: UseClaimAddressOptions = {}): ClaimAddressState {
  const { client, settings, store } = useLaWalletContext()

  const [step, setStep] = useState<ClaimAddressStep>('username')
  const [username, setUsername] = useState(initialUsername)
  const [available, setAvailable] = useState<boolean | null>(null)
  const [checking, setChecking] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Payment step state
  const [invoice, setInvoice] = useState<RegistrationInvoice | null>(null)
  const [paymentStatus, setPaymentStatus] = useState<
    'waiting' | 'detected' | 'expired'
  >('waiting')
  const [hasWebLn, setHasWebLn] = useState(false)
  const [payingWithWallet, setPayingWithWallet] = useState(false)
  const [manualChecking, setManualChecking] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  // Guards against two settlement signals (poller + manual check / WebLN)
  // racing to claim the same invoice and double-firing the claim request.
  const claimingRef = useRef(false)

  const [claimedAddress, setClaimedAddress] = useState<string | null>(null)

  // Detect a WebLN provider (Alby / other Lightning browser extension).
  // Some extensions inject `window.webln` asynchronously, so re-check when
  // the flow becomes active and on entering the payment step.
  useEffect(() => {
    if (typeof window === 'undefined') return
    setHasWebLn(Boolean((window as WebLnWindow).webln))
  }, [active, step])

  const domain =
    settings?.domain || (client ? new URL(client.endpoint).hostname : '')
  const formatError =
    username.length === 0
      ? null
      : username.length > 16
        ? 'Max 16 characters.'
        : !USERNAME_RE.test(username)
          ? 'Lowercase letters and numbers only.'
          : null

  // Debounced availability check against the public endpoint.
  useEffect(() => {
    if (!active || step !== 'username') return
    if (formatError || !username) {
      setAvailable(null)
      return
    }
    let cancelled = false
    setChecking(true)
    const handle = setTimeout(async () => {
      try {
        const result = await client.addresses.checkAvailability(username)
        if (!cancelled) setAvailable(Boolean(result.available))
      } catch {
        // Rate-limited or unreachable — "unknown", never a false "taken".
        if (!cancelled) setAvailable(null)
      } finally {
        if (!cancelled) setChecking(false)
      }
    }, 300)
    return () => {
      cancelled = true
      clearTimeout(handle)
    }
  }, [username, formatError, active, step, client])

  // Reset when the flow goes inactive.
  useEffect(() => {
    if (!active) {
      abortRef.current?.abort()
      claimingRef.current = false
      if (typeof window !== 'undefined') {
        sessionStorage.removeItem(PENDING_INVOICE_KEY)
      }
      setStep('username')
      setUsername(initialUsername)
      setAvailable(null)
      setChecking(false)
      setInvoice(null)
      setPaymentStatus('waiting')
      setClaimedAddress(null)
      setSubmitting(false)
      setPayingWithWallet(false)
      setManualChecking(false)
      setError(null)
    }
  }, [initialUsername, active])

  // Cleanup polling on unmount.
  useEffect(() => {
    return () => {
      abortRef.current?.abort()
    }
  }, [])

  const finishSuccess = useCallback(
    (address: string) => {
      if (typeof window !== 'undefined') {
        sessionStorage.removeItem(PENDING_INVOICE_KEY)
      }
      abortRef.current?.abort()
      store.invalidate('/api/wallet/addresses')
      store.invalidate('/api/users/me')
      setClaimedAddress(address)
      setStep('success')
      onCreated?.(address)
    },
    [onCreated, store]
  )

  // Single entry point for turning a settlement preimage into a claimed
  // address. Shared by the background poller, the manual "check now" button
  // and the WebLN path so they can't race or diverge.
  const claimWithPreimage = useCallback(
    async (invoiceId: string, preimage: string) => {
      if (claimingRef.current) return
      claimingRef.current = true
      setPaymentStatus('detected')
      try {
        const claimResult = await client.registration.claimInvoice(
          invoiceId,
          preimage
        )
        if (claimResult.success) {
          finishSuccess(claimResult.lightningAddress ?? `${username}@${domain}`)
        }
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : 'Failed to claim address'
        // The invoice was already claimed (e.g. a prior claim succeeded but
        // its response was lost). The address exists and is ours.
        if (msg.toLowerCase().includes('already been claimed')) {
          finishSuccess(`${username}@${domain}`)
          return
        }
        setError(msg)
        if (msg.toLowerCase().includes('taken')) {
          setStep('username')
        } else {
          // Transient failure — drop back to waiting so the poller or a
          // manual re-check can retry with the same preimage.
          setPaymentStatus('waiting')
        }
      } finally {
        claimingRef.current = false
      }
    },
    [client, domain, finishSuccess, username]
  )

  const startLud21Polling = useCallback(
    (invoiceData: RegistrationInvoice) => {
      if (!invoiceData.verify) return
      const controller = new AbortController()
      abortRef.current = controller

      // Poll for the FULL lifetime of the invoice — a shorter cutoff strands
      // users whose payment lands late while the bolt11 is still valid.
      const msUntilExpiry =
        new Date(invoiceData.expiresAt).getTime() - Date.now()

      pollVerifyUrl(invoiceData.verify, {
        signal: controller.signal,
        timeout: Math.max(msUntilExpiry, 0)
      })
        .then(result => {
          if (result.settled && result.preimage) {
            void claimWithPreimage(invoiceData.id, result.preimage)
          }
        })
        .catch(err => {
          // Anything other than an explicit abort means the invoice ran out
          // its clock without settling.
          if ((err as Error)?.message !== 'Polling aborted') {
            setPaymentStatus('expired')
          }
        })
    },
    [claimWithPreimage]
  )

  const mintInvoiceAndShowQr = useCallback(async () => {
    try {
      const result = await client.registration.createInvoice(username)
      if ('free' in result && result.free) {
        setError(
          'Paid registration is configured but incomplete. Contact the operator.'
        )
        return
      }
      const invoiceData = result as RegistrationInvoice
      // Persist before showing the QR so a refresh mid-payment can recover.
      if (typeof window !== 'undefined') {
        sessionStorage.setItem(
          PENDING_INVOICE_KEY,
          JSON.stringify({ ...invoiceData, username } satisfies StoredInvoice)
        )
      }
      claimingRef.current = false
      setInvoice(invoiceData)
      setPaymentStatus('waiting')
      setStep('payment')
      startLud21Polling(invoiceData)
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to generate invoice'
      )
    }
  }, [client, username, startLud21Polling])

  // Restore a pending invoice after a page refresh. Runs once per mount.
  const restoreAttemptedRef = useRef(false)
  useEffect(() => {
    if (restoreAttemptedRef.current || !active) return
    restoreAttemptedRef.current = true
    if (typeof window === 'undefined') return
    const raw = sessionStorage.getItem(PENDING_INVOICE_KEY)
    if (!raw) return
    try {
      const saved = JSON.parse(raw) as StoredInvoice
      if (new Date(saved.expiresAt).getTime() <= Date.now()) {
        sessionStorage.removeItem(PENDING_INVOICE_KEY)
        return
      }
      if (saved.username) setUsername(saved.username)
      setInvoice(saved)
      setPaymentStatus('waiting')
      setStep('payment')
      startLud21Polling(saved)
    } catch {
      sessionStorage.removeItem(PENDING_INVOICE_KEY)
    }
  }, [active, startLud21Polling])

  const handleSubmit = useCallback(
    async (e?: FormEvent) => {
      e?.preventDefault()
      if (formatError || !username || available === false) return
      setSubmitting(true)
      setError(null)
      try {
        // Happy path: direct create (paid mode off, or operator bypass).
        await client.addresses.create({ username })
        finishSuccess(`${username}@${domain}`)
      } catch (err) {
        // Payment required → branch into the invoice + QR flow.
        if (err instanceof LaWalletError && err.status === 402) {
          await mintInvoiceAndShowQr()
          return
        }
        setError(
          err instanceof Error ? err.message : 'Failed to create address'
        )
      } finally {
        setSubmitting(false)
      }
    },
    [
      available,
      client,
      domain,
      finishSuccess,
      formatError,
      mintInvoiceAndShowQr,
      username
    ]
  )

  /**
   * Pay the current invoice via a WebLN provider (Alby / similar). The
   * extension returns the preimage, so we claim immediately; the LUD-21
   * poller stays as the fallback.
   */
  const handleWebLnPay = useCallback(async () => {
    if (!invoice?.bolt11) return
    const w = window as WebLnWindow
    if (!w.webln) return
    setPayingWithWallet(true)
    try {
      await w.webln.enable()
      const res = await w.webln.sendPayment(invoice.bolt11)
      if (res?.preimage) {
        await claimWithPreimage(invoice.id, res.preimage)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Wallet payment failed'
      // Most common case: user clicked "reject" in the extension.
      if (!/reject|cancel|denied/i.test(msg)) setError(msg)
    } finally {
      setPayingWithWallet(false)
    }
  }, [claimWithPreimage, invoice])

  /**
   * Manual settlement check — for "I paid but the screen didn't move" or a
   * lost connection. One-shot LUD-21 verify, claims if the payment landed.
   */
  const handleManualCheck = useCallback(async () => {
    if (!invoice?.verify) {
      setError('This invoice can’t be re-checked — generate a new one.')
      return
    }
    setManualChecking(true)
    try {
      const result = await checkVerifyOnce(invoice.verify)
      if (result.settled && result.preimage) {
        await claimWithPreimage(invoice.id, result.preimage)
      }
    } catch {
      setError(
        'Couldn’t reach the payment verifier — check your connection and try again.'
      )
    } finally {
      setManualChecking(false)
    }
  }, [claimWithPreimage, invoice])

  // Abandoning the invoice, not the "new address" intent.
  const backFromPayment = useCallback(() => {
    abortRef.current?.abort()
    claimingRef.current = false
    if (typeof window !== 'undefined') {
      sessionStorage.removeItem(PENDING_INVOICE_KEY)
    }
    setStep('username')
    setInvoice(null)
    setPaymentStatus('waiting')
    setManualChecking(false)
  }, [])

  const submitDisabled =
    submitting ||
    checking ||
    !!formatError ||
    username.length === 0 ||
    available === false

  return {
    step,
    username,
    setUsername,
    available,
    checking,
    formatError,
    submitting,
    submitDisabled,
    domain,
    error,
    handleSubmit,
    invoice,
    paymentStatus,
    hasWebLn,
    payingWithWallet,
    manualChecking,
    handleWebLnPay,
    handleManualCheck,
    backFromPayment,
    claimedAddress
  }
}
