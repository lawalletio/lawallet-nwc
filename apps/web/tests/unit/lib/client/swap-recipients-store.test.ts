import { beforeEach, describe, expect, it } from 'vitest'
import {
  clearSwapRecipients,
  swapRecipients
} from '@/lib/client/swap-recipients-store'

const account = (cvu: string, name = 'Ana') => ({
  cvu,
  alias: null,
  bank: 'Brubank',
  icon: null,
  owners: [{ type: 'F' as const, cuit: '27000000001', name }]
})
const stored = () =>
  JSON.parse(localStorage.getItem('lawallet-swap-recipients') ?? '[]')

describe('swap recipients store', () => {
  beforeEach(() => clearSwapRecipients())

  it('keeps one entry per CBU, newest first, capped at 10', () => {
    for (let i = 0; i < 12; i++) swapRecipients.remember(account(`cvu-${i}`))
    swapRecipients.remember(account('cvu-3', 'Ana renamed'))
    const list = stored()
    expect(list).toHaveLength(10)
    expect(list[0]).toMatchObject({
      cvu: 'cvu-3',
      owners: [{ name: 'Ana renamed' }]
    })
    expect(list.filter((r: { cvu: string }) => r.cvu === 'cvu-3')).toHaveLength(
      1
    )
  })

  it('forgets one and clears all on logout', () => {
    swapRecipients.remember(account('a'))
    swapRecipients.remember(account('b'))
    swapRecipients.forget('a')
    expect(stored().map((r: { cvu: string }) => r.cvu)).toEqual(['b'])
    clearSwapRecipients()
    expect(localStorage.getItem('lawallet-swap-recipients')).toBeNull()
  })
})
