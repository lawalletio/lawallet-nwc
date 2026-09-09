import type {
  BackupAnalyzeResponse,
  BackupConflict,
  BackupResolutionStrategy
} from '@/lib/validation/schemas'

export interface Tally {
  willImport: number
  willSkip: number
  unchanged: number
}

/**
 * Pre-restore preview of how many rows the server will import vs skip vs leave
 * unchanged in merge mode. Mirrors `runMerge`'s skip-vs-import semantic:
 * a `skip`-resolved conflict that declares `importsEvenOnSkip` still writes a
 * (demoted) row, so the wizard counts it as an import — not a skip — matching
 * the authoritative post-restore totals `runMerge` reports.
 *
 * `resolvableConflicts` excludes `invalid-row` conflicts, which can't be
 * resolved and are surfaced separately by the table summary grid.
 */
export function computeTally(
  analysis: BackupAnalyzeResponse | null,
  resolvableConflicts: BackupConflict[],
  resolutions: Record<string, BackupResolutionStrategy>
): Tally {
  if (!analysis) return { willImport: 0, willSkip: 0, unchanged: 0 }

  let newRows = 0
  let unchanged = 0
  for (const t of Object.values(analysis.tables)) {
    if (!t) continue
    newRows += t.counts.new
    unchanged += t.counts.identical
  }

  let importFromConflicts = 0
  let skip = 0
  for (const conflict of resolvableConflicts) {
    const strategy = resolutions[conflict.id] ?? conflict.suggestedStrategy
    // A flag-based partial-unique (importsEvenOnSkip) is still inserted on
    // `skip` (demoted), so it must not be counted away from willImport.
    const importsDespiteSkip =
      strategy === 'skip' && conflict.importsEvenOnSkip === true
    // A where-flavor partial-unique (no importsEvenOnSkip) is always skipped
    // server-side when an incumbent exists, regardless of the strategy —
    // reconcilePartialUniques returns { skip: true } for the where branch.
    const skippedDespiteOverwrite =
      strategy === 'overwrite' &&
      conflict.kind === 'partial-unique' &&
      !conflict.importsEvenOnSkip
    if ((strategy === 'skip' && !importsDespiteSkip) || skippedDespiteOverwrite)
      skip++
    else importFromConflicts++
  }

  return {
    willImport: newRows + importFromConflicts,
    willSkip: skip,
    unchanged
  }
}
