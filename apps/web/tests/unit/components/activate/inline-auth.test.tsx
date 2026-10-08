import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('@simplewebauthn/browser', () => ({
  browserSupportsWebAuthn: vi.fn(() => true),
  startRegistration: vi.fn(),
  startAuthentication: vi.fn()
}))

const mocks = vi.hoisted(() => ({
  login: vi.fn(),
  createNsecSigner: vi.fn(),
  toastError: vi.fn(),
  communityName: 'Sats Club' as string | undefined
}))

vi.mock('@/components/admin/auth-context', () => ({
  useAuth: () => ({ login: mocks.login })
}))

vi.mock('@/lib/client/hooks/use-settings', () => ({
  useSettings: () => ({
    data: { community_name: mocks.communityName },
    loading: false
  })
}))

vi.mock('@/lib/client/nostr-signer', () => ({
  createNsecSigner: mocks.createNsecSigner
}))

vi.mock('sonner', () => ({
  toast: { error: mocks.toastError, success: vi.fn() }
}))

vi.mock('@/components/shared/nostr-connect-form', () => ({
  NostrConnectForm: () => null
}))

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

import { InlineAuth } from '@/components/activate/inline-auth'
import {
  PasskeyError,
  isPasskeySupported,
  registerPasskeyAccount
} from '@/lib/client/passkey-api'

const SECRET_HEX = 'a'.repeat(64)

beforeEach(() => {
  vi.clearAllMocks()
  mocks.communityName = 'Sats Club'
  mocks.login.mockResolvedValue(undefined)
  mocks.createNsecSigner.mockReturnValue({
    getPublicKey: vi.fn(),
    signEvent: vi.fn()
  })
  vi.mocked(isPasskeySupported).mockReturnValue(true)
})

describe('InlineAuth', () => {
  it('registers a new cardholder with a passkey for this community', async () => {
    const user = userEvent.setup()
    const onAuthStart = vi.fn()
    vi.mocked(registerPasskeyAccount).mockResolvedValue({
      secretHex: SECRET_HEX,
      nsec: 'nsec1test',
      pubkey: 'b'.repeat(64),
      credentialId: 'cred-1',
      credential: {
        id: 'cred-1',
        label: null,
        deviceType: 'multiDevice',
        backedUp: true,
        aaguid: null,
        rpId: 'localhost',
        pubkey: 'b'.repeat(64),
        createdAt: new Date().toISOString(),
        lastUsedAt: null
      }
    })

    render(<InlineAuth onAuthStart={onAuthStart} />)

    expect(
      screen.getByText(
        'Activate this card with a new passkey or a new Nostr key.'
      )
    ).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Nostr' })).toBeTruthy()
    expect(
      screen.queryByRole('button', { name: /create a new wallet/i })
    ).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Passkey' }))

    await waitFor(() => expect(onAuthStart).toHaveBeenCalledTimes(1))
    expect(registerPasskeyAccount).toHaveBeenCalledTimes(1)
    expect(mocks.login).toHaveBeenCalledWith(expect.anything(), 'passkey', {
      secret: SECRET_HEX
    })
  })

  it('explains a cancelled ceremony and a passkey that already exists', async () => {
    const user = userEvent.setup()
    vi.mocked(registerPasskeyAccount).mockRejectedValueOnce(
      new DOMException('closed', 'NotAllowedError')
    )

    render(<InlineAuth onAuthStart={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'Passkey' }))
    expect(
      await screen.findByText(/passkey prompt was closed — try again/i)
    ).toBeTruthy()
    expect(mocks.toastError).not.toHaveBeenCalled()

    vi.mocked(registerPasskeyAccount).mockRejectedValueOnce(
      new PasskeyError('duplicate', 'already registered')
    )
    await user.click(screen.getByRole('button', { name: 'Passkey' }))
    expect(
      await screen.findByText('This device already has a passkey.')
    ).toBeTruthy()
  })

  it('tells unsupported browsers to use Safari, Chrome, or a Nostr key', async () => {
    vi.mocked(isPasskeySupported).mockReturnValue(false)
    const user = userEvent.setup()
    render(<InlineAuth onAuthStart={vi.fn()} />)

    expect(screen.queryByRole('button', { name: 'Passkey' })).toBeNull()
    expect(screen.getByText(/cannot create a passkey/i)).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Nostr' }))
    expect(
      screen.getByRole('heading', { name: 'Your new Nostr key' })
    ).toBeTruthy()
  })

  it('creates a new Nostr key instead of connecting an existing one', async () => {
    const user = userEvent.setup()
    render(<InlineAuth onAuthStart={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'Nostr' }))
    expect(
      screen.getByRole('heading', { name: 'Your new Nostr key' })
    ).toBeTruthy()
    expect(
      screen.queryByRole('heading', { name: 'Connect your wallet' })
    ).toBeNull()
  })
})
