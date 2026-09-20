import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  __resetCurrenciesCacheForTests,
  currenciesActions,
  hydrateCurrencyPrefs,
  setCurrencyPrefsPersister,
  useActiveCurrencies,
  useSelectedCurrencyCode
} from '@/lib/client/currencies-store'
import { renderHook, act } from '@testing-library/react'

describe('currencies-store', () => {
  beforeEach(() => {
    window.localStorage.clear()
    __resetCurrenciesCacheForTests()
    setCurrencyPrefsPersister(null)
  })

  it('persists added currencies across a cache reset', () => {
    currenciesActions.add('USD')
    currenciesActions.add('ARS')

    __resetCurrenciesCacheForTests()

    const stored = JSON.parse(
      window.localStorage.getItem('lawallet-active-currencies') ?? 'null'
    )
    expect(stored.active).toEqual(['SAT', 'BTC', 'USD', 'ARS'])

    const { result } = renderHook(() => useActiveCurrencies())
    expect(result.current.map(currency => currency.code)).toEqual([
      'SAT',
      'BTC',
      'USD',
      'ARS'
    ])
  })

  it('persists the selected display currency across a cache reset', () => {
    currenciesActions.add('USD')
    currenciesActions.select('USD')

    __resetCurrenciesCacheForTests()

    const { result } = renderHook(() => useSelectedCurrencyCode())
    expect(result.current).toBe('USD')
  })

  it('reads a legacy array payload as the active list', () => {
    window.localStorage.setItem(
      'lawallet-active-currencies',
      JSON.stringify(['SAT', 'BTC', 'EUR'])
    )

    const { result } = renderHook(() => useActiveCurrencies())
    expect(result.current.map(currency => currency.code)).toEqual([
      'SAT',
      'BTC',
      'EUR'
    ])
  })

  it('falls back when the selected currency is removed', () => {
    currenciesActions.add('USD')
    currenciesActions.select('USD')
    currenciesActions.remove('USD')

    const { result } = renderHook(() => useSelectedCurrencyCode())
    expect(result.current).toBe('SAT')
  })

  it('ignores selecting a currency that is not active', () => {
    currenciesActions.select('JPY')

    const { result } = renderHook(() => useSelectedCurrencyCode())
    expect(result.current).toBe('SAT')
  })

  it('notifies subscribers when the selected currency changes', () => {
    currenciesActions.add('USD')
    const { result } = renderHook(() => useSelectedCurrencyCode())

    act(() => {
      currenciesActions.select('USD')
    })

    expect(result.current).toBe('USD')
  })

  it('replaces local currency preferences with the server record', () => {
    currenciesActions.add('ARS')
    hydrateCurrencyPrefs({
      active: ['SAT', 'BTC', 'USD'],
      selected: 'USD'
    })

    const { result: selected } = renderHook(() => useSelectedCurrencyCode())
    const { result: active } = renderHook(() => useActiveCurrencies())
    expect(selected.current).toBe('USD')
    expect(active.current.map(currency => currency.code)).toEqual([
      'SAT',
      'BTC',
      'USD'
    ])
  })

  it('asks the persister to save local edits but not a server hydrate', () => {
    const persist = vi.fn()
    setCurrencyPrefsPersister(persist)

    currenciesActions.add('USD')
    hydrateCurrencyPrefs({
      active: ['SAT', 'BTC', 'EUR'],
      selected: 'EUR'
    })

    expect(persist).toHaveBeenCalledTimes(1)
    expect(persist).toHaveBeenCalledWith({
      active: ['SAT', 'BTC', 'USD'],
      selected: 'SAT'
    })
  })
})
