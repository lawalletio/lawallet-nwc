import { act, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'
import {
  __resetCurrenciesCacheForTests,
  currenciesActions,
  setCurrencyPrefsPersister,
  useSelectedCurrencyCode
} from '@/lib/client/currencies-store'
import {
  __resetCurrencyPrefsSyncForTests,
  CURRENCY_PREFS_PATH,
  CURRENCY_PREFS_SAVE_DEBOUNCE_MS,
  useSyncCurrencyPrefs
} from '@/lib/client/hooks/use-sync-currency-prefs'

const put = vi.fn()
const me = vi.hoisted(() => ({
  data: {
    userId: 'user-1',
    currencyPrefs: {
      active: ['SAT', 'BTC', 'USD'],
      selected: 'USD'
    }
  } as {
    userId: string
    currencyPrefs: { active: string[]; selected: string } | null
  } | null
}))

vi.mock('sonner', () => ({
  toast: { error: vi.fn() }
}))

vi.mock('@/components/admin/auth-context', () => ({
  useAuth: () => ({
    status: 'authenticated',
    apiClient: { put }
  })
}))

vi.mock('@/lib/client/hooks/use-api', () => ({
  useApi: () => ({
    data: me.data,
    loading: false,
    error: null,
    refetch: async () => {}
  })
}))

function Harness() {
  useSyncCurrencyPrefs()
  const selected = useSelectedCurrencyCode()
  return <div data-testid="selected">{selected}</div>
}

describe('useSyncCurrencyPrefs', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    window.localStorage.clear()
    __resetCurrenciesCacheForTests()
    __resetCurrencyPrefsSyncForTests()
    setCurrencyPrefsPersister(null)
    put.mockReset()
    put.mockResolvedValue({})
    vi.mocked(toast.error).mockReset()
    me.data = {
      userId: 'user-1',
      currencyPrefs: {
        active: ['SAT', 'BTC', 'USD'],
        selected: 'USD'
      }
    }
  })

  afterEach(() => {
    __resetCurrencyPrefsSyncForTests()
    setCurrencyPrefsPersister(null)
    vi.useRealTimers()
  })

  it('hydrates from the user record and PUTs later local edits', async () => {
    const view = render(<Harness />)

    expect(view.getByTestId('selected').textContent).toBe('USD')
    expect(put).not.toHaveBeenCalled()

    act(() => {
      currenciesActions.add('EUR')
    })
    expect(put).not.toHaveBeenCalled()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(CURRENCY_PREFS_SAVE_DEBOUNCE_MS)
    })

    expect(put).toHaveBeenCalledTimes(1)
    expect(put).toHaveBeenCalledWith(CURRENCY_PREFS_PATH, {
      currencyPrefs: {
        active: ['SAT', 'BTC', 'USD', 'EUR'],
        selected: 'USD'
      }
    })
  })

  it('keeps a local edit when /api/users/me refetches', async () => {
    const view = render(<Harness />)
    expect(view.getByTestId('selected').textContent).toBe('USD')

    act(() => {
      currenciesActions.select('BTC')
    })
    me.data = {
      userId: 'user-1',
      currencyPrefs: {
        active: ['SAT', 'BTC', 'USD'],
        selected: 'USD'
      }
    }
    view.rerender(<Harness />)

    expect(view.getByTestId('selected').textContent).toBe('BTC')
  })

  it('uploads local prefs once when the server has none', async () => {
    currenciesActions.add('ARS')
    me.data = { userId: 'user-1', currencyPrefs: null }
    const view = render(<Harness />)

    expect(view.getByTestId('selected').textContent).toBe('SAT')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CURRENCY_PREFS_SAVE_DEBOUNCE_MS)
    })

    expect(put).toHaveBeenCalledWith(CURRENCY_PREFS_PATH, {
      currencyPrefs: {
        active: ['SAT', 'BTC', 'ARS'],
        selected: 'SAT'
      }
    })
  })

  it('does not let a later server payload replace an edit made before hydration', async () => {
    me.data = null
    const view = render(<Harness />)

    act(() => {
      currenciesActions.add('USD')
      currenciesActions.select('USD')
    })
    me.data = {
      userId: 'user-1',
      currencyPrefs: {
        active: ['SAT', 'BTC'],
        selected: 'SAT'
      }
    }
    view.rerender(<Harness />)

    expect(view.getByTestId('selected').textContent).toBe('USD')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CURRENCY_PREFS_SAVE_DEBOUNCE_MS)
    })
    expect(put).toHaveBeenCalledWith(CURRENCY_PREFS_PATH, {
      currencyPrefs: {
        active: ['SAT', 'BTC', 'USD'],
        selected: 'USD'
      }
    })
  })

  it('sends only the latest prefs when an earlier save is still in flight', async () => {
    let resolveFirst: (value: unknown) => void = () => {}
    put.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          resolveFirst = resolve
        })
    )
    render(<Harness />)

    act(() => {
      currenciesActions.select('BTC')
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CURRENCY_PREFS_SAVE_DEBOUNCE_MS)
    })
    expect(put).toHaveBeenCalledTimes(1)

    act(() => {
      currenciesActions.select('USD')
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CURRENCY_PREFS_SAVE_DEBOUNCE_MS)
    })
    expect(put).toHaveBeenCalledTimes(1)

    await act(async () => {
      resolveFirst({})
    })

    expect(put).toHaveBeenCalledTimes(2)
    expect(put).toHaveBeenLastCalledWith(CURRENCY_PREFS_PATH, {
      currencyPrefs: {
        active: ['SAT', 'BTC', 'USD'],
        selected: 'USD'
      }
    })
  })

  it('surfaces a failed save', async () => {
    put.mockRejectedValue(new Error('Request failed (500)'))
    render(<Harness />)

    act(() => {
      currenciesActions.select('BTC')
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CURRENCY_PREFS_SAVE_DEBOUNCE_MS)
    })

    expect(toast.error).toHaveBeenCalledWith('Request failed (500)')
  })
})
