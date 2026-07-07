'use client'

import { Checkbox } from '@/components/ui/checkbox'
import { BACKUP_CATEGORIES, type BackupCategory } from '@/lib/client/backup-types'
import { cn } from '@/lib/utils'

/** Checklist of export categories with staggered entrance. */
export function CategorySelector({
  selected,
  onToggle,
  disabled = false,
}: {
  selected: Set<BackupCategory>
  onToggle: (key: BackupCategory, on: boolean) => void
  disabled?: boolean
}) {
  return (
    <div className="space-y-3">
      {BACKUP_CATEGORIES.map((category, index) => {
        const checked = selected.has(category.key)
        return (
          <label
            key={category.key}
            htmlFor={`cat-${category.key}`}
            className={cn(
              'flex cursor-pointer items-start gap-3 rounded-lg border p-4 transition-colors animate-in fade-in slide-in-from-bottom-2 duration-300 motion-reduce:animate-none',
              checked ? 'border-primary/50 bg-primary/5' : 'hover:bg-muted/50',
              disabled && 'cursor-not-allowed opacity-60',
            )}
            style={{ animationDelay: `${index * 40}ms` }}
          >
            <Checkbox
              id={`cat-${category.key}`}
              checked={checked}
              disabled={disabled}
              onCheckedChange={value => onToggle(category.key, value === true)}
              className="mt-0.5"
            />
            <div className="space-y-0.5">
              <p className="text-sm font-medium leading-none">{category.label}</p>
              <p className="text-xs text-muted-foreground">{category.description}</p>
            </div>
          </label>
        )
      })}
    </div>
  )
}
