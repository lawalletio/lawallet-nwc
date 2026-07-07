import { describe, it, expect, beforeEach, vi } from 'vitest'
import { prismaMock, resetPrismaMock } from '@/tests/helpers/prisma-mock'
import { buildBackup } from '@/lib/backup/export'
import { parseBackupFile } from '@/lib/backup/archive'
import { isEncryptedArchive } from '@/lib/backup/crypto'
import { BACKUP_SCHEMA_VERSION } from '@/lib/validation/schemas'

// Deterministic core-table fixtures (one row per table, valid per row-schema).
const USER = {
  id: 'user-1',
  pubkey: 'a'.repeat(64),
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  albyEnabled: false,
  role: 'ADMIN',
  relays: null,
  relaysUpdatedAt: null,
}
const CARD_DESIGN = {
  id: 'design-1',
  imageUrl: 'https://x/img.png',
  description: 'default',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  archivedAt: null,
  userId: null,
}
const NTAG = {
  cid: 'cid-1',
  k0: '0',
  k1: '1',
  k2: '2',
  k3: '3',
  k4: '4',
  ctr: 0,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  userId: null,
}
const REMOTE_WALLET = {
  id: 'wallet-1',
  userId: 'user-1',
  name: 'primary',
  type: 'NWC',
  config: { nwcUri: 'nostr+walletconnect://x' },
  status: 'ACTIVE',
  isDefault: true,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  diedAt: null,
}
const LIGHTNING_ADDRESS = {
  username: 'satoshi',
  userId: 'user-1',
  mode: 'IDLE',
  redirect: null,
  remoteWalletId: null,
  isPrimary: true,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
}
const CARD = {
  id: 'card-1',
  designId: 'design-1',
  ntag424Cid: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  title: null,
  lastUsedAt: null,
  userId: null,
  username: null,
  otc: null,
  remoteWalletId: null,
  kind: 'SIMPLE',
  writeToken: null,
  writeTokenExpiresAt: null,
  blockedAt: null,
}

const options = { activityLogLimit: 100_000 }

/** Wires each core-table delegate to return its fixture rows. */
function seedCoreTables() {
  ;(prismaMock.user.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([USER])
  ;(prismaMock.cardDesign.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([CARD_DESIGN])
  ;(prismaMock.ntag424.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([NTAG])
  ;(prismaMock.remoteWallet.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([REMOTE_WALLET])
  ;(prismaMock.lightningAddress.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
    LIGHTNING_ADDRESS,
  ])
  ;(prismaMock.card.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([CARD])
  ;(prismaMock.cardActivationToken.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([])
  ;(prismaMock.albySubAccount.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([])
}

beforeEach(() => {
  resetPrismaMock()
  seedCoreTables()
})

describe('backup export (buildBackup)', () => {
  it('produces a manifest whose counts match the fixtures', async () => {
    const { manifest, filename, buffer } = await buildBackup(['core'], options, undefined)

    expect(manifest.schemaVersion).toBe(BACKUP_SCHEMA_VERSION)
    expect(manifest.encrypted).toBe(false)
    expect(manifest.categories).toEqual(['core'])
    expect(filename).toMatch(/\.zip$/)
    expect(filename).not.toMatch(/\.enc$/)
    expect(isEncryptedArchive(buffer)).toBe(false)

    expect(manifest.tables.users?.count).toBe(1)
    expect(manifest.tables.cardDesigns?.count).toBe(1)
    expect(manifest.tables.ntag424s?.count).toBe(1)
    expect(manifest.tables.remoteWallets?.count).toBe(1)
    expect(manifest.tables.lightningAddresses?.count).toBe(1)
    expect(manifest.tables.cards?.count).toBe(1)
    expect(manifest.tables.cardActivationTokens?.count).toBe(0)
    expect(manifest.tables.albySubAccounts?.count).toBe(0)
    // Only the core tables are present.
    expect(Object.keys(manifest.tables).sort()).toEqual(
      [
        'users',
        'cardDesigns',
        'ntag424s',
        'remoteWallets',
        'lightningAddresses',
        'cards',
        'cardActivationTokens',
        'albySubAccounts',
      ].sort(),
    )
  })

  it('wraps the archive when a password is supplied', async () => {
    const { filename, buffer, manifest } = await buildBackup(['core'], options, 'hunter2')
    expect(filename).toMatch(/\.zip\.enc$/)
    expect(isEncryptedArchive(buffer)).toBe(true)
    expect(manifest.encrypted).toBe(true)
  })

  it('round-trips: buildBackup buffer → parseBackupFile matches row counts', async () => {
    const { buffer } = await buildBackup(['core'], options, undefined)
    const file = new File([new Uint8Array(buffer)], 'backup.zip')
    const parsed = await parseBackupFile(file)

    expect(parsed.manifest.schemaVersion).toBe(BACKUP_SCHEMA_VERSION)
    expect(parsed.tables.users).toHaveLength(1)
    expect(parsed.tables.cardDesigns).toHaveLength(1)
    expect(parsed.tables.cardActivationTokens).toHaveLength(0)
    expect(parsed.tables.albySubAccounts).toHaveLength(0)
    // The parsed user row survived NDJSON serialization (Date → ISO string).
    expect((parsed.tables.users as Record<string, unknown>[])[0].id).toBe('user-1')
  })

  it('round-trips an encrypted archive with the correct password', async () => {
    const { buffer } = await buildBackup(['core'], options, 'hunter2')
    const file = new File([new Uint8Array(buffer)], 'backup.zip.enc')
    const parsed = await parseBackupFile(file, 'hunter2')
    expect(parsed.tables.users).toHaveLength(1)
  })
})
