/**
 * Stable local-development admin identity.
 *
 * The user id is kept separate from the Nostr public key on purpose: ids are
 * opaque database identifiers, while NIP-05 must expose a valid 32-byte hex
 * public key. Keeping these values shared prevents the seed, dev login, and
 * browser fixtures from drifting apart.
 */
export const DEV_ADMIN_USER_ID =
  'npub1xyz123abc456def789ghi012jkl345mno678pqr901stu234vwx567yz890'

export const DEV_ADMIN_PUBKEY =
  '1b84c5567b126440995d3ed5aaba0565d71e1834604819ff9c17f5e9d5dd078f'
