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

  it('fires onReport only when the throttle admits the error', () => {
    const error = vi.fn()
    const onReport = vi.fn()
    const report = createProcessErrorReporter(
      { error } as unknown as Pick<pino.Logger, 'error'>,
      { windowMs: 100, now: () => 1_000, onReport }
    )
    const boom = new Error('boom')

    report('uncaught_exception', boom)
    expect(onReport).toHaveBeenCalledTimes(1)
    expect(onReport).toHaveBeenCalledWith('uncaught_exception', boom)

    // Immediate duplicate is suppressed — no second report.
    report('uncaught_exception', boom)
    expect(onReport).toHaveBeenCalledTimes(1)

    // A different error gets its own bucket and reports right away.
    const other = new Error('other')
    report('uncaught_exception', other)
    expect(onReport).toHaveBeenCalledTimes(2)
    expect(onReport).toHaveBeenLastCalledWith('uncaught_exception', other)
  })
})
