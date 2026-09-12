import { beforeEach, describe, expect, it, vi } from 'vitest'
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure'

const mocks = vi.hoisted(() => {
  const close = vi.fn()
  const state: {
    onevent?: (event: {
      content: string
      pubkey: string
    }) => void | Promise<void>
    onclose?: () => void
  } = {}
  const decrypt = { plaintext: '' }
  return { close, state, decrypt }
})

vi.mock('nostr-tools', async importOriginal => {
  const original = await importOriginal<typeof import('nostr-tools')>()
  return {
    ...original,
    SimplePool: class {
      subscribe(
        _relays: string[],
        _filter: unknown,
        handlers: {
          onevent: (event: { content: string; pubkey: string }) => void
          onclose?: () => void
        }
      ) {
        mocks.state.onevent = handlers.onevent
        mocks.state.onclose = handlers.onclose
        return { close: mocks.close }
      }
    }
  }
})

vi.mock('nostr-tools/nip44', async importOriginal => {
  const original = await importOriginal<typeof import('nostr-tools/nip44')>()
  return {
    ...original,
    v2: {
      ...original.v2,
      utils: {
        ...original.v2.utils,
        getConversationKey: () => new Uint8Array(32)
      },
      decrypt: () => mocks.decrypt.plaintext
    }
  }
})

import { createNostrConnectSigner } from '@/lib/client/nostr-signer'

async function startConnect(opts: { timeout: number; signal: AbortSignal }) {
  let uri = ''
  const pending = createNostrConnectSigner({
    ...opts,
    relays: ['wss://relay.test'],
    onURI: generated => {
      uri = generated
    }
  })
  await vi.waitFor(() => {
    expect(uri).not.toBe('')
    expect(mocks.state.onevent).toEqual(expect.any(Function))
  })
  return { uri, pending }
}

describe('createNostrConnectSigner', () => {
  beforeEach(() => {
    mocks.close.mockReset()
    mocks.state.onevent = undefined
    mocks.state.onclose = undefined
    mocks.decrypt.plaintext = ''
  })

  it('times out even when an AbortSignal is also provided', async () => {
    const controller = new AbortController()

    await expect(
      createNostrConnectSigner({
        timeout: 40,
        signal: controller.signal,
        relays: ['wss://relay.test']
      })
    ).rejects.toThrow('Connection timed out')

    expect(mocks.close).toHaveBeenCalled()
  })

  it('aborts while waiting and does not later time out', async () => {
    const controller = new AbortController()
    const started = Date.now()

    const { pending } = await startConnect({
      timeout: 5_000,
      signal: controller.signal
    })

    controller.abort()

    await expect(pending).rejects.toThrow('Connection aborted')
    expect(Date.now() - started).toBeLessThan(1_000)
    expect(mocks.close).toHaveBeenCalled()
  })

  it('rejects immediately when the signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    const started = Date.now()

    await expect(
      createNostrConnectSigner({
        timeout: 5_000,
        signal: controller.signal,
        relays: ['wss://relay.test']
      })
    ).rejects.toThrow('Connection aborted')

    expect(Date.now() - started).toBeLessThan(1_000)
    expect(mocks.close).toHaveBeenCalled()
  })

  it('clears the timeout after a successful connect', async () => {
    const controller = new AbortController()
    const remotePubkey = getPublicKey(generateSecretKey())

    const { uri, pending } = await startConnect({
      timeout: 1_000,
      signal: controller.signal
    })

    const secret = new URL(uri).searchParams.get('secret')
    mocks.decrypt.plaintext = JSON.stringify({ result: secret })

    await mocks.state.onevent?.({
      content: 'ciphertext',
      pubkey: remotePubkey
    })

    await expect(pending).resolves.toMatchObject({
      getPublicKey: expect.any(Function)
    })

    await new Promise(resolve => setTimeout(resolve, 150))
    expect(mocks.close).toHaveBeenCalled()
  })

  it('times out when no AbortSignal is provided', async () => {
    await expect(
      createNostrConnectSigner({
        timeout: 40,
        relays: ['wss://relay.test']
      })
    ).rejects.toThrow('Connection timed out')

    expect(mocks.close).toHaveBeenCalled()
  })

  it('rejects when the relay subscription closes before connection', async () => {
    const controller = new AbortController()
    const { pending } = await startConnect({
      timeout: 5_000,
      signal: controller.signal
    })

    mocks.state.onclose?.()

    await expect(pending).rejects.toThrow(
      'Subscription closed before connection was established'
    )
  })
})
