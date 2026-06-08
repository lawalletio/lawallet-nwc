import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  DriverConfigError,
  UnsupportedDriverError,
} from '@/lib/wallet/drivers/errors'
import {
  driverForWallet,
  getDriver,
  listDriverTypes,
  registerDriver,
  unregisterDriver,
} from '@/lib/wallet/drivers/registry'
import type { RemoteWalletDriver } from '@/lib/wallet/drivers/types'

/**
 * Minimal stub driver used to exercise the registry without pulling in the
 * NWC SDK. The schema is deliberately strict so we can validate the
 * `DriverConfigError` path.
 */
function makeStubDriver(): RemoteWalletDriver<{ token: string }> {
  return {
    type: 'NWC',
    configSchema: z.object({ token: z.string().min(1) }).strict(),
    async getBalance() {
      return { balanceSats: 1234 }
    },
    async payInvoice() {
      return { preimage: 'p', feesPaidSats: 0 }
    },
    async makeInvoice() {
      return {
        bolt11: 'lnbc1',
        paymentHash: 'h',
        amountSats: 1,
        description: '',
        expiresAt: null,
      }
    },
  }
}

describe('driver registry', () => {
  beforeEach(() => {
    // Tests below register/unregister deterministically; nothing else does.
    unregisterDriver('NWC')
    unregisterDriver('LND')
    unregisterDriver('CLN')
    unregisterDriver('BTCPAY')
  })
  afterEach(() => {
    unregisterDriver('NWC')
    unregisterDriver('LND')
    unregisterDriver('CLN')
    unregisterDriver('BTCPAY')
  })

  it('register + getDriver round-trips by type', () => {
    const stub = makeStubDriver()
    registerDriver(stub)
    expect(getDriver('NWC')).toBe(stub)
  })

  it('re-registering the same type overwrites — useful for test stubs', () => {
    const a = makeStubDriver()
    const b = makeStubDriver()
    registerDriver(a)
    registerDriver(b)
    expect(getDriver('NWC')).toBe(b)
  })

  it('getDriver throws UnsupportedDriverError for unregistered type', () => {
    expect(() => getDriver('LND')).toThrow(UnsupportedDriverError)
  })

  it('listDriverTypes reflects registered drivers', () => {
    expect(listDriverTypes()).toEqual([])
    registerDriver(makeStubDriver())
    expect(listDriverTypes()).toEqual(['NWC'])
  })

  describe('driverForWallet', () => {
    it('parses + returns config when valid', () => {
      registerDriver(makeStubDriver())
      const { driver, config } = driverForWallet({
        type: 'NWC',
        config: { token: 'abc' },
      })
      expect(driver.type).toBe('NWC')
      expect(config).toEqual({ token: 'abc' })
    })

    it('throws DriverConfigError when config fails the driver schema', () => {
      registerDriver(makeStubDriver())
      expect(() =>
        driverForWallet({ type: 'NWC', config: { token: '' } }),
      ).toThrow(DriverConfigError)
    })

    it('throws DriverConfigError with the type that failed', () => {
      registerDriver(makeStubDriver())
      try {
        driverForWallet({ type: 'NWC', config: { wrong: 1 } })
        throw new Error('should have thrown')
      } catch (err) {
        expect(err).toBeInstanceOf(DriverConfigError)
        expect((err as DriverConfigError).type).toBe('NWC')
      }
    })

    it('throws UnsupportedDriverError when the wallet type has no driver', () => {
      expect(() =>
        driverForWallet({ type: 'BTCPAY', config: {} }),
      ).toThrow(UnsupportedDriverError)
    })
  })
})
