'use client'

import React, { useEffect, useRef, useCallback } from 'react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { Check, Copy, RefreshCw, Wallet } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import { useNewAddressFlow } from '@/components/wallet/claim/use-new-address-flow'

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
    <div className="relative w-full overflow-hidden rounded-lg border border-border bg-card animate-in fade-in-0 zoom-in-95 duration-500 ease-out">
      {/* Maintain a consistent aspect so the composition renders
          predictably regardless of the dialog's content width. */}
      <div className="relative aspect-[16/9] w-full">
        {/* Blurred radial glow — centered at the top. Pulses softly to
            give the card a live "on-air" feel, and fades in slightly
            delayed so the sequence reads as card → glow → bolt → pill. */}
        <div className="pointer-events-none absolute left-1/2 top-0 h-[60%] w-[70%] -translate-x-1/2 -translate-y-1/4 opacity-40 animate-in fade-in-0 duration-700 delay-150 fill-mode-backwards motion-safe:[animation-iteration-count:1]">
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
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center animate-in fade-in-0 zoom-in-90 duration-700 delay-200 fill-mode-backwards">
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
          <div className="inline-flex items-center gap-1 rounded-lg border border-border bg-background px-4 py-2 text-lg font-medium leading-7 shadow-[0_25px_50px_-12px_rgba(0,0,0,0.4)] animate-in fade-in-0 slide-in-from-bottom-3 zoom-in-95 duration-500 delay-300 fill-mode-backwards ease-out">
            <span className="text-muted-foreground">{name}</span>
            {domainPart && (
              <span className="text-foreground">{domainPart}</span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * Username chooser for a new lightning address. The whole flow (availability
 * check, paid-registration invoice/QR, success) lives in `useNewAddressFlow`
 * so the same logic backs the full-screen wallet claim screen; this component
 * is just the modal presentation of it.
 */
export function NewAddressDialog({
  open,
  onOpenChange,
  onCreated,
  initialUsername = '',
  onSuccessAction,
  successAutoAdvanceMs,
  onSuccessAutoAdvance
}: NewAddressDialogProps) {
  const router = useRouter()
  const {
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
  } = useNewAddressFlow({ active: open, initialUsername, onCreated })

  const configureButtonRef = useRef<HTMLButtonElement | null>(null)

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
    const timer = setTimeout(
      () => autoAdvanceRef.current?.(),
      successAutoAdvanceMs
    )
    return () => clearTimeout(timer)
  }, [step, successAutoAdvanceMs])

  useEffect(() => {
    if (step !== 'success' || !claimedAddress || successAutoAdvanceMs) return
    configureButtonRef.current?.focus()
  }, [claimedAddress, step, successAutoAdvanceMs])

  // On the payment step, ESC / X / overlay-click should *go back* to the
  // username picker instead of dismissing the whole dialog — the user is
  // cancelling the payment attempt, not the whole "new address" flow.
  function handleOpenChange(next: boolean) {
    if (!next && step === 'payment') {
      backFromPayment()
      return
    }
    onOpenChange(next)
  }

  const handleConfigureSuccess = useCallback(() => {
    if (!claimedAddress) return
    if (onSuccessAction) {
      onSuccessAction(claimedAddress)
      return
    }
    const justUsername = claimedAddress.split('@')[0]
    onOpenChange(false)
    router.push(`/admin/addresses/${encodeURIComponent(justUsername)}`)
  }, [claimedAddress, onOpenChange, onSuccessAction, router])

  function handleDialogKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (step !== 'success' || !claimedAddress || successAutoAdvanceMs) return
    if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
    event.preventDefault()
    event.stopPropagation()
    handleConfigureSuccess()
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent onKeyDown={handleDialogKeyDown}>
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
                <span className="px-3 text-sm text-muted-foreground">
                  @{domain}
                </span>
              </div>
              <p className="min-h-4 text-xs">
                {formatError ? (
                  <span className="text-destructive">{formatError}</span>
                ) : checking ? (
                  <span className="text-muted-foreground">
                    Checking availability…
                  </span>
                ) : available === false ? (
                  <span className="text-destructive">
                    That username is taken.
                  </span>
                ) : available === true ? (
                  <span className="text-green-600 dark:text-green-500">
                    Available
                  </span>
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
                      disabled={
                        payingWithWallet || paymentStatus === 'detected'
                      }
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
                          <Spinner size={12} className="mr-1.5" />
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
                  ref={configureButtonRef}
                  type="button"
                  variant="theme"
                  onClick={handleConfigureSuccess}
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
