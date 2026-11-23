import { sealStoredRecord } from '@/tests/unit/lib/client/passkey-record-fixture'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { http, HttpResponse } from 'msw'
import { finalizeEvent, getPublicKey, verifyEvent } from 'nostr-tools/pure'
import { server } from '@/tests/mocks/server'

// happy-dom ships no WebAuthn API: creation goes through a mocked
// @simplewebauthn/browser, assertions through a stubbed navigator.credentials.
// Crypto, handles and records are all real.
vi.mock('@simplewebauthn/browser', () => ({
  browserSupportsWebAuthn: vi.fn(() => true),
  startRegistration: vi.fn()
}))

const relayQuery = vi.hoisted(() =>
  vi.fn(async (..._args: unknown[]) => [] as any[])
)
vi.mock('nostr-tools/pool', () => ({
  SimplePool: class {
    querySync = relayQuery
    close() {}
  }
}))

import { startRegistration } from '@simplewebauthn/browser'
import { authenticateWithPasskey } from '@/lib/client/passkey-api'
import {
  copyRememberedSource,
  forgetRememberedSource,
  linkKeptKey,
  protectImportedKey,
  readImportSource,
  readRememberedSource,
  recordFromEvent,
  rememberSource,
  REMEMBERED_SOURCE_KEY,
  signInWithRememberedSource
} from '@/lib/client/passkey-import'
import { bytesToBase64url } from '@/lib/client/passkey-prf'
import { createStoredHandle } from '@/lib/passkey-handle'
import {
  bytesToHex,
  hexToBytes,
  openStoredAccounts,
  storedPrfInput,
  wipeStoredAccounts
} from '@/lib/passkey-store'

const SOURCE = { label: 'Test source', rpId: 'passkeys.example' }
const SOURCE_CREDENTIAL = new Uint8Array([9, 9, 9, 9])
const SOURCE_PRF = 5
const OWN_CREDENTIAL = new Uint8Array([7, 7, 7, 7])
const OWN_PRF = 6

const KEY_A = '00'.repeat(31) + '0a'
const KEY_B = '00'.repeat(31) + '0b'
const PUB_A = getPublicKey(hexToBytes(KEY_A))
const PUB_B = getPublicKey(hexToBytes(KEY_B))

const json = (value: unknown) => new TextEncoder().encode(JSON.stringify(value))
const ownRpId = () => window.location.hostname

interface StubAssertion {
  rawId: Uint8Array
  userHandle: Uint8Array | null
  extensions: Record<string, unknown>
}

/** Queues assertion results; records each request's publicKey options. */
function stubAssertions(...results: StubAssertion[]) {
  const requests: any[] = []
  const get = vi.fn(async (options: { publicKey: unknown }) => {
    requests.push(options.publicKey)
    const next = results.shift()
    if (!next) throw new Error('unexpected assertion')
    return {
      rawId: next.rawId.buffer,
      response: { userHandle: next.userHandle?.buffer ?? null },
      getClientExtensionResults: () => next.extensions
    }
  })
  vi.stubGlobal('navigator', { ...navigator, credentials: { get } })
  return requests
}

function failedRelayCopy() {
  relayQuery.mockResolvedValue([
    finalizeEvent(
      {
        kind: 31778,
        created_at: 2,
        tags: [
          ['d', `${bytesToBase64url(SOURCE_CREDENTIAL)}:vault`],
          ['rp', SOURCE.rpId]
        ],
        content: 'broken'
      },
      hexToBytes(KEY_B)
    )
  ])
}

async function sourceVault() {
  return sealStoredRecord(
    json({
      accounts: [
        { kind: 'key', secret: KEY_A, label: 'Personal' },
        { kind: 'hardware', device: 'x' },
        { kind: 'key', secret: KEY_B, label: 'Work', default: true }
      ]
    }),
    new Uint8Array(32).fill(SOURCE_PRF),
    'vault',
    { rpId: SOURCE.rpId, author: PUB_B, credentialId: SOURCE_CREDENTIAL }
  )
}

beforeEach(() => {
  relayQuery.mockReset().mockResolvedValue([])
  vi.mocked(startRegistration).mockReset()
})
afterEach(() => vi.unstubAllGlobals())

describe('readImportSource', () => {
  it("decrypts a vault from the source passkey's largeBlob", async () => {
    const prf = new Uint8Array(32).fill(SOURCE_PRF)
    const requests = stubAssertions({
      rawId: SOURCE_CREDENTIAL,
      userHandle: createStoredHandle(PUB_B),
      extensions: {
        prf: { results: { first: prf.buffer } },
        largeBlob: { blob: (await sourceVault()).buffer }
      }
    })

    const imported = await readImportSource(SOURCE)

    expect(requests[0].rpId).toBe(SOURCE.rpId)
    expect(requests[0].allowCredentials).toBeUndefined()
    expect(
      bytesToHex(new Uint8Array(requests[0].extensions.prf.eval.first))
    ).toBe(bytesToHex(storedPrfInput()))
    expect(new TextDecoder().decode(requests[0].extensions.prf.eval.second)).toBe('keytr-v1')
    expect(requests[0].extensions.largeBlob).toEqual({ read: true })
    expect(imported.author).toBe(PUB_B)
    // The unknown kind is skipped; the default stays marked.
    expect(imported.accounts.map(a => [a.pubkey, a.default])).toEqual([
      [PUB_A, false],
      [PUB_B, true]
    ])
    expect(prf.every(b => b === 0)).toBe(true)
    wipeStoredAccounts(imported.accounts)
  })

  it.each([false, true])(
    'uses the newer relay vault despite provider present (corrupt=%s)',
    async corrupt => {
      const record = await sealStoredRecord(
        json({
          updated_at: 100,
          accounts: [{ kind: 'key', secret: KEY_B, label: 'New snapshot' }]
        }),
        new Uint8Array(32).fill(SOURCE_PRF),
        'vault',
        { rpId: SOURCE.rpId, author: PUB_B, credentialId: SOURCE_CREDENTIAL }
      )
      relayQuery.mockResolvedValue([
        finalizeEvent(
          {
            kind: 31778,
            created_at: 100,
            content: Buffer.from(record).toString('base64'),
            tags: [
              ['d', `${bytesToBase64url(SOURCE_CREDENTIAL)}:vault`],
              ['credential', bytesToBase64url(SOURCE_CREDENTIAL)],
              ['rp', SOURCE.rpId],
              ['type', 'vault']
            ]
          },
          hexToBytes(KEY_B)
        )
      ])
      const blob = await sourceVault()
      if (corrupt) blob[blob.length - 1] ^= 1
      stubAssertions({
        rawId: SOURCE_CREDENTIAL,
        userHandle: createStoredHandle(PUB_B),
        extensions: {
          prf: {
            results: { first: new Uint8Array(32).fill(SOURCE_PRF).buffer }
          },
          largeBlob: { blob: blob.buffer }
        }
      })
      const imported = await readImportSource(SOURCE)
      expect(imported.accounts.map(a => a.label)).toEqual(['New snapshot'])
      expect(imported.warnings?.length ?? 0).toBe(corrupt ? 1 : 0)
      expect(relayQuery.mock.calls[0][1]).toMatchObject({
        kinds: [31778],
        '#d': ['CQkJCQ:key', 'CQkJCQ:vault']
      })
      wipeStoredAccounts(imported.accounts)
    }
  )

  it('uses provider and reports a malformed newest relay vault without restoring an older vault', async () => {
    const old = await sourceVault()
    const tags = [
      ['d', `${bytesToBase64url(SOURCE_CREDENTIAL)}:vault`],
      ['rp', SOURCE.rpId]
    ]
    relayQuery.mockResolvedValue([
      finalizeEvent(
        { kind: 31778, created_at: 2, content: 'invalid-base64', tags },
        hexToBytes(KEY_B)
      ),
      finalizeEvent(
        {
          kind: 31778,
          created_at: 1,
          content: Buffer.from(old).toString('base64'),
          tags
        },
        hexToBytes(KEY_B)
      )
    ])
    const provider = await sealStoredRecord(
      json({
        updated_at: 0,
        accounts: [{ kind: 'key', secret: KEY_B, label: 'Provider' }]
      }),
      new Uint8Array(32).fill(SOURCE_PRF),
      'vault',
      { rpId: SOURCE.rpId, author: PUB_B, credentialId: SOURCE_CREDENTIAL }
    )
    stubAssertions({
      rawId: SOURCE_CREDENTIAL,
      userHandle: createStoredHandle(PUB_B),
      extensions: {
        prf: { results: { first: new Uint8Array(32).fill(SOURCE_PRF).buffer } },
        largeBlob: { blob: provider.buffer }
      }
    })
    const imported = await readImportSource(SOURCE)
    expect(imported.accounts.map(a => a.label)).toEqual(['Provider'])
    expect(imported.warnings).toHaveLength(1)
    wipeStoredAccounts(imported.accounts)
  })

  it('prefers a vault over a key when both timestamps are zero', async () => {
    const vault = await sealStoredRecord(
      json({ accounts: [{ kind: 'key', secret: KEY_B, label: 'Vault' }] }),
      new Uint8Array(32).fill(SOURCE_PRF),
      'vault',
      { rpId: SOURCE.rpId, author: PUB_B, credentialId: SOURCE_CREDENTIAL }
    )
    relayQuery.mockResolvedValue([
      finalizeEvent(
        {
          kind: 31778,
          created_at: 1,
          content: Buffer.from(vault).toString('base64'),
          tags: [
            ['d', `${bytesToBase64url(SOURCE_CREDENTIAL)}:vault`],
            ['rp', SOURCE.rpId]
          ]
        },
        hexToBytes(KEY_B)
      )
    ])
    const key = await sealStoredRecord(
      hexToBytes(KEY_B),
      new Uint8Array(32).fill(SOURCE_PRF),
      'key',
      { rpId: SOURCE.rpId, author: PUB_B, credentialId: SOURCE_CREDENTIAL }
    )
    stubAssertions({
      rawId: SOURCE_CREDENTIAL,
      userHandle: createStoredHandle(PUB_B),
      extensions: {
        prf: { results: { first: new Uint8Array(32).fill(SOURCE_PRF).buffer } },
        largeBlob: { blob: key.buffer }
      }
    })
    const imported = await readImportSource(SOURCE)
    expect(imported.accounts.map(a => a.label)).toEqual(['Vault'])
    wipeStoredAccounts(imported.accounts)
  })

  it('retries pinned to the passkey when PRF was skipped', async () => {
    const requests = stubAssertions(
      {
        rawId: SOURCE_CREDENTIAL,
        userHandle: createStoredHandle(PUB_B),
        extensions: {}
      },
      {
        rawId: SOURCE_CREDENTIAL,
        userHandle: createStoredHandle(PUB_B),
        extensions: {
          prf: {
            results: { first: new Uint8Array(32).fill(SOURCE_PRF).buffer }
          },
          largeBlob: { blob: (await sourceVault()).buffer }
        }
      }
    )
    const imported = await readImportSource(SOURCE)
    expect(new Uint8Array(requests[1].allowCredentials[0].id)).toEqual(
      SOURCE_CREDENTIAL
    )
    expect(imported.accounts).toHaveLength(2)
  })

  it.each([
    ['a derived passkey', '4e504b010101' + '00'.repeat(16), 'import-derived'],
    [
      'an untagged passkey',
      bytesToHex(new TextEncoder().encode(crypto.randomUUID())),
      'import-unsupported'
    ],
    ['a key-in-handle passkey', '03' + 'ab'.repeat(32), 'import-unsupported'],
    [
      'an unsupported tagged passkey',
      '4e504b02' + '00'.repeat(18),
      'import-unsupported'
    ]
  ])('refuses %s before decrypting', async (_label, handle, kind) => {
    stubAssertions({
      rawId: SOURCE_CREDENTIAL,
      userHandle: hexToBytes(handle),
      extensions: { prf: { results: { first: new Uint8Array(32).buffer } } }
    })
    await expect(readImportSource(SOURCE)).rejects.toMatchObject({ kind })
  })

  it('names a source that does not allow this origin', async () => {
    vi.stubGlobal('navigator', {
      ...navigator,
      credentials: {
        get: vi.fn(async () => {
          throw new DOMException('not a related origin', 'SecurityError')
        })
      }
    })
    await expect(readImportSource(SOURCE)).rejects.toMatchObject({
      kind: 'import-blocked'
    })
  })

  it("refuses a record whose author isn't the handle's", async () => {
    const record = await sealStoredRecord(
      hexToBytes(KEY_A),
      new Uint8Array(32).fill(SOURCE_PRF),
      'key',
      { rpId: SOURCE.rpId, author: PUB_B, credentialId: SOURCE_CREDENTIAL }
    )
    stubAssertions({
      rawId: SOURCE_CREDENTIAL,
      userHandle: createStoredHandle(PUB_B),
      extensions: {
        prf: { results: { first: new Uint8Array(32).fill(SOURCE_PRF).buffer } },
        largeBlob: { blob: record.buffer }
      }
    })
    await expect(readImportSource(SOURCE)).rejects.toMatchObject({
      kind: 'stored-key-invalid'
    })
  })

  it('refuses a record made for another site', async () => {
    const record = await sealStoredRecord(
      hexToBytes(KEY_B),
      new Uint8Array(32).fill(SOURCE_PRF),
      'key',
      {
        rpId: 'elsewhere.example',
        author: PUB_B,
        credentialId: SOURCE_CREDENTIAL
      }
    )
    stubAssertions({
      rawId: SOURCE_CREDENTIAL,
      userHandle: createStoredHandle(PUB_B),
      extensions: {
        prf: { results: { first: new Uint8Array(32).fill(SOURCE_PRF).buffer } },
        largeBlob: { blob: record.buffer }
      }
    })
    await expect(readImportSource(SOURCE)).rejects.toMatchObject({
      kind: 'stored-key-invalid'
    })
  })
})

describe('recordFromEvent', () => {
  const credentialId = bytesToBase64url(SOURCE_CREDENTIAL)
  const lookup = { author: PUB_B, credentialId, rpId: SOURCE.rpId }

  async function event(tags?: string[][], key = KEY_B) {
    const record = await sourceVault()
    return finalizeEvent(
      {
        kind: 31777,
        created_at: 1,
        content: Buffer.from(record).toString('base64'),
        tags: tags ?? [
          ['d', `${credentialId}:vault`],
          ['credential', credentialId],
          ['v', 'npk1'],
          ['rp', SOURCE.rpId],
          ['type', 'vault']
        ]
      },
      hexToBytes(key)
    )
  }

  it('reads a well-formed event, which then opens', async () => {
    const record = recordFromEvent(await event(), lookup, verifyEvent)
    const accounts = await openStoredAccounts(
      record!,
      new Uint8Array(32).fill(SOURCE_PRF),
      { ...lookup, credentialId: SOURCE_CREDENTIAL }
    )
    expect(accounts).toHaveLength(2)
  })

  it('ignores events by another author, for another RP or with a bad signature', async () => {
    expect(
      recordFromEvent(await event(undefined, KEY_A), lookup, verifyEvent)
    ).toBeNull()
    expect(
      recordFromEvent(
        await event(),
        { ...lookup, rpId: 'other.example' },
        verifyEvent
      )
    ).toBeNull()
    const forged = { ...(await event()), content: 'AAAA' }
    expect(recordFromEvent(forged, lookup, verifyEvent)).toBeNull()
  })

  it('ignores an event whose type tag disagrees with the record', async () => {
    const tags = [
      ['d', `${credentialId}:key`],
      ['credential', credentialId],
      ['v', 'npk1'],
      ['rp', SOURCE.rpId],
      ['type', 'key']
    ]
    expect(recordFromEvent(await event(tags), lookup, verifyEvent)).toBeNull()
  })
})

describe('protectImportedKey + login with the stored passkey', () => {
  function seedServer(onVerify?: (body: any) => void) {
    const options: any[] = []
    server.use(
      http.post(
        '/api/auth/passkey/registration/options',
        async ({ request }) => {
          const body = (await request.json()) as { storedPubkey: string }
          options.push(body)
          return HttpResponse.json({
            options: {
              challenge: 'challenge-0123456789abcdef',
              rp: { id: ownRpId(), name: 'LaWallet' },
              user: {
                id: bytesToBase64url(createStoredHandle(body.storedPubkey))
              }
            }
          })
        }
      ),
      http.post(
        '/api/auth/passkey/registration/verify',
        async ({ request }) => {
          const body = await request.json()
          onVerify?.(body)
          return HttpResponse.json({
            pubkey: PUB_B,
            credential: { id: 'own' }
          })
        }
      )
    )
    return options
  }

  function createdCredential(prfAtCreate = true) {
    vi.mocked(startRegistration).mockResolvedValue({
      id: bytesToBase64url(OWN_CREDENTIAL),
      rawId: bytesToBase64url(OWN_CREDENTIAL),
      type: 'public-key',
      response: { attestationObject: 'att', clientDataJSON: 'cdj' },
      clientExtensionResults: {
        prf: {
          enabled: true,
          ...(prfAtCreate
            ? { results: { first: new Uint8Array(32).fill(OWN_PRF) } }
            : {})
        },
        largeBlob: { supported: true }
      }
    } as any)
  }

  it('preserves recovery warnings when copying a remembered account', async () => {
    seedServer()
    createdCredential()
    failedRelayCopy()
    stubAssertions(
      {
        rawId: SOURCE_CREDENTIAL,
        userHandle: createStoredHandle(PUB_B),
        extensions: {
          prf: {
            results: { first: new Uint8Array(32).fill(SOURCE_PRF).buffer }
          },
          largeBlob: { blob: (await sourceVault()).buffer }
        }
      },
      {
        rawId: OWN_CREDENTIAL,
        userHandle: createStoredHandle(PUB_B),
        extensions: { largeBlob: { written: true } }
      }
    )
    const result = await copyRememberedSource(
      {
        rpId: SOURCE.rpId,
        credentialId: bytesToBase64url(SOURCE_CREDENTIAL),
        pubkey: PUB_B
      },
      'token',
      [SOURCE]
    )
    expect(result.warnings).toHaveLength(1)
  })

  it('writes a key record, registers the pubkey, then logs back in with it', async () => {
    let verifyBody: any
    const optionsBodies = seedServer(body => (verifyBody = body))
    createdCredential()
    let written: Uint8Array | null = null
    const requests: any[] = []
    vi.stubGlobal('navigator', {
      ...navigator,
      credentials: {
        get: vi.fn(async (options: any) => {
          requests.push(options.publicKey)
          written = new Uint8Array(options.publicKey.extensions.largeBlob.write)
          return {
            rawId: OWN_CREDENTIAL.buffer,
            response: { userHandle: createStoredHandle(PUB_B).buffer },
            getClientExtensionResults: () => ({ largeBlob: { written: true } })
          }
        })
      }
    })

    const account = {
      pubkey: PUB_B,
      secret: hexToBytes(KEY_B),
      default: true
    }
    const identity = await protectImportedKey(account)

    expect(optionsBodies).toEqual([{ storedPubkey: PUB_B }])
    const created = vi.mocked(startRegistration).mock.calls[0][0] as any
    expect(
      bytesToHex(new Uint8Array(created.optionsJSON.extensions.prf.eval.first))
    ).toBe(bytesToHex(storedPrfInput()))
    expect(created.optionsJSON.extensions.largeBlob).toEqual({
      support: 'preferred'
    })
    // The write pins the new passkey, and the record is the key, bound to
    // LaWallet's RP, the author and the new credential.
    expect(new Uint8Array(requests[0].allowCredentials[0].id)).toEqual(
      OWN_CREDENTIAL
    )
    const [stored] = await openStoredAccounts(
      written!,
      new Uint8Array(32).fill(OWN_PRF),
      { rpId: ownRpId(), author: PUB_B, credentialId: OWN_CREDENTIAL }
    )
    expect(bytesToHex(stored.secret)).toBe(KEY_B)
    // The server sees the pubkey and a proof, never PRF output or the key.
    expect(identity.pubkey).toBe(PUB_B)
    expect(verifyBody.pubkey).toBe(PUB_B)
    expect(verifyBody.proof.pubkey).toBe(PUB_B)
    expect(verifyBody.credential.clientExtensionResults).toEqual({
      prf: { enabled: true },
      largeBlob: { supported: true }
    })
    expect(JSON.stringify(verifyBody)).not.toContain(KEY_B)

    // Log out, log back in with the single passkey button's ceremony.
    const firstPrf = new Uint8Array(32).fill(9)
    const secondPrf = new Uint8Array(32).fill(OWN_PRF)
    const loginRequests = stubAssertions({
      rawId: OWN_CREDENTIAL,
      userHandle: createStoredHandle(PUB_B),
      extensions: {
        prf: { results: { first: firstPrf.buffer, second: secondPrf.buffer } },
        largeBlob: { blob: written!.buffer }
      }
    })
    const login = await authenticateWithPasskey()
    expect(login.pubkey).toBe(PUB_B)
    expect(login.secretHex).toBe(KEY_B)
    expect(loginRequests).toHaveLength(1)
    // Nothing derived; both PRF outputs wiped.
    expect(firstPrf.every(b => b === 0)).toBe(true)
    expect(secondPrf.every(b => b === 0)).toBe(true)
  })

  it('evaluates PRF on a pinned assertion when creation did not', async () => {
    seedServer()
    createdCredential(false)
    const evalPrf = new Uint8Array(32).fill(OWN_PRF)
    const requests = stubAssertions(
      {
        rawId: OWN_CREDENTIAL,
        userHandle: createStoredHandle(PUB_B),
        extensions: { prf: { results: { first: evalPrf.buffer } } }
      },
      {
        rawId: OWN_CREDENTIAL,
        userHandle: createStoredHandle(PUB_B),
        extensions: { largeBlob: { written: true } }
      }
    )
    await protectImportedKey({
      pubkey: PUB_B,
      secret: hexToBytes(KEY_B),
      default: true
    })
    expect(requests).toHaveLength(2)
    expect(evalPrf.every(b => b === 0)).toBe(true)
  })

  it.each([
    ['the write is not confirmed', { largeBlob: { written: false } }],
    ['the provider ignores the write', {}]
  ])('reports store-failed and registers nothing when %s', async (_l, ext) => {
    let verified = false
    seedServer(() => (verified = true))
    createdCredential()
    stubAssertions({
      rawId: OWN_CREDENTIAL,
      userHandle: createStoredHandle(PUB_B),
      extensions: ext
    })
    await expect(
      protectImportedKey({
        pubkey: PUB_B,
        secret: hexToBytes(KEY_B),
        default: true
      })
    ).rejects.toMatchObject({ kind: 'store-failed' })
    expect(verified).toBe(false)
  })

  it('reports store-failed when the provider has no largeBlob', async () => {
    seedServer()
    vi.mocked(startRegistration).mockResolvedValue({
      id: 'own',
      rawId: bytesToBase64url(OWN_CREDENTIAL),
      clientExtensionResults: {
        prf: { enabled: true },
        largeBlob: { supported: false }
      }
    } as any)
    await expect(
      protectImportedKey({
        pubkey: PUB_B,
        secret: hexToBytes(KEY_B),
        default: true
      })
    ).rejects.toMatchObject({ kind: 'store-failed' })
  })

  it('refuses options whose handle is not the stored handle for the key', async () => {
    server.use(
      http.post('/api/auth/passkey/registration/options', () =>
        HttpResponse.json({
          options: {
            challenge: 'challenge-0123456789abcdef',
            rp: { id: ownRpId() },
            user: { id: bytesToBase64url(new Uint8Array(22)) }
          }
        })
      )
    )
    await expect(
      protectImportedKey({
        pubkey: PUB_B,
        secret: hexToBytes(KEY_B),
        default: true
      })
    ).rejects.toMatchObject({ kind: 'unknown' })
    expect(startRegistration).not.toHaveBeenCalled()
  })
})

describe('login with a stored handle', () => {
  it('never derives: a missing record is reported, not replaced', async () => {
    stubAssertions(
      {
        rawId: OWN_CREDENTIAL,
        userHandle: createStoredHandle(PUB_B),
        extensions: {
          prf: {
            results: {
              first: new Uint8Array(32).fill(1).buffer,
              second: new Uint8Array(32).fill(2).buffer
            }
          }
        }
      },
      {
        rawId: OWN_CREDENTIAL,
        userHandle: createStoredHandle(PUB_B),
        extensions: {
          prf: { results: { first: new Uint8Array(32).fill(2).buffer } }
        }
      }
    )
    await expect(authenticateWithPasskey()).rejects.toMatchObject({
      kind: 'stored-key-missing'
    })
  })

  it('rejects a record written for another credential', async () => {
    const record = await sealStoredRecord(
      hexToBytes(KEY_B),
      new Uint8Array(32).fill(OWN_PRF),
      'key',
      { rpId: ownRpId(), author: PUB_B, credentialId: SOURCE_CREDENTIAL }
    )
    stubAssertions({
      rawId: OWN_CREDENTIAL,
      userHandle: createStoredHandle(PUB_B),
      extensions: {
        prf: {
          results: {
            first: new Uint8Array(32).buffer,
            second: new Uint8Array(32).fill(OWN_PRF).buffer
          }
        },
        largeBlob: { blob: record.buffer }
      }
    })
    await expect(authenticateWithPasskey()).rejects.toMatchObject({
      kind: 'stored-key-invalid'
    })
  })
})

describe('remembered source ("keep using this passkey")', () => {
  const entry = () => ({
    rpId: SOURCE.rpId,
    credentialId: bytesToBase64url(SOURCE_CREDENTIAL),
    pubkey: PUB_B
  })
  const sourceAssertion = async () => ({
    rawId: SOURCE_CREDENTIAL,
    userHandle: createStoredHandle(PUB_B),
    extensions: {
      prf: { results: { first: new Uint8Array(32).fill(SOURCE_PRF).buffer } },
      largeBlob: { blob: (await sourceVault()).buffer }
    }
  })

  beforeEach(() => localStorage.clear())

  it('stores only rpId, credential id and pubkey, and forgets them', () => {
    rememberSource({ ...entry(), secret: KEY_B } as never)
    expect(JSON.parse(localStorage.getItem(REMEMBERED_SOURCE_KEY)!)).toEqual(
      entry()
    )
    expect(readRememberedSource()).toEqual(entry())
    forgetRememberedSource()
    expect(localStorage.getItem(REMEMBERED_SOURCE_KEY)).toBeNull()
    expect(readRememberedSource()).toBeNull()
  })

  it('ignores a malformed entry', () => {
    localStorage.setItem(
      REMEMBERED_SOURCE_KEY,
      JSON.stringify({ ...entry(), pubkey: 'npub1nope' })
    )
    expect(readRememberedSource()).toBeNull()
    localStorage.setItem(REMEMBERED_SOURCE_KEY, '{')
    expect(readRememberedSource()).toBeNull()
  })

  it('signs in by asking that RP for that one passkey, reaching the remembered pubkey', async () => {
    const assertion = await sourceAssertion()
    const prf = new Uint8Array(assertion.extensions.prf.results.first)
    const requests = stubAssertions(assertion)

    const result = await signInWithRememberedSource(entry(), [SOURCE])

    expect(requests).toHaveLength(1)
    expect(requests[0].rpId).toBe(SOURCE.rpId)
    expect(requests[0].allowCredentials).toHaveLength(1)
    expect(new Uint8Array(requests[0].allowCredentials[0].id)).toEqual(
      SOURCE_CREDENTIAL
    )
    expect(
      bytesToHex(new Uint8Array(requests[0].extensions.prf.eval.first))
    ).toBe(bytesToHex(storedPrfInput()))
    expect(requests[0].extensions.largeBlob).toEqual({ read: true })
    expect(result).toEqual({ secretHex: KEY_B })
    expect(
      getPublicKey(hexToBytes((result as { secretHex: string }).secretHex))
    ).toBe(PUB_B)
    expect(prf.every(b => b === 0)).toBe(true)
  })

  it('preserves recovery warnings when signing in to a remembered account', async () => {
    failedRelayCopy()
    stubAssertions(await sourceAssertion())
    const result = await signInWithRememberedSource(entry(), [SOURCE])
    expect('secretHex' in result && result.warnings).toHaveLength(1)
  })

  it('hands back the vault for the picker when the account is gone', async () => {
    stubAssertions(await sourceAssertion())
    const result = await signInWithRememberedSource(
      {
        ...entry(),
        pubkey: getPublicKey(hexToBytes('00'.repeat(31) + '0c'))
      },
      [SOURCE]
    )
    expect('imported' in result).toBe(true)
    const { imported } = result as {
      imported: { accounts: { pubkey: string }[] }
    }
    expect(imported.accounts.map(a => a.pubkey)).toEqual([PUB_A, PUB_B])
  })

  it('does not contact an RP removed from configured sources', async () => {
    const requests = stubAssertions(await sourceAssertion())
    await expect(signInWithRememberedSource(entry(), [])).rejects.toThrow()
    expect(requests).toHaveLength(0)
  })

  it('links a kept key without a passkey, and accepts one already linked', async () => {
    const calls: string[] = []
    server.use(
      http.post('*/api/account/identities/link/begin', () => {
        calls.push('begin')
        return HttpResponse.json({ challenge: 'c'.repeat(32), nonce: 'n' })
      }),
      http.post('*/api/account/identities/link/verify', () => {
        calls.push('verify')
        return HttpResponse.json(
          { error: { message: 'This key is already linked to your account' } },
          { status: 409 }
        )
      })
    )
    await expect(linkKeptKey(KEY_B, 'jwt')).resolves.toBeUndefined()
    expect(calls).toEqual(['begin', 'verify'])
    expect(startRegistration).not.toHaveBeenCalled()

    server.use(
      http.post('*/api/account/identities/link/verify', () =>
        HttpResponse.json({ linked: false, mergeTicket: 't'.repeat(16) })
      )
    )
    await expect(linkKeptKey(KEY_B, 'jwt')).rejects.toMatchObject({
      kind: 'key-owned'
    })
  })
})

describe('Nosskey recovery sources', () => {
  const source = {
    label: 'Nosskey',
    rpId: 'nosskey.app',
    format: 'nosskey' as const
  }
  const prf = new Uint8Array(32).fill(5)
  const account = {
    credentialId: '09090909',
    pubkey: getPublicKey(prf),
    salt: '6e6f7374722d70776b'
  }
  it('requires metadata and pins the original credential and PRF input', async () => {
    const requests = stubAssertions({
      rawId: SOURCE_CREDENTIAL,
      userHandle: new Uint8Array(16),
      extensions: { prf: { results: { first: prf.slice().buffer } } }
    })
    const imported = await readImportSource(source, JSON.stringify(account))
    expect(imported.accounts[0].pubkey).toBe(account.pubkey)
    expect(
      new TextDecoder().decode(requests[0].extensions.prf.eval.first)
    ).toBe('nostr-pwk')
    expect(new Uint8Array(requests[0].allowCredentials[0].id)).toEqual(
      SOURCE_CREDENTIAL
    )
    wipeStoredAccounts(imported.accounts)
    await expect(readImportSource(source)).rejects.toThrow()
  })
  it('rejects the wrong credential even if it returns the same PRF', async () => {
    stubAssertions({
      rawId: OWN_CREDENTIAL,
      userHandle: null,
      extensions: { prf: { results: { first: prf.slice().buffer } } }
    })
    await expect(
      readImportSource(source, JSON.stringify(account))
    ).rejects.toThrow()
  })
})

it('remembers only the Nosskey metadata and rechecks the configured source', async () => {
  const prf = new Uint8Array(32).fill(5)
  const account = {
    credentialId: '09090909',
    pubkey: getPublicKey(prf),
    salt: '6e6f7374722d70776b'
  }
  const entry = {
    rpId: 'nosskey.app',
    credentialId: bytesToBase64url(SOURCE_CREDENTIAL),
    pubkey: account.pubkey,
    nosskey: account
  }
  rememberSource(entry)
  expect(readRememberedSource()).toEqual(entry)
  stubAssertions({
    rawId: SOURCE_CREDENTIAL,
    userHandle: null,
    extensions: { prf: { results: { first: prf.slice().buffer } } }
  })
  const result = await signInWithRememberedSource(entry, [
    { label: 'Nosskey', rpId: 'nosskey.app', format: 'nosskey' }
  ])
  expect('secretHex' in result && result.secretHex).toBe('05'.repeat(32))
  await expect(signInWithRememberedSource(entry, [])).rejects.toThrow()
  await expect(
    signInWithRememberedSource(entry, [
      { label: 'Changed', rpId: 'nosskey.app' }
    ])
  ).rejects.toThrow()
})
