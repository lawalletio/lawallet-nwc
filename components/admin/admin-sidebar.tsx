'use client'

import React from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard,
  CreditCard,
  Zap,
  Palette,
  Settings,
  LogOut,
} from 'lucide-react'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
} from '@/components/ui/sidebar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Permission } from '@/lib/auth/permissions'
import { useAuth } from '@/components/admin/auth-context'
import { truncateNpub } from '@/lib/client/format'

interface NavItem {
  title: string
  href: string
  icon: React.ComponentType<{ className?: string }>
  permission?: Permission
}

const platformItems: NavItem[] = [
  {
    title: 'Dashboard',
    href: '/admin',
    icon: LayoutDashboard,
  },
  {
    title: 'Cards',
    href: '/admin/cards',
    icon: CreditCard,
    permission: Permission.CARDS_READ,
  },
  {
    title: 'Addresses',
    href: '/admin/addresses',
    icon: Zap,
    permission: Permission.ADDRESSES_READ,
  },
  {
    title: 'Designs',
    href: '/admin/designs',
    icon: Palette,
    permission: Permission.CARD_DESIGNS_READ,
  },
]

const systemItems: NavItem[] = [
  {
    title: 'Settings',
    href: '/admin/settings',
    icon: Settings,
    permission: Permission.SETTINGS_READ,
  },
]

export function AdminSidebar() {
  const pathname = usePathname()
  const { pubkey, role, logout, isAuthorized } = useAuth()

  function isActive(href: string): boolean {
    if (href === '/admin') return pathname === '/admin'
    return pathname.startsWith(href)
  }

  function filterByPermission(items: NavItem[]): NavItem[] {
    return items.filter((item) => !item.permission || isAuthorized(item.permission))
  }

  const visiblePlatform = filterByPermission(platformItems)
  const visibleSystem = filterByPermission(systemItems)

  return (
    <Sidebar>
      <SidebarHeader className="p-4">
        <Link href="/admin" className="flex items-center gap-2">
          <div className="flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground text-sm font-bold">
            LW
          </div>
          <span className="text-sm font-semibold">LaWallet Admin</span>
        </Link>
      </SidebarHeader>

      <SidebarContent>
        {visiblePlatform.length > 0 && (
          <SidebarGroup>
            <SidebarGroupLabel>Platform</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {visiblePlatform.map((item) => (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton asChild isActive={isActive(item.href)}>
                      <Link href={item.href}>
                        <item.icon className="size-4" />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {visibleSystem.length > 0 && (
          <>
            <SidebarSeparator />
            <SidebarGroup>
              <SidebarGroupLabel>System</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {visibleSystem.map((item) => (
                    <SidebarMenuItem key={item.href}>
                      <SidebarMenuButton asChild isActive={isActive(item.href)}>
                        <Link href={item.href}>
                          <item.icon className="size-4" />
                          <span>{item.title}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </>
        )}
      </SidebarContent>

      <SidebarFooter className="p-4">
        <SidebarSeparator className="mb-4" />
        <div className="flex items-center justify-between gap-2">
          <div className="flex flex-col gap-1 min-w-0">
            <span className="text-sm font-medium truncate">
              {pubkey ? truncateNpub(pubkey) : 'Unknown'}
            </span>
            {role && (
              <Badge
                variant={role === 'ADMIN' ? 'default' : 'secondary'}
                className="w-fit text-xs"
              >
                {role}
              </Badge>
            )}
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={logout}
            className="shrink-0"
            title="Sign out"
          >
            <LogOut className="size-4" />
          </Button>
        </div>
      </SidebarFooter>
    </Sidebar>
  )
}
