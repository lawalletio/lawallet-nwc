import { act, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  __resetCurrenciesCacheForTests,
  currenciesActions
} from '@/lib/client/currencies-store'
import { useAmountCurrencyInput } from '@/components/wallet/shared/use-amount-currency-input'

vi.mock('@/lib/client/use-yadio-ticker', () => ({
  useYadioRates: () => ({
    rates: { USD: 100_000 },
    btcUsd: 100_000,
    fetchedAt: 1,
    loading: false,
    error: null
  })
}))

function Harness() {
  const input = useAmountCurrencyInput()
  return (
    <>
      <div data-testid="value">{input.value}</div>
      <div data-testid="code">{input.currencyCode}</div>
      <button type="button" onClick={() => input.onCurrencyChange('USD')}>
        usd
      </button>
      <button type="button" onClick={() => input.onAmountChange('12.50')}>
        type
      </button>
    </>
  )
}

describe('useAmountCurrencyInput', () => {
  beforeEach(() => {
    window.localStorage.clear()
    __resetCurrenciesCacheForTests()
  })

  it('reformats canonical sats when the store unit changes under a draft', () => {
    currenciesActions.add('USD')
    render(<Harness />)

    act(() => {
      screen.getByRole('button', { name: 'usd' }).click()
    })
    act(() => {
      screen.getByRole('button', { name: 'type' }).click()
    })

    expect(screen.getByTestId('code').textContent).toBe('USD')
    expect(screen.getByTestId('value').textContent).toBe('12.50')

    act(() => {
      currenciesActions.select('SAT')
    })

    expect(screen.getByTestId('code').textContent).toBe('SAT')
    expect(screen.getByTestId('value').textContent).toBe('12500')
  })
})
