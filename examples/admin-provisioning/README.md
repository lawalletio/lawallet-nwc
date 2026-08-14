# LaWallet admin-provisioning example

A webapp for instances that keep **Settings → Lightning Address → User
Registration** switched **off** — where users can't create their own address
and the operator hands out reserved names through their own process
(membership, vetting, an off-platform payment, a waiting list).

A visitor proves they hold a Nostr key; the operator's backend, holding an
**admin credential**, provisions `name@your-domain` for that npub — creating
the account on the instance if it has never seen that key.

## The flow

1. **Connect** — NIP-07 extension or a pasted nsec. A signer is required: the
   claim is settled by a signature, which is what stops anyone reserving a
   name against somebody else's key.
2. **Choose a name** — availability is checked straight from the browser
   against the instance's public endpoint.
3. **Prove & claim** — the backend issues a challenge bound to that pubkey,
   the visitor signs it (NIP-42 kind 22242), the backend verifies the proof
   and only then spends its admin credential to call
   `POST /api/lightning-addresses`.

## Run it

```bash
pnpm install && pnpm build
```

```bash
cd examples/admin-provisioning
cp .env.example .env      # set LAWALLET_ADMIN_NSEC
pnpm dev
```

The endpoint resolves with no configuration (this monorepo's dev instance,
else the public one). The **admin nsec is required** — without it the app runs
but refuses to provision, and says so.

At boot the backend logs which credential it will use and verifies it:

```
[admin-provisioning] http://localhost:3052 · auth nip98 · admin npub1abc123… · credential ok
```

## Both admin auth methods

`LAWALLET_ADMIN_AUTH` switches how the backend authenticates:

| mode | how | notes |
| --- | --- | --- |
| `nip98` (default) | every request is signed with the admin key | works on every endpoint, including the few that only accept NIP-98 |
| `jwt` | one session token minted at boot, sent as `Bearer` | `/api/jwt` is rate limited to 10/min per IP, so the token is cached and re-minted only near expiry — never per request |

Both are genuine admin credentials: the API re-resolves the role from the
database on every request instead of trusting a claim inside the token. The
success screen shows which one signed the call.

## Where the admin key is (and is not)

It is read in exactly one file, `server/admin-client.ts`, from
`LAWALLET_ADMIN_NSEC`. That variable has **no `VITE_` prefix**, and Vite only
inlines `VITE_*` variables into the browser bundle — so the key is
structurally incapable of reaching client code. The browser's own
`LaWalletClient` is built with no signer and no token, so it can only reach
public endpoints.

`/api/jwt` is deliberately not CORS-exposed, which is the same boundary
expressed at the API: minting a session belongs on a server, never in a page.

## Production hardening

This is a demo of the mechanism, not a finished product:

- **Gate `POST /api/challenge`.** Anyone holding any key can currently claim
  any free name. Put your actual criterion in front of it — an invite code, a
  paid order, an allowlist, a login.
- **Rate limit both endpoints.** The instance's limiter doesn't cover this app.
- **Challenges are replayable within their 300s TTL**, so one proof can claim
  a second name. Track used nonces if that matters.
- **Consider `lncurl_auto_create`.** With it on, provisioning a brand-new
  account may also mint a wallet for it, so the address arrives already
  routable (`CUSTOM_NWC`) rather than `IDLE`.
- Run the backend as a real server (the handler in `server/api.ts` is a plain
  `(req, res)` function — mount it in Express, Fastify or node:http unchanged).

## The API it uses

`POST /api/lightning-addresses` — requires the `addresses:write` permission
(ADMIN or OPERATOR), creates the target account on demand, and bypasses the
self-service registration policy. See `/docs/sdk/admin-provisioning`.
