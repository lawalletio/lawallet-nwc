# Events Plugin

> ⚠️ **PROPOSAL - NOT IMPLEMENTED**
>
> This is a **proposed feature** for LaWallet. It is **not yet implemented** and is **not included in the current roadmap**. This document serves as a specification for potential future development.

---

## Overview

The Events Plugin enables communities to create, manage, and track attendance at Bitcoin/Lightning events directly within LaWallet. Attendees check in and automatically receive verifiable Nostr badges.

## Problem Statement

Bitcoin communities organize frequent meetups, workshops, and conferences. Currently:

- Attendance tracking is manual or non-existent
- There's no verifiable proof of attendance
- Event discovery is fragmented across platforms
- Community engagement metrics are hard to measure

## Proposed Solution

A plugin that integrates event management with LaWallet's existing identity (Nostr) and payment (Lightning) infrastructure.

## Features

### Event Management

```typescript
interface Event {
  id: string;                    // Unique identifier
  title: string;                 // Event name
  description: string;           // Event details
  location: {
    name: string;                // Venue name
    address?: string;            // Physical address
    coordinates?: [number, number]; // Lat/lng for map
  };
  startTime: number;             // Unix timestamp
  endTime: number;               // Unix timestamp
  organizer: string;             // Nostr pubkey
  capacity?: number;             // Max attendees
  badge?: BadgeTemplate;         // Badge to issue on check-in
  price?: {
    amount: number;              // In sats
    paymentRequired: boolean;    // Pay before or at check-in
  };
}
```

### Check-in Methods

1. **QR Code**: Attendee scans event QR with LaWallet
2. **NFC Tag**: Tap NFC tag at venue (uses LaWallet card infrastructure)
3. **Geolocation**: Verify attendee is at venue (optional)

### Badge Issuance

On successful check-in:
1. Verify attendee identity (Nostr pubkey from LaWallet)
2. Verify event is active (within time window)
3. Issue badge to attendee's pubkey (see [BADGES.md](./BADGES.md))
4. Publish badge event to Nostr relays

## Technical Specification

### Nostr Event Kinds

| Kind | Purpose | Reference |
|------|---------|-----------|
| 31923 | Calendar Event | [NIP-52](https://github.com/nostr-protocol/nips/blob/master/52.md) |
| 31924 | Calendar Event RSVP | NIP-52 |
| 30009 | Badge Definition | [NIP-58](https://github.com/nostr-protocol/nips/blob/master/58.md) |
| 8 | Badge Award | NIP-58 |

### API Endpoints (Proposed)

```
POST   /api/plugins/events              # Create event
GET    /api/plugins/events              # List events
GET    /api/plugins/events/:id          # Get event details
PUT    /api/plugins/events/:id          # Update event
DELETE /api/plugins/events/:id          # Delete event
POST   /api/plugins/events/:id/checkin  # Check in attendee
GET    /api/plugins/events/:id/attendees # List attendees
```

### Check-in Flow

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│   Attendee  │────▶│  QR/NFC Scan │────▶│  Validate   │
│  (LaWallet) │     │              │     │  Identity   │
└─────────────┘     └──────────────┘     └──────┬──────┘
                                                │
                    ┌──────────────┐     ┌──────▼──────┐
                    │ Badge Issued │◀────│   Check-in  │
                    │  (Nostr)     │     │  Recorded   │
                    └──────────────┘     └─────────────┘
```

### Database Schema (Proposed)

```sql
CREATE TABLE events (
  id UUID PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  location_name VARCHAR(255),
  location_address VARCHAR(500),
  location_lat DECIMAL(10, 8),
  location_lng DECIMAL(11, 8),
  start_time TIMESTAMP NOT NULL,
  end_time TIMESTAMP NOT NULL,
  organizer_pubkey VARCHAR(64) NOT NULL,
  capacity INTEGER,
  badge_template_id UUID REFERENCES badge_templates(id),
  price_sats INTEGER,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE event_checkins (
  id UUID PRIMARY KEY,
  event_id UUID REFERENCES events(id),
  attendee_pubkey VARCHAR(64) NOT NULL,
  checked_in_at TIMESTAMP DEFAULT NOW(),
  method VARCHAR(20), -- 'qr', 'nfc', 'geo'
  badge_event_id VARCHAR(64), -- Nostr event ID of issued badge
  UNIQUE(event_id, attendee_pubkey)
);
```

## UI Components (Proposed)

### For Organizers

- **Event Creation Form**: Title, description, location, time, badge template
- **Event Dashboard**: Attendee list, check-in stats, real-time updates
- **QR Generator**: Generate printable check-in QR codes

### For Attendees

- **Event Discovery**: Map/list of upcoming events
- **Event Details**: Info, location, RSVP
- **Check-in Scanner**: Camera for QR, NFC reader integration
- **Badge Gallery**: View earned badges

## Integration with Other Plugins

### Badges Plugin

- Events Plugin uses Badges Plugin to issue attendance badges
- Badge templates are managed in Badges Plugin
- See [BADGES.md](./BADGES.md)

### Commerce Plugin

- Event attendance badges can unlock merchant discounts
- See [COMMERCE.md](./COMMERCE.md)

## Security Considerations

1. **Spam Prevention**: Rate limit event creation, require organizer verification
2. **Check-in Fraud**: Geolocation verification, time windows, one check-in per event
3. **Privacy**: Attendance data is opt-in, badges can be private or public

## Future Enhancements

- [ ] Ticketing with Lightning payments
- [ ] Recurring events
- [ ] Event series (conferences with multiple sessions)
- [ ] Nostr-native event announcements
- [ ] Integration with calendar apps

---

## Status

| Component | Status |
|-----------|--------|
| Specification | 📋 Proposal |
| Database Schema | 📋 Proposal |
| API Endpoints | 📋 Proposal |
| UI Components | 📋 Proposal |
| Integration | 📋 Proposal |

---

*Proposed by [Claudio](https://github.com/claudiomolt) as a community contribution.*
