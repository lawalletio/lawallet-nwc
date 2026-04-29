import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import {
  AmountKeypad,
  parseKeypadValue,
} from '@/components/wallet/shared/amount-keypad'

function Harness({ initial = '0', integerOnly = true }: { initial?: string; integerOnly?: boolean }) {
  const [value, setValue] = useState(initial)
  return (
    <>
      <div data-testid="value">{value}</div>
      <AmountKeypad value={value} onChange={setValue} integerOnly={integerOnly} />
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

  it('rejects decimal input in integer-only mode', () => {
    render(<Harness />)
    expect(screen.queryByLabelText('Enter .')).toBeNull()
  })

  it('allows a single decimal point when not integer-only', async () => {
    const user = userEvent.setup()
    render(<Harness integerOnly={false} />)
    await user.click(screen.getByLabelText('Enter 1'))
    await user.click(screen.getByLabelText('Enter .'))
    await user.click(screen.getByLabelText('Enter 5'))
    await user.click(screen.getByLabelText('Enter .'))
    expect(screen.getByTestId('value').textContent).toBe('1.5')
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
