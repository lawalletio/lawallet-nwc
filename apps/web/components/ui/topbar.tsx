// @figma https://www.figma.com/design/jcjT53BBQ4wx94XwpbEZXl?node-id=3194-5154
import * as React from 'react'

import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'

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
  /** Optional live count shown as a badge on the right of the tab. */
  badge?: number
}

/** Live-count badge rendered inside a topbar tab (green = live/connected). */
function TabBadge({ count }: { count: number }) {
  return (
    <Badge
      variant="outline"
      className="border-transparent bg-green-500/15 px-1.5 py-0 text-xs font-semibold tabular-nums text-green-600"
    >
      {count}
    </Badge>
  )
}

interface TopbarProps extends React.HTMLAttributes<HTMLDivElement> {
  /**
   * Optional so pages that already lead with their own heading (e.g. a
   * full-bleed user profile card) can render the chrome without a
   * redundant title above.
   */
  title?: string
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
        <div className="bg-destructive text-destructive-foreground px-4 sm:px-6 py-2 flex items-center justify-between">
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

      <div className="flex items-center justify-between px-4 sm:px-6 py-2 min-h-[60px] border-b border-border">
        <div className="flex flex-col">
          {title && (
            <span className="text-base font-semibold text-foreground">
              {title}
            </span>
          )}
          {subtitle && (
            <span className="text-sm text-muted-foreground">{subtitle}</span>
          )}
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>

      {tabs && tabs.length > 0 && (
        <div className="flex items-center justify-center gap-4 px-4 sm:px-6 py-2 bg-accent border-b border-border">
          {tabs.map((tab) => (
            <button
              key={tab.label}
              onClick={tab.onClick}
              className={cn(
                'inline-flex items-center gap-1.5 px-4 py-3 text-sm font-semibold rounded-md transition-colors shadow-sm',
                tab.active
                  ? 'bg-secondary text-secondary-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {tab.label}
              {typeof tab.badge === 'number' && <TabBadge count={tab.badge} />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
)
Topbar.displayName = 'Topbar'

export { Topbar, TabBadge }
export type { TopbarProps, TopbarAlert, TopbarTab }
