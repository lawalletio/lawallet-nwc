// @figma https://www.figma.com/design/jcjT53BBQ4wx94XwpbEZXl?node-id=3030-5621
import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { Loader2 } from 'lucide-react'

import { cn } from '@/lib/utils'

const spinnerVariants = cva('animate-spin', {
  variants: {
    size: {
      12: 'size-3',
      16: 'size-4',
      24: 'size-6',
      32: 'size-8'
    },
    color: {
      default: 'text-foreground',
      red: 'text-red-500',
      green: 'text-green-500',
      blue: 'text-blue-500',
      yellow: 'text-yellow-500'
    }
  },
  defaultVariants: {
    size: 24,
    color: 'default'
  }
})

export interface SpinnerProps
  extends Omit<React.SVGAttributes<SVGSVGElement>, 'color'>,
    VariantProps<typeof spinnerVariants> {}

const Spinner = React.forwardRef<SVGSVGElement, SpinnerProps>(
  ({ className, size, color, ...props }, ref) => {
    return (
      <Loader2
        ref={ref}
        className={cn(spinnerVariants({ size, color }), className)}
        {...props}
      />
    )
  }
)
Spinner.displayName = 'Spinner'

export { Spinner, spinnerVariants }
