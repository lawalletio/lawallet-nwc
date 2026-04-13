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

const tabs = [
  { title: 'Home', href: '/admin', icon: Home },
  { title: 'Users', href: '/admin/users', icon: Users },
  { title: 'Cards', href: '/admin/cards', icon: CreditCard },
  { title: 'Activity', href: '/admin/activity', icon: Activity },
  { title: 'Settings', href: '/admin/settings', icon: Settings },
]

export function MobileTabBar() {
  const pathname = usePathname()

  function isActive(href: string): boolean {
    if (href === '/admin') return pathname === '/admin'
    return pathname.startsWith(href)
  }

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 border-t border-border bg-background md:hidden">
      <div className="flex items-center justify-around h-14">
        {tabs.map((tab) => {
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
