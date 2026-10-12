import { act, cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  __resetYadioStore,
  refreshYadioRates,
  useYadioRates
} from '@/lib/client/use-yadio-ticker'

const STORAGE_KEY = 'lawallet-yadio-rates'

function Rates() {
  const { btcUsd, loading } = useYadioRates()
  return <span data-testid="usd">{loading ? 'loading' : String(btcUsd)}</span>
}

function setHidden(hidden: boolean) {
  Object.defineProperty(document, 'hidden', {
    configurable: true,
    get: () => hidden
  })
  document.dispatchEvent(new Event('visibilitychange'))
}

const fetchMock = vi.fn()

beforeEach(() => {
  __resetYadioStore()
  window.localStorage.clear()
  fetchMock.mockReset()
  fetchMock.mockImplementation(async () => ({
    ok: true,
    json: async () => ({ BTC: { USD: 100_000, EUR: 90_000 } })
  }))
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  // Unmount before restoring `fetch`, or the visibility reset below would
  // let the still-subscribed store hit the real network.
  cleanup()
  setHidden(false)
  vi.unstubAllGlobals()
})

describe('useYadioRates shared store', () => {
  it('serves every consumer from one request', async () => {
    const { getAllByTestId } = render(
      <>
        <Rates />
        <Rates />
        <Rates />
      </>
    )
    await waitFor(() =>
      getAllByTestId('usd').forEach(el => expect(el.textContent).toBe('100000'))
    )
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal)
  })

  it('dedupes concurrent refreshes and honours the TTL', async () => {
    await Promise.all([refreshYadioRates(), refreshYadioRates()])
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await refreshYadioRates()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('reuses a fresh localStorage table without fetching', async () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ rates: { USD: 42 }, fetchedAt: Date.now() })
    )
    const { getByTestId } = render(<Rates />)
    expect(getByTestId('usd').textContent).toBe('42')
    await act(async () => {})
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('pauses while hidden and refreshes when visible again', async () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ rates: { USD: 42 }, fetchedAt: 0 })
    )
    setHidden(true)
    render(<Rates />)
    await act(async () => {})
    expect(fetchMock).not.toHaveBeenCalled()

    await act(async () => setHidden(false))
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('keeps the last table and surfaces the error when a fetch fails', async () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ rates: { USD: 42 }, fetchedAt: 0 })
    )
    fetchMock.mockRejectedValueOnce(new Error('timeout'))
    const { getByTestId } = render(<Rates />)
    await act(async () => {})
    expect(getByTestId('usd').textContent).toBe('42')
  })
})
