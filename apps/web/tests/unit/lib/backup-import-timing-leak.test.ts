import { describe, it, expect, beforeEach, vi } from 'vitest'
import { prismaMock, resetPrismaMock } from '@/tests/helpers/prisma-mock'
import {
  TransactionTimeoutError,
  TransactionConnectionError,
  wrapTransactionError
} from '@/lib/prisma-transaction'
import { applyBackup } from '@/lib/backup/import'
import type { ParsedBackup } from '@/lib/backup/archive'
import type { BackupImportRequest } from '@/lib/validation/schemas'

// Logger reads config at module load — stub both before importing the SUT.
vi.mock('@/lib/config', () => ({
  getConfig: vi.fn(() => ({
    nwcVault: {
      secret: 'test-backup-nwc-vault-secret-0123456789abcdef',
      enabled: true
    }
  }))
}))

vi.mock('@/lib/logger', () => {
  const stub = {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn()
  }
  return {
    logger: stub,
    createLogger: vi.fn(() => stub),
    withRequestLogging: (fn: unknown) => fn,
    getCurrentReqId: vi.fn(() => 'req-test')
  }
})

// A real Prisma timeout-shaped message (matches a TIMEOUT_PATTERN and carries
// extractable elapsed/limit timing that must NOT reach an API client).
const PRISMA_TIMEOUT_MESSAGE =
  'Transaction already closed: A query cannot be executed on an expired transaction. ' +
  'The timeout for this transaction was 120000 ms, however 132000 ms passed since the start of the transaction.'

const PRISMA_CONNECTION_MESSAGE =
  "Can't reach database server at `localhost:5432`"

// Minimal settings-only backup. `settings` has no FKs / partial-uniques, so the
// replace/merge apply callback only deletes + (re)inserts — and we make the
// transaction reject before the callback ever runs, so no DB delegate is hit.
function makeParsedBackup(): ParsedBackup {
  return {
    manifest: {
      schemaVersion: 1,
      appVersion: 'test',
      prismaMigration: null,
      exportedAt: '2026-01-01T00:00:00.000Z',
      encrypted: false,
      categories: ['settings'],
      tables: { settings: { count: 0, sha256: '0'.repeat(64) } }
    },
    tables: { settings: [] }
  } as ParsedBackup
}

function makeResolution(
  overrides: Partial<BackupImportRequest>
): BackupImportRequest {
  return {
    mode: 'replace',
    defaultStrategy: 'skip',
    perConflict: [],
    preferBackupPrimary: false,
    atomic: true,
    ...overrides
  }
}

/** Makes the next prisma.$transaction() reject with a raw Prisma-shaped error. */
function rejectTransaction(message: string) {
  ;(prismaMock.$transaction as ReturnType<typeof vi.fn>).mockRejectedValue(
    new Error(message)
  )
}

// Timing integers that must never appear in an API-facing message.
const LEAK_MARKERS = ['132000', '120000', '60000', 'after ', '(limit:']

function expectNoTimingLeak(message: string) {
  for (const marker of LEAK_MARKERS) {
    expect(message).not.toContain(marker)
  }
}

describe('backup import timing leak — wrapTransactionError message', () => {
  it('omits elapsedMs/timeoutMs from the message while preserving structured fields', () => {
    const wrapped = wrapTransactionError(new Error(PRISMA_TIMEOUT_MESSAGE))

    expect(wrapped).toBeInstanceOf(TransactionTimeoutError)
    const timeout = wrapped as TransactionTimeoutError
    // Structured fields preserved for logs/Sentry.
    expect(timeout.elapsedMs).toBe(132000)
    expect(timeout.timeoutMs).toBe(120000)
    // The runtime timing integers must not be baked into `.message`.
    expectNoTimingLeak(timeout.message)
  })

  it('produces a fixed, human-readable message', () => {
    const wrapped = wrapTransactionError(new Error(PRISMA_TIMEOUT_MESSAGE))

    expect((wrapped as TransactionTimeoutError).message).toBe(
      'Database transaction timed out'
    )
  })

  it('parses and preserves timing on the commit-on-expired variant', () => {
    const wrapped = wrapTransactionError(
      new Error(
        'Transaction API error: Transaction already closed: A commit cannot be executed on an expired transaction. ' +
          'The timeout for this transaction was 120000 ms, however 565000 ms passed since the start of the transaction.'
      )
    )

    const timeout = wrapped as TransactionTimeoutError
    expect(timeout.elapsedMs).toBe(565000)
    expect(timeout.timeoutMs).toBe(120000)
    expectNoTimingLeak(timeout.message)
  })

  it('does not regress the connection-error message (no host details)', () => {
    const wrapped = wrapTransactionError(new Error(PRISMA_CONNECTION_MESSAGE))

    expect(wrapped).toBeInstanceOf(TransactionConnectionError)
    const conn = wrapped as TransactionConnectionError
    expect(conn.message).toBe('Database connection failed during transaction')
    expect(conn.message).not.toContain('localhost')
    expect(conn.message).not.toContain('5432')
  })
})

describe('backup import timing leak — applyBackup (replace mode)', () => {
  beforeEach(() => {
    resetPrismaMock()
  })

  it('atomic replace: result.errors[].message has no timing (prefixed path)', async () => {
    rejectTransaction(PRISMA_TIMEOUT_MESSAGE)
    const result = await applyBackup(
      makeParsedBackup(),
      makeResolution({ mode: 'replace', atomic: true })
    )

    expect(result.errors).toHaveLength(1)
    const msg = result.errors[0].message
    // Atomic path prefixes with "Database operation failed: ".
    expect(msg).toBe(
      'Database operation failed: Database transaction timed out'
    )
    expectNoTimingLeak(msg)
    expect(result.hadErrors).toBe(true)
  })

  it('non-atomic replace: result.errors[].message has no timing (bare path)', async () => {
    rejectTransaction(PRISMA_TIMEOUT_MESSAGE)
    const result = await applyBackup(
      makeParsedBackup(),
      makeResolution({ mode: 'replace', atomic: false })
    )

    expect(result.errors).toHaveLength(1)
    const msg = result.errors[0].message
    // Non-atomic path forwards wrapped.message verbatim (no prefix).
    expect(msg).toBe('Database transaction timed out')
    expectNoTimingLeak(msg)
    expect(result.hadErrors).toBe(true)
  })
})

describe('backup import timing leak — applyBackup (merge mode)', () => {
  beforeEach(() => {
    resetPrismaMock()
  })

  it('atomic merge: result.errors[].message has no timing (prefixed path)', async () => {
    rejectTransaction(PRISMA_TIMEOUT_MESSAGE)
    const result = await applyBackup(
      makeParsedBackup(),
      makeResolution({ mode: 'merge', atomic: true })
    )

    expect(result.errors).toHaveLength(1)
    const msg = result.errors[0].message
    expect(msg).toBe(
      'Database operation failed: Database transaction timed out'
    )
    expectNoTimingLeak(msg)
    expect(result.hadErrors).toBe(true)
  })

  it('non-atomic merge: result.errors[].message has no timing (per-table path)', async () => {
    rejectTransaction(PRISMA_TIMEOUT_MESSAGE)
    const result = await applyBackup(
      makeParsedBackup(),
      makeResolution({ mode: 'merge', atomic: false })
    )

    // Non-atomic merge processes one table ('settings') → one error entry.
    expect(result.errors).toHaveLength(1)
    const err = result.errors[0]
    expect(err.table).toBe('settings')
    expect(err.message).toBe('Database transaction timed out')
    expectNoTimingLeak(err.message)
    // The per-table failed counter increments.
    expect(result.tables.settings?.failed).toBe(1)
    expect(result.hadErrors).toBe(true)
  })
})

describe('backup import timing leak — connection errors are not leaked either', () => {
  beforeEach(() => {
    resetPrismaMock()
  })

  it('atomic replace: connection-error message is the fixed string', async () => {
    rejectTransaction(PRISMA_CONNECTION_MESSAGE)
    const result = await applyBackup(
      makeParsedBackup(),
      makeResolution({ mode: 'replace', atomic: true })
    )

    expect(result.errors).toHaveLength(1)
    const msg = result.errors[0].message
    expect(msg).toBe(
      'Database operation failed: Database connection failed during transaction'
    )
    expect(msg).not.toContain('localhost')
    expect(msg).not.toContain('5432')
  })

  it('non-atomic merge: connection-error message has no host details', async () => {
    rejectTransaction(PRISMA_CONNECTION_MESSAGE)
    const result = await applyBackup(
      makeParsedBackup(),
      makeResolution({ mode: 'merge', atomic: false })
    )

    expect(result.errors).toHaveLength(1)
    const msg = result.errors[0].message
    expect(msg).toBe('Database connection failed during transaction')
    expect(msg).not.toContain('localhost')
    expect(msg).not.toContain('5432')
  })
})

describe('backup import timing leak — double-wrapping is identity', () => {
  it('returns the original TransactionTimeoutError unchanged (sanitized message survives re-wrap)', () => {
    // safeTransaction already wraps via wrapTransactionError; import.ts calls
    // wrapTransactionError AGAIN on the already-wrapped error. The sanitized
    // message must survive this double-wrap (no timing re-introduced).
    const original = new TransactionTimeoutError(
      'Database transaction timed out',
      {
        elapsedMs: 132000,
        timeoutMs: 120000,
        cause: new Error('orig')
      }
    )
    const wrapped = wrapTransactionError(original)

    expect(wrapped).toBe(original) // identity — no re-wrap, no timing introduced
    expect(wrapped.message).toBe('Database transaction timed out')
    expectNoTimingLeak(wrapped.message)
  })

  it('returns the original TransactionConnectionError unchanged', () => {
    const original = new TransactionConnectionError(
      'Database connection failed during transaction',
      { cause: new Error('orig') }
    )
    const wrapped = wrapTransactionError(original)

    expect(wrapped).toBe(original)
    expect(wrapped.message).toBe(
      'Database connection failed during transaction'
    )
  })
})
