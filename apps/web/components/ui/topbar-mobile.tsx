// @figma https://www.figma.com/design/jcjT53BBQ4wx94XwpbEZXl?node-id=3057-11598
'use client'

import * as React from 'react'
import Image from 'next/image'
import { ChevronLeft } from 'lucide-react'

import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { useBrandLogotypes } from '@/lib/client/hooks/use-brand'

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
    const { logotype } = useBrandLogotypes()
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
          <div className="flex items-center">
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

          <span className="text-base font-semibold text-foreground absolute left-1/2 -translate-x-1/2">
            {title}
          </span>

          <div className="flex items-center min-w-[71px] justify-end">
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
            <Image
              src={logotype}
              alt="LaWallet"
              width={100}
              height={24}
              unoptimized
              className="h-6 w-auto"
            />
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
