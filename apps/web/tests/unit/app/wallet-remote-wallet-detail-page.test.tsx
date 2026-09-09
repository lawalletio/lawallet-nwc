import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

// Hoisted mutable mock state so each test can install the wallet the page
// resolves, without re-declaring the module-level mocks.
const state = vi.hoisted(() => ({
  wallet: null as null | {
    id: string
    name: string
    type: string
    status: 'ACTIVE' | 'DISABLED' | 'REVOKED' | 'DEAD'
    isOwner: boolean
    receiveCapabilities: null
  }
}))

// Captures every props object the page passes into RemoteWalletForwardingPanel.
const forwardingProps = vi.hoisted(() => vi.fn())

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useParams: () => ({ id: state.wallet?.id ?? 'wallet-1' })
}))

vi.mock('@/lib/client/hooks/use-remote-wallets', () => ({
  useRemoteWallet: () => ({
    data: state.wallet,
    loading: false,
    error: null,
    refetch: vi.fn()
  }),
  // The page only reads .data/.loading off the connection hook; keep it inert.
  useRemoteWalletConnectionString: () => ({
    data: null,
    loading: false,
    error: null,
    refetch: vi.fn()
  })
}))

vi.mock('@/lib/client/hooks/use-nwc-transactions', () => ({
  useNwcTransactions: () => ({
    data: null,
    loading: false,
    error: null,
    refetch: vi.fn()
  })
}))

vi.mock('@/components/wallet/remote-wallet-forwarding-panel', () => ({
  RemoteWalletForwardingPanel: (props: {
    walletActive: boolean
    walletId: string
  }) => {
    forwardingProps(props)
    return (
      <div data-testid="forwarding-panel">
        walletActive={String(props.walletActive)}
      </div>
    )
  }
}))

vi.mock('@/components/wallet/remote-wallet-receive-protocols', () => ({
  RemoteWalletReceiveProtocols: () => null
}))
vi.mock('@/components/wallet/remote-wallet-notifications-panel', () => ({
  RemoteWalletNotificationsPanel: () => null
}))
vi.mock('@/components/wallet/shared/nav-tabbar', () => ({
  NavTabbar: () => null
}))

import WalletRemoteWalletDetailPage from '@/app/wallet/(app)/settings/remote-wallets/[id]/page'

function wallet(
  overrides: Partial<typeof state.wallet> = {}
): NonNullable<typeof state.wallet> {
  return {
    id: 'wallet-1',
    name: 'Savings',
    type: 'NWC',
    status: 'ACTIVE',
    isOwner: true,
    receiveCapabilities: null,
    ...overrides
  }
}

beforeEach(() => {
  forwardingProps.mockClear()
})

describe('WalletRemoteWalletDetailPage → RemoteWalletForwardingPanel wiring', () => {
  it('passes walletActive=false for a DISABLED wallet', () => {
    state.wallet = wallet({ status: 'DISABLED' })

    render(<WalletRemoteWalletDetailPage />)

    expect(screen.getByTestId('forwarding-panel')).toHaveTextContent(
      'walletActive=false'
    )
    expect(forwardingProps).toHaveBeenLastCalledWith(
      expect.objectContaining({ walletActive: false, walletId: 'wallet-1' })
    )
  })

  it('passes walletActive=true for an ACTIVE wallet', () => {
    state.wallet = wallet({ status: 'ACTIVE' })

    render(<WalletRemoteWalletDetailPage />)

    expect(screen.getByTestId('forwarding-panel')).toHaveTextContent(
      'walletActive=true'
    )
    expect(forwardingProps).toHaveBeenLastCalledWith(
      expect.objectContaining({ walletActive: true, walletId: 'wallet-1' })
    )
  })

  it('passes walletActive=false for a non-ACTIVE status (REVOKED)', () => {
    state.wallet = wallet({ status: 'REVOKED' })

    render(<WalletRemoteWalletDetailPage />)

    expect(screen.getByTestId('forwarding-panel')).toHaveTextContent(
      'walletActive=false'
    )
  })

  it('forwards the readOnly flag independently of walletActive', () => {
    state.wallet = wallet({ status: 'DISABLED', isOwner: false })

    render(<WalletRemoteWalletDetailPage />)

    expect(forwardingProps).toHaveBeenLastCalledWith(
      expect.objectContaining({ walletActive: false, readOnly: true })
    )
  })
})
