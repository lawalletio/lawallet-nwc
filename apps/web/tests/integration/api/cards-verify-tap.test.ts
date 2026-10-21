import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createNextRequest, assertResponse } from '@/tests/helpers/api-helpers'
import { prismaMock, resetPrismaMock } from '@/tests/helpers/prisma-mock'
import { createNtag424Fixture } from '@/tests/helpers/fixtures'
import { createParamsPromise } from '@/tests/helpers/route-helpers'

vi.mock('@/lib/config', () => ({
  getConfig: vi.fn(() => ({
    maintenance: { enabled: false },
    requestLimits: { maxBodySize: 1048576, maxJsonSize: 1048576 }
  }))
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  withRequestLogging: (fn: any) => fn
}))

vi.mock('@/lib/middleware/maintenance', () => ({ checkMaintenance: vi.fn() }))
vi.mock('@/lib/middleware/request-limits', () => ({
  checkRequestLimits: vi.fn()
}))
vi.mock('@/lib/middleware/rate-limit', () => ({
  rateLimit: vi.fn(),
  RateLimitPresets: { cardScan: {} }
}))
vi.mock('@/lib/auth/unified-auth', () => ({
  authenticateWithPermission: vi.fn()
}))

import { POST } from '@/app/api/cards/[id]/verify-tap/route'
import { authenticateWithPermission } from '@/lib/auth/unified-auth'
import { signNtag424Tap } from '@/lib/ntag424'

// A real card: the CID must be 7 bytes of hex for the SUN math.
const ntag424 = createNtag424Fixture({ cid: '04AABBCCDDEE01', ctr: 4 })

function verify(body: Record<string, string>) {
  const req = createNextRequest('/api/cards/card-1/verify-tap', {
    method: 'POST',
    body
  })
  return POST(req, createParamsPromise({ id: 'card-1' }))
}

/** Flip the last hex digit, like hand-editing the tapped URL. */
function tamper(hex: string): string {
  const last = hex.at(-1) === '0' ? '1' : '0'
  return hex.slice(0, -1) + last
}

beforeEach(() => {
  resetPrismaMock()
  vi.clearAllMocks()
  vi.mocked(authenticateWithPermission).mockResolvedValue({
    pubkey: 'x'
  } as any)
  vi.mocked(prismaMock.card.findUnique).mockResolvedValue({ ntag424 } as any)
})

describe('POST /api/cards/[id]/verify-tap', () => {
  it('accepts a genuine tap ahead of the stored counter, without spending it', async () => {
    const tap = await signNtag424Tap(ntag424, 5)

    const body: any = await assertResponse(await verify(tap), 200)

    expect(body).toEqual({ valid: true, ctr: 5 })
    expect(prismaMock.ntag424.update).not.toHaveBeenCalled()
    expect(prismaMock.ntag424.updateMany).not.toHaveBeenCalled()
  })

  it('rejects a tap whose c was edited', async () => {
    const tap = await signNtag424Tap(ntag424, 5)

    await assertResponse(await verify({ p: tap.p, c: tamper(tap.c) }), 400)
  })

  it('rejects a tap whose p was edited', async () => {
    const tap = await signNtag424Tap(ntag424, 5)

    await assertResponse(await verify({ p: tamper(tap.p), c: tap.c }), 400)
  })

  it('rejects a replayed tap (counter not ahead of the stored one)', async () => {
    const tap = await signNtag424Tap(ntag424, 4)

    await assertResponse(await verify(tap), 409)
  })

  it('404s for a missing card', async () => {
    vi.mocked(prismaMock.card.findUnique).mockResolvedValue(null)
    const tap = await signNtag424Tap(ntag424, 5)

    await assertResponse(await verify(tap), 404)
  })

  it('409s for a card with no NTAG424', async () => {
    vi.mocked(prismaMock.card.findUnique).mockResolvedValue({
      ntag424: null
    } as any)

    await assertResponse(
      await verify({ p: 'A'.repeat(32), c: 'B'.repeat(16) }),
      409
    )
  })
})
