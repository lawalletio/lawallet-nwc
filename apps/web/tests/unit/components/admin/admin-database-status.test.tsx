import { act, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() })
}))
vi.mock('@/components/admin/auth-context', () => ({
  useAuth: () => ({ status: 'authenticated' })
}))

import { useDatabaseStatus } from '@/components/admin/admin-layout-shell'

let latest: ReturnType<typeof useDatabaseStatus>
const capture = (state: typeof latest) => {
  latest = state
}
function Probe() {
  capture(useDatabaseStatus(true))
  return null
}

const fetchMock = vi.fn()
const down = async () => ({
  ok: false,
  json: async () => ({ database: 'down', message: 'DB down' })
})
const up = async () => ({ ok: true, json: async () => ({ database: 'up' }) })

function setOnline(online: boolean) {
  Object.defineProperty(navigator, 'onLine', {
    configurable: true,
    get: () => online
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  setOnline(true)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('useDatabaseStatus', () => {
  it('ignores a single failed probe', async () => {
    fetchMock.mockImplementationOnce(down).mockImplementation(up)
    render(<Probe />)
    await act(async () => {})
    expect(latest.error).toBeNull()

    // The quick re-probe succeeds and resets the streak.
    await act(async () => vi.advanceTimersByTimeAsync(3_000))
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(latest.error).toBeNull()
  })

  it('reports an outage after two consecutive failures', async () => {
    fetchMock.mockImplementation(down)
    render(<Probe />)
    await act(async () => {})
    expect(latest.error).toBeNull()
    await act(async () => vi.advanceTimersByTimeAsync(3_000))
    expect(latest.error?.message).toBe('DB down')

    fetchMock.mockImplementation(up)
    await act(async () => latest.refetch())
    expect(latest.error).toBeNull()
  })

  it('does not count failures while the browser is offline', async () => {
    setOnline(false)
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    render(<Probe />)
    await act(async () => {})
    await act(async () => vi.advanceTimersByTimeAsync(60_000))
    expect(latest.error).toBeNull()
  })
})
