import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ApiClientError } from '@/lib/client/api-client'

const mocks = vi.hoisted(() => ({
  search: new URLSearchParams(),
  auth: {
    status: 'authenticated' as 'loading' | 'authenticated' | 'unauthenticated',
    pubkey: 'a'.repeat(64),
    role: 'USER' as string | null,
    apiClient: { post: vi.fn() },
    logout: vi.fn()
  }
}))

vi.mock('next/navigation', () => ({
  useSearchParams: () => mocks.search
}))

vi.mock('@/components/admin/auth-context', () => ({
  useAuth: () => mocks.auth
}))

// The real modal pulls in the signer and WebAuthn stacks; the consent
// screen's contract with it is only "open it while signed out".
vi.mock('@/components/admin/login-modal', () => ({
  LoginModal: ({ open }: { open: boolean }) =>
    open ? <div role="dialog" aria-label="Sign in" /> : null
}))

vi.mock('@/components/ui/brand-logotype', () => ({
  BrandLogotype: () => null
}))

vi.mock('@/lib/client/nostr-profile', () => ({
  useNostrProfile: () => ({
    profile: null,
    loading: false,
    updateProfile: vi.fn()
  })
}))

import { ConsentScreen } from '@/components/oauth/consent-screen'

const OAUTH_PARAMS = {
  client_id: 'client-1',
  redirect_uri: 'https://claude.ai/api/mcp/auth_callback',
  response_type: 'code',
  code_challenge: 'challenge-123',
  code_challenge_method: 'S256',
  state: 'state-xyz',
  resource: 'https://wallet.example.com/api/mcp'
}
const QUERY = new URLSearchParams({
  ...OAUTH_PARAMS,
  scope: 'read write spend'
})

const DETAILS = {
  client: { id: 'client-1', name: 'Claude' },
  redirectUri: OAUTH_PARAMS.redirect_uri,
  redirectHost: 'claude.ai',
  scopes: ['read', 'write', 'spend'],
  resource: OAUTH_PARAMS.resource,
  defaultSpendLimitSats: 10_000,
  maxSpendLimitSats: 10_000_000
}

const CODE_REDIRECT =
  'https://claude.ai/api/mcp/auth_callback?code=lwac_abc&state=state-xyz'

let fetchMock: ReturnType<typeof vi.fn>
let assignSpy: ReturnType<typeof vi.fn<(url: string | URL) => void>>

function answerCheck(status: number, body: unknown) {
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' }
    })
  )
}

async function renderReady() {
  const view = render(<ConsentScreen />)
  await screen.findByRole('heading', { name: 'Allow access to your account?' })
  return view
}

function scopeBox(name: RegExp) {
  return screen.getByRole('checkbox', { name })
}

beforeEach(() => {
  mocks.search = new URLSearchParams(QUERY)
  mocks.auth.status = 'authenticated'
  mocks.auth.role = 'USER'
  mocks.auth.apiClient.post.mockReset()
  mocks.auth.logout.mockReset()
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  answerCheck(200, DETAILS)
  assignSpy = vi.fn<(url: string | URL) => void>()
  vi.spyOn(window.location, 'assign').mockImplementation(assignSpy)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('ConsentScreen', () => {
  it('shows the server error for an invalid request and never redirects', async () => {
    // Even signed out: an invalid request must not ask for a sign-in first.
    mocks.auth.status = 'unauthenticated'
    answerCheck(400, {
      error: 'invalid_request',
      error_description: 'redirect_uri is not registered for this client'
    })

    render(<ConsentScreen />)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(
      'redirect_uri is not registered for this client'
    )
    expect(alert).toHaveTextContent('invalid_request')
    expect(screen.getByText(/nothing was authorized/i)).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/oauth/authorize?${QUERY.toString()}`,
      { cache: 'no-store' }
    )
    expect(
      screen.queryByRole('button', { name: /sign in/i })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Approve' })
    ).not.toBeInTheDocument()
    expect(mocks.auth.apiClient.post).not.toHaveBeenCalled()
    expect(assignSpy).not.toHaveBeenCalled()
  })

  it('reports an unreachable server the same way, without redirecting', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    render(<ConsentScreen />)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not reach this LaWallet instance'
    )
    expect(mocks.auth.apiClient.post).not.toHaveBeenCalled()
    expect(assignSpy).not.toHaveBeenCalled()
  })

  it('has a signed-out user sign in on the same page, then shows the request', async () => {
    const user = userEvent.setup()
    mocks.auth.status = 'unauthenticated'
    const view = render(<ConsentScreen />)

    await user.click(
      await screen.findByRole('button', { name: /sign in to continue/i })
    )
    expect(screen.getByRole('dialog', { name: 'Sign in' })).toBeInTheDocument()
    expect(screen.getByText('claude.ai')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Approve' })
    ).not.toBeInTheDocument()

    // The modal signs in through the auth context; the page reacts in place.
    mocks.auth.status = 'authenticated'
    view.rerender(<ConsentScreen />)

    const heading = await screen.findByRole('heading', {
      name: 'Allow access to your account?'
    })
    expect(heading).toHaveFocus()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(assignSpy).not.toHaveBeenCalled()
  })

  it('leads with the redirect host and renders client strings as text', async () => {
    answerCheck(200, {
      ...DETAILS,
      client: { id: 'client-1', name: '<img src=x onerror=alert(1)>' }
    })
    await renderReady()

    expect(screen.getByText('claude.ai')).toBeInTheDocument()
    expect(
      screen.getByText('“<img src=x onerror=alert(1)>”')
    ).toBeInTheDocument()
    expect(document.querySelector('img')).toBeNull()
  })

  it('pre-selects read and write, never spend, and locks read under write or spend', async () => {
    const user = userEvent.setup()
    await renderReady()

    const read = scopeBox(/view balances/i)
    const write = scopeBox(/create and change addresses/i)
    const spend = scopeBox(/send payments/i)
    expect(read).toBeChecked()
    expect(read).toBeDisabled()
    expect(
      screen.getByText('Included with the options below.')
    ).toBeInTheDocument()
    expect(write).toBeChecked()
    expect(spend).not.toBeChecked()
    expect(
      screen.queryByLabelText('Daily limit (sats)')
    ).not.toBeInTheDocument()

    // Dropping write unlocks read, which keeps its own tick…
    await user.click(write)
    expect(read).toBeEnabled()
    expect(read).toBeChecked()
    await user.click(read)
    expect(read).not.toBeChecked()

    // …and spend locks it back on.
    await user.click(spend)
    expect(read).toBeChecked()
    expect(read).toBeDisabled()
    expect(screen.getByLabelText('Daily limit (sats)')).toHaveValue(10_000)
    expect(
      screen.getByText(
        `This app can send up to ${(10_000).toLocaleString()} sats every 24 hours without asking you again.`
      )
    ).toBeInTheDocument()
  })

  it('approves with the chosen scopes, no limit, and follows the returned redirect', async () => {
    const user = userEvent.setup()
    mocks.auth.role = 'ADMIN'
    mocks.auth.apiClient.post.mockResolvedValue({ redirectTo: CODE_REDIRECT })
    await renderReady()

    expect(
      screen.getByText(/as you, with your admin permissions/)
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Approve' }))

    await waitFor(() => expect(assignSpy).toHaveBeenCalledWith(CODE_REDIRECT))
    // The original OAuth params, forwarded as-is; `scope` is replaced by the
    // user's choice.
    expect(mocks.auth.apiClient.post).toHaveBeenCalledWith(
      '/api/oauth/authorize',
      { ...OAUTH_PARAMS, approve: true, scopes: ['read', 'write'] }
    )
    expect(screen.getByRole('status')).toHaveTextContent('Access approved')
  })

  it('sends the daily limit only with spend, and only a valid one', async () => {
    const user = userEvent.setup()
    mocks.auth.apiClient.post.mockResolvedValue({ redirectTo: CODE_REDIRECT })
    await renderReady()

    await user.click(scopeBox(/create and change addresses/i))
    await user.click(scopeBox(/send payments/i))
    const approve = screen.getByRole('button', { name: 'Approve' })
    const limit = screen.getByLabelText('Daily limit (sats)')

    await user.clear(limit)
    expect(approve).toBeDisabled()
    await user.type(limit, '0')
    expect(approve).toBeDisabled()
    await user.clear(limit)
    await user.type(limit, '10000001')
    expect(approve).toBeDisabled()
    expect(limit).toHaveAttribute('aria-invalid', 'true')

    await user.clear(limit)
    await user.type(limit, '5000')
    await user.click(approve)

    await waitFor(() => expect(assignSpy).toHaveBeenCalledWith(CODE_REDIRECT))
    expect(mocks.auth.apiClient.post).toHaveBeenCalledWith(
      '/api/oauth/authorize',
      {
        ...OAUTH_PARAMS,
        approve: true,
        scopes: ['read', 'spend'],
        spendLimitSats: 5000
      }
    )
  })

  it('denies with approve: false and follows the returned redirect', async () => {
    const user = userEvent.setup()
    const denied =
      'https://claude.ai/api/mcp/auth_callback?error=access_denied&state=state-xyz'
    mocks.auth.apiClient.post.mockResolvedValue({ redirectTo: denied })
    await renderReady()

    await user.click(screen.getByRole('button', { name: 'Deny' }))

    await waitFor(() => expect(assignSpy).toHaveBeenCalledWith(denied))
    expect(mocks.auth.apiClient.post).toHaveBeenCalledWith(
      '/api/oauth/authorize',
      { ...OAUTH_PARAMS, approve: false, scopes: [] }
    )
    expect(screen.getByRole('status')).toHaveTextContent('Request denied')
  })

  it('cannot approve with nothing selected', async () => {
    const user = userEvent.setup()
    await renderReady()

    await user.click(scopeBox(/create and change addresses/i))
    await user.click(scopeBox(/view balances/i))

    expect(screen.getByRole('button', { name: 'Approve' })).toBeDisabled()
    expect(
      screen.getByText('Select at least one option to approve.')
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Deny' })).toBeEnabled()
  })

  it('stays on the page with the error when the submit fails, and can retry', async () => {
    const user = userEvent.setup()
    mocks.auth.apiClient.post
      .mockRejectedValueOnce(
        new ApiClientError(400, 'The authorization request has expired')
      )
      .mockResolvedValueOnce({ redirectTo: CODE_REDIRECT })
    await renderReady()

    await user.click(screen.getByRole('button', { name: 'Approve' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The authorization request has expired'
    )
    expect(assignSpy).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Approve' }))
    await waitFor(() => expect(assignSpy).toHaveBeenCalledWith(CODE_REDIRECT))
    expect(mocks.auth.apiClient.post).toHaveBeenCalledTimes(2)
  })

  it('refuses to follow a script URL even if the server returns one', async () => {
    const user = userEvent.setup()
    mocks.auth.apiClient.post.mockResolvedValue({
      redirectTo: 'javascript:alert(document.cookie)'
    })
    await renderReady()

    await user.click(screen.getByRole('button', { name: 'Approve' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'invalid redirect address'
    )
    expect(assignSpy).not.toHaveBeenCalled()
  })

  it('switches account only after confirmation, then reopens sign-in', async () => {
    const user = userEvent.setup()
    // happy-dom ships no window.confirm.
    const confirm = vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true)
    vi.stubGlobal('confirm', confirm)
    mocks.auth.logout.mockImplementation(() => {
      mocks.auth.status = 'unauthenticated'
    })
    await renderReady()

    await user.click(screen.getByRole('button', { name: 'Switch account' }))
    expect(mocks.auth.logout).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Switch account' }))
    expect(confirm).toHaveBeenCalledTimes(2)
    expect(mocks.auth.logout).toHaveBeenCalledTimes(1)
    expect(
      await screen.findByRole('dialog', { name: 'Sign in' })
    ).toBeInTheDocument()
  })
})
