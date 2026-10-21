import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  RecoverMergeDialog,
  type RecoverySide
} from '@/components/activate/recover-merge-dialog'

const EXISTING: RecoverySide = {
  lightningAddresses: ['alice@ln.host'],
  cards: 1,
  remoteWallets: 2
}

const INCOMING: RecoverySide = {
  lightningAddresses: ['bob@ln.host', 'bobby@ln.host'],
  cards: 3,
  remoteWallets: 1
}

function renderDialog(
  props: Partial<React.ComponentProps<typeof RecoverMergeDialog>> = {}
) {
  const onConfirm = vi.fn()
  const onCancel = vi.fn()
  render(
    <RecoverMergeDialog
      open
      existing={EXISTING}
      incoming={INCOMING}
      onConfirm={onConfirm}
      onCancel={onCancel}
      {...props}
    />
  )
  return { onConfirm, onCancel }
}

/** The summary box that a side's label ("Your account", …) heads. */
function side(label: string) {
  const box = screen.getByText(label).parentElement
  if (!box) throw new Error(`no side box for ${label}`)
  return within(box)
}

describe('RecoverMergeDialog', () => {
  it('lists both sides with their addresses and card / wallet counts', () => {
    renderDialog()

    expect(
      screen.getByRole('alertdialog', { name: 'Merge into your account?' })
    ).toBeInTheDocument()

    const yours = side('Your account')
    expect(yours.getByText('alice@ln.host')).toBeInTheDocument()
    expect(yours.getByText('1 card · 2 wallets')).toBeInTheDocument()
    expect(yours.queryByText('bob@ln.host')).toBeNull()

    const incoming = side("From the card's account")
    expect(incoming.getByText('bob@ln.host')).toBeInTheDocument()
    expect(incoming.getByText('bobby@ln.host')).toBeInTheDocument()
    expect(incoming.getByText('3 cards · 1 wallet')).toBeInTheDocument()
    expect(incoming.queryByText('alice@ln.host')).toBeNull()

    expect(
      screen.getByText(/Your current primary address stays primary/)
    ).toBeInTheDocument()
  })

  it('says "No lightning address" for a side without addresses', () => {
    renderDialog({
      existing: { lightningAddresses: [], cards: 0, remoteWallets: 0 }
    })

    const yours = side('Your account')
    expect(yours.getByText('No lightning address')).toBeInTheDocument()
    expect(yours.getByText('0 cards · 0 wallets')).toBeInTheDocument()

    const incoming = side("From the card's account")
    expect(incoming.queryByText('No lightning address')).toBeNull()
  })

  it('calls onConfirm from "Merge & recover"', async () => {
    const user = userEvent.setup()
    const { onConfirm } = renderDialog()

    await user.click(screen.getByRole('button', { name: 'Merge & recover' }))

    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('calls onCancel (and not onConfirm) from "Cancel"', async () => {
    const user = userEvent.setup()
    const { onConfirm, onCancel } = renderDialog()

    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('calls onCancel when dismissed with Escape', async () => {
    const user = userEvent.setup()
    const { onConfirm, onCancel } = renderDialog()

    await user.keyboard('{Escape}')

    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('renders nothing while closed', () => {
    renderDialog({ open: false })
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })
})
