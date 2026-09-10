import { describe, it, expect, vi, beforeEach } from 'vitest'
import { prismaMock, resetPrismaMock } from '@/tests/helpers/prisma-mock'

import {
  clearMasterCard,
  getMasterCardId,
  setMasterCard
} from '@/lib/cards/master-card'

beforeEach(() => {
  resetPrismaMock()
  vi.clearAllMocks()
})

describe('getMasterCardId', () => {
  it('returns the holder’s master card id', async () => {
    vi.mocked(prismaMock.card.findFirst).mockResolvedValue({
      id: 'card-master'
    } as any)

    await expect(getMasterCardId('user-1')).resolves.toBe('card-master')
    expect(prismaMock.card.findFirst).toHaveBeenCalledWith({
      where: { userId: 'user-1', kind: 'MASTER' },
      select: { id: true }
    })
  })

  it('returns null when the holder has no master card', async () => {
    vi.mocked(prismaMock.card.findFirst).mockResolvedValue(null as any)
    await expect(getMasterCardId('user-1')).resolves.toBeNull()
  })
})

describe('setMasterCard', () => {
  it('demotes the previous master before promoting the new one', async () => {
    // Ordering is the whole point: Postgres evaluates the partial unique index
    // mid-transaction, so a promote-before-demote would trip the constraint.
    const calls: string[] = []
    vi.mocked(prismaMock.card.findFirst).mockResolvedValue({
      id: 'card-old'
    } as any)
    vi.mocked(prismaMock.card.updateMany).mockImplementation((async (
      args: any
    ) => {
      calls.push(args?.data?.kind === 'MASTER' ? 'promote' : 'demote')
      return { count: 1 }
    }) as any)

    const result = await setMasterCard('user-1', 'card-new')

    expect(calls).toEqual(['demote', 'promote'])
    expect(result.previousMasterCardId).toBe('card-old')
    expect(prismaMock.card.updateMany).toHaveBeenNthCalledWith(1, {
      where: { userId: 'user-1', kind: 'MASTER', id: { not: 'card-new' } },
      data: { kind: 'SIMPLE' }
    })
    expect(prismaMock.card.updateMany).toHaveBeenNthCalledWith(2, {
      where: { id: 'card-new', userId: 'user-1' },
      data: { kind: 'MASTER' }
    })
  })

  it('promotes without demoting when the holder had no master', async () => {
    vi.mocked(prismaMock.card.findFirst).mockResolvedValue(null as any)
    vi.mocked(prismaMock.card.updateMany).mockImplementation((async (
      args: any
    ) => {
      return { count: args?.data?.kind === 'MASTER' ? 1 : 0 }
    }) as any)

    const result = await setMasterCard('user-1', 'card-new')

    expect(result.previousMasterCardId).toBeNull()
    expect(prismaMock.card.updateMany).toHaveBeenCalledWith({
      where: { id: 'card-new', userId: 'user-1' },
      data: { kind: 'MASTER' }
    })
  })

  it('is a no-op when the card is already the master', async () => {
    vi.mocked(prismaMock.card.findFirst).mockResolvedValue({
      id: 'card-same'
    } as any)

    const result = await setMasterCard('user-1', 'card-same')

    expect(result.previousMasterCardId).toBeNull()
    expect(prismaMock.card.updateMany).not.toHaveBeenCalled()
    expect(prismaMock.card.update).not.toHaveBeenCalled()
  })

  it('refuses to promote when the card no longer belongs to the holder', async () => {
    vi.mocked(prismaMock.card.findFirst).mockResolvedValue(null as any)
    vi.mocked(prismaMock.card.updateMany).mockImplementation((async () => {
      return { count: 0 }
    }) as any)

    await expect(setMasterCard('user-1', 'card-new')).rejects.toMatchObject({
      statusCode: 409,
      message: 'Card is no longer assigned to this holder'
    })
  })
})

describe('clearMasterCard', () => {
  it('only touches the card when it is currently MASTER', async () => {
    vi.mocked(prismaMock.card.updateMany).mockResolvedValue({ count: 1 } as any)

    await clearMasterCard('card-1')

    expect(prismaMock.card.updateMany).toHaveBeenCalledWith({
      where: { id: 'card-1', kind: 'MASTER' },
      data: { kind: 'SIMPLE' }
    })
  })
})
