// @figma https://www.figma.com/design/jcjT53BBQ4wx94XwpbEZXl?node-id=3030-4363
import * as React from 'react'

import { cn } from '@/lib/utils'

export interface KbdProps extends React.HTMLAttributes<HTMLElement> {}

const Kbd = React.forwardRef<HTMLElement, KbdProps>(
  ({ className, ...props }, ref) => {
    return (
      <kbd
        ref={ref}
        className={cn(
          'inline-flex items-center justify-center h-5 min-w-5 px-1 rounded-sm bg-muted text-muted-foreground text-xs font-normal border border-border shadow-xs',
          className
        )}
        {...props}
      />
    )
  }
)
Kbd.displayName = 'Kbd'

export { Kbd }
