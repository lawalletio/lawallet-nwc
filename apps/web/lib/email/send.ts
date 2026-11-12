import { getSettings } from '@/lib/settings'
import { resolvePublicEndpoint } from '@/lib/public-url'
import { ServiceUnavailableError } from '@/types/server/errors'
import {
  EMAIL_PROVIDERS,
  resolveDefaultProvider,
  type EmailProviderType
} from '@/lib/email/providers'
import {
  renderEmail,
  type EmailBrand,
  type EmailLocale,
  type EmailTemplateData,
  type EmailTemplateId
} from '@/lib/email/templates'

const PROVIDER_LABELS: Record<EmailProviderType, string> = {
  smtp: 'SMTP',
  ses: 'AWS SES',
  resend: 'Resend'
}

/** Strips CR/LF and quotes so a display name can't inject headers. */
function formatFrom(address: string, name?: string): string {
  const clean = name?.replace(/[\r\n"\\<>]/g, '').trim()
  return clean ? `"${clean}" <${address}>` : address
}

function absolutize(url: string | undefined, base: string) {
  const v = url?.trim()
  if (!v) return undefined
  try {
    return new URL(v, base).toString()
  } catch {
    return undefined
  }
}

/**
 * A refused SMTP connection is an `AggregateError` (one per resolved address)
 * with an empty message; fall back to its first inner error, then the code.
 */
function describeError(err: unknown): string {
  if (!(err instanceof Error)) return String(err)
  const inner = (err as Partial<AggregateError>).errors?.[0]
  return (
    err.message ||
    (inner instanceof Error && inner.message) ||
    (err as { code?: string }).code ||
    'unknown error'
  )
}

const DEFAULT_LOGOS = ['/logos/lawallet.svg', '/logos/lawallet-isotypo.svg']
const SVG = /\.svg(\?|$)/i

/**
 * The instance's own logo (wordmark first) when it has a raster one; the
 * white LaWallet wordmark when it never uploaded one. A custom SVG-only logo
 * yields undefined — the template prints the community name rather than
 * show LaWallet's mark for someone else's brand.
 */
export function resolveEmailLogo(
  settings: Record<string, string>,
  siteUrl: string
): string | undefined {
  const custom = [settings.logotype_url, settings.isotypo_url]
    .map(v => v?.trim())
    .filter((v): v is string => !!v && !DEFAULT_LOGOS.some(d => v.endsWith(d)))
  if (!custom.length) return `${siteUrl}/logos/lawallet-white.png`
  return absolutize(
    custom.find(v => !SVG.test(v)),
    siteUrl
  )
}

export interface SendEmailInput {
  to: string
  template: EmailTemplateId
  locale?: EmailLocale
  data?: EmailTemplateData
  /** Override the default provider (used by the settings "Send test" button). */
  provider?: EmailProviderType
  request?: { headers: { get: (k: string) => string | null } }
}

/** True when a default provider and a from address are set up. */
export function isEmailConfigured(settings: Record<string, string>): boolean {
  const provider = resolveDefaultProvider(settings)
  return Boolean(
    provider &&
    EMAIL_PROVIDERS[provider].isConfigured(settings) &&
    settings.email_from_address?.trim()
  )
}

export async function sendEmail(input: SendEmailInput): Promise<void> {
  const settings = await getSettings()
  const provider = input.provider ?? resolveDefaultProvider(settings)
  if (!provider || !EMAIL_PROVIDERS[provider].isConfigured(settings)) {
    throw new ServiceUnavailableError('Email provider is not configured')
  }
  const fromAddress = settings.email_from_address?.trim()
  if (!fromAddress) {
    throw new ServiceUnavailableError('Email "from" address is not configured')
  }

  const { url: siteUrl } = await resolvePublicEndpoint(input.request)
  const community = settings.community_name?.trim() || 'LaWallet'
  const brand: EmailBrand = {
    community,
    siteUrl,
    accent: settings.brand_theme?.trim() || '',
    logoUrl: resolveEmailLogo(settings, siteUrl)
  }

  const rendered = renderEmail(input.template, input.locale ?? 'en', brand, {
    provider: PROVIDER_LABELS[provider],
    ...input.data
  })

  try {
    await EMAIL_PROVIDERS[provider].send(settings, {
      from: formatFrom(fromAddress, settings.email_from_name || community),
      to: input.to,
      ...rendered
    })
  } catch (err) {
    // Surface the provider's reason (auth failure, unverified domain, refused
    // connection…) instead of a generic 500, so the form can show it.
    const reason = describeError(err)
    throw new ServiceUnavailableError(
      `Couldn't send the email via ${PROVIDER_LABELS[provider]}: ${reason}`
    )
  }
}
