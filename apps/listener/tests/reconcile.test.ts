import { describe, expect, it } from 'vitest'
import { diffWallets } from '../src/nwc/reconcile'
import type { DesiredWallet } from '../src/db'

const wallet = (id: string, connectionString: string): DesiredWallet => ({
  id,
  name: `wallet-${id}`,
  userId: `user-${id}`,
  connectionString
})

describe('diffWallets', () => {
  it('returns empty diff for empty inputs', () => {
    expect(diffWallets([], [])).toEqual({ add: [], remove: [], update: [] })
  })

  it('adds wallets missing from the pool', () => {
    const desired = [wallet('a', 'nostr+walletconnect://a')]
    const diff = diffWallets([], desired)
    expect(diff.add).toEqual(desired)
    expect(diff.remove).toEqual([])
    expect(diff.update).toEqual([])
  })

  it('removes wallets no longer desired', () => {
    const diff = diffWallets(
      [{ id: 'a', connectionString: 'nostr+walletconnect://a' }],
      []
    )
    expect(diff.remove).toEqual(['a'])
    expect(diff.add).toEqual([])
  })

  it('flags connection string rotation as update', () => {
    const rotated = wallet('a', 'nostr+walletconnect://rotated')
    const diff = diffWallets(
      [{ id: 'a', connectionString: 'nostr+walletconnect://a' }],
      [rotated]
    )
    expect(diff.update).toEqual([rotated])
    expect(diff.add).toEqual([])
    expect(diff.remove).toEqual([])
  })

  it('treats identical connection strings as no-op', () => {
    const same = wallet('a', 'nostr+walletconnect://a')
    const diff = diffWallets(
      [{ id: 'a', connectionString: 'nostr+walletconnect://a' }],
      [same]
    )
    expect(diff).toEqual({ add: [], remove: [], update: [] })
  })

  it('handles mixed add/remove/update in one pass', () => {
    const keep = wallet('keep', 'nostr+walletconnect://keep')
    const rotate = wallet('rotate', 'nostr+walletconnect://new')
    const fresh = wallet('fresh', 'nostr+walletconnect://fresh')
    const diff = diffWallets(
      [
        { id: 'keep', connectionString: 'nostr+walletconnect://keep' },
        { id: 'rotate', connectionString: 'nostr+walletconnect://old' },
        { id: 'gone', connectionString: 'nostr+walletconnect://gone' }
      ],
      [keep, rotate, fresh]
    )
    expect(diff.add).toEqual([fresh])
    expect(diff.update).toEqual([rotate])
    expect(diff.remove).toEqual(['gone'])
  })
})
