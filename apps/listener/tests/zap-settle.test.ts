import { createHmac } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Logger } from 'pino'
import {
  requestZapSettlement,
  ZapSettleScheduler,
  type ZapSettleOutcome
} from '../src/zap-settle'
import type { ListenerEnv } from '../src/env'

function env(overrides: Partial<ListenerEnv> = {}): ListenerEnv {
  return {
    LISTENER_AUTH_SECRET: 'listener-shared-secret-0123456789abcdef',
    WEB_ORIGIN: 'https://lawallet.example',
    ...overrides
  } as ListenerEnv
}

function logger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  } as unknown as Logger
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('zap settlement wakeup', () => {
  it('HMAC-signs the tick and names no invoice', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(Response.json({ accepted: true }))
    vi.stubGlobal('fetch', fetchMock)
    const config = env()

    await requestZapSettlement(config, logger())

    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.toString()).toBe(
      'https://lawallet.example/api/internal/zaps/settle'
    )
    const headers = init.headers as Record<string, string>
    const raw = String(init.body)
    // The listener stays transport-only: web selects the candidates, so the
    // body carries no settlement opinion and no invoice id.
    expect(raw).toBe('{}')
    const expected = createHmac('sha256', config.LISTENER_AUTH_SECRET)
      .update(`${headers['x-lawallet-timestamp']}.${raw}`)
      .digest('hex')
    expect(headers['x-lawallet-signature']).toBe(`sha256=${expected}`)
  })

  it('warns without throwing when web rejects the tick', async () => {
    // A web build predating this endpoint answers 404 — the listener must keep
    // ticking rather than crash the process.
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response('not found', { status: 404 }))
    vi.stubGlobal('fetch', fetchMock)
    const log = logger()

    await expect(requestZapSettlement(env(), log)).resolves.toEqual({
      pending: null,
      nextPollAt: null
    })
    expect(log.warn).toHaveBeenCalledWith(
      { status: 404 },
      'zap_settle.web_rejected_request'
    )
  })

  it('warns without throwing when web is unreachable', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'))
    vi.stubGlobal('fetch', fetchMock)
    const log = logger()

    await expect(requestZapSettlement(env(), log)).resolves.toEqual({
      pending: null,
      nextPollAt: null
    })
    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      'zap_settle.web_unreachable'
    )
  })
})

describe('zap settlement ack', () => {
  it('reads the backlog web reports', async () => {
    const nextPollAt = '2026-10-12T12:01:00.000Z'
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ accepted: true, pending: true, nextPollAt })
        )
    )

    await expect(requestZapSettlement(env(), logger())).resolves.toEqual({
      pending: true,
      nextPollAt: new Date(nextPollAt)
    })
  })

  it('treats an older web that only says accepted as unknown', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(Response.json({ accepted: true }))
    )

    await expect(requestZapSettlement(env(), logger())).resolves.toEqual({
      pending: null,
      nextPollAt: null
    })
  })

  it('ignores an unparseable nextPollAt', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ pending: false, nextPollAt: 'not-a-date' })
        )
    )

    await expect(requestZapSettlement(env(), logger())).resolves.toEqual({
      pending: false,
      nextPollAt: null
    })
  })
})

describe('ZapSettleScheduler', () => {
  const FAST = 20_000
  const MAX = 300_000
  const idle: ZapSettleOutcome = { pending: false, nextPollAt: null }
  const busy: ZapSettleOutcome = { pending: true, nextPollAt: null }
  const unknown: ZapSettleOutcome = { pending: null, nextPollAt: null }

  /** Gaps between consecutive ticks, in ms, for the scripted outcomes. */
  async function gaps(
    outcomes: ZapSettleOutcome[],
    during?: (scheduler: ZapSettleScheduler, tick: number) => void
  ) {
    vi.useFakeTimers()
    const at: number[] = []
    let i = 0
    const scheduler = new ZapSettleScheduler(
      async () => {
        at.push(Date.now())
        return outcomes[Math.min(i++, outcomes.length - 1)]
      },
      { fastMs: FAST, maxMs: MAX }
    )
    const start = Date.now()
    scheduler.start()
    while (at.length < outcomes.length) {
      await vi.advanceTimersToNextTimerAsync()
      during?.(scheduler, at.length)
    }
    scheduler.stop()
    return at.map((t, n) => t - (n === 0 ? start : at[n - 1]))
  }

  it('ticks fast while web reports open zap invoices', async () => {
    await expect(gaps([busy, busy, busy, busy])).resolves.toEqual([
      FAST,
      FAST,
      FAST,
      FAST
    ])
  })

  it('backs off exponentially to the max while idle', async () => {
    await expect(
      gaps([idle, idle, idle, idle, idle, idle, idle])
    ).resolves.toEqual([FAST, 2 * FAST, 4 * FAST, 8 * FAST, MAX, MAX, MAX])
  })

  it('keeps the fixed cadence for an older web (unknown backlog)', async () => {
    await expect(gaps([unknown, unknown, unknown])).resolves.toEqual([
      FAST,
      FAST,
      FAST
    ])
  })

  it('drops back to fast as soon as web reports work again', async () => {
    await expect(gaps([idle, idle, idle, busy, idle])).resolves.toEqual([
      FAST,
      2 * FAST,
      4 * FAST,
      8 * FAST,
      FAST
    ])
  })

  it('sleeps until the next invoice is due, within [fast, max]', () => {
    const scheduler = new ZapSettleScheduler(async () => busy, {
      fastMs: FAST,
      maxMs: MAX
    })
    const now = Date.now()
    const due = (ms: number) => ({
      pending: true,
      nextPollAt: new Date(now + ms)
    })
    expect(scheduler.nextDelay(due(60_000), now)).toBe(60_000)
    expect(scheduler.nextDelay(due(1_000), now)).toBe(FAST)
    expect(scheduler.nextDelay(due(60 * 60_000), now)).toBe(MAX)
  })

  it('resets to fast when a payment event wakes it', async () => {
    // Backed off to 160s; a wake right after the 4th tick pulls the next one
    // in to the fast cadence and restarts the backoff from there.
    await expect(
      gaps([idle, idle, idle, idle, idle, idle], (scheduler, tick) => {
        if (tick === 4) scheduler.wake()
      })
    ).resolves.toEqual([FAST, 2 * FAST, 4 * FAST, 8 * FAST, FAST, 2 * FAST])
  })

  it('a wake while a tick is in flight shortens the next gap', async () => {
    vi.useFakeTimers()
    let release!: (outcome: ZapSettleOutcome) => void
    const tick = vi.fn(
      () => new Promise<ZapSettleOutcome>(resolve => (release = resolve))
    )
    const scheduler = new ZapSettleScheduler(tick, { fastMs: FAST, maxMs: MAX })
    // Push the idle backoff up first.
    scheduler.nextDelay(idle)
    scheduler.nextDelay(idle)
    scheduler.start()
    await vi.advanceTimersByTimeAsync(FAST)
    expect(tick).toHaveBeenCalledTimes(1)
    scheduler.wake()
    release(idle)
    await vi.advanceTimersByTimeAsync(FAST)
    expect(tick).toHaveBeenCalledTimes(2)
    scheduler.stop()
  })

  it('stops ticking after stop()', async () => {
    vi.useFakeTimers()
    const tick = vi.fn(async () => busy)
    const scheduler = new ZapSettleScheduler(tick, { fastMs: FAST, maxMs: MAX })
    scheduler.start()
    scheduler.stop()
    scheduler.wake()
    await vi.advanceTimersByTimeAsync(10 * MAX)
    expect(tick).not.toHaveBeenCalled()
  })
})
