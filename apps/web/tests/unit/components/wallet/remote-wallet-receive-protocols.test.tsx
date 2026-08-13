import { fireEvent, render, screen } from '@testing-library/react'
import { nip19 } from 'nostr-tools'
import { describe, expect, it } from 'vitest'
import { RemoteWalletReceiveProtocols } from '@/components/wallet/remote-wallet-receive-protocols'

const RECEIPT_PUBKEY =
  '61894d9d9ed594ddd9aabdc144e196e41f1f0030dbadca8e20a26721dcb2a010'

/** Open a protocol chip's details dialog. */
function openChip(label: string) {
  fireEvent.click(
    screen.getByRole('button', { name: new RegExp(label, 'i') })
  )
}

describe('RemoteWalletReceiveProtocols', () => {
  it('displays the receipt signer as an npub, never raw hex', () => {
    render(
      <RemoteWalletReceiveProtocols
        active
        capabilities={{
          lud21: true,
          nip57: true,
          receiptPubkey: RECEIPT_PUBKEY,
          reason: null
        }}
      />
    )

    openChip('NIP-57')
    const dialog = screen.getByRole('dialog')

    expect(dialog).toHaveTextContent(nip19.npubEncode(RECEIPT_PUBKEY))
    expect(dialog).not.toHaveTextContent(RECEIPT_PUBKEY)
  })

  it('leaves an existing npub unchanged', () => {
    const npub = nip19.npubEncode(RECEIPT_PUBKEY)
    render(
      <RemoteWalletReceiveProtocols
        active
        capabilities={{
          lud21: true,
          nip57: true,
          receiptPubkey: npub,
          reason: null
        }}
      />
    )

    openChip('NIP-57')
    expect(screen.getByRole('dialog')).toHaveTextContent(npub)
  })

  it('explains why zaps are off instead of hiding the protocol', () => {
    render(
      <RemoteWalletReceiveProtocols
        active
        capabilities={{
          lud21: true,
          nip57: false,
          receiptPubkey: null,
          reason: 'No zap receipt signer is configured.'
        }}
      />
    )

    openChip('NIP-57')
    expect(screen.getByRole('dialog')).toHaveTextContent(
      'No zap receipt signer is configured.'
    )
  })

  it('marks LUD-21 unavailable while the wallet is inactive', () => {
    render(<RemoteWalletReceiveProtocols active={false} />)

    openChip('LUD-21')
    expect(screen.getByRole('dialog')).toHaveTextContent(
      'Available once this remote wallet is active.'
    )
  })
})
