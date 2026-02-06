# Badges Plugin

> ⚠️ **PROPOSAL - NOT IMPLEMENTED**
>
> This is a **proposed feature** for LaWallet. It is **not yet implemented** and is **not included in the current roadmap**. This document serves as a specification for potential future development.

---

## Overview

The Badges Plugin implements a Nostr-native badge system (NIP-58) for LaWallet. Badges serve as verifiable credentials that represent reputation, achievements, and memberships. They can unlock rewards like merchant discounts and community access.

## Problem Statement

- Traditional loyalty programs are centralized and non-portable
- Reputation systems are siloed within platforms
- There's no standard way to verify community participation
- Users don't own their reputation data

## Proposed Solution

A decentralized badge system built on Nostr (NIP-58) where:

- Users **own** their badges (signed to their pubkey)
- Badges are **verifiable** by anyone (cryptographic proof)
- Badges are **portable** across applications
- Badges unlock **real value** (discounts, access, rewards)

## Features

### Badge Types

| Type | Description | Example |
|------|-------------|---------|
| **Attendance** | Issued for attending events | "La Crypta Meetup #42" |
| **Achievement** | Earned through specific actions | "First Lightning Payment" |
| **Membership** | Represents community membership | "La Crypta Member 2026" |
| **Tier** | Progressive levels | "Bronze → Silver → Gold" |
| **Contribution** | Recognizes contributions | "Open Source Contributor" |
| **Custom** | Organization-defined | "Workshop Instructor" |

### Badge Templates

```typescript
interface BadgeTemplate {
  id: string;                    // Unique identifier
  name: string;                  // Badge name
  description: string;           // What this badge represents
  image: string;                 // Badge image URL
  issuer: string;                // Nostr pubkey of issuing organization
  category: BadgeCategory;       // attendance, achievement, membership, tier, custom
  tier?: {
    level: number;               // 1 = Bronze, 2 = Silver, 3 = Gold
    nextTier?: string;           // ID of next tier badge
    requirements?: string;       // How to reach next tier
  };
  benefits?: Benefit[];          // What this badge unlocks
  expiresAt?: number;            // Unix timestamp (optional)
  transferable: boolean;         // Can be transferred to another user
  revocable: boolean;            // Can issuer revoke it
}

interface Benefit {
  type: 'discount' | 'access' | 'zap';
  description: string;
  value?: number;                // Percentage for discount, sats for zap
  merchantId?: string;           // Specific merchant or '*' for all
}
```

### Badge Issuance

```typescript
interface BadgeAward {
  templateId: string;            // Which badge template
  recipient: string;             // Recipient's Nostr pubkey
  issuedAt: number;              // Unix timestamp
  reason?: string;               // Why badge was issued
  eventId?: string;              // Related event (for attendance badges)
  metadata?: Record<string, any>;// Additional data
}
```

## Technical Specification

### Nostr Implementation (NIP-58)

**Badge Definition (kind 30009)**

```json
{
  "kind": 30009,
  "pubkey": "<issuer-pubkey>",
  "tags": [
    ["d", "la-crypta-member-2026"],
    ["name", "La Crypta Member 2026"],
    ["description", "Active member of La Crypta community"],
    ["image", "https://lacrypta.ar/badges/member-2026.png"],
    ["thumb", "https://lacrypta.ar/badges/member-2026-thumb.png"]
  ],
  "content": "",
  "sig": "..."
}
```

**Badge Award (kind 8)**

```json
{
  "kind": 8,
  "pubkey": "<issuer-pubkey>",
  "tags": [
    ["a", "30009:<issuer-pubkey>:la-crypta-member-2026"],
    ["p", "<recipient-pubkey>"]
  ],
  "content": "Awarded for active participation in 2026",
  "sig": "..."
}
```

### API Endpoints (Proposed)

```
# Badge Templates
POST   /api/plugins/badges/templates         # Create template
GET    /api/plugins/badges/templates         # List templates
GET    /api/plugins/badges/templates/:id     # Get template
PUT    /api/plugins/badges/templates/:id     # Update template
DELETE /api/plugins/badges/templates/:id     # Delete template

# Badge Awards
POST   /api/plugins/badges/award             # Issue badge to user
GET    /api/plugins/badges/user/:pubkey      # Get user's badges
POST   /api/plugins/badges/verify            # Verify badge ownership
POST   /api/plugins/badges/revoke            # Revoke a badge
```

### Verification Flow

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│  Merchant   │────▶│  Scan User   │────▶│   Fetch     │
│    POS      │     │   Wallet QR  │     │   Badges    │
└─────────────┘     └──────────────┘     └──────┬──────┘
                                                │
                    ┌──────────────┐     ┌──────▼──────┐
                    │   Apply      │◀────│   Verify    │
                    │  Discounts   │     │ Signatures  │
                    └──────────────┘     └─────────────┘
```

### Database Schema (Proposed)

```sql
CREATE TABLE badge_templates (
  id UUID PRIMARY KEY,
  d_tag VARCHAR(255) NOT NULL,           -- NIP-58 'd' tag
  name VARCHAR(255) NOT NULL,
  description TEXT,
  image_url VARCHAR(500),
  issuer_pubkey VARCHAR(64) NOT NULL,
  category VARCHAR(50) NOT NULL,
  tier_level INTEGER,
  tier_next_id UUID REFERENCES badge_templates(id),
  benefits JSONB,
  expires_at TIMESTAMP,
  transferable BOOLEAN DEFAULT FALSE,
  revocable BOOLEAN DEFAULT TRUE,
  nostr_event_id VARCHAR(64),            -- Kind 30009 event ID
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(issuer_pubkey, d_tag)
);

CREATE TABLE badge_awards (
  id UUID PRIMARY KEY,
  template_id UUID REFERENCES badge_templates(id),
  recipient_pubkey VARCHAR(64) NOT NULL,
  issued_at TIMESTAMP DEFAULT NOW(),
  reason TEXT,
  related_event_id UUID,                 -- Reference to events table
  metadata JSONB,
  nostr_event_id VARCHAR(64),            -- Kind 8 event ID
  revoked_at TIMESTAMP,
  UNIQUE(template_id, recipient_pubkey)
);

CREATE INDEX idx_badges_recipient ON badge_awards(recipient_pubkey);
CREATE INDEX idx_badges_template ON badge_awards(template_id);
```

## UI Components (Proposed)

### For Issuers (Organizations)

- **Badge Designer**: Create badge templates with images
- **Issuance Dashboard**: Issue badges manually or in bulk
- **Analytics**: Track badge distribution and usage

### For Users

- **Badge Gallery**: View all earned badges
- **Badge Details**: Benefits, issuer, expiration
- **Share Badge**: Generate shareable proof
- **Badge Notifications**: New badge received

### For Merchants

- **Badge Scanner**: Read customer badges
- **Discount Rules**: Configure badge-based discounts
- **Verification UI**: Show which badges were detected

## Tier System

Progressive badge levels that encourage continued engagement:

```
Level 1: Bronze
    │ 5 events attended
    ▼
Level 2: Silver
    │ 15 events attended
    ▼
Level 3: Gold
    │ 30 events attended + contribution
    ▼
Level 4: Diamond (exclusive)
```

### Tier Benefits Example

| Tier | Discount | Perks |
|------|----------|-------|
| Bronze | 5% | Event notifications |
| Silver | 10% | Priority registration |
| Gold | 15% | VIP access + merch |
| Diamond | 20% | All above + speaking invites |

## Integration with Other Plugins

### Events Plugin

- Events Plugin triggers badge issuance on check-in
- See [EVENTS.md](./EVENTS.md)

### Commerce Plugin

- Commerce Plugin reads badges for discount application
- See [COMMERCE.md](./COMMERCE.md)

## Security Considerations

1. **Signature Verification**: Always verify Nostr signatures
2. **Issuer Trust**: Only accept badges from trusted issuers
3. **Replay Protection**: Badges are unique per recipient
4. **Revocation**: Support for badge revocation when needed

## Future Enhancements

- [ ] Badge trading marketplace
- [ ] Cross-community badge recognition
- [ ] Badge-gated content/channels
- [ ] Automated badge issuance rules
- [ ] Badge expiration notifications

---

## Status

| Component | Status |
|-----------|--------|
| Specification | 📋 Proposal |
| NIP-58 Integration | 📋 Proposal |
| Database Schema | 📋 Proposal |
| API Endpoints | 📋 Proposal |
| UI Components | 📋 Proposal |

---

*Proposed by [Claudio](https://github.com/claudiomolt) as a community contribution.*
