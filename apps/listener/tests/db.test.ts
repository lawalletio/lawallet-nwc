import { afterEach, describe, expect, it, vi } from 'vitest'
import type pg from 'pg'
import type { Logger } from 'pino'
import { waitForSchema } from '../src/db'

const logMock = () => {
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
  return log as unknown as Logger & typeof log
}

describe('waitForSchema', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns immediately once RemoteWallet exists', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ reg: 'RemoteWallet' }] })
    const pool = { query } as unknown as pg.Pool
    await waitForSchema(pool, logMock())
    expect(query).toHaveBeenCalledTimes(1)
    const [sql] = query.mock.calls[0]
    expect(sql).toContain(`to_regclass('"RemoteWallet"')`)
  })

  it('polls until the table appears, logging while waiting', async () => {
    vi.useFakeTimers()
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ reg: null }] })
      .mockResolvedValueOnce({ rows: [{ reg: null }] })
      .mockResolvedValueOnce({ rows: [{ reg: 'RemoteWallet' }] })
    const pool = { query } as unknown as pg.Pool
    const log = logMock()

    const done = waitForSchema(pool, log)
    await vi.advanceTimersByTimeAsync(2000)
    await vi.advanceTimersByTimeAsync(2000)
    await done

    expect(query).toHaveBeenCalledTimes(3)
    expect(log.info).toHaveBeenCalledWith(
      { attempt: 1 },
      'db.waiting_for_web_migrations'
    )
    expect(log.info).toHaveBeenCalledWith(
      { attempt: 2 },
      'db.waiting_for_web_migrations'
    )
  })

  it('throws after 60 attempts if the table never appears', async () => {
    vi.useFakeTimers()
    const query = vi.fn().mockResolvedValue({ rows: [{ reg: null }] })
    const pool = { query } as unknown as pg.Pool

    let failure: unknown = null
    const done = waitForSchema(pool, logMock()).catch(err => {
      failure = err
    })
    await vi.advanceTimersByTimeAsync(60 * 2000)
    await done

    expect(query).toHaveBeenCalledTimes(60)
    expect(String(failure)).toContain('never appeared')
  })
})
