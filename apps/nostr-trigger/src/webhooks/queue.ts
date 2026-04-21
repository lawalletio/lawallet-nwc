import { Queue, Worker, type Job } from 'bullmq'
import { getBlockingRedis, getRedis } from '../redis/client.js'
import { createChildLogger } from '../logger.js'
import { prisma } from '../db/prisma.js'
import { dispatchWebhook, type WebhookJobData } from './dispatcher.js'
import { computeDelayMs, buildRetryPolicy } from './retry-policy.js'

const log = createChildLogger({ module: 'webhook-queue' })

const QUEUE_NAME = 'nt:webhooks'

let queue: Queue<WebhookJobData> | null = null
let worker: Worker<WebhookJobData> | null = null

export function getQueue(): Queue<WebhookJobData> {
  if (!queue) {
    queue = new Queue<WebhookJobData>(QUEUE_NAME, {
      connection: getRedis(),
      defaultJobOptions: {
        attempts: buildRetryPolicy().attempts,
        removeOnComplete: { age: 3600, count: 500 },
        removeOnFail: { age: 86400 }
      }
    })
  }
  return queue
}

export async function enqueueWebhook(data: WebhookJobData): Promise<void> {
  const q = getQueue()
  await q.add(`evt:${data.eventId}:${data.webhookEndpointId}`, data, {
    jobId: `${data.webhookEndpointId}:${data.eventId}` // also serves as an extra idempotency guard
  })
}

export function startWebhookWorker(): Worker<WebhookJobData> {
  if (worker) return worker

  worker = new Worker<WebhookJobData>(
    QUEUE_NAME,
    async (job: Job<WebhookJobData>) => {
      const result = await dispatchWebhook(job.data)
      if (result.kind === 'success') {
        log.info(
          { jobId: job.id, status: result.status },
          'webhook delivered'
        )
        return result
      }
      if (result.kind === 'terminal') {
        await prisma.auditEvent.create({
          data: {
            source: 'runtime',
            actor: 'system',
            action: 'webhook_terminal_failure',
            target: job.data.webhookEndpointId,
            payload: {
              eventId: job.data.eventId,
              status: result.status,
              reason: result.reason
            } as object
          }
        })
        log.warn(
          { jobId: job.id, reason: result.reason },
          'webhook terminal failure — not retrying'
        )
        await job.discard()
        return result
      }
      throw new Error(`retryable: ${result.reason} (status=${result.status})`)
    },
    {
      connection: getBlockingRedis(),
      concurrency: 10,
      settings: {
        backoffStrategy: (attemptsMade: number) => computeDelayMs(attemptsMade)
      }
    }
  )

  worker.on('failed', async (job, err) => {
    if (!job) return
    if (job.attemptsMade >= (job.opts.attempts ?? 1)) {
      await prisma.auditEvent.create({
        data: {
          source: 'runtime',
          actor: 'system',
          action: 'webhook_exhausted',
          target: job.data.webhookEndpointId,
          payload: {
            eventId: job.data.eventId,
            attempts: job.attemptsMade,
            lastError: err.message
          } as object
        }
      })
      log.error(
        { jobId: job.id, attempts: job.attemptsMade, err: err.message },
        'webhook exhausted all retries'
      )
    }
  })

  worker.on('error', err => {
    log.error({ err }, 'worker error')
  })

  log.info('webhook worker started')
  return worker
}

export async function closeQueue(): Promise<void> {
  await worker?.close()
  await queue?.close()
  worker = null
  queue = null
}

export async function queueDepth(): Promise<{
  waiting: number
  active: number
  delayed: number
  failed: number
}> {
  const q = getQueue()
  const [waiting, active, delayed, failed] = await Promise.all([
    q.getWaitingCount(),
    q.getActiveCount(),
    q.getDelayedCount(),
    q.getFailedCount()
  ])
  return { waiting, active, delayed, failed }
}
