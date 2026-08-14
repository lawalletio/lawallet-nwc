# LaWallet onboarding example

A complete third-party webapp against a LaWallet instance, built on
[`@lawallet-nwc/react`](../../packages/react): a domain owner offers visitors a
lightning address on their domain — nostr-native login, payment-gated claiming,
then alias or NWC wallet configuration.

**The whole flow, in ~5 small screens:**

1. **Landing** — branding (logo, community name, domain) loads automatically
   from the instance's public settings.
2. **Login** — NIP-07 extension, a generated Nostr identity (nsec shown once
   for backup), or a pasted nsec. No passwords, no JWT: every API request is a
   NIP-98 event signed by the user's key.
3. **Claim** — username availability as you type; if the operator enabled paid
   registration, a lightning invoice QR appears (WebLN one-click supported)
   and the flow claims the address automatically once the payment settles.
4. **Dashboard** — the live address, routing config (forward to another
   lightning address, or connect the user's own wallet via Nostr Wallet
   Connect), and received payments updating live over SSE.

## Run it

```bash
# From the repo root — builds @lawallet-nwc/sdk and @lawallet-nwc/react once
pnpm build

cd examples/onboarding
cp .env.example .env   # set VITE_LAWALLET_ENDPOINT to your instance
pnpm dev
```

Point `VITE_LAWALLET_ENDPOINT` at your instance's **public** URL — NIP-98
signatures commit to it. For local development against a dev server started
with `pnpm start:dev-server`, use the URL it prints.

To exercise the paid path, enable paid registration in your instance's admin
settings (Settings → registration) — the flow branches on the API's 402
automatically.
