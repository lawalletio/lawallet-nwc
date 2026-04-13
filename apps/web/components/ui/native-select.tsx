// @figma https://www.figma.com/design/jcjT53BBQ4wx94XwpbEZXl?node-id=3030-4549
import * as React from 'react'
import { ChevronDown } from 'lucide-react'

import { cn } from '@/lib/utils'

export interface NativeSelectProps
  extends React.SelectHTMLAttributes<HTMLSelectElement> {
  error?: boolean
  placeholder?: string
}

const NativeSelect = React.forwardRef<HTMLSelectElement, NativeSelectProps>(
  ({ className, error, children, placeholder, ...props }, ref) => {
    return (
      <div className="relative">
        <select
          ref={ref}
          className={cn(
            'appearance-none h-9 w-full bg-background border border-border rounded-md pl-3 pr-9 py-2 text-sm text-foreground shadow-xs focus:border-ring focus:ring-[3px] focus:ring-ring/50 disabled:opacity-50 disabled:cursor-not-allowed',
            error && 'border-destructive focus:ring-destructive/20',
            className
          )}
          {...props}
        >
          {placeholder && (
            <option value="" disabled hidden>
              {placeholder}
            </option>
          )}
          {children}
        </select>
        <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
      </div>
    )
  }
)
NativeSelect.displayName = 'NativeSelect'

export { NativeSelect }
