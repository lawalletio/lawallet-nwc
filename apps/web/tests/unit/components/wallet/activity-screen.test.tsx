import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ActivityScreen } from '@/components/wallet/activity/activity-screen'
import { HomeScreen } from '@/components/wallet/home-screen'
import { useApi } from '@/lib/client/hooks/use-api'
import {
  recallActivityTx,
  __resetActivityDetailStoreForTests
} from '@/lib/client/activity-detail-store'
import type { NwcTransaction } from '@/lib/client/nwc/transactions'

const labelState = vi.hoisted(() => ({
  label: 'Groceries' as string | null,
  loading: false,
  error: null as Error | null
}))
const listMock = vi.hoisted(() => vi.fn())
const refetchMock = vi.hoisted(() => vi.fn())
const saveTagMock = vi.hoisted(() => vi.fn())
const deleteTagMock = vi.hoisted(() => vi.fn())

vi.mock('next/navigation', () => ({
  useRouter: () => ({ back: vi.fn(), push: vi.fn(), prefetch: vi.fn() })
}))

vi.mock('@/lib/client/hooks/use-api', () => ({
  invalidateApiPath: vi.fn(),
  useApi: vi.fn((path: string | null) =>
    path === '/api/users/me'
      ? {
          data: {
            effectiveNwcString: 'nostr+walletconnect://test',
            nwcString: ''
          },
          loading: false,
          error: null,
          refetch: vi.fn()
        }
      : path === '/api/wallet/transaction-tags'
        ? {
            data: { tags: ['Groceries', 'Travel'] },
            loading: false,
            error: null,
            refetch: refetchMock
          }
        : {
            data: path ? { label: labelState.label } : null,
            loading: labelState.loading,
            error: labelState.error,
            refetch: refetchMock
          }
  )
}))
vi.mock('@/components/wallet/nwc-provider', () => ({
  useWalletNwcTransactions: vi.fn(),
  useWalletNwc: () => ({
    sats: 1000,
    loading: false,
    error: null,
    fromCache: false,
    status: 'connected',
    refetch: vi.fn(),
    nwcString: 'nostr+walletconnect://test'
  })
}))
vi.mock('@/components/admin/auth-context', () => ({
  useAuth: () => ({
    pubkey: 'test-owner',
    logout: vi.fn(),
    apiClient: { put: saveTagMock, del: deleteTagMock }
  })
}))
vi.mock('@/lib/client/hooks/use-settings', () => ({
  useSettings: () => ({ data: {} })
}))
vi.mock('@/lib/client/hooks/use-brand', () => ({
  useBrandLogotypes: () => ({ isotypo: '/logo.svg', logotype: '/logo.svg' })
}))
vi.mock('@/lib/client/nostr-profile', () => ({
  useNostrProfile: () => ({ profile: null })
}))
vi.mock('@/components/pwa/first-load-progress', () => ({
  useFirstLoadProgress: () => ({ report: vi.fn() })
}))
vi.mock('@/lib/client/use-yadio-ticker', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/client/use-yadio-ticker')>()),
  useYadioRates: () => ({ rates: {} })
}))
vi.mock('@/lib/client/nwc', () => ({ listTransactions: listMock }))
vi.mock('@/lib/client/cache/activity-cache', () => ({
  readRecent: async () => [],
  upsertMany: vi.fn()
}))
vi.mock('@/components/wallet/shared/nav-tabbar', () => ({
  NavTabbar: () => null
}))

const hash = 'a'.repeat(64)
const tx: NwcTransaction = {
  paymentHash: hash,
  type: 'incoming',
  amountSats: 2500,
  feesPaidSats: 0,
  description:
    'A long payment message that should be readable without leaving activity',
  preimage: null,
  settledAt: Date.now(),
  createdAt: Date.now()
}

beforeEach(() => {
  vi.clearAllMocks()
  __resetActivityDetailStoreForTests()
  window.history.replaceState({}, '', '/wallet/activity')
  labelState.label = 'Groceries'
  labelState.loading = false
  labelState.error = null
  listMock.mockResolvedValue([tx])
  saveTagMock.mockImplementation(
    async (_path: string, body: { label: string }) => ({
      label: body.label || null
    })
  )
})

describe('ActivityScreen quick transaction information', () => {
  it('replaces the empty icon with the selected tag and returns to it after removal', async () => {
    labelState.label = null
    saveTagMock.mockImplementation(
      async (_path: string, body: { label: string }) => {
        labelState.label = body.label || null
        return { label: labelState.label }
      }
    )
    render(<ActivityScreen />)
    const trigger = await screen.findByRole('button', { name: 'Choose tag' })
    expect(trigger).toHaveTextContent('')
    await userEvent.click(trigger)
    await userEvent.click(screen.getByRole('button', { name: 'Travel' }))
    expect(trigger).toHaveTextContent('Travel')
    expect(screen.getAllByText('Travel')).toHaveLength(1)
    await userEvent.click(trigger)
    await userEvent.click(screen.getByRole('button', { name: 'Remove tag' }))
    expect(trigger).toHaveAccessibleName('Choose tag')
    expect(trigger).toHaveTextContent('')
    expect(screen.queryByText('Travel')).not.toBeInTheDocument()
    expect(recallActivityTx(hash)).toBeNull()
  })
  it('offers removal from the transaction without a separate tag deletion button', async () => {
    render(<ActivityScreen />)
    await userEvent.click(
      await screen.findByRole('button', { name: /Choose tag/ })
    )
    expect(
      screen.queryByRole('button', { name: /Delete tag/ })
    ).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Remove tag' }))
    expect(saveTagMock).toHaveBeenCalledWith(
      `/api/wallet/transactions/${hash}/label`,
      { label: '' }
    )
    expect(deleteTagMock).not.toHaveBeenCalled()
  })
  it('shows the persisted tag in the closed transaction row without opening anything', async () => {
    render(<ActivityScreen />)
    const row = await screen.findByRole('link', {
      name: /A long payment message/
    })
    expect(within(row).queryByText('Groceries')).not.toBeInTheDocument()
    expect(
      within(screen.getByRole('button', { name: /Choose tag/ })).getByText(
        'Groceries'
      )
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /Expand transaction information/ })
    ).toHaveAttribute('aria-expanded', 'false')
    expect(recallActivityTx(hash)).toBeNull()
  })
  it('closes the tag selector with Escape and restores keyboard focus without navigation', async () => {
    const user = userEvent.setup()
    render(<ActivityScreen />)
    const trigger = await screen.findByRole('button', { name: /Choose tag/ })
    trigger.focus()
    await user.keyboard('{Enter}')
    expect(screen.getByRole('button', { name: 'Travel' })).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(
      screen.queryByRole('button', { name: 'Travel' })
    ).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
    expect(recallActivityTx(hash)).toBeNull()
  })
  it('removes the current tag directly from the selector', async () => {
    render(<ActivityScreen />)
    await userEvent.click(
      await screen.findByRole('button', { name: /Choose tag/ })
    )
    expect(screen.getByRole('button', { name: 'Groceries' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    await userEvent.click(screen.getByRole('button', { name: 'Remove tag' }))
    expect(saveTagMock).toHaveBeenCalledWith(
      `/api/wallet/transactions/${hash}/label`,
      { label: '' }
    )
    await userEvent.click(
      screen.getByRole('button', { name: /Expand transaction information/ })
    )
    expect(screen.getByText('No tag')).toBeInTheDocument()
  })
  it('blocks tag changes and offers retry when the saved tag could not be loaded', async () => {
    labelState.error = new Error('Offline')
    render(<ActivityScreen />)
    await userEvent.click(
      await screen.findByRole('button', { name: /Choose tag/ })
    )
    expect(screen.getByRole('button', { name: 'Add new tag' })).toBeDisabled()
    expect(screen.getByText('Could not load tags.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Retry tags' }))
    expect(refetchMock).toHaveBeenCalled()
    expect(saveTagMock).not.toHaveBeenCalled()
  })
  it('creates and assigns a new tag with + while the chevron remains closed', async () => {
    render(<HomeScreen />)
    await userEvent.click(
      await screen.findByRole('button', { name: /Choose tag/ })
    )
    await userEvent.click(screen.getByRole('button', { name: 'Add new tag' }))
    const input = screen.getByRole('textbox', { name: 'New tag' })
    expect(input).toHaveFocus()
    await userEvent.type(input, '  Books  ')
    await userEvent.click(
      screen.getByRole('button', { name: 'Create and apply' })
    )
    expect(saveTagMock).toHaveBeenCalledWith(
      `/api/wallet/transactions/${hash}/label`,
      { label: 'Books' }
    )
    expect(
      screen.getByRole('button', { name: /Expand transaction information/ })
    ).toHaveAttribute('aria-expanded', 'false')
    expect(recallActivityTx(hash)).toBeNull()
  })
  it('retains a new tag draft when saving fails, without claiming it was applied', async () => {
    saveTagMock.mockRejectedValue(new Error('Offline'))
    render(<ActivityScreen />)
    await userEvent.click(
      await screen.findByRole('button', { name: /Choose tag/ })
    )
    await userEvent.click(screen.getByRole('button', { name: 'Add new tag' }))
    await userEvent.type(
      screen.getByRole('textbox', { name: 'New tag' }),
      'Books'
    )
    await userEvent.click(
      screen.getByRole('button', { name: 'Create and apply' })
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not save tag'
    )
    expect(screen.getByRole('textbox', { name: 'New tag' })).toHaveValue(
      'Books'
    )
    expect(
      screen.getByRole('button', { name: 'Create and apply' })
    ).toBeEnabled()
    expect(recallActivityTx(hash)).toBeNull()
  })
  it('assigns a saved tag directly from the icon without expanding or navigating', async () => {
    render(<ActivityScreen />)
    const trigger = await screen.findByRole('button', { name: /Choose tag/ })
    await userEvent.click(trigger)
    await userEvent.click(await screen.findByRole('button', { name: 'Travel' }))
    expect(saveTagMock).toHaveBeenCalledWith(
      `/api/wallet/transactions/${hash}/label`,
      { label: 'Travel' }
    )
    expect(
      screen.getByRole('button', { name: /Expand transaction information/ })
    ).toHaveAttribute('aria-expanded', 'false')
    expect(recallActivityTx(hash)).toBeNull()
    expect(within(trigger).getByText('Travel')).toBeInTheDocument()
    await userEvent.click(
      screen.getByRole('button', { name: /Expand transaction information/ })
    )
    expect(screen.getAllByText('Travel')).toHaveLength(2)
  })
  it('also expands the Activity list on the home screen and preserves its back destination', async () => {
    render(<HomeScreen />)
    const toggle = await screen.findByRole('button', {
      name: /Expand transaction information/
    })
    await userEvent.click(toggle)
    expect(screen.getAllByText('Groceries')).toHaveLength(2)
    const panel = document.getElementById(
      toggle.getAttribute('aria-controls')!
    )!
    expect(within(panel).getByRole('link')).toHaveAttribute(
      'href',
      `/wallet/activity/${hash}?from=home`
    )
    expect(recallActivityTx(hash)).toBeNull()
  })
  it('supports keyboard expansion and keeps expanded information linked to the detail', async () => {
    const user = userEvent.setup()
    render(<ActivityScreen />)
    const toggle = await screen.findByRole('button', {
      name: /Expand transaction information/
    })
    toggle.focus()
    await user.keyboard('{Enter}')
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(recallActivityTx(hash)).toBeNull()
    const panel = document.getElementById(
      toggle.getAttribute('aria-controls')!
    )!
    const infoLink = within(panel).getByRole('link')
    expect(infoLink).toHaveAttribute('href', `/wallet/activity/${hash}`)
    await user.click(infoLink)
    expect(recallActivityTx(hash)?.paymentHash).toBe(hash)
    toggle.focus()
    await user.keyboard(' ')
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
  })

  it('shows explicit empty states for absent messages and labels', async () => {
    labelState.label = null
    listMock.mockResolvedValue([{ ...tx, description: '' }])
    render(<ActivityScreen />)
    await userEvent.click(
      await screen.findByRole('button', {
        name: /Expand transaction information/
      })
    )
    expect(screen.getByText('No message')).toBeInTheDocument()
    expect(screen.getByText('No tag')).toBeInTheDocument()
  })

  it('distinguishes a pending label request from an empty label', async () => {
    labelState.loading = true
    render(<ActivityScreen />)
    await userEvent.click(
      await screen.findByRole('button', {
        name: /Expand transaction information/
      })
    )
    expect(screen.getByText('Loading tag…')).toBeInTheDocument()
    expect(screen.queryByText('No tag')).not.toBeInTheDocument()
  })

  it('keeps the message visible and allows retry if the label request fails', async () => {
    labelState.error = new Error('Offline')
    render(<ActivityScreen />)
    const toggle = await screen.findByRole('button', {
      name: /Expand transaction information/
    })
    await userEvent.click(toggle)
    const panel = document.getElementById(
      toggle.getAttribute('aria-controls')!
    )!
    expect(within(panel).getByText(tx.description)).toBeInTheDocument()
    expect(screen.getByText('Could not load tag')).toBeInTheDocument()
    expect(screen.queryByText('Groceries')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Retry tag' }))
    expect(refetchMock).toHaveBeenCalledOnce()
    expect(recallActivityTx(hash)).toBeNull()
  })

  it('does not fetch real private labels for preview transactions', async () => {
    window.history.replaceState({}, '', '/wallet/activity?preview=1')
    render(<ActivityScreen />)
    expect(
      screen.queryByRole('button', { name: /Choose tag/ })
    ).not.toBeInTheDocument()
    const toggles = await screen.findAllByRole('button', {
      name: /Expand transaction information/
    })
    await userEvent.click(toggles[0])
    expect(
      vi.mocked(useApi).mock.calls.some(([path]) => path?.endsWith('/label'))
    ).toBe(false)
    expect(screen.queryByText('Groceries')).not.toBeInTheDocument()
  })

  it('expands the full message and private label with the chevron without opening the detail', async () => {
    const user = userEvent.setup()
    render(<ActivityScreen />)
    const toggle = await screen.findByRole('button', {
      name: /Expand transaction information/
    })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByText('Groceries')).toBeInTheDocument()
    expect(vi.mocked(useApi)).toHaveBeenCalledWith(
      `/api/wallet/transactions/${hash}/label`
    )

    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    const panel = document.getElementById(
      toggle.getAttribute('aria-controls')!
    )!
    expect(within(panel).getByText(tx.description)).toBeInTheDocument()
    expect(within(panel).getByText('Groceries')).toBeInTheDocument()
    expect(vi.mocked(useApi)).toHaveBeenCalledWith(
      `/api/wallet/transactions/${hash}/label`
    )
    expect(recallActivityTx(hash)).toBeNull()

    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByText('Groceries')).toBeInTheDocument()
    const rowLink = screen.getByRole('link', { name: /A long payment message/ })
    expect(rowLink).toHaveAttribute('href', `/wallet/activity/${hash}`)
    expect(rowLink.contains(toggle)).toBe(false)
    await user.click(rowLink)
    expect(recallActivityTx(hash)?.paymentHash).toBe(hash)
  })
})
