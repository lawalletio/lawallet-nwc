'use client'

import { useCallback, useSyncExternalStore } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Copy, RefreshCw, Wallet } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import { ScreenHeader } from '@/components/wallet/shared/screen-header'
import { SuccessHeroCard } from '@/components/wallet/new-address-dialog'
import { useNewAddressFlow } from '@/components/wallet/claim/use-new-address-flow'
import { invalidateApiPath } from '@/lib/client/hooks/use-api'
import {
  readActivationBonus,
  serverActivationBonus,
  subscribeActivationBonus
} from '@/lib/client/activation-bonus-notice'
import { useT } from '@/lib/client/i18n'

/**
 * Full-screen, mobile-first "claim a lightning address" flow for the wallet.
 * Shares its entire state machine with the admin `NewAddressDialog` via
 * `useNewAddressFlow`; only the chrome differs (a `ScreenHeader` + bottom-pinned
 * CTA instead of a modal). Reached from the home-screen and Receive CTAs at
 * `/wallet/claim-username`. On completion it returns to `/wallet`, where the
 * newly claimed address now shows in place of the claim prompt.
 */
export function ClaimAddressScreen({
  fromActivate = false,
  freeBonus = false,
  initialUsername
}: {
  fromActivate?: boolean
  freeBonus?: boolean
  /** Prefill from the landing-page claim dialog (`?username=`). */
  initialUsername?: string
}) {
  const router = useRouter()
  const tc = useT().claim
  const storedBonus = useSyncExternalStore(
    subscribeActivationBonus,
    readActivationBonus,
    serverActivationBonus
  )
  const cardBonus = fromActivate ? storedBonus : null

  // Refresh the endpoints the home screen reads so it shows the new address
  // (and drops the claim CTA) on return. The free path's create mutation
  // already invalidates these, but the paid claim route doesn't — invalidating
  // here covers both without depending on which path completed.
  const handleCreated = useCallback(() => {
    invalidateApiPath('/api/users/me')
    invalidateApiPath('/api/wallet/addresses')
  }, [])

  const flow = useNewAddressFlow({
    active: true,
    initialUsername: initialUsername?.toLowerCase(),
    onCreated: handleCreated
  })

  function goToWallet() {
    router.replace('/wallet')
  }

  function handleBack() {
    // Cancelling the payment attempt drops back to the username picker;
    // otherwise leave the flow entirely — except after card activation,
    // where claiming an address is required and there is no dismiss.
    if (flow.step === 'payment') {
      flow.backFromPayment()
      return
    }
    if (fromActivate) return
    goToWallet()
  }

  const showHeader =
    flow.step !== 'success' && !(fromActivate && flow.step === 'username')

  return (
    <div className="flex flex-1 flex-col">
      {showHeader && (
        <ScreenHeader
          title={flow.step === 'payment' ? tc.paymentTitle : tc.headerTitle}
          closeStyle={flow.step === 'username'}
          onBack={handleBack}
        />
      )}

      {flow.step === 'username' && (
        <form
          onSubmit={flow.handleSubmit}
          className="flex flex-1 flex-col justify-between px-6 pb-6 pt-2"
        >
          <div className="space-y-6 pt-4">
            <div className="space-y-2">
              <h1 className="text-2xl font-semibold text-foreground">
                {tc.heading}
              </h1>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {fromActivate
                  ? freeBonus
                    ? tc.introActivateFree
                    : tc.introActivate
                  : tc.intro}
              </p>
              {cardBonus != null && (
                <p className="text-sm text-muted-foreground">
                  {tc.cardBonus(cardBonus.toLocaleString('en-US'))}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="username">{tc.username}</Label>
              <div className="flex items-center rounded-md border border-input bg-background focus-within:ring-2 focus-within:ring-ring">
                <Input
                  id="username"
                  autoFocus
                  value={flow.username}
                  onChange={e => flow.setUsername(e.target.value.toLowerCase())}
                  placeholder="satoshi"
                  maxLength={16}
                  className="flex-1 border-0 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
                />
                <span className="px-3 text-sm text-muted-foreground">
                  @{flow.domain}
                </span>
              </div>
              <p className="min-h-4 text-xs">
                {flow.formatError ? (
                  <span className="text-destructive">{flow.formatError}</span>
                ) : flow.checking ? (
                  <span className="text-muted-foreground">
                    {tc.checkingAvailability}
                  </span>
                ) : flow.available === false ? (
                  <span className="text-destructive">{tc.taken}</span>
                ) : flow.available === true ? (
                  <span className="text-green-600 dark:text-green-500">
                    {tc.available}
                  </span>
                ) : (
                  <span className="text-muted-foreground">
                    {tc.usernameHint}
                  </span>
                )}
              </p>
            </div>
          </div>

          <Button
            type="submit"
            variant="theme"
            className="h-12 w-full"
            disabled={flow.submitDisabled}
          >
            {flow.submitting && <Spinner size={16} className="mr-2" />}
            {flow.submitting ? tc.claiming : tc.claimAddress}
          </Button>
        </form>
      )}

      {flow.step === 'payment' && !flow.invoice && (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 pb-6 text-center">
          {flow.mintError ? (
            <>
              <div className="space-y-1">
                <h1 className="text-xl font-semibold text-foreground">
                  {tc.paymentFailedTitle}
                </h1>
                <p className="text-sm text-muted-foreground">
                  {tc.paymentFailedBody(`${flow.username}@${flow.domain}`)}
                </p>
              </div>
              <p className="text-sm text-muted-foreground">{flow.mintError}</p>
              <Button
                variant="theme"
                className="h-12 w-full"
                onClick={() => flow.mintInvoiceAndShowQr()}
              >
                <RefreshCw className="mr-1.5 size-3.5" />
                {tc.tryAgain}
              </Button>
            </>
          ) : (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner size={16} />
              {tc.generatingInvoice}
            </div>
          )}
        </div>
      )}

      {flow.step === 'payment' && flow.invoice && (
        <div className="flex flex-1 flex-col gap-5 px-6 pb-6 pt-2">
          <div className="space-y-1 text-center">
            <h1 className="text-xl font-semibold text-foreground">
              {tc.payAmount(flow.invoice.amountSats)}
            </h1>
            <p className="text-sm text-muted-foreground">
              {tc.toClaim}{' '}
              <span className="font-medium text-foreground">
                {flow.username}@{flow.domain}
              </span>
            </p>
          </div>

          {flow.paymentStatus === 'expired' ? (
            <div className="flex flex-col items-center gap-3 py-2 text-center">
              <p className="text-sm text-muted-foreground">
                {tc.invoiceExpired}
              </p>
              <Button
                variant="theme"
                onClick={() => flow.mintInvoiceAndShowQr()}
              >
                <RefreshCw className="mr-1.5 size-3.5" />
                {tc.newInvoice}
              </Button>
            </div>
          ) : (
            <>
              <div className="flex justify-center">
                <div className="rounded-xl bg-white p-4 shadow-sm">
                  <QRCodeSVG
                    value={flow.invoice.bolt11}
                    size={224}
                    level="M"
                    marginSize={0}
                  />
                </div>
              </div>

              <div className="flex flex-col gap-2">
                {flow.hasWebLn && (
                  <Button
                    type="button"
                    variant="theme"
                    className="w-full"
                    onClick={flow.handleWebLnPay}
                    disabled={
                      flow.payingWithWallet || flow.paymentStatus === 'detected'
                    }
                  >
                    {flow.payingWithWallet ? (
                      <Spinner size={16} className="mr-2" />
                    ) : (
                      <Wallet className="mr-2 size-4" />
                    )}
                    {flow.payingWithWallet
                      ? tc.confirmInWallet
                      : tc.payWithWallet}
                  </Button>
                )}
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  onClick={flow.handleCopy}
                >
                  <Copy className="mr-2 size-4" />
                  {flow.copied ? tc.copied : tc.copyInvoice}
                </Button>
              </div>

              <div className="flex min-h-5 flex-col items-center gap-2">
                {flow.paymentStatus === 'waiting' && (
                  <>
                    <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
                      <Spinner size={12} />
                      {tc.waitingPayment}
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={flow.handleManualCheck}
                      disabled={flow.manualChecking}
                    >
                      {flow.manualChecking ? (
                        <Spinner size={12} className="mr-1.5" />
                      ) : (
                        <RefreshCw className="mr-1.5 size-3.5" />
                      )}
                      {flow.manualChecking ? tc.checking : tc.checkNow}
                    </Button>
                  </>
                )}
                {flow.paymentStatus === 'detected' && (
                  <div className="flex items-center justify-center gap-2 text-xs text-green-500">
                    <Check className="size-3.5" />
                    {tc.detected}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {flow.step === 'success' && flow.claimedAddress && (
        <div className="flex flex-1 flex-col items-center justify-between px-6 pb-6 pt-10 text-center">
          <div className="flex w-full flex-col items-center gap-6">
            <div className="space-y-2">
              <h1 className="text-2xl font-semibold text-foreground">
                {tc.claimedTitle}
              </h1>
              <p className="text-sm text-muted-foreground">{tc.claimedBody}</p>
            </div>
            <SuccessHeroCard address={flow.claimedAddress} />
          </div>

          <Button onClick={goToWallet} variant="theme" className="h-12 w-full">
            {tc.goToWallet}
          </Button>
        </div>
      )}
    </div>
  )
}
