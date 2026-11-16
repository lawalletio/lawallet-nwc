import { describe, it, expect } from 'vitest'
import { aggregateResults, validateChoices } from '@/lib/polls'

const options = [
  { id: 'tron', label: 'Tron' },
  { id: 'liquid', label: 'Liquid' },
  { id: 'rgb', label: 'RGB' }
]
const ranking = { type: 'RANKING' as const, options, allowCustom: true }
const single = { type: 'SINGLE_CHOICE' as const, options, allowCustom: false }

describe('validateChoices', () => {
  it('accepts a full ranking with one trimmed custom entry', () => {
    expect(
      validateChoices(ranking, ['liquid', 'custom:  Lightning ', 'tron', 'rgb'])
    ).toEqual(['liquid', 'custom:Lightning', 'tron', 'rgb'])
  })

  it('accepts a ranked subset (left-out options are skipped)', () => {
    expect(validateChoices(ranking, ['rgb', 'tron'])).toEqual(['rgb', 'tron'])
    expect(validateChoices(ranking, ['custom:Ark'])).toEqual(['custom:Ark'])
  })

  it.each([
    [[], /at least one/],
    [['tron', 'liquid', 'rgb', 'tron'], /twice/],
    [['tron', 'liquid', 'nope'], /Unknown/],
    [['tron', 'liquid', 'rgb', 'custom:a', 'custom:b'], /one custom/],
    [['tron', 'liquid', 'rgb', 'custom:   '], /1–40/],
    [['tron', 'liquid', 'rgb', `custom:${'x'.repeat(41)}`], /1–40/]
  ])('rejects ranking %j', (choices, message) => {
    expect(() => validateChoices(ranking, choices)).toThrow(message)
  })

  it('single choice takes exactly one entry and no custom unless allowed', () => {
    expect(validateChoices(single, ['rgb'])).toEqual(['rgb'])
    expect(() => validateChoices(single, ['rgb', 'tron'])).toThrow(
      /exactly one/
    )
    expect(() => validateChoices(single, ['custom:x'])).toThrow(/custom/)
  })
})

describe('aggregateResults', () => {
  const at = (s: string) => new Date(`2026-11-16T${s}:00Z`)
  const vote = (userId: string, choices: string[], t: string) => ({
    userId,
    choices,
    updatedAt: at(t),
    npub: `npub-${userId}`,
    lightningAddress: userId === 'a' ? 'a@x.com' : null
  })

  it('tallies first choices, Borda scores, customs and voters', () => {
    const r = aggregateResults(ranking, [
      vote('a', ['liquid', 'tron', 'rgb'], '10:00'),
      vote('b', ['liquid', 'rgb', 'tron', 'custom:USDT on LN'], '11:00'),
      vote('c', ['custom: usdt on ln', 'tron', 'rgb', 'liquid'], '09:00')
    ])

    expect(r.total).toBe(3)
    expect(r.updatedAt).toBe(at('11:00').toISOString())
    expect(r.firstChoice[0]).toEqual({
      choice: 'liquid',
      label: 'Liquid',
      count: 2
    })
    expect(r.firstChoice).toContainEqual({
      choice: 'custom',
      label: 'Custom',
      count: 1
    })
    // liquid: 3 + 4 + 1 = 8; tron: 2 + 2 + 3 = 7; rgb: 1 + 3 + 2 = 6
    expect(r.scores.map(s => [s.choice, s.points])).toEqual([
      ['liquid', 8],
      ['tron', 7],
      ['rgb', 6]
    ])
    expect(r.scores[0].avgPosition).toBe(2) // (1 + 1 + 4) / 3
    expect(r.custom).toEqual([{ label: 'usdt on ln', count: 2 }])
    expect(r.voters.map(v => v.userId)).toEqual(['b', 'a', 'c'])
    expect(r.voters[1].lightningAddress).toBe('a@x.com')
    expect(r.voters[0]).not.toHaveProperty('lightningAddress')
  })

  it('scores skipped options 0 and counts them in skipped', () => {
    const r = aggregateResults(ranking, [
      vote('a', ['liquid', 'tron', 'rgb'], '10:00'),
      vote('b', ['rgb', 'liquid'], '11:00'),
      vote('c', ['liquid'], '12:00')
    ])
    // liquid: 3 + 1 + 1 = 5; rgb: 1 + 2 = 3; tron: 2
    expect(
      r.scores.map(s => [s.choice, s.points, s.skipped, s.avgPosition])
    ).toEqual([
      ['liquid', 5, 0, 1.33], // (1 + 2 + 1) / 3
      ['rgb', 3, 1, 2], // (3 + 1) / 2
      ['tron', 2, 2, 2] // ranked once, at #2
    ])
  })

  it('has no scores for single choice and handles no votes', () => {
    const r = aggregateResults(single, [])
    expect(r).toMatchObject({
      total: 0,
      updatedAt: null,
      scores: [],
      voters: []
    })
  })
})
