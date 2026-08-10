import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// Router: capture the post-flow navigation target.
const replaceMock = vi.hoisted(() => vi.fn())
const pushMock = vi.hoisted(() => vi.fn())
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    replace: replaceMock,
    push: pushMock,
    back: vi.fn(),
    prefetch: vi.fn()
  })
}))

// Domain suffix shown after the username.
vi.mock('@/lib/client/hooks/use-settings', () => ({
  useSettings: () => ({ data: { domain: 'lawallet.io' }, loading: false })
}))

// The create path — resolves on the happy (free) path.
const createAddressMock = vi.hoisted(() => vi.fn())
vi.mock('@/lib/client/hooks/use-wallet-addresses', () => ({
  useAddressMutations: () => ({
    createAddress: createAddressMock,
    creating: false
  })
}))

vi.mock('@/components/admin/auth-context', () => ({
  useAuth: () => ({ apiClient: { post: vi.fn(), get: vi.fn() } })
}))

// The success hero card renders next/image; stub it out so the assertion can
// focus on the flow rather than image loading.
vi.mock('next/image', () => ({ __esModule: true, default: () => null }))

import { ClaimAddressScreen } from '@/components/wallet/claim/claim-address-screen'

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('ClaimAddressScreen', () => {
  it('disables the claim CTA until a username is entered', () => {
    vi.stubGlobal('fetch', vi.fn())
    render(<ClaimAddressScreen />)

    expect(
      screen.getByRole('heading', { name: 'Claim your Lightning address' })
    ).toBeTruthy()
    expect(
      screen.getByRole('button', { name: /claim address/i })
    ).toBeDisabled()
  })

  it('shows a format error for invalid characters', async () => {
    vi.stubGlobal('fetch', vi.fn())
    render(<ClaimAddressScreen />)

    await userEvent.type(screen.getByLabelText('Username'), 'ab.')

    expect(screen.getByText('Lowercase letters and numbers only.')).toBeTruthy()
    expect(
      screen.getByRole('button', { name: /claim address/i })
    ).toBeDisabled()
  })

  it('flags a taken username and keeps the CTA disabled', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ available: false })
      })
    )
    render(<ClaimAddressScreen />)

    await userEvent.type(screen.getByLabelText('Username'), 'satoshi')

    expect(await screen.findByText('That username is taken.')).toBeTruthy()
    expect(
      screen.getByRole('button', { name: /claim address/i })
    ).toBeDisabled()
  })

  it('does not report a rate-limited username as taken', async () => {
    // A 429 body has no `available` field. Coercing it would render a free
    // username as "taken" and disable the CTA with nothing explaining why —
    // an unusable form on any deployment where users share a source IP.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        json: async () => ({ error: 'Rate limit exceeded' })
      })
    )
    render(<ClaimAddressScreen />)

    await userEvent.type(screen.getByLabelText('Username'), 'satoshi')

    const cta = screen.getByRole('button', { name: /claim address/i })
    await waitFor(() => expect(cta).toBeEnabled())
    expect(screen.queryByText('That username is taken.')).toBeNull()
  })

  it('claims a username and returns to /wallet on success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ available: true })
      })
    )
    createAddressMock.mockResolvedValue({ username: 'satoshi' })
    render(<ClaimAddressScreen />)

    await userEvent.type(screen.getByLabelText('Username'), 'satoshi')

    const cta = screen.getByRole('button', { name: /claim address/i })
    await waitFor(() => expect(cta).toBeEnabled())
    await userEvent.click(cta)

    expect(createAddressMock).toHaveBeenCalledWith({ username: 'satoshi' })
    expect(await screen.findByText('Address claimed!')).toBeTruthy()

    await userEvent.click(screen.getByRole('button', { name: /go to wallet/i }))
    expect(replaceMock).toHaveBeenCalledWith('/wallet')
  })
})
