import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFPage
} from 'pdf-lib'
import { BULL_BITCOIN_LOGO_PNG_BASE64 } from './assets/bullbitcoin-logo'

/**
 * `full` — everything, including the Lightning side (sats, rate, hash).
 * `share` — a plain ARS bank-transfer receipt to send the recipient: no sats,
 * BTC or Lightning reference.
 */
export type ReceiptVariant = 'full' | 'share'

/** What the Bull Bitcoin transfer receipt shows. */
export interface BullReceiptData {
  swapId: string
  externalId: string
  amountArs: number
  amountSats: number
  createdAt: Date
  paidAt: Date | null
  /** When we saw the transfer complete. */
  completedAt: Date
  holderName: string | null
  destination: string
  /** Alias lookup of the destination, when available. */
  account: {
    bank?: string | null
    cuit?: string | null
    alias?: string | null
    cvu?: string | null
  } | null
  paymentHash: string | null
  /** Bull Bitcoin `getOrderSummary`, or null when it couldn't be fetched. */
  order: Record<string, unknown> | null
  generatedAt: Date
}

const TZ = 'America/Argentina/Buenos_Aires'
const A4: [number, number] = [595.28, 841.89]
const M = 48
const INK = rgb(0.08, 0.08, 0.1)
const MUTED = rgb(0.42, 0.44, 0.48)
const RULE = rgb(0.88, 0.89, 0.91)
const BULL_RED = rgb(0.77, 0.07, 0.12)
const OK_GREEN = rgb(0.06, 0.55, 0.32)

/** Bull Bitcoin fields that look like a payment/verification reference. */
const REFERENCE_KEY =
  /reference|transaction|trx|coelsa|endtoend|tracking|operation|payoutid|bankref/i

const STATUS_ES: Record<string, string> = {
  completed: 'Completada',
  complete: 'Completada',
  executed: 'Ejecutada',
  paid: 'Pagado',
  pending: 'Pendiente',
  in_progress: 'En curso',
  processing: 'En proceso',
  canceled: 'Cancelada',
  cancelled: 'Cancelada',
  failed: 'Fallida',
  expired: 'Vencida'
}

const esStatus = (raw: unknown) => {
  const s = String(raw ?? '').trim()
  if (!s) return null
  return STATUS_ES[s.toLowerCase().replace(/\s+/g, '_')] ?? s
}

/** pdf-lib's standard fonts are WinAnsi: keep Latin-1, strip the rest. */
const WIN_ANSI_EXTRA = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ')
/** Latin letters with no NFD base (so accent-stripping can't help). */
const LATIN_FOLD: Record<string, string> = {
  Ł: 'L',
  ł: 'l',
  Đ: 'D',
  đ: 'd',
  Ħ: 'H',
  ħ: 'h',
  ı: 'i'
}
export function winAnsi(s: string): string {
  return Array.from(s.normalize('NFC').replace(/[   ]/g, ' '))
    .map(ch => {
      if (ch.charCodeAt(0) <= 0xff || WIN_ANSI_EXTRA.has(ch)) return ch
      if (LATIN_FOLD[ch]) return LATIN_FOLD[ch]
      const base = ch.normalize('NFD').replace(/[̀-ͯ]/g, '')
      return base.charCodeAt(0) <= 0xff ? base : '?'
    })
    .join('')
}

const ars = (n: number, decimals = 2) =>
  new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  }).format(n)

const int = (n: number) => new Intl.NumberFormat('es-AR').format(n)

const when = (d: Date) =>
  new Intl.DateTimeFormat('es-AR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: TZ
  }).format(d) + ' hs'

const str = (v: unknown) =>
  v == null || v === '' || typeof v === 'object' ? null : String(v)

/** Rows of Bull Bitcoin data, in the order a reader checks them. */
export function bullVerificationRows(
  order: Record<string, unknown> | null,
  externalId: string,
  variant: ReceiptVariant = 'full'
): [string, string][] {
  const rows: [string, string | null][] = [
    ['ID de orden', str(order?.orderId) ?? externalId],
    ['N° de orden', str(order?.orderNumber)],
    ['Estado de la orden', esStatus(order?.orderStatus)],
    [
      'Estado del cobro (Lightning)',
      variant === 'full' ? esStatus(order?.payinStatus) : null
    ],
    ['Estado de la transferencia', esStatus(order?.payoutStatus)]
  ]
  for (const [key, value] of Object.entries(order ?? {})) {
    if (!REFERENCE_KEY.test(key)) continue
    const v = str(value)
    if (v) rows.push([`Referencia (${humanize(key)})`, v])
  }
  return rows.filter((r): r is [string, string] => r[1] != null)
}

const humanize = (key: string) =>
  key
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/^./, c => c.toUpperCase())

export interface ReceiptSection {
  title: string
  rows: [string, string][]
}

/**
 * What each receipt says, section by section. The `share` variant is a plain
 * ARS bank-transfer receipt: no sats, rate, BTC price or Lightning payment.
 */
export function receiptSections(
  data: BullReceiptData,
  variant: ReceiptVariant = 'full'
): ReceiptSection[] {
  const full = variant === 'full'
  const recipient: [string, string][] = [['Titular', data.holderName ?? '-']]
  if (data.account?.cuit) recipient.push(['CUIT / CUIL', data.account.cuit])
  if (data.account?.bank) recipient.push(['Banco', data.account.bank])
  recipient.push(['CBU / CVU', data.account?.cvu ?? data.destination])
  if (data.account?.alias) recipient.push(['Alias', data.account.alias])

  const detail: [string, string][] = [['Monto', ars(data.amountArs)]]
  if (full) {
    detail.push(['Pagado', `${int(data.amountSats)} sats (Bitcoin Lightning)`])
    if (data.amountSats > 0) {
      detail.push([
        'Cotización',
        `1 sat = ${ars(data.amountArs / data.amountSats, 4)}`
      ])
    }
    const btc = Number(data.order?.exchangeRateAmount)
    if (Number.isFinite(btc) && btc > 0) {
      detail.push(['Precio BTC (Bull Bitcoin)', ars(btc)])
    }
    detail.push(['Orden creada', when(data.createdAt)])
    if (data.paidAt) detail.push(['Pago Lightning', when(data.paidAt)])
    detail.push(['Transferencia acreditada', when(data.completedAt)])
  } else {
    detail.push(['Fecha y hora', when(data.completedAt)])
    detail.push(['Estado', 'Acreditada'])
  }

  const sections: ReceiptSection[] = [
    { title: 'Destinatario', rows: recipient },
    { title: 'Detalle de la operación', rows: detail },
    {
      title: 'Verificación · Bull Bitcoin',
      rows: bullVerificationRows(data.order, data.externalId, variant)
    }
  ]
  if (full) {
    const ln: [string, string][] = []
    if (data.paymentHash) ln.push(['Hash de pago', data.paymentHash])
    ln.push(['ID de operación LaWallet', data.swapId])
    sections.push({ title: 'Lightning', rows: ln })
  }
  return sections
}

/**
 * A one-page A4 transfer receipt for a completed Bull Bitcoin swap, in
 * Spanish. Issued by LaWallet from Bull Bitcoin's order data — it says so in
 * the footer — with Bull Bitcoin's order id/number as the verification
 * reference. Every detail value uses the same font and size.
 */
export async function buildBullReceiptPdf(
  data: BullReceiptData,
  variant: ReceiptVariant = 'full'
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  pdf.setTitle(winAnsi(`Comprobante de transferencia ${data.swapId}`))
  pdf.setAuthor('LaWallet')
  pdf.setSubject('Comprobante de transferencia')
  pdf.setCreationDate(data.generatedAt)

  const page = pdf.addPage(A4)
  const [W, H] = A4
  const regular = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const logo = await pdf.embedPng(
    Uint8Array.from(Buffer.from(BULL_BITCOIN_LOGO_PNG_BASE64, 'base64'))
  )

  const text = (
    p: PDFPage,
    s: string,
    x: number,
    y: number,
    size: number,
    font: PDFFont,
    color = INK
  ) => p.drawText(winAnsi(s), { x, y, size, font, color })
  const width = (s: string, size: number, font: PDFFont) =>
    font.widthOfTextAtSize(winAnsi(s), size)

  // Header: Bull Bitcoin logo, document type, accent rule.
  const logoW = 150
  const logoH = (logo.height / logo.width) * logoW
  let y = H - M - logoH
  page.drawImage(logo, { x: M, y, width: logoW, height: logoH })
  const kind = 'COMPROBANTE DE TRANSFERENCIA'
  text(page, kind, W - M - width(kind, 9, bold), y + logoH - 10, 9, bold, MUTED)
  const issued = `Emitido el ${when(data.generatedAt)}`
  text(
    page,
    issued,
    W - M - width(issued, 8, regular),
    y + logoH - 24,
    8,
    regular,
    MUTED
  )
  y -= 14
  page.drawRectangle({ x: M, y, width: W - 2 * M, height: 2, color: BULL_RED })

  // Headline + amount.
  y -= 40
  text(page, 'Transferencia completada', M, y, 13, bold, OK_GREEN)
  y -= 34
  text(page, ars(data.amountArs), M, y, 28, bold)
  y -= 18
  text(
    page,
    `a ${data.holderName ?? data.destination}`,
    M,
    y,
    11,
    regular,
    MUTED
  )

  const labelW = 170
  const valueX = M + labelW
  const valueMax = W - M - valueX

  /** Wraps `value` to the value column; returns the lines. */
  const wrap = (value: string, size: number, font: PDFFont) => {
    const lines: string[] = []
    let line = ''
    for (const ch of winAnsi(value)) {
      if (font.widthOfTextAtSize(line + ch, size) > valueMax) {
        // Break at the last space for prose; long ids break anywhere.
        const cut = line.lastIndexOf(' ')
        if (cut > 0) {
          lines.push(line.slice(0, cut))
          line = line.slice(cut + 1) + ch
        } else {
          lines.push(line)
          line = ch
        }
      } else line += ch
    }
    if (line) lines.push(line)
    return lines
  }

  const section = (title: string) => {
    y -= 34
    text(page, title.toUpperCase(), M, y, 8, bold, MUTED)
    y -= 8
    page.drawLine({
      start: { x: M, y },
      end: { x: W - M, y },
      thickness: 0.6,
      color: RULE
    })
  }

  // One font and size for every value, ids and CBUs included.
  const row = (label: string, value: string) => {
    const font = bold
    const size = 10
    const lines = wrap(value, size, font)
    y -= 18
    text(page, label, M, y, 9, regular, MUTED)
    lines.forEach((l, i) => {
      text(page, l, valueX, y - i * (size + 3), size, font)
    })
    y -= (lines.length - 1) * (size + 3)
  }

  for (const sec of receiptSections(data, variant)) {
    section(sec.title)
    for (const [label, value] of sec.rows) row(label, value)
  }

  // Footer: who issued this, and how to verify it.
  const foot = [
    'Comprobante generado por LaWallet con los datos de la orden de Bull Bitcoin.',
    'No es un documento emitido por Bull Bitcoin. Para verificar la operación,',
    'contactá al soporte de Bull Bitcoin indicando el ID de orden.'
  ]
  let fy = M + foot.length * 11
  page.drawLine({
    start: { x: M, y: fy + 10 },
    end: { x: W - M, y: fy + 10 },
    thickness: 0.6,
    color: RULE
  })
  for (const l of foot) {
    text(page, l, M, fy, 8, regular, MUTED)
    fy -= 11
  }

  return pdf.save()
}
