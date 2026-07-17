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
  loginWithToken: vi.fn(),
  toastError: vi.fn()
}))

vi.mock('@/components/admin/auth-context', () => ({
  useAuth: () => ({ loginWithToken: mocks.loginWithToken })
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
  type PasskeySession
} from '@/lib/client/passkey-api'

const SIGNER_KEY = 'a'.repeat(64)

const SESSION: PasskeySession = {
  token: 'jwt-token',
  expiresIn: '24h',
  type: 'Bearer',
  pubkey: 'b'.repeat(64),
  custody: 'linked'
}

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
  mocks.loginWithToken.mockResolvedValue(undefined)
})

describe('PasskeyLoginButton', () => {
  it('renders nothing when the browser lacks WebAuthn support', () => {
    vi.mocked(isPasskeySupported).mockReturnValue(false)
    const { container } = render(<PasskeyLoginButton mode="authenticate" />)
    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('authenticate mode: runs the ceremony then commits the session', async () => {
    const user = userEvent.setup()
    vi.mocked(authenticateWithPasskey).mockResolvedValue(SESSION)
    const onSuccess = vi.fn()

    render(<PasskeyLoginButton mode="authenticate" onSuccess={onSuccess} />)

    await user.click(
      screen.getByRole('button', { name: /continue with passkey/i })
    )

    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1))
    expect(authenticateWithPasskey).toHaveBeenCalledTimes(1)
    expect(registerPasskeyAccount).not.toHaveBeenCalled()
    // Authentication sessions carry no signerKey — the third arg is undefined.
    expect(mocks.loginWithToken).toHaveBeenCalledWith(
      'jwt-token',
      'passkey',
      undefined
    )
  })

  it('register mode: passes the one-time signerKey through to loginWithToken', async () => {
    const user = userEvent.setup()
    vi.mocked(registerPasskeyAccount).mockResolvedValue({
      ...SESSION,
      custody: 'managed',
      signerKey: SIGNER_KEY
    })

    render(<PasskeyLoginButton mode="register" />)

    await user.click(
      screen.getByRole('button', { name: /create with a passkey/i })
    )

    await waitFor(() =>
      expect(mocks.loginWithToken).toHaveBeenCalledWith(
        'jwt-token',
        'passkey',
        SIGNER_KEY
      )
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
    expect(mocks.loginWithToken).not.toHaveBeenCalled()
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
    expect(mocks.loginWithToken).not.toHaveBeenCalled()
  })

  it('disables the button and shows the waiting label while the ceremony is pending', async () => {
    const user = userEvent.setup()
    const pending = deferred<PasskeySession>()
    vi.mocked(authenticateWithPasskey).mockReturnValue(pending.promise)

    render(<PasskeyLoginButton mode="authenticate" />)

    await user.click(
      screen.getByRole('button', { name: /continue with passkey/i })
    )

    const busyButton = await screen.findByRole('button', {
      name: /waiting for your device/i
    })
    expect(busyButton).toBeDisabled()

    pending.resolve(SESSION)

    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /continue with passkey/i })
      ).toBeEnabled()
    )
    expect(mocks.loginWithToken).toHaveBeenCalledTimes(1)
  })

  it('honors a custom label and the disabled prop', () => {
    render(
      <PasskeyLoginButton mode="authenticate" label="Use passkey" disabled />
    )
    expect(screen.getByRole('button', { name: 'Use passkey' })).toBeDisabled()
  })
})
