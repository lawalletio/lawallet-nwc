import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

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
  })
}))

vi.mock(
  '@/components/admin/connection-map/mobile/wallet-picker-drawer',
  () => ({ WalletPickerDrawer: () => null })
)

import { AddressTab } from '@/components/admin/connection-map/mobile/address-tab'
import { CardTab } from '@/components/admin/connection-map/mobile/card-tab'

describe('Connection Map mobile rows', () => {
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
        cards={[
          {
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
            kind: 'SIMPLE',
            masterCardId: null,
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
      screen.getByRole('button', { name: 'Open Everyday card details' })
    )
    expect(onOpenDetail).toHaveBeenCalledOnce()
  })
})
