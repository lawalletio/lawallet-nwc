'use client'

import React, { useState, useEffect, useRef, useCallback } from 'react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Check, Copy, RefreshCw, Wallet } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import { useSettings } from '@/lib/client/hooks/use-settings'
import { useAddressMutations } from '@/lib/client/hooks/use-wallet-addresses'
import { useAuth } from '@/components/admin/auth-context'
import { pollVerifyUrl, checkVerifyOnce } from '@/lib/client/lnurl'
import { ApiClientError } from '@/lib/client/api-client'

const USERNAME_RE = /^[a-z0-9]+$/

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

type Step = 'username' | 'payment' | 'success'

interface InvoiceData {
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

interface NewAddressDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: () => void
  initialUsername?: string
  onSuccessAction?: (address: string) => void
  /**
   * When set, the success step shows the celebratory card for this many
   * milliseconds with no action button, then fires `onSuccessAutoAdvance`.
   * Used by the new-user first-address flow to flash the modal then route to
   * the dashboard. Takes precedence over the Configure button / `onSuccessAction`.
   */
  successAutoAdvanceMs?: number
  onSuccessAutoAdvance?: () => void
}

/**
 * Visual "hero" card shown on the success step after a new address is
 * registered. Mirrors the Figma composition (LaWallet v2.2 node 3305:5163):
 * a dark card with a blurred ellipse glow at the top, a lightning-bolt
 * silhouette decoration overflowing the frame, a pill with the claimed
 * lightning address, and a tagline beneath.
 */
export function SuccessHeroCard({ address }: { address: string }) {
  const [name, domainPart] = address.includes('@')
    ? [address.split('@')[0], `@${address.split('@').slice(1).join('@')}`]
    : [address, '']

  return (
    <div
      className="relative w-full overflow-hidden rounded-lg border border-border bg-card animate-in fade-in-0 zoom-in-95 duration-500 ease-out"
    >
      {/* Maintain a consistent aspect so the composition renders
          predictably regardless of the dialog's content width. */}
      <div className="relative aspect-[16/9] w-full">
        {/* Blurred radial glow — centered at the top. Pulses softly to
            give the card a live "on-air" feel, and fades in slightly
            delayed so the sequence reads as card → glow → bolt → pill. */}
        <div
          className="pointer-events-none absolute left-1/2 top-0 h-[60%] w-[70%] -translate-x-1/2 -translate-y-1/4 opacity-40 animate-in fade-in-0 duration-700 delay-150 fill-mode-backwards motion-safe:[animation-iteration-count:1]"
        >
          <div className="size-full motion-safe:animate-[pulse_3s_ease-in-out_infinite]">
            <Image
              src="/register/success-ellipse.svg"
              alt=""
              fill
              sizes="(max-width: 520px) 80vw, 420px"
              className="object-contain"
              priority
            />
          </div>
        </div>

        {/* Lightning silhouette decoration — centered behind the pill.
            Drops in with a slight scale-up on arrival. */}
        <div
          className="pointer-events-none absolute inset-0 flex items-center justify-center animate-in fade-in-0 zoom-in-90 duration-700 delay-200 fill-mode-backwards"
        >
          <div className="relative size-full">
            <Image
              src="/register/success-frame.svg"
              alt=""
              fill
              sizes="(max-width: 520px) 80vw, 420px"
              className="object-contain"
              priority
            />
          </div>
        </div>

        {/* Address pill — fully centered. Slides up from below with a
            subtle scale + fade so it lands last, like a confirmation. */}
        <div className="absolute inset-0 flex items-center justify-center">
          <div
            className="inline-flex items-center gap-1 rounded-lg border border-border bg-background px-4 py-2 text-lg font-medium leading-7 shadow-[0_25px_50px_-12px_rgba(0,0,0,0.4)] animate-in fade-in-0 slide-in-from-bottom-3 zoom-in-95 duration-500 delay-300 fill-mode-backwards ease-out"
          >
            <span className="text-muted-foreground">{name}</span>
            {domainPart && <span className="text-foreground">{domainPart}</span>}
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * Username chooser for a new lightning address. If paid registration is on
 * and the caller doesn't bypass, the POST to /api/wallet/addresses returns
 * 402 — we then mint a LUD-16 invoice via POST /api/invoices with purpose
 * `wallet-address` and render the QR payment step in place. Once the LUD-21
 * `verify` URL reports settled, we claim with the preimage and the server
 * creates the address (non-primary) on the claim route.
 */
export function NewAddressDialog({
  open,
  onOpenChange,
  onCreated,
  initialUsername = '',
  onSuccessAction,
  successAutoAdvanceMs,
  onSuccessAutoAdvance,
}: NewAddressDialogProps) {
  const router = useRouter()
  const { data: settings } = useSettings()
  const { apiClient } = useAuth()
  const { createAddress, creating } = useAddressMutations()

  const [step, setStep] = useState<Step>('username')
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
  const [paymentStatus, setPaymentStatus] = useState<'waiting' | 'detected' | 'expired'>('waiting')
  const [copied, setCopied] = useState(false)
  const [hasWebLn, setHasWebLn] = useState(false)
  const [payingWithWallet, setPayingWithWallet] = useState(false)
  const [manualChecking, setManualChecking] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  // Guards against two settlement signals (poller + manual check / WebLN)
  // racing to claim the same invoice and double-firing the claim request.
  const claimingRef = useRef(false)

  // Detect a WebLN provider (Alby / other Lightning browser extension).
  // Some extensions inject `window.webln` asynchronously, so we re-check
  // when the dialog opens and each time we enter the payment step rather
  // than relying on a once-at-mount sniff.
  useEffect(() => {
    if (typeof window === 'undefined') return
    setHasWebLn(!!(window as WebLnWindow).webln)
  }, [open, step])

  // Success step state
  const [claimedAddress, setClaimedAddress] = useState<string | null>(null)

  // Optional auto-advance: when the caller treats the success step as a brief
  // confirmation (the new-user first-address flow), hold the hero card for
  // `successAutoAdvanceMs` then fire `onSuccessAutoAdvance`. Kept in a ref so a
  // parent re-render with a fresh callback identity doesn't restart the timer.
  const autoAdvanceRef = useRef(onSuccessAutoAdvance)
  useEffect(() => {
    autoAdvanceRef.current = onSuccessAutoAdvance
  }, [onSuccessAutoAdvance])
  useEffect(() => {
    if (step !== 'success' || !successAutoAdvanceMs) return
    const timer = setTimeout(() => autoAdvanceRef.current?.(), successAutoAdvanceMs)
    return () => clearTimeout(timer)
  }, [step, successAutoAdvanceMs])

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
    if (!open) return
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
          `/api/lightning-addresses/check?username=${encodeURIComponent(username)}`,
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
  }, [username, formatError, open, step])

  // Reset on close.
  useEffect(() => {
    if (!open) {
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
  }, [initialUsername, open])

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
        const msg = err instanceof Error ? err.message : 'Failed to claim address'
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
    [apiClient, domain, onCreated, username],
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
        timeout: Math.max(msUntilExpiry, 0),
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
    [claimWithPreimage],
  )

  async function mintInvoiceAndShowQr() {
    try {
      const result = await apiClient.post<InvoiceData | { free: true }>(
        '/api/invoices',
        { purpose: 'wallet-address', metadata: { username } },
      )
      if ('free' in result && result.free) {
        // Operator hasn't finished configuring paid mode — surface this
        // explicitly rather than silently looping on the free endpoint
        // which would also be unavailable.
        toast.error('Paid registration is configured but incomplete. Contact the operator.')
        return
      }
      const invoiceData = result as InvoiceData
      // Persist before showing the QR so a refresh mid-payment can recover.
      // Tag the username so the restored payment header stays accurate.
      if (typeof window !== 'undefined') {
        sessionStorage.setItem(
          PENDING_INVOICE_KEY,
          JSON.stringify({ ...invoiceData, username }),
        )
      }
      claimingRef.current = false
      setInvoice(invoiceData)
      setPaymentStatus('waiting')
      setStep('payment')
      startLud21Polling(invoiceData)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to generate invoice')
    }
  }

  // Restore a pending invoice after a page refresh / reconnect. Runs once per
  // mount: if a non-expired invoice is stashed, drop straight back onto the
  // payment step and resume polling so a user who already paid isn't stranded.
  const restoreAttemptedRef = useRef(false)
  useEffect(() => {
    if (restoreAttemptedRef.current || !open) return
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
  }, [open, startLud21Polling])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
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
      const msg = err instanceof Error ? err.message : 'Failed to create address'
      toast.error(msg)
    } finally {
      setSubmitting(false)
    }
  }

  function handleCopy() {
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
  }

  /**
   * Pay the current invoice via a WebLN provider (Alby / similar). The
   * LUD-21 poller is what actually settles the claim — we don't race it
   * here; WebLN just pushes the payment so the user doesn't have to scan.
   */
  async function handleWebLnPay() {
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
  }

  /**
   * Manual settlement check — for "I paid but the screen didn't move", a lost
   * connection, or impatience. Does a one-shot LUD-21 verify and claims if the
   * payment has landed. Distinct from the background poller so the user always
   * has an explicit way to force a re-check.
   */
  async function handleManualCheck() {
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
        toast('No payment detected yet. If you just paid, give it a few seconds.')
      }
    } catch {
      toast.error(
        'Couldn’t reach the payment verifier — check your connection and try again.',
      )
    } finally {
      setManualChecking(false)
    }
  }

  const submitDisabled =
    submitting ||
    creating ||
    checking ||
    !!formatError ||
    username.length === 0 ||
    available === false

  // On the payment step, ESC / X / overlay-click should *go back* to the
  // username picker instead of dismissing the whole dialog — the user is
  // cancelling the payment attempt, not the whole "new address" flow.
  function handleOpenChange(next: boolean) {
    if (!next && step === 'payment') {
      abortRef.current?.abort()
      claimingRef.current = false
      if (typeof window !== 'undefined') {
        sessionStorage.removeItem(PENDING_INVOICE_KEY)
      }
      setStep('username')
      setInvoice(null)
      setPaymentStatus('waiting')
      setManualChecking(false)
      return
    }
    onOpenChange(next)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        {step === 'username' && (
          <form onSubmit={handleSubmit} className="space-y-4">
            <DialogHeader>
              <DialogTitle>New address</DialogTitle>
            </DialogHeader>

            <div className="space-y-2">
              <Label htmlFor="username">Username</Label>
              <div className="flex items-center rounded-md border border-input bg-background focus-within:ring-2 focus-within:ring-ring">
                <Input
                  id="username"
                  autoFocus
                  value={username}
                  onChange={e => setUsername(e.target.value.toLowerCase())}
                  placeholder="satoshi"
                  maxLength={16}
                  className="flex-1 border-0 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
                />
                <span className="px-3 text-sm text-muted-foreground">@{domain}</span>
              </div>
              <p className="min-h-4 text-xs">
                {formatError ? (
                  <span className="text-destructive">{formatError}</span>
                ) : checking ? (
                  <span className="text-muted-foreground">Checking availability…</span>
                ) : available === false ? (
                  <span className="text-destructive">That username is taken.</span>
                ) : available === true ? (
                  <span className="text-green-600 dark:text-green-500">Available</span>
                ) : (
                  <span className="text-muted-foreground">
                    Lowercase letters and numbers, max 16 characters.
                  </span>
                )}
              </p>
            </div>

            <DialogFooter className="flex-row justify-end space-x-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => onOpenChange(false)}
                disabled={submitting}
              >
                Cancel
              </Button>
              <Button type="submit" variant="theme" disabled={submitDisabled}>
                {submitting && <Spinner size={16} className="mr-2" />}
                {submitting ? 'Creating…' : 'Create'}
              </Button>
            </DialogFooter>
          </form>
        )}

        {step === 'payment' && invoice && (
          <div className="space-y-5">
            <DialogHeader className="space-y-1 text-center sm:text-center">
              <DialogTitle className="text-center">
                Pay {invoice.amountSats} sats
              </DialogTitle>
              <DialogDescription className="text-center">
                To claim{' '}
                <span className="font-medium text-foreground">
                  {username}@{domain}
                </span>
              </DialogDescription>
            </DialogHeader>

            {paymentStatus === 'expired' ? (
              // Invoice ran out its clock without settling. Drop the QR so a
              // stale code can't be paid into a void, and offer a fresh one.
              <div className="flex flex-col items-center gap-3 py-2 text-center">
                <p className="text-sm text-muted-foreground">
                  This invoice expired before a payment was detected. If you
                  were charged, contact the operator — otherwise generate a
                  fresh invoice.
                </p>
                <Button variant="theme" onClick={() => mintInvoiceAndShowQr()}>
                  <RefreshCw className="mr-1.5 size-3.5" />
                  Generate new invoice
                </Button>
              </div>
            ) : (
              <>
                {/* QR centered in a fixed-width frame so the layout stays
                    stable regardless of the dialog's content width. */}
                <div className="flex justify-center">
                  <div className="rounded-xl bg-white p-4 shadow-sm">
                    <QRCodeSVG
                      value={invoice.bolt11}
                      size={224}
                      level="M"
                      marginSize={0}
                    />
                  </div>
                </div>

                <div className="flex flex-col gap-2">
                  {hasWebLn && (
                    <Button
                      type="button"
                      variant="theme"
                      className="w-full"
                      onClick={handleWebLnPay}
                      disabled={payingWithWallet || paymentStatus === 'detected'}
                    >
                      {payingWithWallet ? (
                        <Spinner size={16} className="mr-2" />
                      ) : (
                        <Wallet className="mr-2 size-4" />
                      )}
                      {payingWithWallet
                        ? 'Confirm in wallet…'
                        : 'Pay with Wallet'}
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full"
                    onClick={handleCopy}
                  >
                    <Copy className="mr-2 size-4" />
                    {copied ? 'Copied!' : 'Copy Invoice'}
                  </Button>
                </div>

                <div className="flex min-h-5 flex-col items-center gap-2">
                  {paymentStatus === 'waiting' && (
                    <>
                      <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
                        <Spinner size={12} />
                        Waiting for payment…
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={handleManualCheck}
                        disabled={manualChecking}
                      >
                        {manualChecking ? (
                          <Spinner size={14} className="mr-1.5" />
                        ) : (
                          <RefreshCw className="mr-1.5 size-3.5" />
                        )}
                        {manualChecking ? 'Checking…' : 'I’ve paid — check now'}
                      </Button>
                    </>
                  )}
                  {paymentStatus === 'detected' && (
                    <div className="flex items-center justify-center gap-2 text-xs text-green-500">
                      <Check className="size-3.5" />
                      Payment detected! Claiming address…
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {step === 'success' && claimedAddress && (
          <div className="space-y-4">
            <DialogHeader>
              <DialogTitle>Address registered!</DialogTitle>
              <DialogDescription>
                Your new lightning address is now active.
              </DialogDescription>
            </DialogHeader>

            <SuccessHeroCard address={claimedAddress} />

            {successAutoAdvanceMs ? (
              <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
                <Spinner size={12} />
                Taking you to your dashboard…
              </div>
            ) : (
              <DialogFooter className="flex-row justify-end space-x-2">
                <Button
                  type="button"
                  variant="theme"
                  onClick={() => {
                    if (onSuccessAction) {
                      onSuccessAction(claimedAddress)
                      return
                    }
                    const justUsername = claimedAddress.split('@')[0]
                    onOpenChange(false)
                    router.push(
                      `/admin/addresses/${encodeURIComponent(justUsername)}`,
                    )
                  }}
                >
                  Configure
                </Button>
              </DialogFooter>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
