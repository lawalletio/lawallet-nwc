'use client'

import React from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import {
  Home,
  Users,
  CreditCard,
  AtSign,
  Activity,
  Settings,
  HelpCircle,
  MoreVertical,
  Copy,
  LogOut,
  ChevronRight,
  ExternalLink,
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
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarSeparator,
  useSidebar,
} from '@/components/ui/sidebar'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Permission, Role } from '@/lib/auth/permissions'
import { useAuth } from '@/components/admin/auth-context'
import { useNostrProfile } from '@/lib/client/nostr-profile'
import { useSettings } from '@/lib/client/hooks/use-settings'
import { BrandLogotype } from '@/components/ui/brand-logotype'
import { truncateNpub } from '@/lib/client/format'
import { toast } from 'sonner'

interface NavItem {
  title: string
  href: string
  icon: React.ComponentType<{ className?: string }>
  permission?: Permission
}

const platformItems: NavItem[] = [
  {
    title: 'Home',
    href: '/admin',
    icon: Home,
  },
  {
    title: 'Users',
    href: '/admin/users',
    icon: Users,
    permission: Permission.ADDRESSES_READ,
  },
  {
    title: 'Cards',
    href: '/admin/cards',
    icon: CreditCard,
    permission: Permission.CARDS_READ,
  },
  // Addresses is shown to every authenticated user — no `permission` set.
  // The page itself is per-user (driven by the caller's pubkey via
  // /api/wallet/addresses), so even plain USERs see their own rows here.
  {
    title: 'Addresses',
    href: '/admin/addresses',
    icon: AtSign,
  },
]

const systemItems: NavItem[] = [
  {
    title: 'Activity',
    href: '/admin/activity',
    icon: Activity,
    permission: Permission.SETTINGS_READ,
  },
]

const settingsSubItems = [
  { title: 'Wallet', tab: 'wallet' },
  { title: 'Branding', tab: 'branding' },
  { title: 'Infrastructure', tab: 'infrastructure' },
]

export function AdminSidebar() {
  const pathname = usePathname()
  const router = useRouter()
  const { pubkey, role, loginMethod, logout, isAuthorized } = useAuth()
  const { profile } = useNostrProfile(pubkey)
  const { data: settings } = useSettings()
  const { isMobile, setOpenMobile } = useSidebar()
  const [settingsOpen, setSettingsOpen] = React.useState(
    pathname.startsWith('/admin/settings')
  )

  // Close the mobile drawer after navigation
  function closeMobile() {
    if (isMobile) setOpenMobile(false)
  }

  function isActive(href: string): boolean {
    if (href === '/admin') return pathname === '/admin'
    return pathname.startsWith(href)
  }

  function filterByPermission(items: NavItem[]): NavItem[] {
    return items.filter((item) => !item.permission || isAuthorized(item.permission))
  }

  function copyPubkey() {
    if (pubkey) {
      navigator.clipboard.writeText(pubkey)
      toast.success('Public key copied')
    }
  }

  const visiblePlatform = filterByPermission(platformItems)
  const visibleSystem = filterByPermission(systemItems)
  // Settings is ADMIN-only. VIEWER has SETTINGS_READ for API reads (public
  // settings hydrate branding for all authed users) but must not see the
  // settings UI in the nav.
  const showSettings = role === Role.ADMIN
  const needsDomainSetup = role === Role.ADMIN && !settings?.domain

  const loginMethodLabel = loginMethod === 'extension'
    ? 'Extension'
    : loginMethod === 'nsec'
    ? 'Private key'
    : loginMethod === 'bunker'
    ? 'Bunker'
    : ''

  const displayName = profile?.displayName || profile?.name || (pubkey ? truncateNpub(pubkey) : 'Unknown')
  const avatarFallback = (profile?.name?.[0] || pubkey?.slice(0, 2) || '??').toUpperCase()

  return (
    <Sidebar>
      <SidebarHeader className="p-4">
        <Link href="/admin" className="flex items-center gap-2" onClick={closeMobile}>
          <BrandLogotype width={100} height={24} className="h-6 w-auto" />
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
                      <Link href={item.href} onClick={closeMobile}>
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

        {(visibleSystem.length > 0 || showSettings) && (
          <>
            <SidebarSeparator />
            <SidebarGroup>
              <SidebarGroupLabel>System</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {visibleSystem.map((item) => (
                    <SidebarMenuItem key={item.href}>
                      <SidebarMenuButton asChild isActive={isActive(item.href)}>
                        <Link href={item.href} onClick={closeMobile}>
                          <item.icon className="size-4" />
                          <span>{item.title}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}

                  {showSettings && (
                    <Collapsible
                      open={settingsOpen}
                      onOpenChange={setSettingsOpen}
                      asChild
                    >
                      <SidebarMenuItem>
                        <CollapsibleTrigger asChild>
                          <SidebarMenuButton
                            isActive={isActive('/admin/settings')}
                            onClick={() => {
                              if (!settingsOpen) {
                                router.push('/admin/settings')
                                closeMobile()
                              }
                            }}
                          >
                            <Settings className="size-4" />
                            <span>Settings</span>
                            <ChevronRight className="ml-auto size-4 transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
                          </SidebarMenuButton>
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                          <SidebarMenuSub>
                            {settingsSubItems.map((sub) => (
                              <SidebarMenuSubItem key={sub.tab}>
                                <SidebarMenuSubButton
                                  asChild
                                  isActive={
                                    pathname === '/admin/settings' &&
                                    typeof window !== 'undefined' &&
                                    new URLSearchParams(window.location.search).get('tab') === sub.tab
                                  }
                                >
                                  <Link
                                    href={`/admin/settings?tab=${sub.tab}`}
                                    onClick={closeMobile}
                                  >
                                    {sub.title}
                                  </Link>
                                </SidebarMenuSubButton>
                              </SidebarMenuSubItem>
                            ))}
                          </SidebarMenuSub>
                        </CollapsibleContent>
                      </SidebarMenuItem>
                    </Collapsible>
                  )}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </>
        )}
      </SidebarContent>

      <SidebarFooter className="p-4 space-y-3">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild>
              <a href="https://docs.lawallet.io" target="_blank" rel="noopener noreferrer">
                <HelpCircle className="size-4" />
                <span>Get Help</span>
                <ExternalLink className="ml-auto size-3 text-muted-foreground" />
              </a>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>

        <SidebarSeparator />

        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Avatar className="size-8 shrink-0">
              {profile?.picture && <AvatarImage src={profile.picture} alt={displayName} />}
              <AvatarFallback className="text-xs">{avatarFallback}</AvatarFallback>
            </Avatar>
            <div className="flex flex-col min-w-0">
              <span className="text-sm font-medium truncate">
                {displayName}
              </span>
              {loginMethodLabel && (
                <span className="text-xs text-muted-foreground">{loginMethodLabel}</span>
              )}
            </div>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="shrink-0 size-8">
                <MoreVertical className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" side="top">
              <DropdownMenuItem onClick={copyPubkey}>
                <Copy className="size-4 mr-2" />
                Copy public key
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={logout}>
                <LogOut className="size-4 mr-2" />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {needsDomainSetup && (
          <Card className="bg-sidebar-accent border-sidebar-border">
            <CardContent className="p-4 space-y-2">
              <p className="text-sm font-semibold">Setup Domain</p>
              <p className="text-xs text-muted-foreground line-clamp-2">
                Configure your domain to enable Lightning Addresses and wallet features.
              </p>
              <Button
                variant="theme"
                size="sm"
                className="w-full"
                onClick={() => {
                  router.push('/admin/settings?tab=infrastructure')
                  closeMobile()
                }}
              >
                Configure now
                <ExternalLink className="ml-1 size-3" />
              </Button>
            </CardContent>
          </Card>
        )}
      </SidebarFooter>
    </Sidebar>
  )
}
