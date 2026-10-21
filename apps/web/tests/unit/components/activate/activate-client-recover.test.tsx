import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const mocks = vi.hoisted(() => ({
  // Stable objects: ActivateClient / RecoveredDialog key callbacks and
  // effects on router and apiClient identity.
  router: { replace: vi.fn(), push: vi.fn(), back: vi.fn(), prefetch: vi.fn() },
  auth: {
    status: 'authenticated' as 'authenticated' | 'unauthenticated' | 'loading',
    apiClient: { get: vi.fn(), post: vi.fn() }
  },
  invalidateApiPath: vi.fn()
}))

vi.mock('next/navigation', () => ({
  useRouter: () => mocks.router
}))

vi.mock('@/components/admin/auth-context', () => ({
  useAuth: () => mocks.auth
}))

vi.mock('@/lib/client/hooks/use-api', () => ({
  invalidateApiPath: mocks.invalidateApiPath
}))

// Signed-in throughout — the inline sign-up panel is out of scope here.
vi.mock('@/components/activate/inline-auth', () => ({
  InlineAuth: ({ intent }: { intent?: string }) => (
    <div>inline-auth:{intent}</div>
  )
}))

import { ActivateClient } from '@/components/activate/activate-client'
import { ApiClientError } from '@/lib/client/api-client'
import type { RecoveredAccount } from '@/components/activate/recovered-dialog'

const TOKEN_ID = 'deadbeefcafe0123deadbeefcafe0123'
const PREVIEW_PATH = `/api/activation-tokens/${TOKEN_ID}`
const CHECK_PATH = `/api/activation-tokens/${TOKEN_ID}/recovery-check`
const CLAIM_PATH = `/api/activation-tokens/${TOKEN_ID}/claim`

const { get, post } = mocks.auth.apiClient

const preview = (purpose?: 'ACTIVATE' | 'RECOVER') => ({
  tokenId: TOKEN_ID,
  qrKind: 'ONE_TIME',
  ...(purpose ? { purpose } : {}),
  status: 'PENDING',
  card: {
    id: 'card-1',
    title: 'Blue card',
    kind: 'SIMPLE',
    design: {
      id: 'design-1',
      imageUrl: 'https://img/blue.png',
      description: 'Blue'
    }
  }
})

const EXISTING = {
  lightningAddresses: ['alice@ln.host'],
  cards: 1,
  remoteWallets: 1
}
const INCOMING = {
  lightningAddresses: ['bob@ln.host'],
  cards: 2,
  remoteWallets: 1
}

const CHECK_MERGE = {
  sameAccount: false,
  mergeRequired: true,
  existing: EXISTING,
  incoming: INCOMING
}
const CHECK_CLEAN = {
  sameAccount: false,
  mergeRequired: false,
  existing: { lightningAddresses: [], cards: 0, remoteWallets: 0 },
  incoming: INCOMING
}

const RECOVERY: RecoveredAccount = {
  lightningAddresses: ['bob@ln.host'],
  primaryAddress: 'bob@ln.host',
  cards: [
    { id: 'card-1', title: 'Blue card', designImageUrl: null },
    { id: 'card-2', title: null, designImageUrl: null }
  ],
  remoteWallets: [{ id: 'rw-1', name: 'Bob wallet', isDefault: true }],
  vouchers: 0,
  mergedIntoExisting: false
}

const RECOVERED_RESPONSE = {
  qrKind: 'ONE_TIME',
  purpose: 'RECOVER',
  outcome: 'recovered',
  recovery: RECOVERY,
  needsLightningAddress: false
}

const RECOVERY_INVALIDATES = [
  '/api/users/me',
  '/api/wallet/addresses',
  '/api/wallet/cards',
  '/api/remote-wallets'
]

let fetchMock: ReturnType<typeof vi.fn>

function servePreview(body: unknown) {
  fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => body })
}

/**
 * Route `apiClient.get`: each recovery-check call takes the next queued
 * response; wallet balance reads (RecoveredDialog) answer 1000 sats.
 */
function serveChecks(...checks: unknown[]) {
  const queue = [...checks]
  get.mockImplementation((path: string) => {
    if (path === CHECK_PATH) {
      const next = queue.shift()
      return next instanceof Error
        ? Promise.reject(next)
        : Promise.resolve(next)
    }
    if (/^\/api\/remote-wallets\/[^/]+\/balance$/.test(path)) {
      return Promise.resolve({ balanceSats: 1000 })
    }
    return Promise.reject(new Error(`unexpected GET ${path}`))
  })
}

const checkCalls = () => get.mock.calls.filter(([path]) => path === CHECK_PATH)

async function renderRecover() {
  servePreview(preview('RECOVER'))
  render(<ActivateClient tokenId={TOKEN_ID} />)
  return screen.findByRole('button', { name: 'Recover account' })
}

beforeEach(() => {
  mocks.router.replace.mockReset()
  mocks.router.push.mockReset()
  mocks.invalidateApiPath.mockReset()
  mocks.auth.status = 'authenticated'
  get.mockReset()
  post.mockReset()
  localStorage.clear()
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('ActivateClient — RECOVER', () => {
  it('shows the recover copy instead of the activate copy', async () => {
    expect(await renderRecover()).toBeInTheDocument()

    expect(fetchMock).toHaveBeenCalledWith(PREVIEW_PATH)
    expect(screen.getByText('Recover your account')).toBeInTheDocument()
    expect(screen.queryByText('Activate your card')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Activate' })).toBeNull()
    expect(get).not.toHaveBeenCalled()
    expect(post).not.toHaveBeenCalled()
  })

  it('runs the recovery check first and asks before merging', async () => {
    const user = userEvent.setup()
    serveChecks(CHECK_MERGE)
    post.mockResolvedValue({
      ...RECOVERED_RESPONSE,
      recovery: { ...RECOVERY, mergedIntoExisting: true }
    })

    await user.click(await renderRecover())

    expect(
      await screen.findByRole('alertdialog', {
        name: 'Merge into your account?'
      })
    ).toBeInTheDocument()
    expect(get).toHaveBeenCalledWith(CHECK_PATH)
    expect(screen.getByText('alice@ln.host')).toBeInTheDocument()
    expect(screen.getByText('bob@ln.host')).toBeInTheDocument()
    // Nothing is claimed until the user agrees.
    expect(post).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Merge & recover' }))

    await waitFor(() =>
      expect(post).toHaveBeenCalledWith(CLAIM_PATH, {
        remoteWalletId: null,
        confirmMerge: true
      })
    )
    expect(post).toHaveBeenCalledTimes(1)
    // A confirmed merge goes straight to the claim — no second pre-flight.
    expect(checkCalls()).toHaveLength(1)

    expect(
      await screen.findByRole('dialog', { name: 'Account recovered' })
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        "Everything from the card's account was merged into this wallet."
      )
    ).toBeInTheDocument()
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('cancelling the merge prompt claims nothing and allows a retry', async () => {
    const user = userEvent.setup()
    serveChecks(CHECK_MERGE)

    await user.click(await renderRecover())
    await screen.findByRole('alertdialog')
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(post).not.toHaveBeenCalled()
    expect(
      screen.getByRole('button', { name: 'Recover account' })
    ).toBeInTheDocument()
  })

  it('claims with confirmMerge: false when no merge is needed', async () => {
    const user = userEvent.setup()
    serveChecks(CHECK_CLEAN)
    post.mockResolvedValue(RECOVERED_RESPONSE)

    await user.click(await renderRecover())

    await waitFor(() =>
      expect(post).toHaveBeenCalledWith(CLAIM_PATH, {
        remoteWalletId: null,
        confirmMerge: false
      })
    )
    expect(get).toHaveBeenCalledWith(CHECK_PATH)
    expect(
      get.mock.invocationCallOrder[0] < post.mock.invocationCallOrder[0]
    ).toBe(true)
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('sends the card owner straight to the wallet on outcome "same-account"', async () => {
    const user = userEvent.setup()
    serveChecks({ ...CHECK_CLEAN, sameAccount: true })
    post.mockResolvedValue({
      qrKind: 'ONE_TIME',
      purpose: 'RECOVER',
      outcome: 'same-account'
    })

    await user.click(await renderRecover())

    await waitFor(() =>
      expect(mocks.router.replace).toHaveBeenCalledWith('/wallet')
    )
    for (const path of RECOVERY_INVALIDATES) {
      expect(mocks.invalidateApiPath).toHaveBeenCalledWith(path)
    }
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('shows what was recovered on outcome "recovered" and opens the wallet', async () => {
    const user = userEvent.setup()
    serveChecks(CHECK_CLEAN)
    post.mockResolvedValue(RECOVERED_RESPONSE)

    await user.click(await renderRecover())

    expect(
      await screen.findByRole('dialog', { name: 'Account recovered' })
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        "Everything from the card's account is now in this wallet."
      )
    ).toBeInTheDocument()
    expect(screen.getByText('Bob wallet')).toBeInTheDocument()
    expect(
      await screen.findByText(`${(1000).toLocaleString()} sats`)
    ).toBeInTheDocument()
    expect(get).toHaveBeenCalledWith('/api/remote-wallets/rw-1/balance')
    for (const path of RECOVERY_INVALIDATES) {
      expect(mocks.invalidateApiPath).toHaveBeenCalledWith(path)
    }
    expect(mocks.router.replace).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Open wallet' }))
    expect(mocks.router.replace).toHaveBeenCalledWith('/wallet')
  })

  it('continues to claim an address when the recovered account has none', async () => {
    const user = userEvent.setup()
    serveChecks(CHECK_CLEAN)
    post.mockResolvedValue({
      ...RECOVERED_RESPONSE,
      recovery: { ...RECOVERY, lightningAddresses: [], primaryAddress: null },
      needsLightningAddress: true
    })

    await user.click(await renderRecover())
    await user.click(
      await screen.findByRole('button', { name: 'Claim your address' })
    )

    expect(mocks.router.replace).toHaveBeenCalledWith(
      '/wallet/claim-username?from=activate'
    )
  })

  it('re-checks and asks to merge when the claim answers RECOVERY_MERGE_REQUIRED', async () => {
    const user = userEvent.setup()
    // Clean at pre-flight, but data landed on the account before the claim.
    serveChecks(CHECK_CLEAN, CHECK_MERGE)
    post
      .mockRejectedValueOnce(
        new ApiClientError(409, 'Merge confirmation required', 'CONFLICT', {
          reason: 'RECOVERY_MERGE_REQUIRED'
        })
      )
      .mockResolvedValueOnce(RECOVERED_RESPONSE)

    await user.click(await renderRecover())

    expect(
      await screen.findByRole('alertdialog', {
        name: 'Merge into your account?'
      })
    ).toBeInTheDocument()
    expect(checkCalls()).toHaveLength(2)
    expect(post).toHaveBeenCalledTimes(1)
    expect(post).toHaveBeenLastCalledWith(CLAIM_PATH, {
      remoteWalletId: null,
      confirmMerge: false
    })
    expect(screen.queryByText('Merge confirmation required')).toBeNull()
    expect(screen.getByText('alice@ln.host')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Merge & recover' }))

    await waitFor(() =>
      expect(post).toHaveBeenLastCalledWith(CLAIM_PATH, {
        remoteWalletId: null,
        confirmMerge: true
      })
    )
    expect(
      await screen.findByRole('dialog', { name: 'Account recovered' })
    ).toBeInTheDocument()
  })

  it('shows the claim error when the merge re-check also fails', async () => {
    const user = userEvent.setup()
    serveChecks(CHECK_CLEAN, new Error('network down'))
    post.mockRejectedValue(
      new ApiClientError(409, 'Merge confirmation required', 'CONFLICT', {
        reason: 'RECOVERY_MERGE_REQUIRED'
      })
    )

    await user.click(await renderRecover())

    expect(
      await screen.findByText('Merge confirmation required')
    ).toBeInTheDocument()
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(
      screen.getByRole('button', { name: 'Recover account' })
    ).toBeInTheDocument()
  })

  it('shows any other claim error without re-checking', async () => {
    const user = userEvent.setup()
    serveChecks(CHECK_CLEAN)
    post.mockRejectedValue(
      new ApiClientError(409, 'Recovery QR has expired', 'CONFLICT')
    )

    await user.click(await renderRecover())

    expect(
      await screen.findByText('Recovery QR has expired')
    ).toBeInTheDocument()
    expect(checkCalls()).toHaveLength(1)
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('falls back to "Recovery failed." for a non-Error rejection', async () => {
    const user = userEvent.setup()
    serveChecks(CHECK_CLEAN)
    post.mockRejectedValue('boom')

    await user.click(await renderRecover())

    expect(await screen.findByText('Recovery failed.')).toBeInTheDocument()
  })

  it('hands the recover intent to the inline sign-up when signed out', async () => {
    mocks.auth.status = 'unauthenticated'
    servePreview(preview('RECOVER'))
    render(<ActivateClient tokenId={TOKEN_ID} />)

    expect(await screen.findByText('inline-auth:recover')).toBeInTheDocument()
  })
})

describe('ActivateClient — ACTIVATE', () => {
  it('still shows "Activate" and claims without a recovery check', async () => {
    const user = userEvent.setup()
    servePreview(preview('ACTIVATE'))
    post.mockResolvedValue({ card: preview('ACTIVATE').card })
    render(<ActivateClient tokenId={TOKEN_ID} />)

    const button = await screen.findByRole('button', { name: 'Activate' })
    expect(screen.getByText('Activate your card')).toBeInTheDocument()
    expect(screen.queryByText('Recover your account')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Recover account' })).toBeNull()

    await user.click(button)

    await waitFor(() =>
      expect(post).toHaveBeenCalledWith(CLAIM_PATH, { remoteWalletId: null })
    )
    expect(get).not.toHaveBeenCalled()
    expect(mocks.invalidateApiPath).not.toHaveBeenCalled()
  })
})
