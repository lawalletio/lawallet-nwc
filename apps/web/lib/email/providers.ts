import nodemailer from 'nodemailer'
import { AwsClient } from 'aws4fetch'

/**
 * Email providers, one config block per type stored as flat Settings keys.
 * `email_default_provider` picks which one `sendEmail()` uses.
 */

export const EMAIL_PROVIDER_TYPES = ['smtp', 'ses', 'resend'] as const
export type EmailProviderType = (typeof EMAIL_PROVIDER_TYPES)[number]

export interface EmailMessage {
  from: string
  to: string
  subject: string
  html: string
  text: string
}

type Settings = Record<string, string | undefined>

interface EmailProvider {
  /** Settings keys this provider reads (all ≤ 32 chars). */
  keys: readonly string[]
  /** Write-only keys — never serialized by GET /api/settings. */
  secretKeys: readonly string[]
  isConfigured(s: Settings): boolean
  send(s: Settings, msg: EmailMessage): Promise<void>
}

const TIMEOUT_MS = 10_000

async function assertOk(res: Response, provider: string) {
  if (res.ok) return
  const body = await res.text().catch(() => '')
  // Resend and SESv2 both return `{ message }` JSON; prefer it over the raw body.
  let detail = body.slice(0, 300)
  try {
    detail = JSON.parse(body).message || detail
  } catch {}
  throw new Error(`${provider} responded HTTP ${res.status}: ${detail}`)
}

export const EMAIL_PROVIDERS: Record<EmailProviderType, EmailProvider> = {
  smtp: {
    keys: [
      'smtp_host',
      'smtp_port',
      'smtp_username',
      'smtp_password',
      'smtp_secure'
    ],
    secretKeys: ['smtp_password'],
    isConfigured: s => Boolean(s.smtp_host?.trim()),
    async send(s, msg) {
      const port = Number(s.smtp_port) || 587
      const transport = nodemailer.createTransport({
        host: s.smtp_host!.trim(),
        port,
        secure: s.smtp_secure === 'true' || port === 465,
        auth: s.smtp_username
          ? { user: s.smtp_username, pass: s.smtp_password ?? '' }
          : undefined,
        connectionTimeout: TIMEOUT_MS,
        greetingTimeout: TIMEOUT_MS,
        socketTimeout: TIMEOUT_MS
      })
      await transport.sendMail(msg)
    }
  },
  ses: {
    keys: ['ses_region', 'ses_access_key_id', 'ses_secret_access_key'],
    secretKeys: ['ses_secret_access_key'],
    isConfigured: s =>
      Boolean(
        s.ses_region?.trim() &&
        s.ses_access_key_id?.trim() &&
        s.ses_secret_access_key
      ),
    async send(s, msg) {
      const region = s.ses_region!.trim()
      if (!/^[a-z]{2}(-[a-z]+)+-\d$/.test(region)) {
        throw new Error(`Invalid AWS region "${region}"`)
      }
      const aws = new AwsClient({
        accessKeyId: s.ses_access_key_id!.trim(),
        secretAccessKey: s.ses_secret_access_key!,
        region,
        service: 'ses'
      })
      const res = await aws.fetch(
        `https://email.${region}.amazonaws.com/v2/email/outbound-emails`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            FromEmailAddress: msg.from,
            Destination: { ToAddresses: [msg.to] },
            Content: {
              Simple: {
                Subject: { Data: msg.subject, Charset: 'UTF-8' },
                Body: {
                  Html: { Data: msg.html, Charset: 'UTF-8' },
                  Text: { Data: msg.text, Charset: 'UTF-8' }
                }
              }
            }
          }),
          signal: AbortSignal.timeout(TIMEOUT_MS)
        }
      )
      await assertOk(res, 'AWS SES')
    }
  },
  resend: {
    keys: ['resend_api_key'],
    secretKeys: ['resend_api_key'],
    isConfigured: s => Boolean(s.resend_api_key),
    async send(s, msg) {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${s.resend_api_key}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          from: msg.from,
          to: [msg.to],
          subject: msg.subject,
          html: msg.html,
          text: msg.text
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS)
      })
      await assertOk(res, 'Resend')
    }
  }
}

export const EMAIL_SECRET_KEYS = Object.values(EMAIL_PROVIDERS).flatMap(
  p => p.secretKeys
)

export function isEmailProviderType(v: unknown): v is EmailProviderType {
  return typeof v === 'string' && v in EMAIL_PROVIDERS
}

/** Default provider, falling back to the first configured one. */
export function resolveDefaultProvider(s: Settings): EmailProviderType | null {
  if (isEmailProviderType(s.email_default_provider)) {
    return s.email_default_provider
  }
  return (
    EMAIL_PROVIDER_TYPES.find(t => EMAIL_PROVIDERS[t].isConfigured(s)) ?? null
  )
}
