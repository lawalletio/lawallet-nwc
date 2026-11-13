# Third-party integrations (Admin → Integrations)

Admins switch on third-party services from **Admin → Integrations**
(`/admin/integrations`, `integrations:manage`, ADMIN-only). Each integration is
a set of flat `Settings` keys; API keys are write-only and sealed with
`NWC_VAULT_SECRET` when it is set.

Code: `apps/web/lib/integrations/` (`catalog.ts` is the registry, one client
module per provider). Adding one = a catalog entry + a client module.

| Integration  | Kind     | Settings keys                                | What users get                     |
| ------------ | -------- | -------------------------------------------- | ---------------------------------- |
| Bull Bitcoin | cash-out | `bullbitcoin_enabled`, `bullbitcoin_api_key` | Lightning → ARS to a CBU/CVU       |
| Wapu         | cash-out | `wapu_enabled`, `wapu_api_key`               | Lightning → ARS to a CBU/CVU/alias |
| Gorilla API  | lookup   | `alias_enabled`, `alias_api_url`             | Alias/CBU → owner name + bank      |

Clients (webapp, Android) read `integration_bullbitcoin`, `integration_wapu`
and `integration_alias` (`'true'` when enabled **and** configured) from the
public `GET /api/settings`.

## Cash-out flow (Bull Bitcoin, Wapu)

Users get two front-ends: **Dashboard → Swaps** (`/admin/swaps`, every
user, listed only while a cash-out provider is enabled) — a step wizard
(alias → amount → review with the pay-from wallet picker → live progress),
a live status tracker with the bank receipt, and a paginated history; and the
mobile wallet's **Cash out** screen (`/wallet/cash-out`).

Orders are placed with the **community's** provider account; the user pays the
provider's invoice from their **own** wallet.

1. `GET /api/wallet/swaps/quote?amountArs=` — sats per available provider.
2. `POST /api/wallet/swaps` `{provider, amountArs, destination, holderName?}`
   → `{id, bolt11, amountSats, …}`. The invoice must be within 3% of the
   quote or the order is refused.
3. The client pays `bolt11` over NWC after showing `amountSats`.
4. `POST /api/wallet/swaps/{id}/paid` `{preimage}` — proof of payment
   (`sha256(preimage)` = invoice hash); sets `paidAt` so tracking can tell
   "awaiting payment" from "transfer in progress".
5. Poll `GET /api/wallet/swaps/{id}` until `status` is `COMPLETED`,
   `FAILED`, `EXPIRED` or `CANCELED` (refreshed from the provider at most
   every 10s), or listen for the `swaps:updated` SSE event.

**Status cron.** In-flight swaps are also refreshed without anyone watching:
the NWC listener HMAC-signs `POST /api/internal/swaps/reconcile` every
`SWAP_RECONCILE_INTERVAL_MS` (default 1 min) while web reports a swap in
flight, backing off to `SWAP_RECONCILE_MAX_INTERVAL_MS` (default 5 min) while
none is. Each pass asks the provider, records payment it saw, expires lapsed
unpaid orders and pushes `swaps:updated`. Without a listener there is no cron;
status then moves only while a client is watching.

Full request/response shapes: `/api/openapi.json`, tag **Cash-out**.

### Bull Bitcoin

- **Auth:** an API key. Mint it once while logged in at
  app.bullbitcoin.com — copy the `bb_session` cookie, then:

  ```bash
  curl -X POST https://accounts.bullbitcoin.com/api/generate-api-key \
    -H "cookie: bb_session=<value>" -H 'content-type: application/json' \
    -d '{"apiKeyName":"lawallet"}'
  ```

  Paste `apiKey.key` into the admin card and press **Test connection**.

- Pays only to 22-digit CBU/CVU. An alias works when the Gorilla API
  integration is on (it is resolved to the CVU first).
- Each new CBU is saved as a recipient in the community's account.

### Wapu

- **Auth:** an API key from Wapu.
- Minimum ARS 10,000.
- **Wapu blocks datacenter IPs** (CloudFront firewall) until it allowlists the
  server — **Test connection** reports it.
- Wapu doesn't link the Lightning deposit to the bank transfer; status is
  matched by amount (±0.1%) and creation time, skipping transfers already
  claimed by another swap.

## Gorilla API (alias lookup)

`GET /api/wallet/alias/{query}` (authenticated) proxies
`GET {alias_api_url}/v1/alias/{query}` from
[gorilla-api](https://github.com/agustinkassis/gorilla-api), default
`https://api.masize.com`. Deploying gorilla-api (Upstash Redis, `PUBLIC_URL`,
Fiwind session import) happens outside this repo.

## Known limits

- Gorilla API allows 30 requests/min per IP, and every request from this
  instance shares one IP.
- No provider webhooks: status comes from the listener cron (above) or a
  watching client. Without a listener, an unpaid order stays `PENDING` until
  someone opens it.
- Sell only (Lightning → ARS). Buying and onchain are not implemented.
