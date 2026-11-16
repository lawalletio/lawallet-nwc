// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import crypto from 'node:crypto'
import b11 from 'bolt11'
import { prismaMock, resetPrismaMock } from '@/tests/helpers/prisma-mock'
import { lookupInvoice } from '@/lib/invoice-lookup'

const paymentHash = crypto.randomBytes(32).toString('hex')

function makeInvoice(): string {
  const encoded = b11.encode({
    satoshis: 2100,
    timestamp: Math.floor(Date.now() / 1000),
    tags: [
      { tagName: 'payment_hash', data: paymentHash },
      {
        tagName: 'payment_secret',
        data: crypto.randomBytes(32).toString('hex')
      },
      { tagName: 'description', data: 'coffee' }
    ]
  })
  const { paymentRequest } = b11.sign(encoded, crypto.randomBytes(32))
  return paymentRequest!
}

const user = {
  id: 'u1',
  pubkey: 'ab'.repeat(32),
  role: 'USER',
  lightningAddresses: [{ username: 'alice' }]
}

describe('lookupInvoice', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    resetPrismaMock()
    vi.mocked(prismaMock.invoice.findUnique).mockResolvedValue(null)
    vi.mocked(prismaMock.cardPaymentAttempt.findMany).mockResolvedValue([])
    vi.mocked(prismaMock.swap.findMany).mockResolvedValue([])
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => vi.unstubAllGlobals())

  it('resolves a local invoice with its owner and skips Amboss', async () => {
    vi.mocked(prismaMock.invoice.findUnique).mockResolvedValue({
      id: 'inv1',
      status: 'PAID',
      preimage: 'ff'.repeat(32),
      user,
      remoteWallet: { id: 'w1', name: 'Main', type: 'NWC', status: 'ACTIVE' }
    } as never)

    const result = await lookupInvoice(`lightning:${makeInvoice().toUpperCase()}`)

    expect(prismaMock.invoice.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { paymentHash } })
    )
    expect(result.isLocal).toBe(true)
    expect(result.decoded.amountMsats).toBe('2100000')
    expect(result.decoded.description).toBe('coffee')
    expect(result.local.invoice?.user).toMatchObject({
      primaryAddress: 'alice'
    })
    expect(result.local.invoice?.preimage).toBe('ff'.repeat(32))
    expect(result.node).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('queries Amboss for the payee of an external invoice', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            getNode: {
              graph_info: {
                last_update: null,
                node: { alias: 'ACINQ', color: '#49daaa', addresses: [] },
                metrics: { capacity: '100', channels: 5 }
              },
              socials: { info: null }
            }
          }
        })
      )
    )

    const result = await lookupInvoice(makeInvoice())

    expect(result.isLocal).toBe(false)
    expect(result.node).toMatchObject({ alias: 'ACINQ', channels: 5 })
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.variables.pubkey).toBe(result.decoded.payeeNodeKey)
  })

  it('reports an unknown node instead of throwing', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ data: { getNode: { graph_info: {} } } }))
    )
    const result = await lookupInvoice(makeInvoice())
    expect(result.node).toEqual({
      error: 'Node not found on Amboss (private or unannounced)'
    })
  })

  it('rejects garbage with a validation error', async () => {
    await expect(lookupInvoice('lnbc1notaninvoice')).rejects.toMatchObject({
      statusCode: 400
    })
  })
})
