import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Stub for the `NWCClient` constructor exported by `@getalby/sdk`. We mock
 * the whole module so tests never hit a real Nostr relay — the driver only
 * needs `getBalance()` and `payInvoice()` to exist with the SDK's response
 * shape.
 */
const getBalanceMock = vi.fn()
const payInvoiceMock = vi.fn()
const makeInvoiceMock = vi.fn()
const closeMock = vi.fn()
const nwcCtor = vi.fn()

vi.mock('@getalby/sdk', () => {
  class FakeNWCClient {
    constructor(opts: { nostrWalletConnectUrl: string }) {
      nwcCtor(opts)
    }
    getBalance = getBalanceMock
    payInvoice = payInvoiceMock
    makeInvoice = makeInvoiceMock
    close = closeMock
  }
  return { NWCClient: FakeNWCClient }
})

/**
 * Controllable stand-in for the listener bridge. Default `enabled: false`
 * preserves the direct-path behavior every pre-existing test asserts.
 */
const bridge = vi.hoisted(() => ({
  enabled: false,
  request: vi.fn(),
}))

vi.mock('@/lib/wallet/drivers/listener-transport', () => {
  class ListenerUnavailableError extends Error {}
  return {
    ListenerUnavailableError,
    isListenerBridgeEnabled: () => bridge.enabled,
    listenerNwcRequest: (...args: unknown[]) => bridge.request(...args),
  }
})

import { ListenerUnavailableError } from '@/lib/wallet/drivers/listener-transport'

// Import AFTER the mock so the driver's cache module picks up the stub.
import { DriverRemoteError } from '@/lib/wallet/drivers/errors'
import { nwcDriver } from '@/lib/wallet/drivers/nwc-driver'
import {
  closeAllServerNwcClients,
  closeServerNwcClient,
  getServerNwcClient,
} from '@/lib/wallet/drivers/nwc-client-cache'

const VALID_URI = 'nostr+walletconnect://abc?relay=wss%3A%2F%2Fr.example&secret=deadbeef'

/**
 * Parsed-shape config the driver methods see in production — the registry
 * runs the schema before handing it over, which fills the `mode` default.
 * Tests call methods directly so we mirror that shape explicitly.
 */
const CONFIG = { connectionString: VALID_URI, mode: 'RECEIVE' as const }

describe('nwcDriver', () => {
  beforeEach(() => {
    // Evict any clients cached by the previous test BEFORE resetting the
    // mocks — `closeAllServerNwcClients` calls `close()` on each cached
    // client, and we don't want those teardown calls counted against the
    // current test's `closeMock` assertions.
    closeAllServerNwcClients()
    getBalanceMock.mockReset()
    payInvoiceMock.mockReset()
    makeInvoiceMock.mockReset()
    closeMock.mockReset()
    nwcCtor.mockReset()
    bridge.enabled = false
    bridge.request.mockReset()
  })

  it('declares type "NWC"', () => {
    expect(nwcDriver.type).toBe('NWC')
  })

  describe('configSchema', () => {
    it('accepts a well-formed connection string', () => {
      expect(nwcDriver.configSchema.safeParse(CONFIG).success).toBe(true)
    })

    it('also accepts the alternate "nostrwalletconnect://" scheme', () => {
      const alt = 'nostrwalletconnect://abc?relay=wss%3A%2F%2Fr.example&secret=deadbeef'
      expect(nwcDriver.configSchema.safeParse({ connectionString: alt }).success).toBe(true)
    })

    it('rejects non-NWC URIs', () => {
      const r = nwcDriver.configSchema.safeParse({ connectionString: 'https://example.com' })
      expect(r.success).toBe(false)
    })

    it('rejects empty connection string', () => {
      const r = nwcDriver.configSchema.safeParse({ connectionString: '' })
      expect(r.success).toBe(false)
    })

    it('rejects extra keys (strict)', () => {
      const r = nwcDriver.configSchema.safeParse({
        connectionString: VALID_URI,
        extra: 'nope',
      })
      expect(r.success).toBe(false)
    })

    it('defaults mode to RECEIVE when omitted (back-compat with pre-#231 payloads)', () => {
      const r = nwcDriver.configSchema.parse({ connectionString: VALID_URI })
      expect(r.mode).toBe('RECEIVE')
    })

    it('accepts mode=SEND_RECEIVE', () => {
      const r = nwcDriver.configSchema.parse({
        connectionString: VALID_URI,
        mode: 'SEND_RECEIVE',
      })
      expect(r.mode).toBe('SEND_RECEIVE')
    })

    it('rejects an unknown mode', () => {
      const r = nwcDriver.configSchema.safeParse({
        connectionString: VALID_URI,
        mode: 'WRITE_ONLY',
      })
      expect(r.success).toBe(false)
    })

    // ── LNCurl provenance fields ──────────────────────────────────────────
    // LNCurl-minted wallets tag themselves so the LUD-16 + signup flows can
    // re-provision a dead one. Both fields are optional → back-compat holds.

    it('accepts the LNCurl provider tag + server URL', () => {
      const r = nwcDriver.configSchema.safeParse({
        connectionString: VALID_URI,
        provider: 'lncurl',
        lncurlServerUrl: 'https://lncurl.lol',
      })
      expect(r.success).toBe(true)
    })

    it('still parses a config WITHOUT the LNCurl fields (back-compat)', () => {
      const r = nwcDriver.configSchema.safeParse({ connectionString: VALID_URI })
      expect(r.success).toBe(true)
    })

    it('rejects a non-URL lncurlServerUrl', () => {
      const r = nwcDriver.configSchema.safeParse({
        connectionString: VALID_URI,
        lncurlServerUrl: 'not a url',
      })
      expect(r.success).toBe(false)
    })

    it('rejects a provider other than "lncurl"', () => {
      const r = nwcDriver.configSchema.safeParse({
        connectionString: VALID_URI,
        provider: 'someoneelse',
      })
      expect(r.success).toBe(false)
    })

    it('still rejects an unknown extra key with the LNCurl fields present (strict)', () => {
      const r = nwcDriver.configSchema.safeParse({
        connectionString: VALID_URI,
        provider: 'lncurl',
        bogus: 'nope',
      })
      expect(r.success).toBe(false)
    })
  })

  describe('getBalance', () => {
    it('translates the SDK msat response to sats', async () => {
      getBalanceMock.mockResolvedValueOnce({ balance: 12_345_000 })
      const res = await nwcDriver.getBalance(CONFIG)
      expect(res).toEqual({ balanceSats: 12_345 })
    })

    it('floors fractional-msat balances rather than rounding up', async () => {
      // 1234 msats → 1 sat (not 2, not 1.234)
      getBalanceMock.mockResolvedValueOnce({ balance: 1234 })
      const res = await nwcDriver.getBalance(CONFIG)
      expect(res.balanceSats).toBe(1)
    })

    it('handles a zero balance', async () => {
      getBalanceMock.mockResolvedValueOnce({ balance: 0 })
      expect(await nwcDriver.getBalance(CONFIG)).toEqual({ balanceSats: 0 })
    })

    it('passes the connection string through to the SDK constructor', async () => {
      getBalanceMock.mockResolvedValueOnce({ balance: 0 })
      await nwcDriver.getBalance(CONFIG)
      expect(nwcCtor).toHaveBeenCalledWith({ nostrWalletConnectUrl: VALID_URI })
    })

    it('wraps SDK errors in DriverRemoteError so callers get a uniform type', async () => {
      getBalanceMock.mockRejectedValueOnce(new Error('relay timeout'))
      await expect(
        nwcDriver.getBalance(CONFIG),
      ).rejects.toBeInstanceOf(DriverRemoteError)
    })

    it('preserves the original SDK error as `cause`', async () => {
      const original = new Error('relay timeout')
      getBalanceMock.mockRejectedValueOnce(original)
      try {
        await nwcDriver.getBalance(CONFIG)
        throw new Error('should have thrown')
      } catch (err) {
        expect((err as DriverRemoteError).cause).toBe(original)
      }
    })
  })

  describe('payInvoice', () => {
    const BOLT11 = 'lnbc100u1pjxyzwzpp5...'

    it('returns preimage + fees, converting msat fees to sats', async () => {
      payInvoiceMock.mockResolvedValueOnce({ preimage: 'cafebabe', fees_paid: 1_500 })
      const res = await nwcDriver.payInvoice(
        CONFIG,
        { bolt11: BOLT11 },
      )
      expect(res).toEqual({ preimage: 'cafebabe', feesPaidSats: 1 })
    })

    it('treats a missing fees_paid as zero', async () => {
      payInvoiceMock.mockResolvedValueOnce({ preimage: 'aa' })
      const res = await nwcDriver.payInvoice(
        CONFIG,
        { bolt11: BOLT11 },
      )
      expect(res.feesPaidSats).toBe(0)
    })

    it('omits amount when the invoice already encodes one', async () => {
      payInvoiceMock.mockResolvedValueOnce({ preimage: 'aa', fees_paid: 0 })
      await nwcDriver.payInvoice(
        CONFIG,
        { bolt11: BOLT11 },
      )
      expect(payInvoiceMock).toHaveBeenCalledWith({ invoice: BOLT11, amount: undefined })
    })

    it('passes amount in msats for zero-amount invoices', async () => {
      payInvoiceMock.mockResolvedValueOnce({ preimage: 'aa', fees_paid: 0 })
      await nwcDriver.payInvoice(
        CONFIG,
        { bolt11: BOLT11, amountSats: 42 },
      )
      expect(payInvoiceMock).toHaveBeenCalledWith({ invoice: BOLT11, amount: 42_000 })
    })

    it('wraps SDK errors in DriverRemoteError', async () => {
      payInvoiceMock.mockRejectedValueOnce(new Error('insufficient_balance'))
      await expect(
        nwcDriver.payInvoice(CONFIG, { bolt11: BOLT11 }),
      ).rejects.toBeInstanceOf(DriverRemoteError)
    })
  })

  describe('makeInvoice', () => {
    const MADE = {
      invoice: 'lnbc500n1pjmadeup',
      payment_hash: 'abc123',
      amount: 50_000, // msats
      description: 'coffee',
      expires_at: 1_700_000_000, // unix seconds
    }

    it('mints an invoice, normalising msats → sats and expiry s → ms', async () => {
      makeInvoiceMock.mockResolvedValueOnce(MADE)
      const res = await nwcDriver.makeInvoice(CONFIG, { amountSats: 50, description: 'coffee' })
      expect(res).toEqual({
        bolt11: 'lnbc500n1pjmadeup',
        paymentHash: 'abc123',
        amountSats: 50,
        description: 'coffee',
        expiresAt: 1_700_000_000_000,
      })
    })

    it('sends the amount to the SDK in msats', async () => {
      makeInvoiceMock.mockResolvedValueOnce(MADE)
      await nwcDriver.makeInvoice(CONFIG, { amountSats: 50, description: 'coffee' })
      expect(makeInvoiceMock).toHaveBeenCalledWith({ amount: 50_000, description: 'coffee' })
    })

    it('defaults description to empty string when omitted', async () => {
      makeInvoiceMock.mockResolvedValueOnce({ ...MADE, description: '' })
      await nwcDriver.makeInvoice(CONFIG, { amountSats: 50 })
      expect(makeInvoiceMock).toHaveBeenCalledWith({ amount: 50_000, description: '' })
    })

    it('returns null expiresAt when the wallet omits expires_at', async () => {
      const { expires_at, ...noExpiry } = MADE
      makeInvoiceMock.mockResolvedValueOnce(noExpiry)
      const res = await nwcDriver.makeInvoice(CONFIG, { amountSats: 50 })
      expect(res.expiresAt).toBeNull()
    })

    it('rejects a non-positive amount without hitting the SDK', async () => {
      await expect(
        nwcDriver.makeInvoice(CONFIG, { amountSats: 0 }),
      ).rejects.toBeInstanceOf(DriverRemoteError)
      expect(makeInvoiceMock).not.toHaveBeenCalled()
    })

    it('wraps SDK errors (e.g. unsupported make_invoice) in DriverRemoteError', async () => {
      makeInvoiceMock.mockRejectedValueOnce(new Error('method not supported'))
      await expect(
        nwcDriver.makeInvoice(CONFIG, { amountSats: 50 }),
      ).rejects.toBeInstanceOf(DriverRemoteError)
    })
  })

  describe('listener bridge', () => {
    it('routes payInvoice through the bridge — SDK client never constructed', async () => {
      bridge.enabled = true
      bridge.request.mockResolvedValueOnce({ preimage: 'cafebabe', fees_paid: 1_500 })

      const res = await nwcDriver.payInvoice(CONFIG, { bolt11: 'lnbc1' })

      expect(res).toEqual({ preimage: 'cafebabe', feesPaidSats: 1 })
      expect(bridge.request).toHaveBeenCalledWith({
        connectionString: VALID_URI,
        method: 'pay_invoice',
        params: { invoice: 'lnbc1', amount: undefined },
      })
      expect(nwcCtor).not.toHaveBeenCalled()
      expect(payInvoiceMock).not.toHaveBeenCalled()
    })

    it('routes getBalance and makeInvoice through the bridge too', async () => {
      bridge.enabled = true
      bridge.request.mockResolvedValueOnce({ balance: 12_345_000 })
      expect(await nwcDriver.getBalance(CONFIG)).toEqual({ balanceSats: 12_345 })

      bridge.request.mockResolvedValueOnce({
        invoice: 'lnbc500n1pjmadeup',
        payment_hash: 'abc123',
        amount: 50_000,
        description: 'coffee',
        expires_at: 1_700_000_000,
      })
      const made = await nwcDriver.makeInvoice(CONFIG, {
        amountSats: 50,
        description: 'coffee',
      })
      expect(made.bolt11).toBe('lnbc500n1pjmadeup')
      expect(made.expiresAt).toBe(1_700_000_000_000)
      expect(nwcCtor).not.toHaveBeenCalled()
    })

    it('falls back to the direct path when the bridge is unavailable — identical result', async () => {
      bridge.enabled = true
      bridge.request.mockRejectedValueOnce(new ListenerUnavailableError('down'))
      payInvoiceMock.mockResolvedValueOnce({ preimage: 'cafebabe', fees_paid: 1_500 })

      const res = await nwcDriver.payInvoice(CONFIG, { bolt11: 'lnbc1' })

      expect(res).toEqual({ preimage: 'cafebabe', feesPaidSats: 1 })
      expect(payInvoiceMock).toHaveBeenCalledWith({ invoice: 'lnbc1', amount: undefined })
      expect(nwcCtor).toHaveBeenCalledTimes(1)
    })

    it('treats a bridge wallet rejection as FINAL — no direct-path retry', async () => {
      bridge.enabled = true
      bridge.request.mockRejectedValueOnce(
        new DriverRemoteError('NWC wallet error (INSUFFICIENT_BALANCE): nope'),
      )

      await expect(
        nwcDriver.payInvoice(CONFIG, { bolt11: 'lnbc1' }),
      ).rejects.toBeInstanceOf(DriverRemoteError)
      expect(payInvoiceMock).not.toHaveBeenCalled()
      expect(nwcCtor).not.toHaveBeenCalled()
    })

    it('never touches the bridge when disabled', async () => {
      getBalanceMock.mockResolvedValueOnce({ balance: 0 })
      await nwcDriver.getBalance(CONFIG)
      expect(bridge.request).not.toHaveBeenCalled()
    })
  })

  describe('client cache', () => {
    it('reuses the same NWCClient across calls for the same URI', async () => {
      getBalanceMock.mockResolvedValue({ balance: 0 })
      await nwcDriver.getBalance(CONFIG)
      await nwcDriver.getBalance(CONFIG)
      expect(nwcCtor).toHaveBeenCalledTimes(1)
    })

    it('builds a fresh client for a different URI', async () => {
      getBalanceMock.mockResolvedValue({ balance: 0 })
      await nwcDriver.getBalance(CONFIG)
      await nwcDriver.getBalance({ ...CONFIG, connectionString: VALID_URI + "&other=1" })
      expect(nwcCtor).toHaveBeenCalledTimes(2)
    })

    it('closeServerNwcClient evicts a cached client so the next call rebuilds', async () => {
      getBalanceMock.mockResolvedValue({ balance: 0 })
      await getServerNwcClient(VALID_URI)
      expect(nwcCtor).toHaveBeenCalledTimes(1)

      closeServerNwcClient(VALID_URI)
      expect(closeMock).toHaveBeenCalledTimes(1)

      // Cache was evicted → a fresh client is constructed.
      await getServerNwcClient(VALID_URI)
      expect(nwcCtor).toHaveBeenCalledTimes(2)
    })

    it('closeServerNwcClient is a no-op for an uncached URI', () => {
      expect(() => closeServerNwcClient('nostr+walletconnect://never-opened')).not.toThrow()
      expect(closeMock).not.toHaveBeenCalled()
    })

    it('closeServerNwcClient swallows a throwing close() and still evicts', async () => {
      await getServerNwcClient(VALID_URI)
      closeMock.mockImplementationOnce(() => {
        throw new Error('socket already gone')
      })
      expect(() => closeServerNwcClient(VALID_URI)).not.toThrow()
      // Despite the throw, the entry is evicted → next call rebuilds.
      await getServerNwcClient(VALID_URI)
      expect(nwcCtor).toHaveBeenCalledTimes(2)
    })

    it('closeAllServerNwcClients swallows a throwing close()', async () => {
      await getServerNwcClient(VALID_URI)
      closeMock.mockImplementationOnce(() => {
        throw new Error('socket already gone')
      })
      // Must not propagate — best-effort teardown.
      expect(() => closeAllServerNwcClients()).not.toThrow()
    })
  })
})
