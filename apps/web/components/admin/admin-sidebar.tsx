'use client'

import React, { Suspense } from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import {
  Home,
  Users,
  CreditCard,
  AtSign,
  Wallet,
  Network,
  Activity,
  RadioTower,
  Settings,
  ChevronLeft,
  Nfc,
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
import { usePlugins } from '@/lib/client/hooks/use-plugins'
import { pluginNavItems } from '@/plugins/client'
import { BrandLogotype } from '@/components/ui/brand-logotype'
import { truncateNpub, npubInitials, toNpub } from '@/lib/client/format'
import { toast } from 'sonner'
import packageJson from '../../package.json'

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
  // Cards is shown to every authenticated user — no `permission` set. The
  // page adapts: admins (CARDS_READ) get the instance-wide list, while a plain
  // USER sees only the cards paired to themselves (via /api/wallet/cards), with
  // no create action and no Designs section.
  {
    title: 'Cards',
    href: '/admin/cards',
    icon: CreditCard,
  },
  // Addresses is shown to every authenticated user — no `permission` set.
  // The page itself is per-user (driven by the caller's pubkey via
  // /api/wallet/addresses), so even plain USERs see their own rows here.
  {
    title: 'Addresses',
    href: '/admin/addresses',
    icon: AtSign,
  },
  // Remote Wallets is the connection abstraction Cards + Addresses bind
  // through. Same per-user scoping as Addresses — every authenticated user
  // sees their own wallets, no permission gate.
  {
    title: 'Remote Wallets',
    href: '/admin/remote-wallets',
    icon: Wallet,
  },
  // Connection Map — visual graph of address/card → wallet bindings.
  // Fully per-user now: every column (addresses, cards, wallets) shows only
  // what the logged-in account owns, even for admins.
  {
    title: 'Connections',
    href: '/admin/connections',
    icon: Network,
  },
]

const systemItems: NavItem[] = [
  {
    title: 'Activity',
    href: '/admin/activity',
    icon: Activity,
    permission: Permission.SETTINGS_READ,
  },
  {
    title: 'NWC Listener',
    href: '/admin/listener',
    icon: RadioTower,
    permission: Permission.SETTINGS_READ,
  },
]

const settingsSubItems = [
  { title: 'Infrastructure', tab: 'infrastructure' },
  { title: 'Branding', tab: 'branding' },
  { title: 'Wallet', tab: 'wallet' },
  { title: 'Device Tokens', tab: 'device-tokens' },
]

/** Default tab the settings page lands on when no `?tab=` is present. */
const DEFAULT_SETTINGS_TAB = 'infrastructure'
const APP_VERSION = packageJson.version

type VersionCheck = {
  currentVersion: string
  latestVersion: string | null
  releaseUrl: string
  updateAvailable: boolean
}

/**
 * The collapsible "Settings" nav item with its tab sub-items. Split out from
 * {@link AdminSidebar} so the `useSearchParams` read (needed to highlight the
 * sub-item matching the active tab) can live under its own Suspense boundary.
 * Reading the query reactively here is what keeps the highlight in sync when
 * the user switches tabs — `usePathname` alone never changes on `?tab=` edits.
 */
function SettingsNav({ disabled = false }: { disabled?: boolean }) {
  const pathname = usePathname()
  const router = useRouter()
  const searchParams = useSearchParams()
  const { isMobile, setOpenMobile } = useSidebar()
  const submenuRef = React.useRef<HTMLUListElement>(null)

  const onSettings = pathname === '/admin/settings'
  const activeTab = searchParams.get('tab') || DEFAULT_SETTINGS_TAB
  const [open, setOpen] = React.useState(pathname.startsWith('/admin/settings'))

  const handleOpenChange = React.useCallback((nextOpen: boolean) => {
    setOpen(nextOpen)

    if (!nextOpen) return

    requestAnimationFrame(() => {
      const submenu = submenuRef.current
      const content = submenu?.closest<HTMLElement>('[data-sidebar="content"]')
      if (!submenu || !content) return

      const contentRect = content.getBoundingClientRect()
      const submenuRect = submenu.getBoundingClientRect()
      const hiddenBottom = submenuRect.bottom - contentRect.bottom

      if (hiddenBottom > 0) {
        content.scrollTo({
          top: content.scrollTop + hiddenBottom + 12,
          behavior: 'smooth',
        })
      }
    })
  }, [])

  function closeMobile() {
    if (isMobile) setOpenMobile(false)
  }

  return (
    <Collapsible open={open} onOpenChange={handleOpenChange} asChild>
      <SidebarMenuItem>
        <CollapsibleTrigger asChild>
          <SidebarMenuButton
            isActive={pathname.startsWith('/admin/settings')}
            disabled={disabled}
            onClick={() => {
              if (disabled) return
              if (!open) {
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
          <SidebarMenuSub ref={submenuRef}>
            {settingsSubItems.map((sub) => (
              <SidebarMenuSubItem key={sub.tab}>
                {disabled ? (
                  <SidebarMenuSubButton
                    aria-disabled="true"
                    isActive={onSettings && activeTab === sub.tab}
                  >
                    {sub.title}
                  </SidebarMenuSubButton>
                ) : (
                  <SidebarMenuSubButton
                    asChild
                    isActive={onSettings && activeTab === sub.tab}
                  >
                    <Link
                      href={`/admin/settings?tab=${sub.tab}`}
                      onClick={closeMobile}
                    >
                      {sub.title}
                    </Link>
                  </SidebarMenuSubButton>
                )}
              </SidebarMenuSubItem>
            ))}
          </SidebarMenuSub>
        </CollapsibleContent>
      </SidebarMenuItem>
    </Collapsible>
  )
}

export function AdminSidebar({ disabled = false }: { disabled?: boolean }) {
  const pathname = usePathname()
  const router = useRouter()
  const { pubkey, role, loginMethod, logout, isAuthorized } = useAuth()
  const { profile } = useNostrProfile(pubkey)
  const { data: settings } = useSettings(!disabled)
  const { isMobile, setOpenMobile } = useSidebar()
  const [versionCheck, setVersionCheck] = React.useState<VersionCheck | null>(null)
  const [footerCardIndex, setFooterCardIndex] = React.useState(0)

  React.useEffect(() => {
    if (disabled) return

    let cancelled = false

    fetch('/api/version')
      .then(res => (res.ok ? res.json() : null))
      .then((data: VersionCheck | null) => {
        if (!cancelled && data) setVersionCheck(data)
      })
      .catch(() => {
        if (!cancelled) setVersionCheck(null)
      })

    return () => {
      cancelled = true
    }
  }, [disabled])

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
      navigator.clipboard.writeText(toNpub(pubkey))
      toast.success('npub copied')
    }
  }

  // Enabled plugins contribute nav items; the same permission filter below
  // applies, so plugin entries get RBAC gating for free.
  const { data: pluginData } = usePlugins(!disabled)
  const enabledPluginIds = new Set(
    (pluginData?.plugins ?? []).filter(p => p.enabled).map(p => p.id)
  )

  const visiblePlatform = filterByPermission([
    ...platformItems,
    ...pluginNavItems('platform', enabledPluginIds),
  ])
  const visibleSystem = filterByPermission([
    ...systemItems,
    ...pluginNavItems('system', enabledPluginIds),
  ])
  // Settings is ADMIN-only. VIEWER has SETTINGS_READ for API reads (public
  // settings hydrate branding for all authed users) but must not see the
  // settings UI in the nav.
  const showSettings = role === Role.ADMIN
  const hasDomain = !!settings?.domain?.trim()
  const domainVerified = settings?.domain_verified === 'true'
  const needsDomainSetup = role === Role.ADMIN && (!hasDomain || !domainVerified)
  const updateAvailable = role === Role.ADMIN && !!versionCheck?.updateAvailable

  const loginMethodLabel = loginMethod === 'extension'
    ? 'Extension'
    : loginMethod === 'nsec'
    ? 'Private key'
    : loginMethod === 'bunker'
    ? 'Bunker'
    : ''

  const displayName = profile?.displayName || profile?.name || (pubkey ? truncateNpub(pubkey) : 'Unknown')
  const avatarFallback = npubInitials(pubkey)
  const footerCards = [
    ...(needsDomainSetup
      ? [
          {
            id: 'domain',
            title: 'Setup Domain',
            description:
              'Verify .well-known routing to enable Lightning Addresses and wallet features.',
            actionLabel: 'Configure now',
            action: () => {
              router.push('/admin/settings?tab=infrastructure')
              closeMobile()
            },
            external: true,
          },
        ]
      : []),
    ...(updateAvailable
      ? [
          {
            id: 'update',
            title: 'Update available',
            description: `LaWallet ${versionCheck?.latestVersion} is ready to install.`,
            actionLabel: 'View release',
            action: () => {
              window.open(
                versionCheck?.releaseUrl || 'https://github.com/lawalletio/lawallet-nwc/releases',
                '_blank',
                'noopener,noreferrer',
              )
            },
            external: true,
          },
        ]
      : []),
  ]
  const activeFooterCard = footerCards.length
    ? footerCards[footerCardIndex % footerCards.length]
    : null

  function showPreviousFooterCard() {
    if (footerCards.length <= 1) return
    setFooterCardIndex(prev => (prev - 1 + footerCards.length) % footerCards.length)
  }

  function showNextFooterCard() {
    if (footerCards.length <= 1) return
    setFooterCardIndex(prev => (prev + 1) % footerCards.length)
  }

  return (
    <Sidebar>
      <SidebarHeader className="p-4">
        <Link
          href="/admin"
          aria-disabled={disabled}
          tabIndex={disabled ? -1 : undefined}
          className={`flex items-center gap-2 ${disabled ? 'pointer-events-none opacity-60' : ''}`}
          onClick={closeMobile}
        >
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
                    {disabled ? (
                      <SidebarMenuButton disabled isActive={isActive(item.href)}>
                        <item.icon className="size-4" />
                        <span>{item.title}</span>
                      </SidebarMenuButton>
                    ) : (
                      <SidebarMenuButton asChild isActive={isActive(item.href)}>
                        <Link href={item.href} onClick={closeMobile}>
                          <item.icon className="size-4" />
                          <span>{item.title}</span>
                        </Link>
                      </SidebarMenuButton>
                    )}
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
                      {disabled ? (
                        <SidebarMenuButton disabled isActive={isActive(item.href)}>
                          <item.icon className="size-4" />
                          <span>{item.title}</span>
                        </SidebarMenuButton>
                      ) : (
                        <SidebarMenuButton asChild isActive={isActive(item.href)}>
                          <Link href={item.href} onClick={closeMobile}>
                            <item.icon className="size-4" />
                            <span>{item.title}</span>
                          </Link>
                        </SidebarMenuButton>
                      )}
                    </SidebarMenuItem>
                  ))}

                  {/* Card Emulator — ADMIN-only dev/test tool (forges NTAG424
                      taps with raw keys), so it's gated tighter than Cards. */}
                  {role === Role.ADMIN && (
                    <SidebarMenuItem>
                      {disabled ? (
                        <SidebarMenuButton disabled isActive={isActive('/admin/emulator')}>
                          <Nfc className="size-4" />
                          <span>Card Emulator</span>
                        </SidebarMenuButton>
                      ) : (
                        <SidebarMenuButton asChild isActive={isActive('/admin/emulator')}>
                          <Link href="/admin/emulator" onClick={closeMobile}>
                            <Nfc className="size-4" />
                            <span>Card Emulator</span>
                          </Link>
                        </SidebarMenuButton>
                      )}
                    </SidebarMenuItem>
                  )}

                  {showSettings && (
                    // `SettingsNav` reads the active tab from the URL query via
                    // `useSearchParams`, which must sit under a Suspense boundary.
                    <Suspense fallback={null}>
                      <SettingsNav disabled={disabled} />
                    </Suspense>
                  )}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </>
        )}
      </SidebarContent>

      <SidebarFooter className="gap-3 px-4 pt-4 pb-3">
        <div className="flex items-center justify-between gap-2">
          {pubkey ? (
            <Link
              href={`/admin/users/${pubkey}`}
              className={`flex flex-1 min-w-0 items-center gap-2 rounded-md -m-1 p-1 transition-colors ${
                disabled ? 'pointer-events-none opacity-60' : 'hover:bg-sidebar-accent'
              }`}
              aria-disabled={disabled}
              tabIndex={disabled ? -1 : undefined}
              aria-label="View my profile"
              onClick={() => setOpenMobile(false)}
            >
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
            </Link>
          ) : (
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
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-9 shrink-0 rounded-full text-muted-foreground transition-[background-color,color,box-shadow,transform,opacity] duration-150 ease-out hover:scale-105 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground hover:opacity-100 hover:shadow-sm active:scale-95 data-[state=open]:scale-95 data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground data-[state=open]:shadow-inner"
                disabled={disabled}
                aria-label="Open account menu"
              >
                <MoreVertical className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" side="top">
              {/* Mirror of the wallet avatar's "Admin dashboard" item — lets
                  the user hop to their personal wallet without logging out. */}
              <DropdownMenuItem
                onClick={() => {
                  closeMobile()
                  router.push('/wallet')
                }}
              >
                <Wallet className="size-4 mr-2" />
                Switch to wallet view
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={copyPubkey}>
                <Copy className="size-4 mr-2" />
                Copy npub
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={logout}>
                <LogOut className="size-4 mr-2" />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {activeFooterCard && (
          <Card className="bg-sidebar-accent border-sidebar-border">
            <CardContent className="space-y-2 p-4">
              <div className="flex items-start gap-2">
                <p className="min-w-0 flex-1 text-sm font-semibold">
                  {activeFooterCard.title}
                </p>
                <div className="-mr-1 -mt-1 flex shrink-0 items-center gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-7 rounded-full text-muted-foreground transition-[background-color,color,transform] hover:scale-105 hover:bg-background/60 hover:text-foreground active:scale-95 disabled:opacity-35"
                    disabled={disabled || footerCards.length <= 1}
                    aria-label="Previous sidebar message"
                    onClick={showPreviousFooterCard}
                  >
                    <ChevronLeft className="size-3.5" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-7 rounded-full text-muted-foreground transition-[background-color,color,transform] hover:scale-105 hover:bg-background/60 hover:text-foreground active:scale-95 disabled:opacity-35"
                    disabled={disabled || footerCards.length <= 1}
                    aria-label="Next sidebar message"
                    onClick={showNextFooterCard}
                  >
                    <ChevronRight className="size-3.5" />
                  </Button>
                </div>
              </div>
              <p className="text-xs text-muted-foreground line-clamp-2">
                {activeFooterCard.description}
              </p>
              <Button
                variant="theme"
                size="sm"
                className="w-full"
                disabled={disabled}
                onClick={() => {
                  if (disabled) return
                  activeFooterCard.action()
                }}
              >
                {activeFooterCard.actionLabel}
                {activeFooterCard.external && <ExternalLink className="ml-1 size-3" />}
              </Button>
            </CardContent>
          </Card>
        )}

        <p
          className="flex h-3 items-center justify-center text-center text-[10px] font-medium leading-none text-sidebar-foreground/45"
          aria-label={`LaWallet version ${APP_VERSION}`}
        >
          v{APP_VERSION}
        </p>
      </SidebarFooter>
    </Sidebar>
  )
}
