import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const mocks = vi.hoisted(() => ({
  role: 'USER' as 'ADMIN' | 'USER',
  mine: {
    data: [] as unknown[],
    loading: false,
    refetch: vi.fn()
  },
  all: {
    data: [] as unknown[],
    loading: false,
    refetch: vi.fn()
  }
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    replace: vi.fn(),
    push: vi.fn(),
    back: vi.fn(),
    prefetch: vi.fn()
  }),
  useSearchParams: () => new URLSearchParams()
}))

vi.mock('next/image', () => ({ __esModule: true, default: () => null }))

vi.mock('@/lib/client/hooks/use-settings', () => ({
  useSettings: () => ({ data: { domain: 'lawallet.io' }, loading: false })
}))

vi.mock('@/lib/client/hooks/use-wallet-addresses', () => ({
  useMyAddresses: () => mocks.mine,
  useAddressMutations: () => ({
    setAsPrimary: vi.fn(),
    settingPrimary: false
  })
}))

vi.mock('@/lib/client/hooks/use-addresses', () => ({
  useAddresses: () => mocks.all
}))

vi.mock('@/components/admin/auth-context', () => ({
  useAuth: () => ({
    status: 'authenticated',
    role: mocks.role,
    apiClient: { post: vi.fn(), get: vi.fn() }
  })
}))

vi.mock('@/components/ui/sidebar', () => ({
  useSidebar: () => ({ isMobile: false, setOpenMobile: vi.fn() })
}))

vi.mock('@/components/wallet/new-address-dialog', () => ({
  NewAddressDialog: () => null
}))

import AdminAddressesPage from '@/app/admin/addresses/page'

function headerColumnCount(container: HTMLElement) {
  return container.querySelectorAll('thead th').length
}

function fillerColSpan(container: HTMLElement) {
  return container.querySelector('tbody td')?.getAttribute('colspan')
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.role = 'USER'
  mocks.mine = { data: [], loading: false, refetch: vi.fn() }
  mocks.all = { data: [], loading: false, refetch: vi.fn() }
})

describe('AdminAddressesPage filler rows', () => {
  it('spans the empty-state cell across all 4 columns', () => {
    const { container } = render(<AdminAddressesPage />)

    expect(screen.getByText(/have any addresses yet/)).toBeTruthy()
    expect(headerColumnCount(container)).toBe(4)
    expect(fillerColSpan(container)).toBe('4')
  })

  it('spans the loading-state cell across all 4 columns', () => {
    mocks.mine.loading = true

    const { container } = render(<AdminAddressesPage />)

    expect(container.querySelector('.animate-spin')).toBeTruthy()
    expect(headerColumnCount(container)).toBe(4)
    expect(fillerColSpan(container)).toBe('4')
  })

  it('spans the empty-state cell across all 5 columns in admin view', async () => {
    mocks.role = 'ADMIN'
    mocks.all.data = []

    const { container } = render(<AdminAddressesPage />)

    await userEvent.click(screen.getByRole('switch', { name: 'All users' }))

    expect(screen.getByText('No lightning addresses exist yet.')).toBeTruthy()
    expect(headerColumnCount(container)).toBe(5)
    expect(fillerColSpan(container)).toBe('5')
  })

  it('spans the loading-state cell across all 5 columns in admin view', async () => {
    mocks.role = 'ADMIN'
    mocks.all.loading = true

    const { container } = render(<AdminAddressesPage />)

    await userEvent.click(screen.getByRole('switch', { name: 'All users' }))

    expect(container.querySelector('.animate-spin')).toBeTruthy()
    expect(headerColumnCount(container)).toBe(5)
    expect(fillerColSpan(container)).toBe('5')
  })
})
