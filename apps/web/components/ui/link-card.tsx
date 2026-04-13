// @figma https://www.figma.com/design/jcjT53BBQ4wx94XwpbEZXl?node-id=1201-1030
import * as React from 'react'
import Link from 'next/link'
import { cva, type VariantProps } from 'class-variance-authority'
import { ChevronRight, ExternalLink } from 'lucide-react'

import { cn } from '@/lib/utils'

const linkCardVariants = cva(
  'flex items-center justify-between p-4 gap-4 rounded-md transition-colors hover:bg-accent',
  {
    variants: {
      type: {
        default: '',
        outline: 'border border-border'
      }
    },
    defaultVariants: {
      type: 'default'
    }
  }
)

export interface LinkCardProps
  extends Omit<
      React.AnchorHTMLAttributes<HTMLAnchorElement>,
      'type' | 'title'
    >,
    VariantProps<typeof linkCardVariants> {
  href: string
  title?: React.ReactNode
  description?: React.ReactNode
}

const LinkCard = React.forwardRef<HTMLAnchorElement, LinkCardProps>(
  ({ className, href, type, title, description, children, ...props }, ref) => {
    const Icon = type === 'outline' ? ExternalLink : ChevronRight

    return (
      <Link
        ref={ref}
        href={href}
        className={cn(linkCardVariants({ type }), className)}
        {...props}
      >
        <div className="flex flex-col gap-1 min-w-0">
          {children ?? (
            <>
              {title && <LinkCardTitle>{title}</LinkCardTitle>}
              {description && (
                <LinkCardDescription>{description}</LinkCardDescription>
              )}
            </>
          )}
        </div>
        <Icon className="size-4 shrink-0 text-muted-foreground" />
      </Link>
    )
  }
)
LinkCard.displayName = 'LinkCard'

function LinkCardTitle({
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn('text-sm text-foreground', className)}
      {...props}
    />
  )
}
LinkCardTitle.displayName = 'LinkCardTitle'

function LinkCardDescription({
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn('text-sm text-muted-foreground', className)}
      {...props}
    />
  )
}
LinkCardDescription.displayName = 'LinkCardDescription'

export { LinkCard, LinkCardTitle, LinkCardDescription, linkCardVariants }
