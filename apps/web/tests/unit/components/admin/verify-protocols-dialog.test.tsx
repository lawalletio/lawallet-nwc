import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { VerifyProtocolsDialog } from '@/components/admin/verify-protocols-dialog'
import type { VerifyAddressProtocolsResult } from '@/lib/client/hooks/use-addresses'

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  toastMessage: vi.fn(),
  onComplete: vi.fn()
}))

vi.mock('@/components/admin/auth-context', () => ({
  useAuth: () => ({
    apiClient: {
      get: mocks.get,
      post: mocks.post
    }
  })
}))

vi.mock('sonner', () => ({
  toast: {
    success: mocks.toastSuccess,
    error: mocks.toastError,
    message: mocks.toastMessage
  }
}))

const known = {
  lud16: true,
  nip05: true,
  lud21: false,
  nip57: true,
  lud12: false
} as const

const unprobed = {
  lud16: null,
  nip05: true,
  lud21: null,
  nip57: null,
  lud12: null
} as const

function envelope(
  flags: VerifyAddressProtocolsResult['protocols']['protocols'],
  provider: string
): VerifyAddressProtocolsResult['protocols'] {
  return {
    protocols: flags,
    source: 'alias',
    reason: null,
    provider
  }
}

function makeResult(
  username: string,
  overrides: Partial<VerifyAddressProtocolsResult> = {}
): VerifyAddressProtocolsResult {
  const provider = `${username}-dest@primal.net`
  const after = envelope(known, provider)
  return {
    username,
    mode: 'ALIAS',
    redirect: provider,
    probed: true,
    persisted: true,
    error: null,
    previous: envelope(unprobed, provider),
    protocols: after,
    ...overrides
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.get.mockResolvedValue([{ username: 'misscons' }, { username: 'alice' }])
  mocks.post.mockImplementation((_path: string, body: { username: string }) => {
    if (body.username === 'alice') {
      const result = makeResult('alice')
      return Promise.resolve({
        ...result,
        previous: result.protocols
      })
    }
    return Promise.resolve(makeResult(body.username))
  })
})

describe('VerifyProtocolsDialog', () => {
  it('scans every address and reports protocol changes when done', async () => {
    render(
      <VerifyProtocolsDialog
        open
        onOpenChange={vi.fn()}
        domain="lawallet.io"
        onComplete={mocks.onComplete}
      />
    )

    expect(
      screen.getByRole('heading', { name: 'Verify Protocols' })
    ).toBeInTheDocument()

    await waitFor(() => {
      expect(mocks.post).toHaveBeenCalledTimes(2)
    })

    expect(mocks.post).toHaveBeenNthCalledWith(
      1,
      '/api/lightning-addresses/verify-protocols',
      { username: 'misscons' }
    )
    expect(mocks.post).toHaveBeenNthCalledWith(
      2,
      '/api/lightning-addresses/verify-protocols',
      { username: 'alice' }
    )

    expect(screen.getAllByText('misscons@lawallet.io').length).toBeGreaterThan(
      0
    )
    expect(screen.getByText('2 / 2')).toBeInTheDocument()
    expect(screen.getByText('Done')).toBeInTheDocument()
    expect(screen.getAllByText('Fixed').length).toBeGreaterThan(0)
    expect(screen.getAllByText('LUD-16').length).toBeGreaterThan(0)
    expect(screen.getAllByText('+1 valid').length).toBeGreaterThan(0)
    expect(mocks.onComplete).toHaveBeenCalled()
    expect(mocks.toastSuccess).toHaveBeenCalledWith(
      'Verified 2 addresses · 1 fixed'
    )
  })

  it('shows an empty state when there are no addresses', async () => {
    mocks.get.mockResolvedValue([])

    render(
      <VerifyProtocolsDialog open onOpenChange={vi.fn()} domain="lawallet.io" />
    )

    expect(
      await screen.findByText('No addresses to verify')
    ).toBeInTheDocument()
    expect(mocks.post).not.toHaveBeenCalled()
  })

  it('stops the scan when the operator clicks Stop', async () => {
    const user = userEvent.setup()
    let release!: (value: VerifyAddressProtocolsResult) => void
    mocks.post.mockImplementation(
      () =>
        new Promise<VerifyAddressProtocolsResult>(resolve => {
          release = resolve
        })
    )

    render(
      <VerifyProtocolsDialog open onOpenChange={vi.fn()} domain="lawallet.io" />
    )

    const stop = await screen.findByRole('button', { name: 'Stop' })
    await user.click(stop)
    release(makeResult('misscons'))

    await waitFor(() => {
      expect(mocks.toastMessage).toHaveBeenCalledWith(
        'Protocol verification stopped'
      )
    })
    expect(mocks.post).toHaveBeenCalledTimes(1)
  })
})
