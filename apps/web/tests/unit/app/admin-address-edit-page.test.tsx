import { Suspense } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const mocks = vi.hoisted(() => ({
  deferredProxyEnabled: false,
  addressMode: 'CUSTOM_NWC',
  wallets: [] as Array<{
    id: string
    name: string
    type: 'NWC'
    status: 'ACTIVE'
    isDefault: boolean
  }>,
  push: vi.fn(),
  refetch: vi.fn()
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.push }),
  useSearchParams: () => new URLSearchParams()
}))

vi.mock('next/link', () => ({
  default: ({
    children,
    href
  }: {
    children: React.ReactNode
    href: string
  }) => <a href={href}>{children}</a>
}))

vi.mock('@/components/admin/admin-topbar', () => ({
  AdminTopbar: () => null
}))

vi.mock('@/components/admin/lightning-address-hero', () => ({
  LightningAddressHero: ({ address }: { address: string }) => (
    <span>{address}</span>
  )
}))

vi.mock('@/components/wallet/balance-card', () => ({
  BalanceCard: () => null
}))

vi.mock('@/components/wallet/address-invoices-card', () => ({
  AddressInvoicesCard: () => <div>Recent invoices panel</div>
}))

vi.mock('@/components/wallet/proxy-pending-balance-card', () => ({
  ProxyPendingBalanceCard: () => <div>Pending proxy balance</div>
}))

vi.mock('@/components/wallet/proxy-forwarding-activity', () => ({
  ProxyForwardingActivity: () => <div>Forwarding activity panel</div>
}))

vi.mock('@/components/admin/create-remote-wallet-dialog', () => ({
  CreateRemoteWalletDialog: () => null
}))

vi.mock('@/lib/client/hooks/use-settings', () => ({
  useSettings: () => ({ data: { domain: 'example.com' }, loading: false })
}))

vi.mock('@/lib/client/hooks/use-api', () => ({
  invalidateApiPath: vi.fn()
}))

vi.mock('@/lib/client/hooks/use-wallet-addresses', () => ({
  useMyAddress: () => ({
    data: {
      address: {
        username: 'alice',
        mode: mocks.addressMode,
        redirect:
          mocks.addressMode === 'PROXY_ALIAS' ? 'bob@example.com' : null,
        remoteWalletId:
          mocks.addressMode === 'CUSTOM_NWC'
            ? (mocks.wallets[0]?.id ?? null)
            : null,
        isPrimary: false,
        nwcMode: 'NONE',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z'
      },
      wallets: mocks.wallets,
      effectiveConnectionString: null,
      deferredProxyEnabled: mocks.deferredProxyEnabled,
      isOwner: true,
      ownerPubkey: 'a'.repeat(64)
    },
    loading: false,
    error: null,
    refetch: mocks.refetch
  }),
  useAddressMutations: () => ({
    updateAddress: vi.fn(),
    updating: false,
    deleteAddress: vi.fn(),
    deleting: false,
    probeAliasAddress: vi.fn()
  })
}))

vi.mock('@/lib/analytics/gtag', () => ({ trackEvent: vi.fn() }))

import AdminAddressEditPage from '@/app/admin/addresses/[username]/page'

async function renderPage() {
  await act(async () => {
    render(
      <Suspense fallback={null}>
        <AdminAddressEditPage params={Promise.resolve({ username: 'alice' })} />
      </Suspense>
    )
  })
}

async function openModePicker() {
  // The mode summary is plain text now; the dedicated Switch button opens it.
  await userEvent.click(await screen.findByRole('button', { name: 'Switch' }))
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.deferredProxyEnabled = false
  mocks.addressMode = 'CUSTOM_NWC'
  mocks.wallets = []
  mocks.refetch.mockResolvedValue(undefined)
})

describe('/admin/addresses/[username]', () => {
  it('hides Deferred proxy when deferred forwarding is disabled', async () => {
    await renderPage()
    await openModePicker()

    expect(screen.queryByText('Deferred proxy')).not.toBeInTheDocument()
  })

  it('shows Deferred proxy when deferred forwarding is enabled', async () => {
    mocks.deferredProxyEnabled = true
    await renderPage()
    await openModePicker()

    expect(screen.getByText('Deferred proxy')).toBeInTheDocument()
  })

  it('adds overview, payments, and activity tabs for a configured proxy', async () => {
    mocks.deferredProxyEnabled = true
    mocks.addressMode = 'PROXY_ALIAS'
    await renderPage()

    expect(
      screen.getByRole('tablist', { name: 'Proxy address sections' })
    ).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Overview' })).toBeInTheDocument()
    expect(
      screen.getByRole('tab', { name: 'Payments received' })
    ).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Activity' })).toBeInTheDocument()
    expect(screen.getByText('Pending proxy balance')).toBeVisible()

    const modeButton = screen.getByRole('button', { name: 'Switch' })
    const tabList = screen.getByRole('tablist', {
      name: 'Proxy address sections'
    })
    expect(
      modeButton.compareDocumentPosition(tabList) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    expect(
      screen.getByRole('tabpanel', { name: 'Overview' })
    ).not.toContainElement(modeButton)

    await userEvent.click(
      screen.getByRole('tab', { name: 'Payments received' })
    )
    expect(screen.getByText('Recent invoices panel')).toBeVisible()

    await userEvent.click(screen.getByRole('tab', { name: 'Activity' }))
    expect(screen.getByText('Forwarding activity panel')).toBeVisible()
  })

  it('does not add proxy operations tabs to other address modes', async () => {
    await renderPage()

    expect(
      screen.queryByRole('tablist', { name: 'Proxy address sections' })
    ).not.toBeInTheDocument()
  })

  it('links a custom-wallet address directly to its remote wallet', async () => {
    mocks.addressMode = 'CUSTOM_NWC'
    mocks.wallets = [
      {
        id: 'wallet-1',
        name: 'Treasury wallet',
        type: 'NWC',
        status: 'ACTIVE',
        isDefault: false
      }
    ]

    await renderPage()

    // The mode icon carries the "connected to" meaning now, so the summary
    // shows the wallet name on its own.
    expect(screen.getByText('Treasury wallet')).toBeVisible()
    expect(screen.getByRole('link', { name: 'View wallet' })).toHaveAttribute(
      'href',
      '/admin/remote-wallets/wallet-1'
    )
  })
})
