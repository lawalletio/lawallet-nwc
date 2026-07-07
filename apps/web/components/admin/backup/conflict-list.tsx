'use client'

import { useMemo } from 'react'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ConflictRow } from '@/components/admin/backup/conflict-row'
import {
  type BackupConflict,
  type BackupResolutionStrategy,
  type BackupTableName,
  tableLabel,
} from '@/lib/client/backup-types'

/** Global default applied to conflicts that allow it. */
export type DefaultStrategy = 'skip' | 'overwrite'

/**
 * Conflicts grouped by table in an accordion, with a global default-strategy
 * control and an "apply to all" shortcut. Resolutions are lifted to the parent.
 */
export function ConflictList({
  conflicts,
  resolutions,
  onResolutionChange,
  defaultStrategy,
  onDefaultStrategyChange,
  onApplyDefaultToAll,
}: {
  conflicts: BackupConflict[]
  resolutions: Record<string, BackupResolutionStrategy>
  onResolutionChange: (id: string, strategy: BackupResolutionStrategy) => void
  defaultStrategy: DefaultStrategy
  onDefaultStrategyChange: (strategy: DefaultStrategy) => void
  onApplyDefaultToAll: () => void
}) {
  const groups = useMemo(() => {
    const map = new Map<BackupTableName, BackupConflict[]>()
    for (const conflict of conflicts) {
      const list = map.get(conflict.table) ?? []
      list.push(conflict)
      map.set(conflict.table, list)
    }
    return [...map.entries()]
  }, [conflicts])

  if (conflicts.length === 0) {
    return (
      <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4 text-sm text-emerald-700 dark:text-emerald-300">
        No conflicts — everything in this backup can be restored cleanly.
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-lg border bg-muted/30 p-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">When conflicts occur, default to</span>
          <Select
            value={defaultStrategy}
            onValueChange={value => onDefaultStrategyChange(value as DefaultStrategy)}
          >
            <SelectTrigger className="h-8 w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="skip">Skip</SelectItem>
              <SelectItem value="overwrite">Overwrite</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button variant="outline" size="sm" onClick={onApplyDefaultToAll}>
          Apply to all
        </Button>
      </div>

      <Accordion type="multiple" defaultValue={[groups[0]?.[0] ?? '']} className="space-y-2">
        {groups.map(([table, tableConflicts]) => (
          <AccordionItem key={table} value={table} className="rounded-lg border px-3">
            <AccordionTrigger className="hover:no-underline">
              <span className="flex items-center gap-2">
                {tableLabel(table)}
                <Badge variant="secondary" className="bg-amber-500/15 text-amber-700 dark:text-amber-300">
                  {tableConflicts.length}
                </Badge>
              </span>
            </AccordionTrigger>
            <AccordionContent className="space-y-2 pb-3">
              {tableConflicts.map(conflict => (
                <ConflictRow
                  key={conflict.id}
                  conflict={conflict}
                  value={resolutions[conflict.id] ?? conflict.suggestedStrategy}
                  onChange={strategy => onResolutionChange(conflict.id, strategy)}
                />
              ))}
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </div>
  )
}
