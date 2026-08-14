import {
  useAddress,
  useAddressInvoices,
  useAuth,
  useRemoteWallets,
  useSSEConnected,
  useUser
} from '@lawallet-nwc/react'
import { useState } from 'react'

/**
 * Post-claim home: the live address, its routing configuration (idle /
 * alias redirect / your own NWC wallet) and received payments — the invoice
 * list refreshes itself through the SDK's SSE subscription.
 */
export function Dashboard() {
  const auth = useAuth()
  const { user } = useUser()
  const username = user?.primaryUsername ?? null
  const { address, update } = useAddress(username)
  const { invoices } = useAddressInvoices(username)
  const wallets = useRemoteWallets()
  const sseConnected = useSSEConnected()

  const [redirect, setRedirect] = useState('')
  const [nwcString, setNwcString] = useState('')
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)

  const act = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true)
    setFeedback(null)
    try {
      await fn()
      setFeedback(done)
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'Something failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="shell">
      <header className="row space-between">
        <div>
          <h1>⚡ {user?.lightningAddress}</h1>
          <p className="muted">
            {auth.npub?.slice(0, 20)}… · NIP-05 ready ·{' '}
            {sseConnected ? 'live' : 'connecting…'}
          </p>
        </div>
        <button className="link" onClick={auth.logout}>
          Log out
        </button>
      </header>

      <section className="card">
        <h2>Routing</h2>
        <p className="muted">
          Current mode: <strong>{address?.mode ?? '…'}</strong>
          {address?.redirect ? ` → ${address.redirect}` : ''}
          {address?.remoteWalletName ? ` → ${address.remoteWalletName}` : ''}
        </p>

        <div className="option">
          <h3>Forward to another lightning address</h3>
          <div className="row">
            <input
              placeholder="you@getalby.com"
              value={redirect}
              onChange={e => setRedirect(e.target.value)}
            />
            <button
              className="secondary"
              disabled={busy || !redirect.includes('@')}
              onClick={() =>
                act(
                  () => update({ mode: 'ALIAS', redirect }),
                  'Alias configured — payments now forward.'
                )
              }
            >
              Set alias
            </button>
          </div>
        </div>

        <div className="option">
          <h3>Connect your own wallet (NWC)</h3>
          <p className="muted">
            Paste a Nostr Wallet Connect pairing string — invoices will be
            minted straight from your wallet.
          </p>
          <div className="row">
            <input
              type="password"
              placeholder="nostr+walletconnect://…"
              value={nwcString}
              onChange={e => setNwcString(e.target.value)}
            />
            <button
              className="secondary"
              disabled={busy || !nwcString.startsWith('nostr+walletconnect://')}
              onClick={() =>
                act(async () => {
                  const wallet = await wallets.create({
                    name: 'My wallet',
                    type: 'NWC',
                    config: { connectionString: nwcString }
                  })
                  await update({
                    mode: 'CUSTOM_NWC',
                    remoteWalletId: wallet.id
                  })
                  setNwcString('')
                }, 'Wallet connected — your address now pays straight into it.')
              }
            >
              Connect
            </button>
          </div>
        </div>

        {address?.mode !== 'IDLE' && (
          <button
            className="link muted"
            disabled={busy}
            onClick={() =>
              act(() => update({ mode: 'IDLE' }), 'Routing cleared.')
            }
          >
            Reset routing
          </button>
        )}
        {feedback && <p className="hint">{feedback}</p>}
      </section>

      <section className="card">
        <h2>Received payments</h2>
        {!invoices?.length ? (
          <p className="muted">
            Nothing yet — share your address and watch this update live.
          </p>
        ) : (
          <ul className="invoices">
            {invoices.slice(0, 5).map(invoice => (
              <li key={invoice.id}>
                <span>{invoice.amountSats} sats</span>
                <span className="muted">
                  {invoice.comment || invoice.description || '—'}
                </span>
                <span
                  className={invoice.status === 'PAID' ? 'accent' : 'muted'}
                >
                  {invoice.status}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  )
}
