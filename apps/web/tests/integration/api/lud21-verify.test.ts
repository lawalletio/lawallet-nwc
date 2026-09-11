import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createNextRequest, assertResponse } from '@/tests/helpers/api-helpers'
import { prismaMock, resetPrismaMock } from '@/tests/helpers/prisma-mock'
import { createParamsPromise } from '@/tests/helpers/route-helpers'
import { encryptRemoteWalletEnvelope } from '@/lib/wallet/remote-wallet-vault-core'

const afterMock = vi.hoisted(() =>
  vi.fn((callback: () => unknown) => {
    void callback()
  })
)
const publishZapReceiptMock = vi.hoisted(() => vi.fn())

vi.mock('next/server', async importActual => ({
  ...(await importActual<typeof import('next/server')>()),
  after: afterMock
}))

vi.mock('@/lib/nostr/zap-receipts', () => ({
  publishInvoiceZapReceipt: publishZapReceiptMock
}))

vi.mock('@/lib/config', () => ({
  getConfig: vi.fn(() => ({
    maintenance: { enabled: false },
    nwcVault: {
      enabled: true,
      secret: 'test-vault-secret-with-at-least-32-chars!'
    }
  }))
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  withRequestLogging: (fn: any) => fn
}))

vi.mock('@/lib/middleware/maintenance', () => ({
  checkMaintenance: vi.fn()
}))

vi.mock('@/lib/events/event-bus', () => ({
  eventBus: { emit: vi.fn() }
}))

const lookupInvoiceMock = vi.fn()
const nwcCloseMock = vi.fn()

vi.mock('@getalby/sdk', () => ({
  NWCClient: vi.fn().mockImplementation(() => ({
    lookupInvoice: lookupInvoiceMock,
    close: nwcCloseMock
  }))
}))

import {
  GET,
  OPTIONS
} from '@/app/api/lud16/[username]/verify/[paymentHash]/route'
import { NWCClient } from '@getalby/sdk'
import { closeAllServerNwcClients } from '@/lib/wallet/drivers/nwc-client-cache'

const VALID_HASH = 'a'.repeat(64)
const FUTURE = new Date(Date.now() + 60 * 60 * 1000)
const PAST = new Date(Date.now() - 60 * 60 * 1000)

const WALLET_ID = 'wallet-1'
const VAULT_SECRET = 'test-vault-secret-with-at-least-32-chars!'
// Settlement now runs through the driver registry, which validates the stored
// config against the NWC driver's Zod schema before any relay work — so the
// fixture has to be a real pairing URI, exactly like the one the mint path
// (`driverForWallet` in the /cb route) already required to create this invoice.
const PLAINTEXT_CONN = `nostr+walletconnect://${'a'.repeat(64)}?relay=${encodeURIComponent('wss://relay.test.com')}&secret=${'b'.repeat(64)}`
// A `lwrw1:` ciphertext envelope exactly as production persists it when
// NWC_VAULT_SECRET is set (see lib/wallet/migrate-remote-wallet-vault.ts,
// which asserts no NWC row survives without one). The verify route must
// decrypt this before handing it to NWCClient.
const ENCRYPTED_CONN = encryptRemoteWalletEnvelope(
  PLAINTEXT_CONN,
  WALLET_ID,
  VAULT_SECRET
)

const walletConfig = {
  connectionString: ENCRYPTED_CONN,
  mode: 'SEND_RECEIVE'
}

const baseInvoice = {
  id: 'inv-1',
  paymentHash: VALID_HASH,
  bolt11: 'lnbc100n1test',
  amountSats: 10,
  status: 'PENDING' as const,
  preimage: null as string | null,
  expiresAt: FUTURE,
  // Top-level remoteWallet binding — set on every invoice minted through the
  // LUD-16 callback (see app/api/lud16/[username]/cb/route.ts: `remoteWalletId:
  // mintRoute.walletId`). The verify route's `invoice.remoteWallet` fast path
  // is the branch taken for normal LUD-16 invoices; it must decrypt the stored
  // `lwrw1:` envelope before extracting `connectionString`.
  remoteWallet: {
    id: WALLET_ID,
    type: 'NWC',
    status: 'ACTIVE',
    config: walletConfig
  },
  user: {
    id: 'user-1',
    lightningAddresses: [
      {
        username: 'alice',
        mode: 'CUSTOM_NWC',
        redirect: null,
        remoteWallet: {
          id: WALLET_ID,
          type: 'NWC',
          status: 'ACTIVE',
          config: walletConfig
        }
      }
    ]
  }
}

const primaryWalletAddress = {
  mode: 'CUSTOM_NWC',
  remoteWalletId: WALLET_ID,
  remoteWallet: {
    id: WALLET_ID,
    type: 'NWC',
    status: 'ACTIVE',
    config: walletConfig
  }
}

beforeEach(() => {
  resetPrismaMock()
  vi.clearAllMocks()
  // The driver caches one NWCClient per connection string; clear it so each
  // test's constructor assertions see a fresh call rather than a cache hit
  // from a prior test.
  closeAllServerNwcClients()
  vi.mocked(prismaMock.lightningAddress.findFirst).mockResolvedValue(
    primaryWalletAddress as any
  )
})

describe('GET /api/lud16/[username]/verify/[paymentHash]', () => {
  it('allows cross-origin LUD-21 verification preflights', () => {
    const res = OPTIONS()

    expect(res.status).toBe(204)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('GET')
  })

  it('rejects invalid payment hash format', async () => {
    const req = createNextRequest('/api/lud16/alice/verify/short')
    const res = await GET(
      req,
      createParamsPromise({ username: 'alice', paymentHash: 'short' })
    )
    const body: any = await assertResponse(res, 400)

    expect(body.status).toBe('ERROR')
    expect(body.reason).toContain('Invalid')
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
    expect(prismaMock.invoice.findUnique).not.toHaveBeenCalled()
  })

  it('returns 404 when invoice not found', async () => {
    vi.mocked(prismaMock.invoice.findUnique).mockResolvedValue(null)

    const req = createNextRequest(`/api/lud16/alice/verify/${VALID_HASH}`)
    const res = await GET(
      req,
      createParamsPromise({ username: 'alice', paymentHash: VALID_HASH })
    )

    expect(res.status).toBe(404)
  })

  it('returns 404 when username does not match invoice owner', async () => {
    vi.mocked(prismaMock.invoice.findUnique).mockResolvedValue({
      ...baseInvoice,
      user: { ...baseInvoice.user, lightningAddresses: [{ username: 'bob' }] }
    } as any)

    const req = createNextRequest(`/api/lud16/alice/verify/${VALID_HASH}`)
    const res = await GET(
      req,
      createParamsPromise({ username: 'alice', paymentHash: VALID_HASH })
    )

    expect(res.status).toBe(404)
  })

  it('returns 404 when the hash belongs to a user without that address', async () => {
    // The include filters on `username`, so this is the shape a real
    // cross-account probe produces: the invoice exists, the address does not.
    vi.mocked(prismaMock.invoice.findUnique).mockResolvedValue({
      ...baseInvoice,
      user: { id: 'user-1', lightningAddresses: [] }
    } as any)

    const req = createNextRequest(`/api/lud16/alice/verify/${VALID_HASH}`)
    const res = await GET(
      req,
      createParamsPromise({ username: 'alice', paymentHash: VALID_HASH })
    )

    expect(res.status).toBe(404)
    expect(lookupInvoiceMock).not.toHaveBeenCalled()
  })

  it('returns cached preimage when invoice already PAID', async () => {
    vi.mocked(prismaMock.invoice.findUnique).mockResolvedValue({
      ...baseInvoice,
      status: 'PAID',
      preimage: 'b'.repeat(64)
    } as any)

    const req = createNextRequest(`/api/lud16/alice/verify/${VALID_HASH}`)
    const res = await GET(
      req,
      createParamsPromise({ username: 'alice', paymentHash: VALID_HASH })
    )
    const body: any = await assertResponse(res, 200)

    expect(body).toEqual({
      status: 'OK',
      settled: true,
      preimage: 'b'.repeat(64),
      pr: 'lnbc100n1test'
    })
    // Should not query NWC when already cached
    expect(lookupInvoiceMock).not.toHaveBeenCalled()
  })

  it('retries the zap receipt when an already-paid zap invoice is verified', async () => {
    // The payer polling verify is the one signal that arrives even when relays
    // rejected the receipt earlier, so it doubles as a publish retry. The
    // publish itself is idempotent — it no-ops once an event id is stored.
    vi.mocked(prismaMock.invoice.findUnique).mockResolvedValue({
      ...baseInvoice,
      status: 'PAID',
      preimage: 'b'.repeat(64),
      zapRequest: { kind: 9734 }
    } as any)

    const req = createNextRequest(`/api/lud16/alice/verify/${VALID_HASH}`)
    const res = await GET(
      req,
      createParamsPromise({ username: 'alice', paymentHash: VALID_HASH })
    )
    await assertResponse(res, 200)

    expect(publishZapReceiptMock).toHaveBeenCalledWith(baseInvoice.id)
  })

  it('does not attempt a receipt for an already-paid ordinary invoice', async () => {
    vi.mocked(prismaMock.invoice.findUnique).mockResolvedValue({
      ...baseInvoice,
      status: 'PAID',
      preimage: 'b'.repeat(64),
      zapRequest: null
    } as any)

    const req = createNextRequest(`/api/lud16/alice/verify/${VALID_HASH}`)
    await GET(
      req,
      createParamsPromise({ username: 'alice', paymentHash: VALID_HASH })
    )

    expect(publishZapReceiptMock).not.toHaveBeenCalled()
  })

  it('returns settled when the listener confirmed payment without a preimage', async () => {
    vi.mocked(prismaMock.invoice.findUnique).mockResolvedValue({
      ...baseInvoice,
      status: 'PAID',
      preimage: null,
      expiresAt: PAST
    } as any)

    const req = createNextRequest(`/api/lud16/alice/verify/${VALID_HASH}`)
    const res = await GET(
      req,
      createParamsPromise({ username: 'alice', paymentHash: VALID_HASH })
    )
    const body: any = await assertResponse(res, 200)

    expect(body).toEqual({
      status: 'OK',
      settled: true,
      preimage: null,
      pr: 'lnbc100n1test'
    })
    expect(lookupInvoiceMock).not.toHaveBeenCalled()
  })

  it('returns unsettled for expired invoices without querying NWC', async () => {
    vi.mocked(prismaMock.invoice.findUnique).mockResolvedValue({
      ...baseInvoice,
      expiresAt: PAST
    } as any)

    const req = createNextRequest(`/api/lud16/alice/verify/${VALID_HASH}`)
    const res = await GET(
      req,
      createParamsPromise({ username: 'alice', paymentHash: VALID_HASH })
    )
    const body: any = await assertResponse(res, 200)

    expect(body).toEqual({
      status: 'OK',
      settled: false,
      preimage: null,
      pr: 'lnbc100n1test'
    })
    expect(lookupInvoiceMock).not.toHaveBeenCalled()
  })

  it('queries NWC and persists settled state when payment arrives', async () => {
    vi.mocked(prismaMock.invoice.findUnique).mockResolvedValue(
      baseInvoice as any
    )
    lookupInvoiceMock.mockResolvedValue({
      state: 'settled',
      preimage: 'c'.repeat(64),
      settled_at: 1_700_000_000
    })

    const req = createNextRequest(`/api/lud16/alice/verify/${VALID_HASH}`)
    const res = await GET(
      req,
      createParamsPromise({ username: 'alice', paymentHash: VALID_HASH })
    )
    const body: any = await assertResponse(res, 200)

    expect(body.settled).toBe(true)
    expect(body.preimage).toBe('c'.repeat(64))
    expect(lookupInvoiceMock).toHaveBeenCalledWith({ payment_hash: VALID_HASH })
    // Guarded on PENDING: the listener webhook races this poll for the same
    // invoice, and whoever loses must not overwrite the winner's `paidAt`.
    expect(prismaMock.invoice.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { paymentHash: VALID_HASH, status: 'PENDING' },
        data: expect.objectContaining({
          status: 'PAID',
          preimage: 'c'.repeat(64)
        })
      })
    )
    // The PENDING → PAID transition must fire `invoices:updated` so the
    // payee's address-detail feed (and other live consumers) flip the row
    // without requiring a manual refresh. Guarded inside the status
    // change — re-verifying an already-paid invoice must NOT re-emit.
    const { eventBus } = await import('@/lib/events/event-bus')
    expect(eventBus.emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'invoices:updated' })
    )
    // The driver shares one memoised NWCClient per connection string, so a
    // single lookup must never close it — that would drop the relay
    // subscription out from under every other caller of the same wallet.
    expect(nwcCloseMock).not.toHaveBeenCalled()
  })

  it('does not emit invoices:updated on repeat verify of an already-paid invoice', async () => {
    vi.mocked(prismaMock.invoice.findUnique).mockResolvedValue({
      ...baseInvoice,
      status: 'PAID',
      preimage: 'c'.repeat(64)
    } as any)

    const { eventBus } = await import('@/lib/events/event-bus')
    vi.mocked(eventBus.emit).mockClear()

    const req = createNextRequest(`/api/lud16/alice/verify/${VALID_HASH}`)
    await GET(
      req,
      createParamsPromise({ username: 'alice', paymentHash: VALID_HASH })
    )

    // Early-return path: no DB update, no bus event. Avoids spamming
    // clients every time a sender polls an already-settled invoice.
    expect(prismaMock.invoice.update).not.toHaveBeenCalled()
    expect(eventBus.emit).not.toHaveBeenCalled()
  })

  it('returns unsettled without preimage when NWC says pending', async () => {
    vi.mocked(prismaMock.invoice.findUnique).mockResolvedValue(
      baseInvoice as any
    )
    lookupInvoiceMock.mockResolvedValue({
      state: 'pending',
      preimage: ''
    })

    const req = createNextRequest(`/api/lud16/alice/verify/${VALID_HASH}`)
    const res = await GET(
      req,
      createParamsPromise({ username: 'alice', paymentHash: VALID_HASH })
    )
    const body: any = await assertResponse(res, 200)

    expect(body.settled).toBe(false)
    expect(body.preimage).toBeNull()
    expect(prismaMock.invoice.update).not.toHaveBeenCalled()
  })

  it('returns unsettled when NWC call fails (retry-later semantics)', async () => {
    vi.mocked(prismaMock.invoice.findUnique).mockResolvedValue(
      baseInvoice as any
    )
    lookupInvoiceMock.mockRejectedValue(new Error('relay timeout'))

    const req = createNextRequest(`/api/lud16/alice/verify/${VALID_HASH}`)
    const res = await GET(
      req,
      createParamsPromise({ username: 'alice', paymentHash: VALID_HASH })
    )
    const body: any = await assertResponse(res, 200)

    expect(body.status).toBe('OK')
    expect(body.settled).toBe(false)
    expect(body.preimage).toBeNull()
    expect(prismaMock.invoice.update).not.toHaveBeenCalled()
  })

  it('returns unsettled when user has no wallet configured', async () => {
    vi.mocked(prismaMock.invoice.findUnique).mockResolvedValue({
      ...baseInvoice,
      // No top-level bound wallet AND no address wallet — nothing to look up.
      remoteWallet: null,
      user: {
        ...baseInvoice.user,
        // The address exists but names no wallet — nothing to look up against.
        lightningAddresses: [
          {
            username: 'alice',
            mode: 'CUSTOM_NWC',
            redirect: null,
            remoteWallet: null
          }
        ]
      }
    } as any)
    vi.mocked(prismaMock.lightningAddress.findFirst).mockResolvedValue(null)

    const req = createNextRequest(`/api/lud16/alice/verify/${VALID_HASH}`)
    const res = await GET(
      req,
      createParamsPromise({ username: 'alice', paymentHash: VALID_HASH })
    )
    const body: any = await assertResponse(res, 200)

    expect(body.settled).toBe(false)
    expect(lookupInvoiceMock).not.toHaveBeenCalled()
  })

  // ── Vault-encrypted remoteWallet fast path ────────────────────────────────
  //
  // Regression coverage for the `invoice.remoteWallet` branch, which
  // historically copied the raw Prisma `config` (a `lwrw1:` ciphertext when
  // NWC_VAULT_SECRET is set) straight into NWCClient. The route must decrypt
  // the envelope via resolveWalletRoute → decryptRemoteWalletConfig before
  // handing the connection string to NWCClient.

  it('decrypts the bound remoteWallet connectionString before handing it to NWCClient', async () => {
    vi.mocked(prismaMock.invoice.findUnique).mockResolvedValue(
      baseInvoice as any
    )
    lookupInvoiceMock.mockResolvedValue({
      state: 'settled',
      preimage: 'c'.repeat(64),
      settled_at: 1_700_000_000
    })

    const req = createNextRequest(`/api/lud16/alice/verify/${VALID_HASH}`)
    await GET(
      req,
      createParamsPromise({ username: 'alice', paymentHash: VALID_HASH })
    )

    // NWCClient must receive the decrypted `nostr+walletconnect://` URI,
    // never the `lwrw1:` ciphertext envelope that's persisted in the DB.
    expect(NWCClient).toHaveBeenCalledTimes(1)
    const ctorArg = vi.mocked(NWCClient).mock.calls[0][0] as {
      nostrWalletConnectUrl: string
    }
    expect(ctorArg.nostrWalletConnectUrl).toBe(PLAINTEXT_CONN)
    expect(ctorArg.nostrWalletConnectUrl.startsWith('lwrw1:')).toBe(false)
  })

  it('settles an actually-paid invoice whose DB status is still PENDING via the bound wallet', async () => {
    vi.mocked(prismaMock.invoice.findUnique).mockResolvedValue(
      baseInvoice as any
    )
    lookupInvoiceMock.mockResolvedValue({
      state: 'settled',
      preimage: 'c'.repeat(64),
      settled_at: 1_700_000_000
    })

    const req = createNextRequest(`/api/lud16/alice/verify/${VALID_HASH}`)
    const res = await GET(
      req,
      createParamsPromise({ username: 'alice', paymentHash: VALID_HASH })
    )
    const body: any = await assertResponse(res, 200)

    // The whole point of the wallet-lookup block: detect settlement for an
    // invoice that no other channel has marked PAID yet. Without the
    // decryption fix, lookupInvoice would never be reached and this would
    // return settled: false.
    expect(body.settled).toBe(true)
    expect(body.preimage).toBe('c'.repeat(64))
    expect(lookupInvoiceMock).toHaveBeenCalledWith({ payment_hash: VALID_HASH })
  })

  it('treats a non-ACTIVE bound remoteWallet as unconfigured (no NWC lookup)', async () => {
    vi.mocked(prismaMock.invoice.findUnique).mockResolvedValue({
      ...baseInvoice,
      remoteWallet: {
        id: WALLET_ID,
        type: 'NWC',
        status: 'DEAD',
        config: walletConfig
      }
    } as any)

    const req = createNextRequest(`/api/lud16/alice/verify/${VALID_HASH}`)
    const res = await GET(
      req,
      createParamsPromise({ username: 'alice', paymentHash: VALID_HASH })
    )
    const body: any = await assertResponse(res, 200)

    // resolveWalletRoute's walletRoute() gates on status === 'ACTIVE'. A
    // DEAD wallet must short-circuit to unconfigured rather than feeding a
    // doomed NWC client.
    expect(body).toEqual({
      status: 'OK',
      settled: false,
      preimage: null,
      pr: 'lnbc100n1test'
    })
    expect(NWCClient).not.toHaveBeenCalled()
    expect(lookupInvoiceMock).not.toHaveBeenCalled()
  })

  it('decrypts the address remoteWallet via the fallback branch when the invoice has no bound wallet', async () => {
    // Older invoices minted before the top-level `remoteWalletId` binding
    // fall through to the address-scoped resolveWalletRoute branch. That
    // branch must ALSO decrypt a `lwrw1:` envelope before NWC lookup.
    vi.mocked(prismaMock.invoice.findUnique).mockResolvedValue({
      ...baseInvoice,
      remoteWallet: null
    } as any)
    lookupInvoiceMock.mockResolvedValue({
      state: 'settled',
      preimage: 'c'.repeat(64),
      settled_at: 1_700_000_000
    })

    const req = createNextRequest(`/api/lud16/alice/verify/${VALID_HASH}`)
    const res = await GET(
      req,
      createParamsPromise({ username: 'alice', paymentHash: VALID_HASH })
    )
    const body: any = await assertResponse(res, 200)

    expect(body.settled).toBe(true)
    expect(body.preimage).toBe('c'.repeat(64))
    expect(NWCClient).toHaveBeenCalledTimes(1)
    const ctorArg = vi.mocked(NWCClient).mock.calls[0][0] as {
      nostrWalletConnectUrl: string
    }
    expect(ctorArg.nostrWalletConnectUrl).toBe(PLAINTEXT_CONN)
  })

  it('still works with a plaintext connectionString (non-lwrw1: passthrough, vault configured)', async () => {
    // decryptRemoteWalletConnectionString is a passthrough for non-`lwrw1:`
    // values regardless of whether NWC_VAULT_SECRET is set, so the verify
    // route must keep working with plaintext URIs stored in the DB.
    const plaintextConfig = {
      connectionString: PLAINTEXT_CONN,
      mode: 'SEND_RECEIVE'
    }
    vi.mocked(prismaMock.invoice.findUnique).mockResolvedValue({
      ...baseInvoice,
      remoteWallet: {
        id: WALLET_ID,
        type: 'NWC',
        status: 'ACTIVE',
        config: plaintextConfig
      },
      user: {
        ...baseInvoice.user,
        lightningAddresses: [
          {
            ...baseInvoice.user.lightningAddresses[0],
            remoteWallet: {
              id: WALLET_ID,
              type: 'NWC',
              status: 'ACTIVE',
              config: plaintextConfig
            }
          }
        ]
      }
    } as any)
    lookupInvoiceMock.mockResolvedValue({
      state: 'settled',
      preimage: 'c'.repeat(64),
      settled_at: 1_700_000_000
    })

    const req = createNextRequest(`/api/lud16/alice/verify/${VALID_HASH}`)
    const res = await GET(
      req,
      createParamsPromise({ username: 'alice', paymentHash: VALID_HASH })
    )
    const body: any = await assertResponse(res, 200)

    expect(body.settled).toBe(true)
    expect(body.preimage).toBe('c'.repeat(64))
    const ctorArg = vi.mocked(NWCClient).mock.calls[0][0] as {
      nostrWalletConnectUrl: string
    }
    expect(ctorArg.nostrWalletConnectUrl).toBe(PLAINTEXT_CONN)
  })
})
