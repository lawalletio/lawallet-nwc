'use client'

import { useLaWalletContext } from './provider'
import type { AuthState } from './provider'

/**
 * Nostr-first session state: who is signed in (their signer, pubkey, npub)
 * and the login/logout actions. There is no JWT and nothing to refresh —
 * every API request is individually signed by the active signer.
 */
export function useAuth(): AuthState {
  return useLaWalletContext().auth
}
