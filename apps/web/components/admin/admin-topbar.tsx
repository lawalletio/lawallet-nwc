'use client'

import React from 'react'
import { Menu } from 'lucide-react'
import { useIsMobile } from '@/components/ui/use-mobile'
import {
  Topbar,
  TabBadge,
  type TopbarAlert,
  type TopbarTab,
} from '@/components/ui/topbar'
import { TopbarMobile } from '@/components/ui/topbar-mobile'
import { useSidebar } from '@/components/ui/sidebar'
import { BrandLogotype } from '@/components/ui/brand-logotype'
import { cn } from '@/lib/utils'

interface AdminTopbarProps {
  /**
   * Page title. Optional so chromeless pages (e.g. the user detail card
   * that already leads with the user's name) can keep the topbar's
   * brand + menu + actions while skipping the redundant heading.
   */
  title?: string
  subtitle?: string
  actions?: React.ReactNode
  type?: 'page' | 'subpage'
  onBack?: () => void
  alert?: TopbarAlert
  tabs?: TopbarTab[]
}

export function AdminTopbar({
  title,
  subtitle,
  actions,
  type = 'page',
  onBack,
  alert,
  tabs,
}: AdminTopbarProps) {
  const isMobile = useIsMobile()

  if (isMobile) {
    if (type === 'subpage') {
      return (
        <TopbarMobile
          type="subpage"
          title={title}
          onBack={onBack}
          rightAction={actions}
        />
      )
    }

    return <MobilePageTopbar title={title} subtitle={subtitle} actions={actions} tabs={tabs} />
  }

  // Desktop: drop a "chromeless" bar — one with no title, subtitle, tabs, or
  // alert (at most a lone action like a Back button). The sidebar already
  // provides navigation, so an otherwise-empty bar is just a border + wasted
  // height. Titled / tabbed / alerting pages keep their topbar. Mobile is
  // unaffected: its bar carries the logo + hamburger nav.
  const isChromeless = !title && !subtitle && (!tabs || tabs.length === 0) && !alert
  if (isChromeless) return null

  return (
    <Topbar
      title={title}
      subtitle={subtitle}
      type={type}
      actions={actions}
      alert={alert}
      tabs={tabs}
    />
  )
}

function MobilePageTopbar({
  title,
  subtitle,
  actions,
  tabs,
}: {
  title?: string
  subtitle?: string
  actions?: React.ReactNode
  tabs?: TopbarTab[]
}) {
  const { setOpenMobile } = useSidebar()

  return (
    <div className="flex flex-col">
      {/* Logo bar: logo left + hamburger right */}
      <div className="flex items-center justify-between px-4 sm:px-6 h-[56px]">
        <BrandLogotype width={100} height={24} className="h-6 w-auto" />
        <button
          onClick={() => setOpenMobile(true)}
          className="flex size-9 items-center justify-center rounded-md text-muted-foreground hover:text-foreground"
        >
          <Menu className="size-5" />
        </button>
      </div>

      {/* Page header: title + subtitle stacked above the actions. On mobile
          the actions cluster (which can be several buttons wide) gets its own
          row below the title so it never crowds or overlaps the heading;
          `flex-wrap` lets the buttons wrap on narrow screens. */}
      {(title || subtitle || actions) && (
        <div className="flex flex-col gap-3 px-4 sm:px-6 py-3">
          <div className="flex min-w-0 flex-col gap-0.5">
            {title && <h1 className="text-base font-semibold">{title}</h1>}
            {subtitle && (
              <p className="text-sm text-muted-foreground">{subtitle}</p>
            )}
          </div>
          {actions && (
            <div className="-mx-4 sm:-mx-6 flex items-center gap-2 overflow-x-auto px-4 sm:px-6 [&>*]:shrink-0">
              {actions}
            </div>
          )}
        </div>
      )}

      {/* Tabs */}
      {tabs && tabs.length > 0 && (
        <div className="flex items-center gap-1 px-4 sm:px-6 py-1 border-b border-border overflow-x-auto">
          {tabs.map((tab) => (
            <button
              key={tab.label}
              onClick={tab.onClick}
              className={cn(
                'inline-flex items-center gap-1.5 px-3 py-1.5 text-sm whitespace-nowrap rounded-md transition-colors',
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
}
