import { render, screen } from '@testing-library/react'
import { nip19 } from 'nostr-tools'
import { describe, expect, it } from 'vitest'
import { RemoteWalletReceiveProtocols } from '@/components/wallet/remote-wallet-receive-protocols'

const RECEIPT_PUBKEY =
  '61894d9d9ed594ddd9aabdc144e196e41f1f0030dbadca8e20a26721dcb2a010'

describe('RemoteWalletReceiveProtocols', () => {
  it('displays the receipt signer as an npub while preserving the hex title', () => {
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

    const signer = screen.getByTitle(RECEIPT_PUBKEY)
    expect(signer).toHaveTextContent(nip19.npubEncode(RECEIPT_PUBKEY))
    expect(signer).not.toHaveTextContent(RECEIPT_PUBKEY)
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

    expect(screen.getByTitle(npub)).toHaveTextContent(npub)
  })
})
