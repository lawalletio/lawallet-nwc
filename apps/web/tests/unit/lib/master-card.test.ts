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
    vi.mocked(prismaMock.card.updateMany).mockImplementation((async () => {
      calls.push('demote')
      return { count: 1 }
    }) as any)
    vi.mocked(prismaMock.card.update).mockImplementation((async () => {
      calls.push('promote')
      return {} as any
    }) as any)

    const result = await setMasterCard('user-1', 'card-new')

    expect(calls).toEqual(['demote', 'promote'])
    expect(result.previousMasterCardId).toBe('card-old')
    expect(prismaMock.card.updateMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', kind: 'MASTER', id: { not: 'card-new' } },
      data: { kind: 'SIMPLE' }
    })
    expect(prismaMock.card.update).toHaveBeenCalledWith({
      where: { id: 'card-new' },
      data: { kind: 'MASTER' }
    })
  })

  it('promotes without demoting when the holder had no master', async () => {
    vi.mocked(prismaMock.card.findFirst).mockResolvedValue(null as any)
    vi.mocked(prismaMock.card.updateMany).mockResolvedValue({ count: 0 } as any)
    vi.mocked(prismaMock.card.update).mockResolvedValue({} as any)

    const result = await setMasterCard('user-1', 'card-new')

    expect(result.previousMasterCardId).toBeNull()
    expect(prismaMock.card.update).toHaveBeenCalled()
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
