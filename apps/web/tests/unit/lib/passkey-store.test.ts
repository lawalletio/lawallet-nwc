import { describe, it, expect } from 'vitest'
import {
  bytesToHex,
  hexToBytes,
  openStoredAccounts,
  sealStoredRecord,
  wipeStoredAccounts
} from '@/lib/passkey-store'
// Stored-record fixtures from the proposal, limited to the SDK adapter boundary.
import records from './passkey-record-vectors.json'

describe('shared SDK record adapter', () => {
  for (const vector of records) {
    const context = {
      rpId: vector.rp_id,
      author: vector.author,
      credentialId: hexToBytes(vector.credential_id)
    }
    const prf = () => hexToBytes(vector.prf_output)
    it(`opens ${vector.description} with byte credential IDs`, async () => {
      const accounts = await openStoredAccounts(
        hexToBytes(vector.record),
        prf(),
        context
      )
      expect(accounts.map(a => a.pubkey)).toContain(vector.author)
      wipeStoredAccounts(accounts)
      expect(accounts.every(a => a.secret.every(b => b === 0))).toBe(true)
    })
    it(`rejects another RP for ${vector.description}`, async () => {
      await expect(
        openStoredAccounts(hexToBytes(vector.record), prf(), {
          ...context,
          rpId: 'wrong.example'
        })
      ).rejects.toMatchObject({ name: 'StoredKeyError' })
    })
  }
  it('copies only the selected key and opens the result without changing its caller-owned bytes', async () => {
    const vector = records[0]
    const context = {
      rpId: vector.rp_id,
      author: vector.author,
      credentialId: hexToBytes(vector.credential_id)
    }
    const accounts = await openStoredAccounts(
      hexToBytes(vector.record),
      hexToBytes(vector.prf_output),
      context
    )
    const selected = accounts.find(a => a.pubkey === vector.author)!
    const before = bytesToHex(selected.secret)
    const record = await sealStoredRecord(
      selected.secret,
      hexToBytes(vector.prf_output),
      'key',
      context
    )
    const copied = await openStoredAccounts(
      record,
      hexToBytes(vector.prf_output),
      context
    )
    expect(copied.map(a => a.pubkey)).toEqual([selected.pubkey])
    expect(bytesToHex(selected.secret)).toBe(before)
    wipeStoredAccounts(accounts)
    wipeStoredAccounts(copied)
  })
})
