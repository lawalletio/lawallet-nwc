# Vouchers

Vouchers are coupons issued by an external merchant and held on a member's
behalf in `lawallet-web`. They implement the _holder_ half of the
[lacrypta/coupons](https://github.com/lacrypta/coupons) protocol: this
instance stores and displays coupons, it never mints or burns them.

Integrator-facing guide: `apps/docs/content/docs/integrations/vouchers.mdx`.

## Protocol mapping

| Coupons protocol                                             | Here                                                                                                           |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| kind **30078** merchant announcement (`mintUrl`, `claimUrl`) | Not fetched. The depositing service passes the URLs directly, stored on `Voucher.claimUrl` / `Voucher.mintUrl` |
| kind **20402** CMS-signed voucher                            | Verified on deposit, stored verbatim in `Voucher.voucherEvent`                                                 |
| `nonce` (22-char base64url)                                  | `Voucher.nonce` — the bearer credential                                                                        |
| `Benefit` union                                              | `Voucher.metadata.coupon`, opaque JSON                                                                         |
| `GET {claimUrl}?nonce=`                                      | The status refresh                                                                                             |
| `POST {claimUrl}`                                            | **Not called.** Redemption happens at the merchant's POS                                                       |

Skipping relay discovery is deliberate: it keeps the deposit a single HTTP
call with no relay round-trip, and the announcement's only payload — the two
URLs — is exactly what the deposit already carries. Adding discovery later
means one lookup keyed on `merchantPubkey`, with the stored URLs as fallback.

## Data model

`Voucher` in `apps/web/prisma/schema.prisma`, unique on
`(servicePubkey, nonce)` — a nonce is unique per issuing service, not
globally, because two independent services can mint the same 16 random bytes.

Two columns on `User` control who may deposit: `voucherDepositPolicy`
(`ANYONE` | `ALLOWLIST`) and `voucherSenderAllowlist` (hex pubkeys).

## Deposit (`POST /api/vouchers`)

Public in the sense that the caller needs no account here, not in the sense
that it is unauthenticated. `app/api/vouchers/route.ts`:

1. Body-size cap (`checkRequestLimits`) and rate limit (bucket
   `vouchers-deposit`).
2. `authenticate()` — NIP-98 or Bearer. `resolveRole` falls back to `USER`
   for an unknown pubkey, so a coupon-manager service does not need to be
   registered.
3. Recipient resolved via `resolveAccountByPubkey`, so a linked _secondary_
   identity still delivers to the right account.
4. Policy gate. **An unknown recipient and a disallowed sender return the
   same 403 with the same message.** Splitting them would turn the endpoint
   into an npub-existence oracle for the whole community.
5. `voucherEvent` verified when present (`lib/vouchers/event.ts`); its
   values override the plain body fields.
6. `upsert` on `(servicePubkey, nonce)` — 201 on insert, 200 on refresh. The
   protocol is explicit that retries must not look like failures.
7. `eventBus.emit({ type: 'vouchers:updated' })` so an open stash updates
   without a reload. This is the _only_ path that makes a new voucher
   appear, since the deposit originates outside the browser.

### Untrusted URLs

Three fields on a deposit are third-party URLs, and each has a different sink:

| Field                  | Sink                | Guard                                                                          |
| ---------------------- | ------------------- | ------------------------------------------------------------------------------ |
| `claimUrl` / `mintUrl` | Server-side `fetch` | `assertServiceUrl` on input, plus DNS-pinned SSRF checks on every poll         |
| `image`                | `<img src>`         | `imageUrlSchema` — http(s) only                                                |
| `url`                  | `<a href>`          | `externalUrlSchema` — http(s) only, plus `rel="noopener noreferrer"` at render |

The image and link guards share one predicate (`isHttpUrl` in
`packages/shared/src/schemas.ts`) so they cannot drift. The link is the
sharper of the two: `javascript:` is inert in an `<img src>` but executes
from an `<a href>` on click.

## Status refresh (`POST /api/wallet/vouchers/{id}/refresh`)

`lib/vouchers/status.ts` polls the service's claim preview. The URL comes
from a third party stored in our database, which makes it an SSRF sink, so
it reuses the same resolve-check-pin machinery as outbound notification
webhooks (`createPinnedLookup` / `isPrivateNetworkAddress` from
`lib/proxy/lnurl.ts`) rather than a bare `fetch`. Loopback is allowed only
outside production, where the reference service runs on the same machine.

**Status is monotonic** (`lib/vouchers/transition.ts`): `CLAIMED` and
`VOIDED` absorb. A service reporting `minted` after `claimed` is far more
likely a rollback, a nonce collision, or a spoofed response than a coupon
becoming spendable again — so the worst a bad answer can do is show a
stale-but-safe "Redeemed". `EXPIRED` is _not_ terminal: a coupon claimed
moments before expiry can be reported late.

Two short-circuits skip the network entirely: a terminal status, and a check
within the 30-second cooldown. The cooldown is about not hammering somebody
else's service; the rate limiter is what protects this instance.

## UI

`/admin/vouchers` and `/admin/vouchers/[id]`, with no `permission` on the
sidebar entry — the data is per-user, the same arrangement as Addresses and
Remote Wallets, so a plain `USER` sees their own stash.

The nonce is hidden behind a "Show code" toggle while the coupon is live, and
not rendered at all once it is spent.

Merchant and service npubs render with real names and avatars because
`resolveProfiles` (`lib/nostr/profile-cache.ts`) treats a pubkey stored on a
`Voucher` row as resolvable. That widening preserves the endpoint's
anti-relay-proxy property: a caller still cannot ask for an arbitrary pubkey,
only one this instance already stores.

## Transfer

Vouchers move by **burn-and-remint**. The recipient calls the coupon service's
`POST {refreshUrl}`, which kills the sender's nonce and mints a replacement
with the same benefit snapshot and the same expiry. Because the nonce _is_ the
credential, that swap is the change of ownership — there is no holder field to
reassign, and there is no account system involved. Spec:
[refresh](https://github.com/lacrypta/coupons/pull/2).

### Discovery and transport

A recipient's LUD-16 payRequest emits `allowVouchers: true` when
`User.allowVouchers` is on — **off by default**, because a transfer is an
anonymous write into someone's stash and that surface must not appear on every
existing address the day it ships.

The sender POSTs to the recipient's ordinary LNURL `callback`.
`app/api/lud16/[username]/cb/route.ts` is a dispatcher: `GET` is LNURL-pay
(extracted unchanged into `cb/actions/pay.ts`), `POST` routes on the body's
`action` to one file per action. Same layout as `app/api/cards/[id]/scan/cb/`.

### Why the receiver never dials a URL from the request

`resolveTransferService` (`lib/vouchers/transfer.ts`) pins the coupon service
by pubkey and reuses the origin from a row we already store.

A 20402 signature proves **integrity, not authenticity**. Anyone can generate
a keypair, sign a flawless voucher for "$500 off at RealShop", and host a
service that reports it valid forever. Every signature check passes, the
victim's stash shows the merchant's real name and avatar — the profile cache
resolves any pubkey stored on a `Voucher` row — and the fraud surfaces at the
till. Pinning closes that, and closes SSRF-via-transfer at the same time.

The cost is deliberate: a coupon from a service this instance has never seen
cannot arrive by transfer. Deposit it over the NIP-98 endpoint first, which
has an authenticated signer to hold responsible.

### Ordering, and the one step that cannot be undone

The CMS swap is irreversible; everything else is bookkeeping. So:

1. Rate limit (by **recipient** — an attacker rotates IPs, not victims), body
   size, schema, recipient policy, service pinning. No unauthenticated request
   reaches the network before all of these pass, or the endpoint is a free
   HTTP proxy.
2. **Write the intent row, then swap.** A failed insert means we never call
   refresh, so a database outage costs nobody their coupon.
3. Store the replacement, then answer `ACCEPTED`.

`VoucherTransfer` is unique on `(servicePubkey, oldNonce)`, so a retried
delivery replays the stored answer without touching the service, and a row
left without `newNonce` is a completed burn that can be replayed — refresh is
idempotent on its `Idempotency-Key`.

The sender claims the send with a conditional `MINTED → TRANSFER_PENDING`
update so an honest double-send cannot start, and **re-reads the service on
any refusal**: a recipient can swap the nonce and then answer `ERROR`, and the
service is the only authority on who holds the coupon now. The sender's row is
never deleted — it is the only record of where the coupon went.

### Untrusted input, by sink

| Field                  | Sink                   | Guard                                                             |
| ---------------------- | ---------------------- | ----------------------------------------------------------------- |
| `claimUrl` / `mintUrl` | Server-side `fetch`    | `assertServiceUrl` on input, DNS-pinned SSRF checks on every poll |
| `refreshUrl`           | Server-side `POST`     | Never read from a request; taken from our own stored row          |
| Recipient address      | Server-side `fetch` ×2 | Owner-supplied, DNS-pinned both hops (`lib/vouchers/deliver.ts`)  |
| `image`                | `<img src>`            | `imageUrlSchema` — http(s) only                                   |
| `url`                  | `<a href>`             | `externalUrlSchema` + `rel="noopener noreferrer"`                 |

### What cannot be made safe

- **A recipient can swap the nonce and then answer `ERROR`**, keeping the
  coupon while the sender believes the send failed. Structural: they must be
  able to swap before they can promise anything, and the mirror protocol is
  the mirror scam. Mitigated by re-reading the service, and by saying so in
  the send dialog.
- **No sender identity.** LUD-16 carries none, so `depositedBy` is empty on a
  transferred row and the UI shows no "from". Inventing one would render as
  provenance while being trivially forged.
- **`merchantPubkey` is unverified** without kind-30078 discovery, yet we
  render it with a cached avatar and profile name — an unverified identity
  that _looks_ verified. Live today, independent of transfer.
- **The service sees the whole transfer graph**, timestamped. Inherent to
  refresh-based transfer; only ecash fixes it.

## Future: ecash

This implementation is **custodial**. The nonce is a bearer credential
sitting in our database, so the instance operator can read every member's
coupon codes; a member cannot transfer a voucher or hold it offline; and the
issuing service's database — not ours — is the sole authority on whether a
coupon has been spent.

A future version of the coupons protocol should represent vouchers as
**ecash** (Cashu, NIP-60/61). The coupon becomes a blinded, bearer-redeemable
token, the merchant's service acts as the mint, double-spend protection moves
from a status lookup to the mint's spent-proof set, and the wallet holds real
bearer value the operator cannot read. That also removes the status-refresh
endpoint and its SSRF surface entirely.

This aligns with the existing roadmap entry — "Cashu eCash mint integration
(NIP-60/61)" in `docs/VISION.md`, deferred to Beyond-M8 in `docs/ROADMAP.md`.

Nothing in the coupons protocol mentions ecash today; this is a protocol
proposal, not a pending upstream feature. Until it exists, the nonce-in-a-row
model is what interoperates with the deployed protocol.

## Out of scope

- **In-app redeem.** The protocol claims _before_ the invoice, so the coupon
  burns even on an abandoned purchase. Belongs behind a POS flow.
- **Minting.** This instance is a holder, never a coupon-manager service.
- **Card integration.** Presenting a voucher by NFC tap is a later phase.
- **Cross-user admin view** of every voucher on the instance.
