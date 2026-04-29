'use client'

import React from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { ChevronLeft, ChevronRight, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { NavTabbar } from '@/components/wallet/shared/nav-tabbar'
import { useAuth } from '@/components/admin/auth-context'
import { useSettings } from '@/lib/client/hooks/use-settings'
import { useBrandLogotypes } from '@/lib/client/hooks/use-brand'
import { cn } from '@/lib/utils'
import packageJson from '../../../package.json'

// Resolved at build-time from `apps/web/package.json` so a release bump
// flows through to the footer without a manual edit here.
const APP_VERSION = packageJson.version

type Item = {
  label: string
  href: string
  external?: boolean
  /** When true, render as a non-interactive row with a "Soon" badge. */
  comingSoon?: boolean
}

const ACCOUNT_ITEMS: Item[] = [
  { label: 'My Cards', href: '/wallet/settings/cards', comingSoon: true },
  { label: 'Security', href: '/wallet/settings/security', comingSoon: true },
  { label: 'Provider', href: '/wallet/settings/provider', comingSoon: true },
]

const PREFERENCES_ITEMS: Item[] = [
  { label: 'Languages', href: '/wallet/settings/languages', comingSoon: true },
  { label: 'Currencies', href: '/wallet/settings/currencies' },
]

const SUPPORT_ITEMS: Item[] = [
  {
    label: 'Help Center',
    href: 'https://docs.lawallet.io',
    external: true,
  },
  {
    label: 'Report a bug',
    href: 'https://github.com/lawalletio/lawallet-nwc/issues',
    external: true,
  },
]

export function SettingsScreen() {
  const router = useRouter()
  const { logout } = useAuth()
  const { data: settings } = useSettings()
  const { isotypo } = useBrandLogotypes()
  const communityName = settings?.community_name?.trim() || 'LaWallet'

  function handleRemoveWallet() {
    const confirmed = window.confirm(
      'Remove this wallet from the device? You can sign back in with your private key.',
    )
    if (!confirmed) return
    logout()
    router.replace('/wallet/landing')
  }

  return (
    <div className="flex flex-1 flex-col pb-32">
      <header className="sticky top-0 z-20 grid h-14 grid-cols-3 items-center bg-background/80 px-3 backdrop-blur-xl">
        <button
          type="button"
          onClick={() => router.back()}
          className="flex h-9 w-fit items-center gap-1.5 rounded-full bg-card px-3 text-sm font-medium text-foreground transition-colors hover:bg-accent"
        >
          <ChevronLeft className="size-4" />
          Back
        </button>
        <h1 className="text-center text-base font-semibold text-foreground">
          Settings
        </h1>
        <span aria-hidden />
      </header>

      <main className="flex flex-1 flex-col gap-6 px-4 pt-4">
        <Section title="Account">
          <ItemGroup items={ACCOUNT_ITEMS} />
        </Section>

        <Section title="Preferences">
          <ItemGroup items={PREFERENCES_ITEMS} />
        </Section>

        <Section title="Danger Zone">
          <Button
            type="button"
            variant="destructive"
            onClick={handleRemoveWallet}
            className="h-12 w-full"
          >
            Remove Wallet
          </Button>
        </Section>

        <CommunityFooter
          communityName={communityName}
          isotypo={isotypo}
        />

        <Section title="Support">
          <ItemGroup items={SUPPORT_ITEMS} />
        </Section>
      </main>

      <NavTabbar />
    </div>
  )
}

function Section({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-medium text-muted-foreground">{title}</h2>
      {children}
    </section>
  )
}

function ItemGroup({ items }: { items: Item[] }) {
  return (
    <div className="flex flex-col rounded-2xl bg-card">
      {items.map((item, idx) => (
        <SettingsRow
          key={item.href}
          item={item}
          divider={idx < items.length - 1}
        />
      ))}
    </div>
  )
}

function SettingsRow({ item, divider }: { item: Item; divider: boolean }) {
  const baseClass = cn(
    'flex h-14 items-center justify-between gap-3 px-4 transition-colors',
    divider && 'border-b border-border/40',
  )

  if (item.comingSoon) {
    return (
      <div
        aria-disabled
        className={cn(baseClass, 'cursor-not-allowed opacity-60')}
      >
        <span className="text-base font-medium text-foreground">
          {item.label}
        </span>
        <SoonBadge />
      </div>
    )
  }

  if (item.external) {
    return (
      <a
        href={item.href}
        target="_blank"
        rel="noopener noreferrer"
        className={cn(baseClass, 'hover:bg-accent/40')}
      >
        <span className="text-base font-medium text-foreground">
          {item.label}
        </span>
        <ExternalLink className="size-4 text-muted-foreground" />
      </a>
    )
  }

  return (
    <Link href={item.href} className={cn(baseClass, 'hover:bg-accent/40')}>
      <span className="text-base font-medium text-foreground">
        {item.label}
      </span>
      <ChevronRight className="size-5 text-muted-foreground" />
    </Link>
  )
}

function SoonBadge() {
  return (
    <span className="rounded-full bg-muted px-2.5 py-0.5 text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
      Soon
    </span>
  )
}

function CommunityFooter({
  communityName,
  isotypo,
}: {
  communityName: string
  isotypo: string
}) {
  return (
    <div className="flex flex-col items-center gap-1 py-2 text-center">
      <div className="flex items-center gap-2">
        <span className="relative flex size-4 shrink-0 items-center justify-center overflow-hidden rounded-full bg-card">
          <Image
            src={isotypo}
            alt=""
            fill
            sizes="16px"
            className="object-contain"
            unoptimized
          />
        </span>
        <span className="text-sm font-semibold text-foreground">
          {communityName}
        </span>
      </div>
      <p className="text-xs text-muted-foreground">
        Community by LaWallet
      </p>
      <p className="text-xs text-muted-foreground">Version {APP_VERSION}</p>
    </div>
  )
}
