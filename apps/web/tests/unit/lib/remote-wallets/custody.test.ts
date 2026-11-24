import { describe, expect, it } from 'vitest'
import {
  canRevealCredentials,
  fromWireCustody,
  RemoteWalletCustodyError,
  revealableConnectionString,
  toWireCustody
} from '@/lib/remote-wallets/custody'
import { toRemoteWalletDto } from '@/lib/remote-wallets/dto'
import { createRemoteWalletFixture } from '@/tests/helpers/fixtures'
import type { RemoteWallet } from '@/lib/generated/prisma'

describe('remote wallet custody', () => {
  it('maps custody to and from the wire', () => {
    expect(toWireCustody('BOTH')).toBe('both')
    expect(toWireCustody('BACKEND')).toBe('backend')
    expect(toWireCustody('LOCAL')).toBe('local')
    expect(toWireCustody(null)).toBe('both')
    expect(toWireCustody(undefined)).toBe('both')
    expect(fromWireCustody('both')).toBe('BOTH')
    expect(fromWireCustody('backend')).toBe('BACKEND')
    expect(fromWireCustody('local')).toBe('LOCAL')
  })

  it('only reveals credentials of BOTH wallets', () => {
    expect(canRevealCredentials({ custody: 'BOTH' })).toBe(true)
    expect(canRevealCredentials({})).toBe(true)
    expect(canRevealCredentials({ custody: 'BACKEND' })).toBe(false)
    expect(canRevealCredentials({ custody: 'LOCAL' })).toBe(false)
  })

  it('withholds the connection string unless revealable', () => {
    const uri = 'nostr+walletconnect://x'
    expect(revealableConnectionString({ custody: 'BOTH' }, uri)).toBe(uri)
    expect(revealableConnectionString({ custody: 'BACKEND' }, uri)).toBeNull()
    expect(revealableConnectionString(null, uri)).toBeNull()
    expect(revealableConnectionString({ custody: 'BOTH' }, null)).toBeNull()
  })

  it('raises a 403 with a recognisable code', () => {
    const backend = new RemoteWalletCustodyError('BACKEND')
    expect(backend.statusCode).toBe(403)
    expect(backend.code).toBe('CUSTODY_BACKEND')
    expect(backend.details).toEqual({ custody: 'backend' })

    const local = new RemoteWalletCustodyError('LOCAL')
    expect(local.code).toBe('CUSTODY_LOCAL')
    expect(local.details).toEqual({ custody: 'local' })
  })
})

describe('toRemoteWalletDto', () => {
  it('includes custody and never config', () => {
    const dto = toRemoteWalletDto(
      createRemoteWalletFixture({
        custody: 'BACKEND',
        diedAt: null,
        diedReason: null
      }) as unknown as RemoteWallet
    )
    expect(dto.custody).toBe('backend')
    expect(dto).not.toHaveProperty('config')
    expect(dto.provider).toBeNull()
    expect(dto.lncurlServerUrl).toBeNull()
  })

  it('reports LNCurl wallets and death details', () => {
    const diedAt = new Date('2026-11-01T00:00:00.000Z')
    const dto = toRemoteWalletDto(
      createRemoteWalletFixture({
        status: 'DEAD',
        diedAt,
        diedReason: 'idle',
        config: {
          connectionString: 'x',
          provider: 'lncurl',
          lncurlServerUrl: 'https://lncurl.example'
        }
      }) as unknown as RemoteWallet
    )
    expect(dto.custody).toBe('both')
    expect(dto.provider).toBe('lncurl')
    expect(dto.lncurlServerUrl).toBe('https://lncurl.example')
    expect(dto.diedAt).toBe(diedAt.toISOString())
    expect(dto.diedReason).toBe('idle')
  })
})
