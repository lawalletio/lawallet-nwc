import { describe, it, expect, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  ready: vi.fn(),
  close: vi.fn(),
  getPublicKey: vi.fn(async () => '11'.repeat(32)),
  signEvent: vi.fn()
}))
vi.mock('nostr-wot-sdk/signers', () => ({
  NosskeyIframeSigner: class {
    ready = mocks.ready
    close = mocks.close
    getPublicKey = mocks.getPublicKey
    signEvent = mocks.signEvent
    nip04Encrypt = vi.fn()
    nip04Decrypt = vi.fn()
    nip44Encrypt = vi.fn()
    nip44Decrypt = vi.fn()
  }
}))
import {
  createPasskeyProviderSigner,
  closePasskeyProviderSigner
} from '@/lib/client/passkey-provider'
describe('provider signer lifecycle', () => {
  it('does not open a provider when already cancelled', async () => {
    const c = new AbortController()
    c.abort()
    await expect(
      createPasskeyProviderSigner('https://provider.example', c.signal)
    ).rejects.toThrow()
  })
  it('closes the provider on initialization failure', async () => {
    mocks.ready.mockRejectedValueOnce(new Error('timeout'))
    await expect(
      createPasskeyProviderSigner('https://provider.example')
    ).rejects.toThrow('timeout')
    expect(mocks.close).toHaveBeenCalled()
  })
  it('disposes a successful adapter idempotently', async () => {
    mocks.ready.mockResolvedValue(undefined)
    mocks.close.mockClear()
    const signer = await createPasskeyProviderSigner('https://provider.example')
    expect(await signer.getPublicKey()).toBe('11'.repeat(32))
    closePasskeyProviderSigner(signer)
    closePasskeyProviderSigner(signer)
    expect(mocks.close).toHaveBeenCalledTimes(1)
  })
})
