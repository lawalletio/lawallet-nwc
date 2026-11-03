import {
  bytesToBase64,
  encryptStoredRecord,
  openStoredRecord,
  storedPayloadKeys,
  storedPrfInput as sdkStoredPrfInput,
  type StoredKey
} from '@nostr-wot/identity/vault'

export { bytesToHex, hexToBytes } from '@nostr-wot/identity/vault'
export type StoredAccount = StoredKey
export type StoredType = 'key' | 'seed' | 'vault'
export const STORED_TYPES = { key: 1, seed: 2, vault: 3 } as const
export const STORED_MAX_PLAINTEXT = 65536
export interface StoredRecordContext {
  rpId: string
  author: string
  credentialId: Uint8Array
}
export class StoredKeyError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message)
    this.name = 'StoredKeyError'
  }
}

export const storedPrfInput = () => Uint8Array.from(sdkStoredPrfInput())
const contextForSdk = (context: StoredRecordContext) => ({
  ...context,
  credentialId: bytesToBase64(context.credentialId)
})

/** A header hint only; the SDK authenticates and validates the full record. */
export const isStoredRecord = (bytes: Uint8Array | null | undefined) =>
  !!bytes &&
  bytes.length > 4 &&
  [0x4e, 0x50, 0x4b, 1].every((b, i) => bytes[i] === b)

/** LaWallet copies one confirmed key; vault writing belongs to the source signer. */
export async function sealStoredRecord(
  key: Uint8Array,
  prf: Uint8Array,
  type: StoredType,
  context: StoredRecordContext
): Promise<Uint8Array<ArrayBuffer>> {
  if (type !== 'key')
    throw new StoredKeyError(
      'invalid-payload',
      'Only a selected key can be copied'
    )
  return Uint8Array.from(
    encryptStoredRecord({ type: 'key', key }, prf, contextForSdk(context))
  )
}

export async function openStoredSnapshot(
  record: Uint8Array,
  prf: Uint8Array,
  context: StoredRecordContext
): Promise<{ accounts: StoredAccount[]; updatedAt: number; type: StoredType }> {
  try {
    const payload = openStoredRecord(record, prf, contextForSdk(context))
    try {
      return {
        accounts: storedPayloadKeys(payload),
        updatedAt:
          payload.type === 'vault' ? (payload.vault.updated_at ?? 0) : 0,
        type: payload.type
      }
    } finally {
      if (payload.type === 'key') payload.key.fill(0)
    }
  } catch (error) {
    throw new StoredKeyError(
      'invalid-record',
      error instanceof Error ? error.message : 'Invalid recovery record'
    )
  }
}

export async function openStoredAccounts(
  record: Uint8Array,
  prf: Uint8Array,
  context: StoredRecordContext
) {
  return (await openStoredSnapshot(record, prf, context)).accounts
}
export function wipeStoredAccounts(accounts: StoredAccount[]) {
  for (const account of accounts) account.secret.fill(0)
}
export const defaultStoredAccount = (accounts: StoredAccount[]) =>
  accounts.find(account => account.default) ?? accounts[0]
