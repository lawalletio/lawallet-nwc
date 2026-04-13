// @figma https://www.figma.com/design/jcjT53BBQ4wx94XwpbEZXl?node-id=3030-895
import * as React from 'react'

import { cn } from '@/lib/utils'

export interface ButtonGroupProps extends React.HTMLAttributes<HTMLDivElement> {
  orientation?: 'horizontal' | 'vertical'
}

const ButtonGroup = React.forwardRef<HTMLDivElement, ButtonGroupProps>(
  ({ className, orientation = 'horizontal', ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(
          orientation === 'horizontal'
            ? 'flex [&>*:not(:first-child)]:rounded-l-none [&>*:not(:last-child)]:rounded-r-none [&>*:not(:last-child)]:border-r-0'
            : 'flex flex-col [&>*:not(:first-child)]:rounded-t-none [&>*:not(:last-child)]:rounded-b-none [&>*:not(:last-child)]:border-b-0',
          className
        )}
        {...props}
      />
    )
  }
)
ButtonGroup.displayName = 'ButtonGroup'

export { ButtonGroup }
