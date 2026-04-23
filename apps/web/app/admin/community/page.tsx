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
 * Official Nostr ostrich mark. Uses currentColor so the icon adopts
 * the muted text color of its surrounding bubble, matching the lucide
 * icons above rather than sitting in the original white-on-dark
 * contrast of the reference asset.
 */
function NostrOstrichIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 875 875" aria-hidden {...props}>
      <path
        d="m684.72,485.57c.22,12.59-11.93,51.47-38.67,81.3-26.74,29.83-56.02,20.85-58.42,20.16s-3.09-4.46-7.89-3.77-9.6,6.17-18.86,7.2-17.49,1.71-26.06-1.37c-4.46.69-5.14.71-7.2,2.24s-17.83,10.79-21.6,11.47c0,7.2-1.37,44.57,0,55.89s3.77,25.71,7.54,36c3.77,10.29,2.74,10.63,7.54,9.94s13.37.34,15.77,4.11c2.4,3.77,1.37,6.51,5.49,8.23s60.69,17.14,99.43,19.2c26.74.69,42.86,2.74,52.12,19.54,1.37,7.89,7.54,13.03,11.31,14.06s8.23,2.06,12,5.83,1.03,8.23,5.49,11.66c4.46,3.43,14.74,8.57,25.37,13.71,10.63,5.14,15.09,13.37,15.77,16.11s1.71,10.97,1.71,10.97c0,0-8.91,0-10.97-2.06s-2.74-5.83-2.74-5.83c0,0-6.17,1.03-7.54,3.43s.69,2.74-7.89.69-11.66-3.77-18.17-8.57c-6.51-4.8-16.46-17.14-25.03-16.8,4.11,8.23,5.83,8.23,10.63,10.97s8.23,5.83,8.23,5.83l-7.2,4.46s-4.46,2.06-14.74-.69-11.66-4.46-12.69-10.63,0-9.26-2.74-14.4-4.11-15.77-22.29-21.26c-18.17-5.49-66.52-21.26-100.12-24.69s-22.63-2.74-28.11-1.37-15.77,4.46-26.4-1.37c-10.63-5.83-16.8-13.71-17.49-20.23s-1.71-10.97,0-19.2,3.43-19.89,1.71-26.74-14.06-55.89-19.89-64.12c-13.03,1.03-50.74-.69-50.74-.69,0,0-2.4-.69-17.49,5.83s-36.48,13.76-46.77,19.93-14.4,9.7-16.12,13.13c.12,3-1.23,7.72-2.79,9.06s-12.48,2.42-12.48,2.42c0,0-5.85,5.86-8.25,9.97-6.86,9.6-55.2,125.14-66.52,149.83-13.54,32.57-9.77,27.43-37.71,27.43s-8.06.3-8.06.3c0,0-12.34,5.88-16.8,5.88s-18.86-2.4-26.4,0-16.46,9.26-23.31,10.29-4.95-1.34-8.38-3.74c-4-.21-14.27-.12-14.27-.12,0,0,1.74-6.51,7.91-10.88,8.23-5.83,25.37-16.11,34.63-21.26s17.49-7.89,23.31-9.26,18.51-6.17,30.51-9.94,19.54-8.23,29.83-31.54c10.29-23.31,50.4-111.43,51.43-116.23.63-2.96,3.73-6.48,4.8-15.09.66-5.35-2.49-13.04,1.71-22.63,10.97-25.03,21.6-20.23,26.4-20.23s17.14.34,26.4-1.37,15.43-2.74,24.69-7.89,11.31-8.91,11.31-8.91l-19.89-3.43s-18.51.69-25.03-4.46-15.43-15.77-15.43-15.77l-7.54-7.2,1.03,8.57s-5.14-8.91-6.51-10.29-8.57-6.51-11.31-11.31-7.54-25.03-7.54-25.03l-6.17,13.03-1.71-18.86-5.14,7.2-2.74-16.11-4.8,8.23-3.43-14.4-5.83,4.46-2.4-10.29-5.83-3.43s-14.06-9.26-16.46-9.6-4.46,3.43-4.46,3.43l1.37,12-12.2-6.27-7-11.9s2.36,4.01-9.62,7.53c-20.55,0-21.89-2.28-24.93-3.94-1.31-6.56-5.57-10.11-5.57-10.11h-20.57l-.34-6.86-7.89,3.09.69-10.29h-14.06l1.03-11.31h-8.91s3.09-9.26,25.71-22.97,25.03-16.46,46.29-17.14c21.26-.69,32.91,2.74,46.29,8.23s38.74,13.71,43.89,17.49c11.31-9.94,28.46-19.89,34.29-19.89,1.03-2.4,6.19-12.33,17.96-17.6,35.31-15.81,108.13-34,131.53-35.54,31.2-2.06,7.89-1.37,39.09,2.06,31.2,3.43,54.17,7.54,69.6,12.69,12.58,4.19,25.03,9.6,34.29,2.06,4.33-1.81,11.81-1.34,17.83-5.14,30.69-25.09,34.72-32.35,43.63-41.95s20.14-24.91,22.54-45.14,4.46-58.29-10.63-88.12-28.8-45.26-34.63-69.26c-5.83-24-8.23-61.03-6.17-73.03,2.06-12,5.14-22.29,6.86-30.51s9.94-14.74,19.89-16.46c9.94-1.71,17.83,1.37,22.29,4.8,4.46,3.43,11.65,6.28,13.37,10.29.34,1.71-1.37,6.51,8.23,8.23,9.6,1.71,16.05,4.16,16.05,4.16,0,0,15.64,4.29,3.11,7.73-12.69,2.06-20.52-.71-24.29,1.69s-7.21,10.08-9.61,11.1-7.2.34-12,4.11-9.6,6.86-12.69,14.4-5.49,15.77-3.43,26.74,8.57,31.54,14.4,43.2c5.83,11.66,20.23,40.8,24.34,47.66s15.77,29.49,16.8,53.83,1.03,44.23,0,54.86-10.84,51.65-35.53,85.94c-8.16,14.14-23.21,31.9-24.67,35.03-1.45,3.13-3.02,4.88-1.61,7.65,4.62,9.05,12.87,22.13,14.71,29.22,2.29,6.64,6.99,16.13,7.22,28.72Z"
        fill="currentColor"
        stroke="currentColor"
        strokeMiterlimit={10}
        strokeWidth={6}
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
