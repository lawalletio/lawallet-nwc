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
pnpm --filter lawallet-example-admin-provisioning dev
```

No configuration needed. The endpoint resolves on its own (this monorepo's dev
instance, else the public one), and **the admin key provisions itself**:

1. No `LAWALLET_ADMIN_NSEC`? One is generated and written to `.env`, so it
   stays stable across restarts.
2. The account is materialised on the instance — you can't grant a role to a
   user row that doesn't exist yet.
3. On an instance with **no owner**, the key claims root and becomes ADMIN, so
   a fresh install works with nothing to set up.
4. Otherwise the backend prints exactly how to grant it:

```
[admin-provisioning] npub1ymv5rg7… is not an admin on this instance yet.
[admin-provisioning] Grant it from the instance (Admin → Users), or directly:
[admin-provisioning]   UPDATE "User" SET role='ADMIN' WHERE pubkey='26d941a3…';
[admin-provisioning] The role is read per request, so no restart is needed.
```

Once it can provision, boot reports:

```
[admin-provisioning] http://localhost:3052 · auth nip98 · admin npub1ymv5rg7… · credential ok
```

To use a key you already have, put it in `.env` (see `.env.example`) and it is
left alone.

## Both admin auth methods

`LAWALLET_ADMIN_AUTH` switches how the backend authenticates:

| mode              | how                                                | notes                                                                                                                  |
| ----------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `nip98` (default) | every request is signed with the admin key         | works on every endpoint, including the few that only accept NIP-98                                                     |
| `jwt`             | one session token minted at boot, sent as `Bearer` | `/api/jwt` is rate limited to 10/min per IP, so the token is cached and re-minted only near expiry — never per request |

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
