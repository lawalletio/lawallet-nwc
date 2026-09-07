import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

const replaceMock = vi.hoisted(() => vi.fn())
const pushMock = vi.hoisted(() => vi.fn())
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    replace: replaceMock,
    push: pushMock,
    back: vi.fn(),
    prefetch: vi.fn()
  }),
  useSearchParams: () => new URLSearchParams()
}))

vi.mock('@/lib/client/hooks/use-settings', () => ({
  useSettings: () => ({ data: { domain: 'lawallet.io' }, loading: false })
}))

vi.mock('@/lib/client/hooks/use-wallet-addresses', () => ({
  useAddressMutations: () => ({
    createAddress: vi.fn(),
    creating: false
  })
}))

vi.mock('@/components/admin/auth-context', () => ({
  useAuth: () => ({
    status: 'authenticated',
    role: 'ADMIN',
    apiClient: {
      post: vi.fn(),
      get: vi.fn().mockResolvedValue([])
    }
  })
}))

vi.mock('@/components/ui/sidebar', () => ({
  useSidebar: () => ({ isMobile: false, setOpenMobile: vi.fn() })
}))

vi.mock('next/image', () => ({ __esModule: true, default: () => null }))

import RegisterAddressPage from '@/app/admin/addresses/register/page'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('RegisterAddressPage', () => {
  it('renders without hooks violation errors', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    render(<RegisterAddressPage />)

    await waitFor(() => {
      expect(screen.getByText('Register Address')).toBeTruthy()
    })

    const hooksErrors = consoleError.mock.calls.filter(call =>
      call.some(
        arg =>
          typeof arg === 'string' &&
          arg.includes('Rendered more hooks than during the previous render')
      )
    )
    expect(hooksErrors).toHaveLength(0)

    consoleError.mockRestore()
  })

  it('maintains stable hook order across auth state changes', async () => {
    const authMock = vi.fn().mockReturnValue({
      status: 'authenticated',
      role: 'ADMIN',
      apiClient: {
        post: vi.fn(),
        get: vi.fn().mockResolvedValue([])
      }
    })

    vi.doMock('@/components/admin/auth-context', () => ({
      useAuth: authMock
    }))

    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    const { rerender } = render(<RegisterAddressPage />)

    await waitFor(() => {
      expect(screen.getByText('Register Address')).toBeTruthy()
    })

    rerender(<RegisterAddressPage />)

    const hooksErrors = consoleError.mock.calls.filter(call =>
      call.some(
        arg =>
          typeof arg === 'string' &&
          (arg.includes('Rendered more hooks') ||
            arg.includes('Rules of Hooks'))
      )
    )
    expect(hooksErrors).toHaveLength(0)

    consoleError.mockRestore()
  })

  it('renders loading state when settings are loading', async () => {
    vi.doMock('@/lib/client/hooks/use-settings', () => ({
      useSettings: () => ({ data: null, loading: true })
    }))

    const { container } = render(<RegisterAddressPage />)

    await waitFor(() => {
      expect(screen.getByText('Register Address')).toBeTruthy()
    })
  })
})
