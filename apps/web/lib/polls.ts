import type { PollOption } from '@/lib/validation/schemas'
import { ValidationError } from '@/types/server/errors'

export type PollType = 'RANKING' | 'SINGLE_CHOICE'

export interface PollShape {
  type: PollType
  options: PollOption[]
  allowCustom: boolean
}

export const CUSTOM_PREFIX = 'custom:'
const CUSTOM_MAX = 40

/** The public poll JSON (`{ id, slug, …, createdAt, updatedAt }`). */
export function serializePoll(poll: {
  id: string
  slug: string
  title: string
  description: string | null
  type: PollType
  options: unknown
  allowCustom: boolean
  updatable: boolean
  status: 'DRAFT' | 'OPEN' | 'CLOSED'
  createdAt: Date
  updatedAt: Date
}) {
  return {
    id: poll.id,
    slug: poll.slug,
    title: poll.title,
    ...(poll.description ? { description: poll.description } : {}),
    type: poll.type,
    options: poll.options as PollOption[],
    allowCustom: poll.allowCustom,
    updatable: poll.updatable,
    status: poll.status,
    createdAt: poll.createdAt.toISOString(),
    updatedAt: poll.updatedAt.toISOString()
  }
}

/**
 * Validates a response against the poll and returns it normalised (custom
 * text trimmed). RANKING: every option id exactly once, plus at most one
 * custom entry anywhere in the order. SINGLE_CHOICE: exactly one entry.
 */
export function validateChoices(poll: PollShape, choices: string[]): string[] {
  const optionIds = new Set(poll.options.map(o => o.id))
  const seen = new Set<string>()
  let customs = 0

  const normalised = choices.map(entry => {
    if (entry.startsWith(CUSTOM_PREFIX)) {
      if (!poll.allowCustom) {
        throw new ValidationError('This poll does not accept custom answers')
      }
      const text = entry.slice(CUSTOM_PREFIX.length).trim()
      if (text.length < 1 || text.length > CUSTOM_MAX) {
        throw new ValidationError(
          `Custom answers must be 1–${CUSTOM_MAX} characters`
        )
      }
      if (++customs > 1) {
        throw new ValidationError('Only one custom answer is allowed')
      }
      return CUSTOM_PREFIX + text
    }
    if (!optionIds.has(entry)) {
      throw new ValidationError(`Unknown option "${entry}"`)
    }
    if (seen.has(entry)) {
      throw new ValidationError(`Option "${entry}" is listed twice`)
    }
    seen.add(entry)
    return entry
  })

  if (poll.type === 'SINGLE_CHOICE') {
    if (normalised.length !== 1) {
      throw new ValidationError('Pick exactly one answer')
    }
  } else if (seen.size !== optionIds.size) {
    throw new ValidationError('Rank every option exactly once')
  }
  return normalised
}

export interface ResultsResponse {
  userId: string
  choices: unknown
  updatedAt: Date
  lightningAddress?: string | null
  npub: string
}

const CUSTOM_KEY = 'custom'

/**
 * Aggregates responses. `scores` is a Borda count where a response with n
 * entries gives n points to its first entry, n-1 to the second, …; custom
 * entries are tallied in `custom` (lowercased + trimmed) rather than scored.
 */
export function aggregateResults(
  poll: PollShape,
  responses: ResultsResponse[]
) {
  const labelOf = new Map(poll.options.map(o => [o.id, o.label]))
  const first = new Map<string, number>(poll.options.map(o => [o.id, 0]))
  const points = new Map<string, number>(poll.options.map(o => [o.id, 0]))
  const positions = new Map<string, number[]>()
  const custom = new Map<string, number>()
  let updatedAt: Date | null = null

  for (const response of responses) {
    const choices = Array.isArray(response.choices)
      ? (response.choices as string[])
      : []
    if (!updatedAt || response.updatedAt > updatedAt) {
      updatedAt = response.updatedAt
    }
    choices.forEach((entry, index) => {
      if (entry.startsWith(CUSTOM_PREFIX)) {
        const text = entry.slice(CUSTOM_PREFIX.length).trim().toLowerCase()
        custom.set(text, (custom.get(text) ?? 0) + 1)
        if (index === 0) first.set(CUSTOM_KEY, (first.get(CUSTOM_KEY) ?? 0) + 1)
        return
      }
      if (!labelOf.has(entry)) return // option removed since — ignore
      if (index === 0) first.set(entry, (first.get(entry) ?? 0) + 1)
      points.set(entry, (points.get(entry) ?? 0) + choices.length - index)
      positions.set(entry, [...(positions.get(entry) ?? []), index + 1])
    })
  }

  const byCount = <T extends { count: number }>(a: T, b: T) => b.count - a.count

  return {
    total: responses.length,
    updatedAt: updatedAt?.toISOString() ?? null,
    firstChoice: [...first]
      .map(([choice, count]) => ({
        choice,
        label: labelOf.get(choice) ?? 'Custom',
        count
      }))
      .sort(byCount),
    scores:
      poll.type === 'RANKING'
        ? poll.options
            .map(o => {
              const p = positions.get(o.id) ?? []
              return {
                choice: o.id,
                label: o.label,
                points: points.get(o.id) ?? 0,
                avgPosition: p.length
                  ? Math.round(
                      (p.reduce((a, b) => a + b, 0) / p.length) * 100
                    ) / 100
                  : null
              }
            })
            .sort((a, b) => b.points - a.points)
        : [],
    custom: [...custom]
      .map(([label, count]) => ({ label, count }))
      .sort(byCount),
    voters: [...responses]
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
      .map(r => ({
        userId: r.userId,
        ...(r.lightningAddress ? { lightningAddress: r.lightningAddress } : {}),
        npub: r.npub,
        choices: r.choices as string[],
        updatedAt: r.updatedAt.toISOString()
      }))
  }
}

export type PollResults = ReturnType<typeof aggregateResults>
