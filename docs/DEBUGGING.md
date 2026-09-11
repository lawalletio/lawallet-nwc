# Debugging Runbook

Practical recipes for diagnosing runtime issues in `apps/web`.

## Verbose logging

```bash
LOG_LEVEL=debug LOG_PRETTY=true pnpm dev:web
```

All server logs are structured Pino JSON (`apps/web/lib/logger.ts`). At
`debug`, every Prisma query and timing span is visible; at the default
`info`, only request start/end and warnings appear.

## Follow one request end-to-end

Every request gets a `reqId` (AsyncLocalStorage correlation), echoed back on
the **`x-request-id` response header**. Grab it from the failing response,
then filter the server logs:

```bash
pnpm dev:web 2>&1 | node scripts/logs.mjs --reqId=<id>
node scripts/logs.mjs --reqId=<id> < server.log        # from a saved log
```

Other useful filters:

```bash
node scripts/logs.mjs --module=prisma --minMs=100      # slow queries only
node scripts/logs.mjs --span=nwc.pay_invoice           # NWC payment spans
node scripts/logs.mjs --level=warn                     # warnings and up
```

## Timing spans

Multi-hop flows are instrumented with `withSpan()`
(`apps/web/lib/observability/timing.ts`) — currently the NWC driver ops
(`nwc.get_balance`, `nwc.pay_invoice`, `nwc.make_invoice`). Spans log
`{ reqId, span, durationMs, ok }` at debug (warn on failure), so one `reqId`
shows where the time went. Wrap new hot paths the same way.

## Slow queries

Prisma queries slower than `SLOW_QUERY_THRESHOLD_MS` (default 100) log at
**warn** with the SQL and duration — visible even at the default log level.
Set `0` to disable, or lower it while hunting a regression.

## Auth failure decode table

| Symptom                      | Cause / fix                                                                                                                                                                                                           |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 401 "Invalid or expired JWT" | Issuer/audience/secret mismatch. Tokens must be issuer `lawallet-nwc`, audience `lawallet-users`, signed with the running server's `JWT_SECRET`. Note: each worktree has its **own** secret in `apps/web/.env.local`. |
| 401 on NIP-98                | Check event `created_at` clock skew, exact URL match (scheme/host/port), uppercase method, payload hash.                                                                                                              |
| 403 `AUTHORIZATION_ERROR`    | Authenticated but missing the permission — check `lib/auth/permissions.ts` mapping and the user's role in the DB (or the role claim in the JWT).                                                                      |
| 503 from `/api/health`       | The server is up but can't reach the database — see below.                                                                                                                                                            |

## NWC vault credentials

Every NWC credential at rest (`RemoteWallet.config.connectionString`, the proxy
NWC URI, the NIP-57 receipt nsec) is the same `lwrw1:` AES-256-GCM envelope
under `NWC_VAULT_SECRET`. A startup pass reports anything the active secret
cannot open, so the first place to look is the boot log.

| Log message                                          | Meaning / fix                                                                                                                                                                            |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `remote_wallet_nwc_encryption.unreadable_rows`       | Those `walletIds` were sealed under a different `NWC_VAULT_SECRET`. Restore the original secret, or have the owner reconnect the wallet. Only those wallets fail (503 on payment paths). |
| `proxy.nwc_vault.nwc_unreadable`                     | The proxy NWC URI cannot be opened, so deferred forwarding cannot pay out. Re-enter it in Admin → Settings → NWC Services.                                                               |
| `proxy.nwc_vault.converted_to_lwrw1`                 | Informational — a legacy `LWPX01` proxy blob was re-sealed in canonical form.                                                                                                            |
| `proxy.receipt_signer.replaced_unreadable`           | The receipt signer was unrecoverable and has been replaced; `previousReceiptPubkey` → `receiptPubkey` records the change. Zaps work again from this boot on.                             |
| `proxy.nwc_vault.receipt_signer_unreadable_unproven` | The signer cannot be opened **and** no other NWC credential proves the active secret, so it was left untouched. Check `NWC_VAULT_SECRET` is the right one, then restart.                 |
| `nip57.receipt_signer_unavailable`                   | Served at request time whenever the signer cannot be decrypted — LUD-16 then omits `allowsNostr`/`nostrPubkey` for every address. Pair it with the startup lines above.                  |

`NWC_VAULT_SECRET` has no previous-key fallback, so a rotated or lost secret is
not recoverable from the database alone.

## Card tap payments

The BoltCard spend path (`app/api/cards/[id]/scan/cb/actions/pay.ts`) validates
the bolt11 invoice **before** consuming the SUN counter, so a rejected invoice
never burns a tap. That also means a parse-level rejection leaves **no**
`CardPaymentAttempt` row — an empty attempt history for a card that visibly
fails is the signature of a failure _upstream_ of the claim, not a wallet or
NWC problem.

| Symptom                                            | Cause / fix                                                                                                                                                                                                                                                                                       |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Lightning invoice has expired` on every tap       | Check the decoded expiry first. `light-bolt11-decoder` returns `expiry` as the BOLT-11 `x` tag's **duration in seconds**, not an absolute timestamp — it must be added to the invoice `timestamp`. Treating it as absolute puts every expiry in 1970 and rejects all invoices that carry the tag. |
| `Card is not configured for payments`              | The card has no `remoteWallet` and the owner's primary lightning address has none either — check `resolveCardWallet`.                                                                                                                                                                             |
| `Card wallet is not enabled for outgoing payments` | The routed NWC wallet's `config.mode` is `RECEIVE`; card spends need `SEND_RECEIVE`.                                                                                                                                                                                                              |
| `Payment outcome is still being resolved`          | Ambiguous listener/driver result, persisted as `UNKNOWN`. This is deliberate — it is reconciled in the background, never blindly retried.                                                                                                                                                         |

Inspect a specific card's routing and attempt history directly:

```sql
SELECT counter, status, "errorCode", "amountMsats", transport, "createdAt"
FROM "CardPaymentAttempt" WHERE "cardId" = '<card-id>' ORDER BY "createdAt" DESC;
```

Note the admin UI's card identifier is the **card ID**, not the NTAG UID
(`ntag424Cid`) — they are different columns and easy to confuse when querying.

## Database issues

- **"Can't reach database" / health 503** — wrong `DATABASE_URL` for this
  checkout. Each worktree runs its own Postgres container
  (`lawallet-nwc-<hash>-postgres-1` in `docker ps`); `pnpm dev:env` prints
  this checkout's connection details.
- **Migration drift / broken local schema** — `pnpm dev:db:reset`
  (destructive, current checkout's DB only).
- **Env validation crash at boot** — Zod errors from
  `apps/web/lib/config/env.ts` name the exact variable; fix it in
  `apps/web/.env.local` (see `.env.example` for the full list).

## Ports

The dev server port is **per worktree** (printed by `pnpm start:dev-server`);
`:3000` is only the main checkout's default. E2E runs use `:3100` and a
dedicated `*_e2e` database — they never collide with dev.

## Minimal repro checklist

1. Reproduce with `LOG_LEVEL=debug LOG_PRETTY=true`.
2. Capture the `x-request-id` and filter with `scripts/logs.mjs`.
3. Identify the failing layer: auth → validation → handler → Prisma → driver.
4. Check the matching integration test in `apps/web/tests/integration/api/`
   — it encodes the intended behavior.
5. A 500 response means an **untyped** error escaped `withErrorHandling` —
   the stack trace in the logs points at the gap.
