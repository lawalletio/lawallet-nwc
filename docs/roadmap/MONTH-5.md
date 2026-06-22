# Month 5: Remote Wallets + Card System Apps + Platform Polish

**Period:** May 5 – June 5, 2026
**Status:** Planned
**Depends on:** [Month 4](MONTH-4.md)

## Summary

1. **Remote Wallet Providers (Connections Manager)** — Source abstraction with a `provider` field. We'll start with NWC as the initial provider in M5; support for LND, Core Lightning, BTCPayServer will be added in future work.
2. **Card System Apps & Flows** — (0) QR-based JWT login in `apps/web`, (1) `card-installer` Android (bulk-writes blank NTAG424 cards and registers them as *initialized*), (2) `card-manager` (prints an Activation QR for any initialized card), (3) end-user "Activate Card" flow in the wallet UI.
3. **Platform Polish** — full NIP-05, relay picker, user data cache, onboarding v2, dashboard cache, PWA wallet, bug fixes, landing CRM swap.

---

## Goals

### A. Remote Wallets (Connections Manager)

- `RemoteWallet` model with a `type` discriminator (NWC active in M5; LND / CLN / BTCPAY / others reserved)
- User UI to create / rename / set default / disable / revoke Remote Wallets
- Connection Map UI — visual map of Lightning addresses + Cards on one side, Remote Wallets on the other; desktop canvas + mobile tabbed lists; fully responsive
- Driver interface for additional types without call-site changes
- Existing `NWCConnection` rows migrate forward to `RemoteWallet` rows of `type = NWC`
- Every `LightningAddress` and `Card` references a `RemoteWallet` by id

### B. Card System Apps & Flows

0. QR-based JWT login in `apps/web` — shared login surface for both card-side apps
1. `card-installer` (Android) — bulk NTAG424 provisioning + JWT login; writes blank cards against a chosen design and registers each in the system as *initialized* (ready to activate); optional activation-QR generation at write time
2. `card-manager` — JWT login; takes any *initialized* card and prints an Activation QR for on-demand, individual activation; card rescue / re-issue, E2E coverage
3. End-user "Activate Card" flow in the wallet UI — scan QR; pick new or existing user; `ONE_TIME` QRs burn and transfer the card's ownership; `FOREVER` QRs (MASTER cards only) grant share access to the card holder's LAs + Remote Wallets without burning. Card kind (`SIMPLE` / `MASTER`) and QR kind (`ONE_TIME` / `FOREVER`) are independent — max one active QR of each kind per card.
4. Connect Card E2E: design → token → bulk-write/initialize → activation-QR → claim → pair → pay

### C. Platform Polish

- Full NIP-05 (`.well-known/nostr.json` + relays + avatar)
- User-level relay picker preference
- User data cache — backend storage for Nostr profile + relay-list metadata
- Onboarding v2 — autodetect Cloudflare/DNS state
- Dashboard cache pages — Next.js Cache Components, dedupe `getSettings`
- PWA Wallet (manifest, service worker, install prompt, offline)
- Customizable domain landing — white-label `lawallet-web` entry screen: isotype + large-logo branding, claim-address CTA, live `you@domain` preview, optional admin benefits step, then login → continue
- Admin home redesign — `username @ domain` animated hero, Lightning-address-first onboarding (NWC offered after), and Remote Wallet options shown up front when none is set
- Bug fixes — card-design dropdown stale state, redundant `getSettings`
- LaWallet landing — design additions: product screenshots, admin features, subscription UI/UX for domain owners, monthly-navigated roadmap, CRM swap

---

## A. Remote Wallets (Connections Manager)

### Model

```
RemoteWallet {
  id           cuid
  userId       cuid                 # owner
  name         string               # user-given label, unique per user
  type         enum                 # NWC | LND | CLN | BTCPAY | ... (only NWC active in M5)
  config       Json                 # type-specific config (encrypted at rest)
  status       enum                 # ACTIVE | DISABLED | REVOKED
  isDefault    boolean              # one default per user
  createdAt, updatedAt
}
```

- `config` for `type = NWC` holds the NIP-47 URI (relay, pubkey, secret); future types store their own auth payload (host + macaroon, rune, API key, etc.)
- `LightningAddress.remoteWalletId` and `Card.remoteWalletId` replace direct NWC references
- Existing `NWCConnection` rows migrate forward into `RemoteWallet` rows with `type = NWC`

### Driver interface

`RemoteWalletDriver` defines: `getInfo()`, `makeInvoice()`, `lookupInvoice()`, `subscribeToPayments()`. M5 implements the NWC driver. Adding a new type later is a new driver module + a `type` value — no call-site changes in `apps/web` or `apps/listener`.

### UI

- User wallet — Remote Wallets page: list / add / rename / mark default / disable / revoke
- Admin — Cards detail: pick which Remote Wallet a card draws from
- Add-flow shows only the NWC option; future types appear once their drivers land

### Connection Map UI (desktop + mobile)

Visual two-sided map: Lightning addresses + Cards as sources on the front, Remote Wallets on the back, edges representing active bindings.

**Node types:**

- `lightning-address` — `name@domain`
- `card` — `Card.id`, design name, NTAG424 serial fragment
- `remote-wallet` — Remote Wallet (NWC today)

**Edge types:**

- `la-binding` — `LightningAddress.remoteWalletId → RemoteWallet.id`
- `card-binding` — `Card.remoteWalletId → RemoteWallet.id`

Both edge types render with the same Bézier curve but tinted differently.

**Desktop layout (≥ 1024 px):**

- Two-column canvas. Left column split into Lightning addresses (top) and Cards (bottom) with a divider; right column is the Remote Wallets stack
- Edges drawn from each LA / Card on the left to its bound Remote Wallet on the right
- Hover a node → highlight its edges; hover an edge → highlight both endpoints
- Drag to rebind — grab an edge endpoint, drop it on a different Remote Wallet; commits via `PATCH /api/lightning-addresses/[id]` or `PATCH /api/cards/[id]` with the new `remoteWalletId`
- Click a node → inline panel: rename / default / disable / revoke for wallets; rename / delete for LAs; rename / unpair / disable for Cards
- Each left-side group has a "+ Add" node; right side has "+ Add Remote Wallet"
- Renders with **react-flow** (or equivalent); nodes typed (`lightning-address` / `card` / `remote-wallet`), edges typed (`la-binding` / `card-binding`)

**Mobile layout (< 1024 px):**

- Three top-level tabs: **Addresses** · **Cards** · **Wallets**
  - Addresses tab — list of LAs; each row shows its bound Remote Wallet as a chip; tap chip → bottom-sheet picker to rebind
  - Cards tab — list of Cards; each row shows design + bound Remote Wallet chip; tap chip → bottom-sheet picker to rebind
  - Wallets tab — list of Remote Wallets; each row expands to show every LA and Card bound to it (read-only summary; rebinds happen from Addresses or Cards tabs)
- Tap a row's main content → drawer with rename / delete / disable actions

**Responsive behavior:**

- Single component tree; layout chosen by breakpoint at the page level
- Tablet (768–1023 px) uses the mobile tabbed layout
- All actions available in both layouts
- Keyboard navigable on desktop (Tab through nodes, Enter for inline panel, drag has an equivalent "Rebind to…" submenu)

---

## B. Card System Apps & Flows

### B.0 QR-based JWT Login

Shared login surface for `card-installer` and `card-manager`. The admin mints a JWT in the lawallet-nwc dashboard and shows it as a QR; the third-party app scans it. Stateless — the JWT is self-contained, no server-side session record, no revocation.

**Flow:**

1. Operator opens **Settings → Device Tokens → Generate** in the admin
2. Form: pick **user**, tick **permissions** (RBAC subset), pick **expiration** (preset list: 1h · 8h · 24h · 7d · custom)
3. Admin calls `POST /api/auth/qr-jwt/generate` → backend signs a JWT with `{ sub: userId, scopes, exp }` and returns `{ jwt }`
4. Admin UI renders the JWT inside a **QR code** on screen
5. `card-installer` / `card-manager` scans the QR → JWT lands in the app → it makes authenticated requests

**Backend route (new in `apps/web`):**

- `POST /api/auth/qr-jwt/generate` — admin only; body `{ userId, permissions: string[], expiresIn: string }` → returns `{ jwt }`
- No `poll`, no `approve`, no `reject`, no session table — the JWT is the artifact

**Admin UI:**

- `Settings → Device Tokens` page in the admin: user picker, permission checklist, expiration selector, **Generate** button
- After generation: large QR rendering with copy-JWT fallback below it

**Security:**

- JWT permissions ⊆ admin's RBAC; backend rejects requests for scopes the admin doesn't hold
- **No revocation surface** — JWTs are validated stateless, signature + `exp` only. Choose short expirations
- Operator must regenerate a new token to grant changed access; old tokens remain valid until `exp`
- `POST /api/auth/qr-jwt/generate` is rate-limited per admin

### B.1 `card-installer` (Android App)

[lawalletio/card-installer](https://github.com/lawalletio/card-installer) — native Android app (NFC enabled) for **bulk** NTAG424 provisioning:

- **Login** — authenticates via B.0 by scanning the device-JWT QR minted in lawallet-web
- **Select a design** — picks one of the card designs created in the lawallet-web dashboard
- **Bulk write / initialize** — taps blank NTAG424 chips one after another, writing keys (and OTC activation state) and registering each card in the system as **initialized** (ready to be activated). This is the step that creates the card records: designs come from lawallet-web, the physical write + system registration happen here.
- **Optional activation-QR** — can emit an Activation QR for a freshly written card on the spot (the same artifact `card-manager` prints later)

`card-installer` does **not** bind a card to a holder — initialized cards are unowned until someone claims them through the "Activate Card" flow. Tokens stored in Android Keystore via `EncryptedSharedPreferences`; when the JWT expires, the operator generates a fresh one from the admin.

### B.2 `card-manager`

[lawalletio/card-manager](https://github.com/lawalletio/card-manager) — takes any **initialized** card (written by `card-installer`) and prints an **Activation QR** so anyone can activate it for their account. Individual, on-demand activation — the counterpart to the installer's bulk write.

- B.0 QR-based JWT login (needs a device JWT to reach the API)
- Wire to current LaWallet API (cards, designs, NTAG424, Remote Wallets)
- Look up any initialized card and generate its Activation QR (B.2.1)
- Display the QR on screen or print it (poster mode, design-aligned) for any user to scan
- Card rescue / re-issue path — unpairs a card from any previous owner and readies it for a new user (B.2.2)
- E2E coverage for login + activation + rescue
- Published under `@lawalletio` org with M3-aligned branding

#### B.2.1 Cards & QRs — two separate concepts

There are **two orthogonal concepts** in the card flow: the **card kind** (a property of the card itself) and the **QR kind** (a property of an activation token issued for a card).

**Card kinds** (declared at card creation, persisted on the `Card`):

- `SIMPLE` — single-holder card. Only ownership-transfer is supported.
- `MASTER` — account-share-capable card. Supports ownership-transfer **and** account-share grants.

**QR kinds** (a property of each `CardActivationToken`):

- `ONE_TIME` — single-use. First wallet to scan claims; token burns; subsequent scans return "already claimed". Issued for **both** SIMPLE and MASTER cards.
- `FOREVER` — multi-use. Every scan claims; token does **not** burn. Issued only for **MASTER** cards.

**Constraint — max one active QR of each kind per card:**

- A card has **at most one active `ONE_TIME` QR** at a time
- A card has **at most one active `FOREVER` QR** at a time (MASTER cards only)
- Generating a new QR of the same kind on the same card invalidates the previous one
- A MASTER card can therefore have up to **two QRs live concurrently** (one of each kind); a SIMPLE card has at most one

**Every card can re-issue a fresh QR via `card-manager` (or directly from `card-installer` at write time).** Cards transfer (or share, for MASTER) only via their own QR.

QR can be shown on screen or printed (poster mode, design-aligned).

#### B.2.2 Card Rescue

- "Rescue this card" action invalidates any prior outstanding activation tokens for the card
- Generates a fresh `ONE_TIME` (`SIMPLE`) activation QR — card returns to a fresh, unassigned, no-attachments state
- Available on **any card** via `card-manager` — if the card had a previous owner, rescuing it unpairs that owner and readies the card for a new user. This is the standard "re-issue" path; "rescue" is just the wording when a previous QR was lost / leaked

### B.3 "Activate Card" Flow (End-User Wallet UI)

- New "Activate Card" entry in the user wallet (home-screen CTA + Settings entry)
- Wallet opens a QR scanner → reads the activation token
- **Identity step** — the claimer picks who claims:
  - **New user** — wallet creates a fresh `nsec` on the spot
  - **Existing user** — wallet signs in with NIP-07 / NIP-46 / paste nsec
- Wallet calls `POST /api/activation-tokens/[id]/claim` (NIP-98 / JWT) with the claimer's identity

Flow branches on the token's **QR kind**:

**`ONE_TIME` (ownership transfer — works for SIMPLE and MASTER cards):**

- Wallet asks the claimer which Remote Wallet should fund the card (defaults to claimer's default)
- Backend atomically: marks the token `CLAIMED`, transfers `Card.holderUserId` to the new claimer, binds `Card.remoteWalletId`, burns the token
- Previous holder's other cards / LAs / Remote Wallets stay with them — only this card moves
- Confirmation screen: card design preview + bound Remote Wallet + "ready to tap"
- A second wallet scanning the same QR sees "Already claimed"

**`FOREVER` (account share — MASTER cards only):**

- Backend records a new `CardClaim` row; token does not burn
- Claimer is granted access to **every** Lightning address and Remote Wallet owned by the card's current holder, via `LightningAddressShare` + `RemoteWalletShare` rows
- The card's ownership does not change — claimers inherit account access, not card ownership
- Card holder is not locked out — retains nsec login and canonical ownership of the card + their LAs + Remote Wallets
- Confirmation screen lists the granted resources + a "Manage shared access" entry for per-share revoke

#### Data model — cards, activation tokens, shared access

```
Card {
  id            cuid
  kind          enum                 # SIMPLE | MASTER — declared at creation
  designId      cuid
  holderUserId  cuid?                # current owner (after first ONE_TIME claim)
  remoteWalletId cuid?               # bound Remote Wallet
  createdAt, updatedAt
  ...                                # NTAG424 fields, OTC state, etc.
}

CardActivationToken {
  id            cuid
  cardId        cuid
  qrKind        enum                 # ONE_TIME | FOREVER
  status        enum                 # PENDING | CLAIMED (ONE_TIME only) | REVOKED | EXPIRED
  qrPayload     string
  issuedByUserId cuid                # card holder (or operator) who minted the QR
  createdAt, expiresAt?
  claimedAt?, claimedByUserId?       # ONE_TIME only — single audit row
}
                                     # Constraint: at most one ACTIVE token per (cardId, qrKind).
                                     # FOREVER tokens only valid when Card.kind = MASTER.

CardClaim {
  id              cuid
  cardId          cuid
  claimedByUserId cuid
  claimedAt       datetime           # one row per FOREVER claim; ONE_TIME has at most one
}

LightningAddressShare {
  lightningAddressId cuid
  granteeUserId      cuid
  grantedViaCardId   cuid            # provenance — the MASTER card that granted this
  grantedAt          datetime
  revokedAt?         datetime
}

RemoteWalletShare {
  remoteWalletId   cuid
  granteeUserId    cuid
  grantedViaCardId cuid
  grantedAt        datetime
  revokedAt?       datetime
}
```

#### Endpoints

- `POST /api/cards/[id]/activation-tokens` — operator (or current card holder) only; body `{ qrKind: 'ONE_TIME' | 'FOREVER' }` → `{ tokenId, qrPayload, qrKind }`. `FOREVER` rejected when `Card.kind = SIMPLE`. Replaces any prior active token of the same kind on the same card.
- `POST /api/activation-tokens/[id]/claim` — authenticated wallet user (existing or freshly created nsec); body `{ remoteWalletId? }` for ONE_TIME; returns `{ qrKind, card, grantedAccess?: { lightningAddresses[], remoteWallets[] } }`
- `POST /api/cards/[id]/rescue` — operator (or current card holder) only; invalidates outstanding tokens, returns a fresh `ONE_TIME` token
- `DELETE /api/shares/lightning-addresses/[id]` and `DELETE /api/shares/remote-wallets/[id]` — issuing user only; revokes a specific FOREVER-granted share

### B.4 Connect Card E2E

- **Design** — admin creates the card design(s) in the lawallet-web dashboard
- **Token** — admin mints a device JWT in lawallet-web and shows it as a QR
- **Bulk write / initialize** — `card-installer` (Android, NFC) scans the JWT, picks a design, and writes blank NTAG424 chips in bulk, registering each card in the system as *initialized*
- **Activation-QR generation** — `card-manager` takes an initialized card and prints a `ONE_TIME` QR for a `SIMPLE` card (or `card-installer` emits one at write time; MASTER + FOREVER variant in a separate branch)
- **Activate / claim** — the user scans the QR, which opens lawallet `/wallet`; the claimer creates a fresh account or signs into an existing one; ONE_TIME burns and transfers card ownership (if the card had a previous owner it is unpaired first); FOREVER grants share access without burning
- **Pair** — backend stores `(card, npub, remoteWalletId)`
- **Pay** — tap-to-pay over BoltCard NFC → LNURL-pay → invoice minted via the holder's Remote Wallet
- Playwright + simulated NFC covers the happy path; separate `FOREVER` (MASTER) claim branch asserts share rows are created and the claimer sees the granted resources
- Re-issue path covered too: `card-manager` mints a new `ONE_TIME` QR for an already-owned card, unpairing the previous holder so it can be handed off to a new user

---

## C. Platform Polish

### NIP-05

- Public `.well-known/nostr.json` endpoint per [NIP-05 spec](https://github.com/nostr-protocol/nips/blob/master/05.md)
- Returns `{ names: { username: pubkey }, relays: { pubkey: [relay-urls] } }`
- Avatar served from cached kind:0 metadata
- Caches kind:0 + relay-list (kind:10002) with TTL refresh

### Relay Picker

- Per-user preference for preferred relays
- Persisted on the `User` model
- Settings UI in the user wallet
- Consumed by NIP-05 cache, the listener, and the user wallet

### User Data Cache

- Backend table for cached Nostr profile (kind:0) + relay-list (kind:10002)
- TTL-based refresh, manual invalidation endpoint
- Served to the listener, admin UI, NIP-05 endpoint, and `/api/users/[userId]`

### Onboarding v2

The wizard inspects the operator's domain, classifies the **infrastructure in front of it**, and prints copy-pasteable rewrite recipes for the three `.well-known/` endpoints lawallet-nwc serves.

**Detected `.well-known` paths the wizard needs to forward to the lawallet-nwc origin:**

- `/.well-known/lnurlp/<username>` — LUD-16 Lightning address callback
- `/.well-known/nostr.json` — NIP-05 identity (Theme C)
- `/.well-known/verify` — LUD-21 verify endpoint

**Detection:**

- Response-header fingerprinting on a probe request: `Server`, `cf-ray`, `x-vercel-id`, `x-nf-request-id`, `x-served-by`, `via`, `x-amz-cf-id`, `cf-cache-status`, `alt-svc`
- DNS lookup — NS records, CNAME chain, IP block ownership for AWS / Cloudflare / Vercel / Netlify / Fly ranges
- Classifies as one of: **Cloudflare (proxied)**, **Cloudflare Tunnel**, **Vercel**, **Netlify**, **Nginx**, **Caddy**, **Apache**, **Bunny / Fastly / generic CDN**, **direct origin**

**Recommended rewrite per infra (generated by the wizard):**

| Infra | Mechanism | Example |
|-------|-----------|---------|
| Cloudflare (proxied) | Transform Rule or Worker route forwarding `/.well-known/*` to the lawallet-nwc origin | `(http.request.uri.path matches "^/.well-known/(lnurlp\|nostr\.json\|verify)")` → rewrite host |
| Cloudflare Tunnel | `cloudflared` ingress rule | `- hostname: <domain>` `  path: /.well-known/.*` `  service: http://lawallet-nwc:3000` |
| Vercel | `vercel.json` rewrites | `{ "source": "/.well-known/:path*", "destination": "https://<lawallet>.example/.well-known/:path*" }` |
| Netlify | `_redirects` or `netlify.toml` | `/.well-known/* https://<lawallet>.example/.well-known/:splat 200` |
| Nginx | `location /.well-known/ { proxy_pass ...; }` block | `location ~ ^/\.well-known/(lnurlp\|nostr\.json\|verify) { proxy_pass http://lawallet-nwc:3000; }` |
| Caddy | `handle_path` + `reverse_proxy` | `handle_path /.well-known/* { reverse_proxy lawallet-nwc:3000 }` |
| Apache | `mod_rewrite` | `RewriteRule ^/\.well-known/(.*)$ http://lawallet-nwc:3000/.well-known/$1 [P,L]` |
| Bunny / Fastly / generic CDN | Origin pull rule scoped to `/.well-known/*` | Provider-specific UI screenshot in the wizard |
| Direct origin | None — DNS A/AAAA points straight at the lawallet-nwc host | — |

- Snippets rendered with the operator's actual domain pre-substituted (no `<placeholder>` editing)
- Click-to-copy on each block; link to the matching provider dashboard where possible
- DNS sanity check — surfaces missing A / AAAA / CNAME records, with prompts that link to the operator's DNS dashboard

**Validation step (before the wizard completes):**

- HEAD probe each of the three paths against the operator's public domain
- Compare the response to the lawallet-nwc origin response (status, content-type, body fingerprint) to confirm the rewrite landed
- Surface red / amber / green per path; wizard cannot complete until all three are green (or the operator explicitly skips with a warning)

### Dashboard Cache Pages

- Next.js Cache Components / `cache()` for read-heavy admin pages
- Dedupe redundant `/api/settings` calls across Topbar, Sidebar, Branding, Wallet tab
- Revalidate on settings mutation via SSE

### PWA Wallet

- Web app manifest (icons, theme color, install prompts)
- Service worker for offline cache (extend `activity-cache` + balance cache)
- Install prompt UX
- iOS / Android install instructions

### Customizable Domain Landing (`lawallet-web`)

White-label entry screen at the root of every operator's `lawallet-web` deployment. Pulls branding + content from Settings; every domain ships its own variant without code changes.

**Branding additions:**

- Extend the existing branding-image uploads in `Settings → Branding` (already wired through `/api/settings`) with three new slots: **isotype** (icon-only mark), **larger logo** (hero / desktop), and **cover image** (Nostr-style banner, like a kind:0 banner)
- Isotype used in the small header / favicon contexts; larger logo on the hero of the new landing screen; cover image as a wide background banner above the hero
- Operator's selected **color tokens** and **radius** (already in `Settings → Branding`) drive every accent, button, and corner on the landing screen — no extra theming work
- All branding URLs reuse the existing branding-upload mechanism shipped in M3 — no new settings keys for image URLs

**Landing flow:**

1. **Claim address** screen — cover image banner up top, operator logo, single primary CTA, input for desired username
2. As the user types, the screen **highlights the full Lightning address** in large type: `username` · `@` · `domain` — the `@` and the domain stay prominent so the user reads the whole identity, not just what they typed
3. **(Optional) Benefits step** — if `Settings → Landing → benefitsMarkdown` is set, render that Markdown block as a dedicated step
4. **Login** — Nostr-native sign-in (NIP-07 / NIP-46 / nsec) using the existing login modal
5. **Continue** — proceeds into the address-claim flow, lands the user in their wallet with the newly claimed Lightning address

**Live product screenshots:**

- Carousel / strip of in-app screenshots inline on the landing screen (user wallet home, Send / Receive, Activate Card)
- Sourced from a curated set bundled with the app; selected variants honour the operator's color + radius tokens so the previews look native to the instance
- Lazy-loaded; mobile shows a single screenshot at a time with swipe

**Social links:**

- Reuses the existing social fields already wired in `Settings → Branding`: `social_whatsapp`, `social_telegram`, `social_discord`, `social_twitter`, `social_website`, `social_nostr`, `social_email`
- Landing renders the corresponding brand icons at the footer of each step
- Icons hidden when the corresponding handle is empty — no placeholders
- No new settings keys

**Settings keys (added):**

- `landing.benefitsMarkdown` — optional Markdown shown between input and login
- `landing.ctaLabel` — optional override for the CTA copy

Branding image URLs (isotype, larger logo, cover) reuse the existing branding-upload setup. Social handles reuse the existing `social_*` fields. No new keys for either.

### Admin Home Redesign

Replaces the four stat-card layout currently on `/admin` with an opinionated, onboarding-driven home that adapts to what the operator has already set up.

**Hero — `username @ domain` animation:**

- Large-type display of the operator's `username · @ · domain` at the top of the home
- Subtle animation on render: characters fade-in left-to-right, the `@` glyph pulses briefly, and the domain settles last so the eye lands on the full identity
- Uses the operator's color + radius tokens from `Settings → Branding`
- Falls back to `@domain` (no username) when the operator hasn't claimed an address yet — and the username slot reads as a placeholder `claim your address →` CTA

**Onboarding sequence — Lightning address first, NWC later:**

1. **Step 1 — Claim a Lightning address** — front-and-centre card; uses the same live `you@domain` preview as the customizable domain landing
2. **Step 2 — Connect a Remote Wallet** — surfaced **after** step 1 (or after a "I'll do this later" dismissal)
3. **Step 3 — Issue a card** — appears once steps 1 + 2 are green
4. Completed steps collapse into a single-line "done" row at the bottom; the next pending step takes the hero slot

**Remote Wallet options shown from the start (when none set):**

- If the operator has zero `RemoteWallet` rows, the home renders the **Remote Wallet picker inline** — not buried in Settings
- Picker shows the NWC option as the primary action and lists the future types (LND, Core Lightning, BTCPayServer) as disabled previews so the operator knows what's coming
- Removes the friction of "where do I add a wallet?" — the answer is "right here, on the home"

**Stat cards:**

- The legacy stat cards (total cards, paired, addresses, designs) move below the onboarding hero and are shown only once the operator has at least one of each
- Empty stat cards no longer render — fewer zero-state cells on a fresh instance

### Bug Fixes

- Card design dropdown stale state — revalidate the design list after mutation
- Redundant `getSettings` calls — centralize via a shared SWR key or React Server Component

### LaWallet Landing — Design Additions

In the `lawallet-landing` repo. Marketing-side polish; deep technical detail stays in the docs site.

**Product screenshots:**

- Admin dashboard
- User wallet
- Connection Map UI
- `card-manager`
- NFC card tap lifestyle shot

**Admin features section:**

- Domain claim + onboarding
- Card issuance + design management
- Lightning address management
- Remote Wallets
- Branding presets
- Activity log

**Subscription UI/UX (for domain owners):**

- Striking pricing layout aimed at domain operators
- Tier columns + feature checklist
- Per-tier monthly cost in sats + fiat
- "Start operating" CTA → onboarding
- Testimonial slot
- Self-hosted vs hosted comparison

**Roadmap — monthly navigation:**

- Restyle the single-page roadmap into per-month pages
- Each month page shows that month's deliverables on top, and the cumulative feature set below
- Status pills: shipped · in progress · planned
- Links out to the docs site for deeper technical context per feature

**CRM swap:**

- Replace Tally with the operator's CRM (Resend forms, Beehiiv, Bento, or pluggable adapter)

---

## Acceptance Criteria

| Deliverable | Theme | Criteria | Priority |
|-------------|-------|----------|----------|
| `RemoteWallet` model + migration | A | New table + driver interface; existing NWC connections migrated forward as `type = NWC` rows | P0 |
| Remote Wallets UI (NWC) | A | Create / rename / set default / disable / revoke | P0 |
| Connection Map UI (desktop) | A | Two-column canvas with LAs + Cards on the left and Wallets on the right; drag-to-rebind commits via API | P0 |
| Connection Map UI (mobile) | A | Three-tab variant (Addresses · Cards · Wallets) below 1024 px; tap-chip rebind for LAs and Cards | P0 |
| Card → Remote Wallet binding | A | Cards reference a `RemoteWallet`; payment flow resolves through the NWC driver | P0 |
| Non-NWC drivers (LND / CLN / BTCPay / others) | A | Deferred — no driver shipped this month | — |
| QR-based JWT login (B.0) | B | Admin `Settings → Device Tokens`: pick user + permissions + expiration → `POST /api/auth/qr-jwt/generate` → JWT rendered as QR; third-party app scans + uses it. Stateless (no revocation). | P0 |
| `card-installer` Android app | B | Bulk-writes NTAG424 against a chosen design and registers each card as *initialized*; authenticates via B.0; optional activation-QR at write time | P0 |
| `card-manager` | B | Authenticates via B.0; prints an Activation QR for any initialized card; rescue/re-issue unpairs prior owner; E2E green; published | P1 |
| Card kinds | B | `Card.kind` declared at creation: `SIMPLE` (ownership transfer only) or `MASTER` (transfer + account share) | P0 |
| Activation tokens model + endpoints | B | `CardActivationToken.qrKind` is `ONE_TIME` or `FOREVER`; max one active token per (cardId, qrKind); FOREVER rejected on SIMPLE cards; claim enforces burn for ONE_TIME and share-grant for FOREVER | P0 |
| Re-issue / activation-QR generation | B | Any card holder can produce a fresh QR via `card-manager`; new QR of same kind invalidates the previous on that card | P0 |
| Card rescue path | B | `POST /api/cards/[id]/rescue` invalidates outstanding tokens and issues a fresh `ONE_TIME` QR | P0 |
| Claim identity options | B | Claimer can scan as a brand-new user (fresh nsec) or sign in as an existing user | P0 |
| "Activate Card" flow — `ONE_TIME` | B | Wallet scans QR → picks Remote Wallet → claim transfers card ownership only → token burns; second scan sees "already claimed" | P0 |
| "Activate Card" flow — `FOREVER` (MASTER only) | B | Wallet scans FOREVER QR → claim succeeds without burning → claimer gains share access to card holder's LAs + Remote Wallets | P0 |
| Share revocation | B | Master holder can revoke a specific share per (resource, grantee) | P1 |
| Connect Card E2E | B | Design → token → bulk-write/initialize → activate-QR → claim → pair → pay; separate `FOREVER` (MASTER) branch covered; re-issue path covered (`card-manager` mints a new QR, unpairing the prior holder) | P0 |
| NIP-05 | C | `.well-known/nostr.json` resolves with relays + avatar | P0 |
| Relay picker | C | Persisted per user, used by NIP-05 cache | P1 |
| User data cache | C | Cached kind:0 + relay-list with TTL refresh | P1 |
| Onboarding v2 | C | Infrastructure detection (Cloudflare / Vercel / Netlify / Nginx / Caddy / Apache / generic CDN / direct origin) + copy-pasteable rewrite recipes for `/.well-known/lnurlp`, `/.well-known/nostr.json`, `/.well-known/verify`; HEAD-probe validation before wizard completes | P1 |
| Dashboard cache | C | Single `getSettings` per page | P1 |
| PWA Wallet | C | Installable, runs offline with last-known balance | P1 |
| Branding — isotype + large logo + cover uploads | C | `Settings → Branding` accepts isotype, larger logo, and cover image; all three surface in the right contexts on the landing | P0 |
| Customizable domain landing | C | White-label entry screen honors color + radius tokens; cover banner + logo + claim-address input with live `you@domain` preview; optional benefits step; login; continue to wallet | P0 |
| Admin home redesign | C | `username @ domain` animated hero; Lightning-address-first onboarding (NWC second); stat cards demoted; empty zero-states hidden | P0 |
| Remote Wallet inline picker on admin home | C | When the operator has no `RemoteWallet` row, the home renders the picker inline (NWC primary; LND / CLN / BTCPay shown as disabled previews) | P0 |
| Landing — live product screenshots | C | In-app screenshot strip inline on the landing; swipeable on mobile | P1 |
| Landing — social links | C | Existing `social_*` fields from `Settings → Branding` drive brand-icon links at the footer; empty handles hidden | P1 |
| Bug fixes | C | Card-design dropdown updates; `getSettings` deduped | P1 |
| Landing — screenshots | C | Product screenshots live on the marketing site | P1 |
| Landing — admin features section | C | Section showcases admin capabilities | P1 |
| Landing — subscription UI/UX | C | Pricing layout for domain owners with tiers, feature checklist, CTAs | P1 |
| Landing — monthly roadmap | C | Per-month pages with that month's deliverables + cumulative feature set | P1 |
| Landing CRM swap | C | Tally replaced with operator's CRM | P2 |
