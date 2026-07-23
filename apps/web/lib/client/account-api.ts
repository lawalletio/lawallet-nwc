import type { NostrSigner } from '@nostrify/nostrify'
import type {
  AccountLinkVerifyResponse,
  AccountMergePreviewResponse,
  AccountMergeResponse
} from '@/lib/validation/schemas'
import { createNsecSigner } from '@/lib/client/nostr-signer'
import { derivePrfNsecHex, getPrfAssertion } from '@/lib/client/passkey-prf'

/** NIP-42 client-authentication kind; the server accepts it as link proof. */
const LINK_PROOF_EVENT_KIND = 22242

async function request<T>(
  path: string,
  token: string,
  init?: { method?: string; body?: unknown }
): Promise<T> {
  const response = await fetch(path, {
    method: init?.method ?? 'POST',
    cache: 'no-store',
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init?.body !== undefined ? { 'Content-Type': 'application/json' } : {})
    },
    ...(init?.body !== undefined ? { body: JSON.stringify(init.body) } : {})
  })

  if (!response.ok) {
    const payload = await response.json().catch(() => null)
    throw new Error(
      payload?.error?.message || `Request failed (${response.status})`
    )
  }
  return response.json()
}

/**
 * Proves control of another Nostr key with a signer for it: fetches a
 * challenge, signs a NIP-42 (kind 22242) event carrying the nonce, and
 * submits the proof. The response either links the key directly (it was
 * unowned) or returns a merge ticket for the owning account.
 */
export async function proveNostrKey(
  token: string,
  signer: NostrSigner,
  label?: string
): Promise<AccountLinkVerifyResponse> {
  const begin = await request<{ challenge: string; nonce: string }>(
    '/api/account/identities/link/begin',
    token,
    { body: { method: 'nostr' } }
  )

  const event = await signer.signEvent({
    kind: LINK_PROOF_EVENT_KIND,
    created_at: Math.floor(Date.now() / 1000),
    tags: [['challenge', begin.nonce]],
    content: ''
  })

  return request<AccountLinkVerifyResponse>(
    '/api/account/identities/link/verify',
    token,
    { body: { method: 'nostr', challenge: begin.challenge, event, ...(label ? { label } : {}) } }
  )
}

/**
 * Proves control of another account via one of its passkeys — entirely
 * client-side under the PRF model: the assertion evaluates the PRF, the
 * other account's key falls out deterministically, and the ordinary Nostr
 * signed-event proof runs with it. The server never sees an assertion.
 */
export async function provePasskeyAccount(
  token: string
): Promise<AccountLinkVerifyResponse> {
  const assertion = await getPrfAssertion()
  const secretHex = await derivePrfNsecHex(assertion.prfOutput)
  return proveNostrKey(token, createNsecSigner(secretHex))
}

/** Read-only merge dry run for the side-by-side preview. */
export function fetchMergePreview(
  token: string,
  mergeTicket: string
): Promise<AccountMergePreviewResponse> {
  return request<AccountMergePreviewResponse>('/api/account/merge/preview', token, {
    body: { mergeTicket }
  })
}

/**
 * Destructive merge commit. `mainPubkey` picks the surviving primary;
 * `resolutions` carries the wizard's per-conflict answers (omitted fields
 * fall back to survivor-wins defaults server-side).
 */
export function commitMerge(
  token: string,
  mergeTicket: string,
  mainPubkey: string,
  resolutions?: { primaryAddressUsername?: string; defaultWalletId?: string }
): Promise<AccountMergeResponse> {
  return request<AccountMergeResponse>('/api/account/merge', token, {
    body: {
      mergeTicket,
      mainPubkey,
      ...(resolutions ? { resolutions } : {})
    }
  })
}
