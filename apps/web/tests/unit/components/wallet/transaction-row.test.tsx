import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TransactionRow } from '@/components/wallet/shared/transaction-row'
import {
  recallActivityTx,
  __resetActivityDetailStoreForTests
} from '@/lib/client/activity-detail-store'
import type { NwcTransaction } from '@/lib/client/nwc/transactions'

const HASH = 'a591a6d40bf420404a011733cfb7b190d62c65bf0bcda32b57b277d9ad9f146e'

const TX: NwcTransaction = {
  type: 'incoming',
  amountSats: 21000,
  feesPaidSats: 0,
  description: 'Coffee',
  paymentHash: HASH,
  preimage: null,
  settledAt: Date.now(),
  createdAt: Date.now()
}

describe('TransactionRow', () => {
  beforeEach(() => {
    __resetActivityDetailStoreForTests()
  })
  it('renders a link to the transaction detail when href is set', () => {
    render(
      <TransactionRow tx={TX} href={`/wallet/activity/${HASH}?from=home`} />
    )

    const link = screen.getByRole('link', { name: /Coffee, \+21,000 sats/ })
    expect(link).toHaveAttribute('href', `/wallet/activity/${HASH}?from=home`)
  })

  it('stashes the transaction so the detail screen can paint immediately', async () => {
    const user = userEvent.setup()
    render(<TransactionRow tx={TX} href={`/wallet/activity/${HASH}`} />)

    await user.click(screen.getByRole('link', { name: /Coffee/ }))

    expect(recallActivityTx(HASH)?.amountSats).toBe(21000)
  })
})
