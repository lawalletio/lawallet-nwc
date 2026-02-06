# Month 4: User Dashboard + Courtesy NWC Proxy + Wallet Polish

**Period:** April 5 - May 5, 2026
**Status:** Planned
**Depends on:** Month 3 (Nostr Login + Admin Enhancement)

## Summary

Build the user-facing dashboard for profile and identity management, deploy the Courtesy NWC Proxy as an independent service, and polish the existing wallet interface.

---

## Goals

- Build the User Dashboard (primary deliverable)
- Build and deploy Courtesy NWC Proxy as independent container
- Complete frontend wallet redesign
- Implement white-label customization
- Continue E2E testing

---

## User Dashboard (Primary Focus)

The User Dashboard is a dedicated area where users manage their profile, identity, address configuration, and preferences. Separate from the wallet interface, which focuses on payments.

### Profile Management

- Edit display name and avatar
- Set bio/description
- Contact information

### Nostr Identity (npub / NIP-05)

- Set npub (Nostr public key) manually
- Resolve npub from NIP-05 identifier (`alice@example.com` → npub)
- Platform serves NIP-05 verification at `.well-known/nostr.json`
- Unified identity: `alice@domain.com` resolves to both lightning address AND npub
- Display Nostr profile metadata pulled from relays (kind:0)

### Lightning Address Configuration

- View current lightning address (`user@domain.com`)
- View resolution method: alias/redirect, courtesy NWC, or own NWC
- Configure and change redirect target (for alias users)
- Request courtesy NWC upgrade (via `useCourtesyNWC` hook)
- Connect own NWC wallet (paste NWC connection string)
- View resolution priority and active method

### Address Redirect Management

- Set redirect target address
- Test redirect (verify target is reachable)
- View redirect history
- Remove redirect (when upgrading to NWC)

### NWC Connection Management

- View current NWC connection status
- Connect/disconnect NWC wallet
- Switch between courtesy NWC and own NWC
- View NWC provider (for courtesy connections)
- Revoke courtesy NWC connection

### Preferences

- Notification settings
- Privacy settings
- Theme preference

---

## Courtesy NWC Proxy Service (New Container)

### Overview

Standalone Node.js service in its own Docker container. Provisions temporary NWC connection strings from external providers. See [NWC-PROXY.md](../services/NWC-PROXY.md) for full specification.

### Provider Adapters

- Alby Hub (OAuth + NWC) — builds on existing `albyhub.ts` integration
- LNBits (API + NWC)
- BTCPayServer (Greenfield API + NWC)
- YakiHonne (NWC)
- Generic NWC (any provider exposing NWC connection strings)

### API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/connections` | POST | Provision new courtesy NWC connection |
| `/connections/:id` | GET | Get connection status |
| `/connections/:id` | DELETE | Revoke courtesy NWC connection |
| `/providers` | GET | List available NWC providers |
| `/health` | GET | Health check |

### React Hook

- `useCourtesyNWC` hook in frontend consuming proxy API
- Connection status, provider selection, provision/revoke flows

---

## Frontend Wallet Polish

The wallet already has: login (nsec/extension/create), balance display, send dialog, recent cards, NWC setup widget, and settings. This month focuses on polish.

### Enhancements

- Improved NWC connection flow with QR code and step-by-step guide
- Payment history with filters (currently not implemented)
- Receive payment interface (display invoice/address)
- Status indicators (connected, connecting, error) with better UX
- Mobile responsive improvements

---

## White-Label Customization

- Logo upload and display
- Primary and secondary color configuration
- Custom CSS injection
- Footer links configuration
- Stored in database, applied via CSS variables
- Preview in admin before publishing

---

## Customizable Landing Page

- Editable hero section: title, subtitle, CTA button
- Feature highlights section
- Partner/sponsor logos
- Waitlist integration (already has subscribe endpoint)
- JSON-based content editor in admin dashboard

---

## E2E Testing (Continued)

- User dashboard flows: profile setup, npub configuration, address management
- Redirect setup and NWC upgrade flows
- Wallet interface: send, receive, history
- White-label customization verification

---

## Acceptance Criteria

| Deliverable | Criteria | Priority |
|-------------|----------|----------|
| User Dashboard | Profile, npub, address config, redirect, NWC management working | P0 |
| NIP-05 | Platform serves `.well-known/nostr.json`, npub resolution works | P0 |
| Courtesy NWC Proxy | Container running, 2+ providers working | P0 |
| `useCourtesyNWC` | Hook working with proxy service | P0 |
| Wallet polish | Payment history, receive interface, improved NWC flow | P1 |
| White-label | Logo, colors, CSS injection working | P1 |
| Landing page | Editable via admin, renders correctly | P2 |
| E2E | User dashboard and wallet flows covered | P1 |
