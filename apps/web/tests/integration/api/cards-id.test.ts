import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createNextRequest, assertResponse } from '@/tests/helpers/api-helpers'
import { prismaMock, resetPrismaMock } from '@/tests/helpers/prisma-mock'
import {
  createCardFixture,
  createCardDesignFixture,
  createNtag424Fixture,
  createRemoteWalletFixture,
} from '@/tests/helpers/fixtures'
import { createParamsPromise } from '@/tests/helpers/route-helpers'

vi.mock('@/lib/config', () => ({
  getConfig: vi.fn(() => ({
    maintenance: { enabled: false },
    requestLimits: { maxBodySize: 1048576, maxJsonSize: 1048576 },
  })),
}))

vi.mock('@/lib/middleware/request-limits', () => ({
  checkRequestLimits: vi.fn(),
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  withRequestLogging: (fn: any) => fn,
}))

vi.mock('@/lib/middleware/maintenance', () => ({
  checkMaintenance: vi.fn(),
}))

vi.mock('@/lib/auth/unified-auth', () => ({
  authenticateWithPermission: vi.fn(),
}))

import { GET, PATCH, DELETE } from '@/app/api/cards/[id]/route'
import { authenticateWithPermission } from '@/lib/auth/unified-auth'
import { Role } from '@/lib/auth/permissions'

const mockAdmin = () =>
  vi.mocked(authenticateWithPermission).mockResolvedValue({
    pubkey: 'admin',
    role: Role.ADMIN,
    method: 'jwt',
  })

beforeEach(() => {
  resetPrismaMock()
  vi.clearAllMocks()
})

describe('GET /api/cards/[id]', () => {
  it('returns card details for admin', async () => {
    mockAdmin()
    const design = createCardDesignFixture()
    const ntag424 = createNtag424Fixture()
    const card = { ...createCardFixture(), design, ntag424, user: { pubkey: 'a'.repeat(64) } }
    vi.mocked(prismaMock.card.findUnique).mockResolvedValue(card as any)

    const req = createNextRequest(`/api/cards/${card.id}`)
    const res = await GET(req, createParamsPromise({ id: card.id }))
    const body: any = await assertResponse(res, 200)

    expect(body.id).toBe(card.id)
    expect(body.design).toBeDefined()
  })

  it('returns 404 for nonexistent card', async () => {
    mockAdmin()
    vi.mocked(prismaMock.card.findUnique).mockResolvedValue(null)

    const req = createNextRequest('/api/cards/nonexistent')
    const res = await GET(req, createParamsPromise({ id: 'nonexistent' }))

    expect(res.status).toBe(404)
  })

  it('rejects non-admin', async () => {
    vi.mocked(authenticateWithPermission).mockRejectedValue(new Error('unauthorized'))

    const req = createNextRequest('/api/cards/some-id')
    const res = await GET(req, createParamsPromise({ id: 'some-id' }))

    expect(res.status).toBeGreaterThanOrEqual(400)
  })
})

describe('DELETE /api/cards/[id]', () => {
  it('deletes card and NTAG424 in transaction', async () => {
    mockAdmin()
    const card = createCardFixture({ ntag424Cid: 'ntag-cid-123' })
    vi.mocked(prismaMock.card.findUnique).mockResolvedValue(card as any)

    const req = createNextRequest(`/api/cards/${card.id}`, { method: 'DELETE' })
    const res = await DELETE(req, createParamsPromise({ id: card.id }))
    const body: any = await assertResponse(res, 200)

    expect(body).toMatchObject({
      message: 'Card and associated NTAG424 deleted successfully',
      cardId: card.id,
      ntag424Cid: 'ntag-cid-123',
    })
  })

  it('returns 404 for nonexistent card', async () => {
    mockAdmin()
    vi.mocked(prismaMock.card.findUnique).mockResolvedValue(null)

    const req = createNextRequest('/api/cards/nonexistent', { method: 'DELETE' })
    const res = await DELETE(req, createParamsPromise({ id: 'nonexistent' }))

    expect(res.status).toBe(404)
  })

  it('handles card without NTAG424', async () => {
    mockAdmin()
    const card = createCardFixture({ ntag424Cid: null })
    vi.mocked(prismaMock.card.findUnique).mockResolvedValue(card as any)

    const req = createNextRequest(`/api/cards/${card.id}`, { method: 'DELETE' })
    const res = await DELETE(req, createParamsPromise({ id: card.id }))
    const body: any = await assertResponse(res, 200)

    expect(body.ntag424Cid).toBeNull()
  })

  it('rejects non-admin', async () => {
    vi.mocked(authenticateWithPermission).mockRejectedValue(new Error('unauthorized'))

    const req = createNextRequest('/api/cards/some-id', { method: 'DELETE' })
    const res = await DELETE(req, createParamsPromise({ id: 'some-id' }))

    expect(res.status).toBeGreaterThanOrEqual(400)
  })
})

// Helper for PATCH requests with a JSON body — keeps the call site terse so
// the test body is the payload + the URL. `createNextRequest` JSON-encodes
// the body object on its own; we pass the plain shape.
function patchReq(id: string, body: unknown) {
  return createNextRequest(`/api/cards/${id}`, {
    method: 'PATCH',
    body: body as Record<string, unknown>,
  })
}

describe('PATCH /api/cards/[id]', () => {
  it('binds the card to a wallet owned by the same user', async () => {
    mockAdmin()
    const card = createCardFixture({
      userId: 'user-1',
      remoteWalletId: null,
    })
    const wallet = createRemoteWalletFixture({
      userId: 'user-1',
      status: 'ACTIVE',
    })
    vi.mocked(prismaMock.card.findUnique).mockResolvedValue(card as any)
    vi.mocked(prismaMock.remoteWallet.findUnique).mockResolvedValue(wallet as any)
    vi.mocked(prismaMock.card.update).mockResolvedValue({
      ...card,
      remoteWalletId: wallet.id,
      design: createCardDesignFixture(),
      ntag424: createNtag424Fixture(),
      user: { pubkey: 'a'.repeat(64) },
    } as any)

    const res = await PATCH(
      patchReq(card.id, { remoteWalletId: wallet.id }),
      createParamsPromise({ id: card.id }),
    )
    const body: any = await assertResponse(res, 200)

    expect(body.id).toBe(card.id)
    expect(body.remoteWalletId).toBe(wallet.id)
    // The update call should set the binding to the new wallet id.
    expect(prismaMock.card.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: card.id },
        data: { remoteWalletId: wallet.id },
      }),
    )
  })

  it('unbinds when remoteWalletId is null', async () => {
    mockAdmin()
    const card = createCardFixture({
      userId: 'user-1',
      remoteWalletId: 'wallet-old',
    })
    vi.mocked(prismaMock.card.findUnique).mockResolvedValue(card as any)
    vi.mocked(prismaMock.card.update).mockResolvedValue({
      ...card,
      remoteWalletId: null,
      design: createCardDesignFixture(),
      ntag424: createNtag424Fixture(),
      user: { pubkey: 'a'.repeat(64) },
    } as any)

    const res = await PATCH(
      patchReq(card.id, { remoteWalletId: null }),
      createParamsPromise({ id: card.id }),
    )
    const body: any = await assertResponse(res, 200)

    expect(body.remoteWalletId).toBeNull()
    expect(prismaMock.card.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { remoteWalletId: null },
      }),
    )
    // No wallet lookup when unbinding — saves a round-trip.
    expect(prismaMock.remoteWallet.findUnique).not.toHaveBeenCalled()
  })

  it('returns 404 for nonexistent card', async () => {
    mockAdmin()
    vi.mocked(prismaMock.card.findUnique).mockResolvedValue(null)

    const res = await PATCH(
      patchReq('nope', { remoteWalletId: 'whatever' }),
      createParamsPromise({ id: 'nope' }),
    )

    expect(res.status).toBe(404)
  })

  it('rejects a wallet whose status is REVOKED', async () => {
    mockAdmin()
    const card = createCardFixture({ userId: 'user-1', remoteWalletId: null })
    const wallet = createRemoteWalletFixture({
      userId: 'user-1',
      status: 'REVOKED',
    })
    vi.mocked(prismaMock.card.findUnique).mockResolvedValue(card as any)
    vi.mocked(prismaMock.remoteWallet.findUnique).mockResolvedValue(wallet as any)

    const res = await PATCH(
      patchReq(card.id, { remoteWalletId: wallet.id }),
      createParamsPromise({ id: card.id }),
    )

    expect(res.status).toBe(400)
    expect(prismaMock.card.update).not.toHaveBeenCalled()
  })

  it('rejects a wallet that does not belong to the card owner', async () => {
    mockAdmin()
    const card = createCardFixture({ userId: 'user-1', remoteWalletId: null })
    const wallet = createRemoteWalletFixture({
      userId: 'user-2', // different owner
      status: 'ACTIVE',
    })
    vi.mocked(prismaMock.card.findUnique).mockResolvedValue(card as any)
    vi.mocked(prismaMock.remoteWallet.findUnique).mockResolvedValue(wallet as any)

    const res = await PATCH(
      patchReq(card.id, { remoteWalletId: wallet.id }),
      createParamsPromise({ id: card.id }),
    )

    expect(res.status).toBe(400)
    expect(prismaMock.card.update).not.toHaveBeenCalled()
  })

  it('rejects unauthenticated callers', async () => {
    vi.mocked(authenticateWithPermission).mockRejectedValue(new Error('unauthorized'))

    const res = await PATCH(
      patchReq('any-id', { remoteWalletId: null }),
      createParamsPromise({ id: 'any-id' }),
    )

    expect(res.status).toBeGreaterThanOrEqual(400)
  })
})
