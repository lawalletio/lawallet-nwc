'use client'

import { useState } from 'react'
import {
  currenciesActions,
  useActiveCurrencies,
  useSelectedCurrencyCode
} from '@/lib/client/currencies-store'
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
  const storedCurrencyCode = useSelectedCurrencyCode()
  const { rates } = useYadioRates()
  const selectedCode = activeCurrencies.some(
    currency => currency.code === storedCurrencyCode
  )
    ? storedCurrencyCode
    : (activeCurrencies[0]?.code ?? 'SAT')
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
    formatInputFromSats(seededSats, selectedCode, rates)
  )
  const [draftCurrency, setDraftCurrency] = useState<string>(selectedCode)
  const stringMatchesUnit = draftCurrency === selectedCode
  const keypad = keypadOptionsForCurrency(
    stringMatchesUnit ? draftCurrency : selectedCode
  )
  const liveParsed = stringMatchesUnit
    ? parseAmountToSats(value, draftCurrency, rates)
    : null
  const displayValue =
    stringMatchesUnit &&
    (liveParsed !== null || parseKeypadValue(value) !== null)
      ? value
      : formatInputFromSats(
          canonicalAmount,
          stringMatchesUnit ? draftCurrency : selectedCode,
          rates
        )
  const submittableAmount = parseAmountToSats(
    displayValue,
    stringMatchesUnit ? draftCurrency : selectedCode,
    rates
  )

  function handleAmountChange(nextValue: string) {
    setValue(nextValue)
    setDraftCurrency(selectedCode)
    setCanonicalAmount(parseAmountToSats(nextValue, selectedCode, rates))
  }

  function handleCurrencyChange(nextCode: string) {
    const from =
      parseAmountToSats(value, draftCurrency, rates) ?? canonicalAmount
    setValue(formatInputFromSats(from, nextCode, rates))
    setDraftCurrency(nextCode)
    currenciesActions.select(nextCode)
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
