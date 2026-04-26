'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Home, Activity, Settings } from 'lucide-react'
import { cn } from '@/lib/utils'

interface TabItem {
  href: string
  label: string
  icon: typeof Home
  /** When true, only an exact path match counts as active. */
  exact?: boolean
}

const ITEMS: readonly TabItem[] = [
  { href: '/wallet', label: 'Home', icon: Home, exact: true },
  { href: '/wallet/activity', label: 'Activity', icon: Activity },
  { href: '/wallet/settings', label: 'Settings', icon: Settings },
]

export function NavTabbar() {
  const pathname = usePathname() ?? ''

  return (
    <nav
      aria-label="Wallet navigation"
      className="sticky bottom-0 z-20 mt-auto flex border-t border-border/60 bg-background/80 backdrop-blur-xl pb-[env(safe-area-inset-bottom)]"
    >
      {ITEMS.map(item => {
        const Icon = item.icon
        const active = item.exact
          ? pathname === item.href
          : pathname === item.href || pathname.startsWith(item.href + '/')
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex flex-1 flex-col items-center gap-1 py-3 text-xs font-medium transition-colors',
              active
                ? 'text-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Icon
              className={cn('size-5', active && 'stroke-[2.5]')}
            />
            {item.label}
          </Link>
        )
      })}
    </nav>
  )
}
