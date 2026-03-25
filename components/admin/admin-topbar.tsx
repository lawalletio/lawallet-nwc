'use client'

import React from 'react'
import { useIsMobile } from '@/components/ui/use-mobile'
import { Topbar, type TopbarAlert, type TopbarTab } from '@/components/ui/topbar'
import { TopbarMobile } from '@/components/ui/topbar-mobile'
import { SidebarTrigger } from '@/components/ui/sidebar'

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
    return (
      <div className="flex flex-col">
        {type === 'page' && (
          <div className="flex items-center px-2 pt-2">
            <SidebarTrigger />
          </div>
        )}
        <TopbarMobile
          type={type}
          title={title}
          onBack={onBack}
          rightAction={actions}
        />
      </div>
    )
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
