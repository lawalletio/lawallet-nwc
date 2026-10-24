import {
  RECOVERY_PRF_INPUT,
  parseNosskeyAccount,
  nosskeyPrfInput,
  recoverNosskeyAccount,
  hexToBytes,
  base64ToBytes,
  bytesToBase64,
  type NosskeyAccount
} from '@nostr-wot/identity/vault'
import { readLegacyPasskey } from './passkey-legacy'
import { startRegistration } from '@simplewebauthn/browser'
import type { Event as NostrEvent } from 'nostr-tools/pure'
import type { PasskeyCredentialSummary } from '@/lib/validation/schemas'
import type { PasskeyImportSource } from '@/lib/passkey-import-sources'
import { DEFAULT_NOSTR_RELAYS } from '@/lib/nostr/profile'
import { hexToNsec } from '@/lib/nostr'
import { classifyPasskeyHandle, createStoredHandle } from '@/lib/passkey-handle'
import {
  base64urlToBytes,
  passkeyAssertion,
  prfUnsupportedError,
  type PasskeyAssertionResult
} from '@/lib/client/passkey-prf'
import {
  PasskeyError,
  postJson,
  reported,
  storedPasskeyError,
  submitRegistration,
  translatePasskeyError,
  wipeAssertion,
  type CeremonyContext,
  type PasskeyIdentity
} from '@/lib/client/passkey-api'
import { proveNostrKey } from '@/lib/client/account-api'
import { createNsecSigner } from '@/lib/client/nostr-signer'
import {
  bytesToHex,
  isStoredRecord,
  openStoredSnapshot,
  sealStoredRecord,
  storedPrfInput,
  StoredKeyError,
  STORED_TYPES,
  STORED_MAX_PLAINTEXT,
  wipeStoredAccounts,
  type StoredAccount,
  type StoredType
} from '@/lib/passkey-store'

/**
 * Sign-in with an identity held in another app's stored-mode passkey,
 * see docs/JWT_USAGE.md "Passkey Handles". The user unlocks a passkey of the
 * source RP (which must list this origin in its /.well-known/webauthn), the
 * key is decrypted here and the user confirms its public key. Then the user
 * chooses: keep signing in with that passkey (this device remembers only
 * which RP and credential to ask, see `RememberedPasskeySource`), or let
 * LaWallet protect the key with a passkey of its own RP. The server sees
 * public keys and signed proofs, never the PRF output, the record key or
 * the secret.
 */

/** Addressable kind for stored records on relays. */
export const STORED_RECORD_KIND = 31778

export interface ImportedPasskey {
  source: PasskeyImportSource
  nosskey?: NosskeyAccount
  /** The handle's author; always one of `accounts`. */
  author: string
  /** base64url id of the source passkey, what a later sign-in pins. */
  credentialId: string
  /** Importable accounts; a vault may hold several. Wipe with `wipeStoredAccounts`. */
  accounts: StoredAccount[]
  /** Failed alternative recovery copies; display before confirming the import. */
  warnings?: string[]
}

/**
 * Unlocks a passkey of `source` and decrypts the identity it protects.
 * Refuses, before decrypting anything, a passkey that derives its key or
 * uses a format LaWallet cannot read.
 */
export function readImportSource(
  source: PasskeyImportSource,
  backup?: string
): Promise<ImportedPasskey> {
  return reported('import', ctx =>
    source.format === 'nosskey'
      ? readNosskeySource(source, parseNosskeyAccount(backup ?? ''))
      : readSource(ctx, source)
  )
}

/**
 * The source passkey ceremony and decode. `credentialId` pins one passkey
 * (allowCredentials), as a remembered sign-in does; omitted, the user picks.
 */
async function readSource(
  ctx: CeremonyContext,
  source: PasskeyImportSource,
  credentialId?: string
): Promise<ImportedPasskey> {
  ctx.step = 'source'
  const request = {
    rpId: source.rpId,
    prf: {
      first: storedPrfInput(),
      second: new TextEncoder().encode(RECOVERY_PRF_INPUT)
    },
    largeBlob: { read: true as const },
    ...(credentialId ? { credentialId: base64urlToBytes(credentialId) } : {})
  }
  const first = await passkeyAssertion(request).catch(err => {
    // The source RP's /.well-known/webauthn does not list this origin.
    if ((err as Error)?.name === 'SecurityError') {
      throw storedPasskeyError('import-blocked', err)
    }
    throw err
  })
  let retry: PasskeyAssertionResult | null = null
  try {
    const kind = classifyPasskeyHandle(first.userHandle)
    if (kind.mode === 'derived') throw storedPasskeyError('import-derived')
    // Untagged handles could be either mode; importing needs certainty.
    if (kind.mode !== 'stored' || !('author' in kind) || !kind.author) {
      throw storedPasskeyError('import-unsupported')
    }
    const legacy = 'legacy' in kind && kind.legacy === 'raw-pubkey'
    if (legacy)
      return {
        source,
        author: kind.author,
        credentialId: first.credentialId,
        accounts: await readLegacyPasskey(source, first, kind.author)
      }

    // Some platforms skip extensions on a discoverable request; the
    // handle is known now, so retry pinned to that passkey once.
    let prf = first.prfFirst
    let blob = first.blob
    if (!prf) {
      retry = await passkeyAssertion({
        ...request,
        credentialId: first.rawId
      })
      prf = retry.prfFirst
      blob = retry.blob
    }
    if (!prf) throw prfUnsupportedError()

    const relayRecords = await fetchRelayRecords(
      source.relays?.length ? source.relays : DEFAULT_NOSTR_RELAYS,
      {
        author: kind.author,
        credentialId: first.credentialId,
        rpId: source.rpId
      }
    )
    const candidates = [...(blob ? [blob] : []), ...relayRecords]
    let selected: Awaited<ReturnType<typeof openStoredSnapshot>> | undefined
    const warnings: string[] = []
    let failure: unknown
    for (const candidate of candidates) {
      try {
        if (!candidate)
          throw new StoredKeyError(
            'invalid-record',
            'The newest relay record cannot be read; possible tampering'
          )
        const opened = await openStoredSnapshot(candidate, prf, {
          rpId: source.rpId,
          author: kind.author,
          credentialId: first.rawId
        })
        if (
          !selected ||
          (opened.type === 'vault' && selected.type !== 'vault') ||
          (opened.type === selected.type &&
            opened.updatedAt > selected.updatedAt)
        ) {
          if (selected) wipeStoredAccounts(selected.accounts)
          selected = opened
        } else wipeStoredAccounts(opened.accounts)
      } catch (err) {
        failure = err
        warnings.push(
          'One recovery copy could not be opened. A usable copy was recovered; check your other provider or relay copy for possible tampering.'
        )
      }
    }
    if (!selected) {
      if (failure) throw failure
      throw storedPasskeyError(
        legacy ? 'import-unsupported' : 'stored-key-missing'
      )
    }
    const accounts = selected.accounts

    return {
      source,
      author: kind.author,
      credentialId: first.credentialId,
      accounts,
      warnings
    }
  } catch (err) {
    if (err instanceof StoredKeyError) {
      throw storedPasskeyError('stored-key-invalid', err)
    }
    throw err
  } finally {
    wipeAssertion(first)
    if (retry) wipeAssertion(retry)
  }
}

async function readNosskeySource(
  source: PasskeyImportSource,
  account: NosskeyAccount
): Promise<ImportedPasskey> {
  const first = await passkeyAssertion({
    rpId: source.rpId,
    credentialId: hexToBytes(account.credentialId),
    prf: { first: nosskeyPrfInput(account) }
  })
  try {
    if (bytesToHex(first.rawId) !== account.credentialId)
      throw storedPasskeyError('stored-key-invalid')
    if (!first.prfFirst) throw prfUnsupportedError()
    const secret = recoverNosskeyAccount(account, first.prfFirst)
    return {
      source,
      nosskey: account,
      author: account.pubkey,
      credentialId: first.credentialId,
      accounts: [
        {
          pubkey: account.pubkey,
          secret,
          default: true,
          label: account.username
        }
      ]
    }
  } finally {
    wipeAssertion(first)
  }
}

const STORED_TYPE_NAMES = Object.keys(STORED_TYPES) as StoredType[]

/**
 * The record in a stored-record event, when the event is a well-formed,
 * correctly signed one for exactly this author, credential and RP.
 */
export function recordFromEvent(
  event: NostrEvent,
  lookup: { author: string; credentialId: string; rpId: string },
  verify: (event: NostrEvent) => boolean
): Uint8Array | null {
  if (!eligibleRecordEvent(event, lookup, verify)) return null
  const type = event.tags
    .find(t => t[0] === 'd')![1]
    .slice(lookup.credentialId.length + 1) as StoredType
  if (event.content.length > 4 * Math.ceil((STORED_MAX_PLAINTEXT + 65) / 3))
    return null
  try {
    const record = base64ToBytes(event.content)
    return bytesToBase64(record) === event.content &&
      isStoredRecord(record) &&
      record[4] === STORED_TYPES[type]
      ? record
      : null
  } catch {
    return null
  }
}

function eligibleRecordEvent(
  event: NostrEvent,
  lookup: { author: string; credentialId: string; rpId: string },
  verify: (event: NostrEvent) => boolean
): boolean {
  const ds = event.tags.filter(t => t[0] === 'd')
  const versions = event.tags.filter(t => t[0] === 'v')
  const types =
    event.kind === STORED_RECORD_KIND ? ['key', 'vault'] : STORED_TYPE_NAMES
  if (
    ![STORED_RECORD_KIND, 31777].includes(event.kind) ||
    event.pubkey !== lookup.author ||
    ds.length !== 1 ||
    !types.some(type => ds[0][1] === `${lookup.credentialId}:${type}`) ||
    event.tags.some(t => t[0] === 'rp' && t[1] !== lookup.rpId)
  )
    return false
  if (
    event.kind === STORED_RECORD_KIND
      ? versions.length !== 0
      : versions.length !== 1 || versions[0][1] !== 'npk1'
  )
    return false
  return verify({
    id: event.id,
    pubkey: event.pubkey,
    sig: event.sig,
    kind: event.kind,
    created_at: event.created_at,
    content: event.content,
    tags: event.tags.map(t => [...t])
  })
}

/** Select the newest signed vault coordinate BEFORE decoding its content. */
export async function fetchRelayRecords(
  relays: string[],
  lookup: { author: string; credentialId: string; rpId: string }
): Promise<(Uint8Array | null)[]> {
  const [{ SimplePool }, { verifyEvent }] = await Promise.all([
    import('nostr-tools/pool'),
    import('nostr-tools/pure')
  ])
  const pool = new SimplePool()
  try {
    const queries = await Promise.allSettled([
      pool.querySync(
        relays,
        {
          kinds: [STORED_RECORD_KIND],
          authors: [lookup.author],
          '#d': [`${lookup.credentialId}:key`, `${lookup.credentialId}:vault`]
        },
        { maxWait: 4000 }
      ),
      pool.querySync(
        relays,
        {
          kinds: [31777],
          authors: [lookup.author],
          '#d': STORED_TYPE_NAMES.map(type => `${lookup.credentialId}:${type}`)
        },
        { maxWait: 4000 }
      )
    ])
    const seen = new Set<string>()
    const events = queries
      .flatMap(q => (q.status === 'fulfilled' ? q.value : []))
      .filter(e => {
        if (seen.has(e.id)) return false
        seen.add(e.id)
        return eligibleRecordEvent(e, lookup, verifyEvent)
      })
      .sort((a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id))
    const newestVault = events.find(e =>
      e.tags.some(t => t[0] === 'd' && t[1] === `${lookup.credentialId}:vault`)
    )
    return events
      .filter(
        e =>
          !e.tags.some(
            t => t[0] === 'd' && t[1] === `${lookup.credentialId}:vault`
          ) || e === newestVault
      )
      .map(e => recordFromEvent(e, lookup, verifyEvent))
  } finally {
    pool.close(relays)
  }
}

/**
 * Protects an imported key with a new passkey of LaWallet's own RP: a tagged
 * stored handle naming the key's public key, the stored PRF input, and the
 * key written as a `key` record to the passkey's largeBlob. Only a confirmed
 * write counts; otherwise nothing is registered and 'store-failed' is
 * thrown. Then the credential is registered exactly like a passkey signup
 * (no `token`) or an added passkey (`token`, links the pubkey).
 *
 * The caller still owns `account` and wipes it.
 */
export function protectImportedKey(
  account: StoredAccount,
  token?: string
): Promise<PasskeyIdentity & { credential: PasskeyCredentialSummary }> {
  return reported(token ? 'link' : 'register', async ctx => {
    ctx.step = 'options'
    const { options } = await postJson<{
      options: {
        challenge: string
        rp: { id: string }
        user: { id: string }
      } & Record<string, unknown>
    }>(
      '/api/auth/passkey/registration/options',
      { storedPubkey: account.pubkey },
      token
    )
    // The record is bound to this handle; refuse anything else.
    const expected = bytesToHex(createStoredHandle(account.pubkey))
    if (bytesToHex(base64urlToBytes(options.user.id)) !== expected) {
      throw new PasskeyError('unknown', 'Unexpected passkey handle')
    }

    ctx.step = 'create'
    let registration
    try {
      registration = await startRegistration({
        optionsJSON: {
          ...options,
          extensions: {
            ...(options.extensions as Record<string, unknown> | undefined),
            prf: { eval: { first: storedPrfInput().buffer } },
            largeBlob: { support: 'preferred' }
          }
        } as never
      })
    } catch (err) {
      throw translatePasskeyError(err)
    }

    const { prf, largeBlob, ...otherExtensions } =
      registration.clientExtensionResults as {
        prf?: {
          enabled?: boolean
          results?: { first?: ArrayBuffer | Uint8Array }
        }
        largeBlob?: { supported?: boolean }
      }
    ctx.attachment = registration.authenticatorAttachment
    ctx.prfEnabled = prf?.enabled
    ctx.prfAtCreate = Boolean(prf?.results?.first)
    if (prf?.enabled === false) {
      throw translatePasskeyError(prfUnsupportedError())
    }
    if (largeBlob?.supported === false) throw storedPasskeyError('store-failed')

    const rawId = base64urlToBytes(registration.rawId)
    const context = {
      rpId: options.rp.id,
      author: account.pubkey,
      credentialId: rawId
    }
    let record: Uint8Array
    const created = prf?.results?.first
    const prfAtCreate =
      created &&
      (created instanceof Uint8Array ? created : new Uint8Array(created))
    let evaluated: PasskeyAssertionResult | null = null
    try {
      let prfOutput = prfAtCreate
      if (!prfOutput) {
        ctx.step = 'prf-eval'
        evaluated = await passkeyAssertion({
          rpId: options.rp.id,
          credentialId: rawId,
          prf: { first: storedPrfInput() }
        })
        prfOutput = evaluated.prfFirst
      }
      if (!prfOutput) throw prfUnsupportedError()
      record = await sealStoredRecord(account.secret, prfOutput, 'key', context)
    } catch (err) {
      throw translatePasskeyError(err)
    } finally {
      prfAtCreate?.fill(0)
      if (evaluated) wipeAssertion(evaluated)
    }

    ctx.step = 'blob-write'
    let written: boolean | undefined
    try {
      written = (
        await passkeyAssertion({
          rpId: options.rp.id,
          credentialId: rawId,
          largeBlob: { write: record }
        })
      ).written
    } catch (err) {
      const error = translatePasskeyError(err)
      throw error.kind === 'cancelled'
        ? error
        : storedPasskeyError('store-failed', err)
    }
    if (written !== true) throw storedPasskeyError('store-failed')

    const secretHex = bytesToHex(account.secret)
    const { credential } = await submitRegistration(ctx, {
      challenge: options.challenge,
      registration: registration as unknown as Record<string, unknown>,
      otherExtensions: {
        ...otherExtensions,
        ...(largeBlob ? { largeBlob } : {})
      },
      prfEnabled: prf?.enabled,
      secretHex,
      pubkey: account.pubkey,
      token
    })

    return {
      secretHex,
      nsec: hexToNsec(secretHex),
      pubkey: account.pubkey,
      credentialId: registration.id,
      credential
    }
  })
}

/**
 * "Keep using this passkey": instead of a LaWallet copy, this device
 * remembers which passkey of the other app to ask for, and the account the
 * user chose in it. Nosskey backups also retain their encrypted key payload.
 * The plaintext key is decrypted again at each sign-in and is never stored here.
 */
export interface RememberedPasskeySource {
  nosskey?: NosskeyAccount
  rpId: string
  /** base64url id of the source passkey, sent as allowCredentials. */
  credentialId: string
  /** The chosen account, hex. */
  pubkey: string
}

export const REMEMBERED_SOURCE_KEY = 'lawallet-passkey-source'

export function readRememberedSource(): RememberedPasskeySource | null {
  try {
    const value = JSON.parse(
      localStorage.getItem(REMEMBERED_SOURCE_KEY) ?? 'null'
    ) as Partial<RememberedPasskeySource> | null
    if (
      typeof value?.rpId === 'string' &&
      /^[a-z0-9.-]{1,253}$/.test(value.rpId) &&
      typeof value.credentialId === 'string' &&
      /^[A-Za-z0-9_-]{1,1366}$/.test(value.credentialId) &&
      typeof value.pubkey === 'string' &&
      /^[0-9a-f]{64}$/.test(value.pubkey)
    ) {
      const { rpId, credentialId, pubkey } = value
      const nosskey = value.nosskey
        ? parseNosskeyAccount(JSON.stringify(value.nosskey))
        : undefined
      if (
        nosskey &&
        (nosskey.pubkey !== pubkey ||
          bytesToHex(base64urlToBytes(credentialId)) !== nosskey.credentialId)
      )
        return null
      return { rpId, credentialId, pubkey, ...(nosskey ? { nosskey } : {}) }
    }
  } catch {
    // Storage disabled or a malformed entry: nothing is remembered.
  }
  return null
}

export function rememberSource(entry: RememberedPasskeySource) {
  const { rpId, credentialId, pubkey } = entry
  try {
    localStorage.setItem(
      REMEMBERED_SOURCE_KEY,
      JSON.stringify({
        rpId,
        credentialId,
        pubkey,
        ...(entry.nosskey ? { nosskey: entry.nosskey } : {})
      })
    )
  } catch {
    // Without storage the next sign-in simply asks for a LaWallet passkey.
  }
}

export function forgetRememberedSource() {
  try {
    localStorage.removeItem(REMEMBERED_SOURCE_KEY)
  } catch {
    // Nothing to forget.
  }
}

function rememberedSourceConfig(
  entry: RememberedPasskeySource,
  sources: PasskeyImportSource[] = []
): PasskeyImportSource {
  const source = sources.find(source => source.rpId === entry.rpId)
  if (!source)
    throw new PasskeyError(
      'import-unsupported',
      'This passkey source is no longer enabled. Choose another supported source.'
    )
  return source
}

/**
 * Asks the remembered passkey (pinned with allowCredentials) for its record
 * and decodes it exactly as the import does. `sources` supplies the relays
 * configured for that RP, if any. The caller wipes the returned accounts.
 */
export function unlockRememberedSource(
  entry: RememberedPasskeySource,
  sources?: PasskeyImportSource[]
): Promise<ImportedPasskey> {
  return reported('authenticate', ctx => {
    const source = rememberedSourceConfig(entry, sources)
    if (source.format === 'nosskey') {
      const account = parseNosskeyAccount(JSON.stringify(entry.nosskey))
      if (
        account.pubkey !== entry.pubkey ||
        bytesToHex(base64urlToBytes(entry.credentialId)) !==
          account.credentialId
      )
        throw storedPasskeyError('stored-key-invalid')
      return readNosskeySource(source, account)
    }
    if (entry.nosskey) throw storedPasskeyError('import-unsupported')
    return readSource(ctx, source, entry.credentialId)
  })
}

/** The secret of `pubkey` as hex, then every decrypted account is wiped. */
export function takeAccountSecret(
  accounts: StoredAccount[],
  pubkey: string
): string | null {
  const account = accounts.find(a => a.pubkey === pubkey)
  const secretHex = account ? bytesToHex(account.secret) : null
  wipeStoredAccounts(accounts)
  return secretHex
}

/**
 * Sign-in with the remembered passkey. Resolves to the key of the
 * remembered account, or, when the passkey no longer holds that account,
 * to the decoded passkey so the caller can show the picker (and wipe it).
 */
export async function signInWithRememberedSource(
  entry: RememberedPasskeySource,
  sources?: PasskeyImportSource[]
): Promise<
  { secretHex: string; warnings?: string[] } | { imported: ImportedPasskey }
> {
  const imported = await unlockRememberedSource(entry, sources)
  if (!imported.accounts.some(a => a.pubkey === entry.pubkey)) {
    return { imported }
  }
  return {
    secretHex: takeAccountSecret(imported.accounts, entry.pubkey)!,
    ...(imported.warnings?.length ? { warnings: imported.warnings } : {})
  }
}

/**
 * The "keep" choice for a signed-in account: proves the key and links its
 * pubkey to the account, with no LaWallet passkey. A key another account
 * owns is refused ('key-owned'); one already linked here is fine.
 */
export async function linkKeptKey(secretHex: string, token: string) {
  try {
    const result = await proveNostrKey(token, createNsecSigner(secretHex))
    if (!result.linked) throw storedPasskeyError('key-owned')
  } catch (err) {
    if ((err as { status?: number }).status === 409) return
    throw err
  }
}

/**
 * Switches a remembered passkey to a LaWallet copy for the signed-in
 * account: unlock it again, protect the remembered account's key with a
 * new LaWallet passkey, then forget the remembered entry.
 */
export async function copyRememberedSource(
  entry: RememberedPasskeySource,
  token: string,
  sources?: PasskeyImportSource[]
): Promise<PasskeyCredentialSummary & { warnings?: string[] }> {
  const imported = await unlockRememberedSource(entry, sources)
  try {
    const account = imported.accounts.find(a => a.pubkey === entry.pubkey)
    if (!account) throw storedPasskeyError('stored-key-missing')
    const { credential } = await protectImportedKey(account, token)
    forgetRememberedSource()
    return imported.warnings?.length
      ? { ...credential, warnings: imported.warnings }
      : credential
  } finally {
    wipeStoredAccounts(imported.accounts)
  }
}
