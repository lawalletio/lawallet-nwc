'use client'

import { useState, useEffect, useRef, useCallback, type FormEvent } from 'react'
import { toast } from 'sonner'
import { useSettings } from '@/lib/client/hooks/use-settings'
import { useAddressMutations } from '@/lib/client/hooks/use-wallet-addresses'
import { useAuth } from '@/components/admin/auth-context'
import { pollVerifyUrl, checkVerifyOnce } from '@/lib/client/lnurl'
import { ApiClientError } from '@/lib/client/api-client'

export const USERNAME_RE = /^[a-z0-9]+$/

// Key under which the in-flight invoice is stashed so a page refresh (or an
// accidental tab reload after a network drop) can restore the QR and resume
// polling instead of stranding a user who already paid. sessionStorage, not
// localStorage: scoped to the tab, cleared when it closes.
const PENDING_INVOICE_KEY = 'lawallet:pending-invoice'

/**
 * Minimal shape of the `window.webln` object (WebLN / LNURL-auth browser
 * extensions). We only use `enable` + `sendPayment`; everything else is
 * intentionally omitted.
 */
interface WebLnProvider {
  enable(): Promise<void>
  sendPayment(bolt11: string): Promise<{ preimage: string }>
}
type WebLnWindow = Window & { webln?: WebLnProvider }

export type NewAddressStep = 'username' | 'payment' | 'success'

export interface InvoiceData {
  id: string
  bolt11: string
  paymentHash: string
  amountSats: number
  verify?: string
  expiresAt: string
  // Carried only in the sessionStorage copy so a refresh can restore the
  // claimed username in the payment header. Absent from the API response.
  username?: string
}

export interface UseNewAddressFlowOptions {
  /**
   * Whether the flow is live. The dialog passes its `open` prop; the
   * full-screen wallet screen passes `true` (it's "open" for its whole
   * mounted life). When this flips to `false`, all step state resets.
   */
  active: boolean
  initialUsername?: string
  /** Fired once the address is created (free path) or claimed (paid path). */
  onCreated: () => void
}

export interface NewAddressFlowState {
  step: NewAddressStep
  username: string
  setUsername: (value: string) => void
  available: boolean | null
  checking: boolean
  formatError: string | null
  submitting: boolean
  submitDisabled: boolean
  domain: string
  handleSubmit: (e?: FormEvent) => Promise<void>
  // Payment step
  invoice: InvoiceData | null
  paymentStatus: 'waiting' | 'detected' | 'expired'
  copied: boolean
  hasWebLn: boolean
  payingWithWallet: boolean
  manualChecking: boolean
  handleWebLnPay: () => Promise<void>
  handleCopy: () => void
  handleManualCheck: () => Promise<void>
  mintInvoiceAndShowQr: () => Promise<void>
  /** Abort the payment attempt and return to the username picker. */
  backFromPayment: () => void
  // Success step
  claimedAddress: string | null
}

/**
 * Headless claim-a-lightning-address flow. Holds the entire state machine
 * (choose username → optional paid QR payment → success) so it can drive both
 * the admin `NewAddressDialog` modal and the full-screen wallet claim screen
 * without duplicating the availability check, the 402→invoice/WebLN/LUD-21
 * verify/claim paid path, or the refresh-resume logic.
 *
 * If paid registration is on and the caller doesn't bypass, the POST to
 * /api/wallet/addresses returns 402 — we then mint a LUD-16 invoice via
 * POST /api/invoices with purpose `wallet-address` and surface the payment
 * step. Once the LUD-21 `verify` URL reports settled, we claim with the
 * preimage and the server creates the address on the claim route.
 */
export function useNewAddressFlow({
  active,
  initialUsername = '',
  onCreated
}: UseNewAddressFlowOptions): NewAddressFlowState {
  const { data: settings } = useSettings()
  const { apiClient } = useAuth()
  const { createAddress, creating } = useAddressMutations()

  const [step, setStep] = useState<NewAddressStep>('username')
  const [username, setUsername] = useState(initialUsername)
  const [available, setAvailable] = useState<boolean | null>(null)
  const [checking, setChecking] = useState(false)
  // Local submitting flag covers BOTH legs of the create path — the
  // `createAddress` mutation and the follow-up invoice mint on 402 —
  // so the Create button stays in its spinner state until the UI
  // actually advances to the payment (or success) step.
  const [submitting, setSubmitting] = useState(false)

  // Payment step state
  const [invoice, setInvoice] = useState<InvoiceData | null>(null)
  const [paymentStatus, setPaymentStatus] = useState<
    'waiting' | 'detected' | 'expired'
  >('waiting')
  const [copied, setCopied] = useState(false)
  const [hasWebLn, setHasWebLn] = useState(false)
  const [payingWithWallet, setPayingWithWallet] = useState(false)
  const [manualChecking, setManualChecking] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  // Guards against two settlement signals (poller + manual check / WebLN)
  // racing to claim the same invoice and double-firing the claim request.
  const claimingRef = useRef(false)

  // Success step state
  const [claimedAddress, setClaimedAddress] = useState<string | null>(null)

  // Detect a WebLN provider (Alby / other Lightning browser extension).
  // Some extensions inject `window.webln` asynchronously, so we re-check
  // when the flow becomes active and each time we enter the payment step
  // rather than relying on a once-at-mount sniff.
  useEffect(() => {
    if (typeof window === 'undefined') return
    setHasWebLn(!!(window as WebLnWindow).webln)
  }, [active, step])

  const domain = settings?.domain || 'your-domain'
  const formatError =
    username.length === 0
      ? null
      : username.length > 16
        ? 'Max 16 characters.'
        : !USERNAME_RE.test(username)
          ? 'Lowercase letters and numbers only.'
          : null

  // Debounced availability check. The endpoint is public and cheap; we keep
  // it simple rather than introducing a generic debounce hook.
  useEffect(() => {
    if (!active) return
    if (step !== 'username') return
    if (formatError || !username) {
      setAvailable(null)
      return
    }
    let cancelled = false
    setChecking(true)
    const handle = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/lightning-addresses/check?username=${encodeURIComponent(username)}`
        )
        const body = (await res.json()) as { available?: boolean }
        if (!cancelled) setAvailable(Boolean(body.available))
      } catch {
        if (!cancelled) setAvailable(null)
      } finally {
        if (!cancelled) setChecking(false)
      }
    }, 300)
    return () => {
      cancelled = true
      clearTimeout(handle)
    }
  }, [username, formatError, active, step])

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
      setCopied(false)
      setClaimedAddress(null)
      setSubmitting(false)
      setPayingWithWallet(false)
      setManualChecking(false)
    }
  }, [initialUsername, active])

  // Cleanup polling on unmount.
  useEffect(() => {
    return () => {
      abortRef.current?.abort()
    }
  }, [])

  // Single entry point for turning a settlement preimage into a claimed
  // address. Shared by the background poller, the manual "check now" button,
  // and the WebLN payment path so they can't race or diverge. The claimingRef
  // guard makes concurrent calls a no-op rather than a double claim.
  const claimWithPreimage = useCallback(
    async (invoiceId: string, preimage: string) => {
      if (claimingRef.current) return
      claimingRef.current = true
      setPaymentStatus('detected')
      const finishSuccess = (address: string) => {
        if (typeof window !== 'undefined') {
          sessionStorage.removeItem(PENDING_INVOICE_KEY)
        }
        abortRef.current?.abort()
        setClaimedAddress(address)
        setStep('success')
        onCreated()
      }
      try {
        const claimResult = await apiClient.post<{
          success: boolean
          lightningAddress?: string
        }>(`/api/invoices/${invoiceId}/claim`, { preimage })
        if (claimResult.success) {
          finishSuccess(claimResult.lightningAddress ?? `${username}@${domain}`)
        }
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : 'Failed to claim address'
        // The invoice was already claimed (e.g. a prior claim succeeded but its
        // response was lost to a dropped connection). The address exists and is
        // ours — treat as success rather than surfacing a scary error.
        if (msg.toLowerCase().includes('already been claimed')) {
          finishSuccess(`${username}@${domain}`)
          return
        }
        toast.error(msg)
        if (msg.toLowerCase().includes('taken')) {
          setStep('username')
        } else {
          // Transient (likely network) claim failure — drop back to waiting so
          // the poller or a manual re-check can retry with the same preimage.
          setPaymentStatus('waiting')
        }
      } finally {
        claimingRef.current = false
      }
    },
    [apiClient, domain, onCreated, username]
  )

  const startLud21Polling = useCallback(
    (invoiceData: InvoiceData) => {
      if (!invoiceData.verify) return
      const controller = new AbortController()
      abortRef.current = controller

      // Poll for the FULL lifetime of the invoice rather than a fixed window.
      // A short hard timeout was the root cause of "I paid but nothing
      // happened": settlement that landed after the old 5-minute cutoff was
      // silently dropped even though the bolt11 was still valid.
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
          // its clock without settling — surface the expired state.
          if (err?.message !== 'Polling aborted') {
            setPaymentStatus('expired')
          }
        })
    },
    [claimWithPreimage]
  )

  const mintInvoiceAndShowQr = useCallback(async () => {
    try {
      const result = await apiClient.post<InvoiceData | { free: true }>(
        '/api/invoices',
        { purpose: 'wallet-address', metadata: { username } }
      )
      if ('free' in result && result.free) {
        // Operator hasn't finished configuring paid mode — surface this
        // explicitly rather than silently looping on the free endpoint
        // which would also be unavailable.
        toast.error(
          'Paid registration is configured but incomplete. Contact the operator.'
        )
        return
      }
      const invoiceData = result as InvoiceData
      // Persist before showing the QR so a refresh mid-payment can recover.
      // Tag the username so the restored payment header stays accurate.
      if (typeof window !== 'undefined') {
        sessionStorage.setItem(
          PENDING_INVOICE_KEY,
          JSON.stringify({ ...invoiceData, username })
        )
      }
      claimingRef.current = false
      setInvoice(invoiceData)
      setPaymentStatus('waiting')
      setStep('payment')
      startLud21Polling(invoiceData)
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to generate invoice'
      )
    }
  }, [apiClient, username, startLud21Polling])

  // Restore a pending invoice after a page refresh / reconnect. Runs once per
  // mount: if a non-expired invoice is stashed, drop straight back onto the
  // payment step and resume polling so a user who already paid isn't stranded.
  const restoreAttemptedRef = useRef(false)
  useEffect(() => {
    if (restoreAttemptedRef.current || !active) return
    restoreAttemptedRef.current = true
    if (typeof window === 'undefined') return
    const raw = sessionStorage.getItem(PENDING_INVOICE_KEY)
    if (!raw) return
    try {
      const saved = JSON.parse(raw) as InvoiceData
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
      try {
        // Happy path: direct create (paid mode off, or admin/operator bypass).
        await createAddress({ username })
        setClaimedAddress(`${username}@${domain}`)
        setStep('success')
        onCreated()
      } catch (err) {
        // Payment required → branch into invoice + QR flow instead of toast.
        if (err instanceof ApiClientError && err.status === 402) {
          await mintInvoiceAndShowQr()
          return
        }
        const msg =
          err instanceof Error ? err.message : 'Failed to create address'
        toast.error(msg)
      } finally {
        setSubmitting(false)
      }
    },
    [
      available,
      createAddress,
      domain,
      formatError,
      mintInvoiceAndShowQr,
      onCreated,
      username
    ]
  )

  const handleCopy = useCallback(() => {
    if (!invoice?.bolt11) return
    const text = invoice.bolt11
    const onCopied = () => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(onCopied, onCopied)
    } else {
      onCopied()
    }
  }, [invoice])

  /**
   * Pay the current invoice via a WebLN provider (Alby / similar). The
   * LUD-21 poller is what actually settles the claim — we don't race it
   * here; WebLN just pushes the payment so the user doesn't have to scan.
   */
  const handleWebLnPay = useCallback(async () => {
    if (!invoice?.bolt11) return
    const w = window as WebLnWindow
    if (!w.webln) return
    setPayingWithWallet(true)
    try {
      await w.webln.enable()
      const res = await w.webln.sendPayment(invoice.bolt11)
      // The extension returns the payment preimage — claim straight away
      // instead of waiting for the next poll tick. Falls back to the poller
      // if the extension didn't hand one back.
      if (res?.preimage) {
        await claimWithPreimage(invoice.id, res.preimage)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Wallet payment failed'
      // Most common case: user clicked "reject" in the extension.
      if (!/reject|cancel|denied/i.test(msg)) toast.error(msg)
    } finally {
      setPayingWithWallet(false)
    }
  }, [claimWithPreimage, invoice])

  /**
   * Manual settlement check — for "I paid but the screen didn't move", a lost
   * connection, or impatience. Does a one-shot LUD-21 verify and claims if the
   * payment has landed. Distinct from the background poller so the user always
   * has an explicit way to force a re-check.
   */
  const handleManualCheck = useCallback(async () => {
    if (!invoice?.verify) {
      toast.error('This invoice can’t be re-checked — generate a new one.')
      return
    }
    setManualChecking(true)
    try {
      const result = await checkVerifyOnce(invoice.verify)
      if (result.settled && result.preimage) {
        await claimWithPreimage(invoice.id, result.preimage)
      } else {
        toast(
          'No payment detected yet. If you just paid, give it a few seconds.'
        )
      }
    } catch {
      toast.error(
        'Couldn’t reach the payment verifier — check your connection and try again.'
      )
    } finally {
      setManualChecking(false)
    }
  }, [claimWithPreimage, invoice])

  // Cancelling the payment attempt returns to the username picker rather than
  // tearing down the whole flow — the user is abandoning this invoice, not the
  // "new address" intent. Mirrors the dialog's ESC / X / overlay behaviour on
  // the payment step.
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
    creating ||
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
    handleSubmit,
    invoice,
    paymentStatus,
    copied,
    hasWebLn,
    payingWithWallet,
    manualChecking,
    handleWebLnPay,
    handleCopy,
    handleManualCheck,
    mintInvoiceAndShowQr,
    backFromPayment,
    claimedAddress
  }
}
