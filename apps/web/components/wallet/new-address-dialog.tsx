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
import { pollVerifyUrl } from '@/lib/client/lnurl'
import { ApiClientError } from '@/lib/client/api-client'

const USERNAME_RE = /^[a-z0-9]+$/

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
}

interface NewAddressDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: () => void
}

/**
 * Visual "hero" card shown on the success step after a new address is
 * registered. Mirrors the Figma composition (LaWallet v2.2 node 3305:5163):
 * a dark card with a blurred ellipse glow at the top, a lightning-bolt
 * silhouette decoration overflowing the frame, a pill with the claimed
 * lightning address, and a tagline beneath.
 */
function SuccessHeroCard({ address }: { address: string }) {
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
export function NewAddressDialog({ open, onOpenChange, onCreated }: NewAddressDialogProps) {
  const router = useRouter()
  const { data: settings } = useSettings()
  const { apiClient } = useAuth()
  const { createAddress, creating } = useAddressMutations()

  const [step, setStep] = useState<Step>('username')
  const [username, setUsername] = useState('')
  const [available, setAvailable] = useState<boolean | null>(null)
  const [checking, setChecking] = useState(false)
  // Local submitting flag covers BOTH legs of the create path — the
  // `createAddress` mutation and the follow-up invoice mint on 402 —
  // so the Create button stays in its spinner state until the UI
  // actually advances to the payment (or success) step.
  const [submitting, setSubmitting] = useState(false)

  // Payment step state
  const [invoice, setInvoice] = useState<InvoiceData | null>(null)
  const [paymentStatus, setPaymentStatus] = useState<'waiting' | 'detected' | 'timeout'>('waiting')
  const [copied, setCopied] = useState(false)
  const [hasWebLn, setHasWebLn] = useState(false)
  const [payingWithWallet, setPayingWithWallet] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

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
      setStep('username')
      setUsername('')
      setAvailable(null)
      setChecking(false)
      setInvoice(null)
      setPaymentStatus('waiting')
      setCopied(false)
      setClaimedAddress(null)
      setSubmitting(false)
      setPayingWithWallet(false)
    }
  }, [open])

  // Cleanup polling on unmount.
  useEffect(() => {
    return () => {
      abortRef.current?.abort()
    }
  }, [])

  const startLud21Polling = useCallback(
    (invoiceData: InvoiceData) => {
      const controller = new AbortController()
      abortRef.current = controller

      pollVerifyUrl(invoiceData.verify!, { signal: controller.signal })
        .then(async result => {
          if (result.settled && result.preimage) {
            setPaymentStatus('detected')
            try {
              const claimResult = await apiClient.post<{
                success: boolean
                lightningAddress?: string
              }>(`/api/invoices/${invoiceData.id}/claim`, {
                preimage: result.preimage,
              })
              if (claimResult.success) {
                setClaimedAddress(
                  claimResult.lightningAddress ?? `${username}@${domain}`,
                )
                setStep('success')
                onCreated()
              }
            } catch (err) {
              const msg = err instanceof Error ? err.message : 'Failed to claim address'
              toast.error(msg)
              if (msg.toLowerCase().includes('taken')) {
                setStep('username')
              }
            }
          }
        })
        .catch(err => {
          if (err?.message !== 'Polling aborted') {
            setPaymentStatus('timeout')
          }
        })
    },
    [apiClient, domain, onCreated, username],
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
      setInvoice(invoiceData)
      setPaymentStatus('waiting')
      setStep('payment')
      if (invoiceData.verify) startLud21Polling(invoiceData)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to generate invoice')
    }
  }

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
      await w.webln.sendPayment(invoice.bolt11)
      // Payment sent — LUD-21 polling will detect settlement and claim.
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Wallet payment failed'
      // Most common case: user clicked "reject" in the extension.
      if (!/reject|cancel|denied/i.test(msg)) toast.error(msg)
    } finally {
      setPayingWithWallet(false)
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
      setStep('username')
      setInvoice(null)
      setPaymentStatus('waiting')
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
                  {payingWithWallet ? 'Confirm in wallet…' : 'Pay with Wallet'}
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

            <div className="min-h-5">
              {paymentStatus === 'waiting' && (
                <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
                  <Spinner size={12} />
                  Waiting for payment…
                </div>
              )}
              {paymentStatus === 'detected' && (
                <div className="flex items-center justify-center gap-2 text-xs text-green-500">
                  <Check className="size-3.5" />
                  Payment detected! Claiming address…
                </div>
              )}
              {paymentStatus === 'timeout' && (
                <div className="flex flex-col items-center gap-2">
                  <p className="text-xs text-muted-foreground">
                    Payment verification timed out.
                  </p>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => mintInvoiceAndShowQr()}
                  >
                    <RefreshCw className="mr-1.5 size-3.5" />
                    Generate new invoice
                  </Button>
                </div>
              )}
            </div>
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

            <DialogFooter className="flex-row justify-end space-x-2">
              <Button
                type="button"
                variant="theme"
                onClick={() => {
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
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
