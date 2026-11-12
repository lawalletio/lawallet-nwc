// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '@/tests/mocks/server'

vi.mock('@/lib/config', () => ({
  getConfig: vi.fn(() => ({ isTest: true, isDevelopment: false }))
}))

const settings = vi.hoisted(() => ({ current: {} as Record<string, string> }))
vi.mock('@/lib/settings', () => ({
  getSettings: vi.fn(async () => settings.current)
}))
vi.mock('@/lib/public-url', () => ({
  resolvePublicEndpoint: vi.fn(async () => ({
    host: 'wallet.test',
    url: 'https://wallet.test'
  }))
}))

import {
  sendEmail,
  isEmailConfigured,
  resolveEmailLogo
} from '@/lib/email/send'
import { renderEmail, escapeHtml } from '@/lib/email/templates'
import { resolveDefaultProvider } from '@/lib/email/providers'

const brand = {
  community: 'Acme <script>',
  accent: '#7c3aed',
  siteUrl: 'https://wallet.test'
}

beforeEach(() => {
  settings.current = {}
})

describe('email templates', () => {
  it('escapes every interpolated value', () => {
    const out = renderEmail('login', 'en', brand, {
      link: 'https://wallet.test/x?a="b"'
    })
    expect(out.html).not.toContain('<script>')
    expect(out.html).toContain(escapeHtml('Acme <script>'))
    expect(out.html).toContain('&quot;b&quot;')
    expect(out.text).toContain('https://wallet.test/x?a="b"')
  })

  it('renders signup copy in Spanish', () => {
    const out = renderEmail(
      'signup',
      'es',
      { ...brand, community: 'Acme' },
      {
        link: 'https://x.test'
      }
    )
    expect(out.subject).toBe('Bienvenido a Acme')
  })

  it('ignores an unsafe accent and SVG logos', () => {
    const out = renderEmail('test', 'en', {
      ...brand,
      accent: 'red;background:url(x)',
      logoUrl: 'https://wallet.test/logo.svg'
    })
    expect(out.html).not.toContain('url(x)')
    expect(out.html).not.toContain('logo.svg')
    // Falls back to the default (green) preset's accent.
    expect(out.html).toContain('#22c55e')
  })

  it('paints the button with the brand preset gradient', () => {
    const out = renderEmail(
      'login',
      'en',
      { ...brand, accent: '#3B82F6' },
      { link: 'https://x.test' }
    )
    expect(out.html).toContain('#3b82f6')
  })
})

describe('email logo', () => {
  const site = 'https://wallet.test'
  it('uses the white LaWallet wordmark when no logo was uploaded', () => {
    expect(resolveEmailLogo({}, site)).toBe(`${site}/logos/lawallet-white.png`)
    expect(
      resolveEmailLogo({ logotype_url: '/logos/lawallet.svg' }, site)
    ).toBe(`${site}/logos/lawallet-white.png`)
  })

  it("prefers the instance's raster logotype, made absolute", () => {
    expect(
      resolveEmailLogo(
        { logotype_url: '/uploads/logo.png', isotypo_url: '/uploads/iso.png' },
        site
      )
    ).toBe(`${site}/uploads/logo.png`)
  })

  it('never shows the LaWallet mark for a custom SVG-only brand', () => {
    expect(
      resolveEmailLogo({ logotype_url: 'https://cdn.test/logo.svg' }, site)
    ).toBeUndefined()
  })
})

describe('provider selection', () => {
  it('falls back to the first configured provider', () => {
    expect(resolveDefaultProvider({ resend_api_key: 're_1' })).toBe('resend')
    expect(resolveDefaultProvider({})).toBeNull()
    expect(
      resolveDefaultProvider({
        email_default_provider: 'ses',
        resend_api_key: 'x'
      })
    ).toBe('ses')
  })

  it('requires a from address to count as configured', () => {
    expect(isEmailConfigured({ resend_api_key: 're_1' })).toBe(false)
    expect(
      isEmailConfigured({
        resend_api_key: 're_1',
        email_from_address: 'a@b.co'
      })
    ).toBe(true)
  })
})

describe('sendEmail', () => {
  it('throws 503 when the provider is not configured', async () => {
    await expect(
      sendEmail({ to: 'a@b.co', template: 'test' })
    ).rejects.toMatchObject({ statusCode: 503 })
  })

  it('sends through Resend with a sanitized from header', async () => {
    settings.current = {
      email_default_provider: 'resend',
      resend_api_key: 're_secret',
      email_from_address: 'hi@acme.test',
      email_from_name: 'Acme\r\nBcc: evil@x.test',
      community_name: 'Acme'
    }
    let captured: { auth: string | null; body: any } | null = null
    server.use(
      http.post('https://api.resend.com/emails', async ({ request }) => {
        captured = {
          auth: request.headers.get('authorization'),
          body: await request.json()
        }
        return HttpResponse.json({ id: '1' })
      })
    )

    await sendEmail({ to: 'a@b.co', template: 'test' })

    expect(captured!.auth).toBe('Bearer re_secret')
    expect(captured!.body.to).toEqual(['a@b.co'])
    expect(captured!.body.from).toBe('"AcmeBcc: evil@x.test" <hi@acme.test>')
    expect(captured!.body.subject).toBe('Acme: test email')
  })

  it('signs SES requests and surfaces API errors', async () => {
    settings.current = {
      email_default_provider: 'ses',
      ses_region: 'us-east-1',
      ses_access_key_id: 'AKIATEST',
      ses_secret_access_key: 'secret',
      email_from_address: 'hi@acme.test'
    }
    let auth: string | null = null
    server.use(
      http.post(
        'https://email.us-east-1.amazonaws.com/v2/email/outbound-emails',
        ({ request }) => {
          auth = request.headers.get('authorization')
          return HttpResponse.json({ message: 'denied' }, { status: 403 })
        }
      )
    )

    // A 503 carrying the provider's own reason, not a generic 500.
    await expect(
      sendEmail({ to: 'a@b.co', template: 'test' })
    ).rejects.toMatchObject({
      statusCode: 503,
      message:
        "Couldn't send the email via AWS SES: AWS SES responded HTTP 403: denied"
    })
    expect(auth).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIATEST\//)
  })
})
