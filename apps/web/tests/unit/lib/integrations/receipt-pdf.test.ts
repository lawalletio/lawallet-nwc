// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import {
  buildBullReceiptPdf,
  bullVerificationRows,
  receiptSections,
  winAnsi
} from '@/lib/integrations/receipt-pdf'

const base = {
  swapId: 'swap-1',
  externalId: 'bb-order-1',
  amountArs: 50_000,
  amountSats: 44_567,
  createdAt: new Date('2026-11-13T04:52:00Z'),
  paidAt: new Date('2026-11-13T04:52:30Z'),
  completedAt: new Date('2026-11-13T05:10:00Z'),
  holderName: 'Juana Pérez Núñez 🙂 Łukasz',
  destination: '0000003100010000000001',
  account: null,
  paymentHash: 'ab'.repeat(32),
  generatedAt: new Date('2026-11-14T23:40:00Z')
}

describe('Bull Bitcoin receipt PDF', () => {
  it('builds a one-page PDF, even with names outside the standard font', async () => {
    const bytes = await buildBullReceiptPdf({
      ...base,
      order: { orderId: 'bb-order-1', orderNumber: 1234567 }
    })
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe('%PDF-')
    const doc = await PDFDocument.load(bytes)
    expect(doc.getPageCount()).toBe(1)
    expect(doc.getAuthor()).toBe('LaWallet')
  })

  it('still builds from the stored order when Bull Bitcoin is unreachable', async () => {
    const bytes = await buildBullReceiptPdf({ ...base, order: null })
    expect(bytes.length).toBeGreaterThan(1000)
  })

  it('keeps Spanish accents and replaces what WinAnsi cannot encode', () => {
    expect(winAnsi('Núñez')).toBe('Núñez')
    expect(winAnsi('Łukasz 🙂')).toBe('Lukasz ?')
  })

  it('lists Bull Bitcoin ids, statuses and any payout reference for verification', () => {
    const rows = bullVerificationRows(
      {
        orderId: 'bb-order-1',
        orderNumber: 1234567,
        orderStatus: 'Completed',
        payoutStatus: 'Completed',
        payoutTransactionReference: 'COELSA-1',
        nested: { reference: 'ignored' }
      },
      'fallback'
    )
    expect(rows).toEqual([
      ['ID de orden', 'bb-order-1'],
      ['N° de orden', '1234567'],
      ['Estado de la orden', 'Completada'],
      ['Estado de la transferencia', 'Completada'],
      ['Referencia (Payout Transaction Reference)', 'COELSA-1']
    ])
    // Without a summary the stored provider id is still the reference.
    expect(bullVerificationRows(null, 'bb-order-1')).toEqual([
      ['ID de orden', 'bb-order-1']
    ])
  })
})

describe('shareable receipt', () => {
  const data = {
    ...base,
    holderName: 'Ana',
    order: {
      orderId: 'bb-order-1',
      orderNumber: 7,
      orderStatus: 'Completed',
      payinStatus: 'Completed',
      payoutStatus: 'Completed',
      exchangeRateAmount: 112_190_000
    }
  }
  const text = (variant: 'full' | 'share') =>
    receiptSections(data, variant)
      .flatMap(s => [s.title, ...s.rows.flat()])
      .join('\n')

  it('says pesos only — no sats, BTC price, rate or Lightning payment', () => {
    const share = text('share')
    expect(share).toMatch(/\$\s50\.000,00/)
    expect(share).toContain('bb-order-1')
    expect(share).not.toMatch(/sats?\b|BTC|Lightning|Hash|Cotización/i)
    // The full receipt keeps them.
    expect(text('full')).toMatch(/44\.567 sats[\s\S]*Lightning/)
  })

  it('renders as its own one-page PDF', async () => {
    const doc = await PDFDocument.load(await buildBullReceiptPdf(data, 'share'))
    expect(doc.getPageCount()).toBe(1)
  })
})
