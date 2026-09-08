import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { zipSync } from 'fflate'
import { prismaMock, resetPrismaMock } from '@/tests/helpers/prisma-mock'
import { Role } from '@/lib/auth/permissions'
import {
  BACKUP_SCHEMA_VERSION,
  type BackupManifest
} from '@/lib/validation/schemas'
import { toNdjson, utf8Encode, sha256 } from '@/lib/backup/serialize'

vi.mock('@/lib/config', () => ({
  getConfig: vi.fn(() => ({
    isProduction: false,
    isTest: true,
    isDevelopment: false,
    logPretty: false,
    nwcVault: {
      secret: 'test-nwc-vault-secret-0123456789abcdef',
      enabled: true
    }
  }))
}))

vi.mock('@/lib/logger', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn()
  })),
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  withRequestLogging: (fn: any) => fn,
  getCurrentReqId: () => 'test-req'
}))

vi.mock('@/lib/middleware/request-limits', () => ({
  checkRequestLimits: vi.fn(),
  checkFileLimits: vi.fn()
}))

vi.mock('@/lib/middleware/maintenance', () => ({
  checkMaintenance: vi.fn()
}))

vi.mock('@/lib/auth/unified-auth', () => ({
  authenticateWithRole: vi.fn()
}))

vi.mock('@/lib/activity-log', () => ({
  ActivityEvent: { SERVER_BACKUP_IMPORTED: 'SERVER_BACKUP_IMPORTED' },
  logActivity: vi.fn(),
  logActivityWith: vi.fn()
}))
;(logActivity as any).fireAndForget = vi.fn()

vi.mock('@/lib/events/event-bus', () => ({
  eventBus: { emit: vi.fn() }
}))

import { POST } from '@/app/api/admin/backup/import/route'
import { authenticateWithRole } from '@/lib/auth/unified-auth'
import { logActivity } from '@/lib/activity-log'
import { eventBus } from '@/lib/events/event-bus'

const ADMIN_PUBKEY = 'a'.repeat(64)

const SETTINGS_ROW = {
  name: 'domain',
  value: 'example.com',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
}

function asAdmin() {
  vi.mocked(authenticateWithRole).mockResolvedValue({
    pubkey: ADMIN_PUBKEY,
    role: Role.ADMIN,
    method: 'jwt'
  } as any)
}

/** Hand-builds a one-settings-row zip archive with a correct manifest. */
function buildSettingsBackupZip(): Uint8Array {
  const rows = [SETTINGS_ROW]
  const bytes = utf8Encode(toNdjson(rows))
  const manifest: BackupManifest = {
    schemaVersion: BACKUP_SCHEMA_VERSION,
    appVersion: '1.0.0-test',
    prismaMigration: null,
    exportedAt: '2026-01-01T00:00:00.000Z',
    encrypted: false,
    categories: ['settings'],
    tables: { settings: { count: rows.length, sha256: sha256(bytes) } }
  }
  return zipSync({
    'tables/settings.ndjson': bytes,
    'manifest.json': utf8Encode(JSON.stringify(manifest, null, 2))
  })
}

function buildRequest(body: FormData): NextRequest {
  const url = new URL('http://localhost:3000/api/admin/backup/import')
  return new NextRequest(url, { method: 'POST', body })
}

beforeEach(() => {
  resetPrismaMock()
  vi.clearAllMocks()
  asAdmin()
  // Default happy-path model mocks; per-test $transaction overrides applied after.
  ;(
    prismaMock.settings.deleteMany as ReturnType<typeof vi.fn>
  ).mockResolvedValue({
    count: 0
  })
  ;(prismaMock.settings.create as ReturnType<typeof vi.fn>).mockResolvedValue(
    SETTINGS_ROW
  )
  ;(prismaMock.settings.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(
    []
  )
  ;(
    prismaMock.activityLog.create as ReturnType<typeof vi.fn>
  ).mockResolvedValue({
    id: 'log-1',
    createdAt: new Date('2026-01-01T00:00:00.000Z')
  })
})

describe('POST /api/admin/backup/import — atomic rollback route contract', () => {
  it('returns HTTP 200 with rolled-back tables, attributing the failure, when the atomic transaction times out mid-restore', async () => {
    // Stage the mutation inside the callback, then reject with a timeout pattern
    // that wrapTransactionError classifies as TransactionTimeoutError.
    ;(prismaMock.$transaction as ReturnType<typeof vi.fn>).mockImplementation(
      async (fn: any) => {
        await fn(prismaMock)
        throw new Error('Transaction already closed')
      }
    )

    const form = new FormData()
    form.append(
      'file',
      new File([new Uint8Array(buildSettingsBackupZip())], 'backup.zip', {
        type: 'application/zip'
      })
    )
    form.append('resolution', JSON.stringify({ mode: 'replace', atomic: true }))

    const res = await POST(buildRequest(form))
    const body: any = await res.json()

    // Route returns 200 unconditionally (8283ef75 contract).
    expect(res.status).toBe(200)
    // Rolled-back atomic restore — committed-looking counters zeroed.
    expect(body.hadErrors).toBe(true)
    expect(body.errors).toHaveLength(1)
    expect(body.errors[0].table).toBeUndefined()
    expect(body.errors[0].message).toContain('Database operation failed:')
    expect(body.tables.settings.imported).toBe(0)
    expect(body.tables.settings.deleted).toBe(0)
    expect(body.tables.settings.overwritten).toBe(0)
    expect(body.tables.settings.renamed).toBe(0)
    expect(body.tables.settings.failed).toBeGreaterThanOrEqual(1)

    // Audit trail: logActivity.fireAndForget receives a summary with zeros + failed.
    const fireAndForget = (logActivity as any).fireAndForget
    expect(fireAndForget).toHaveBeenCalledTimes(1)
    const call = fireAndForget.mock.calls[0][0]
    expect(call.level).toBe('WARN')
    expect(call.metadata.hadErrors).toBe(true)
    expect(call.metadata.summary.settings.imported).toBe(0)
    expect(call.metadata.summary.settings.failed).toBeGreaterThanOrEqual(1)

    // SSE: emitRestoreEvents computes touched===0 → no spurious refresh.
    expect(eventBus.emit).not.toHaveBeenCalled()
  })

  it('returns HTTP 200 with committed counts and broadcasts SSE on a successful atomic restore (happy path)', async () => {
    // Default resetPrismaMock $transaction runs the callback and commits.
    const form = new FormData()
    form.append(
      'file',
      new File([new Uint8Array(buildSettingsBackupZip())], 'backup.zip', {
        type: 'application/zip'
      })
    )
    form.append('resolution', JSON.stringify({ mode: 'replace', atomic: true }))

    const res = await POST(buildRequest(form))
    const body: any = await res.json()

    expect(res.status).toBe(200)
    expect(body.hadErrors).toBe(false)
    expect(body.errors).toHaveLength(0)
    expect(body.tables.settings.imported).toBe(1)
    expect(body.tables.settings.failed).toBe(0)

    // Audit trail recorded at INFO with the committed summary.
    const fireAndForget = (logActivity as any).fireAndForget
    expect(fireAndForget).toHaveBeenCalledTimes(1)
    expect(fireAndForget.mock.calls[0][0].level).toBe('INFO')

    // SSE refresh fired for the touched settings table.
    expect(eventBus.emit).toHaveBeenCalledTimes(1)
    expect(eventBus.emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'settings:updated' })
    )
  })
})
