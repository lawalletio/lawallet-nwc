# Progress Report — Month 6

**Project:** LaWallet NWC
**Period:** June 29 – July 10, 2026
**Grant:** [OpenSats — Fifteenth Wave of Bitcoin Grants](https://opensats.org/blog/fifteenth-wave-of-bitcoin-grants)

---

## Summary

This report covers all work completed since the [Month 5 report](MONTH-5.md), which closed at the `v1.0.10` release on June 29, 2026.

Month 6 built out the **settlement transport and self-hosting tier**. The headline is the **NWC Payment Listener** — promoted from an echo stub into a live, long-running service — alongside the end-user card-activation flow, one-click deploy targets (Umbrel / Start9 / Docker Hub), and a full **Backup & Restore** system. This work shipped across six releases, `v1.1.0` → `v1.4.0`.

Highlights:

- **NWC Payment Listener (transport-only)** — `apps/listener/` became a live service holding one `NWCClient` per active NWC `RemoteWallet`, forwarding NIP-47 notifications to the web app as HMAC-signed webhooks, with relay-pool reconciliation over Postgres `LISTEN`/`NOTIFY` ([#71](https://github.com/lawalletio/lawallet-nwc/pull/71)), settings-driven config + an NWC Services settings tab ([#72](https://github.com/lawalletio/lawallet-nwc/pull/72)), and hybrid missed-event recovery ([#73](https://github.com/lawalletio/lawallet-nwc/pull/73)).
- **Listener resilience** — a `/status` endpoint that never 500s + keep-alive guards + dead-LNCurl auto-archival ([#80](https://github.com/lawalletio/lawallet-nwc/pull/80)), and **never-drop payment webhooks** via indefinite backoff retry + backlog logging ([#84](https://github.com/lawalletio/lawallet-nwc/pull/84)).
- **Listener dashboard** — realtime status, live-count badge, activity sort + pagination ([#81](https://github.com/lawalletio/lawallet-nwc/pull/81)), flicker-free realtime feed ([#82](https://github.com/lawalletio/lawallet-nwc/pull/82)), and a clickable event detail modal ([#86](https://github.com/lawalletio/lawallet-nwc/pull/86)).
- **Card activation flow (SIMPLE + ONE_TIME)** — the end-user `/wallet/activate/[id]` claim UI, mint / rescue endpoints, and a Connect-Card activation-lifecycle E2E ([#64](https://github.com/lawalletio/lawallet-nwc/pull/64)).
- **Deploy targets** — a Start9 / StartOS package + published `.s9pk` ([#69](https://github.com/lawalletio/lawallet-nwc/pull/69), [#70](https://github.com/lawalletio/lawallet-nwc/pull/70)), listener image publish + hub compose wiring ([#75](https://github.com/lawalletio/lawallet-nwc/pull/75)), on top of the multi-arch Docker Hub + Umbrel flow.
- **Backup & Restore** — Settings ▸ Backup & Restore: an `fflate` zip export/import of 14 models with optional AES-256-GCM encryption and analyze / merge / replace import modes, ADMIN-only ([#85](https://github.com/lawalletio/lawallet-nwc/pull/85)).
- **Platform polish** completing the Month 5 theme — PWA installable wallet with an offline service worker ([#62](https://github.com/lawalletio/lawallet-nwc/pull/62)), NIP-05 relays + CORS on `.well-known/nostr.json` ([#63](https://github.com/lawalletio/lawallet-nwc/pull/63)), per-user relay picker ([#68](https://github.com/lawalletio/lawallet-nwc/pull/68)), server-side Nostr profile cache ([#60](https://github.com/lawalletio/lawallet-nwc/pull/60)).
- **Admin & wallet** — admins can grant the ADMIN role ([#79](https://github.com/lawalletio/lawallet-nwc/pull/79)), read-only view of any Lightning address ([#83](https://github.com/lawalletio/lawallet-nwc/pull/83)), a sat symbol component ([#94](https://github.com/lawalletio/lawallet-nwc/pull/94)), primary wallet follows primary address ([#95](https://github.com/lawalletio/lawallet-nwc/pull/95)), expanded wallet settings + payment flows ([#96](https://github.com/lawalletio/lawallet-nwc/pull/96)), and optional listener-accelerated card payments ([#97](https://github.com/lawalletio/lawallet-nwc/pull/97)).
- **Docs** — a listener HTTP API reference + webhook contract in the public docs ([#78](https://github.com/lawalletio/lawallet-nwc/pull/78)).

**Main repository stats (`lawallet-nwc`):** 308 files changed, **28,713 insertions**, 3,172 deletions across the `v1.0.10` → `v1.4.0` window — **37 merged PRs** ([#60](https://github.com/lawalletio/lawallet-nwc/pull/60) – [#97](https://github.com/lawalletio/lawallet-nwc/pull/97)).

---

## Releases

| Tag | Date | Notes |
|-----|------|-------|
| [`v1.1.0`](../changelogs/v1.1.0.md) | 2026-07-06 | NWC Payment Listener service goes live (pool + webhooks + dashboard); missed-event recovery; Start9 package; PWA wallet; NIP-05 relays; relay picker; profile cache. |
| [`v1.1.1`](../changelogs/v1.1.1.md) | 2026-07-06 | Listener migration-ordering fix (wait for web migrations before querying `RemoteWallet`). |
| [`v1.2.0`](../changelogs/v1.2.0.md) | 2026-07-06 | Listener dashboard UX; admins can grant ADMIN; `/status` hardening + dead-LNCurl archival; listener API docs. |
| [`v1.2.1`](../changelogs/v1.2.1.md) | 2026-07-07 | Never-drop payment webhooks; realtime listener status; read-only address view. |
| [`v1.3.0`](../changelogs/v1.3.0.md) | 2026-07-07 | Backup & Restore with export/import wizard; listener event detail modal. |
| [`v1.4.0`](../changelogs/v1.4.0.md) | 2026-07-10 | Expanded wallet settings + payment flows; primary wallet follows primary address; sat symbol component. |

---

## Deferred to Month 7

The settlement / share / compliance layer was carried forward into [Month 7](../roadmap/MONTH-7.md):

- **MASTER card account-share** — FOREVER QRs + the `CardClaim` / `LightningAddressShare` / `RemoteWalletShare` model + share-revoke endpoints (enum values reserved in the schema)
- **NWC Proxy Lite** settlement layer + full **LUD-16 / LUD-21 / LUD-22 / NIP-57** closeout (webhook *transport* already ships via the listener)
- **`@lawallet-nwc/react`** hooks package extraction, the **WordPress plugin**, the **Resend** email adapter, the **Nostr scheduler**, threat model + security-audit prep, and Vercel / Netlify deploy configs

See the [Month 6 roadmap](../roadmap/MONTH-6.md) for the full design of record.
