import { describe, it, expect } from 'vitest'
import {
  buildScanUrl,
  bytesToHexUpper,
  inspectPayLink,
  inspectPayRequest,
  payLinkFetchUrl,
  randomUid
} from '@/lib/client/card-emulator-crypto'

// SUN signing moved server-side (see ntag424-sign.test.ts). These cover the
// remaining non-sensitive browser helpers the emulator UI uses.

describe('card-emulator-crypto helpers', () => {
  it('builds a scan URL with the encoded params', () => {
    const url = buildScanUrl('https://host.example/', 'card123', {
      p: 'AA'.repeat(16),
      c: 'BB'.repeat(8)
    })
    expect(url).toBe(
      `https://host.example/api/cards/card123/scan?p=${'AA'.repeat(16)}&c=${'BB'.repeat(8)}`
    )
  })

  it('accepts a raw card-scoped payLink and rejects the common mistakes', () => {
    const cardId = '04AABBCCDDEEFF'
    const payLink = `lnurlp://pay.example.com/api/cards/${cardId}/lnurlp`
    expect(inspectPayLink({ tag: 'withdrawRequest', payLink }, cardId)).toEqual(
      {
        ok: true,
        payLink,
        reason: 'payLink is a card-scoped lnurlp:// URL'
      }
    )
    expect(inspectPayLink({ tag: 'withdrawRequest' }, cardId).ok).toBe(false)
    expect(
      inspectPayLink(
        { payLink: `lnurl1qq${'q'.repeat(20)}` },
        cardId
      ).reason
    ).toMatch(/bech32/)
    expect(
      inspectPayLink(
        { payLink: 'lnurlp://pay.example.com/api/lud16/satoshi' },
        cardId
      ).ok
    ).toBe(false)
    expect(payLinkFetchUrl(payLink, 'http://localhost:3000')).toBe(
      `https://pay.example.com/api/cards/${cardId}/lnurlp`
    )
    expect(
      payLinkFetchUrl(
        `lnurlp://localhost:3000/api/cards/${cardId}/lnurlp`,
        'http://localhost:3000'
      )
    ).toBe(`http://localhost:3000/api/cards/${cardId}/lnurlp`)
  })

  it('checks that a payLink response is this card’s payRequest', () => {
    const cardId = 'card-1'
    expect(
      inspectPayRequest(
        {
          tag: 'payRequest',
          callback: `https://pay.example.com/api/cards/${cardId}/lnurlp/cb`
        },
        cardId
      ).ok
    ).toBe(true)
    expect(
      inspectPayRequest(
        { status: 'ERROR', reason: 'Card is blocked' },
        cardId
      ).reason
    ).toBe('Card is blocked')
  })

  it('generates a 7-byte UID with the NXP 0x04 prefix', () => {
    const uid = randomUid()
    expect(uid).toMatch(/^04[A-F0-9]{12}$/)
    expect(bytesToHexUpper(new Uint8Array([0x04, 0xab]))).toBe('04AB')
  })
})
