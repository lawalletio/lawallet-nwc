import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createNextRequest } from '@/tests/helpers/api-helpers'
import { prismaMock, resetPrismaMock } from '@/tests/helpers/prisma-mock'

vi.mock('@/lib/config', () => ({
  getConfig: vi.fn(() => ({
    maintenance: { enabled: false },
    requestLimits: { maxBodySize: 1_048_576, maxJsonSize: 1_048_576 }
  }))
}))
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  withRequestLogging: (fn: unknown) => fn
}))
vi.mock('@/lib/settings-auth', () => ({
  authenticateSettingsWriteRequest: vi.fn()
}))
vi.mock('@/lib/listener-config', () => ({
  getListenerConfig: vi.fn(async () => ({
    enabled: true,
    url: 'http://listener',
    secret: 'secret'
  }))
}))
vi.mock('@/lib/proxy/config', () => ({
  getProxyConfig: vi.fn(async () => ({
    id: 'default',
    enabled: true,
    nwcCiphertext: Uint8Array.from([1])
  }))
}))
vi.mock('@/lib/proxy/vault', () => ({
  decryptProxySecret: vi.fn(() => 'nwc-uri')
}))
vi.mock('@/lib/wallet/drivers/nwc-client-cache', () => ({
  getServerNwcClient: vi.fn()
}))
vi.mock('@/lib/wallet/drivers/listener-transport', () => ({
  listenerNwcRequest: vi.fn(),
  resetListenerRequestCircuit: vi.fn()
}))

import { POST } from '@/app/api/settings/lud16-proxy/test/route'
import {
  listenerNwcRequest,
  resetListenerRequestCircuit
} from '@/lib/wallet/drivers/listener-transport'

describe('POST /api/settings/lud16-proxy/test via the listener', () => {
  beforeEach(() => {
    resetPrismaMock()
    vi.clearAllMocks()
  })

  it('resets the listener circuit before probing so the test reaches it', async () => {
    const order: string[] = []
    vi.mocked(resetListenerRequestCircuit).mockImplementation(() => {
      order.push('reset')
    })
    vi.mocked(listenerNwcRequest).mockImplementation(async (_b, input) => {
      order.push(input.method)
      return input.method === 'get_info'
        ? {
            methods: [
              'make_invoice',
              'pay_invoice',
              'lookup_invoice',
              'get_balance'
            ]
          }
        : { balance: 5000 }
    })

    const res = await POST(
      createNextRequest('/api/settings/lud16-proxy/test', { method: 'POST' })
    )

    expect(await res.json()).toMatchObject({ ok: true, balanceMsats: 5000 })
    expect(order[0]).toBe('reset')
    expect(order).toHaveLength(3)
    expect(prismaMock.proxyServiceConfig.update).toHaveBeenCalledOnce()
  })
})
