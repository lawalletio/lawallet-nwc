/**
 * Code-defined, branded email templates in the lawallet.io look: near-black
 * canvas, a dark card, the instance's theme gradient on the button and its
 * accent on the headline. One shared HTML shell (table layout + inline styles
 * — most clients strip <style>), per-template copy in en + es.
 */
import { DEFAULT_PRESET, THEME_PRESETS } from '@/lib/client/theme-presets'

export type EmailLocale = 'en' | 'es'
export type EmailTemplateId = 'login' | 'signup' | 'link' | 'test'

export interface EmailBrand {
  community: string
  /** Absolute raster logo URL; SVGs are skipped (Gmail won't render them). */
  logoUrl?: string
  /** The instance's `brand_theme` preset hex, e.g. `#22c55e`. */
  accent: string
  /** Public base URL of this instance. */
  siteUrl: string
}

export interface EmailTemplateData {
  link?: string
  expiresMinutes?: number
  provider?: string
}

export interface RenderedEmail {
  subject: string
  html: string
  text: string
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

interface Copy {
  subject: string
  eyebrow: string
  heading: string
  /** Second headline line, painted in the accent. */
  highlight?: string
  body: string
  cta?: string
  /** Small chips under the button (expiry, single use…). */
  meta?: string[]
  fallback?: string
  footnote: string
  poweredBy: string
}

const COPY: Record<
  EmailTemplateId,
  Record<EmailLocale, (b: EmailBrand, d: EmailTemplateData) => Copy>
> = {
  login: {
    en: (b, d) => ({
      subject: `Sign in to ${b.community}`,
      eyebrow: 'Magic link',
      heading: 'Sign in to',
      highlight: b.community,
      body: 'Tap the button below to open your wallet. No password needed.',
      cta: 'Sign in',
      meta: [`Expires in ${d.expiresMinutes ?? 15} min`, 'Single use'],
      fallback: 'Button not working? Paste this link into your browser:',
      footnote:
        "Didn't ask for this? You can safely ignore it — nobody can sign in without this link.",
      poweredBy: 'Powered by'
    }),
    es: (b, d) => ({
      subject: `Inicia sesión en ${b.community}`,
      eyebrow: 'Enlace mágico',
      heading: 'Inicia sesión en',
      highlight: b.community,
      body: 'Toca el botón para abrir tu billetera. Sin contraseñas.',
      cta: 'Iniciar sesión',
      meta: [`Vence en ${d.expiresMinutes ?? 15} min`, 'Un solo uso'],
      fallback: '¿El botón no funciona? Pega este enlace en tu navegador:',
      footnote:
        '¿No lo pediste? Puedes ignorar este correo: nadie puede entrar sin este enlace.',
      poweredBy: 'Impulsado por'
    })
  },
  signup: {
    en: (b, d) => ({
      subject: `Welcome to ${b.community}`,
      eyebrow: 'New wallet',
      heading: 'Welcome to',
      highlight: b.community,
      body: 'Confirm your email and your wallet is ready — a Lightning address and a Nostr identity, in one tap.',
      cta: 'Create my wallet',
      meta: [`Expires in ${d.expiresMinutes ?? 15} min`, 'Single use'],
      fallback: 'Button not working? Paste this link into your browser:',
      footnote:
        "Didn't ask for this? You can safely ignore it — no account is created until the link is used.",
      poweredBy: 'Powered by'
    }),
    es: (b, d) => ({
      subject: `Bienvenido a ${b.community}`,
      eyebrow: 'Nueva billetera',
      heading: 'Bienvenido a',
      highlight: b.community,
      body: 'Confirma tu correo y tu billetera estará lista: una dirección Lightning y una identidad Nostr, en un toque.',
      cta: 'Crear mi billetera',
      meta: [`Vence en ${d.expiresMinutes ?? 15} min`, 'Un solo uso'],
      fallback: '¿El botón no funciona? Pega este enlace en tu navegador:',
      footnote:
        '¿No lo pediste? Puedes ignorar este correo: no se crea ninguna cuenta hasta usar el enlace.',
      poweredBy: 'Impulsado por'
    })
  },
  link: {
    en: (b, d) => ({
      subject: `Confirm your email for ${b.community}`,
      eyebrow: 'Link email',
      heading: 'Add this email to',
      highlight: b.community,
      body: "Confirm it's yours and you'll be able to sign in to your account with it.",
      cta: 'Confirm email',
      meta: [`Expires in ${d.expiresMinutes ?? 15} min`, 'Single use'],
      fallback: 'Button not working? Paste this link into your browser:',
      footnote:
        "Didn't ask for this? You can safely ignore it — nothing changes until the link is used.",
      poweredBy: 'Powered by'
    }),
    es: (b, d) => ({
      subject: `Confirma tu correo en ${b.community}`,
      eyebrow: 'Vincular correo',
      heading: 'Agrega este correo a',
      highlight: b.community,
      body: 'Confirma que es tuyo y podrás iniciar sesión en tu cuenta con él.',
      cta: 'Confirmar correo',
      meta: [`Vence en ${d.expiresMinutes ?? 15} min`, 'Un solo uso'],
      fallback: '¿El botón no funciona? Pega este enlace en tu navegador:',
      footnote:
        '¿No lo pediste? Puedes ignorar este correo: nada cambia hasta usar el enlace.',
      poweredBy: 'Impulsado por'
    })
  },
  test: {
    en: (b, d) => ({
      subject: `${b.community}: test email`,
      eyebrow: 'Delivery check',
      heading: 'Email delivery',
      highlight: 'is working',
      body: `This test email from ${b.community} was sent through ${d.provider ?? 'your email provider'}. Magic links and notifications are good to go.`,
      footnote: 'Sent from Settings → Infrastructure → Email.',
      poweredBy: 'Powered by'
    }),
    es: (b, d) => ({
      subject: `${b.community}: correo de prueba`,
      eyebrow: 'Prueba de envío',
      heading: 'El envío de correos',
      highlight: 'funciona',
      body: `Este correo de prueba de ${b.community} se envió con ${d.provider ?? 'tu proveedor de correo'}. Los enlaces mágicos y las notificaciones están listos.`,
      footnote: 'Enviado desde Ajustes → Infraestructura → Email.',
      poweredBy: 'Impulsado por'
    })
  }
}

// lawallet.io palette
const BG = '#0a0a0a'
const CARD = '#141414'
const BORDER = '#262626'
const TEXT = '#fafafa'
const MUTED = '#a3a3a3'
const SUBTLE = '#737373'
const FONT =
  "Geist,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"
const MONO = "'Geist Mono',ui-monospace,SFMono-Regular,Menlo,Consolas,monospace"
/** The three dots of the LaWallet mark. */
const DOTS = ['#55b68c', '#fdc800', '#e95052']

export function renderEmail(
  template: EmailTemplateId,
  locale: EmailLocale,
  brand: EmailBrand,
  data: EmailTemplateData = {}
): RenderedEmail {
  const copy = COPY[template][locale](brand, data)
  const e = escapeHtml
  // Only known presets: their hexes are safe to inline into CSS, and they
  // carry the same gradient stops the in-app "theme" button uses.
  const theme =
    THEME_PRESETS.find(p => p.hex === brand.accent.toLowerCase()) ??
    DEFAULT_PRESET
  const accent = theme.hex

  const logo =
    brand.logoUrl && !/\.svg(\?|$)/i.test(brand.logoUrl)
      ? `<img src="${e(brand.logoUrl)}" alt="${e(brand.community)}" height="32" style="display:block;height:32px;width:auto;max-width:200px;border:0;outline:none">`
      : `<span style="font-size:22px;font-weight:800;letter-spacing:-0.5px;color:${TEXT}">${e(brand.community)}</span>`

  const dots = DOTS.map(
    c =>
      `<span style="display:inline-block;width:6px;height:6px;border-radius:3px;background:${c};margin:0 2px;vertical-align:middle"></span>`
  ).join('')

  const button =
    copy.cta && data.link
      ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:32px 0 0">
<tr><td align="center" bgcolor="${theme.theme400}" style="border-radius:14px;background-color:${theme.theme400};background-image:linear-gradient(180deg,${theme.theme200},${theme.theme400});border:1px solid ${theme.theme300};box-shadow:0 0 32px ${accent}40">
<a href="${e(data.link)}" target="_blank" style="display:inline-block;padding:15px 36px;font-family:${FONT};font-size:16px;font-weight:700;line-height:20px;color:#ffffff;text-decoration:none;border-radius:14px">${e(copy.cta)}&nbsp;&rarr;</a>
</td></tr></table>`
      : ''

  const meta = copy.meta?.length
    ? `<p style="margin:16px 0 0;font-family:${MONO};font-size:12px;line-height:18px;color:${SUBTLE}">${copy.meta.map(e).join(' &nbsp;·&nbsp; ')}</p>`
    : ''

  const fallback =
    copy.fallback && data.link
      ? `<tr><td class="lw-pad" style="padding:0 40px 32px">
<p style="margin:0 0 8px;font-family:${FONT};font-size:12px;line-height:18px;color:${SUBTLE}">${e(copy.fallback)}</p>
<div style="padding:12px 14px;border-radius:10px;background:${BG};border:1px solid ${BORDER};font-family:${MONO};font-size:12px;line-height:18px;color:${MUTED};word-break:break-all"><a href="${e(data.link)}" target="_blank" style="color:${MUTED};text-decoration:none">${e(data.link)}</a></div>
</td></tr>`
      : ''

  const host = (() => {
    try {
      return new URL(brand.siteUrl).host
    } catch {
      return brand.siteUrl
    }
  })()

  const html = `<!doctype html>
<html lang="${locale}" xmlns="http://www.w3.org/1999/xhtml"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark"><meta name="supported-color-schemes" content="dark">
<title>${e(copy.subject)}</title>
<link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;600;800&family=Geist+Mono:wght@400&display=swap" rel="stylesheet">
<style>
:root{color-scheme:dark;supported-color-schemes:dark}
@media (max-width:520px){.lw-pad{padding-left:24px!important;padding-right:24px!important}.lw-h1{font-size:28px!important;line-height:34px!important}}
</style>
</head>
<body style="margin:0;padding:0;background:${BG};-webkit-font-smoothing:antialiased">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all">${e(copy.body)}&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${BG}" style="background:${BG}">
<tr><td align="center" style="padding:48px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px">
<tr><td align="center" style="padding:0 0 28px">${logo}</td></tr>
<tr><td style="border-radius:24px;border:1px solid ${BORDER};background-color:${CARD};background-image:radial-gradient(120% 70% at 50% 0%,${accent}26 0%,${CARD} 60%)">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
<tr><td class="lw-pad" style="padding:44px 40px 36px;font-family:${FONT}">
<span style="display:inline-block;padding:5px 12px;border-radius:999px;border:1px solid ${accent}55;background:${accent}1a;font-family:${MONO};font-size:11px;line-height:14px;letter-spacing:1px;text-transform:uppercase;color:${accent}">&#9889;&nbsp;${e(copy.eyebrow)}</span>
<h1 class="lw-h1" style="margin:24px 0 0;font-family:${FONT};font-size:34px;line-height:40px;font-weight:800;letter-spacing:-1px;color:${TEXT}">${e(copy.heading)}${copy.highlight ? `<br><span style="color:${accent}">${e(copy.highlight)}</span>` : ''}</h1>
<p style="margin:16px 0 0;font-family:${FONT};font-size:16px;line-height:26px;color:${MUTED}">${e(copy.body)}</p>
${button}
${meta}
</td></tr>
${fallback}
<tr><td class="lw-pad" style="padding:20px 40px 28px;border-top:1px solid ${BORDER}">
<p style="margin:0;font-family:${FONT};font-size:13px;line-height:20px;color:${SUBTLE}">${e(copy.footnote)}</p>
</td></tr>
</table>
</td></tr>
<tr><td align="center" style="padding:28px 0 0;font-family:${FONT};font-size:12px;line-height:18px;color:${SUBTLE}">
<a href="${e(brand.siteUrl)}" target="_blank" style="color:${MUTED};text-decoration:none;font-weight:600">${e(brand.community)}</a>&nbsp;·&nbsp;<a href="${e(brand.siteUrl)}" target="_blank" style="color:${SUBTLE};text-decoration:none">${e(host)}</a>
<div style="margin-top:10px">${dots}&nbsp; ${e(copy.poweredBy)} <a href="https://lawallet.io" target="_blank" style="color:${MUTED};text-decoration:none;font-weight:600">LaWallet</a></div>
</td></tr>
</table>
</td></tr></table>
</body></html>`

  const text = [
    `${copy.heading} ${copy.highlight ?? ''}`.trim(),
    '',
    copy.body,
    ...(copy.cta && data.link ? ['', `${copy.cta}: ${data.link}`] : []),
    ...(copy.meta?.length ? [copy.meta.join(' · ')] : []),
    '',
    copy.footnote,
    '',
    `${brand.community} — ${brand.siteUrl}`,
    `${copy.poweredBy} LaWallet — https://lawallet.io`
  ].join('\n')

  return { subject: copy.subject, html, text }
}
