import { describe, it, expect } from 'vitest'
import {
  aggregateResults,
  mergeCustomAlias,
  serializePoll,
  validateChoices
} from '@/lib/polls'

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

describe('validateChoices — TEXT', () => {
  const text = { type: 'TEXT' as const, options: [], allowCustom: false }

  it('takes one trimmed custom:<text> answer up to 280 chars', () => {
    expect(validateChoices(text, ['custom:  More stablecoins '])).toEqual([
      'custom:More stablecoins'
    ])
    expect(validateChoices(text, [`custom:${'x'.repeat(280)}`])).toHaveLength(1)
  })

  it.each([
    [['custom:a', 'custom:b'], /one custom/],
    [[], /Send one answer/],
    [['tron'], /Unknown/],
    [[`custom:${'x'.repeat(281)}`], /1–280/],
    [['custom:   '], /1–280/]
  ])('rejects %j', (choices, message) => {
    expect(() => validateChoices(text, choices)).toThrow(message)
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
      choice: 'custom:usdt on ln',
      label: 'usdt on ln',
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

  it('lists dismissed voters but leaves them out of every tally', () => {
    const r = aggregateResults(ranking, [
      vote('a', ['liquid'], '10:00'),
      { ...vote('b', ['tron', 'custom:spam'], '11:00'), dismissed: true }
    ])
    expect(r).toMatchObject({
      total: 1,
      dismissed: 1,
      updatedAt: at('10:00').toISOString(),
      custom: []
    })
    expect(r.scores.find(s => s.choice === 'tron')).toMatchObject({
      points: 0,
      skipped: 1
    })
    // b is newer but dismissed, so it sinks below a
    expect(r.voters.map(v => [v.userId, v.dismissed])).toEqual([
      ['a', undefined],
      ['b', true]
    ])
  })

  it('renames and merges custom answers through customAliases', () => {
    const r = aggregateResults(
      {
        ...ranking,
        customAliases: { 'lightining usdt': 'Lightning USDT', ark: 'Ark' }
      },
      [
        vote('a', ['custom:Lightining USDT', 'tron', 'liquid', 'rgb'], '10:00'),
        vote('b', ['custom:lightning usdt', 'tron'], '11:00'),
        vote('c', ['tron', 'custom:ARK'], '12:00'),
        vote('d', ['tron', 'custom:rgb++'], '13:00')
      ]
    )
    expect(r.custom).toEqual([
      { label: 'Lightning USDT', count: 2, merged: ['lightining usdt'] },
      { label: 'Ark', count: 1 },
      { label: 'rgb++', count: 1 }
    ])
    expect(r.firstChoice).toContainEqual({
      choice: 'custom:lightning usdt',
      label: 'Lightning USDT',
      count: 2
    })
  })

  it('ignores removed options and malformed choices', () => {
    const r = aggregateResults(ranking, [
      vote('a', ['gone', 'tron'], '10:00'),
      { ...vote('b', [], '10:01'), choices: 'not-an-array' }
    ])
    expect(r.total).toBe(2)
    expect(r.firstChoice.every(f => f.count === 0)).toBe(true)
    expect(r.scores.find(s => s.choice === 'tron')).toMatchObject({
      points: 1,
      skipped: 1
    })
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

describe('mergeCustomAlias', () => {
  it('maps from → to and drags earlier merges along', () => {
    const once = mergeCustomAlias({}, ' Lightining USDT ', 'LN USDT ')
    expect(once).toEqual({ 'lightining usdt': 'LN USDT' })
    expect(mergeCustomAlias(once, 'ln usdt', 'Lightning USDT')).toEqual({
      'lightining usdt': 'Lightning USDT',
      'ln usdt': 'Lightning USDT'
    })
  })

  it('leaves unrelated aliases alone', () => {
    expect(mergeCustomAlias({ ark: 'Ark' }, 'rgb', 'RGB')).toEqual({
      ark: 'Ark',
      rgb: 'RGB'
    })
  })
})

describe('serializePoll', () => {
  const row = {
    id: 'p',
    slug: 'p',
    title: 'P',
    type: 'TEXT' as const,
    options: [],
    allowCustom: false,
    updatable: true,
    status: 'OPEN' as const,
    createdAt: new Date(0),
    updatedAt: new Date(0)
  }
  it('includes description only when set', () => {
    expect(serializePoll({ ...row, description: 'Why?' })).toHaveProperty(
      'description',
      'Why?'
    )
    expect(serializePoll({ ...row, description: null })).not.toHaveProperty(
      'description'
    )
  })
})
