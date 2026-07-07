'use client'

import { Badge } from '@/components/ui/badge'
import { type BackupAnalyzeResponse, type BackupTableName, tableLabel } from '@/lib/client/backup-types'
import { cn } from '@/lib/utils'

/** Per-table analysis cards with new / conflict / identical / invalid badges. */
export function TableSummaryGrid({ tables }: { tables: BackupAnalyzeResponse['tables'] }) {
  const entries = Object.entries(tables) as [BackupTableName, BackupAnalyzeResponse['tables'][BackupTableName]][]
  const nonEmpty = entries.filter(([, analysis]) => (analysis?.counts.total ?? 0) > 0)

  if (nonEmpty.length === 0) {
    return <p className="text-sm text-muted-foreground">This backup contains no records to restore.</p>
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {nonEmpty.map(([table, analysis], index) => {
        const counts = analysis!.counts
        return (
          <div
            key={table}
            className="rounded-lg border p-3 animate-in fade-in slide-in-from-bottom-2 duration-300 motion-reduce:animate-none"
            style={{ animationDelay: `${index * 30}ms` }}
          >
            <div className="flex items-baseline justify-between">
              <p className="text-sm font-medium">{tableLabel(table)}</p>
              <span className="text-xs text-muted-foreground">{counts.total}</span>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {counts.new > 0 && (
                <Badge variant="secondary" className={cn('bg-emerald-500/15 text-emerald-700 dark:text-emerald-300')}>
                  {counts.new} new
                </Badge>
              )}
              {counts.conflicting > 0 && (
                <Badge variant="secondary" className="bg-amber-500/15 text-amber-700 dark:text-amber-300">
                  {counts.conflicting} conflict{counts.conflicting === 1 ? '' : 's'}
                </Badge>
              )}
              {counts.identical > 0 && (
                <Badge variant="outline" className="text-muted-foreground">
                  {counts.identical} unchanged
                </Badge>
              )}
              {counts.invalid > 0 && (
                <Badge variant="destructive">{counts.invalid} invalid</Badge>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
