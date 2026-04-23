'use client'

import React from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  Home,
  Users,
  CreditCard,
  Activity,
  Settings,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuth } from '@/components/admin/auth-context'
import { Permission } from '@/lib/auth/permissions'

interface Tab {
  title: string
  href: string
  icon: React.ComponentType<{ className?: string }>
  permission?: Permission
}

const tabs: Tab[] = [
  { title: 'Home', href: '/admin', icon: Home },
  { title: 'Users', href: '/admin/users', icon: Users, permission: Permission.ADDRESSES_READ },
  { title: 'Cards', href: '/admin/cards', icon: CreditCard, permission: Permission.CARDS_READ },
  { title: 'Activity', href: '/admin/activity', icon: Activity, permission: Permission.SETTINGS_READ },
  { title: 'Settings', href: '/admin/settings', icon: Settings, permission: Permission.SETTINGS_READ },
]

export function MobileTabBar() {
  const pathname = usePathname()
  const { isAuthorized } = useAuth()

  function isActive(href: string): boolean {
    if (href === '/admin') return pathname === '/admin'
    return pathname.startsWith(href)
  }

  const visibleTabs = tabs.filter(tab => !tab.permission || isAuthorized(tab.permission))

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 border-t border-border bg-background md:hidden">
      <div className="flex items-center justify-around h-14">
        {visibleTabs.map((tab) => {
          const active = isActive(tab.href)
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={cn(
                'flex flex-col items-center justify-center gap-0.5 flex-1 h-full text-xs transition-colors',
                active
                  ? 'text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <tab.icon className="size-5" />
              <span>{tab.title}</span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
