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
import { getPublicKey } from 'nostr-tools/pure'

vi.mock('@simplewebauthn/browser', () => ({
  browserSupportsWebAuthn: vi.fn(() => true),
  startRegistration: vi.fn()
}))

const mocks = vi.hoisted(() => ({
  login: vi.fn(),
  provider: vi.fn(),
  closeProvider: vi.fn(),
  createNsecSigner: vi.fn(() => 'signer'),
  toastError: vi.fn(),
  toastSuccess: vi.fn()
}))

vi.mock('@/components/admin/auth-context', () => ({
  useAuth: () => ({ login: mocks.login })
}))
vi.mock('@/lib/client/nostr-signer', () => ({
  createNsecSigner: mocks.createNsecSigner
}))
vi.mock('@/lib/client/passkey-provider', () => ({
  createPasskeyProviderSigner: mocks.provider,
  closePasskeyProviderSigner: mocks.closeProvider
}))
vi.mock('sonner', () => ({
  toast: { error: mocks.toastError, success: mocks.toastSuccess }
}))
vi.mock('@/lib/client/passkey-import', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/client/passkey-import')>()),
  readImportSource: vi.fn(),
  protectImportedKey: vi.fn(),
  linkKeptKey: vi.fn()
}))

import { PasskeyImportPanel } from '@/components/shared/passkey-import-panel'
import { storedPasskeyError } from '@/lib/client/passkey-api'
import { startRegistration } from '@simplewebauthn/browser'
import {
  linkKeptKey,
  protectImportedKey,
  readImportSource,
  readRememberedSource,
  rememberSource,
  REMEMBERED_SOURCE_KEY
} from '@/lib/client/passkey-import'
import { toNpub } from '@/lib/client/format'
import { hexToBytes, type StoredAccount } from '@/lib/passkey-store'

const SOURCE = { label: 'Test source', rpId: 'passkeys.example' }
const KEY_A = '00'.repeat(31) + '0a'
const KEY_B = '00'.repeat(31) + '0b'
const PUB_A = getPublicKey(hexToBytes(KEY_A))
const PUB_B = getPublicKey(hexToBytes(KEY_B))

function vault(): StoredAccount[] {
  return [
    {
      pubkey: PUB_A,
      secret: hexToBytes(KEY_A),
      label: 'Personal',
      default: false
    },
    { pubkey: PUB_B, secret: hexToBytes(KEY_B), label: 'Work', default: true }
  ]
}

const SOURCE_CREDENTIAL = 'c291cmNlLWNyZWRlbnRpYWw'

function imported(accounts: StoredAccount[]) {
  return {
    source: SOURCE,
    author: PUB_B,
    credentialId: SOURCE_CREDENTIAL,
    accounts
  }
}

async function confirmAndChoose(option: RegExp) {
  await userEvent.click(
    screen.getByRole('button', { name: 'Yes, this is my account' })
  )
  expect(
    screen.getByText('How do you want to sign in next time?')
  ).toBeInTheDocument()
  // "Keep" is preselected.
  expect(screen.getByRole('radio', { checked: true })).toHaveTextContent(
    'Keep using this passkey'
  )
  await userEvent.click(screen.getByRole('radio', { name: option }))
  await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
}

beforeEach(() => {
  vi.mocked(readImportSource).mockReset()
  vi.mocked(protectImportedKey).mockReset()
  vi.mocked(linkKeptKey).mockReset()
  vi.mocked(startRegistration).mockReset()
  mocks.login.mockReset()
  mocks.toastSuccess.mockReset()
  localStorage.clear()
})

describe('PasskeyImportPanel', () => {
  it('shows a failed recovery copy warning before account confirmation', async () => {
    vi.mocked(readImportSource).mockResolvedValue({
      ...imported(vault()),
      warnings: ['A recovery copy failed; check for possible tampering.']
    })
    render(
      <PasskeyImportPanel sources={[SOURCE]} mode="signin" onDone={vi.fn()} />
    )
    await userEvent.click(
      screen.getByRole('button', {
        name: /Test source/
      })
    )
    expect(screen.getByRole('status')).toHaveTextContent('possible tampering')
  })

  it('preselects the default account, confirms its npub, makes a LaWallet passkey and logs in', async () => {
    const accounts = vault()
    vi.mocked(readImportSource).mockResolvedValue(imported(accounts))
    vi.mocked(protectImportedKey).mockResolvedValue({
      secretHex: KEY_B,
      nsec: 'nsec1',
      pubkey: PUB_B,
      credentialId: 'own',
      credential: {} as never
    })
    const onDone = vi.fn()
    render(
      <PasskeyImportPanel
        sources={[SOURCE]}
        mode="link"
        token="jwt"
        onDone={onDone}
      />
    )

    await userEvent.click(
      screen.getByRole('button', {
        name: /Test source/
      })
    )
    expect(readImportSource).toHaveBeenCalledWith(SOURCE)

    expect(screen.getAllByRole('radio')).toHaveLength(2)
    expect(screen.getByRole('radio', { checked: true })).toHaveTextContent(
      'Work'
    )
    expect(screen.getByTestId('passkey-import-npub')).toHaveTextContent(
      toNpub(PUB_B)
    )

    await userEvent.click(screen.getByRole('radio', { name: /Personal/ }))
    expect(screen.getByTestId('passkey-import-npub')).toHaveTextContent(
      toNpub(PUB_A)
    )
    await userEvent.click(screen.getByRole('radio', { name: /Work/ }))

    await confirmAndChoose(/Make a LaWallet passkey/)
    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(vi.mocked(protectImportedKey).mock.calls[0][0].pubkey).toBe(PUB_B)
    expect(vi.mocked(protectImportedKey).mock.calls[0][1]).toBe('jwt')
    expect(mocks.login).not.toHaveBeenCalled()
    // Every decrypted account is wiped once the flow ends.
    for (const account of accounts) {
      expect(account.secret.every(b => b === 0)).toBe(true)
    }
    expect(readRememberedSource()).toBeNull()
  })

  it('keeps the other passkey: no LaWallet passkey, remembers only rpId, credential and pubkey', async () => {
    const accounts = vault()
    vi.mocked(readImportSource).mockResolvedValue(imported(accounts))
    const onDone = vi.fn()
    render(
      <PasskeyImportPanel sources={[SOURCE]} mode="signin" onDone={onDone} />
    )
    await userEvent.click(screen.getByRole('button', { name: /Test source/ }))
    await userEvent.click(
      screen.getByRole('button', { name: 'Yes, this is my account' })
    )
    await userEvent.click(
      screen.getByRole('checkbox', { name: /Remember this account/ })
    )
    await userEvent.click(screen.getByRole('button', { name: 'Use this time' }))
    await waitFor(() => expect(onDone).toHaveBeenCalled())

    expect(protectImportedKey).not.toHaveBeenCalled()
    expect(startRegistration).not.toHaveBeenCalled()
    expect(mocks.login).toHaveBeenCalledWith('signer', 'passkey', {
      secret: KEY_B,
      persistence: 'memory',
      signal: expect.any(AbortSignal)
    })
    expect(JSON.parse(localStorage.getItem(REMEMBERED_SOURCE_KEY)!)).toEqual({
      rpId: SOURCE.rpId,
      credentialId: SOURCE_CREDENTIAL,
      pubkey: PUB_B
    })
    for (const account of accounts) {
      expect(account.secret.every(b => b === 0)).toBe(true)
    }
  })

  it('keeps the other passkey from settings by linking its key, no passkey', async () => {
    vi.mocked(readImportSource).mockResolvedValue(imported([vault()[1]]))
    render(<PasskeyImportPanel sources={[SOURCE]} mode="link" token="jwt" />)
    await userEvent.click(screen.getByRole('button', { name: /Test source/ }))
    await confirmAndChoose(/Keep using this passkey/)
    await waitFor(() => expect(mocks.toastSuccess).toHaveBeenCalled())
    expect(linkKeptKey).toHaveBeenCalledWith(KEY_B, 'jwt')
    expect(protectImportedKey).not.toHaveBeenCalled()
    expect(mocks.login).not.toHaveBeenCalled()
    expect(readRememberedSource()?.pubkey).toBe(PUB_B)
  })

  it('a LaWallet copy replaces the remembered entry for the same passkey', async () => {
    rememberSource({
      rpId: SOURCE.rpId,
      credentialId: SOURCE_CREDENTIAL,
      pubkey: PUB_B
    })
    vi.mocked(readImportSource).mockResolvedValue(imported([vault()[1]]))
    vi.mocked(protectImportedKey).mockResolvedValue({
      secretHex: KEY_B,
      pubkey: PUB_B
    } as never)
    render(<PasskeyImportPanel sources={[SOURCE]} mode="link" token="jwt" />)
    await userEvent.click(screen.getByRole('button', { name: /Test source/ }))
    await confirmAndChoose(/Make a LaWallet passkey/)
    await waitFor(() => expect(mocks.toastSuccess).toHaveBeenCalled())
    expect(readRememberedSource()).toBeNull()
  })

  it('links instead of logging in from settings', async () => {
    vi.mocked(readImportSource).mockResolvedValue(imported([vault()[1]]))
    vi.mocked(protectImportedKey).mockResolvedValue({ pubkey: PUB_B } as never)
    render(<PasskeyImportPanel sources={[SOURCE]} mode="link" token="jwt" />)

    await userEvent.click(screen.getByRole('button', { name: /Test source/ }))
    // One account: no picker.
    expect(screen.queryAllByRole('radio')).toHaveLength(0)
    await confirmAndChoose(/Make a LaWallet passkey/)
    await waitFor(() => expect(mocks.toastSuccess).toHaveBeenCalled())
    expect(vi.mocked(protectImportedKey).mock.calls[0][1]).toBe('jwt')
    expect(mocks.login).not.toHaveBeenCalled()
  })

  it('wipes the keys when the user says it is not their account', async () => {
    const accounts = vault()
    vi.mocked(readImportSource).mockResolvedValue(imported(accounts))
    render(<PasskeyImportPanel sources={[SOURCE]} mode="signin" />)
    await userEvent.click(screen.getByRole('button', { name: /Test source/ }))
    await userEvent.click(
      screen.getByRole('button', { name: 'Not my account' })
    )
    expect(protectImportedKey).not.toHaveBeenCalled()
    expect(accounts.every(a => a.secret.every(b => b === 0))).toBe(true)
    expect(
      screen.getByRole('button', { name: /Test source/ })
    ).toBeInTheDocument()
  })

  it('shows a clear refusal for a derived passkey', async () => {
    vi.mocked(readImportSource).mockRejectedValue(
      storedPasskeyError('import-derived')
    )
    render(<PasskeyImportPanel sources={[SOURCE]} mode="signin" />)
    await userEvent.click(screen.getByRole('button', { name: /Test source/ }))
    expect(
      await screen.findByText(/creates its key itself/)
    ).toBeInTheDocument()
  })

  it('asks which app when there are several sources', () => {
    render(
      <PasskeyImportPanel
        sources={[SOURCE, { label: 'Another', rpId: 'another.example' }]}
        mode="signin"
      />
    )
    expect(screen.getByText('Choose your passkey’s app')).toBeInTheDocument()
    expect(screen.getAllByRole('button')).toHaveLength(2)
  })
})

it('uses a temporary session by default without copying or remembering a source', async () => {
  vi.mocked(readImportSource).mockResolvedValue(imported(vault()))
  render(<PasskeyImportPanel sources={[SOURCE]} mode="signin" />)
  await userEvent.click(screen.getByRole('button', { name: /Test source/ }))
  await userEvent.click(
    screen.getByRole('button', { name: 'Yes, this is my account' })
  )
  expect(
    screen.queryByRole('radio', { name: /Make a LaWallet passkey/ })
  ).toBeNull()
  expect(
    screen.getByRole('checkbox', { name: /Remember this account/ })
  ).not.toBeChecked()
  await userEvent.click(screen.getByRole('button', { name: 'Use this time' }))
  await waitFor(() => expect(mocks.login).toHaveBeenCalled())
  expect(readRememberedSource()).toBeNull()
  expect(protectImportedKey).not.toHaveBeenCalled()
})

it('searches a larger configured source directory without opening a ceremony', async () => {
  const sources = Array.from({ length: 8 }, (_, i) => ({
    label: `Source ${i}`,
    rpId: `source${i}.example`
  }))
  render(<PasskeyImportPanel sources={sources} mode="signin" />)
  await userEvent.type(
    screen.getByRole('textbox', { name: 'Search apps or enter a domain' }),
    'Source 7'
  )
  expect(screen.getAllByRole('button', { name: /Source 7/ })).toHaveLength(1)
  expect(readImportSource).not.toHaveBeenCalled()
})

describe('provider signing', () => {
  it('uses an isolated memory session without importing a key', async () => {
    const signer = {
      getPublicKey: vi.fn(async () => PUB_A),
      signEvent: vi.fn()
    }
    mocks.provider.mockResolvedValue(signer)
    mocks.login.mockResolvedValue(undefined)
    render(
      <PasskeyImportPanel
        sources={[
          { ...SOURCE, iframeUrl: 'https://provider.example/#/iframe' }
        ]}
        mode="signin"
      />
    )
    await userEvent.click(
      screen.getByRole('button', { name: 'Sign with Test source' })
    )
    await waitFor(() =>
      expect(screen.getByTestId('passkey-import-npub')).toBeInTheDocument()
    )
    await userEvent.click(
      screen.getByRole('button', { name: 'Yes, this is my account' })
    )
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Use this time' }))
    await waitFor(() =>
      expect(mocks.login).toHaveBeenCalledWith(signer, 'passkey', {
        secret: '',
        persistence: 'memory',
        signal: expect.any(AbortSignal)
      })
    )
    expect(readImportSource).not.toHaveBeenCalled()
  })
})

it('cancels backup-key sign-in when the panel unmounts during the exchange', async () => {
  vi.mocked(readImportSource).mockResolvedValue(imported(vault()))
  mocks.login.mockImplementation(
    (_signer, _method, credentials) =>
      new Promise<void>((_resolve, reject) => {
        credentials.signal?.addEventListener('abort', () =>
          reject(new DOMException('Cancelled', 'AbortError'))
        )
      })
  )
  const onDone = vi.fn()
  const { unmount } = render(
    <PasskeyImportPanel sources={[SOURCE]} mode="signin" onDone={onDone} />
  )
  await userEvent.click(screen.getByRole('button', { name: /Test source/ }))
  await userEvent.click(
    screen.getByRole('button', { name: 'Yes, this is my account' })
  )
  await userEvent.click(
    screen.getByRole('checkbox', { name: /Remember this account/ })
  )
  await userEvent.click(screen.getByRole('button', { name: 'Use this time' }))
  await waitFor(() => expect(mocks.login).toHaveBeenCalled())
  const signal = mocks.login.mock.calls[0][2].signal
  unmount()
  expect(signal).toBeInstanceOf(AbortSignal)
  expect(signal.aborted).toBe(true)
  expect(onDone).not.toHaveBeenCalled()
  expect(readRememberedSource()).toBeNull()
})

describe('manual passkey source', () => {
  it('accepts a bare domain without inventing a provider or relays', async () => {
    vi.mocked(readImportSource).mockRejectedValue(
      storedPasskeyError('import-blocked')
    )
    render(<PasskeyImportPanel sources={[]} mode="signin" />)
    await userEvent.type(
      screen.getByRole('textbox', { name: 'Search apps or enter a domain' }),
      'passkeys.example.com'
    )
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(readImportSource).toHaveBeenCalledWith({
      label: 'passkeys.example.com',
      rpId: 'passkeys.example.com'
    })
    expect(
      await screen.findByText(/browser could not access passkeys/)
    ).toBeInTheDocument()
  })
  it('rejects URLs before opening a ceremony', async () => {
    render(<PasskeyImportPanel sources={[]} mode="signin" />)
    await userEvent.type(
      screen.getByRole('textbox', { name: 'Search apps or enter a domain' }),
      'https://example.com/path'
    )
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(readImportSource).not.toHaveBeenCalled()
    expect(screen.getByText(/Enter a domain such as/)).toBeInTheDocument()
  })
})
