import { describe, it, expect } from 'vitest'
import {
  resolveTables,
  CATEGORY_TABLES,
  BACKUP_TABLE_ORDER,
  TABLE_DESCRIPTORS,
  pkKey,
  fieldsKey,
} from '@/lib/backup/tables'
import { ROW_SCHEMAS, toPrismaData } from '@/lib/backup/row-schemas'
import { Prisma } from '@/lib/generated/prisma'

describe('backup tables', () => {
  describe('resolveTables', () => {
    it('returns the core tables in BACKUP_TABLE_ORDER order', () => {
      const resolved = resolveTables(['core'])
      expect(resolved).toEqual([
        'users',
        'cardDesigns',
        'ntag424s',
        'remoteWallets',
        'lightningAddresses',
        'cards',
        'cardActivationTokens',
        'albySubAccounts',
      ])
      // Order matches the canonical order filtered to the wanted set.
      const orderIndex = (t: (typeof resolved)[number]) => BACKUP_TABLE_ORDER.indexOf(t)
      for (let i = 1; i < resolved.length; i++) {
        expect(orderIndex(resolved[i])).toBeGreaterThan(orderIndex(resolved[i - 1]))
      }
    })

    it('dedupes and stays ordered across multiple categories', () => {
      const resolved = resolveTables(['settings', 'core', 'settings'])
      // No duplicates.
      expect(new Set(resolved).size).toBe(resolved.length)
      // settings sorts to the end per BACKUP_TABLE_ORDER, despite being listed first.
      expect(resolved[resolved.length - 1]).toBe('settings')
      expect(resolved).toContain('users')
    })

    it('is safe for an unknown / empty category set', () => {
      expect(resolveTables([])).toEqual([])
      // Unknown category (cast) is ignored via the `?? []` guard.
      expect(resolveTables(['nope' as never])).toEqual([])
    })
  })

  describe('drift guards', () => {
    it('every table in CATEGORY_TABLES is a member of BACKUP_TABLE_ORDER', () => {
      for (const tables of Object.values(CATEGORY_TABLES)) {
        for (const table of tables) {
          expect(BACKUP_TABLE_ORDER).toContain(table)
        }
      }
    })

    it('every key in TABLE_DESCRIPTORS is a member of BACKUP_TABLE_ORDER', () => {
      for (const table of Object.keys(TABLE_DESCRIPTORS)) {
        expect(BACKUP_TABLE_ORDER).toContain(table)
      }
      // ...and conversely every ordered table has a descriptor.
      for (const table of BACKUP_TABLE_ORDER) {
        expect(TABLE_DESCRIPTORS[table]).toBeDefined()
      }
    })

    it('every table has a row schema', () => {
      for (const table of BACKUP_TABLE_ORDER) {
        expect(ROW_SCHEMAS[table]).toBeDefined()
      }
    })
  })

  describe('pkKey / fieldsKey', () => {
    it('builds a stable key from single primary-key field', () => {
      const desc = TABLE_DESCRIPTORS.users
      expect(pkKey(desc, { id: 'u1', pubkey: 'abc' })).toBe('u1')
    })

    it('builds a stable key from a composite primary key', () => {
      const desc = TABLE_DESCRIPTORS.nostrProfileImageCache
      const key = pkKey(desc, { npub: 'npub1x', kind: 'AVATAR' })
      expect(key).toBe(pkKey(desc, { npub: 'npub1x', kind: 'AVATAR' }))
      expect(key).toContain('npub1x')
      expect(key).toContain('AVATAR')
    })

    it('fieldsKey is order-sensitive and stable', () => {
      const row = { userId: 'u1', name: 'primary' }
      expect(fieldsKey(['userId', 'name'], row)).toBe(fieldsKey(['userId', 'name'], row))
      expect(fieldsKey(['userId', 'name'], row)).not.toBe(fieldsKey(['name', 'userId'], row))
    })
  })
})

describe('backup row-schemas', () => {
  const validUser = {
    id: 'user-1',
    pubkey: 'a'.repeat(64),
    createdAt: '2026-07-06T12:00:00.000Z',
    albyEnabled: false,
    role: 'ADMIN',
    relays: null,
    relaysUpdatedAt: null,
  }

  it('parses a valid users row and coerces createdAt string → Date', () => {
    const result = ROW_SCHEMAS.users.safeParse(validUser)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.createdAt).toBeInstanceOf(Date)
      expect((result.data.createdAt as Date).toISOString()).toBe(validUser.createdAt)
    }
  })

  it('fails a users row missing pubkey', () => {
    const { pubkey, ...noPubkey } = validUser
    void pubkey
    expect(ROW_SCHEMAS.users.safeParse(noPubkey).success).toBe(false)
  })

  it('fails a users row with an out-of-range role enum', () => {
    expect(ROW_SCHEMAS.users.safeParse({ ...validUser, role: 'SUPERADMIN' }).success).toBe(false)
  })

  describe('toPrismaData', () => {
    const invoiceBase = {
      id: 'inv-1',
      bolt11: 'lnbc1...',
      paymentHash: 'hash',
      amountSats: 1000,
      description: 'x',
      purpose: 'LUD16_PAYMENT',
      status: 'PENDING',
      preimage: null,
      userId: null,
      expiresAt: new Date(),
      paidAt: null,
      createdAt: new Date(),
    }

    it('replaces a null nullable-Json field with Prisma.DbNull', () => {
      const out = toPrismaData('invoices', { ...invoiceBase, metadata: null })
      expect(out.metadata).toBe(Prisma.DbNull)
    })

    it('leaves a non-null Json field untouched', () => {
      const meta = { foo: 'bar' }
      const out = toPrismaData('invoices', { ...invoiceBase, metadata: meta })
      expect(out.metadata).toBe(meta)
    })

    it('returns a fresh object without mutating the input', () => {
      const input = { ...invoiceBase, metadata: null }
      const out = toPrismaData('invoices', input)
      expect(out).not.toBe(input)
      expect(input.metadata).toBe(null)
    })

    it('is a shallow clone for tables with no nullable-Json columns', () => {
      const input = { ...validUser }
      const out = toPrismaData('users', input)
      expect(out).not.toBe(input)
      expect(out).toEqual(input)
    })
  })
})
