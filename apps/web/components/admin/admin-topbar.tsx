'use client'

import React from 'react'
import { Menu } from 'lucide-react'
import { useIsMobile } from '@/components/ui/use-mobile'
import { Topbar, type TopbarAlert, type TopbarTab } from '@/components/ui/topbar'
import { TopbarMobile } from '@/components/ui/topbar-mobile'
import { useSidebar } from '@/components/ui/sidebar'
import { BrandLogotype } from '@/components/ui/brand-logotype'
import { cn } from '@/lib/utils'

interface AdminTopbarProps {
  title: string
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
  title: string
  subtitle?: string
  actions?: React.ReactNode
  tabs?: TopbarTab[]
}) {
  const { setOpenMobile } = useSidebar()

  return (
    <div className="flex flex-col">
      {/* Logo bar: logo left + hamburger right */}
      <div className="flex items-center justify-between px-4 h-[56px]">
        <BrandLogotype width={100} height={24} className="h-6 w-auto" />
        <button
          onClick={() => setOpenMobile(true)}
          className="flex size-9 items-center justify-center rounded-md text-muted-foreground hover:text-foreground"
        >
          <Menu className="size-5" />
        </button>
      </div>

      {/* Page header: title + subtitle + actions.
          `min-w-0` on the text column + `pr-4` guarantees long subtitles
          wrap *before* hitting the actions cluster on the right, which
          otherwise overlaps because `items-start` + `justify-between` lets
          the text flow full-width behind the absolutely-ish action chip. */}
      <div className="flex items-start justify-between gap-3 px-4 py-3">
        <div className="flex min-w-0 flex-col gap-0.5 pr-4">
          <h1 className="text-base font-semibold">{title}</h1>
          {subtitle && (
            <p className="text-sm text-muted-foreground">{subtitle}</p>
          )}
        </div>
        {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
      </div>

      {/* Tabs */}
      {tabs && tabs.length > 0 && (
        <div className="flex items-center gap-1 px-4 py-1 border-b border-border overflow-x-auto">
          {tabs.map((tab) => (
            <button
              key={tab.label}
              onClick={tab.onClick}
              className={cn(
                'px-3 py-1.5 text-sm whitespace-nowrap rounded-md transition-colors',
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
}
