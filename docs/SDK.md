# Client SDK + React Hooks

Two packages let anyone running a LaWallet instance offer its features from
their own webapp (usually their own domain or subdomain):

- **`@lawallet-nwc/sdk`** (`packages/sdk`) — typed, framework-free client for
  the REST API. Browser and Node. Only runtime dependency: `nostr-tools`.
- **`@lawallet-nwc/react`** (`packages/react`) — React provider + hooks built
  on the SDK.

Full documentation: [`apps/docs/content/docs/sdk/`](../apps/docs/content/docs/sdk/)
(published at `/docs/sdk`). A complete working app lives in
[`examples/onboarding`](../examples/onboarding).

---

## Authentication model

**Nostr events, not sessions.** Every authenticated request carries a
kind-27235 NIP-98 event signed by the user's key, committing to the URL,
method and body hash, valid ±60s. There is no login endpoint, no session
state and nothing to refresh — the signer _is_ the session.

Signers are structural (`getPublicKey()` + `signEvent()`), so `window.nostr`
(NIP-07), `@nostrify`, NDK and nostr-tools NIP-46 bunker signers all work.
The SDK ships `nsecSigner`, `browserSigner` and `generateSigner`.

`POST /api/jwt` (the first-party web app's session mechanism) is deliberately
**not** CORS-exposed — see `apps/web/middleware.ts`. SSE authenticates with a
signed NIP-98 event in the `token` query parameter, since `EventSource`
cannot send headers.

---

## SDK surface

| Namespace       | Covers                                                                      |
| --------------- | --------------------------------------------------------------------------- |
| `settings`      | Public instance settings — branding, domain, feature flags                  |
| `users`         | `me()` — fetch (and implicitly create) the current user                     |
| `addresses`     | List / get / create / update / remove / set-primary, invoices, availability |
| `registration`  | Invoice mint, LUD-21 verify, preimage claim, `claimAddress()` orchestration |
| `remoteWallets` | NWC CRUD, server-minted LNCurl wallets, connection string, balance          |
| `lud16`         | Public LUD-16 resolve / invoice request / LUD-21 verify                     |
| `nip05`         | `/.well-known/nostr.json` lookups                                           |
| `events`        | SSE change notifications                                                    |

Errors throw `LaWalletError` with `status`, `code` and `details`.

---

## React hooks

| Hook                      | Purpose                                                             |
| ------------------------- | ------------------------------------------------------------------- |
| `useLaWallet`             | The configured client + endpoint                                    |
| `useInstanceInfo`         | Public instance settings (auto-fetched by the provider)             |
| `useAuth`                 | Login (extension / nsec / generated key / any signer), logout, npub |
| `useUser`                 | Current user — first authenticated fetch creates the account        |
| `useAddresses`            | List + create (rethrows 402 for paid registration)                  |
| `useAddress`              | One address + routing mutations (alias redirect, NWC binding)       |
| `useUsernameAvailability` | Debounced public availability check                                 |
| `useClaimAddress`         | Full claim state machine incl. paid path (QR, WebLN, resume)        |
| `useAddressInvoices`      | Received payments, SSE-refreshed                                    |
| `useRemoteWallets`        | NWC connections + lifecycle                                         |
| `useResource`             | The caching primitive (dedupe, invalidate, SSE refresh)             |
| `useSSEConnected`         | Live-connection indicator                                           |

`<LaWalletProvider endpoint="https://wallet.example.com">` is the only setup:
it fetches instance settings, restores remembered logins and owns a single
SSE subscription. Caching is a ~90-line internal store — no SWR/React Query.

---

## Status

Both packages are `private: true` but publish-shaped (dist exports, `files`,
`sideEffects: false`); flipping `private` is the remaining npm-publish step.
Versioned independently of the app release train (`scripts/release.mjs`).

Not yet covered (future work): webhook/notification hooks, NIP-57 zap
helpers, card administration, and a built-in NIP-46 bunker signer (external
ones already work).
