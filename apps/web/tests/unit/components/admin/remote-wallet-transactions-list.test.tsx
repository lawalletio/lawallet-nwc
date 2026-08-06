import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  WalletTransactionDetail,
  WalletTransactionsList
} from '@/components/admin/remote-wallet/transactions-list'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import type { NwcTransaction } from '@/lib/client/nwc'

const PAYMENT_HASH =
  '067e85bceebb1b471ba51f6d4a51a4b1f1d1c8942f23054444d178eafc0bf9dc'

function transaction(
  type: NwcTransaction['type'],
  description: string
): NwcTransaction {
  return {
    type,
    amountSats: 10,
    feesPaidSats: 0,
    description,
    paymentHash: PAYMENT_HASH,
    preimage: null,
    settledAt: Date.parse('2026-08-02T12:00:00.000Z'),
    createdAt: Date.parse('2026-08-02T11:59:00.000Z')
  }
}

describe('WalletTransactionsList', () => {
  it('keeps received and sent records with the same payment hash distinct', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    try {
      render(
        <WalletTransactionsList
          transactions={[
            transaction('incoming', 'Payment received'),
            transaction('outgoing', 'Payment forwarded')
          ]}
          loading={false}
          error={null}
        />
      )

      expect(screen.getByText('Payment received')).toBeInTheDocument()
      expect(screen.getByText('Payment forwarded')).toBeInTheDocument()
      expect(
        consoleError.mock.calls.some(call =>
          call.some(argument =>
            String(argument).includes('children with the same key')
          )
        )
      ).toBe(false)
    } finally {
      consoleError.mockRestore()
    }
  })

  it('shows stored NIP-57 artefacts in dedicated request and receipt modals', () => {
    render(
      <Dialog open>
        <DialogContent>
          <WalletTransactionDetail
            tx={transaction('incoming', 'Zap payment')}
            zap={{
              request: { kind: 9734 },
              requestJson: '{"kind":9734}',
              receipt: { kind: 9735 },
              receiptJson: '{"kind":9735}',
              receiptEventId: 'receipt-event',
              receiptPublishedAt: '2026-08-03T12:00:00.000Z',
              error: null,
              nextRetryAt: null
            }}
          />
        </DialogContent>
      </Dialog>
    )

    expect(screen.getByText('NIP-57 zap audit')).toBeInTheDocument()
    expect(screen.getByText('Published')).toBeInTheDocument()

    fireEvent.click(screen.getByText('Zap request'))
    expect(screen.getByText('Kind 9734 event')).toBeInTheDocument()
    expect(screen.getByText('Copy JSON')).toBeInTheDocument()
  })
})
