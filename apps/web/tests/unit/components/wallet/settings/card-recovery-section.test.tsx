import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const mocks = vi.hoisted(() => ({
  data: undefined as { cardRecoveryEnabled?: boolean } | undefined,
  loading: false,
  useApi: vi.fn(),
  useMutation: vi.fn(),
  mutate: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn()
}))

vi.mock('@/lib/client/hooks/use-api', () => ({
  useApi: (path: string) => {
    mocks.useApi(path)
    return { data: mocks.data }
  },
  useMutation: (invalidates?: string[]) => {
    mocks.useMutation(invalidates)
    return { mutate: mocks.mutate, loading: mocks.loading }
  }
}))

vi.mock('sonner', () => ({
  toast: { success: mocks.toastSuccess, error: mocks.toastError }
}))

import { CardRecoverySection } from '@/components/wallet/settings/card-recovery-section'

const toggle = () =>
  screen.getByRole('switch', { name: 'Recover with my cards' })

/** A promise the test settles by hand, to observe the optimistic state. */
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

beforeEach(() => {
  mocks.data = { cardRecoveryEnabled: true }
  mocks.loading = false
  mocks.useApi.mockReset()
  mocks.useMutation.mockReset()
  mocks.mutate.mockReset()
  mocks.toastSuccess.mockReset()
  mocks.toastError.mockReset()
})

describe('CardRecoverySection', () => {
  it('reads /api/users/me and invalidates it on mutation', () => {
    render(<CardRecoverySection />)
    expect(mocks.useApi).toHaveBeenCalledWith('/api/users/me')
    expect(mocks.useMutation).toHaveBeenCalledWith(['/api/users/me'])
    expect(
      screen.getByText(/Anyone holding one of your cards/)
    ).toBeInTheDocument()
  })

  it('reflects cardRecoveryEnabled: true', () => {
    render(<CardRecoverySection />)
    expect(toggle()).toHaveAttribute('aria-checked', 'true')
    expect(toggle()).toBeEnabled()
  })

  it('reflects cardRecoveryEnabled: false', () => {
    mocks.data = { cardRecoveryEnabled: false }
    render(<CardRecoverySection />)
    expect(toggle()).toHaveAttribute('aria-checked', 'false')
    expect(toggle()).toBeEnabled()
  })

  it('stays disabled until the setting has loaded', () => {
    mocks.data = undefined
    render(<CardRecoverySection />)
    expect(toggle()).toBeDisabled()
  })

  it('is disabled while a change is saving', () => {
    mocks.loading = true
    render(<CardRecoverySection />)
    expect(toggle()).toBeDisabled()
  })

  it('turns recovery off and confirms with a toast', async () => {
    const user = userEvent.setup()
    mocks.mutate.mockResolvedValue({ cardRecoveryEnabled: false })
    render(<CardRecoverySection />)

    await user.click(toggle())

    expect(mocks.mutate).toHaveBeenCalledWith(
      'put',
      '/api/users/me/card-recovery',
      { enabled: false }
    )
    await waitFor(() =>
      expect(mocks.toastSuccess).toHaveBeenCalledWith(
        'Card recovery turned off'
      )
    )
    expect(toggle()).toHaveAttribute('aria-checked', 'false')
    expect(mocks.toastError).not.toHaveBeenCalled()
  })

  it('turns recovery back on', async () => {
    const user = userEvent.setup()
    mocks.data = { cardRecoveryEnabled: false }
    mocks.mutate.mockResolvedValue({ cardRecoveryEnabled: true })
    render(<CardRecoverySection />)

    await user.click(toggle())

    expect(mocks.mutate).toHaveBeenCalledWith(
      'put',
      '/api/users/me/card-recovery',
      { enabled: true }
    )
    await waitFor(() =>
      expect(mocks.toastSuccess).toHaveBeenCalledWith('Card recovery turned on')
    )
    expect(toggle()).toHaveAttribute('aria-checked', 'true')
  })

  it('flips optimistically, then rolls back and toasts the error on failure', async () => {
    const user = userEvent.setup()
    const pending = deferred<unknown>()
    mocks.mutate.mockReturnValue(pending.promise)
    render(<CardRecoverySection />)

    await user.click(toggle())
    expect(toggle()).toHaveAttribute('aria-checked', 'false')

    pending.reject(new Error('Server said no'))

    await waitFor(() =>
      expect(toggle()).toHaveAttribute('aria-checked', 'true')
    )
    expect(mocks.toastError).toHaveBeenCalledWith('Server said no')
    expect(mocks.toastSuccess).not.toHaveBeenCalled()
  })

  it('falls back to the generic message for a non-Error rejection', async () => {
    const user = userEvent.setup()
    mocks.mutate.mockRejectedValue('nope')
    render(<CardRecoverySection />)

    await user.click(toggle())

    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        'Could not update card recovery'
      )
    )
    expect(toggle()).toHaveAttribute('aria-checked', 'true')
  })
})
