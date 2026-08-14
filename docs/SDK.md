# Client SDK + React Hooks

The SDK now lives in its own repository: **[lawalletio/sdk](https://github.com/lawalletio/sdk)**,
published to npm as **`@lawallet/sdk`**.

```bash
npm install @lawallet/sdk
```

One package, two entry points: `@lawallet/sdk` (typed, framework-free client —
browser and Node, only runtime dependency `nostr-tools`) and
`@lawallet/sdk/react` (provider + hooks). React is an optional peer dependency,
so a Node backend importing the core never pulls it in.

Consumer documentation lives at [`/docs/sdk`](../apps/docs/content/docs/sdk/),
including a [full usage example](../apps/docs/content/docs/sdk/usage-example.mdx).
The runnable apps and the agent skills are in the SDK repo.

**This repo still contains `packages/sdk` and `packages/react`** — the
pre-split originals, now duplicated by the published package. They are pending
removal; new work belongs in lawalletio/sdk.

The notes below describe the surface this instance exposes to that SDK, which
is what matters when changing the API here.

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

Proof of key control ships as `signChallengeEvent` / `verifyChallengeEvent` —
the kind-22242 (NIP-42) format LaWallet uses internally, so an operator
backend can verify that a visitor holds the npub it is about to provision for.

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

Published from [lawalletio/sdk](https://github.com/lawalletio/sdk) as
`@lawallet/sdk@1.0.0`, versioned independently of this app's release train.
Requires an instance running **v2.6.0 or newer** — that release added the
cross-origin layer, the NIP-98 SSE token and the operator provisioning
endpoint the SDK depends on.

Two reference apps consume it end to end:
[`example-onboarding`](../examples/onboarding) (self-service claim, incl. the
paid path) and [`example-admin-provisioning`](../examples/admin-provisioning)
(operator-issued addresses with proof-of-npub). Both finish in a manager where
the owner sets an alias or binds their own NWC wallet.

Not yet covered (future work): webhook/notification hooks, NIP-57 zap
helpers, card administration, and a built-in NIP-46 bunker signer (external
ones already work).
