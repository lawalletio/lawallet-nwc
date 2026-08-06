import pino from 'pino'
import { describe, expect, it, vi } from 'vitest'
import { createProcessErrorReporter } from '../src/process-errors'

describe('process error reporter', () => {
  it('rate limits identical bare rejections without wrapping them in Error', () => {
    const error = vi.fn()
    let now = 1_000
    const report = createProcessErrorReporter(
      { error } as unknown as Pick<pino.Logger, 'error'>,
      { windowMs: 100, now: () => now }
    )

    report('unhandled_rejection', 'relay disconnected')
    report('unhandled_rejection', 'relay disconnected')

    expect(error).toHaveBeenCalledTimes(1)
    expect(error).toHaveBeenLastCalledWith(
      { reason: 'relay disconnected', suppressed: 0 },
      'process.unhandled_rejection'
    )

    now += 101
    report('unhandled_rejection', 'relay disconnected')
    expect(error).toHaveBeenCalledTimes(2)
    expect(error).toHaveBeenLastCalledWith(
      { reason: 'relay disconnected', suppressed: 1 },
      'process.unhandled_rejection'
    )
  })

  it('preserves the original Error object for the first diagnostic', () => {
    const error = vi.fn()
    const report = createProcessErrorReporter({
      error
    } as unknown as Pick<pino.Logger, 'error'>)
    const failure = new Error('boom')

    report('uncaught_exception', failure)

    expect(error).toHaveBeenCalledWith(
      { err: failure, suppressed: 0 },
      'process.uncaught_exception'
    )
  })
})
