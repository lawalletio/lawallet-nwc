'use client'

import Image from 'next/image'
import Link from 'next/link'
import {
  ExternalLink,
  Globe,
  Mail,
  Send,
  Twitter,
} from 'lucide-react'
import type { ComponentType, SVGProps } from 'react'

/**
 * Discord brand mark. Lucide dropped most brand icons so we inline the
 * official simple-icons path (CC0) to keep the Community page on-brand
 * without adding a dependency. `currentColor` picks up the surrounding
 * text color so the icon inherits the muted treatment of its container.
 */
function DiscordIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
      {...props}
    >
      <path d="M20.317 4.3698a19.7913 19.7913 0 0 0-4.8851-1.5152.0741.0741 0 0 0-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 0 0-.0785-.037 19.7363 19.7363 0 0 0-4.8852 1.515.0699.0699 0 0 0-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 0 0 .0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 0 0 .0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 0 0-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 0 1-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 0 1 .0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 0 1 .0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 0 1-.0066.1276 12.2986 12.2986 0 0 1-1.873.8914.0766.0766 0 0 0-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 0 0 .0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 0 0 .0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 0 0-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1569 2.4189Z" />
    </svg>
  )
}

/**
 * Stylized Nostr ostrich mascot (same art that already ships in
 * /public/logos/nostr-ostrich.svg — inlined so it can be sized with
 * className like the lucide icons and colored independently of the
 * asset pipeline). Keeps the native purple + orange palette because
 * the ostrich is a recognized community mascot rather than a
 * monochrome pictogram.
 */
function NostrOstrichIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 64 64" fill="none" aria-hidden {...props}>
      <ellipse cx="32" cy="44" rx="14" ry="10" fill="#7B3FE4" opacity="0.9" />
      <path
        d="M36 36C37 28 38 22 36 16"
        stroke="#7B3FE4"
        strokeWidth="5"
        strokeLinecap="round"
      />
      <circle cx="35" cy="14" r="6" fill="#7B3FE4" />
      <circle cx="37" cy="13" r="1.5" fill="white" />
      <circle cx="37.5" cy="12.8" r="0.6" fill="#1a1a2e" />
      <path d="M40 15L46 14L40 16Z" fill="#F5A623" />
      <line
        x1="26"
        y1="52"
        x2="22"
        y2="60"
        stroke="#7B3FE4"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <line
        x1="38"
        y1="52"
        x2="42"
        y2="60"
        stroke="#7B3FE4"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <path
        d="M19 60L22 60L25 60"
        stroke="#F5A623"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M39 60L42 60L45 60"
        stroke="#F5A623"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M18 42C14 38 12 34 14 30"
        stroke="#9B6FFF"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M19 44C14 42 10 38 12 34"
        stroke="#9B6FFF"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M20 40C16 34 16 28 18 24"
        stroke="#9B6FFF"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  )
}

/** WhatsApp brand mark (simple-icons, CC0). */
function WhatsAppIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
      {...props}
    >
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413z" />
    </svg>
  )
}
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
  icon: ComponentType<{ className?: string }>
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
    icon: WhatsAppIcon,
    hrefFor: v =>
      /^https?:\/\//i.test(v) ? v : `https://wa.me/${v.replace(/[^\d]/g, '')}`,
  },
  {
    key: 'social_discord',
    label: 'Discord',
    icon: DiscordIcon,
    hrefFor: v => (/^https?:\/\//i.test(v) ? v : `https://discord.gg/${v}`),
  },
  {
    key: 'social_nostr',
    label: 'Nostr',
    icon: NostrOstrichIcon,
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
