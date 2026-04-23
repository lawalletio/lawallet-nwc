// @figma https://www.figma.com/design/jcjT53BBQ4wx94XwpbEZXl?node-id=3057-11598
'use client'

import * as React from 'react'
import { ChevronLeft } from 'lucide-react'

import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { BrandLogotype } from '@/components/ui/brand-logotype'

interface TopbarMobileProps extends React.HTMLAttributes<HTMLDivElement> {
  type?: 'page' | 'subpage'
  title?: string
  onBack?: () => void
  avatar?: string
  logo?: React.ReactNode
  rightAction?: React.ReactNode
}

const TopbarMobile = React.forwardRef<HTMLDivElement, TopbarMobileProps>(
  (
    {
      className,
      type = 'page',
      title,
      onBack,
      avatar,
      logo,
      rightAction,
      ...props
    },
    ref
  ) => {
    if (type === 'subpage') {
      return (
        <div
          ref={ref}
          className={cn(
            'flex items-center justify-between px-4 py-2 h-[60px] bg-sidebar',
            className
          )}
          {...props}
        >
          <div className="flex items-center shrink-0">
            <Button
              variant="secondary"
              size="sm"
              onClick={onBack}
              className="gap-1"
            >
              <ChevronLeft className="size-4" />
              <span>Back</span>
            </Button>
          </div>

          {/* Title is right-aligned between the Back button and the
              right-action slot. The font-size scales fluidly with the
              viewport so long lightning addresses shrink instead of
              overflowing; `truncate` is the last-resort safety net. */}
          <span
            className="min-w-0 flex-1 truncate pl-3 text-right font-semibold text-foreground text-[clamp(0.75rem,3.2vw,1rem)]"
            title={title}
          >
            {title}
          </span>

          <div className="flex items-center shrink-0 justify-end">
            {rightAction}
          </div>
        </div>
      )
    }

    return (
      <div
        ref={ref}
        className={cn(
          'flex items-center justify-between px-4 py-2 h-[60px] bg-sidebar',
          className
        )}
        {...props}
      >
        <div className="flex items-center">
          {avatar ? (
            <img
              src={avatar}
              alt="Avatar"
              className="size-9 rounded-full object-cover"
            />
          ) : (
            <div className="size-9 rounded-full bg-muted" />
          )}
        </div>

        <div className="flex items-center justify-center">
          {logo ?? (
            <BrandLogotype width={100} height={24} className="h-6 w-auto" />
          )}
        </div>

        <div className="flex items-center min-w-[36px] justify-end">
          {rightAction}
        </div>
      </div>
    )
  }
)
TopbarMobile.displayName = 'TopbarMobile'

export { TopbarMobile }
export type { TopbarMobileProps }
