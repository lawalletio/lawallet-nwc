import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type {
  AccountLinkVerifyResponse,
  AccountMergePreviewResponse
} from '@/lib/validation/schemas'

// happy-dom has no WebAuthn API — keep the browser layer out entirely.
vi.mock('@simplewebauthn/browser', () => ({
  browserSupportsWebAuthn: vi.fn(() => true),
  startRegistration: vi.fn(),
  startAuthentication: vi.fn()
}))

const mocks = vi.hoisted(() => ({
  refreshSession: vi.fn(),
  refetch: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn()
}))

vi.mock('@/components/admin/auth-context', () => ({
  useAuth: () => ({ jwt: 'jwt-token', refreshSession: mocks.refreshSession })
}))

vi.mock('@/lib/client/hooks/use-account', () => ({
  useAccount: () => ({ refetch: mocks.refetch })
}))

vi.mock('sonner', () => ({
  toast: { success: mocks.toastSuccess, error: mocks.toastError }
}))

// The Nostr form's internals (nsec/bunker/extension) are out of scope — the
// dialog's contract is only "hand me a signer via handleSigner". Mirror the
// real form's behaviour of swallowing handler rejections into its own toast.
vi.mock('@/components/shared/nostr-connect-form', () => ({
  NostrConnectForm: ({
    handleSigner
  }: {
    handleSigner: (signer: unknown, method: string) => Promise<void>
  }) => (
    <button
      type="button"
      onClick={() => void handleSigner({ fake: 'signer' }, 'nsec').catch(() => {})}
    >
      mock-nostr-prove
    </button>
  )
}))

vi.mock('@/lib/client/account-api', () => ({
  proveNostrKey: vi.fn(),
  provePasskeyAccount: vi.fn(),
  fetchMergePreview: vi.fn(),
  commitMerge: vi.fn()
}))

// Keep the real translatePasskeyError / PasskeyError so the cancelled-vs-error
// branching runs against production logic; only the support gate is stubbed.
vi.mock('@/lib/client/passkey-api', async importOriginal => {
  const actual =
    await importOriginal<typeof import('@/lib/client/passkey-api')>()
  return {
    ...actual,
    isPasskeySupported: vi.fn(() => true)
  }
})

import { MergeDialog } from '@/components/admin/account/merge-dialog'
import {
  proveNostrKey,
  provePasskeyAccount,
  fetchMergePreview,
  commitMerge
} from '@/lib/client/account-api'
import { PasskeyError } from '@/lib/client/passkey-api'

const PK_A = 'a'.repeat(64)
const PK_B = 'b'.repeat(64)
const PK_C = 'c'.repeat(64)

const PREVIEW: AccountMergePreviewResponse = {
  survivor: {
    userId: 'user-a',
    primaryPubkey: PK_A,
    identities: [
      { pubkey: PK_A, isPrimary: true, label: 'Main key' },
      { pubkey: PK_B, isPrimary: false, label: null }
    ],
    passkeys: 1,
    lightningAddresses: ['alice@ln.host'],
    remoteWallets: 2,
    cards: 3,
    cardDesigns: 0,
    invoices: 4,
    hasAlbySubAccount: false,
    hasManagedKey: false,
    managedKeyExported: false
  },
  absorbed: {
    userId: 'user-b',
    primaryPubkey: PK_C,
    identities: [{ pubkey: PK_C, isPrimary: true, label: 'Old phone' }],
    passkeys: 2,
    lightningAddresses: [],
    remoteWallets: 0,
    cards: 1,
    cardDesigns: 1,
    invoices: 0,
    hasAlbySubAccount: true,
    hasManagedKey: true,
    managedKeyExported: true
  },
  collisions: [],
  blocked: false
}

const TICKET_RESPONSE: AccountLinkVerifyResponse = {
  linked: false,
  mergeTicket: 'ticket-1234567890abcdef',
  otherAccount: PREVIEW.absorbed
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.refreshSession.mockResolvedValue(true)
  mocks.refetch.mockResolvedValue(undefined)
})

function renderDialog() {
  const onOpenChange = vi.fn()
  render(<MergeDialog open onOpenChange={onOpenChange} />)
  return { onOpenChange }
}

describe('MergeDialog', () => {
  it('links directly when the proven key is unowned: toast + refetch + close', async () => {
    const user = userEvent.setup()
    vi.mocked(proveNostrKey).mockResolvedValue({
      linked: true,
      identity: {
        pubkey: PK_C,
        isPrimary: false,
        label: null,
        createdAt: new Date().toISOString()
      }
    })
    const { onOpenChange } = renderDialog()

    await user.click(screen.getByRole('button', { name: 'mock-nostr-prove' }))

    await waitFor(() =>
      expect(mocks.toastSuccess).toHaveBeenCalledWith(
        'Key linked to your account'
      )
    )
    expect(proveNostrKey).toHaveBeenCalledWith('jwt-token', { fake: 'signer' })
    expect(mocks.refetch).toHaveBeenCalled()
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(fetchMergePreview).not.toHaveBeenCalled()
  })

  it('walks ticket → preview → commit with a picked main pubkey', async () => {
    const user = userEvent.setup()
    vi.mocked(proveNostrKey).mockResolvedValue(TICKET_RESPONSE)
    vi.mocked(fetchMergePreview).mockResolvedValue(PREVIEW)
    vi.mocked(commitMerge).mockResolvedValue({
      survivorId: 'user-a',
      mainPubkey: PK_C,
      movedIdentities: 1,
      movedPasskeys: 2,
      movedAddresses: 0,
      movedWallets: 0
    })
    const { onOpenChange } = renderDialog()

    await user.click(screen.getByRole('button', { name: 'mock-nostr-prove' }))

    // Preview step: both sides + one radio per identity across both accounts.
    await screen.findByText('This account')
    expect(screen.getByText('Incoming account')).toBeInTheDocument()
    expect(fetchMergePreview).toHaveBeenCalledWith(
      'jwt-token',
      TICKET_RESPONSE.mergeTicket
    )
    const radios = screen.getAllByRole('radio')
    expect(radios).toHaveLength(3)
    // Default selection is the survivor's current primary.
    expect(radios[0]).toBeChecked()
    expect(screen.getByText(/current primary/)).toBeInTheDocument()

    // Pick the absorbed account's identity as the new main pubkey.
    await user.click(radios[2])
    await user.click(screen.getByRole('button', { name: 'Merge accounts' }))

    await waitFor(() =>
      expect(commitMerge).toHaveBeenCalledWith(
        'jwt-token',
        TICKET_RESPONSE.mergeTicket,
        PK_C
      )
    )
    // Done step: session re-minted, account refreshed, moved counts shown.
    await screen.findByText('Accounts merged')
    expect(mocks.refreshSession).toHaveBeenCalled()
    expect(mocks.refetch).toHaveBeenCalled()
    expect(screen.getByText('1 identity moved')).toBeInTheDocument()
    expect(screen.getByText('2 passkeys moved')).toBeInTheDocument()

    // Two "Close" buttons exist: the dialog's built-in X and the footer CTA.
    const footerClose = screen
      .getAllByRole('button', { name: 'Close' })
      .find(button => button.className.includes('w-full'))
    expect(footerClose).toBeDefined()
    await user.click(footerClose!)
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('renders a blocked merge as disabled with the collision surfaced', async () => {
    const user = userEvent.setup()
    vi.mocked(proveNostrKey).mockResolvedValue(TICKET_RESPONSE)
    vi.mocked(fetchMergePreview).mockResolvedValue({
      ...PREVIEW,
      collisions: [
        {
          kind: 'managed-key-unexported',
          detail: 'The other account holds an unexported managed key'
        }
      ],
      blocked: true
    })
    renderDialog()

    await user.click(screen.getByRole('button', { name: 'mock-nostr-prove' }))

    await screen.findByText('This account')
    expect(
      screen.getByText('The other account holds an unexported managed key')
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Merge blocked' })).toBeDisabled()
    // No main-pubkey picker while blocked — there is nothing to commit.
    expect(screen.queryAllByRole('radio')).toHaveLength(0)
    expect(commitMerge).not.toHaveBeenCalled()

    // Back returns to the proof step.
    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(
      screen.getByRole('button', { name: 'mock-nostr-prove' })
    ).toBeInTheDocument()
  })

  it('stays silent on a cancelled passkey prompt but toasts real failures', async () => {
    const user = userEvent.setup()
    vi.mocked(provePasskeyAccount).mockRejectedValueOnce(
      new PasskeyError('cancelled', 'The operation was cancelled')
    )
    renderDialog()

    await user.click(screen.getByRole('tab', { name: /passkey/i }))
    const proveButton = await screen.findByRole('button', {
      name: /prove with passkey/i
    })

    await user.click(proveButton)
    await waitFor(() => expect(provePasskeyAccount).toHaveBeenCalledTimes(1))
    expect(mocks.toastError).not.toHaveBeenCalled()

    vi.mocked(provePasskeyAccount).mockRejectedValueOnce(
      new Error('Proof rejected')
    )
    await user.click(proveButton)
    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith('Proof rejected')
    )
  })
})
