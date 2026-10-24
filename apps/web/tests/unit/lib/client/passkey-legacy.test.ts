import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createPasskeyRecord,
  serializePasskeyBackup,
  bytesToBase64,
  bytesToHex,
  RECOVERY_PRF_INPUT,
  buildRecoveryEvent,
  encryptRecoveryPayload,
  type RecoveryContext
} from '@nostr-wot/identity/vault'
import {
  derivePath,
  mnemonicToSeed,
  publicKeyFromPrivate
} from '@nostr-wot/identity/accounts'
import { finalizeEvent } from 'nostr-tools/pure'
const mocks = vi.hoisted(() => ({ query: vi.fn(), close: vi.fn() }))
vi.mock('nostr-tools/pool', () => ({
  SimplePool: class {
    querySync = mocks.query
    close = mocks.close
  }
}))
vi.mock('@/lib/client/passkey-prf', async original => ({
  ...(await original<typeof import('@/lib/client/passkey-prf')>()),
  passkeyAssertion: vi.fn()
}))
import { passkeyAssertion } from '@/lib/client/passkey-prf'
import { readLegacyPasskey } from '@/lib/client/passkey-legacy'
const source = { label: 'Legacy', rpId: 'passkeys.example' }
const rawId = new Uint8Array([1, 2, 3, 4])
const credentialId = bytesToBase64(rawId)
const prf = new Uint8Array(32).fill(9)
const secret = new Uint8Array(32).fill(1)
const pubkey = publicKeyFromPrivate(secret)
function assertion(blob?: Uint8Array) {
  return {
    rawId,
    credentialId,
    userHandle: new Uint8Array(Buffer.from(pubkey, 'hex')),
    prfFirst: new Uint8Array(32).fill(8),
    prfSecond: prf.slice(),
    blob
  }
}
function backup(author = pubkey, rpId = source.rpId) {
  return new TextEncoder().encode(
    serializePasskeyBackup(
      createPasskeyRecord(
        {
          activeAccountId: 'one',
          accounts: [
            {
              id: 'one',
              name: 'Personal',
              type: 'nsec',
              pubkey,
              privkey: bytesToHex(secret),
              mnemonic: null,
              nip46Config: null,
              readOnly: false,
              createdAt: 1
            }
          ]
        },
        {
          credentialId,
          rpId,
          recoveryPubkey: author,
          recoveryScope: 'vault',
          prfSalt: bytesToBase64(new TextEncoder().encode(RECOVERY_PRF_INPUT)),
          prf: bytesToBase64(prf)
        }
      )
    )
  )
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.query.mockResolvedValue([])
})
describe('legacy recovery', () => {
  it('opens a shipped vault backup with the legacy PRF in the same ceremony', async () => {
    const accounts = await readLegacyPasskey(
      source,
      assertion(backup()),
      pubkey
    )
    expect(accounts[0]).toMatchObject({
      pubkey,
      secret,
      label: 'Personal',
      default: true
    })
    expect(passkeyAssertion).not.toHaveBeenCalled()
    accounts.forEach(a => a.secret.fill(0))
  })
  it('rejects a vault for a different domain', async () => {
    await expect(
      readLegacyPasskey(
        source,
        assertion(backup(pubkey, 'other.example')),
        pubkey
      )
    ).rejects.toMatchObject({ kind: 'stored-key-invalid' })
  })
  it('rejects a vault whose recovered key does not match the handle author', async () => {
    const other = publicKeyFromPrivate(new Uint8Array(32).fill(2))
    await expect(
      readLegacyPasskey(source, assertion(backup(other)), other)
    ).rejects.toMatchObject({ kind: 'stored-key-invalid' })
  })
  it('recovers a signed legacy seed record using its explicit account path', async () => {
    const mnemonic =
      'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
    const path = "m/44'/1237'/0'/0/0"
    const seed = mnemonicToSeed(mnemonic)
    const key = derivePath(seed, path)
    const author = publicKeyFromPrivate(key)
    const context: RecoveryContext = {
      credentialId,
      rpId: source.rpId,
      pubkey: author,
      scope: 'seed'
    }
    const payload = new TextEncoder().encode(
      JSON.stringify({
        version: 1,
        mnemonic,
        accounts: [{ name: 'Seed', pubkey: author, path }]
      })
    )
    const event = finalizeEvent(
      buildRecoveryEvent(
        context,
        encryptRecoveryPayload(payload, prf, context),
        1
      ),
      key
    )
    mocks.query.mockResolvedValue([event])
    const accounts = await readLegacyPasskey(
      source,
      {
        ...assertion(),
        userHandle: new Uint8Array(Buffer.from(author, 'hex'))
      },
      author
    )
    expect(accounts[0]).toMatchObject({
      pubkey: author,
      secret: key,
      default: true
    })
    expect(passkeyAssertion).not.toHaveBeenCalled()
    accounts.forEach(a => a.secret.fill(0))
    key.fill(0)
    seed.fill(0)
    payload.fill(0)
  })
  it('rejects a pinned retry returning a different credential', async () => {
    vi.mocked(passkeyAssertion).mockResolvedValue({
      ...assertion(),
      rawId: new Uint8Array([9]),
      prfFirst: prf.slice()
    })
    await expect(
      readLegacyPasskey(
        source,
        { ...assertion(backup()), prfSecond: undefined },
        pubkey
      )
    ).rejects.toMatchObject({ kind: 'stored-key-invalid' })
  })
})
