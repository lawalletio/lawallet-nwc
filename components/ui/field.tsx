// @figma https://www.figma.com/design/jcjT53BBQ4wx94XwpbEZXl?node-id=3030-3680
import * as React from 'react'

import { cn } from '@/lib/utils'
import { Label } from '@/components/ui/label'

const Field = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn('flex flex-col gap-2', className)}
    {...props}
  />
))
Field.displayName = 'Field'

const FieldLabel = React.forwardRef<
  React.ElementRef<typeof Label>,
  React.ComponentPropsWithoutRef<typeof Label>
>(({ className, ...props }, ref) => (
  <Label
    ref={ref}
    className={cn('text-sm text-foreground', className)}
    {...props}
  />
))
FieldLabel.displayName = 'FieldLabel'

const FieldDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p
    ref={ref}
    className={cn('text-sm text-muted-foreground', className)}
    {...props}
  />
))
FieldDescription.displayName = 'FieldDescription'

const FieldError = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p
    ref={ref}
    className={cn('text-sm text-destructive', className)}
    {...props}
  />
))
FieldError.displayName = 'FieldError'

const Fieldset = React.forwardRef<
  HTMLFieldSetElement,
  React.FieldsetHTMLAttributes<HTMLFieldSetElement>
>(({ className, ...props }, ref) => (
  <fieldset
    ref={ref}
    role="group"
    className={cn('flex flex-col gap-6', className)}
    {...props}
  />
))
Fieldset.displayName = 'Fieldset'

const FieldsetLegend = React.forwardRef<
  HTMLLegendElement,
  React.HTMLAttributes<HTMLLegendElement>
>(({ className, ...props }, ref) => (
  <legend
    ref={ref}
    className={cn('text-base font-medium text-foreground', className)}
    {...props}
  />
))
FieldsetLegend.displayName = 'FieldsetLegend'

const FieldsetDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p
    ref={ref}
    className={cn('text-sm text-muted-foreground', className)}
    {...props}
  />
))
FieldsetDescription.displayName = 'FieldsetDescription'

export {
  Field,
  FieldLabel,
  FieldDescription,
  FieldError,
  Fieldset,
  FieldsetLegend,
  FieldsetDescription,
}
