import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { clearApiCache } from '@/lib/client/hooks/use-api'

const mocks = vi.hoisted(() => ({
  // One stable object: useApi keys its fetch callback on apiClient identity.
  auth: {
    status: 'authenticated',
    pubkey: 'a'.repeat(64),
    role: 'USER',
    apiClient: { get: vi.fn(), del: vi.fn() }
  },
  toastSuccess: vi.fn(),
  toastError: vi.fn()
}))

vi.mock('@/components/admin/auth-context', () => ({
  useAuth: () => mocks.auth
}))

vi.mock('sonner', () => ({
  toast: { success: mocks.toastSuccess, error: mocks.toastError }
}))

import { ConnectedApps, MCP_DOCS_URL } from '@/components/oauth/connected-apps'

const HOUR = 60 * 60 * 1000
const GRANTS = [
  {
    id: 'grant-1',
    clientName: 'Claude',
    scopes: ['read', 'write'],
    spendLimitSats: null,
    createdAt: new Date(Date.now() - 48 * HOUR).toISOString(),
    lastUsedAt: new Date(Date.now() - 2 * HOUR).toISOString()
  },
  {
    id: 'grant-2',
    clientName: 'Cursor',
    scopes: ['read', 'spend'],
    spendLimitSats: 5000,
    createdAt: new Date(Date.now() - 24 * HOUR).toISOString(),
    lastUsedAt: null
  }
]

const { get, del } = mocks.auth.apiClient

const METADATA_PATH = '/.well-known/oauth-protected-resource'
const CANONICAL_MCP_URL = 'https://beta.lawallet.io/api/mcp'
const originMcpUrl = () => `${window.location.origin}/api/mcp`

let fetchMock: ReturnType<typeof vi.fn>

function metadataResponse(body: unknown, ok = true) {
  return { ok, json: async () => body }
}

beforeEach(() => {
  clearApiCache()
  get.mockReset()
  del.mockReset()
  mocks.toastSuccess.mockReset()
  mocks.toastError.mockReset()
  fetchMock = vi
    .fn()
    .mockResolvedValue(metadataResponse({ resource: CANONICAL_MCP_URL }))
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  clearApiCache()
  vi.unstubAllGlobals()
})

describe('ConnectedApps', () => {
  it('lists grants with their scopes, spend limit and dates, plus the docs link', async () => {
    get.mockResolvedValue({ grants: GRANTS })
    render(<ConnectedApps />)

    expect(await screen.findByText('Claude')).toBeInTheDocument()
    expect(get).toHaveBeenCalledWith('/api/oauth/grants')
    expect(screen.getByText('Cursor')).toBeInTheDocument()
    expect(screen.getByText('write')).toBeInTheDocument()
    expect(
      screen.getByText(`Spend · ${(5000).toLocaleString()} sats/day`)
    ).toBeInTheDocument()
    expect(screen.getByText(/Last used/)).toHaveTextContent(
      'Connected 2d ago · Last used 2h ago'
    )
    expect(screen.getByText(/Not used yet/)).toHaveTextContent(
      'Connected 1d ago · Not used yet'
    )

    expect(screen.getByRole('link', { name: /setup guide/i })).toHaveAttribute(
      'href',
      MCP_DOCS_URL
    )
  })

  it('shows the canonical MCP URL from the protected-resource metadata', async () => {
    get.mockResolvedValue({ grants: [] })
    render(<ConnectedApps />)

    // This origin until the metadata answers…
    expect(screen.getByText(originMcpUrl())).toBeInTheDocument()
    // …then the URL tokens are bound to, which connectors must use.
    expect(await screen.findByText(CANONICAL_MCP_URL)).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith(METADATA_PATH)
    expect(screen.queryByText(originMcpUrl())).not.toBeInTheDocument()
  })

  it.each([
    [
      'the request fails',
      () => fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    ],
    [
      'the server answers an error',
      () =>
        fetchMock.mockResolvedValue(
          metadataResponse({ resource: CANONICAL_MCP_URL }, false)
        )
    ],
    [
      'resource is not a string',
      () => fetchMock.mockResolvedValue(metadataResponse({ resource: 42 }))
    ]
  ])('keeps this origin’s MCP URL when %s', async (_case, arrange) => {
    arrange()
    get.mockResolvedValue({ grants: [] })
    render(<ConnectedApps />)

    await screen.findByText(/no apps connected yet/i)
    // Let the metadata request settle before asserting nothing replaced the
    // fallback.
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0))
    })
    expect(fetchMock).toHaveBeenCalledWith(METADATA_PATH)
    expect(screen.getByText(originMcpUrl())).toBeInTheDocument()
    expect(screen.queryByText(CANONICAL_MCP_URL)).not.toBeInTheDocument()
  })

  it('explains how an app gets here when there are none', async () => {
    get.mockResolvedValue({ grants: [] })
    render(<ConnectedApps />)

    expect(await screen.findByText(/no apps connected yet/i)).toHaveTextContent(
      'as a connector in Claude or ChatGPT'
    )
  })

  it('revokes only after confirmation, then refreshes the list', async () => {
    const user = userEvent.setup()
    get
      .mockResolvedValueOnce({ grants: GRANTS })
      .mockResolvedValueOnce({ grants: [GRANTS[1]] })
    del.mockResolvedValue({ success: true })
    render(<ConnectedApps />)

    await user.click(
      await screen.findByRole('button', { name: 'Revoke access for Claude' })
    )
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveTextContent('Claude')
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(del).not.toHaveBeenCalled()

    await user.click(
      screen.getByRole('button', { name: 'Revoke access for Claude' })
    )
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', {
        name: 'Revoke'
      })
    )

    await waitFor(() =>
      expect(del).toHaveBeenCalledWith('/api/oauth/grants/grant-1', undefined)
    )
    await waitFor(() =>
      expect(screen.queryByText('Claude')).not.toBeInTheDocument()
    )
    expect(screen.getByText('Cursor')).toBeInTheDocument()
    expect(get).toHaveBeenCalledTimes(2)
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Access revoked for Claude')
  })

  it('keeps the grant and reports the error when revoking fails', async () => {
    const user = userEvent.setup()
    get.mockResolvedValue({ grants: GRANTS })
    del.mockRejectedValue(new Error('Grant not found'))
    render(<ConnectedApps />)

    await user.click(
      await screen.findByRole('button', { name: 'Revoke access for Cursor' })
    )
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', {
        name: 'Revoke'
      })
    )

    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith('Grant not found')
    )
    expect(screen.getByText('Cursor')).toBeInTheDocument()
    expect(mocks.toastSuccess).not.toHaveBeenCalled()
  })

  it('shows a load failure instead of the empty state, with retry', async () => {
    const user = userEvent.setup()
    get
      .mockRejectedValueOnce(new Error('Service unavailable'))
      .mockResolvedValueOnce({ grants: [] })
    render(<ConnectedApps />)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Service unavailable')
    expect(screen.queryByText(/no apps connected yet/i)).not.toBeInTheDocument()

    await user.click(within(alert).getByRole('button', { name: /retry/i }))
    expect(
      await screen.findByText(/no apps connected yet/i)
    ).toBeInTheDocument()
  })
})
