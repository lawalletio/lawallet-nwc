# Deferred LUD-16 Proxy Settlement

LaWallet can opt an address into `PROXY_ALIAS` mode. The public address
advertises local LUD-12, LUD-21, and NIP-57 support, receives into an
operator-owned NWC account, retains a fee, and forwards the net amount to the
configured destination only after the payer invoice settles.

This is separate from the courtesy NWC provisioning service described in
`NWC-PROXY.md`.

## Pipeline

1. Metadata resolution reads the destination LNURL-pay metadata only. It never
   calls the destination callback.
2. The local callback snapshots the destination constraints and fee, persists
   any canonical zap request, and asks the proxy NWC account for the
   payer-facing invoice.
3. A signed listener webhook marks that source invoice paid and wakes the web
   reconciler without waiting for forwarding.
4. The reconciler claims the row with `FOR UPDATE SKIP LOCKED`, moves it to
   `FORWARDING`, requests the exact net destination invoice, persists it, and
   submits it through the listener's idempotent payment journal.
5. Pending or unknown outgoing results retain the same invoice and request id.
   Explicit failures retry that invoice; only expiry permits a new one.
6. A successful NIP-57 payment publishes its kind `9735` receipt. Receipt
   retries never repeat the Lightning payment.

The listener wakes reconciliation at startup and every 10 minutes. Its normal
notification catch-up also recovers source settlements missed during downtime.

## Configuration

Set the same `NWC_VAULT_SECRET` (at least 32 characters) on web and listener.
Keep it stable across upgrades and backups: existing NWC credentials cannot be
decrypted after it changes.

Then open **Admin → Settings → NWC Services → Lightning Address proxy**:

- save a send/receive NWC URI with `make_invoice`, `pay_invoice`,
  `lookup_invoice`, and `get_balance`;
- save an `nsec` used only for NIP-57 receipts (this is a write-only Admin
  Setting, not an environment variable);
- choose the service fee (default 0.50%);
- test capabilities and balance; and
- enable deferred forwarding.

Secrets are stored in the same `lwrw1:` AES-256-GCM envelope as RemoteWallet
NWC URIs (`NWC_VAULT_SECRET`, field AAD `default:nwc` /
`default:receipt-nsec`). Startup converts leftover `LWPX01` proxy blobs when
they still decrypt. They are write-only in the API and are not part of generic
Settings backups. They cannot be removed or rotated while an invoice intent or
settlement remains outstanding.

A receipt signer the active secret cannot open is replaced with a fresh key at
startup, because a broken signer disables NIP-57 for every NWC wallet on the
instance and the original key is unrecoverable. Replacement is gated on
another NWC credential proving the active secret, and rewrites
`receiptPubkey` in the same statement so `.well-known/nostr.json` and every
advertised `nostrPubkey` keep matching the key that signs receipts. Receipts
already published stay verifiable against the key that signed them.

## Routes

- `GET/PUT /api/settings/lud16-proxy`
- `POST /api/settings/lud16-proxy/test`
- `GET /api/settings/lud16-proxy/payments`
- `POST /api/settings/lud16-proxy/payments/[id]/retry`
- `POST /api/internal/lud16-proxy/reconcile` (listener HMAC only)

The public LUD-16 callback exposes only the payer invoice and LUD-21 verifier.
Destination invoices and forwarding state are administrator-only.
