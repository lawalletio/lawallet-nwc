import {
  base64ToBytes,
  bytesToBase64,
  bytesToHex,
  hexToBytes,
  resolvePasskeyIdentity,
  openPasskeyRecord,
  parsePasskeyBackup,
  RECOVERY_PRF_INPUT,
  RECOVERY_SCHEMAS,
  type PasskeyVaultRecord,
  type RecoveryProvider
} from '@nostr-wot/identity/vault'
import {
  derivePath,
  mnemonicToSeed,
  validateMnemonic,
  publicKeyFromPrivate
} from '@nostr-wot/identity/accounts'
import { SimplePool } from 'nostr-tools/pool'
import { verifyEvent } from 'nostr-tools/pure'
import { DEFAULT_NOSTR_RELAYS } from '@/lib/nostr/profile'
import type { PasskeyImportSource } from '@/lib/passkey-import-sources'
import {
  passkeyAssertion,
  prfUnsupportedError,
  type PasskeyAssertionResult
} from './passkey-prf'
import { storedPasskeyError, wipeAssertion } from './passkey-api'
import { wipeStoredAccounts, type StoredAccount } from '@/lib/passkey-store'

/** Read shipped legacy records through the SDK; never reinterpret them as NPK records. */
export async function readLegacyPasskey(
  source: PasskeyImportSource,
  first: PasskeyAssertionResult,
  author: string
): Promise<StoredAccount[]> {
  const credentialId = bytesToBase64(first.rawId)
  const relays = source.relays?.length ? source.relays : DEFAULT_NOSTR_RELAYS
  const pool = new SimplePool()
  const accounts: StoredAccount[] = []
  const proofs: PasskeyAssertionResult[] = []
  const legacyInput = new TextEncoder().encode(RECOVERY_PRF_INPUT)
  async function output(input: Uint8Array) {
    if (bytesToHex(input) === bytesToHex(legacyInput) && first.prfSecond)
      return first.prfSecond
    const result = await passkeyAssertion({
      rpId: source.rpId,
      credentialId: first.rawId,
      prf: { first: input }
    })
    proofs.push(result)
    if (
      bytesToHex(result.rawId) !== bytesToHex(first.rawId) ||
      (result.userHandle && bytesToHex(result.userHandle) !== author)
    )
      throw storedPasskeyError('stored-key-invalid')
    if (!result.prfFirst) throw prfUnsupportedError()
    return result.prfFirst
  }
  const provider: RecoveryProvider = {
    discover: async () => ({
      credentialId,
      userHandle: first.userHandle ?? undefined,
      blob: first.blob,
      prf: { first: first.prfFirst?.slice() }
    }),
    authenticate: async options => (await output(options.prfInput)).slice(),
    writeBlob: async () => {
      throw new Error('Recovery is read-only')
    }
  }
  function add(
    secret: Uint8Array,
    pubkey: string,
    label?: string,
    selected = false
  ) {
    try {
      if (
        publicKeyFromPrivate(secret) !== pubkey ||
        accounts.some(a => a.pubkey === pubkey)
      )
        throw new Error('Recovered account mismatch')
      accounts.push({
        secret: secret.slice(),
        pubkey,
        label,
        default: selected
      })
    } finally {
      secret.fill(0)
    }
  }
  async function openVault(record: PasskeyVaultRecord) {
    const wrapper = record.passkeys.find(
      key => key.credentialId === credentialId
    )
    if (
      !wrapper ||
      (wrapper.rpId ?? record.rpId) !== source.rpId ||
      (wrapper.recoveryPubkey && wrapper.recoveryPubkey !== author)
    )
      throw new Error('Vault context mismatch')
    const opened = await openPasskeyRecord(record, {
      credentialId,
      prf: bytesToBase64(await output(base64ToBytes(wrapper.prfSalt)))
    })
    for (const account of opened.payload.accounts) {
      if (account.readOnly || !account.privkey) continue
      add(
        hexToBytes(account.privkey),
        account.pubkey,
        account.name,
        account.id === opened.payload.activeAccountId
      )
    }
  }
  try {
    const opened = await resolvePasskeyIdentity({
      rpId: source.rpId,
      verify: verifyEvent,
      provider,
      relays,
      timeoutMs: 4000,
      transport: {
        publish: async () => {
          throw new Error('Recovery is read-only')
        },
        query: (relay, filter) =>
          pool.querySync([relay], { ...filter }, { maxWait: 4000 })
      }
    })
    if (opened.mode === 'error')
      throw storedPasskeyError(
        opened.reason === 'missing-record'
          ? 'stored-key-missing'
          : 'stored-key-invalid'
      )
    if (opened.mode !== 'stored' || opened.format !== 'legacy')
      throw storedPasskeyError('import-unsupported')
    if (opened.source === 'passkey-vault') await openVault(opened.record)
    else {
      try {
        const { payload, context } = opened
        if (context.scope === 'private-key')
          add(payload.slice(), author, undefined, true)
        else if (
          context.scope === 'vault' &&
          (!context.schema || context.schema === RECOVERY_SCHEMAS.vault)
        )
          await openVault(
            parsePasskeyBackup(
              new TextDecoder('utf-8', { fatal: true }).decode(payload)
            )
          )
        else if (
          context.scope === 'seed' &&
          (!context.schema || context.schema === RECOVERY_SCHEMAS.seed)
        ) {
          const value = JSON.parse(
            new TextDecoder('utf-8', { fatal: true }).decode(payload)
          )
          if (
            value.version !== 1 ||
            typeof value.mnemonic !== 'string' ||
            value.mnemonic.length > 512 ||
            !validateMnemonic(value.mnemonic) ||
            !Array.isArray(value.accounts) ||
            !value.accounts.length ||
            value.accounts.length > 100
          )
            throw new Error('Invalid seed record')
          const seed = mnemonicToSeed(value.mnemonic)
          try {
            for (const account of value.accounts) {
              if (
                typeof account.path !== 'string' ||
                typeof account.name !== 'string' ||
                account.name.length > 100
              )
                throw new Error('Invalid seed account')
              add(
                derivePath(seed, account.path),
                account.pubkey,
                account.name,
                account.pubkey === author
              )
            }
          } finally {
            seed.fill(0)
          }
        } else throw storedPasskeyError('import-unsupported')
      } finally {
        opened.payload.fill(0)
      }
    }
    if (!accounts.some(account => account.pubkey === author))
      throw new Error('Recovery author missing from accounts')
    return accounts
  } catch (error) {
    wipeStoredAccounts(accounts)
    if (error instanceof Error && error.name === 'PasskeyError') throw error
    throw storedPasskeyError('stored-key-invalid', error)
  } finally {
    for (const proof of proofs) wipeAssertion(proof)
    pool.close(relays)
  }
}
