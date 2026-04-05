// @figma https://www.figma.com/design/jcjT53BBQ4wx94XwpbEZXl?node-id=3030-3878
import * as React from 'react'

import { cn } from '@/lib/utils'

const InputGroup = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      'flex items-center border border-border bg-background rounded-lg shadow-xs overflow-hidden focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-background',
      className
    )}
    {...props}
  />
))
InputGroup.displayName = 'InputGroup'

const InputGroupPrefix = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      'flex items-center self-stretch pl-3 text-muted-foreground [&>svg]:size-4',
      className
    )}
    {...props}
  />
))
InputGroupPrefix.displayName = 'InputGroupPrefix'

const InputGroupSuffix = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      'flex items-center self-stretch pr-3 text-muted-foreground [&>svg]:size-4',
      className
    )}
    {...props}
  />
))
InputGroupSuffix.displayName = 'InputGroupSuffix'

interface InputGroupTextProps extends React.HTMLAttributes<HTMLDivElement> {
  position?: 'prefix' | 'suffix'
}

const InputGroupText = React.forwardRef<HTMLDivElement, InputGroupTextProps>(
  ({ className, position = 'prefix', ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'flex items-center self-stretch px-3 text-sm text-muted-foreground bg-muted',
        position === 'prefix' ? 'border-r border-border' : 'border-l border-border',
        className
      )}
      {...props}
    />
  )
)
InputGroupText.displayName = 'InputGroupText'

export { InputGroup, InputGroupPrefix, InputGroupSuffix, InputGroupText }
