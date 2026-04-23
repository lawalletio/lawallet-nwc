'use client'

import Image from 'next/image'
import Link from 'next/link'
import {
  AtSign,
  ExternalLink,
  Globe,
  Mail,
  MessageCircle,
  Send,
  Twitter,
} from 'lucide-react'
import { AdminTopbar } from '@/components/admin/admin-topbar'
import { Button } from '@/components/ui/button'
import { useSettings } from '@/lib/client/hooks/use-settings'
import { useBrandLogotypes } from '@/lib/client/hooks/use-brand'
import { cn } from '@/lib/utils'

interface SocialLink {
  key:
    | 'social_website'
    | 'social_whatsapp'
    | 'social_telegram'
    | 'social_discord'
    | 'social_twitter'
    | 'social_nostr'
    | 'social_email'
  label: string
  icon: typeof Globe
  hrefFor: (raw: string) => string
}

// Social settings are stored as free-form strings (handles, URLs, phone
// numbers). Normalize into a clickable href at render time so the admin
// doesn't have to remember to paste the full URL every time.
const SOCIAL_LINKS: SocialLink[] = [
  {
    key: 'social_website',
    label: 'Website',
    icon: Globe,
    hrefFor: v => (/^https?:\/\//i.test(v) ? v : `https://${v}`),
  },
  {
    key: 'social_twitter',
    label: 'Twitter / X',
    icon: Twitter,
    hrefFor: v =>
      /^https?:\/\//i.test(v) ? v : `https://x.com/${v.replace(/^@/, '')}`,
  },
  {
    key: 'social_telegram',
    label: 'Telegram',
    icon: Send,
    hrefFor: v =>
      /^https?:\/\//i.test(v) ? v : `https://t.me/${v.replace(/^@/, '')}`,
  },
  {
    key: 'social_whatsapp',
    label: 'WhatsApp',
    icon: MessageCircle,
    hrefFor: v =>
      /^https?:\/\//i.test(v) ? v : `https://wa.me/${v.replace(/[^\d]/g, '')}`,
  },
  {
    key: 'social_discord',
    label: 'Discord',
    icon: MessageCircle,
    hrefFor: v => (/^https?:\/\//i.test(v) ? v : `https://discord.gg/${v}`),
  },
  {
    key: 'social_nostr',
    label: 'Nostr',
    icon: AtSign,
    hrefFor: v => (/^https?:\/\//i.test(v) ? v : `nostr:${v}`),
  },
  {
    key: 'social_email',
    label: 'Email',
    icon: Mail,
    hrefFor: v => (v.startsWith('mailto:') ? v : `mailto:${v}`),
  },
]

/**
 * /admin/community — About page for the community this deployment serves.
 *
 * Mirrors the data the Branding settings tab manages so contributors who
 * land here from the admin home's identity-circles badge can see the
 * community's name, mark, lightning-address domain, and ways to reach out
 * without needing settings write access. Entirely driven by /api/settings
 * (the public GET exposes logos/community_name/socials alongside domain).
 */
export default function CommunityAboutPage() {
  const { data: settings, loading } = useSettings()
  const { logotype, isotypo } = useBrandLogotypes()

  const communityName = settings?.community_name?.trim()
  const domain = settings?.domain?.trim()
  const links = SOCIAL_LINKS.flatMap(s => {
    const raw = settings?.[s.key]?.trim()
    if (!raw) return []
    return [{ ...s, raw, href: s.hrefFor(raw) }]
  })

  return (
    <div className="flex flex-col">
      <AdminTopbar
        actions={
          <Button variant="outline" size="sm" asChild>
            <Link href="/admin">Back to home</Link>
          </Button>
        }
      />

      <div className="flex flex-col gap-6 px-4 pb-8 sm:px-6">
        <div className="overflow-hidden rounded-xl border bg-card">
          {/* Hero — logotype banner over the muted card bg so the
              admin sees exactly what members see on the login page. */}
          <div className="relative flex h-40 w-full items-center justify-center bg-gradient-to-br from-primary/20 via-primary/5 to-muted p-6 sm:h-48">
            <div className="relative h-16 w-full max-w-[360px] sm:h-20">
              <Image
                src={logotype}
                alt={communityName ?? 'Community logotype'}
                fill
                sizes="360px"
                className="object-contain"
                priority
              />
            </div>
          </div>

          {/* Body — isotypo overlaps the hero/body boundary, matching
              the /admin/users/[userId] profile composition so the two
              "about" surfaces feel like siblings. */}
          <div className="relative px-4 pb-6 pt-0 sm:px-6">
            <div className="absolute -top-8 left-4 size-16 overflow-hidden rounded-full bg-background ring-4 ring-card sm:-top-10 sm:left-6 sm:size-20">
              <Image
                src={isotypo}
                alt={communityName ? `${communityName} isotypo` : 'Isotypo'}
                fill
                sizes="80px"
                className="object-contain p-2"
              />
            </div>

            <div className="pt-10 sm:pt-12">
              <h2 className="text-xl font-semibold sm:text-2xl">
                {communityName || (loading ? '—' : 'Unnamed community')}
              </h2>
              {domain && (
                <p className="mt-1 font-mono text-sm text-muted-foreground">
                  @{domain}
                </p>
              )}
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <h3 className="text-lg font-semibold">Get in touch</h3>
          {links.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No contact links configured. Add them under{' '}
              <Link href="/admin/settings" className="underline underline-offset-4">
                Settings → Branding
              </Link>
              .
            </p>
          ) : (
            <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {links.map(({ key, label, icon: Icon, raw, href }) => (
                <li key={key}>
                  <a
                    href={href}
                    target={href.startsWith('mailto:') || href.startsWith('nostr:') ? undefined : '_blank'}
                    rel="noopener noreferrer"
                    className={cn(
                      'flex items-center gap-3 rounded-lg border bg-card px-3 py-2.5',
                      'hover:bg-accent/40 transition-colors',
                    )}
                  >
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                      <Icon className="size-4" />
                    </span>
                    <span className="flex min-w-0 flex-col">
                      <span className="text-sm font-medium">{label}</span>
                      <span className="truncate text-xs text-muted-foreground">
                        {raw}
                      </span>
                    </span>
                    <ExternalLink className="ml-auto size-4 shrink-0 text-muted-foreground" />
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
