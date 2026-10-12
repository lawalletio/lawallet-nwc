import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { RouteError } from '@/components/route-error'
import WalletError from '@/app/wallet/(app)/error'
import AdminError from '@/app/admin/error'

const { captureException } = vi.hoisted(() => ({ captureException: vi.fn() }))
vi.mock('@sentry/nextjs', () => ({ captureException }))

const error = new Error('boom')

describe('RouteError', () => {
  beforeEach(() => captureException.mockClear())
  afterEach(() => vi.unstubAllEnvs())

  it('renders the message and a home link', () => {
    render(<RouteError error={error} retry={vi.fn()} homeHref="/wallet" />)
    expect(screen.getByText('Something went wrong')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Go home' })).toHaveAttribute(
      'href',
      '/wallet'
    )
  })

  it('calls retry on Try again', () => {
    const retry = vi.fn()
    render(<RouteError error={error} retry={retry} homeHref="/wallet" />)
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(retry).toHaveBeenCalledOnce()
  })

  it('reports to Sentry when the DSN is set', async () => {
    vi.stubEnv('NEXT_PUBLIC_SENTRY_DSN', 'https://key@sentry.example/1')
    render(<RouteError error={error} retry={vi.fn()} homeHref="/wallet" />)
    await waitFor(() => expect(captureException).toHaveBeenCalledWith(error))
  })

  it('does not report when the DSN is unset', async () => {
    vi.stubEnv('NEXT_PUBLIC_SENTRY_DSN', '')
    render(<RouteError error={error} retry={vi.fn()} homeHref="/wallet" />)
    await new Promise(r => setTimeout(r, 0))
    expect(captureException).not.toHaveBeenCalled()
  })

  it('wires the route boundaries to unstable_retry and their home', () => {
    const retry = vi.fn()
    const { unmount } = render(
      <WalletError error={error} unstable_retry={retry} />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(retry).toHaveBeenCalledOnce()
    unmount()

    render(<AdminError error={error} unstable_retry={vi.fn()} />)
    expect(screen.getByRole('link', { name: 'Go home' })).toHaveAttribute(
      'href',
      '/admin'
    )
  })
})
