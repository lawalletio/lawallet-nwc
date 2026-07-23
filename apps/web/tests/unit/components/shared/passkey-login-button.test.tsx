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
  toastError: vi.fn()
}))

vi.mock('@/components/admin/auth-context', () => ({
  useAuth: () => ({ login: mocks.login })
}))

vi.mock('@/lib/client/nostr-signer', () => ({
  createNsecSigner: mocks.createNsecSigner
}))

vi.mock('sonner', () => ({
  toast: { error: mocks.toastError, success: vi.fn() }
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

import { PasskeyLoginButton } from '@/components/shared/passkey-login-button'
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

    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1))
    expect(authenticateWithPasskey).toHaveBeenCalledTimes(1)
    expect(registerPasskeyAccount).not.toHaveBeenCalled()
    // The derived hex secret feeds both the signer and the persisted
    // credentials — exactly like the nsec method.
    expect(mocks.createNsecSigner).toHaveBeenCalledWith(SECRET_HEX)
    expect(mocks.login).toHaveBeenCalledWith(STUB_SIGNER, 'passkey', {
      secret: SECRET_HEX
    })
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
        secret: SECRET_HEX
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
      await screen.findByText(/cannot derive a key on this device/i)
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

    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /continue with passkey/i })
      ).toBeEnabled()
    )
    expect(mocks.login).toHaveBeenCalledTimes(1)
  })

  it('honors a custom label and the disabled prop', () => {
    render(
      <PasskeyLoginButton mode="authenticate" label="Use passkey" disabled />
    )
    expect(screen.getByRole('button', { name: 'Use passkey' })).toBeDisabled()
  })
})
