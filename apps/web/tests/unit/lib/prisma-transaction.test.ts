import { describe, expect, it, vi, beforeEach } from 'vitest'
import {
  TransactionTimeoutError,
  TransactionConnectionError,
  wrapTransactionError,
  safeTransaction
} from '@/lib/prisma-transaction'

vi.mock('@/lib/logger', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn()
  }))
}))

describe('TransactionTimeoutError', () => {
  it('creates error with timing info', () => {
    const error = new TransactionTimeoutError('Test timeout', {
      elapsedMs: 130000,
      timeoutMs: 120000
    })

    expect(error.name).toBe('TransactionTimeoutError')
    expect(error.code).toBe('TRANSACTION_TIMEOUT')
    expect(error.elapsedMs).toBe(130000)
    expect(error.timeoutMs).toBe(120000)
    expect(error.message).toBe('Test timeout')
  })

  it('preserves cause', () => {
    const cause = new Error('Original error')
    const error = new TransactionTimeoutError('Test timeout', { cause })

    expect(error.cause).toBe(cause)
  })
})

describe('TransactionConnectionError', () => {
  it('creates error with proper code', () => {
    const error = new TransactionConnectionError('Connection failed')

    expect(error.name).toBe('TransactionConnectionError')
    expect(error.code).toBe('TRANSACTION_CONNECTION_ERROR')
    expect(error.message).toBe('Connection failed')
  })
})

describe('wrapTransactionError', () => {
  it('wraps expired transaction error', () => {
    const original = new Error(
      'Transaction already closed: A query cannot be executed on an expired transaction. ' +
        'The timeout for this transaction was 120000 ms, however 132000 ms passed since the start of the transaction.'
    )

    const wrapped = wrapTransactionError(original)

    expect(wrapped).toBeInstanceOf(TransactionTimeoutError)
    expect((wrapped as TransactionTimeoutError).elapsedMs).toBe(132000)
    expect((wrapped as TransactionTimeoutError).timeoutMs).toBe(120000)
    expect(wrapped.cause).toBe(original)
  })

  it('wraps commit on expired transaction error', () => {
    const original = new Error(
      'Transaction API error: Transaction already closed: A commit cannot be executed on an expired transaction. ' +
        'The timeout for this transaction was 120000 ms, however 565000 ms passed since the start of the transaction.'
    )

    const wrapped = wrapTransactionError(original)

    expect(wrapped).toBeInstanceOf(TransactionTimeoutError)
    expect((wrapped as TransactionTimeoutError).elapsedMs).toBe(565000)
    expect((wrapped as TransactionTimeoutError).timeoutMs).toBe(120000)
  })

  it('wraps idle-in-transaction timeout error', () => {
    const original = new Error(
      'Neon: FATAL: terminating connection due to idle-in-transaction timeout'
    )

    const wrapped = wrapTransactionError(original)

    expect(wrapped).toBeInstanceOf(TransactionTimeoutError)
  })

  it('wraps connection refused error', () => {
    const original = new Error(
      "Can't reach database server at `ep-wandering-cell-ankadjzd-pooler.c-6.us-east-1.aws.neon.tech:5432`"
    )

    const wrapped = wrapTransactionError(original)

    expect(wrapped).toBeInstanceOf(TransactionConnectionError)
    expect(wrapped.cause).toBe(original)
  })

  it('wraps ECONNREFUSED error', () => {
    const original = new Error('connect ECONNREFUSED 127.0.0.1:5432')

    const wrapped = wrapTransactionError(original)

    expect(wrapped).toBeInstanceOf(TransactionConnectionError)
  })

  it('wraps ECONNRESET error', () => {
    const original = new Error('read ECONNRESET')

    const wrapped = wrapTransactionError(original)

    expect(wrapped).toBeInstanceOf(TransactionConnectionError)
  })

  it('wraps socket hang up error', () => {
    const original = new Error('socket hang up')

    const wrapped = wrapTransactionError(original)

    expect(wrapped).toBeInstanceOf(TransactionConnectionError)
  })

  it('returns original error for unknown errors', () => {
    const original = new Error('Some other error')

    const wrapped = wrapTransactionError(original)

    expect(wrapped).toBe(original)
  })

  it('wraps non-Error values', () => {
    const wrapped = wrapTransactionError('string error')

    expect(wrapped).toBeInstanceOf(Error)
    expect(wrapped.message).toBe('string error')
  })
})

describe('safeTransaction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns result on success', async () => {
    const mockPrisma = {
      $transaction: vi.fn().mockResolvedValue({ success: true })
    }

    const result = await safeTransaction(
      mockPrisma as any,
      async () => ({ success: true })
    )

    expect(result).toEqual({ success: true })
  })

  it('wraps timeout errors', async () => {
    const mockPrisma = {
      $transaction: vi.fn().mockRejectedValue(
        new Error(
          'Transaction already closed: A query cannot be executed on an expired transaction. ' +
            'The timeout for this transaction was 120000 ms, however 150000 ms passed since the start of the transaction.'
        )
      )
    }

    await expect(
      safeTransaction(mockPrisma as any, async () => ({}))
    ).rejects.toBeInstanceOf(TransactionTimeoutError)
  })

  it('wraps connection errors', async () => {
    const mockPrisma = {
      $transaction: vi.fn().mockRejectedValue(
        new Error("Can't reach database server at `localhost:5432`")
      )
    }

    await expect(
      safeTransaction(mockPrisma as any, async () => ({}))
    ).rejects.toBeInstanceOf(TransactionConnectionError)
  })

  it('passes through other errors unchanged', async () => {
    const original = new Error('Some other error')
    const mockPrisma = {
      $transaction: vi.fn().mockRejectedValue(original)
    }

    await expect(
      safeTransaction(mockPrisma as any, async () => ({}))
    ).rejects.toBe(original)
  })

  it('passes options to transaction', async () => {
    const mockPrisma = {
      $transaction: vi.fn().mockResolvedValue({})
    }

    await safeTransaction(
      mockPrisma as any,
      async () => ({}),
      { timeout: 30000, maxWait: 5000 }
    )

    expect(mockPrisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      { timeout: 30000, maxWait: 5000 }
    )
  })
})
