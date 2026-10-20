import { describe, it, expect, vi, beforeEach } from 'vitest'
import { prismaMock, resetPrismaMock } from '@/tests/helpers/prisma-mock'

vi.mock('@/lib/config', () => ({
  getConfig: vi.fn(() => ({
    jwt: { secret: 'a'.repeat(48), enabled: true },
    isDevelopment: false,
    isTest: true
  }))
}))

import {
  RECOVERY_TOKEN_TTL_MS,
  buildActivationUrl,
  buildRecoveryUrl,
  effectiveTokenStatus,
  mintActivationToken,
  resolveExpiresAt
} from '@/lib/card-activation'
import { ValidationError } from '@/types/server/errors'

const BASE = 'https://test.example'
const tx = prismaMock as any

beforeEach(() => {
  resetPrismaMock()
  vi.clearAllMocks()
  vi.mocked(prismaMock.cardActivationToken.updateMany).mockResolvedValue({
    count: 0
  } as any)
  vi.mocked(prismaMock.cardActivationToken.create).mockImplementation(
    (async (args: any) => args.data) as any
  )
})

function createdData() {
  return vi.mocked(prismaMock.cardActivationToken.create).mock.calls[0][0]
    .data as Record<string, any>
}

describe('activation URLs', () => {
  it('builds the wallet activation URL without double slashes', () => {
    expect(buildActivationUrl(`${BASE}//`, 'tok')).toBe(
      `${BASE}/wallet/activate/tok`
    )
  })

  it('tags the recovery URL with ?tag=recover', () => {
    expect(buildRecoveryUrl(`${BASE}/`, 'tok')).toBe(
      `${BASE}/wallet/activate/tok?tag=recover`
    )
  })

  it('gives RECOVER QRs a 15-minute lifetime', () => {
    expect(RECOVERY_TOKEN_TTL_MS).toBe(15 * 60 * 1000)
  })
})

describe('mintActivationToken', () => {
  it('builds a tagged recovery URL and stores the account being recovered', async () => {
    const expiresAt = new Date(Date.now() + RECOVERY_TOKEN_TTL_MS)

    const token = await mintActivationToken(tx, {
      cardId: 'card1',
      qrKind: 'ONE_TIME',
      baseUrl: BASE,
      issuedByUserId: 'operator-1',
      expiresAt,
      purpose: 'RECOVER',
      recoverFromUserId: 'owner-1'
    })

    const data = createdData()
    expect(data.id).toMatch(/^[0-9a-f]{32}$/)
    expect(data).toEqual({
      id: data.id,
      cardId: 'card1',
      qrKind: 'ONE_TIME',
      status: 'PENDING',
      qrPayload: `${BASE}/wallet/activate/${data.id}?tag=recover`,
      issuedByUserId: 'operator-1',
      expiresAt,
      purpose: 'RECOVER',
      recoverFromUserId: 'owner-1'
    })
    expect(token).toEqual(data)
  })

  it('stores a null owner for a RECOVER token minted without one', async () => {
    await mintActivationToken(tx, {
      cardId: 'card1',
      qrKind: 'ONE_TIME',
      baseUrl: BASE,
      purpose: 'RECOVER'
    })

    expect(createdData().recoverFromUserId).toBeNull()
  })

  it('defaults to ACTIVATE with an untagged URL and no recovery owner', async () => {
    await mintActivationToken(tx, {
      cardId: 'card1',
      qrKind: 'ONE_TIME',
      baseUrl: BASE
    })

    const data = createdData()
    expect(data.purpose).toBe('ACTIVATE')
    expect(data.qrPayload).toBe(`${BASE}/wallet/activate/${data.id}`)
    expect(data.recoverFromUserId).toBeNull()
    expect(data.issuedByUserId).toBeNull()
    expect(data.expiresAt).toBeNull()
  })

  it('drops recoverFromUserId on an ACTIVATE token', async () => {
    await mintActivationToken(tx, {
      cardId: 'card1',
      qrKind: 'ONE_TIME',
      baseUrl: BASE,
      purpose: 'ACTIVATE',
      recoverFromUserId: 'owner-1'
    })

    const data = createdData()
    expect(data.recoverFromUserId).toBeNull()
    expect(data.qrPayload).not.toContain('?tag=')
  })

  it('revokes the pending token of the same kind first, whatever its purpose', async () => {
    await mintActivationToken(tx, {
      cardId: 'card1',
      qrKind: 'ONE_TIME',
      baseUrl: BASE,
      purpose: 'RECOVER',
      recoverFromUserId: 'owner-1'
    })

    const revoke = vi.mocked(prismaMock.cardActivationToken.updateMany)
    expect(revoke).toHaveBeenCalledWith({
      where: { cardId: 'card1', qrKind: 'ONE_TIME', status: 'PENDING' },
      data: { status: 'REVOKED' }
    })
    expect(revoke.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(prismaMock.cardActivationToken.create).mock
        .invocationCallOrder[0]
    )
  })

  it('mints a fresh id every time', async () => {
    const params = {
      cardId: 'card1',
      qrKind: 'ONE_TIME' as const,
      baseUrl: BASE
    }
    const a = await mintActivationToken(tx, params)
    const b = await mintActivationToken(tx, params)
    expect(a.id).not.toBe(b.id)
  })
})

describe('resolveExpiresAt', () => {
  it('returns null when no duration is given', () => {
    expect(resolveExpiresAt(undefined)).toBeNull()
  })

  it('adds the parsed duration to now', () => {
    expect(resolveExpiresAt('15m', 1_000)?.getTime()).toBe(1_000 + 900_000)
  })

  it('rejects an unparseable duration', () => {
    expect(() => resolveExpiresAt('soon')).toThrow(ValidationError)
  })
})

describe('effectiveTokenStatus', () => {
  it('reports a lapsed PENDING token as EXPIRED', () => {
    expect(
      effectiveTokenStatus(
        { status: 'PENDING', expiresAt: new Date(1_000) },
        2_000
      )
    ).toBe('EXPIRED')
  })

  it('leaves live and terminal statuses untouched', () => {
    expect(
      effectiveTokenStatus({ status: 'PENDING', expiresAt: null }, 2_000)
    ).toBe('PENDING')
    expect(
      effectiveTokenStatus(
        { status: 'CLAIMED', expiresAt: new Date(1_000) },
        2_000
      )
    ).toBe('CLAIMED')
  })
})
