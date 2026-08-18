import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useRef, useState } from 'react'
import {
  AmountKeypad,
  parseKeypadValue
} from '@/components/wallet/shared/amount-keypad'

function Harness({
  initial = '0',
  integerOnly = true,
  fixedDecimalDigits,
  onSubmit,
  withNote = false
}: {
  initial?: string
  integerOnly?: boolean
  fixedDecimalDigits?: number
  onSubmit?: () => void
  withNote?: boolean
}) {
  const [value, setValue] = useState(initial)
  const noteRef = useRef<HTMLInputElement>(null)
  return (
    <>
      <div data-testid="value">{value}</div>
      <AmountKeypad
        value={value}
        onChange={setValue}
        integerOnly={integerOnly}
        fixedDecimalDigits={fixedDecimalDigits}
        onSubmit={onSubmit}
        noteRef={withNote ? noteRef : undefined}
      />
      {withNote && <input ref={noteRef} aria-label="note" />}
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

  it('types digits and deletes from the physical keyboard', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.keyboard('123')
    expect(screen.getByTestId('value').textContent).toBe('123')
    await user.keyboard('{Backspace}')
    expect(screen.getByTestId('value').textContent).toBe('12')
  })

  it('submits on Enter', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<Harness onSubmit={onSubmit} />)
    await user.keyboard('5{Enter}')
    expect(screen.getByTestId('value').textContent).toBe('5')
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  it('ignores digits typed into a text input but still submits on Enter', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<Harness onSubmit={onSubmit} withNote />)
    await user.click(screen.getByLabelText('note'))
    await user.keyboard('7{Enter}')
    expect(screen.getByTestId('value').textContent).toBe('0')
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  it('hands typing over to the note field on Tab', async () => {
    const user = userEvent.setup()
    render(<Harness withNote />)
    await user.keyboard('12{Tab}')
    expect(screen.getByTestId('value').textContent).toBe('12')
    expect(screen.getByLabelText('note')).toHaveFocus()
  })

  it('hands typing over to the note field on a non-digit key', async () => {
    const user = userEvent.setup()
    render(<Harness withNote />)
    await user.keyboard('12h')
    expect(screen.getByTestId('value').textContent).toBe('12')
    expect(screen.getByLabelText('note')).toHaveFocus()
  })
})
