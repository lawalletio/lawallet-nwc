vi.mock('@/lib/client/nostr-profile', async original => ({
  ...(await original<typeof import('@/lib/client/nostr-profile')>()),
  useNostrProfile: () => ({
    profile: {
      name: 'Alice',
      displayName: 'Alice Example',
      picture: 'https://example.com/alice.png'
    },
    updateProfile: vi.fn()
  })
}))
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// happy-dom has no WebAuthn API — keep the browser layer out entirely.
vi.mock('@simplewebauthn/browser', () => ({
  browserSupportsWebAuthn: vi.fn(() => true),
  startRegistration: vi.fn(),
  startAuthentication: vi.fn()
}))

const mocks = vi.hoisted(() => ({
  login: vi.fn(),
  createNsecSigner: vi.fn(),
  toastWarning: vi.fn(),
  toastError: vi.fn()
}))

vi.mock('@/components/admin/auth-context', () => ({
  useAuth: () => ({ login: mocks.login })
}))

vi.mock('@/lib/client/nostr-signer', () => ({
  createNsecSigner: mocks.createNsecSigner
}))

vi.mock('sonner', () => ({
  toast: {
    warning: mocks.toastWarning,
    error: mocks.toastError,
    success: vi.fn()
  }
}))

// Keep the real translatePasskeyError / PasskeyError so the component's
// error-kind branching runs against production logic; only the ceremony
// entry points and the support gate are stubbed.
vi.mock('@/lib/client/passkey-api', async importOriginal => {
  const actual =
    await importOriginal<typeof import('@/lib/client/passkey-api')>()
  return {
    ...actual,
    isPasskeySupported: vi.fn(() => true),
    registerPasskeyAccount: vi.fn(),
    authenticateWithPasskey: vi.fn()
  }
})

vi.mock('@/lib/client/passkey-import', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/client/passkey-import')>()),
  signInWithRememberedSource: vi.fn()
}))

import { PasskeyLoginButton } from '@/components/shared/passkey-login-button'
import {
  readRememberedSource,
  rememberSource,
  signInWithRememberedSource
} from '@/lib/client/passkey-import'
import { hexToBytes, type StoredAccount } from '@/lib/passkey-store'
import {
  PasskeyError,
  authenticateWithPasskey,
  isPasskeySupported,
  registerPasskeyAccount,
  type PasskeyIdentity
} from '@/lib/client/passkey-api'

const SECRET_HEX = 'a'.repeat(64)

// Under the PRF model the ceremony yields the derived Nostr identity — the
// key IS the login; no server-minted session token exists anymore.
const IDENTITY: PasskeyIdentity = {
  secretHex: SECRET_HEX,
  nsec: 'nsec1derivedexample',
  pubkey: 'b'.repeat(64),
  credentialId: 'cred-1'
}

const STUB_SIGNER = { getPublicKey: vi.fn(), signEvent: vi.fn() }

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (err: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(isPasskeySupported).mockReturnValue(true)
  mocks.login.mockResolvedValue(undefined)
  mocks.createNsecSigner.mockReturnValue(STUB_SIGNER)
  localStorage.clear()
})

describe('PasskeyLoginButton', () => {
  it('renders nothing when the browser lacks WebAuthn support', () => {
    vi.mocked(isPasskeySupported).mockReturnValue(false)
    const { container } = render(<PasskeyLoginButton mode="authenticate" />)
    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('authenticate mode: derives the identity then logs in with an nsec signer', async () => {
    const user = userEvent.setup()
    vi.mocked(authenticateWithPasskey).mockResolvedValue(IDENTITY)
    const onSuccess = vi.fn()

    render(<PasskeyLoginButton mode="authenticate" onSuccess={onSuccess} />)

    await user.click(
      screen.getByRole('button', { name: /continue with passkey/i })
    )

    expect(mocks.login).not.toHaveBeenCalled()
    expect(await screen.findByText('Alice Example')).toBeInTheDocument()
    expect(screen.getByTestId('passkey-import-npub')).toHaveTextContent(
      /^npub1/
    )
    await user.click(
      await screen.findByRole('button', { name: 'Yes, this is my account' })
    )
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1))
    expect(authenticateWithPasskey).toHaveBeenCalledTimes(1)
    expect(registerPasskeyAccount).not.toHaveBeenCalled()
    // The derived hex secret feeds both the signer and the persisted
    // credentials — exactly like the nsec method.
    expect(mocks.createNsecSigner).toHaveBeenCalledWith(SECRET_HEX)
    expect(mocks.login).toHaveBeenCalledWith(STUB_SIGNER, 'passkey', {
      secret: SECRET_HEX,
      persistence: 'memory'
    })
  })

  it('can reject an identity and choose another without logging in', async () => {
    vi.mocked(authenticateWithPasskey).mockResolvedValue(IDENTITY)
    render(<PasskeyLoginButton mode="authenticate" />)
    await userEvent.click(
      screen.getByRole('button', { name: /continue with passkey/i })
    )
    await userEvent.click(
      await screen.findByRole('button', { name: 'Use a different passkey' })
    )
    expect(authenticateWithPasskey).toHaveBeenCalledTimes(1)
    await userEvent.click(
      screen.getByRole('button', { name: 'LaWallet' })
    )
    expect(authenticateWithPasskey).toHaveBeenCalledTimes(2)
    expect(mocks.login).not.toHaveBeenCalled()
    expect(await screen.findByText('Is this your account?')).toBeInTheDocument()
  })

  it('register mode: runs the registration ceremony then the same login path', async () => {
    const user = userEvent.setup()
    vi.mocked(registerPasskeyAccount).mockResolvedValue({
      ...IDENTITY,
      credential: {
        id: 'cred-1',
        label: null,
        deviceType: 'multiDevice',
        backedUp: true,
        aaguid: null,
        rpId: 'localhost',
        pubkey: IDENTITY.pubkey,
        createdAt: new Date().toISOString(),
        lastUsedAt: null
      }
    })

    render(<PasskeyLoginButton mode="register" />)

    await user.click(
      screen.getByRole('button', { name: /create with a passkey/i })
    )

    await waitFor(() =>
      expect(mocks.login).toHaveBeenCalledWith(STUB_SIGNER, 'passkey', {
        secret: SECRET_HEX,
        persistence: 'memory'
      })
    )
    expect(registerPasskeyAccount).toHaveBeenCalledTimes(1)
    expect(authenticateWithPasskey).not.toHaveBeenCalled()
  })

  it('user-cancelled ceremony: no toast and no inline error', async () => {
    const user = userEvent.setup()
    vi.mocked(authenticateWithPasskey).mockRejectedValue(
      new DOMException('user closed the prompt', 'NotAllowedError')
    )

    render(<PasskeyLoginButton mode="authenticate" />)

    await user.click(
      screen.getByRole('button', { name: /continue with passkey/i })
    )

    // Button settles back into its idle state after the silent reset.
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /continue with passkey/i })
      ).toBeEnabled()
    )
    expect(mocks.toastError).not.toHaveBeenCalled()
    expect(mocks.login).not.toHaveBeenCalled()
    expect(
      screen.queryByText(/passkey prompt was closed/i)
    ).not.toBeInTheDocument()
  })

  it('non-cancelled error: renders the inline error and toasts it', async () => {
    const user = userEvent.setup()
    vi.mocked(authenticateWithPasskey).mockRejectedValue(
      new PasskeyError('security', 'Passkeys need a secure origin')
    )

    render(<PasskeyLoginButton mode="authenticate" />)

    await user.click(
      screen.getByRole('button', { name: /continue with passkey/i })
    )

    expect(
      await screen.findByText('Passkeys need a secure origin')
    ).toBeInTheDocument()
    expect(mocks.toastError).toHaveBeenCalledWith(
      'Passkeys need a secure origin'
    )
    expect(mocks.login).not.toHaveBeenCalled()
  })

  it('surfaces the PRF-unsupported error from the derive step', async () => {
    const user = userEvent.setup()
    vi.mocked(authenticateWithPasskey).mockRejectedValue(
      new PasskeyError(
        'prf-unsupported',
        'This passkey cannot derive a key on this device'
      )
    )

    render(<PasskeyLoginButton mode="authenticate" />)

    await user.click(
      screen.getByRole('button', { name: /continue with passkey/i })
    )

    expect(
      await screen.findByText(/passkey provider can't create the key/i)
    ).toBeInTheDocument()
    expect(mocks.login).not.toHaveBeenCalled()
  })

  it('disables the button and shows the waiting label while the ceremony is pending', async () => {
    const user = userEvent.setup()
    const pending = deferred<PasskeyIdentity>()
    vi.mocked(authenticateWithPasskey).mockReturnValue(pending.promise)

    render(<PasskeyLoginButton mode="authenticate" />)

    await user.click(
      screen.getByRole('button', { name: /continue with passkey/i })
    )

    const busyButton = await screen.findByRole('button', {
      name: /waiting for your device/i
    })
    expect(busyButton).toBeDisabled()

    pending.resolve(IDENTITY)
    await user.click(
      await screen.findByRole('button', { name: 'Yes, this is my account' })
    )

    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /continue with passkey/i })
      ).toBeEnabled()
    )
    expect(mocks.login).toHaveBeenCalledTimes(1)
  })

  it('surfaces a retry hint when cancel is announced, without a toast', async () => {
    const user = userEvent.setup()
    vi.mocked(registerPasskeyAccount).mockRejectedValue(
      new DOMException('user closed the prompt', 'NotAllowedError')
    )

    render(<PasskeyLoginButton mode="register" surfaceCancel />)

    await user.click(
      screen.getByRole('button', { name: /create with a passkey/i })
    )

    expect(
      await screen.findByText(/passkey prompt was closed/i)
    ).toBeInTheDocument()
    expect(mocks.toastError).not.toHaveBeenCalled()
    expect(
      screen.getByRole('button', { name: /create with a passkey/i })
    ).toBeEnabled()
  })

  it('uses the caller duplicate message on the register path', async () => {
    const user = userEvent.setup()
    vi.mocked(registerPasskeyAccount).mockRejectedValue(
      new PasskeyError('duplicate', 'This device already has a passkey')
    )

    render(
      <PasskeyLoginButton
        mode="register"
        duplicateMessage="Sign in with the passkey you already created."
      />
    )

    await user.click(
      screen.getByRole('button', { name: /create with a passkey/i })
    )

    expect(
      await screen.findByText('Sign in with the passkey you already created.')
    ).toBeInTheDocument()
    expect(mocks.toastError).toHaveBeenCalledWith(
      'Sign in with the passkey you already created.'
    )
  })

  it('honors a custom label and the disabled prop', () => {
    render(
      <PasskeyLoginButton mode="authenticate" label="Use passkey" disabled />
    )
    expect(screen.getByRole('button', { name: 'Use passkey' })).toBeDisabled()
  })

  describe('with a remembered passkey from another app', () => {
    const ENTRY = {
      rpId: 'passkeys.example',
      credentialId: 'c291cmNl',
      pubkey: 'c'.repeat(64)
    }
    const SOURCE = { label: 'passkeys.example', rpId: 'passkeys.example' }

    it('reports failed recovery copies during a remembered sign-in', async () => {
      rememberSource(ENTRY)
      vi.mocked(signInWithRememberedSource).mockResolvedValue({
        secretHex: SECRET_HEX,
        warnings: ['A recovery copy failed.']
      })
      render(<PasskeyLoginButton mode="authenticate" />)
      await userEvent.click(
        screen.getByRole('button', { name: /continue with passkey/i })
      )
      await waitFor(() =>
        expect(mocks.toastWarning).toHaveBeenCalledWith(
          'A recovery copy failed.'
        )
      )
    })

    it('asks the remembered passkey first and logs in as its account', async () => {
      rememberSource(ENTRY)
      vi.mocked(signInWithRememberedSource).mockResolvedValue({
        secretHex: SECRET_HEX
      })
      const sources = [{ ...SOURCE, relays: ['wss://relay.example'] }]
      render(<PasskeyLoginButton mode="authenticate" importSources={sources} />)
      await userEvent.click(
        screen.getByRole('button', { name: /continue with passkey/i })
      )
      expect(mocks.login).not.toHaveBeenCalled()
      await userEvent.click(
        await screen.findByRole('button', { name: 'Yes, this is my account' })
      )
      await waitFor(() => expect(mocks.login).toHaveBeenCalled())
      expect(signInWithRememberedSource).toHaveBeenCalledWith(ENTRY, sources)
      expect(authenticateWithPasskey).not.toHaveBeenCalled()
      expect(mocks.createNsecSigner).toHaveBeenCalledWith(SECRET_HEX)
      expect(mocks.login).toHaveBeenCalledWith(STUB_SIGNER, 'passkey', {
        secret: SECRET_HEX,
        persistence: 'memory'
      })
    })

    it('shows the picker when the account is gone, then remembers the choice', async () => {
      rememberSource(ENTRY)
      const key = '00'.repeat(31) + '0a'
      const accounts: StoredAccount[] = [
        {
          pubkey: 'd'.repeat(64),
          secret: hexToBytes(key),
          label: 'Work',
          default: true
        }
      ]
      vi.mocked(signInWithRememberedSource).mockResolvedValue({
        imported: {
          source: SOURCE,
          author: 'd'.repeat(64),
          credentialId: ENTRY.credentialId,
          accounts
        }
      })
      render(<PasskeyLoginButton mode="authenticate" />)
      await userEvent.click(
        screen.getByRole('button', { name: /continue with passkey/i })
      )
      expect(
        await screen.findByText(/doesn't have the account you used before/)
      ).toBeInTheDocument()
      expect(mocks.login).not.toHaveBeenCalled()
      await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
      await waitFor(() =>
        expect(mocks.login).toHaveBeenCalledWith(STUB_SIGNER, 'passkey', {
          secret: key,
          persistence: 'memory'
        })
      )
      expect(readRememberedSource()).toEqual({
        ...ENTRY,
        pubkey: 'd'.repeat(64)
      })
      expect(accounts[0].secret.every(b => b === 0)).toBe(true)
    })

    it('offers to forget it after a failure; then behaves as before', async () => {
      rememberSource(ENTRY)
      vi.mocked(signInWithRememberedSource).mockRejectedValue(
        new PasskeyError('cancelled', 'closed')
      )
      vi.mocked(authenticateWithPasskey).mockResolvedValue(IDENTITY)
      render(<PasskeyLoginButton mode="authenticate" surfaceCancel />)
      await userEvent.click(
        screen.getByRole('button', { name: /continue with passkey/i })
      )
      await userEvent.click(
        await screen.findByRole('button', { name: 'Use a different passkey' })
      )
      await userEvent.click(
        screen.getByRole('button', { name: 'LaWallet' })
      )
      expect(readRememberedSource()).toBeNull()
      await waitFor(() => expect(authenticateWithPasskey).toHaveBeenCalled())
      expect(signInWithRememberedSource).toHaveBeenCalledTimes(1)
    })
  })
})
