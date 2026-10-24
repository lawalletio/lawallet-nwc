import type { NostrSigner } from '@nostrify/nostrify'

const providers = new WeakMap<NostrSigner, () => void>()

/** Provider keys stay outside LaWallet; the SDK owns protocol validation and teardown. */
export async function createPasskeyProviderSigner(
  url: string,
  signal?: AbortSignal
): Promise<NostrSigner> {
  const { NosskeyIframeSigner } = await import('nostr-wot-sdk/signers')
  signal?.throwIfAborted()
  const provider = new NosskeyIframeSigner({ iframeUrl: url })
  const abort = () => provider.close()
  signal?.addEventListener('abort', abort, { once: true })
  try {
    await provider.ready()
    signal?.throwIfAborted()
    const signer: NostrSigner = {
      getPublicKey: () => provider.getPublicKey(),
      signEvent: event => provider.signEvent(event),
      nip04: {
        encrypt: (p, v) => provider.nip04Encrypt(p, v),
        decrypt: (p, v) => provider.nip04Decrypt(p, v)
      },
      nip44: {
        encrypt: (p, v) => provider.nip44Encrypt(p, v),
        decrypt: (p, v) => provider.nip44Decrypt(p, v)
      }
    }
    providers.set(signer, () => {
      signal?.removeEventListener('abort', abort)
      provider.close()
    })
    return signer
  } catch (error) {
    signal?.removeEventListener('abort', abort)
    provider.close()
    throw error
  }
}

export function closePasskeyProviderSigner(signer: NostrSigner | null) {
  if (!signer) return
  providers.get(signer)?.()
  providers.delete(signer)
}
