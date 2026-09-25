import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  LnurlError,
  resolveLnurl,
  submitLnurlWithdraw
} from '@/lib/client/lnurl-scan'
import {
  BoltcardPayError,
  payDisplayedInvoiceFromCard
} from '@/lib/client/boltcard-pay'

vi.mock('@/lib/client/lnurl-scan', () => {
  class LnurlError extends Error {
    constructor(message: string) {
      super(message)
      this.name = 'LnurlError'
    }
  }
  return {
    LnurlError,
    resolveLnurl: vi.fn(),
    submitLnurlWithdraw: vi.fn()
  }
})

const BOLT11 = 'lnbc500n1displayedinvoice'
const CARD_URL = 'lnurlw://card.example/api/cards/1/scan?p=AA&c=BB'

function withdraw(overrides?: {
  minWithdrawableSats?: number
  maxWithdrawableSats?: number
}) {
  return {
    kind: 'withdraw' as const,
    params: {
      callback: 'https://card.example/api/cards/1/scan/cb?p=AA&c=BB',
      k1: 'k',
      defaultDescription: 'Boltcard + NWC',
      minWithdrawableSats: overrides?.minWithdrawableSats ?? 1,
      maxWithdrawableSats: overrides?.maxWithdrawableSats ?? 1_000_000,
      host: 'card.example'
    }
  }
}

describe('payDisplayedInvoiceFromCard', () => {
  beforeEach(() => {
    vi.mocked(resolveLnurl).mockReset()
    vi.mocked(submitLnurlWithdraw).mockReset()
    vi.mocked(submitLnurlWithdraw).mockResolvedValue(undefined)
  })

  it('submits the invoice already on screen', async () => {
    vi.mocked(resolveLnurl).mockResolvedValue(withdraw())

    await payDisplayedInvoiceFromCard({
      cardUrl: CARD_URL,
      bolt11: BOLT11,
      amountSats: 500
    })

    expect(resolveLnurl).toHaveBeenCalledWith(CARD_URL)
    expect(submitLnurlWithdraw).toHaveBeenCalledWith(
      'https://card.example/api/cards/1/scan/cb?p=AA&c=BB',
      'k',
      BOLT11
    )
  })

  it('refuses a card that cannot cover the displayed amount', async () => {
    vi.mocked(resolveLnurl).mockResolvedValue(
      withdraw({ maxWithdrawableSats: 10 })
    )

    await expect(
      payDisplayedInvoiceFromCard({
        cardUrl: CARD_URL,
        bolt11: BOLT11,
        amountSats: 500
      })
    ).rejects.toThrow(/up to 10 sats/)
    expect(submitLnurlWithdraw).not.toHaveBeenCalled()
  })

  it('refuses a card whose minimum is above the invoice', async () => {
    vi.mocked(resolveLnurl).mockResolvedValue(
      withdraw({ minWithdrawableSats: 1000, maxWithdrawableSats: 5000 })
    )

    await expect(
      payDisplayedInvoiceFromCard({
        cardUrl: CARD_URL,
        bolt11: BOLT11,
        amountSats: 500
      })
    ).rejects.toThrow(
      new RegExp(`minimum is ${Number(1000).toLocaleString()} sats`)
    )
    expect(submitLnurlWithdraw).not.toHaveBeenCalled()
  })

  it('rejects a tag that is not an LNURL-withdraw', async () => {
    vi.mocked(resolveLnurl).mockResolvedValue({
      kind: 'pay',
      lnurlpUrl: 'https://example.com/pay'
    })

    await expect(
      payDisplayedInvoiceFromCard({
        cardUrl: 'https://example.com/pay',
        bolt11: BOLT11,
        amountSats: 500
      })
    ).rejects.toThrow(/not a BoltCard/)
  })

  it('maps an empty card to a readable error', async () => {
    vi.mocked(resolveLnurl).mockRejectedValue(
      new LnurlError('Withdraw voucher has no withdrawable amount')
    )

    await expect(
      payDisplayedInvoiceFromCard({
        cardUrl: CARD_URL,
        bolt11: BOLT11,
        amountSats: 500
      })
    ).rejects.toBeInstanceOf(BoltcardPayError)
    await expect(
      payDisplayedInvoiceFromCard({
        cardUrl: CARD_URL,
        bolt11: BOLT11,
        amountSats: 500
      })
    ).rejects.toThrow(/cannot pay right now/)
  })

  it('surfaces the callback rejection', async () => {
    vi.mocked(resolveLnurl).mockResolvedValue(withdraw())
    vi.mocked(submitLnurlWithdraw).mockRejectedValue(
      new LnurlError('counter value too old')
    )

    await expect(
      payDisplayedInvoiceFromCard({
        cardUrl: CARD_URL,
        bolt11: BOLT11,
        amountSats: 500
      })
    ).rejects.toThrow(/counter value too old/)
  })
})
