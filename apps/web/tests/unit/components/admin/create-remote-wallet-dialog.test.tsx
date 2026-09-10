import { fireEvent, render, screen, waitFor, act } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NwcCapabilities } from '@/lib/client/nwc/probe-capabilities'

const { probeNwcCapabilities, createWallet } = vi.hoisted(() => ({
  probeNwcCapabilities: vi.fn(),
  createWallet: vi.fn()
}))

vi.mock('@/lib/client/nwc/probe-capabilities', async () => {
  const actual = await vi.importActual<
    typeof import('@/lib/client/nwc/probe-capabilities')
  >('@/lib/client/nwc/probe-capabilities')
  return {
    ...actual,
    probeNwcCapabilities
  }
})

vi.mock('@/lib/client/hooks/use-settings', () => ({
  useSettings: () => ({ data: {}, loading: false })
}))

vi.mock('@/lib/client/hooks/use-remote-wallets', () => ({
  useRemoteWalletMutations: () => ({
    createWallet,
    createLncurlWallet: vi.fn(),
    loading: false
  })
}))

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() }
}))

vi.mock('@/components/ui/input-with-qr-scanner', () => ({
  InputWithQrScanner: ({
    id,
    value,
    onChange,
    placeholder,
    disabled
  }: {
    id?: string
    value: string
    onChange: (value: string) => void
    placeholder?: string
    disabled?: boolean
  }) => (
    <input
      id={id}
      value={value}
      placeholder={placeholder}
      disabled={disabled}
      onChange={e => onChange(e.target.value)}
    />
  )
}))

import { CreateRemoteWalletDialog } from '@/components/admin/create-remote-wallet-dialog'

const NWC_URI = 'nostr+walletconnect://view-only-wallet'
const PROBE_DEBOUNCE_MS = 600

function caps(overrides: Partial<NwcCapabilities> = {}): NwcCapabilities {
  return {
    alias: null,
    methods: [],
    canReceive: false,
    canSend: false,
    mode: 'RECEIVE',
    ...overrides
  }
}

function renderDialog() {
  return render(
    <CreateRemoteWalletDialog
      open
      onOpenChange={() => {}}
      showTrigger={false}
    />
  )
}

async function fillAndProbe() {
  fireEvent.change(screen.getByLabelText('Name'), {
    target: { value: 'Watch wallet' }
  })
  fireEvent.change(screen.getByLabelText('Connection string'), {
    target: { value: NWC_URI }
  })
  await act(async () => {
    await vi.advanceTimersByTimeAsync(PROBE_DEBOUNCE_MS + 50)
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  probeNwcCapabilities.mockReset()
  createWallet.mockReset()
  createWallet.mockResolvedValue({
    id: 'w1',
    name: 'Watch wallet',
    type: 'NWC',
    status: 'ACTIVE',
    isDefault: false
  })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('CreateRemoteWalletDialog view-only NWC', () => {
  it('warns for a view-only pairing and does not show Receive only', async () => {
    probeNwcCapabilities.mockResolvedValue(
      caps({
        alias: 'Spectator',
        methods: ['get_info'],
        canReceive: false,
        canSend: false,
        mode: 'RECEIVE'
      })
    )

    renderDialog()
    await fillAndProbe()

    expect(screen.getByText('View-only')).toBeTruthy()
    expect(screen.queryByText('Receive only')).toBeNull()
    expect(
      screen.getByRole('switch', { name: /use for primary address/i })
    ).toBeDisabled()
    expect(
      screen.getAllByText(/cannot be used for your primary Lightning Address/i)
        .length
    ).toBeGreaterThan(0)
  })

  it('does not submit isDefault for a view-only pairing', async () => {
    probeNwcCapabilities.mockResolvedValue(
      caps({
        methods: ['get_info'],
        canReceive: false,
        canSend: false,
        mode: 'RECEIVE'
      })
    )

    renderDialog()
    await fillAndProbe()

    expect(screen.getByText('View-only')).toBeTruthy()

    vi.useRealTimers()
    fireEvent.submit(screen.getByRole('button', { name: 'Add wallet' }))

    await waitFor(() => {
      expect(createWallet).toHaveBeenCalled()
    })
    expect(createWallet).toHaveBeenCalledWith({
      name: 'Watch wallet',
      type: 'NWC',
      config: { connectionString: NWC_URI, mode: 'RECEIVE' },
      isDefault: false
    })
  })

  it('still shows Receive only for a genuine receive-capable wallet', async () => {
    probeNwcCapabilities.mockResolvedValue(
      caps({
        methods: ['make_invoice'],
        canReceive: true,
        canSend: false,
        mode: 'RECEIVE'
      })
    )

    renderDialog()
    await fillAndProbe()

    expect(screen.getByText('Receive only')).toBeTruthy()
    expect(screen.queryByText('View-only')).toBeNull()
    expect(
      screen.getByRole('switch', { name: /use for primary address/i })
    ).not.toBeDisabled()
  })

  it('warns for send-only pairings that cannot receive', async () => {
    probeNwcCapabilities.mockResolvedValue(
      caps({
        methods: ['pay_invoice'],
        canReceive: false,
        canSend: true,
        mode: 'SEND_RECEIVE'
      })
    )

    renderDialog()
    await fillAndProbe()

    expect(screen.getByText('Send only')).toBeTruthy()
    expect(screen.queryByText('Send and receive')).toBeNull()
    expect(
      screen.getByRole('switch', { name: /use for primary address/i })
    ).toBeDisabled()
  })
})
