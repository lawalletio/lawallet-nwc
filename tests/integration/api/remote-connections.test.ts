import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createNextRequest, assertResponse } from '@/tests/helpers/api-helpers'
import { prismaMock, resetPrismaMock } from '@/tests/helpers/prisma-mock'
import { createCardDesignFixture, createNtag424Fixture } from '@/tests/helpers/fixtures'
import { createParamsPromise } from '@/tests/helpers/route-helpers'

vi.mock('@/lib/config', () => ({
  getConfig: vi.fn(() => ({
    maintenance: { enabled: false },
    requestLimits: { maxBodySize: 1048576, maxJsonSize: 1048576 },
  })),
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  withRequestLogging: (fn: any) => fn,
}))

vi.mock('@/lib/middleware/maintenance', () => ({
  checkMaintenance: vi.fn(),
}))

vi.mock('@/lib/middleware/request-limits', () => ({
  checkRequestLimits: vi.fn(),
}))

vi.mock('@/lib/settings', () => ({
  getSettings: vi.fn(),
}))

vi.mock('@/lib/ntag424', () => ({
  generateNtag424Values: vi.fn(() => ({
    cid: 'AABBCCDDEE1122',
    k0: '0'.repeat(32),
    k1: '1'.repeat(32),
    k2: '2'.repeat(32),
    k3: '3'.repeat(32),
    k4: '4'.repeat(32),
    ctr: 0,
  })),
}))

import { GET as RemoteGet } from '@/app/api/remote-connections/[externalDeviceKey]/route'
import { POST as RemoteCardsPost } from '@/app/api/remote-connections/[externalDeviceKey]/cards/route'
import { getSettings } from '@/lib/settings'

const validKey = 'test-device-key-123'

beforeEach(() => {
  resetPrismaMock()
  vi.clearAllMocks()
})

describe('GET /api/remote-connections/[externalDeviceKey]', () => {
  it('returns login response for valid key', async () => {
    vi.mocked(getSettings)
      .mockResolvedValueOnce({ external_device_key: validKey })
      .mockResolvedValueOnce({ endpoint: 'https://test.com' })

    const design = createCardDesignFixture()
    vi.mocked(prismaMock.cardDesign.findMany).mockResolvedValue([design] as any)

    const req = createNextRequest(`/api/remote-connections/${validKey}`)
    const res = await RemoteGet(req, createParamsPromise({ externalDeviceKey: validKey }))
    const body: any = await assertResponse(res, 200)

    expect(body.lnurlwBase).toBe('https://test.com/api/')
    expect(body.skins).toHaveLength(1)
    expect(body.skins[0]).toMatchObject({
      label: design.description,
      value: design.id,
      file: design.imageUrl,
    })
  })

  it('rejects invalid device key', async () => {
    vi.mocked(getSettings).mockResolvedValue({ external_device_key: validKey })

    const req = createNextRequest('/api/remote-connections/wrong-key')
    const res = await RemoteGet(req, createParamsPromise({ externalDeviceKey: 'wrong-key' }))

    expect(res.status).toBe(401)
  })

  it('returns 404 when key not configured', async () => {
    vi.mocked(getSettings).mockResolvedValue({})

    const req = createNextRequest('/api/remote-connections/any-key')
    const res = await RemoteGet(req, createParamsPromise({ externalDeviceKey: 'any-key' }))

    expect(res.status).toBe(404)
  })

  it('returns empty skins when no designs', async () => {
    vi.mocked(getSettings)
      .mockResolvedValueOnce({ external_device_key: validKey })
      .mockResolvedValueOnce({ endpoint: 'https://test.com' })
    vi.mocked(prismaMock.cardDesign.findMany).mockResolvedValue([])

    const req = createNextRequest(`/api/remote-connections/${validKey}`)
    const res = await RemoteGet(req, createParamsPromise({ externalDeviceKey: validKey }))
    const body: any = await assertResponse(res, 200)

    expect(body.skins).toEqual([])
  })
})

describe('POST /api/remote-connections/[externalDeviceKey]/cards', () => {
  it('creates card for valid key and design', async () => {
    vi.mocked(getSettings).mockResolvedValue({ external_device_key: validKey })
    const design = createCardDesignFixture()
    vi.mocked(prismaMock.cardDesign.findUnique).mockResolvedValue(design as any)
    vi.mocked(prismaMock.card.findFirst).mockResolvedValue(null) // no existing card with UID
    const ntag = createNtag424Fixture({ cid: 'AABBCCDDEE1122' })
    vi.mocked(prismaMock.ntag424.create).mockResolvedValue(ntag as any)
    vi.mocked(prismaMock.card.create).mockResolvedValue({} as any)

    const req = createNextRequest(`/api/remote-connections/${validKey}/cards`, {
      method: 'POST',
      body: { designId: design.id, cardUID: 'AA:BB:CC:DD:EE:11:22' },
    })
    const res = await RemoteCardsPost(req, createParamsPromise({ externalDeviceKey: validKey }))
    const body: any = await assertResponse(res, 200)

    expect(body.k0).toBeDefined()
    expect(body.k1).toBeDefined()
    expect(body.privateUID).toBeDefined()
  })

  it('rejects duplicate card UID', async () => {
    vi.mocked(getSettings).mockResolvedValue({ external_device_key: validKey })
    vi.mocked(prismaMock.cardDesign.findUnique).mockResolvedValue(createCardDesignFixture() as any)
    vi.mocked(prismaMock.card.findFirst).mockResolvedValue({ id: 'existing-card' } as any)

    const req = createNextRequest(`/api/remote-connections/${validKey}/cards`, {
      method: 'POST',
      body: { designId: 'design-1', cardUID: 'AA:BB:CC:DD:EE:11:22' },
    })
    const res = await RemoteCardsPost(req, createParamsPromise({ externalDeviceKey: validKey }))

    expect(res.status).toBe(409)
  })

  it('returns 404 for nonexistent design', async () => {
    vi.mocked(getSettings).mockResolvedValue({ external_device_key: validKey })
    vi.mocked(prismaMock.cardDesign.findUnique).mockResolvedValue(null)
    vi.mocked(prismaMock.card.findFirst).mockResolvedValue(null)

    const req = createNextRequest(`/api/remote-connections/${validKey}/cards`, {
      method: 'POST',
      body: { designId: 'nonexistent', cardUID: 'AA:BB:CC:DD:EE:11:22' },
    })
    const res = await RemoteCardsPost(req, createParamsPromise({ externalDeviceKey: validKey }))

    expect(res.status).toBe(404)
  })

  it('rejects invalid device key', async () => {
    vi.mocked(getSettings).mockResolvedValue({ external_device_key: validKey })

    const req = createNextRequest('/api/remote-connections/wrong-key/cards', {
      method: 'POST',
      body: { designId: 'design-1', cardUID: 'AA:BB' },
    })
    const res = await RemoteCardsPost(req, createParamsPromise({ externalDeviceKey: 'wrong-key' }))

    expect(res.status).toBe(401)
  })

  it('rejects missing designId', async () => {
    vi.mocked(getSettings).mockResolvedValue({ external_device_key: validKey })

    const req = createNextRequest(`/api/remote-connections/${validKey}/cards`, {
      method: 'POST',
      body: { cardUID: 'AA:BB:CC:DD:EE:11:22' },
    })
    const res = await RemoteCardsPost(req, createParamsPromise({ externalDeviceKey: validKey }))

    expect(res.status).toBe(400)
  })

  it('rejects missing cardUID', async () => {
    vi.mocked(getSettings).mockResolvedValue({ external_device_key: validKey })

    const req = createNextRequest(`/api/remote-connections/${validKey}/cards`, {
      method: 'POST',
      body: { designId: 'design-1' },
    })
    const res = await RemoteCardsPost(req, createParamsPromise({ externalDeviceKey: validKey }))

    expect(res.status).toBe(400)
  })
})
