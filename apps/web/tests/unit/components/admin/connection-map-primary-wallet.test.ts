import { describe, expect, it } from 'vitest'
import {
  getPrimaryWalletId,
  withDerivedPrimaryWalletFlags,
} from '@/components/admin/connection-map/primary-wallet'
import type { RemoteWalletData } from '@/lib/client/hooks/use-remote-wallets'
import type { WalletAddress } from '@/lib/client/hooks/use-wallet-addresses'

function wallet(overrides: Partial<RemoteWalletData>): RemoteWalletData {
  return {
    id: 'wallet-1',
    name: 'Wallet',
    type: 'NWC',
    status: 'ACTIVE',
    isDefault: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    diedAt: null,
    provider: null,
    lncurlServerUrl: null,
    ...overrides,
  }
}

function address(overrides: Partial<WalletAddress>): WalletAddress {
  return {
    username: 'alice',
    mode: 'IDLE',
    redirect: null,
    remoteWalletId: null,
    isPrimary: false,
    nwcMode: 'NONE',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('connection-map primary wallet helpers', () => {
  it('derives primary wallet flags from the primary address link', () => {
    const wallets = [
      wallet({ id: 'wallet-1', name: 'Old primary', isDefault: true }),
      wallet({ id: 'wallet-2', name: 'New primary', isDefault: false }),
    ]
    const addresses = [
      address({
        username: 'alice',
        mode: 'CUSTOM_NWC',
        remoteWalletId: 'wallet-2',
        isPrimary: true,
        nwcMode: 'RECEIVE',
      }),
    ]

    expect(getPrimaryWalletId(addresses)).toBe('wallet-2')
    expect(withDerivedPrimaryWalletFlags(wallets, addresses)).toMatchObject([
      { id: 'wallet-1', isDefault: false },
      { id: 'wallet-2', isDefault: true },
    ])
  })

  it('clears wallet flags when the primary address has no bound wallet', () => {
    const wallets = [wallet({ id: 'wallet-1', isDefault: true })]
    const addresses = [
      address({
        username: 'alice',
        mode: 'ALIAS',
        redirect: 'bob@example.com',
        isPrimary: true,
      }),
    ]

    expect(withDerivedPrimaryWalletFlags(wallets, addresses)).toMatchObject([
      { id: 'wallet-1', isDefault: false },
    ])
  })
})
