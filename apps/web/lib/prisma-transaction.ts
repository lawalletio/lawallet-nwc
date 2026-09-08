import type { Prisma, PrismaClient } from './generated/prisma'

interface Logger {
  error: (...args: unknown[]) => void
  warn: (...args: unknown[]) => void
  info: (...args: unknown[]) => void
  debug: (...args: unknown[]) => void
}

const noopLogger: Logger = {
  error: () => {},
  warn: () => {},
  info: () => {},
  debug: () => {}
}

let cachedLogger: Logger | null = null

function getLogger(): Logger {
  if (cachedLogger) {
    return cachedLogger
  }
  try {
    const { createLogger } = require('./logger')
    const logger = createLogger({ module: 'prisma-transaction' }) as Logger
    cachedLogger = logger
    return logger
  } catch {
    cachedLogger = noopLogger
    return noopLogger
  }
}

export type TransactionClient = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>

export class TransactionTimeoutError extends Error {
  public readonly code = 'TRANSACTION_TIMEOUT'
  public readonly elapsedMs?: number
  public readonly timeoutMs?: number

  constructor(
    message: string,
    options?: { elapsedMs?: number; timeoutMs?: number; cause?: unknown }
  ) {
    super(message)
    this.name = 'TransactionTimeoutError'
    this.elapsedMs = options?.elapsedMs
    this.timeoutMs = options?.timeoutMs
    this.cause = options?.cause
    Object.setPrototypeOf(this, TransactionTimeoutError.prototype)
  }
}

export class TransactionConnectionError extends Error {
  public readonly code = 'TRANSACTION_CONNECTION_ERROR'

  constructor(message: string, options?: { cause?: unknown }) {
    super(message)
    this.name = 'TransactionConnectionError'
    this.cause = options?.cause
    Object.setPrototypeOf(this, TransactionConnectionError.prototype)
  }
}

const TIMEOUT_PATTERNS = [
  /Transaction already closed/i,
  /expired transaction/i,
  /timeout.*transaction/i,
  /transaction.*timeout/i,
  /idle.*transaction.*timeout/i
]

const CONNECTION_PATTERNS = [
  /Can't reach database server/i,
  /Connection refused/i,
  /ECONNREFUSED/i,
  /Connection reset/i,
  /ECONNRESET/i,
  /Connection terminated/i,
  /socket hang up/i
]

function extractTimeoutInfo(message: string): {
  elapsedMs?: number
  timeoutMs?: number
} {
  const elapsedMatch = message.match(/(\d+)\s*ms passed since the start/i)
  const timeoutMatch = message.match(/timeout.*?was\s*(\d+)\s*ms/i)
  return {
    elapsedMs: elapsedMatch ? parseInt(elapsedMatch[1], 10) : undefined,
    timeoutMs: timeoutMatch ? parseInt(timeoutMatch[1], 10) : undefined
  }
}

export function wrapTransactionError(error: unknown): Error {
  if (!(error instanceof Error)) {
    return new Error(String(error))
  }

  const message = error.message

  if (TIMEOUT_PATTERNS.some(pattern => pattern.test(message))) {
    const { elapsedMs, timeoutMs } = extractTimeoutInfo(message)
    getLogger().error(
      { err: error, elapsedMs, timeoutMs },
      'prisma.transaction_timeout'
    )
    // Keep elapsedMs/timeoutMs as structured fields (logs/Sentry) but stop
    // baking them into `.message`: import.ts stringifies `.message` straight
    // into the API response (catch-path that bypasses the toApiError 503
    // sanitizer), and the throw-path sanitizer already strips timing too.
    return new TransactionTimeoutError('Database transaction timed out', {
      elapsedMs,
      timeoutMs,
      cause: error
    })
  }

  if (CONNECTION_PATTERNS.some(pattern => pattern.test(message))) {
    getLogger().error({ err: error }, 'prisma.connection_error')
    return new TransactionConnectionError(
      'Database connection failed during transaction',
      { cause: error }
    )
  }

  return error
}

export interface TransactionOptions {
  maxWait?: number
  timeout?: number
  isolationLevel?: Prisma.TransactionIsolationLevel
}

export async function safeTransaction<T>(
  prisma: PrismaClient,
  fn: (tx: TransactionClient) => Promise<T>,
  options?: TransactionOptions
): Promise<T> {
  try {
    return await prisma.$transaction(fn, options)
  } catch (error) {
    throw wrapTransactionError(error)
  }
}

export interface BatchedTransactionOptions<T> {
  items: T[]
  batchSize: number
  prisma: PrismaClient
  processBatch: (
    tx: TransactionClient,
    batch: T[]
  ) => Promise<{ processed: number }>
  transactionOptions?: TransactionOptions
  onBatchComplete?: (result: { batch: number; processed: number }) => void
}

export async function batchedTransaction<T>(
  options: BatchedTransactionOptions<T>
): Promise<{ totalProcessed: number; batches: number }> {
  const {
    items,
    batchSize,
    prisma,
    processBatch,
    transactionOptions,
    onBatchComplete
  } = options

  let totalProcessed = 0
  let batchNumber = 0

  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize)
    batchNumber++

    const result = await safeTransaction(
      prisma,
      async tx => processBatch(tx, batch),
      transactionOptions
    )

    totalProcessed += result.processed
    onBatchComplete?.({ batch: batchNumber, processed: result.processed })
  }

  return { totalProcessed, batches: batchNumber }
}
