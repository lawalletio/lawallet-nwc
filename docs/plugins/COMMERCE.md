# Commerce Plugin

> ⚠️ **PROPOSAL - NOT IMPLEMENTED**
>
> This is a **proposed feature** for LaWallet. It is **not yet implemented** and is **not included in the current roadmap**. This document serves as a specification for potential future development.

---

## Overview

The Commerce Plugin creates a directory of Bitcoin-accepting merchants with badge-based loyalty rewards. Customers earn discounts based on their community badges, creating a circular economy that benefits both merchants and the community.

## Problem Statement

- Bitcoin merchants lack tools for customer loyalty
- Traditional loyalty programs don't work with Lightning
- There's no discovery mechanism for Bitcoin-friendly businesses
- Communities can't easily reward members at local businesses

## Proposed Solution

A merchant directory integrated with LaWallet that:

- Lists Bitcoin-accepting businesses
- Reads customer badges for automatic discounts
- Provides analytics for merchants
- Creates a circular Bitcoin economy

## Features

### Merchant Directory

```typescript
interface Merchant {
  id: string;                    // Unique identifier
  name: string;                  // Business name
  description: string;           // Business description
  category: MerchantCategory;    // restaurant, bar, retail, services, etc.
  location: {
    address: string;
    city: string;
    country: string;
    coordinates: [number, number];
  };
  contact: {
    phone?: string;
    email?: string;
    website?: string;
    nostr?: string;              // Nostr pubkey
  };
  paymentMethods: {
    lightning: boolean;
    onchain: boolean;
    lawalletPOS: boolean;        // Uses LaWallet POS
  };
  discountRules: DiscountRule[];
  operatingHours: OperatingHours[];
  images: string[];
  verified: boolean;             // Verified by community
  rating?: number;               // Community rating
}
```

### Discount Rules

```typescript
interface DiscountRule {
  id: string;
  merchantId: string;
  badgeTemplateId: string;       // Required badge
  badgeIssuerId?: string;        // Specific issuer or '*' for any
  discountType: 'percentage' | 'fixed' | 'cashback';
  discountValue: number;         // Percentage or sats
  maxDiscount?: number;          // Cap in sats
  minPurchase?: number;          // Minimum purchase in sats
  validFrom?: number;            // Start date
  validUntil?: number;           // End date
  usageLimit?: number;           // Per user
  description: string;           // "10% off for Gold members"
  active: boolean;
}
```

### Example Discount Rules

| Badge | Merchant | Discount | Description |
|-------|----------|----------|-------------|
| La Crypta Member | All Partners | 5% | Base member discount |
| Silver Tier | Cervecería Bitcoin | 10% | Loyal customer discount |
| Gold Tier | All Partners | 15% | VIP discount |
| Event Attendee | Event Sponsor | 20% | Same-day event discount |
| Contributor | Tech Store | 25% | Builder appreciation |

## Technical Specification

### Discount Application Flow

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│  Customer   │────▶│  Merchant    │────▶│   Read      │
│  (LaWallet) │     │    POS       │     │   Badges    │
└─────────────┘     └──────────────┘     └──────┬──────┘
                                                │
     ┌──────────────────────────────────────────┘
     │
     ▼
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│   Match     │────▶│   Calculate  │────▶│   Apply     │
│   Rules     │     │   Discount   │     │   Payment   │
└─────────────┘     └──────────────┘     └─────────────┘
```

### API Endpoints (Proposed)

```
# Merchants
POST   /api/plugins/commerce/merchants         # Register merchant
GET    /api/plugins/commerce/merchants         # List merchants
GET    /api/plugins/commerce/merchants/:id     # Get merchant
PUT    /api/plugins/commerce/merchants/:id     # Update merchant
DELETE /api/plugins/commerce/merchants/:id     # Remove merchant

# Search & Discovery
GET    /api/plugins/commerce/search            # Search merchants
GET    /api/plugins/commerce/nearby            # Nearby merchants
GET    /api/plugins/commerce/category/:cat     # By category

# Discount Rules
POST   /api/plugins/commerce/rules             # Create rule
GET    /api/plugins/commerce/rules/:merchantId # Get merchant rules
PUT    /api/plugins/commerce/rules/:id         # Update rule
DELETE /api/plugins/commerce/rules/:id         # Delete rule

# Discount Calculation
POST   /api/plugins/commerce/calculate         # Calculate discount
POST   /api/plugins/commerce/apply             # Apply and record

# Analytics
GET    /api/plugins/commerce/analytics/:merchantId # Merchant stats
```

### Calculate Discount Request

```typescript
interface CalculateDiscountRequest {
  merchantId: string;
  customerPubkey: string;
  amount: number;               // Purchase amount in sats
  badges?: string[];            // Pre-fetched badges (optional)
}

interface CalculateDiscountResponse {
  originalAmount: number;
  discountAmount: number;
  finalAmount: number;
  appliedRules: AppliedRule[];
  badges: BadgeSummary[];
}

interface AppliedRule {
  ruleId: string;
  badgeName: string;
  discountType: string;
  discountValue: number;
  description: string;
}
```

### Database Schema (Proposed)

```sql
CREATE TABLE merchants (
  id UUID PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  category VARCHAR(100),
  address VARCHAR(500),
  city VARCHAR(100),
  country VARCHAR(100),
  latitude DECIMAL(10, 8),
  longitude DECIMAL(11, 8),
  phone VARCHAR(50),
  email VARCHAR(255),
  website VARCHAR(500),
  nostr_pubkey VARCHAR(64),
  accepts_lightning BOOLEAN DEFAULT TRUE,
  accepts_onchain BOOLEAN DEFAULT FALSE,
  uses_lawallet_pos BOOLEAN DEFAULT FALSE,
  verified BOOLEAN DEFAULT FALSE,
  verified_at TIMESTAMP,
  verified_by VARCHAR(64),
  rating DECIMAL(2, 1),
  rating_count INTEGER DEFAULT 0,
  images JSONB,
  operating_hours JSONB,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE discount_rules (
  id UUID PRIMARY KEY,
  merchant_id UUID REFERENCES merchants(id),
  badge_template_id UUID REFERENCES badge_templates(id),
  badge_issuer_pubkey VARCHAR(64),        -- NULL = any issuer
  discount_type VARCHAR(20) NOT NULL,     -- percentage, fixed, cashback
  discount_value DECIMAL(10, 2) NOT NULL,
  max_discount_sats INTEGER,
  min_purchase_sats INTEGER,
  valid_from TIMESTAMP,
  valid_until TIMESTAMP,
  usage_limit INTEGER,
  description VARCHAR(500),
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE discount_usage (
  id UUID PRIMARY KEY,
  rule_id UUID REFERENCES discount_rules(id),
  merchant_id UUID REFERENCES merchants(id),
  customer_pubkey VARCHAR(64) NOT NULL,
  original_amount INTEGER NOT NULL,
  discount_amount INTEGER NOT NULL,
  final_amount INTEGER NOT NULL,
  payment_hash VARCHAR(64),
  applied_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_merchants_location ON merchants(latitude, longitude);
CREATE INDEX idx_merchants_category ON merchants(category);
CREATE INDEX idx_rules_merchant ON discount_rules(merchant_id);
CREATE INDEX idx_usage_customer ON discount_usage(customer_pubkey);
```

## UI Components (Proposed)

### For Customers

- **Merchant Map**: Discover nearby Bitcoin merchants
- **Merchant List**: Filter by category, discount available
- **Merchant Profile**: Details, hours, discounts, reviews
- **My Discounts**: Which badges unlock which discounts
- **Transaction History**: Past purchases with discounts applied

### For Merchants

- **Dashboard**: Overview of transactions, discounts given
- **Rule Manager**: Create and manage discount rules
- **Customer Insights**: Anonymous badge statistics
- **POS Integration**: Discount calculation at checkout
- **Verification Request**: Apply for verified status

### For Community Admins

- **Merchant Approval**: Review and verify merchants
- **Partnership Dashboard**: Track merchant network growth
- **Analytics**: Community-wide discount economics

## Merchant Categories

| Category | Icon | Examples |
|----------|------|----------|
| `restaurant` | 🍽️ | Restaurants, cafes |
| `bar` | 🍺 | Bars, pubs |
| `retail` | 🛍️ | Shops, stores |
| `services` | 🔧 | Professional services |
| `tech` | 💻 | Tech stores, repairs |
| `entertainment` | 🎮 | Gaming, events |
| `health` | ⚕️ | Health, wellness |
| `education` | 📚 | Courses, workshops |
| `travel` | ✈️ | Hotels, tourism |
| `other` | 📦 | Miscellaneous |

## Integration with Other Plugins

### Events Plugin

- Events can have sponsor merchants
- Same-day event discounts at sponsors
- See [EVENTS.md](./EVENTS.md)

### Badges Plugin

- Discount rules reference badge templates
- Badge verification during checkout
- See [BADGES.md](./BADGES.md)

## Security Considerations

1. **Badge Verification**: Cryptographically verify badge ownership
2. **Rate Limiting**: Prevent discount abuse
3. **Merchant Verification**: Only verified merchants in directory
4. **Privacy**: Don't expose customer purchase history

## Future Enhancements

- [ ] Merchant reviews and ratings
- [ ] Loyalty points (sats) accumulation
- [ ] Cross-merchant promotions
- [ ] Referral rewards
- [ ] Merchant analytics API
- [ ] Integration with delivery apps

---

## Status

| Component | Status |
|-----------|--------|
| Specification | 📋 Proposal |
| Database Schema | 📋 Proposal |
| API Endpoints | 📋 Proposal |
| UI Components | 📋 Proposal |
| POS Integration | 📋 Proposal |

---

*Proposed by [Claudio](https://github.com/claudiomolt) as a community contribution.*
