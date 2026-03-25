# Figma Dashboard → React Screen Mapping

> **Figma File:** LaWallet v2.2 Master (`jcjT53BBQ4wx94XwpbEZXl`)
> **Figma Canvas:** Dashboard (node `135:3734`)
> **Component Reference:** See `docs/figma-component-mapping.md` for design tokens and component inventory

---

## Screen Inventory

### Desktop Screens (1440x1024)

| # | Screen | Figma Node | Route | Components Used | Data Hooks |
|---|--------|-----------|-------|-----------------|------------|
| 1 | Home | `3233:18549` | `/admin` | Sidebar, Topbar, StatCard x3, Table x2, Badge | `useAddressCounts`, `useRecentOnboarding`, `useRecentTransactions`, `useSystemStatus` |
| 2 | Users | `3233:18708` | `/admin/users` | Sidebar, Topbar, StatCard x4, Input (search), Table, Pagination, Badge, DropdownMenu | `useUsers`, `useUserCounts` |
| 3 | Users / Invite Modal | `3233:18798` | Dialog on `/admin/users` | Dialog, Input, Button | `useInviteUser` (placeholder) |
| 4 | Users / Invite Success | `3233:18912` | Dialog on `/admin/users` | Dialog, Button | — |
| 5 | Cards | `3233:19024` | `/admin/cards` | Sidebar, Topbar (alert), StatCard x3, Input (search), Select (filter), Table, Pagination, Tabs, Badge, DropdownMenu, Card (design gallery) | `useCards`, `useCardCounts`, `useDesigns`, `useSettings` |
| 6 | Cards / Archived | `3233:19131` | `/admin/cards` (Archived tab) | Same as Cards + Restore/Delete buttons on designs | `useDesigns` (archived filter) |
| 7 | Cards / Create Step 1 | `3233:19239` | Dialog on `/admin/cards` | Dialog, Accordion/Collapsible, Button | — |
| 8 | Cards / Create Step 1 Open | `3233:19419` | Dialog on `/admin/cards` | Dialog, Accordion (open), Button | — |
| 9 | Cards / Create Step 2 | `3233:19599` | Dialog on `/admin/cards` | Dialog, QR code, Button | — |
| 10 | Cards / Upload Design | `3233:19761` | Dialog on `/admin/cards` | Dialog, Input, drag-drop area, Button | `useDesignMutations` |
| 11 | Cards / Upload with Image | `3233:19919` | Dialog on `/admin/cards` | Dialog, Input, image preview, Button | `useDesignMutations` |
| 12 | Activity | `3233:20073` | `/admin/activity` | Sidebar, Topbar, Input (search), Select x2 (filters), Table, Pagination, Badge (colored) | `useActivity` (placeholder) |
| 13 | Settings / Branding | `3233:20241` | `/admin/settings` (Branding tab) | Sidebar (sub-items), Topbar (tabs), InputGroup, Input, ButtonGroup (Rounded), RadioGroup (Theme), Button | `useSettings`, `useUpdateSettings` |
| 14 | Settings / Wallet | `3233:20145` | `/admin/settings` (Wallet tab) | Sidebar (sub-items), Topbar (tabs), Switch x6, InputGroup, Button | `useSettings`, `useUpdateSettings` |
| 15 | Settings / Infrastructure | `3233:20201` | `/admin/settings` (Infrastructure tab) | Sidebar (sub-items), Topbar (tabs), InputGroup (dynamic list), Input, Button | `useSettings`, `useUpdateSettings` |
| 16 | Login | `3233:20338` | `/admin` (unauthenticated) | Tabs, Input, Button, Separator | `useAuth` |
| 17 | Login / Domain (Onboarding) | `3233:20366` | Post-login onboarding | InputGroup, Button | `useUpdateSettings` |
| 18 | Login / Domain Advance | `3233:20395` | Post-login onboarding | InputGroup, Collapsible, Button | `useUpdateSettings` |
| 19 | Login / Confirm | `3233:20424` | Post-login onboarding | Button | — |

### Mobile Screens (390x844)

| # | Screen | Figma Node | Route | Notes |
|---|--------|-----------|-------|-------|
| 1 | Mobile - Home | `3218:8147` | `/admin` | TopbarMobile + horizontal scroll stat cards + bottom tab bar |
| 2 | Mobile - Users | `3218:8934` | `/admin/users` | TopbarMobile + search + table |
| 3 | Mobile - Users (variants) | `3225:9793`, `3225:9998` | `/admin/users` | Modal states |
| 4 | Mobile - Activity | `3225:14402` | `/admin/activity` | TopbarMobile + filters + table |
| 5 | Mobile - Cards | `3225:10215` | `/admin/cards` | TopbarMobile + cards + designs |
| 6 | Mobile - Cards (variants) | `3225:12319`, `3225:12662`, `3225:13218`, `3225:13599`, `3225:13907` | `/admin/cards` | Create/upload flows |
| 7 | Mobile - Settings | `3225:15315`, `3225:15671`, `3225:16020` | `/admin/settings` | 3 tab variants |
| 8 | Mobile - Login | `3194:7435`, `3218:7729`, `3218:7867`, `3218:8011` | `/admin` | Login + onboarding steps |
| 9 | Mobile - Template | `3031:7270` | — | Base mobile template |

---

## Navigation Structure

### Sidebar (Desktop)

```
┌─────────────────────┐
│  [logo]             │
├─────────────────────┤
│  Platform           │
│  ● Home       /admin│
│  ● Users      /admin/users
│  ● Cards      /admin/cards
├─────────────────────┤
│  System             │
│  ● Activity   /admin/activity
│  ● Settings   /admin/settings
│    ├─ Wallet        │
│    ├─ Branding      │
│    └─ Infrastructure│
├─────────────────────┤
│  ⓘ Get Help         │
├─────────────────────┤
│  👤 npub...k29s     │
│     Extension    ⋮  │
├─────────────────────┤
│  ┌─────────────────┐│
│  │ Setup Domain    ││  ← conditional
│  │ Configure now → ││
│  └─────────────────┘│
└─────────────────────┘
```

### Bottom Tab Bar (Mobile)

```
┌──────┬──────┬──────┬──────┬──────┐
│ Home │Users │Cards │ Act. │ Set. │
│  ⊞   │  👥  │  💳  │  📋  │  ⚙️  │
└──────┴──────┴──────┴──────┴──────┘
```

---

## Screen Details

### 1. Home (`/admin`)

**Figma:** `3233:18549` | **Mobile:** `3218:8147`

**Layout:**
```
┌─ Topbar ──────────────────────────────────────────┐
│  Home                                              │
│  Lorem dolor sit amet.                             │
└────────────────────────────────────────────────────┘

┌─ Stat Cards (grid-cols-3) ─────────────────────────┐
│ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ │
│ │ Total users  │ │ Volume  [Est]│ │ System [Stab]│ │
│ │ 5,000        │ │ 100,000 SATs │ │ No critical  │ │
│ │ Lorem...     │ │ Economic...  │ │ Last inc...  │ │
│ └──────────────┘ └──────────────┘ └──────────────┘ │
└────────────────────────────────────────────────────┘

┌─ Tables (grid-cols-2) ────────────────────────────┐
│ ┌─ Recent Onboarding ──┐ ┌─ Recent Transactions ─┐│
│ │ Identity    Method   │ │ Source Identity Method $││
│ │ npub..k29s  [Web]    │ │ 🖥 App npub..  [Out] 21k││
│ │ alice@..    [Card]   │ │ 💳 Card alice  [In] 2.1k││
│ │ bob@..      [Card]   │ │ @ Addr bob@..  [In]  21 ││
│ │ npub..t00a  [Web]    │ │ 🖥 App npub..  [Out] 21k││
│ └──────────────────────┘ └────────────────────────┘│
└────────────────────────────────────────────────────┘
```

**Components:** `Topbar`, `StatCard` x3 (with `Badge`, `unit`), `Table` x2, `Badge` (Web/Card/Inbound/Outbound)

**Stat Card variants:**
- Total users: `title="Total users" value="5,000" description="Lorem dolor sit amet."`
- Volume: `title="Volume" value="100,000" unit="SATs" badge={{label:"Estimated"}} description="Economic demand signal..."`
- System: `title="System" value="No critical errors." badge={{label:"Stable"}} description="Last incident: Relay Timeout (4d ago)"`

---

### 2. Users (`/admin/users`)

**Figma:** `3233:18708` | **Mobile:** `3218:8934`

**Layout:**
```
┌─ Topbar ──────────────────────────────────────────┐
│  Users                              [Invite user] │
└────────────────────────────────────────────────────┘

┌─ Stat Cards (grid-cols-4) ─────────────────────────┐
│ ┌────────────┐┌────────────┐┌────────────┐┌──────┐ │
│ │Total users ││ Redirect   ││ NWC Hosted ││ NWC  │ │
│ │5,000/4,500 ││ 1,500      ││ 1,500      ││Config│ │
│ │Total num...││ LA conf... ││ Users op...││1,000 │ │
│ └────────────┘└────────────┘└────────────┘└──────┘ │
└────────────────────────────────────────────────────┘

┌─ Lightning Address ───────────────────────────────┐
│ [🔍 Search addresses...]                           │
│ ┌─ Table ────────────────────────────────────────┐ │
│ │ Identity          │ Pubkey          │ Last used │ │
│ │ alice@domain.com  │ 00000..00000    │ Never     │ │
│ │ dd/mm/yyyy        │                 │           │ │
│ │ bob@domain.com    │ 00000..00000    │ dd/mm/yyyy│ │
│ └────────────────────────────────────────────────┘ │
│ ← Previous  1  [2]  3  ...  Next →                │
└────────────────────────────────────────────────────┘
```

**Components:** `Topbar`, `StatCard` x4, `Input` (search with `Search` icon), `Table`, `Pagination`, `DropdownMenu` (row actions), `Button` ("Invite user")

---

### 3. Users / Invite Modal

**Figma:** `3233:18798` | **Success:** `3233:18912`

**Dialog:** "Generate an invitation" — icon + title + description + Input (email/npub/NIP-05 placeholder) + Cancel/Send buttons

---

### 4. Cards (`/admin/cards`)

**Figma:** `3233:19024` | **Mobile:** `3225:10215`

**Layout (single scrollable page, 2 sections):**

```
┌─ Topbar ──────────────────────────────────────────┐
│ ⚠ Configure your domain  [...] [Configure now]    │  ← alert bar (conditional)
│  Cards                          [Create new card]  │
└────────────────────────────────────────────────────┘

┌─ SECTION 1: Cards ────────────────────────────────┐
│ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ │
│ │ Total cards  │ │ Paired cards │ │ Paused cards │ │
│ │ 5,000        │ │ 2,500        │ │ 2,500        │ │
│ │ Cards writ...│ │ Activated... │ │ Cards temp...│ │
│ └──────────────┘ └──────────────┘ └──────────────┘ │
│                                                    │
│ [🔍 Search cards...]              [All designs ▾]  │
│ ┌─ Table ────────────────────────────────────────┐ │
│ │ Card           │ Identity        │ Last used    │ │
│ │ [img] Paired   │ alice@domain    │ Never      ⋮ │ │
│ │       dd/mm    │                 │              │ │
│ │ [img] Paired   │ npub...k29s    │ dd/mm/yyyy ⋮ │ │
│ └────────────────────────────────────────────────┘ │
│ ← Previous  1  [2]  3  ...  Next →                │
└────────────────────────────────────────────────────┘

┌─ SECTION 2: Designs ─────────────────────────────┐
│ Designs                      [↻ Sync] [↑ Upload] │
│ Manage your card design templates and artwork     │
│                                                   │
│ [Active] [Archived]                               │
│ ┌────────────────────┐ ┌────────────────────┐     │
│ │ Design long name   │ │ Design long name   │     │
│ │ dd/mm/yyyy [Archiv]│ │ dd/mm/yyyy [Archiv]│     │
│ │ ┌────────────────┐ │ │ ┌────────────────┐ │     │
│ │ │   [card image] │ │ │ │   [card image] │ │     │
│ │ └────────────────┘ │ │ └────────────────┘ │     │
│ └────────────────────┘ └────────────────────┘     │
└───────────────────────────────────────────────────┘
```

**Components:** `Topbar` (with alert), `StatCard` x3, `Input` (search), `Select` (filter), `Table`, `Pagination`, `Tabs` (Active/Archived), `Card` (design gallery), `Badge`, `DropdownMenu`, `Button`

**Alert bar props:** `alert={{ title: "Configure your domain", message: "This action is required to use this function", action: "Configure now", onAction: () => router.push('/admin/settings') }}`

---

### 5. Cards / Create New Card (2-step wizard)

**Step 1:** `3233:19239` — "Download and install APP" with download link + collapsible "Open from a mobile device"
**Step 1 Open:** `3233:19419` — Accordion expanded
**Step 2:** `3233:19599` — "Login access" with QR code display for admin auth

**Components:** `Dialog`, `Collapsible`/`Accordion`, `Button`, progress indicator (Step 1/Step 2 labels with divider line)

---

### 6. Cards / Upload Design

**Figma:** `3233:19761` (empty) | `3233:19919` (with image)

**Dialog:** "Upload design" — Name input + drag-and-drop area (dashed border, cloud icon, "JPG, PNG or WebP. Max size 2mb") + Upload button inside area + Cancel/Upload footer buttons

---

### 7. Activity (`/admin/activity`)

**Figma:** `3233:20073` | **Mobile:** `3225:14402`

**Layout:**
```
┌─ Topbar ──────────────────────────────────────────┐
│  Activity                                          │
└────────────────────────────────────────────────────┘

│ Logs                                               │
│ Monitor system events, user activity...            │

│ [🔍 Search...]    [All category ▾]  [All status ▾] │

│ ┌─ Table ────────────────────────────────────────┐ │
│ │▎Time            │ Category  │ Message           │ │
│ │▎Jan 09 hh:mm:ss│ [USER]    │ Lorem ipsum...    │ │  ← red left border
│ │▎Jan 09 hh:mm:ss│ [ADDRESS] │ Lorem ipsum...    │ │
│ │▎Jan 09 hh:mm:ss│ [NWC]     │ Lorem ipsum...    │ │
│ │▎Jan 09 hh:mm:ss│ [INVOICE] │ Lorem ipsum...    │ │
│ │▎Jan 09 hh:mm:ss│ [CARD]    │ Lorem ipsum...    │ │
│ │▎Jan 09 hh:mm:ss│ [SERVER]  │ Lorem ipsum...    │ │
│ └────────────────────────────────────────────────┘ │
│ ← Previous  1  [2]  3  ...  Next →                │
```

**Category Badge Colors:**
| Category | Color |
|----------|-------|
| USER | red-500 |
| ADDRESS | green-500 |
| NWC | yellow-500 |
| INVOICE | yellow-500 |
| CARD | red-500 |
| SERVER | red-500 |

**Components:** `Topbar`, `Input` (search), `Select` x2, `Table` (with colored left border), `Badge` (colored), `Pagination`

---

### 8. Settings (`/admin/settings`)

**Figma:** Branding `3233:20241` | Wallet `3233:20145` | Infrastructure `3233:20201`

**Navigation:** Topbar tabs (Branding / Wallet / Infrastructure) + Sidebar sub-items

**Topbar:** `title="Settings"` with `actions={<><Button variant="secondary">Cancel</Button><Button>Save Changes</Button></>}` and `tabs=[{label:"Branding"},{label:"Wallet"},{label:"Infrastructure"}]`

#### Branding Tab (`3233:20241`)
```
Customization                          │ Logotype: [upload] + [delete]
Define your community's visual         │ Isotype: [upload] + [delete]
identity including name, logo,         │ Community Name: [input]
accent color, and interface style.     │ Short Name: [input]
                                       │ Rounded: [None|Small|Medium|Full]
                                       │ Theme: [● ● ● ● ● ● ● ● ●] color circles
───────────────────────────────────────┤
Social Media                           │ WhatsApp: [wa.me/] [input]
Configure public contact information   │ Telegram: [t.me/] [input]
and social links.                      │ Discord: [discord.gg/] [input]
                                       │ X/Twitter: [twitter.com/] [input]
                                       │ Website: [https://] [input]
                                       │ Nostr: [npub...] [input]
                                       │ Email: [input]
```

**Components:** `InputGroup` + `InputGroupText`, `ButtonGroup` (rounded selector), custom color picker (circle radio buttons), file upload with preview, `Button`

#### Wallet Tab (`3233:20145`)
```
Digital Wallet                         │ Enabled Mode [toggle]
Manage wallet-related configurations   │ Activate or deactivate the hosted
                                       │ wallet functionality.
───────────────────────────────────────┤
Maintenance                            │ General Maintenance [toggle]
Temporarily restrict wallet            │ Temporarily restrict wallet activity
functionality during upgrades          │ during upgrades, infrastructure
                                       │ adjustments, or emergency situations.
───────────────────────────────────────┤
Control management                     │ Disable Transfers [toggle]
                                       │ Disable Registers [toggle]
                                       │ Disable Address [toggle]
───────────────────────────────────────┤
Lightning Address                      │ Enabled Mode [toggle]
Configure how Lightning Addresses      │
are issued, redirected, or monetized.  │ Price: [$] [0.00]
```

**Components:** `Switch` x6, `InputGroup` ($ prefix), `Label`, description text

#### Infrastructure Tab (`3233:20201`)
```
Nostr                                  │ Relays:
Manage relay connectivity and          │ [wss://] [relay.domain.com]
monitor NWC integrations.              │ [wss://] [relay.domain.com] [-]
                                       │ [wss://] [relay.domain.com] [+]
───────────────────────────────────────┤
Blossom Media Server                   │ URL Direction:
Configure your media server endpoint   │ [https://] [cdn.domain.com]
───────────────────────────────────────┤
SMTP / AWS SES                         │ Host: [https://] [smtp.aws.com]
Set up email delivery services.        │ PORT: [eg. 3001]
                                       │ Username: [you-username]
                                       │ Password: [Password / API Key]
```

**Components:** `InputGroup` (wss://, https:// prefixes), `Input`, `Button` (add/remove relay), dynamic list

---

### 9. Login (Full Page)

**Figma:** `3233:20338` | **Mobile:** `3194:7435`

**Layout (no sidebar — full page centered):**
```
              [logo]
           Admin login
    Access your community control panel.

    [Private key]  [Bunker]          ← Tabs

    ┌────────────────────────────┐
    │  nsec...                   │   ← Input
    └────────────────────────────┘
    ┌────────────────────────────┐
    │         Login              │   ← Button (primary)
    └────────────────────────────┘

    ─────── OR CONTINUE WITH ───────

    ┌────────────────────────────┐
    │  🧩  With extension        │   ← Button (outline/gradient)
    └────────────────────────────┘
```

**Components:** `Tabs` (Private key / Bunker), `Input`, `Button` (primary + outline), `Separator`

**Key difference from current:** Extension is NOT a tab — it's a separate button below the "OR CONTINUE WITH" separator.

---

### 10. Onboarding (Post-Login Domain Setup)

**Figma:** `3233:20366` → `3233:20395` → `3233:20424`

Full-page flow (no sidebar) shown after first login when domain is not configured:
1. **Step 1:** Illustration + "Onboarding" title + description + Domain input (`InputGroup` with `https://` prefix) + "Verify" button
2. **Step 2:** Advanced options (expandable) with additional configuration
3. **Step 3:** Confirmation

---

## Component Reuse Map

| Figma Pattern | shadcn Component | File | Notes |
|---|---|---|---|
| Stat cards (no icon) | Custom `StatCard` | `components/admin/stat-card.tsx` | Redesigned: title + value + description + optional Badge + unit |
| Search input with icon | `InputGroup` + `Input` | `components/ui/input-group.tsx` | Search icon prefix |
| Data tables | `Table` | `components/ui/table.tsx` | Plain shadcn Table (no @tanstack/react-table) |
| Table pagination | `Pagination` wrapper | `components/admin/data-table-pagination.tsx` | Wraps `components/ui/pagination.tsx` |
| Filter dropdowns | `Select` | `components/ui/select.tsx` | Category/status/design filters |
| Row action menus | `DropdownMenu` | `components/ui/dropdown-menu.tsx` | MoreHorizontal trigger |
| Category badges | `Badge` with color classes | `components/ui/badge.tsx` | Custom className for colors |
| Toggle settings | `Switch` + `Label` | `components/ui/switch.tsx` | With description text |
| Prefix inputs | `InputGroup` + `InputGroupText` | `components/ui/input-group.tsx` | wss://, https://, $, wa.me/ etc. |
| Rounded selector | `ButtonGroup` | `components/ui/button-group.tsx` | None/Small/Medium/Full |
| Alert bar | `Topbar` alert prop | `components/ui/topbar.tsx` | Destructive background |
| Tab navigation | `Topbar` tabs prop | `components/ui/topbar.tsx` | Settings page tabs |
| Settings sub-items | `SidebarMenuSub` | `components/ui/sidebar.tsx` | Collapsible sub-navigation |
| Dialogs/modals | `Dialog` | `components/ui/dialog.tsx` | Create card, upload design, invite user |
| Mobile nav | Custom `MobileTabBar` | `components/admin/mobile-tab-bar.tsx` | 5-icon bottom bar |
| Login form | `Tabs` + `Input` + `Button` + `Separator` | various | Full-page layout |

---

## File → Route Map

| Route | Page File | Layout |
|---|---|---|
| `/admin` | `app/admin/page.tsx` | Sidebar + Topbar |
| `/admin/users` | `app/admin/users/page.tsx` | Sidebar + Topbar |
| `/admin/cards` | `app/admin/cards/page.tsx` | Sidebar + Topbar (with alert) |
| `/admin/cards/[id]` | `app/admin/cards/[id]/page.tsx` | Sidebar + Topbar (subpage) |
| `/admin/activity` | `app/admin/activity/page.tsx` | Sidebar + Topbar |
| `/admin/settings` | `app/admin/settings/page.tsx` | Sidebar (sub-items) + Topbar (tabs) |
| `/admin` (unauth) | `components/admin/login-page.tsx` | Full page (no sidebar) |
| Post-login onboarding | `components/admin/onboarding-page.tsx` | Full page (no sidebar) |
