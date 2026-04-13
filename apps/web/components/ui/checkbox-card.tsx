// @figma https://www.figma.com/design/jcjT53BBQ4wx94XwpbEZXl?node-id=511-817
'use client'

import * as React from 'react'

import { cn } from '@/lib/utils'
import { Checkbox } from '@/components/ui/checkbox'

export interface CheckboxCardProps
  extends Omit<React.HTMLAttributes<HTMLLabelElement>, 'title'> {
  checked?: boolean
  onCheckedChange?: (checked: boolean) => void
  title: React.ReactNode
  description?: React.ReactNode
  disabled?: boolean
}

const CheckboxCard = React.forwardRef<HTMLLabelElement, CheckboxCardProps>(
  (
    {
      className,
      checked,
      onCheckedChange,
      title,
      description,
      disabled,
      ...props
    },
    ref
  ) => {
    return (
      <label
        ref={ref}
        className={cn(
          'flex gap-3 items-start p-3 rounded-lg border cursor-pointer transition-colors',
          checked
            ? 'bg-accent border-primary'
            : 'bg-background border-border',
          disabled && 'opacity-50 cursor-not-allowed',
          className
        )}
        {...props}
      >
        <Checkbox
          checked={checked}
          onCheckedChange={onCheckedChange}
          disabled={disabled}
        />
        <div className="flex flex-col gap-1">
          <span className="text-sm text-foreground">{title}</span>
          {description && (
            <span className="text-sm text-muted-foreground">
              {description}
            </span>
          )}
        </div>
      </label>
    )
  }
)
CheckboxCard.displayName = 'CheckboxCard'

export { CheckboxCard }
