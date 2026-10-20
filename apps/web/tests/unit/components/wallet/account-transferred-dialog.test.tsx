import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { AccountTransferNotice } from '@/components/wallet/account-transferred-dialog'

const mocks = vi.hoisted(() => ({
  data: undefined as
    { accountTransfer?: AccountTransferNotice | null } | undefined,
  loading: false,
  useApi: vi.fn(),
  useMutation: vi.fn(),
  mutate: vi.fn()
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

import { AccountTransferredDialog } from '@/components/wallet/account-transferred-dialog'

const TRANSFERRED_AT = '2026-10-21T12:00:00.000Z'

const NOTICE: AccountTransferNotice = {
  id: 'recovery-1',
  transferredAt: TRANSFERRED_AT,
  cardTitle: 'Blue card',
  lightningAddresses: ['alice@ln.host', 'al@ln.host'],
  cards: 2,
  remoteWallets: 1
}

const TITLE = 'Your account was transferred'

// Same formatting the dialog applies (default `en` locale without a provider).
const DATE = new Date(TRANSFERRED_AT).toLocaleDateString('en', {
  dateStyle: 'medium'
})

beforeEach(() => {
  mocks.data = { accountTransfer: NOTICE }
  mocks.loading = false
  mocks.useApi.mockReset()
  mocks.useMutation.mockReset()
  mocks.mutate.mockReset()
  mocks.mutate.mockResolvedValue(undefined)
})

describe('AccountTransferredDialog', () => {
  it('renders nothing when there is no transfer notice', () => {
    mocks.data = { accountTransfer: null }
    const { container } = render(<AccountTransferredDialog />)

    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByText(TITLE)).toBeNull()
  })

  it('renders nothing before /api/users/me has loaded', () => {
    mocks.data = undefined
    render(<AccountTransferredDialog />)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('shows when, with which card, and what moved', () => {
    render(<AccountTransferredDialog />)

    expect(mocks.useApi).toHaveBeenCalledWith('/api/users/me')
    expect(mocks.useMutation).toHaveBeenCalledWith(['/api/users/me'])

    expect(screen.getByRole('dialog', { name: TITLE })).toBeInTheDocument()
    expect(
      screen.getByText(
        `On ${DATE}, your card Blue card was used at a LaWallet point of sale to move this account to another key.`
      )
    ).toBeInTheDocument()
    expect(screen.getByText('What moved')).toBeInTheDocument()
    expect(screen.getByText('alice@ln.host')).toBeInTheDocument()
    expect(screen.getByText('al@ln.host')).toBeInTheDocument()
    expect(screen.getByText('2 cards · 1 wallet')).toBeInTheDocument()
    expect(
      screen.getByText(/contact your community operator/)
    ).toBeInTheDocument()
  })

  it('names an untitled card "(untitled)"', () => {
    mocks.data = { accountTransfer: { ...NOTICE, cardTitle: null } }
    render(<AccountTransferredDialog />)

    expect(
      screen.getByText(/your card \(untitled\) was used/)
    ).toBeInTheDocument()
  })

  it('"Got it" acknowledges the notice server-side and hides the dialog', async () => {
    const user = userEvent.setup()
    render(<AccountTransferredDialog />)

    await user.click(screen.getByRole('button', { name: 'Got it' }))

    expect(mocks.mutate).toHaveBeenCalledTimes(1)
    expect(mocks.mutate).toHaveBeenCalledWith(
      'post',
      '/api/users/me/account-transfer/dismiss'
    )
    await waitFor(() => expect(screen.queryByText(TITLE)).toBeNull())
  })

  it('stays hidden this session even if the dismiss request fails', async () => {
    const user = userEvent.setup()
    mocks.mutate.mockRejectedValue(new Error('offline'))
    render(<AccountTransferredDialog />)

    await user.click(screen.getByRole('button', { name: 'Got it' }))

    await waitFor(() => expect(screen.queryByText(TITLE)).toBeNull())
    expect(mocks.mutate).toHaveBeenCalledTimes(1)
  })

  it('dismisses when closed with Escape', async () => {
    const user = userEvent.setup()
    render(<AccountTransferredDialog />)

    await user.keyboard('{Escape}')

    expect(mocks.mutate).toHaveBeenCalledWith(
      'post',
      '/api/users/me/account-transfer/dismiss'
    )
    await waitFor(() => expect(screen.queryByText(TITLE)).toBeNull())
  })

  it('shows a newer transfer after an older one was dismissed', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<AccountTransferredDialog />)
    await user.click(screen.getByRole('button', { name: 'Got it' }))
    await waitFor(() => expect(screen.queryByText(TITLE)).toBeNull())

    mocks.data = {
      accountTransfer: { ...NOTICE, id: 'recovery-2', cardTitle: 'Red card' }
    }
    rerender(<AccountTransferredDialog />)

    expect(await screen.findByText(TITLE)).toBeInTheDocument()
    expect(screen.getByText(/your card Red card was used/)).toBeInTheDocument()
  })

  it('disables "Got it" while the dismiss is in flight', () => {
    mocks.loading = true
    render(<AccountTransferredDialog />)
    expect(screen.getByRole('button', { name: 'Got it' })).toBeDisabled()
  })
})
