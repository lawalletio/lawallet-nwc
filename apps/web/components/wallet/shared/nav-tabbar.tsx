'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Home, Settings, ScanLine } from 'lucide-react'
import { cn } from '@/lib/utils'

interface SideItem {
  href: string
  label: string
  icon: typeof Home
  exact?: boolean
}

const SIDE_ITEMS: readonly SideItem[] = [
  { href: '/wallet', label: 'Home', icon: Home, exact: true },
  { href: '/wallet/settings', label: 'Settings', icon: Settings },
]

/**
 * Floating actions bar fixed to the bottom of every wallet `(app)` page.
 * Mirrors Figma node `3057:12585`: a dark pill with Home / Scan / Settings,
 * with the center scan button raised as a light circle that overflows the
 * pill's top edge.
 */
export function NavTabbar() {
  const pathname = usePathname() ?? ''
  const home = SIDE_ITEMS[0]
  const settings = SIDE_ITEMS[1]

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 pb-[env(safe-area-inset-bottom)]">
      <div className="mx-auto flex w-full max-w-md justify-center px-6 pb-4 pt-12">
        <nav
          aria-label="Wallet actions"
          className="pointer-events-auto relative flex h-14 w-full max-w-[280px] items-center justify-between rounded-full border border-border/60 bg-card/90 px-4 backdrop-blur-xl shadow-2xl"
        >
          <SideButton item={home} pathname={pathname} />

          <Link
            href="/wallet/scan"
            aria-label="Scan QR"
            className="absolute left-1/2 -top-3 -translate-x-1/2 flex size-16 items-center justify-center rounded-full border border-[var(--theme-300)] bg-gradient-to-b from-[var(--theme-200)] to-[var(--theme-400)] text-foreground shadow-[inset_0_2px_2px_var(--theme-400)] shadow-xl transition-transform active:scale-95"
          >
            <ScanLine className="size-7" />
          </Link>

          <span className="size-12" aria-hidden />

          <SideButton item={settings} pathname={pathname} />
        </nav>
      </div>
    </div>
  )
}

function SideButton({
  item,
  pathname,
}: {
  item: SideItem
  pathname: string
}) {
  const Icon = item.icon
  const active = item.exact
    ? pathname === item.href
    : pathname === item.href || pathname.startsWith(item.href + '/')

  return (
    <Link
      href={item.href}
      aria-label={item.label}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex size-12 items-center justify-center rounded-full transition-colors',
        active
          ? 'text-foreground'
          : 'text-muted-foreground hover:text-foreground',
      )}
    >
      <Icon className={cn('size-6', active && 'stroke-[2.5]')} />
    </Link>
  )
}
