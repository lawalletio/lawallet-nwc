import { describe, expect, it } from 'vitest'
import type { ListenerEnv } from '../src/env'
import { decryptRemoteWalletNwcUri } from '../src/remote-wallet-vault'
import { encryptRemoteWalletEnvelope } from '../../web/lib/wallet/remote-wallet-vault-core'

const ACTIVE_SECRET =
  'active-remote-wallet-secret-0123456789abcdef0123456789abcdef'
const OLD_SECRET =
  'previous-remote-wallet-secret-0123456789abcdef0123456789abcd'
const NWC_URI =
  'nostr+walletconnect://' +
  'a'.repeat(64) +
  '?relay=wss%3A%2F%2Frelay.example&secret=' +
  'b'.repeat(64)

function env(overrides: Partial<ListenerEnv> = {}): ListenerEnv {
  return {
    LISTENER_AUTH_SECRET: 'listener-shared-secret-0123456789abcdef',
    WEB_ORIGIN: 'https://lawallet.example',
    NWC_VAULT_SECRET: ACTIVE_SECRET,
    ...overrides
  } as ListenerEnv
}

describe('listener remote wallet vault', () => {
  it('decrypts envelopes written by the web service', () => {
    const stored = encryptRemoteWalletEnvelope(
      NWC_URI,
      'wallet-1',
      ACTIVE_SECRET
    )
    expect(decryptRemoteWalletNwcUri(stored, 'wallet-1', env())).toBe(NWC_URI)
  })

  it('accepts the previous deployment secret during rotation', () => {
    const stored = encryptRemoteWalletEnvelope(NWC_URI, 'wallet-1', OLD_SECRET)
    expect(
      decryptRemoteWalletNwcUri(
        stored,
        'wallet-1',
        env({ NWC_VAULT_SECRET_PREVIOUS: OLD_SECRET })
      )
    ).toBe(NWC_URI)
  })

  it('rejects an envelope copied to another wallet id', () => {
    const stored = encryptRemoteWalletEnvelope(
      NWC_URI,
      'wallet-1',
      ACTIVE_SECRET
    )
    expect(() => decryptRemoteWalletNwcUri(stored, 'wallet-2', env())).toThrow(
      'decryption failed'
    )
  })

  it('accepts plaintext only for rolling-deploy compatibility', () => {
    expect(decryptRemoteWalletNwcUri(NWC_URI, 'legacy-wallet')).toBe(NWC_URI)
  })
})
