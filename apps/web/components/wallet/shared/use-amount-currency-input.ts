'use client'

import { useState } from 'react'
import { useActiveCurrencies } from '@/lib/client/currencies-store'
import { useYadioRates } from '@/lib/client/use-yadio-ticker'
import { currencyUnitLabel } from '@/lib/client/format-sats'
import {
  formatInputFromSats,
  keypadOptionsForCurrency,
  parseAmountToSats
} from '@/components/wallet/shared/amount-currency'

/**
 * Shared amount + currency state for send and receive keypads. Canonical
 * amount is always sats; the keypad string is the currently selected unit.
 */
export function useAmountCurrencyInput(initialSats?: number | null) {
  const activeCurrencies = useActiveCurrencies()
  const { rates } = useYadioRates()
  const initialCurrencyCode = activeCurrencies[0]?.code ?? 'SAT'
  const seededSats =
    typeof initialSats === 'number' &&
    Number.isFinite(initialSats) &&
    initialSats > 0
      ? initialSats
      : null
  const initialValue = formatInputFromSats(
    seededSats,
    initialCurrencyCode,
    rates
  )
  const [canonicalAmount, setCanonicalAmount] = useState<number | null>(
    seededSats
  )
  const [value, setValue] = useState<string>(initialValue)
  const [valuesByCurrency, setValuesByCurrency] = useState<
    Record<string, string>
  >(() => ({
    [initialCurrencyCode]: initialValue
  }))
  const [currencyCode, setCurrencyCode] = useState<string>(initialCurrencyCode)

  const selectedCode = activeCurrencies.some(
    currency => currency.code === currencyCode
  )
    ? currencyCode
    : (activeCurrencies[0]?.code ?? 'SAT')
  const displayValue =
    selectedCode === currencyCode
      ? value
      : (valuesByCurrency[selectedCode] ??
        formatInputFromSats(canonicalAmount, selectedCode, rates))
  const keypad = keypadOptionsForCurrency(selectedCode)

  function handleAmountChange(nextValue: string) {
    setValue(nextValue)
    setCurrencyCode(selectedCode)
    setValuesByCurrency({
      [selectedCode]: nextValue
    })
    setCanonicalAmount(parseAmountToSats(nextValue, selectedCode, rates))
  }

  function handleCurrencyChange(nextCode: string) {
    const nextValue =
      valuesByCurrency[nextCode] ??
      formatInputFromSats(canonicalAmount, nextCode, rates)
    setValue(nextValue)
    setValuesByCurrency(prev => ({
      ...prev,
      [nextCode]: nextValue
    }))
    setCurrencyCode(nextCode)
  }

  return {
    value: displayValue,
    onAmountChange: handleAmountChange,
    currencyCode: selectedCode,
    onCurrencyChange: handleCurrencyChange,
    canonicalAmount,
    displayUnit: currencyUnitLabel(selectedCode),
    activeCurrencies,
    integerOnly: keypad.integerOnly,
    fixedDecimalDigits: keypad.fixedDecimalDigits,
    maxDecimalDigits: keypad.maxDecimalDigits
  }
}
