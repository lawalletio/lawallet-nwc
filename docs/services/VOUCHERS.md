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
