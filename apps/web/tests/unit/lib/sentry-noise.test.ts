import { describe, it, expect } from 'vitest'
import {
  DENY_URLS,
  IGNORE_ERRORS,
  isThirdPartyNoise
} from '@/lib/observability/noise'

const frames = (...filenames: string[]) => ({
  exception: {
    values: [
      {
        type: 'TypeError',
        value: "Cannot read properties of null (reading 'getItem')",
        stacktrace: { frames: filenames.map(filename => ({ filename })) }
      }
    ]
  }
})

describe('isThirdPartyNoise', () => {
  it('drops LAWALLET-WEB-R: Vercel Live toolbar frame below the Sentry wrapper', () => {
    // Sentry frames are innermost-last: the toolbar listener sits below
    // Sentry's addEventListener wrapper, which is the top frame.
    const event = frames(
      'app:///_next-live/feedback/instrument.8c2f1a.js',
      'app:///_next/static/chunks/0a1b2c3d.js'
    )
    expect(isThirdPartyNoise(event)).toBe(true)
  })

  it('keeps a normal app error', () => {
    const event = frames(
      'app:///_next/static/chunks/app/wallet/page-1234.js',
      'app:///_next/static/chunks/0a1b2c3d.js'
    )
    expect(isThirdPartyNoise(event)).toBe(false)
  })

  it('keeps events without exceptions or frames', () => {
    expect(isThirdPartyNoise({})).toBe(false)
    expect(isThirdPartyNoise({ exception: { values: [{}] } })).toBe(false)
    expect(isThirdPartyNoise(frames(undefined as unknown as string))).toBe(
      false
    )
  })
})

describe('IGNORE_ERRORS', () => {
  const ignored = (message: string) => IGNORE_ERRORS.some(p => p.test(message))

  it('drops LAWALLET-WEB-8: MetaMask connection error', () => {
    expect(ignored('i: Failed to connect to MetaMask')).toBe(true)
  })

  it('drops LAWALLET-WEB-Z: a dismissed passkey prompt', () => {
    expect(
      ignored(
        'NotAllowedError: The operation either timed out or was not allowed. See: https://www.w3.org/TR/webauthn-2/#sctn-privacy-considerations-client.'
      )
    ).toBe(true)
  })

  it('keeps a normal app error', () => {
    expect(ignored('TypeError: Failed to fetch')).toBe(false)
  })
})

describe('DENY_URLS', () => {
  const denied = (url: string) => DENY_URLS.some(p => p.test(url))

  it('drops browser extension frames', () => {
    expect(
      denied('chrome-extension://nkbihfbeogaeaoehlefnkodbefgpgknn/x.js')
    ).toBe(true)
    expect(denied('moz-extension://1234/content.js')).toBe(true)
    expect(denied('safari-web-extension://ABCD/inject.js')).toBe(true)
  })

  it('keeps app chunks', () => {
    expect(denied('https://beta.lawallet.io/_next/static/chunks/main.js')).toBe(
      false
    )
  })
})
