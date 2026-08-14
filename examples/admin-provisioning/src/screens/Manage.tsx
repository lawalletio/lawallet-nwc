import type { LaWalletClient, WalletAddress } from '@lawallet-nwc/sdk'
import { useCallback, useEffect, useState } from 'react'

/**
 * Step 3 — the owner manages the address the operator provisioned.
 *
 * The handoff that makes this flow honest: every call here is signed by the
 * VISITOR'S key, not the operator's. Once the address exists it belongs to
 * them, and routing it needs no admin involvement — note this keeps working
 * with self-service registration switched off, because that policy only
 * gates creating addresses, not managing your own.
 */
export function Manage({
  client,
  username,
  domain
}: {
  client: LaWalletClient
  username: string
  domain: string | null
}) {
  const [address, setAddress] = useState<WalletAddress | null>(null)
  const [redirect, setRedirect] = useState('')
  const [nwc, setNwc] = useState('')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setAddress(await client.addresses.get(username))
  }, [client, username])

  useEffect(() => {
    refresh().catch(e => setError(e instanceof Error ? e.message : String(e)))
  }, [refresh])

  const act = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true)
    setError(null)
    setStatus(null)
    try {
      await fn()
      await refresh()
      setStatus(done)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="shell">
      <h1>
        ⚡ {username}@{domain}
      </h1>
      <p className="muted">
        Yours now — these changes are signed with your key, not the operator's.
      </p>

      <section className="card">
        <h2>Routing</h2>
        <p className="muted">
          Currently <strong>{address?.mode ?? '…'}</strong>
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
                  () =>
                    client.addresses.update(username, {
                      mode: 'ALIAS',
                      redirect
                    }),
                  'Alias set — payments now forward there.'
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
            Paste a Nostr Wallet Connect string and invoices are minted by your
            wallet — the instance only routes.
          </p>
          <div className="row">
            <input
              type="password"
              placeholder="nostr+walletconnect://…"
              value={nwc}
              onChange={e => setNwc(e.target.value)}
            />
            <button
              className="secondary"
              disabled={busy || !nwc.startsWith('nostr+walletconnect://')}
              onClick={() =>
                act(async () => {
                  const wallet = await client.remoteWallets.create({
                    name: 'My wallet',
                    type: 'NWC',
                    config: { connectionString: nwc }
                  })
                  await client.addresses.update(username, {
                    mode: 'CUSTOM_NWC',
                    remoteWalletId: wallet.id
                  })
                  setNwc('')
                }, 'Wallet connected — payments land in it directly.')
              }
            >
              Connect
            </button>
          </div>
        </div>

        {address && address.mode !== 'IDLE' && (
          <button
            className="link muted"
            disabled={busy}
            onClick={() =>
              act(
                () => client.addresses.update(username, { mode: 'IDLE' }),
                'Routing cleared.'
              )
            }
          >
            Reset routing
          </button>
        )}

        {status && <p className="hint">{status}</p>}
        {error && <p className="error">{error}</p>}
      </section>
    </main>
  )
}
