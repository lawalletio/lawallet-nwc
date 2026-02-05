# User Onboarding Progression

## Progressive Self-Custody Model

LaWallet NWC is designed around a progressive self-custody model. Each stage gives the user more control over their funds and identity. Users can stay at any stage indefinitely or advance at their own pace.

---

## Stage 1: Alias / Redirect

**Friction: Zero**

The user signs up and gets a lightning address (e.g., `alice@domain.com`) that immediately works by redirecting to their existing wallet.

- User provides their current lightning address (e.g., `alice@walletofsatoshi.com`, `alice@getalby.com`, `alice@phoenix.acinq.co`)
- Platform configures the alias to redirect all incoming LNURL-pay requests to the target
- Sender resolves `alice@domain.com` → platform proxies to `alice@walletofsatoshi.com`
- Payment goes directly to the user's existing wallet
- No NWC connection required
- No keys to manage
- Works with any Lightning wallet that supports lightning addresses

**User controls:** Redirect target address

---

## Stage 2: Courtesy NWC

**Friction: Low**

The user upgrades to a temporary NWC connection provided by the Courtesy NWC Proxy service. This gives them a proper NWC-connected address without needing their own wallet infrastructure.

- User requests a courtesy NWC connection from the proxy
- Proxy provisions a NWC connection string from a configured provider:
  - Alby Hub
  - LNBits
  - BTCPayServer
  - YakiHonne
  - Any generic NWC provider
- Connection string is linked to the user's lightning address
- Payments now route via NWC instead of redirect
- User can switch providers or revoke at any time

**User controls:** NWC-connected address, choice of provider

---

## Stage 3: Own NWC Wallet

**Friction: Medium**

The user connects their own NWC wallet directly to the platform, removing dependency on the courtesy proxy.

- User provides their own NWC connection string
- Platform links the string to their lightning address
- Full control over wallet and funds
- Can use any NWC-compatible wallet (Alby, Mutiny, Zeus, etc.)

**User controls:** Full wallet control, own keys

---

## Stage 4: Self-Hosted LaWallet

**Friction: High (one-time setup)**

The user runs their own LaWallet instance on their own hardware, achieving full sovereignty.

- Deploy on Umbrel, Start9, or Docker
- Run all three containers (web, listener, proxy) or just the web container
- Own domain, own database, own infrastructure
- Full control over everything

**User controls:** Full sovereignty

---

## Onboarding UX Flow

```
Sign Up
  │
  ├─→ "I have a lightning address" → Enter existing address → Stage 1 (Alias)
  │     │
  │     └─→ "Upgrade to NWC" → Select provider → Stage 2 (Courtesy NWC)
  │           │
  │           └─→ "Use my own wallet" → Paste NWC string → Stage 3 (Own NWC)
  │
  └─→ "Get me started" → Auto-provision courtesy NWC → Stage 2
        │
        └─→ Same upgrade path as above
```

---

## Nostr Identity Integration

At any stage, users can:

- Set their npub (Nostr public key)
- Use NIP-05 to resolve their npub from an existing Nostr identity
- Get NIP-05 verification served by the platform (`alice@domain.com` → npub)
- Unify their lightning address and Nostr identity under one domain

---

## Resolution Priority

When resolving a lightning address, the platform checks in this order:

| Priority | Method | Description |
|----------|--------|-------------|
| 1 | Own NWC Connection | User connected their own NWC wallet |
| 2 | Courtesy NWC | Temporary connection via Courtesy NWC Proxy |
| 3 | Alias / Redirect | Redirects to external lightning address |
