import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
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
  requestSigner: vi.fn(),
  refetch: vi.fn(),
  updateProfile: vi.fn(),
  addPasskey: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  toastInfo: vi.fn()
}))

vi.mock('@/components/admin/auth-context', () => ({
  useAuth: () => ({
    jwt: 'jwt-token',
    refreshSession: mocks.refreshSession,
    requestSigner: mocks.requestSigner
  })
}))

vi.mock('@/lib/client/hooks/use-account', () => ({
  useAccount: () => ({ refetch: mocks.refetch })
}))

// The dialog reads the main identity's cached kind-0 as the publish base;
// `null` keeps the patch-vs-current comparison on the "differs" branch.
vi.mock('@/lib/client/nostr-profile', () => ({
  useNostrProfile: () => ({
    profile: null,
    loading: false,
    updateProfile: mocks.updateProfile
  })
}))

vi.mock('@/lib/client/nostr-publish', () => ({
  publishProfile: vi.fn()
}))

vi.mock('sonner', () => ({
  toast: {
    success: mocks.toastSuccess,
    error: mocks.toastError,
    info: mocks.toastInfo
  }
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

// PasskeysSection's data layer, for the duplicate-passkey escalation test.
vi.mock('@/lib/client/hooks/use-passkeys', () => ({
  usePasskeys: () => ({
    credentials: [],
    hasManagedKey: false,
    managedKeyExported: false,
    loading: false,
    addPasskey: mocks.addPasskey,
    renameCredential: vi.fn(),
    deleteCredential: vi.fn(),
    adding: false,
    renaming: false,
    deleting: false
  })
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
import { PasskeysSection } from '@/components/wallet/settings/passkeys-section'
import {
  proveNostrKey,
  provePasskeyAccount,
  fetchMergePreview,
  commitMerge
} from '@/lib/client/account-api'
import { PasskeyError } from '@/lib/client/passkey-api'
import { publishProfile } from '@/lib/client/nostr-publish'

const PK_A = 'a'.repeat(64)
const PK_B = 'b'.repeat(64)
const PK_C = 'c'.repeat(64)

// Conflict-rich baseline: both sides have a primary address, a default
// wallet, relays, and disagreeing profiles.
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
    primaryAddress: 'alice',
    remoteWallets: 2,
    wallets: [
      { id: 'w1', name: 'Main wallet', isDefault: true },
      { id: 'w3', name: 'Spare', isDefault: false }
    ],
    cards: 3,
    cardDesigns: 0,
    invoices: 4,
    relays: ['wss://a.example', 'wss://b.example'],
    profile: { name: 'alice', displayName: 'Alice', picture: 'https://img/alice.png' },
    hasAlbySubAccount: false,
    hasManagedKey: false,
    managedKeyExported: false
  },
  absorbed: {
    userId: 'user-b',
    primaryPubkey: PK_C,
    identities: [{ pubkey: PK_C, isPrimary: true, label: 'Old phone' }],
    passkeys: 2,
    lightningAddresses: ['bob@ln.host'],
    primaryAddress: 'bob',
    remoteWallets: 1,
    wallets: [{ id: 'w2', name: 'Old wallet', isDefault: true }],
    cards: 1,
    cardDesigns: 1,
    invoices: 0,
    relays: ['wss://b.example', 'wss://c.example'],
    profile: { displayName: 'Bob', picture: 'https://img/bob.png' },
    hasAlbySubAccount: true,
    hasManagedKey: true,
    managedKeyExported: true
  },
  collisions: [],
  blocked: false
}

// No profile / address / wallet / relay conflicts — resolve only asks for
// the main identity.
const NO_CONFLICT_PREVIEW: AccountMergePreviewResponse = {
  survivor: { ...PREVIEW.survivor, relays: [], profile: null },
  absorbed: {
    ...PREVIEW.absorbed,
    primaryAddress: null,
    wallets: [],
    relays: [],
    profile: null
  },
  collisions: [],
  blocked: false
}

const TICKET_RESPONSE: AccountLinkVerifyResponse = {
  linked: false,
  mergeTicket: 'ticket-1234567890abcdef',
  otherAccount: PREVIEW.absorbed
}

const MERGE_RESULT = {
  survivorId: 'user-a',
  mainPubkey: PK_C,
  movedIdentities: 1,
  movedPasskeys: 2,
  movedAddresses: 1,
  movedWallets: 1,
  mergedRelays: 3
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.refreshSession.mockResolvedValue(true)
  mocks.refetch.mockResolvedValue(undefined)
  mocks.requestSigner.mockResolvedValue({ getPublicKey: async () => PK_A })
})

function renderDialog(props?: { initialTab?: 'nostr' | 'passkey'; hint?: string }) {
  const onOpenChange = vi.fn()
  render(<MergeDialog open onOpenChange={onOpenChange} {...props} />)
  return { onOpenChange }
}

function radioGroup(name: string) {
  return screen.getByRole('radiogroup', { name })
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

  it('seeds the proof tab and shows the hint banner', async () => {
    renderDialog({
      initialTab: 'passkey',
      hint: 'That passkey already belongs to another account.'
    })

    expect(
      screen.getByText('That passkey already belongs to another account.')
    ).toBeInTheDocument()
    // The passkey panel is active without a tab click.
    expect(
      await screen.findByRole('button', { name: /prove with passkey/i })
    ).toBeInTheDocument()
  })

  it('walks prove → preview → resolve → review → commit with picked resolutions', async () => {
    const user = userEvent.setup()
    vi.mocked(proveNostrKey).mockResolvedValue(TICKET_RESPONSE)
    vi.mocked(fetchMergePreview).mockResolvedValue(PREVIEW)
    vi.mocked(commitMerge).mockResolvedValue(MERGE_RESULT)
    // The chosen main key is available as a signer → the profile choice
    // publishes client-side after the merge.
    mocks.requestSigner.mockResolvedValue({ getPublicKey: async () => PK_C })
    const publishedProfile = {
      pubkey: PK_C,
      npub: 'npub-test',
      displayName: 'Bob',
      picture: 'https://img/bob.png',
      fetchedAt: Date.now()
    }
    vi.mocked(publishProfile).mockResolvedValue(publishedProfile)

    const { onOpenChange } = renderDialog()
    await user.click(screen.getByRole('button', { name: 'mock-nostr-prove' }))

    // Preview: side-by-side cards, no decisions yet.
    await screen.findByText('This account')
    expect(screen.getByText('Incoming account')).toBeInTheDocument()
    expect(fetchMergePreview).toHaveBeenCalledWith(
      'jwt-token',
      TICKET_RESPONSE.mergeTicket
    )
    expect(screen.queryAllByRole('radio')).toHaveLength(0)
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    // Resolve: every conflict section appears; pick the absorbed side
    // everywhere.
    await screen.findByRole('radiogroup', { name: 'Main public identity' })
    const identityRadios = within(
      radioGroup('Main public identity')
    ).getAllByRole('radio')
    expect(identityRadios).toHaveLength(3)
    expect(identityRadios[0]).toBeChecked() // survivor's current primary
    expect(screen.getByText(/current primary/)).toBeInTheDocument()
    await user.click(identityRadios[2])

    await user.click(within(radioGroup('Avatar')).getAllByRole('radio')[1])
    await user.click(within(radioGroup('Display name')).getAllByRole('radio')[1])
    await user.click(
      within(radioGroup('Primary lightning address')).getAllByRole('radio')[1]
    )
    await user.click(within(radioGroup('Default wallet')).getAllByRole('radio')[1])
    expect(
      screen.getByText(/Relay lists will be merged — 3 relays/)
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    // Review: every decision summarized before the destructive commit.
    await screen.findByText('Review & merge')
    expect(screen.getByText('From the other account')).toBeInTheDocument()
    expect(screen.getByText('Bob (from the other account)')).toBeInTheDocument()
    expect(screen.getByText('bob')).toBeInTheDocument()
    expect(screen.getByText('Old wallet')).toBeInTheDocument()
    expect(screen.getByText('Merged (3 total)')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Merge accounts' }))

    await waitFor(() =>
      expect(commitMerge).toHaveBeenCalledWith(
        'jwt-token',
        TICKET_RESPONSE.mergeTicket,
        PK_C,
        { primaryAddressUsername: 'bob', defaultWalletId: 'w2' }
      )
    )

    // Done: counts + relay union, then the client-side kind-0 publish.
    await screen.findByText('Accounts merged')
    expect(mocks.refreshSession).toHaveBeenCalled()
    expect(mocks.refetch).toHaveBeenCalled()
    expect(screen.getByText('1 identity moved')).toBeInTheDocument()
    expect(screen.getByText('2 passkeys moved')).toBeInTheDocument()
    expect(
      screen.getByText('3 relays in the merged relay list')
    ).toBeInTheDocument()

    await waitFor(() =>
      expect(publishProfile).toHaveBeenCalledWith(
        expect.objectContaining({ getPublicKey: expect.any(Function) }),
        null,
        { picture: 'https://img/bob.png', displayName: 'Bob' }
      )
    )
    await waitFor(() =>
      expect(mocks.updateProfile).toHaveBeenCalledWith(publishedProfile)
    )
    expect(mocks.toastInfo).not.toHaveBeenCalled()

    // Two "Close" buttons exist: the dialog's built-in X and the footer CTA.
    const footerClose = screen
      .getAllByRole('button', { name: 'Close' })
      .find(button => button.className.includes('w-full'))
    expect(footerClose).toBeDefined()
    await user.click(footerClose!)
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('only asks about real conflicts and omits resolutions when there are none', async () => {
    const user = userEvent.setup()
    vi.mocked(proveNostrKey).mockResolvedValue(TICKET_RESPONSE)
    vi.mocked(fetchMergePreview).mockResolvedValue(NO_CONFLICT_PREVIEW)
    vi.mocked(commitMerge).mockResolvedValue({
      ...MERGE_RESULT,
      mainPubkey: PK_A,
      mergedRelays: 0
    })
    renderDialog()

    await user.click(screen.getByRole('button', { name: 'mock-nostr-prove' }))
    await screen.findByText('This account')
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    // Resolve: only the main-identity picker.
    await screen.findByRole('radiogroup', { name: 'Main public identity' })
    expect(screen.getAllByRole('radio')).toHaveLength(3)
    expect(
      screen.queryByRole('radiogroup', { name: 'Avatar' })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('radiogroup', { name: 'Display name' })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('radiogroup', { name: 'Primary lightning address' })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('radiogroup', { name: 'Default wallet' })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByText(/Relay lists will be merged/)
    ).not.toBeInTheDocument()

    // Default main identity (survivor primary) → commit without resolutions.
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await screen.findByText('Review & merge')
    await user.click(screen.getByRole('button', { name: 'Merge accounts' }))

    await waitFor(() =>
      expect(commitMerge).toHaveBeenCalledWith(
        'jwt-token',
        TICKET_RESPONSE.mergeTicket,
        PK_A,
        undefined
      )
    )
    await screen.findByText('Accounts merged')
    expect(
      screen.queryByText(/merged relay list/)
    ).not.toBeInTheDocument()
    // No profile conflict → no signer request, no kind-0 publish.
    expect(mocks.requestSigner).not.toHaveBeenCalled()
    expect(publishProfile).not.toHaveBeenCalled()
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
    // No Continue into the resolve step while blocked.
    expect(
      screen.queryByRole('button', { name: 'Continue' })
    ).not.toBeInTheDocument()
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

describe('PasskeysSection duplicate-passkey escalation', () => {
  it('routes kind=duplicate to onDuplicatePasskey without a toast', async () => {
    const user = userEvent.setup()
    mocks.addPasskey.mockRejectedValue(
      new PasskeyError('duplicate', 'This passkey is already registered')
    )
    const onDuplicatePasskey = vi.fn()

    render(
      <PasskeysSection
        onDuplicatePasskey={onDuplicatePasskey}
      />
    )

    await user.click(screen.getByRole('button', { name: /add a passkey/i }))
    await waitFor(() => expect(onDuplicatePasskey).toHaveBeenCalledTimes(1))
    expect(mocks.toastError).not.toHaveBeenCalled()
  })

  it('keeps the plain error toast when no handler is provided', async () => {
    const user = userEvent.setup()
    mocks.addPasskey.mockRejectedValue(
      new PasskeyError('duplicate', 'This passkey is already registered')
    )

    render(<PasskeysSection />)

    await user.click(screen.getByRole('button', { name: /add a passkey/i }))
    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        'This passkey is already registered'
      )
    )
  })
})
