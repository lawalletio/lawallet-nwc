import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  migrateRemoteWalletNwcConfigs: vi.fn(),
  initializeProxyReceiptSigner: vi.fn()
}))

vi.mock('@/lib/wallet/migrate-remote-wallet-vault', () => ({
  migrateRemoteWalletNwcConfigs: mocks.migrateRemoteWalletNwcConfigs
}))

vi.mock('@/lib/proxy/initialize-receipt-signer', () => ({
  initializeProxyReceiptSigner: mocks.initializeProxyReceiptSigner
}))

import { register } from '@/instrumentation'

const originalRuntime = process.env.NEXT_RUNTIME
const originalPhase = process.env.NEXT_PHASE

beforeEach(() => {
  vi.clearAllMocks()
  delete process.env.NEXT_RUNTIME
  delete process.env.NEXT_PHASE
  mocks.migrateRemoteWalletNwcConfigs.mockResolvedValue(0)
  mocks.initializeProxyReceiptSigner.mockResolvedValue(false)
})

afterEach(() => {
  if (originalRuntime === undefined) delete process.env.NEXT_RUNTIME
  else process.env.NEXT_RUNTIME = originalRuntime
  if (originalPhase === undefined) delete process.env.NEXT_PHASE
  else process.env.NEXT_PHASE = originalPhase
})

describe('server instrumentation', () => {
  it('initializes the proxy signer after secret-backed data migrations', async () => {
    await register()

    expect(mocks.migrateRemoteWalletNwcConfigs).toHaveBeenCalledOnce()
    expect(mocks.initializeProxyReceiptSigner).toHaveBeenCalledOnce()
    expect(
      mocks.migrateRemoteWalletNwcConfigs.mock.invocationCallOrder[0]
    ).toBeLessThan(
      mocks.initializeProxyReceiptSigner.mock.invocationCallOrder[0]
    )
  })

  it('does not initialize secrets during a production build', async () => {
    process.env.NEXT_PHASE = 'phase-production-build'

    await register()

    expect(mocks.migrateRemoteWalletNwcConfigs).not.toHaveBeenCalled()
    expect(mocks.initializeProxyReceiptSigner).not.toHaveBeenCalled()
  })
})
