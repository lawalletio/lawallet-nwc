import type { NDEFRecordLike } from '@/lib/client/web-nfc'

/**
 * NFC Forum URI identifier codes (RTD-URI). Web NFC usually expands these
 * before exposing `record.data`; some stacks still hand back the raw prefix
 * byte, which is what mobile-pos's `TextDecoder` path sees.
 */
const URI_PREFIXES = [
  '',
  'http://www.',
  'https://www.',
  'http://',
  'https://',
  'tel:',
  'mailto:',
  'ftp://anonymous:anonymous@',
  'ftp://ftp.',
  'ftps://',
  'sftp://',
  'smb://',
  'nfs://',
  'ftp://',
  'dav://',
  'news:',
  'telnet://',
  'imap:',
  'rtsp://',
  'urn:',
  'pop:',
  'sip:',
  'sips:',
  'tftp:',
  'btspp://',
  'btl2cap://',
  'btgoep://',
  'tcpobex://',
  'irdaobex://',
  'file://',
  'urn:epc:id:',
  'urn:epc:tag:',
  'urn:epc:pat:',
  'urn:epc:raw:',
  'urn:epc:',
  'urn:nfc:'
] as const

function toBytes(data: BufferSource | null | undefined): Uint8Array | null {
  if (!data) return null
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
  }
  return null
}

function decodeText(bytes: Uint8Array, encoding?: string): string {
  const label = encoding?.trim() || 'utf-8'
  try {
    return new TextDecoder(label, { fatal: false }).decode(bytes)
  } catch {
    return new TextDecoder().decode(bytes)
  }
}

function isPaymentUrl(value: string): boolean {
  return /^(https?:\/\/|lnurlw:\/\/|lnurlp:\/\/|lnurl1)/i.test(value)
}

function clean(value: string): string {
  return value.replace(/\u0000/g, '').trim()
}

/**
 * NDEF well-known Text payloads start with a status byte and a language code.
 * Web NFC strips those into `encoding` / `lang`; a raw payload still has them.
 */
function decodeRawTextPayload(bytes: Uint8Array): string | null {
  if (bytes.length < 3) return null
  const langLen = bytes[0] & 0x3f
  if (langLen === 0 || bytes.length <= 1 + langLen) return null
  const lang = decodeText(bytes.subarray(1, 1 + langLen))
  if (!/^[A-Za-z-]{2,16}$/.test(lang)) return null
  const text = clean(decodeText(bytes.subarray(1 + langLen)))
  return isPaymentUrl(text) ? text : null
}

function decodeUriPayload(bytes: Uint8Array): string | null {
  const asText = clean(decodeText(bytes))
  if (isPaymentUrl(asText)) return asText
  if (bytes.length < 2) return null
  const code = bytes[0]
  if (code >= URI_PREFIXES.length) return null
  const rest = clean(decodeText(bytes.subarray(1)))
  if (!rest || /[\u0000-\u001f]/.test(rest)) return null
  const expanded = `${URI_PREFIXES[code]}${rest}`
  return isPaymentUrl(expanded) ? expanded : null
}

/** Pull a payment URL out of one NDEF record, or null when it has none. */
export function ndefRecordToUrl(record: NDEFRecordLike): string | null {
  const bytes = toBytes(record.data)
  if (!bytes || bytes.length === 0) return null

  if (record.recordType === 'url' || record.recordType === 'absolute-url') {
    return decodeUriPayload(bytes)
  }

  if (record.recordType === 'text') {
    const plain = clean(decodeText(bytes, record.encoding))
    if (isPaymentUrl(plain)) return plain
    return decodeRawTextPayload(bytes)
  }

  const plain = clean(decodeText(bytes, record.encoding))
  if (isPaymentUrl(plain)) return plain
  return decodeUriPayload(bytes) ?? decodeRawTextPayload(bytes)
}

/**
 * First BoltCard payment link in an NDEF message. LNURL-withdraw records win
 * over a generic https URL so an Android Application Record cannot shadow the
 * card link.
 */
export function firstBoltcardUrl(
  records: readonly NDEFRecordLike[] | null | undefined
): string | null {
  if (!records || records.length === 0) return null
  const urls: string[] = []
  for (const record of records) {
    const url = ndefRecordToUrl(record)
    if (url) urls.push(url)
  }
  return urls.find(url => /^(lnurlw:\/\/|lnurl1)/i.test(url)) ?? urls[0] ?? null
}
