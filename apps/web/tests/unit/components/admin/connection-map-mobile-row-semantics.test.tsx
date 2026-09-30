import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { setCardWallet } = vi.hoisted(() => ({
  setCardWallet: vi.fn()
}))

vi.mock('@/lib/client/hooks/use-wallet-addresses', () => ({
  useAddressMutations: () => ({
    updateAddress: vi.fn(),
    updating: false
  })
}))

vi.mock('@/lib/client/hooks/use-cards', () => ({
  useCardMutations: () => ({
    updateCard: vi.fn(),
    updating: false
  }),
  useMyCardMutations: () => ({
    setCardWallet,
    updating: false
  })
}))

vi.mock(
  '@/components/admin/connection-map/mobile/wallet-picker-drawer',
  () => ({
    WalletPickerDrawer: ({
      open,
      rows
    }: {
      open: boolean
      rows: { key: string; label: string; onSelect: () => void }[]
    }) =>
      open
        ? rows.map(row => (
            <button key={row.key} type="button" onClick={row.onSelect}>
              {row.label}
            </button>
          ))
        : null
  })
)

import { AddressTab } from '@/components/admin/connection-map/mobile/address-tab'
import { CardTab } from '@/components/admin/connection-map/mobile/card-tab'

const card = {
  id: 'card-1',
  title: 'Everyday card',
  designId: null,
  design: null,
  ntag424: null,
  lightningAddress: null,
  remoteWalletId: null,
  defaultRemoteWalletId: null,
  blocked: false,
  disabled: false,
  kind: 'SIMPLE' as const,
  masterCardId: null,
  createdAt: '2026-08-05T00:00:00.000Z',
  updatedAt: '2026-08-05T00:00:00.000Z'
}

describe('Connection Map mobile rows', () => {
  beforeEach(() => {
    setCardWallet.mockReset()
    setCardWallet.mockResolvedValue(card)
  })
  it('renders address detail and binding actions as sibling buttons', async () => {
    const onOpenDetail = vi.fn()
    const { container } = render(
      <AddressTab
        addresses={[
          {
            username: 'alice',
            mode: 'IDLE',
            redirect: null,
            remoteWalletId: null,
            remoteWalletName: null,
            isPrimary: false,
            nwcMode: 'SEND_RECEIVE',
            createdAt: '2026-08-05T00:00:00.000Z',
            updatedAt: '2026-08-05T00:00:00.000Z'
          }
        ]}
        wallets={[]}
        onOpenDetail={onOpenDetail}
      />
    )

    expect(container.querySelector('button button')).toBeNull()
    await userEvent.click(
      screen.getByRole('button', { name: 'Open alice details' })
    )
    expect(onOpenDetail).toHaveBeenCalledOnce()
  })

  it('renders card detail and binding actions as sibling buttons', async () => {
    const onOpenDetail = vi.fn()
    const { container } = render(
      <CardTab
        cards={[card]}
        wallets={[]}
        onOpenDetail={onOpenDetail}
      />
    )

    expect(container.querySelector('button button')).toBeNull()
    await userEvent.click(
      screen.getByRole('button', { name: 'Open Everyday card details' })
    )
    expect(onOpenDetail).toHaveBeenCalledOnce()
  })

  it('rebinds and unbinds through the owner-scoped card mutation', async () => {
    render(
      <CardTab
        cards={[card]}
        wallets={[
          {
            id: 'wallet-1',
            name: 'Savings',
            type: 'NWC',
            status: 'ACTIVE',
            isDefault: false,
            createdAt: '2026-08-05T00:00:00.000Z',
            updatedAt: '2026-08-05T00:00:00.000Z',
            diedAt: null,
            provider: null,
            lncurlServerUrl: null
          }
        ]}
        onOpenDetail={vi.fn()}
      />
    )

    await userEvent.click(screen.getByRole('button', { name: 'Primary wallet' }))
    await userEvent.click(screen.getByRole('button', { name: 'Savings' }))
    expect(setCardWallet).toHaveBeenCalledWith('card-1', 'wallet-1')

    await userEvent.click(screen.getByRole('button', { name: 'Primary wallet' }))
    await userEvent.click(
      screen.getByRole('button', { name: 'Use primary wallet' })
    )
    expect(setCardWallet).toHaveBeenCalledWith('card-1', null)
  })
})
