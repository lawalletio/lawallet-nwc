'use client'

import { useState } from 'react'
import { useActiveCurrencies } from '@/lib/client/currencies-store'
import { useYadioRates } from '@/lib/client/use-yadio-ticker'
import { currencyUnitLabel } from '@/lib/client/format-sats'
import { parseKeypadValue } from '@/components/wallet/shared/amount-keypad'
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
  const [canonicalAmount, setCanonicalAmount] = useState<number | null>(
    seededSats
  )
  const [value, setValue] = useState<string>(() =>
    formatInputFromSats(seededSats, initialCurrencyCode, rates)
  )
  const [currencyCode, setCurrencyCode] = useState<string>(initialCurrencyCode)

  const selectedCode = activeCurrencies.some(
    currency => currency.code === currencyCode
  )
    ? currencyCode
    : (activeCurrencies[0]?.code ?? 'SAT')
  const keypad = keypadOptionsForCurrency(selectedCode)
  const liveParsed = parseAmountToSats(value, selectedCode, rates)
  const draftBelongsToSelected = selectedCode === currencyCode
  const displayValue =
    draftBelongsToSelected &&
    (liveParsed !== null || parseKeypadValue(value) !== null)
      ? value
      : formatInputFromSats(canonicalAmount, selectedCode, rates)
  const submittableAmount = parseAmountToSats(
    displayValue,
    selectedCode,
    rates
  )

  function handleAmountChange(nextValue: string) {
    setValue(nextValue)
    setCurrencyCode(selectedCode)
    setCanonicalAmount(parseAmountToSats(nextValue, selectedCode, rates))
  }

  function handleCurrencyChange(nextCode: string) {
    const from = liveParsed ?? canonicalAmount
    setValue(formatInputFromSats(from, nextCode, rates))
    setCurrencyCode(nextCode)
    setCanonicalAmount(from)
  }

  return {
    value: displayValue,
    onAmountChange: handleAmountChange,
    currencyCode: selectedCode,
    onCurrencyChange: handleCurrencyChange,
    canonicalAmount: submittableAmount,
    displayUnit: currencyUnitLabel(selectedCode),
    activeCurrencies,
    integerOnly: keypad.integerOnly,
    fixedDecimalDigits: keypad.fixedDecimalDigits,
    maxDecimalDigits: keypad.maxDecimalDigits
  }
}
