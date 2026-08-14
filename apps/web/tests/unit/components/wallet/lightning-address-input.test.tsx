import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { __resetContactsCacheForTests } from '@/lib/client/contacts-store'
import { LightningAddressInput } from '@/components/wallet/shared/lightning-address-input'

vi.mock('@/lib/client/hooks/use-api', () => ({
  useApi: () => ({ data: { lightningAddress: 'me@lawallet.io' } })
}))

function seedContacts(count: number) {
  const contacts = Array.from({ length: count }, (_, i) => ({
    id: `c${i}`,
    name: `user${i}`,
    lightningAddress: `user${i}@lawallet.io`,
    createdAt: 1000 - i
  }))
  window.localStorage.setItem('lawallet-contacts', JSON.stringify(contacts))
  __resetContactsCacheForTests()
}

/** The component is controlled; tests need a host that owns the value. */
function Harness(
  props: Partial<React.ComponentProps<typeof LightningAddressInput>>
) {
  const [value, setValue] = useState('')
  return <LightningAddressInput value={value} onChange={setValue} {...props} />
}

describe('LightningAddressInput', () => {
  beforeEach(() => {
    window.localStorage.clear()
    __resetContactsCacheForTests()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 404 }))
    )
  })

  it('keeps the list closed until the popover field is focused', async () => {
    const user = userEvent.setup()
    seedContacts(3)
    render(<Harness />)

    expect(screen.queryByRole('listbox')).toBeNull()

    await user.click(screen.getByRole('combobox'))

    expect(screen.getByRole('listbox')).toBeInTheDocument()
  })

  it('shows the list immediately in the inline variant', () => {
    seedContacts(3)
    render(<Harness variant="inline" />)

    expect(screen.getByRole('listbox')).toBeInTheDocument()
  })

  it('reports the picked address to the caller', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    seedContacts(2)
    render(<Harness onSelect={onSelect} />)

    await user.click(screen.getByRole('combobox'))
    await user.click(screen.getAllByRole('option')[0])

    expect(onSelect).toHaveBeenCalledWith('user0@lawallet.io')
  })

  it('lowercases what the user types, so every surface agrees', async () => {
    const user = userEvent.setup()
    render(<Harness variant="inline" />)

    await user.type(screen.getByRole('combobox'), 'SAToshi')

    expect(screen.getByRole('combobox')).toHaveValue('satoshi')
  })

  it('moves the active option with the arrow keys and selects with Enter', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    seedContacts(3)
    render(<Harness variant="inline" onSelect={onSelect} />)

    const input = screen.getByRole('combobox')
    await user.click(input)
    await user.keyboard('{ArrowDown}')

    expect(screen.getAllByRole('option')[0]).toHaveAttribute(
      'aria-selected',
      'true'
    )

    await user.keyboard('{Enter}')
    expect(onSelect).toHaveBeenCalledWith('user0@lawallet.io')
  })

  it('gives each instance its own listbox id', async () => {
    const user = userEvent.setup()
    seedContacts(2)
    render(
      <>
        <Harness variant="inline" />
        <Harness variant="inline" />
      </>
    )

    const [first, second] = screen.getAllByRole('listbox')
    expect(first.id).not.toBe(second.id)

    // …and each field points at its own list.
    const [firstInput, secondInput] = screen.getAllByRole('combobox')
    expect(firstInput.getAttribute('aria-controls')).toBe(first.id)
    expect(secondInput.getAttribute('aria-controls')).toBe(second.id)
    await user.click(firstInput)
  })

  it('does not suggest for an invoice', async () => {
    const user = userEvent.setup()
    render(<Harness variant="inline" allowNonAddress />)

    await user.type(screen.getByRole('combobox'), 'lnbc10u1p3xyz')

    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('collapses to the single row once the typed value matches exactly', async () => {
    const user = userEvent.setup()
    render(<Harness variant="inline" />)

    await user.type(screen.getByRole('combobox'), 'satoshi')
    expect(screen.getAllByRole('option').length).toBeGreaterThan(1)

    // Finishing the address settles the choice — the other domains are noise.
    await user.type(screen.getByRole('combobox'), '@blink.sv')

    const options = screen.getAllByRole('option')
    expect(options).toHaveLength(1)
    expect(options[0]).toHaveTextContent('satoshi@blink.sv')
    // …and it is pre-highlighted, so Enter commits without an ArrowDown.
    expect(options[0]).toHaveAttribute('aria-selected', 'true')
  })

  it('commits the exact match on Enter with no arrow keys', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(<Harness variant="inline" onSelect={onSelect} />)

    await user.type(screen.getByRole('combobox'), 'satoshi@blink.sv')
    await user.keyboard('{Enter}')

    expect(onSelect).toHaveBeenCalledWith('satoshi@blink.sv')
  })

  it('shows the recipient and a Change button once the address settles', async () => {
    const user = userEvent.setup()
    render(<Harness variant="inline" />)

    const input = screen.getByRole('combobox')
    await user.type(input, 'satoshi@blink.sv')
    // Focused: still editing, so no avatar furniture in the way.
    expect(screen.queryByRole('button', { name: 'Change' })).toBeNull()

    await user.tab()

    expect(screen.getByRole('button', { name: 'Change' })).toBeInTheDocument()
  })

  it('Change hands focus back with the address selected, not cleared', async () => {
    const user = userEvent.setup()
    render(<Harness variant="inline" />)

    const input = screen.getByRole('combobox') as HTMLInputElement
    await user.type(input, 'satoshi@blink.sv')
    await user.tab()
    await user.click(screen.getByRole('button', { name: 'Change' }))

    expect(input).toHaveFocus()
    // A mis-click must not destroy the address.
    expect(input.value).toBe('satoshi@blink.sv')
    expect(input.selectionStart).toBe(0)
    expect(input.selectionEnd).toBe('satoshi@blink.sv'.length)
  })

  it('keeps the same input node when the address settles', async () => {
    const user = userEvent.setup()
    render(<Harness variant="inline" />)

    const before = screen.getByRole('combobox')
    await user.type(before, 'satoshi@blink.sv')
    await user.tab()

    // Remounting the input here would drop focus mid-typing and orphan refs.
    expect(screen.getByRole('combobox')).toBe(before)
  })

  it('hides saved contacts when asked', async () => {
    const user = userEvent.setup()
    seedContacts(3)
    render(<Harness hideContacts />)

    await user.click(screen.getByRole('combobox'))

    expect(screen.queryByRole('group', { name: 'Saved' })).toBeNull()
  })
})
