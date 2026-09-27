import { describe, expect, it } from 'vitest'
import { firstBoltcardUrl, ndefRecordToUrl } from '@/lib/client/ndef-url'
import { classifyNfcStartError, isNfcAbortError } from '@/lib/client/web-nfc'

const text = (value: string) => new TextEncoder().encode(value)

describe('ndefRecordToUrl', () => {
  it('reads a Web NFC url record that is already a full lnurlw link', () => {
    const url = 'lnurlw://card.example/api/cards/1/scan?p=AA&c=BB'
    expect(ndefRecordToUrl({ recordType: 'url', data: text(url) })).toBe(url)
  })

  it('expands a raw NFC Forum URI prefix byte', () => {
    const payload = new Uint8Array([
      0x04,
      ...text('card.example/api/cards/1/scan?p=AA&c=BB')
    ])
    expect(ndefRecordToUrl({ recordType: 'url', data: payload })).toBe(
      'https://card.example/api/cards/1/scan?p=AA&c=BB'
    )
  })

  it('reads a text record and a raw NDEF text payload', () => {
    const url = 'lnurlw://card.example/scan?p=1&c=2'
    expect(ndefRecordToUrl({ recordType: 'text', data: text(url) })).toBe(url)

    const lang = text('en')
    const body = text(url)
    const bytes = new Uint8Array(1 + lang.length + body.length)
    bytes[0] = lang.length
    bytes.set(lang, 1)
    bytes.set(body, 1 + lang.length)
    expect(ndefRecordToUrl({ recordType: 'text', data: bytes })).toBe(url)
  })

  it('ignores records that are not payment links', () => {
    expect(
      ndefRecordToUrl({ recordType: 'text', data: text('hello') })
    ).toBeNull()
    expect(ndefRecordToUrl({ recordType: 'url', data: new Uint8Array() })).toBe(
      null
    )
  })
})

describe('firstBoltcardUrl', () => {
  it('prefers an lnurlw record over a generic https record', () => {
    const lnurl = 'lnurlw://card.example/scan?p=1&c=2'
    expect(
      firstBoltcardUrl([
        { recordType: 'url', data: text('https://example.com/app') },
        { recordType: 'text', data: text(lnurl) }
      ])
    ).toBe(lnurl)
  })

  it('returns null for an empty message', () => {
    expect(firstBoltcardUrl([])).toBeNull()
    expect(firstBoltcardUrl(null)).toBeNull()
  })
})

describe('classifyNfcStartError', () => {
  it('separates a missing gesture from a hard denial', () => {
    const denied = new DOMException('nope', 'NotAllowedError')
    expect(classifyNfcStartError(denied, 'prompt')).toBe('needs-permission')
    expect(classifyNfcStartError(denied, null)).toBe('needs-permission')
    expect(classifyNfcStartError(denied, 'denied')).toBe('denied')
    expect(
      classifyNfcStartError(new DOMException('no', 'NotSupportedError'), null)
    ).toBe('unsupported')
    expect(isNfcAbortError(new DOMException('stop', 'AbortError'))).toBe(true)
    expect(
      classifyNfcStartError(new DOMException('stop', 'AbortError'), null)
    ).toBe('aborted')
  })
})
