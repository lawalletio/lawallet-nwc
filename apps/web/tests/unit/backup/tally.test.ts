import { describe, it, expect } from 'vitest'
import { computeTally } from '@/lib/backup/tally'
import type {
  BackupAnalyzeResponse,
  BackupConflict,
  BackupResolutionStrategy
} from '@/lib/validation/schemas'

/** Build one conflict with sensible defaults; any field can be overridden. */
function conflict(overrides: Partial<BackupConflict>): BackupConflict {
  return {
    id: overrides.id ?? 'c1',
    table: overrides.table ?? 'lightningAddresses',
    kind: overrides.kind ?? 'partial-unique',
    rowKey: overrides.rowKey ?? 'r1',
    message: overrides.message ?? 'm',
    suggestedStrategy: overrides.suggestedStrategy ?? 'skip',
    allowedStrategies: overrides.allowedStrategies ?? ['skip', 'overwrite'],
    ...overrides
  } as BackupConflict
}

/** Minimal analysis carrying only the per-table counts the tally reads. */
function analysis(
  opts: {
    newRows?: number
    identical?: number
  } = {}
): BackupAnalyzeResponse {
  return {
    manifest: {
      schemaVersion: 1,
      appVersion: 'x',
      prismaMigration: null,
      exportedAt: 'x',
      encrypted: false,
      categories: [],
      tables: {}
    },
    tables: {
      lightningAddresses: {
        counts: {
          total: 0,
          new: opts.newRows ?? 0,
          identical: opts.identical ?? 0,
          conflicting: 0,
          invalid: 0
        },
        conflicts: []
      }
    },
    warnings: [],
    analyzedAt: 'x'
  } as unknown as BackupAnalyzeResponse
}

describe('backup tally computeTally', () => {
  it('returns zeroes when there is no analysis', () => {
    expect(computeTally(null, [], {})).toEqual({
      willImport: 0,
      willSkip: 0,
      unchanged: 0
    })
  })

  it('counts new and identical rows from the analysis counts', () => {
    const t = computeTally(analysis({ newRows: 3, identical: 2 }), [], {})
    expect(t).toEqual({ willImport: 3, willSkip: 0, unchanged: 2 })
  })

  describe('partial-unique conflicts', () => {
    it('counts a flag-based partial-unique skip as an IMPORT (matches runMerge)', () => {
      // The bug: lightningAddresses isPrimary clash, suggestedStrategy skip,
      // importsEvenOnSkip true → server still inserts the row demoted.
      const conflicts = [
        conflict({
          id: 'lightningAddresses:bob',
          kind: 'partial-unique',
          field: 'isPrimary',
          importsEvenOnSkip: true,
          suggestedStrategy: 'skip'
        })
      ]
      const t = computeTally(analysis(), conflicts, {})
      expect(t).toEqual({ willImport: 1, willSkip: 0, unchanged: 0 })
    })

    it('counts a where-flavor partial-unique skip as a SKIP (genuinely skipped)', () => {
      // cardActivationTokens pending clash: importsEvenOnSkip absent → no row.
      const conflicts = [
        conflict({
          id: 'cardActivationTokens:tok-2',
          table: 'cardActivationTokens',
          kind: 'partial-unique',
          field: undefined,
          importsEvenOnSkip: undefined,
          suggestedStrategy: 'skip'
        })
      ]
      const t = computeTally(analysis(), conflicts, {})
      expect(t).toEqual({ willImport: 0, willSkip: 1, unchanged: 0 })
    })

    it('still counts a flag-based skip as an import when the admin overrides to skip explicitly', () => {
      const conflicts = [
        conflict({
          id: 'lightningAddresses:bob',
          kind: 'partial-unique',
          field: 'isPrimary',
          importsEvenOnSkip: true,
          suggestedStrategy: 'skip'
        })
      ]
      const resolutions: Record<string, BackupResolutionStrategy> = {
        'lightningAddresses:bob': 'skip'
      }
      const t = computeTally(analysis(), conflicts, resolutions)
      expect(t).toEqual({ willImport: 1, willSkip: 0, unchanged: 0 })
    })

    it('counts a flag-based partial-unique overwrite as an import', () => {
      const conflicts = [
        conflict({
          id: 'lightningAddresses:bob',
          kind: 'partial-unique',
          field: 'isPrimary',
          importsEvenOnSkip: true,
          suggestedStrategy: 'skip'
        })
      ]
      const resolutions: Record<string, BackupResolutionStrategy> = {
        'lightningAddresses:bob': 'overwrite'
      }
      const t = computeTally(analysis(), conflicts, resolutions)
      expect(t).toEqual({ willImport: 1, willSkip: 0, unchanged: 0 })
    })
  })

  describe('other conflict kinds', () => {
    it('counts a pk skip as a skip', () => {
      const conflicts = [
        conflict({
          id: 'users:u1',
          table: 'users',
          kind: 'pk',
          field: undefined,
          importsEvenOnSkip: undefined,
          allowedStrategies: ['skip', 'overwrite'],
          suggestedStrategy: 'skip'
        })
      ]
      const t = computeTally(analysis(), conflicts, {})
      expect(t).toEqual({ willImport: 0, willSkip: 1, unchanged: 0 })
    })

    it('counts a pk overwrite as an import', () => {
      const conflicts = [
        conflict({
          id: 'users:u1',
          table: 'users',
          kind: 'pk',
          allowedStrategies: ['skip', 'overwrite'],
          suggestedStrategy: 'skip'
        })
      ]
      const t = computeTally(analysis(), conflicts, { 'users:u1': 'overwrite' })
      expect(t).toEqual({ willImport: 1, willSkip: 0, unchanged: 0 })
    })

    it('counts a fk-target-missing skip as a skip', () => {
      const conflicts = [
        conflict({
          id: 'cards:card-1',
          table: 'cards',
          kind: 'fk-target-missing',
          field: 'designId',
          allowedStrategies: ['skip'],
          suggestedStrategy: 'skip'
        })
      ]
      const t = computeTally(analysis(), conflicts, {})
      expect(t).toEqual({ willImport: 0, willSkip: 1, unchanged: 0 })
    })

    it('counts a secondary-unique rename as an import', () => {
      const conflicts = [
        conflict({
          id: 'remoteWallets:rw-2',
          table: 'remoteWallets',
          kind: 'secondary-unique',
          field: 'userId+name',
          allowedStrategies: ['skip', 'rename'],
          suggestedStrategy: 'rename'
        })
      ]
      const t = computeTally(analysis(), conflicts, {})
      expect(t).toEqual({ willImport: 1, willSkip: 0, unchanged: 0 })
    })
  })

  it('tallies a mixed plan: new rows + flag-based skip + where-flavor skip', () => {
    const conflicts = [
      conflict({
        id: 'lightningAddresses:bob',
        kind: 'partial-unique',
        field: 'isPrimary',
        importsEvenOnSkip: true,
        suggestedStrategy: 'skip'
      }),
      conflict({
        id: 'cardActivationTokens:tok-2',
        table: 'cardActivationTokens',
        kind: 'partial-unique',
        field: undefined,
        importsEvenOnSkip: undefined,
        suggestedStrategy: 'skip'
      })
    ]
    const t = computeTally(
      analysis({ newRows: 1, identical: 4 }),
      conflicts,
      {}
    )
    // 1 new + 1 flag-based-skip import = 2 to import; 1 where-flavor skip;
    // 4 unchanged.
    expect(t).toEqual({ willImport: 2, willSkip: 1, unchanged: 4 })
  })
})
