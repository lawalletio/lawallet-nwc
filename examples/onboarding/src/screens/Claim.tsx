import { useClaimAddress, useInstanceInfo } from '@lawallet-nwc/react'
import { QRCodeSVG } from 'qrcode.react'
import { useState } from 'react'

/**
 * The flagship flow: pick a username → if the instance charges for
 * registration, pay a lightning invoice (QR / WebLN / manual re-check) →
 * the address is claimed against your npub. All the state lives in
 * `useClaimAddress`; this component only renders it.
 */
export function Claim() {
  const { settings } = useInstanceInfo()
  const flow = useClaimAddress()
  const [copied, setCopied] = useState(false)

  if (flow.step === 'payment' && flow.invoice) {
    const { invoice } = flow
    return (
      <main className="shell center">
        <h1>
          Pay {invoice.amountSats} sats to claim{' '}
          <span className="accent">
            {flow.username}@{flow.domain}
          </span>
        </h1>

        {flow.paymentStatus === 'expired' ? (
          <>
            <p className="error">This invoice expired without a payment.</p>
            <button className="primary" onClick={flow.backFromPayment}>
              Start over
            </button>
          </>
        ) : (
          <>
            <div className="qr">
              <QRCodeSVG value={invoice.bolt11.toUpperCase()} size={240} />
            </div>
            <p className="muted">
              {flow.paymentStatus === 'detected'
                ? 'Payment detected — claiming…'
                : 'Scan with any lightning wallet. This screen advances by itself once the payment lands.'}
            </p>
            <div className="row">
              <button
                className="secondary"
                onClick={() => {
                  navigator.clipboard?.writeText(invoice.bolt11)
                  setCopied(true)
                  setTimeout(() => setCopied(false), 2000)
                }}
              >
                {copied ? 'Copied ✓' : 'Copy invoice'}
              </button>
              {flow.hasWebLn && (
                <button
                  className="primary"
                  disabled={flow.payingWithWallet}
                  onClick={flow.handleWebLnPay}
                >
                  {flow.payingWithWallet ? 'Paying…' : 'Pay with extension'}
                </button>
              )}
            </div>
            <button
              className="link"
              disabled={flow.manualChecking}
              onClick={flow.handleManualCheck}
            >
              {flow.manualChecking ? 'Checking…' : 'I paid — check now'}
            </button>
            <button className="link muted" onClick={flow.backFromPayment}>
              Cancel
            </button>
          </>
        )}
        {flow.error && <p className="error">{flow.error}</p>}
      </main>
    )
  }

  if (flow.step === 'success') {
    // The dashboard takes over as soon as the refreshed user lands; this is
    // just the in-between frame.
    return (
      <main className="shell center">
        <h1>⚡ {flow.claimedAddress}</h1>
        <p className="muted">Your lightning address is live.</p>
      </main>
    )
  }

  return (
    <main className="shell center">
      <h1>Choose your address</h1>
      <form className="claim-form" onSubmit={flow.handleSubmit}>
        <div className="username-input">
          <input
            autoFocus
            placeholder="satoshi"
            value={flow.username}
            onChange={e => flow.setUsername(e.target.value.toLowerCase())}
          />
          <span className="domain">@{settings?.domain ?? flow.domain}</span>
        </div>
        <p className="hint">
          {flow.formatError
            ? flow.formatError
            : flow.checking
              ? 'Checking availability…'
              : flow.available === true
                ? '✓ Available'
                : flow.available === false
                  ? '✗ Taken'
                  : ' '}
        </p>
        <button className="primary" disabled={flow.submitDisabled}>
          {flow.submitting ? 'Claiming…' : 'Claim it'}
        </button>
      </form>
      {flow.error && <p className="error">{flow.error}</p>}
    </main>
  )
}
