import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const mocks = vi.hoisted(() => ({
  // One stable object: the balance effect keys on apiClient identity.
  auth: { apiClient: { get: vi.fn() } }
}))

vi.mock('@/components/admin/auth-context', () => ({
  useAuth: () => mocks.auth
}))

import {
  RecoveredDialog,
  type RecoveredAccount
} from '@/components/activate/recovered-dialog'

const { get } = mocks.auth.apiClient

const RECOVERY: RecoveredAccount = {
  lightningAddresses: ['bob@ln.host', 'bobby@ln.host'],
  primaryAddress: 'bob@ln.host',
  cards: [
    {
      id: 'card-1',
      title: 'Blue card',
      designImageUrl: 'https://img/blue.png'
    },
    { id: 'card-2', title: null, designImageUrl: null }
  ],
  remoteWallets: [
    { id: 'rw-1', name: 'Main wallet', isDefault: true },
    { id: 'rw-2', name: 'Spare', isDefault: false }
  ],
  vouchers: 0,
  mergedIntoExisting: false
}

const balancePath = (id: string) => `/api/remote-wallets/${id}/balance`

/** Resolve (number) or reject (Error) each wallet's balance read by id. */
function balances(map: Record<string, number | Error>) {
  get.mockImplementation((path: string) => {
    const id = Object.keys(map).find(key => path === balancePath(key))
    if (!id) return Promise.reject(new Error(`unexpected GET ${path}`))
    const value = map[id]
    return value instanceof Error
      ? Promise.reject(value)
      : Promise.resolve({ balanceSats: value })
  })
}

function renderDialog(
  props: Partial<React.ComponentProps<typeof RecoveredDialog>> = {}
) {
  const onContinue = vi.fn()
  render(
    <RecoveredDialog
      open
      recovery={RECOVERY}
      claimAddress={false}
      onContinue={onContinue}
      {...props}
    />
  )
  return { onContinue }
}

/** The row a label (address / card / wallet name) sits in. */
function row(label: string) {
  const el = screen.getByText(label).parentElement
  if (!el) throw new Error(`no row for ${label}`)
  return el
}

/** The "Total balance" box. */
function totalBox() {
  const el = screen.getByText('Total balance').parentElement
  if (!el) throw new Error('no total balance box')
  return el
}

const sats = (n: number) => `${n.toLocaleString()} sats`

beforeEach(() => {
  get.mockReset()
})

describe('RecoveredDialog', () => {
  it('lists the recovered addresses, cards and wallets', async () => {
    balances({ 'rw-1': 1500, 'rw-2': 2500 })
    renderDialog()

    expect(
      screen.getByRole('dialog', { name: 'Account recovered' })
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        "Everything from the card's account is now in this wallet."
      )
    ).toBeInTheDocument()

    expect(screen.getByText('bob@ln.host')).toBeInTheDocument()
    expect(screen.getByText('bobby@ln.host')).toBeInTheDocument()

    // A titled card shows its title; an untitled one falls back to "Card".
    expect(screen.getByText('Blue card')).toBeInTheDocument()
    expect(row('Blue card').querySelector('img')).toHaveAttribute(
      'src',
      'https://img/blue.png'
    )
    expect(screen.getByText('Card')).toBeInTheDocument()
    expect(row('Card').querySelector('img')).toBeNull()

    // Only the default wallet carries the badge.
    expect(within(row('Main wallet')).getByText('Default')).toBeInTheDocument()
    expect(within(row('Spare')).queryByText('Default')).toBeNull()
    expect(screen.getAllByText('Default')).toHaveLength(1)

    await waitFor(() =>
      expect(within(row('Spare')).getByText(sats(2500))).toBeInTheDocument()
    )
  })

  it('reads each wallet balance and shows the formatted sats and their total', async () => {
    balances({ 'rw-1': 1500, 'rw-2': 2500 })
    renderDialog()

    expect(get).toHaveBeenCalledTimes(2)
    expect(get).toHaveBeenCalledWith(balancePath('rw-1'))
    expect(get).toHaveBeenCalledWith(balancePath('rw-2'))

    expect(
      await within(row('Main wallet')).findByText(sats(1500))
    ).toBeInTheDocument()
    expect(within(row('Spare')).getByText(sats(2500))).toBeInTheDocument()
    expect(totalBox()).toHaveTextContent(`Total balance${sats(4000)}`)
  })

  it('shows skeletons while the balances load', () => {
    get.mockReturnValue(new Promise(() => {}))
    renderDialog()

    expect(totalBox().querySelector('.animate-pulse')).not.toBeNull()
    expect(row('Main wallet').querySelector('.animate-pulse')).not.toBeNull()
    expect(row('Spare').querySelector('.animate-pulse')).not.toBeNull()
    expect(screen.queryByText(/sats$/)).toBeNull()
    expect(screen.queryByText('Unavailable')).toBeNull()
  })

  it('shows "Unavailable" for a wallet whose balance read fails and totals the rest', async () => {
    balances({ 'rw-1': 1500, 'rw-2': new Error('wallet offline') })
    renderDialog()

    expect(
      await within(row('Spare')).findByText('Unavailable')
    ).toBeInTheDocument()
    expect(within(row('Main wallet')).getByText(sats(1500))).toBeInTheDocument()
    expect(totalBox()).toHaveTextContent(`Total balance${sats(1500)}`)
    expect(totalBox().querySelector('.animate-pulse')).toBeNull()
  })

  it('shows the total as "Unavailable" when no balance could be read', async () => {
    balances({ 'rw-1': new Error('down'), 'rw-2': new Error('down') })
    renderDialog()

    await waitFor(() =>
      expect(totalBox()).toHaveTextContent('Total balanceUnavailable')
    )
    expect(screen.getAllByText('Unavailable')).toHaveLength(3)
  })

  it('shows "None" without fetching when nothing came over', () => {
    renderDialog({
      recovery: {
        ...RECOVERY,
        lightningAddresses: [],
        cards: [],
        remoteWallets: []
      }
    })

    expect(get).not.toHaveBeenCalled()
    // Total + addresses + cards + wallets.
    expect(screen.getAllByText('None')).toHaveLength(4)
  })

  it('mentions recovered vouchers', () => {
    balances({ 'rw-1': 0, 'rw-2': 0 })
    renderDialog({ recovery: { ...RECOVERY, vouchers: 2 } })
    expect(screen.getByText('2 vouchers')).toBeInTheDocument()
  })

  it('does not read balances while closed', () => {
    balances({ 'rw-1': 1, 'rw-2': 2 })
    renderDialog({ open: false })
    expect(get).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('offers "Open wallet" and calls onContinue', async () => {
    const user = userEvent.setup()
    balances({ 'rw-1': 1, 'rw-2': 2 })
    const { onContinue } = renderDialog()

    expect(
      screen.queryByRole('button', { name: 'Claim your address' })
    ).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Open wallet' }))

    expect(onContinue).toHaveBeenCalledTimes(1)
  })

  it('offers "Claim your address" when the account still needs one', async () => {
    const user = userEvent.setup()
    balances({ 'rw-1': 1, 'rw-2': 2 })
    const { onContinue } = renderDialog({ claimAddress: true })

    expect(screen.queryByRole('button', { name: 'Open wallet' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Claim your address' }))

    expect(onContinue).toHaveBeenCalledTimes(1)
  })

  it('uses the merged copy when the recovery merged into an existing account', () => {
    balances({ 'rw-1': 1, 'rw-2': 2 })
    renderDialog({ recovery: { ...RECOVERY, mergedIntoExisting: true } })

    expect(
      screen.getByText(
        "Everything from the card's account was merged into this wallet."
      )
    ).toBeInTheDocument()
    expect(
      screen.queryByText(
        "Everything from the card's account is now in this wallet."
      )
    ).toBeNull()
  })
})
