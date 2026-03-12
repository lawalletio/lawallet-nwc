// @figma https://www.figma.com/design/jcjT53BBQ4wx94XwpbEZXl?node-id=3194-5154
import * as React from 'react'

import { cn } from '@/lib/utils'

interface TopbarAlert {
  title: string
  message: string
  action?: string
  onAction?: () => void
}

interface TopbarTab {
  label: string
  active?: boolean
  onClick?: () => void
}

interface TopbarProps extends React.HTMLAttributes<HTMLDivElement> {
  title: string
  subtitle?: string
  type?: 'page' | 'subpage'
  alert?: TopbarAlert
  actions?: React.ReactNode
  tabs?: TopbarTab[]
}

const Topbar = React.forwardRef<HTMLDivElement, TopbarProps>(
  (
    { className, title, subtitle, type = 'page', alert, actions, tabs, ...props },
    ref
  ) => (
    <div ref={ref} className={cn('w-full', className)} {...props}>
      {alert && (
        <div className="bg-destructive text-destructive-foreground px-4 py-2 flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm">
            <span className="font-semibold">{alert.title}</span>
            <span>{alert.message}</span>
          </div>
          {alert.action && alert.onAction && (
            <button
              onClick={alert.onAction}
              className="text-sm font-medium underline underline-offset-4 hover:opacity-80"
            >
              {alert.action}
            </button>
          )}
        </div>
      )}

      <div className="flex items-center justify-between px-4 py-2 h-[60px] border-b border-border">
        <div className="flex flex-col">
          <span className="text-base font-semibold text-foreground">
            {title}
          </span>
          {subtitle && (
            <span className="text-sm text-muted-foreground">{subtitle}</span>
          )}
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>

      {type === 'subpage' && tabs && tabs.length > 0 && (
        <div className="flex items-center gap-1 px-4 py-1 bg-accent border-b border-border">
          {tabs.map((tab) => (
            <button
              key={tab.label}
              onClick={tab.onClick}
              className={cn(
                'px-3 py-1.5 text-sm rounded-md transition-colors',
                tab.active
                  ? 'bg-secondary text-secondary-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
)
Topbar.displayName = 'Topbar'

export { Topbar }
export type { TopbarProps, TopbarAlert, TopbarTab }
