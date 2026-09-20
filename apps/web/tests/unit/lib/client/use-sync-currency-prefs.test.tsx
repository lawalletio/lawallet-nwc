import { act, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  __resetCurrenciesCacheForTests,
  currenciesActions,
  setCurrencyPrefsPersister,
  useSelectedCurrencyCode
} from '@/lib/client/currencies-store'

const put = vi.fn()
const me = vi.hoisted(() => ({
  data: {
    currencyPrefs: {
      active: ['SAT', 'BTC', 'USD'],
      selected: 'USD'
    }
  } as { currencyPrefs: { active: string[]; selected: string } | null }
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

import { useSyncCurrencyPrefs } from '@/lib/client/hooks/use-sync-currency-prefs'

function Harness() {
  useSyncCurrencyPrefs()
  const selected = useSelectedCurrencyCode()
  return <div data-testid="selected">{selected}</div>
}

describe('useSyncCurrencyPrefs', () => {
  beforeEach(() => {
    window.localStorage.clear()
    __resetCurrenciesCacheForTests()
    setCurrencyPrefsPersister(null)
    put.mockReset()
    me.data = {
      currencyPrefs: {
        active: ['SAT', 'BTC', 'USD'],
        selected: 'USD'
      }
    }
  })

  afterEach(() => {
    setCurrencyPrefsPersister(null)
  })

  it('hydrates from the user record and PUTs later local edits', async () => {
    const view = render(<Harness />)

    await waitFor(() => {
      expect(view.getByTestId('selected').textContent).toBe('USD')
    })
    expect(put).not.toHaveBeenCalled()

    act(() => {
      currenciesActions.add('EUR')
    })

    expect(put).toHaveBeenCalledWith('/api/users/me', {
      currencyPrefs: {
        active: ['SAT', 'BTC', 'USD', 'EUR'],
        selected: 'USD'
      }
    })
  })
})
