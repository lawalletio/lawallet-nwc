import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import {
  AmountKeypad,
  parseKeypadValue
} from '@/components/wallet/shared/amount-keypad'

function Harness({
  initial = '0',
  integerOnly = true,
  fixedDecimalDigits
}: {
  initial?: string
  integerOnly?: boolean
  fixedDecimalDigits?: number
}) {
  const [value, setValue] = useState(initial)
  return (
    <>
      <div data-testid="value">{value}</div>
      <AmountKeypad
        value={value}
        onChange={setValue}
        integerOnly={integerOnly}
        fixedDecimalDigits={fixedDecimalDigits}
      />
    </>
  )
}

describe('AmountKeypad', () => {
  it('appends digits', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByLabelText('Enter 1'))
    await user.click(screen.getByLabelText('Enter 2'))
    await user.click(screen.getByLabelText('Enter 3'))
    expect(screen.getByTestId('value').textContent).toBe('123')
  })

  it('replaces a leading zero with the first digit', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByLabelText('Enter 5'))
    expect(screen.getByTestId('value').textContent).toBe('5')
  })

  it('backspaces down to "0"', async () => {
    const user = userEvent.setup()
    render(<Harness initial="12" />)
    await user.click(screen.getByLabelText('Delete last digit'))
    expect(screen.getByTestId('value').textContent).toBe('1')
    await user.click(screen.getByLabelText('Delete last digit'))
    expect(screen.getByTestId('value').textContent).toBe('0')
  })

  it('hides the double-zero shortcut in integer-only mode', () => {
    render(<Harness />)
    expect(screen.queryByLabelText('Enter 00')).toBeNull()
  })

  it('appends double zero when not integer-only', async () => {
    const user = userEvent.setup()
    render(<Harness integerOnly={false} />)
    await user.click(screen.getByLabelText('Enter 1'))
    await user.click(screen.getByLabelText('Enter 00'))
    expect(screen.getByTestId('value').textContent).toBe('100')
  })

  it('enters fixed-decimal amounts in minor units', async () => {
    const user = userEvent.setup()
    render(<Harness integerOnly={false} fixedDecimalDigits={2} />)
    await user.click(screen.getByLabelText('Enter 1'))
    expect(screen.getByTestId('value').textContent).toBe('0.01')
    await user.click(screen.getByLabelText('Enter 0'))
    expect(screen.getByTestId('value').textContent).toBe('0.10')
    await user.click(screen.getByLabelText('Enter 0'))
    expect(screen.getByTestId('value').textContent).toBe('1.00')
  })
})

describe('parseKeypadValue', () => {
  it('returns null for zero and empty strings', () => {
    expect(parseKeypadValue('0')).toBeNull()
    expect(parseKeypadValue('')).toBeNull()
    expect(parseKeypadValue('.')).toBeNull()
  })

  it('parses a valid positive number', () => {
    expect(parseKeypadValue('1234')).toBe(1234)
    expect(parseKeypadValue('1.5')).toBe(1.5)
  })
})
