'use client'

import { useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { type BackupImportResult, type BackupTableName, tableLabel } from '@/lib/client/backup-types'
import { cn } from '@/lib/utils'

function useCountUp(target: number, duration = 700): number {
  const [value, setValue] = useState(0)
  useEffect(() => {
    if (
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    ) {
      setValue(target)
      return
    }
    let raf = 0
    const start = performance.now()
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration)
      setValue(Math.round(target * (1 - Math.pow(1 - t, 3))))
      if (t < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, duration])
  return value
}

function StatNumber({ value, label, tone }: { value: number; label: string; tone?: string }) {
  const shown = useCountUp(value)
  return (
    <div className="rounded-lg border p-3 text-center">
      <p className={cn('text-2xl font-semibold tabular-nums', tone)}>{shown}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  )
}

/** Animated end-of-restore report: totals, per-table breakdown, and errors. */
export function ResultSummary({
  result,
  onDone,
}: {
  result: BackupImportResult
  onDone: () => void
}) {
  const entries = Object.entries(result.tables) as [
    BackupTableName,
    NonNullable<BackupImportResult['tables'][BackupTableName]>,
  ][]

  const totals = entries.reduce(
    (acc, [, t]) => {
      acc.imported += t.imported
      acc.overwritten += t.overwritten
      acc.renamed += t.renamed
      acc.deleted += t.deleted
      acc.skipped += t.skipped
      acc.failed += t.failed
      return acc
    },
    { imported: 0, overwritten: 0, renamed: 0, deleted: 0, skipped: 0, failed: 0 },
  )

  const active = entries.filter(
    ([, t]) => t.imported + t.overwritten + t.renamed + t.deleted + t.skipped + t.failed > 0,
  )

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col items-center gap-2 text-center">
        {result.hadErrors ? (
          <AlertTriangle className="size-14 text-amber-500 animate-in zoom-in-50 duration-500 motion-reduce:animate-none" />
        ) : (
          <CheckCircle2 className="size-14 text-emerald-500 animate-in zoom-in-50 duration-500 motion-reduce:animate-none" />
        )}
        <h2 className="text-xl font-semibold">
          {result.hadErrors ? 'Restore finished with issues' : 'Restore complete'}
        </h2>
        <p className="text-sm text-muted-foreground">
          {result.mode === 'replace' ? 'Data was replaced from the backup.' : 'The backup was merged into your data.'}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatNumber value={totals.imported} label="Imported" tone="text-emerald-600 dark:text-emerald-400" />
        <StatNumber value={totals.overwritten} label="Overwritten" />
        <StatNumber value={totals.renamed} label="Renamed" />
        {result.mode === 'replace' && <StatNumber value={totals.deleted} label="Deleted" />}
        <StatNumber value={totals.skipped} label="Skipped" />
        <StatNumber
          value={totals.failed}
          label="Failed"
          tone={totals.failed > 0 ? 'text-destructive' : undefined}
        />
      </div>

      {active.length > 0 && (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Table</TableHead>
                <TableHead className="text-right">Imported</TableHead>
                <TableHead className="text-right">Overwritten</TableHead>
                <TableHead className="text-right">Renamed</TableHead>
                {result.mode === 'replace' && <TableHead className="text-right">Deleted</TableHead>}
                <TableHead className="text-right">Skipped</TableHead>
                <TableHead className="text-right">Failed</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {active.map(([table, t]) => (
                <TableRow key={table}>
                  <TableCell className="font-medium">{tableLabel(table)}</TableCell>
                  <TableCell className="text-right tabular-nums">{t.imported}</TableCell>
                  <TableCell className="text-right tabular-nums">{t.overwritten}</TableCell>
                  <TableCell className="text-right tabular-nums">{t.renamed}</TableCell>
                  {result.mode === 'replace' && (
                    <TableCell className="text-right tabular-nums">{t.deleted}</TableCell>
                  )}
                  <TableCell className="text-right tabular-nums">{t.skipped}</TableCell>
                  <TableCell
                    className={cn('text-right tabular-nums', t.failed > 0 && 'text-destructive')}
                  >
                    {t.failed}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {result.errors.length > 0 && (
        <div className="space-y-1 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
          <p className="text-sm font-medium text-destructive">Errors</p>
          <ul className="list-inside list-disc space-y-0.5 text-xs text-muted-foreground">
            {result.errors.slice(0, 20).map((error, index) => (
              <li key={index}>
                {error.table ? `${tableLabel(error.table)}: ` : ''}
                {error.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex justify-end">
        <Button onClick={onDone}>Done</Button>
      </div>
    </div>
  )
}
