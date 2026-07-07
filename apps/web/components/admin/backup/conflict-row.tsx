'use client'

import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import type { BackupConflict, BackupResolutionStrategy } from '@/lib/client/backup-types'

const STRATEGY_LABEL: Record<BackupResolutionStrategy, string> = {
  skip: 'Skip',
  overwrite: 'Overwrite',
  rename: 'Import as a copy',
}

const STRATEGY_HINT: Record<BackupResolutionStrategy, string> = {
  skip: 'Keep what’s here, ignore the backup version.',
  overwrite: 'Replace the existing record with the backup version.',
  rename: 'Keep both — import under a new name.',
}

/** One conflict: plain-language explanation + a resolution choice. */
export function ConflictRow({
  conflict,
  value,
  onChange,
}: {
  conflict: BackupConflict
  value: BackupResolutionStrategy
  onChange: (strategy: BackupResolutionStrategy) => void
}) {
  return (
    <div className="space-y-2.5 rounded-md border p-3">
      <p className="text-sm">{conflict.message}</p>
      <RadioGroup
        value={value}
        onValueChange={next => onChange(next as BackupResolutionStrategy)}
        className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:gap-4"
      >
        {conflict.allowedStrategies.map(strategy => (
          <div key={strategy} className="flex items-start gap-2">
            <RadioGroupItem value={strategy} id={`${conflict.id}-${strategy}`} className="mt-0.5" />
            <Label
              htmlFor={`${conflict.id}-${strategy}`}
              className="flex cursor-pointer flex-col gap-0.5 text-sm font-normal"
            >
              <span className="flex items-center gap-1.5">
                {STRATEGY_LABEL[strategy]}
                {strategy === conflict.suggestedStrategy && (
                  <Badge variant="outline" className="px-1.5 py-0 text-[10px] leading-4">
                    Recommended
                  </Badge>
                )}
              </span>
              <span className="text-xs text-muted-foreground">{STRATEGY_HINT[strategy]}</span>
            </Label>
          </div>
        ))}
      </RadioGroup>
    </div>
  )
}
