# Progress Report — Months 2–3

**Project:** LaWallet NWC  
**Period:** February 6 – April 5, 2026  
**Grant:** [OpenSats — Fifteenth Wave of Bitcoin Grants](https://opensats.org/blog/fifteenth-wave-of-bitcoin-grants)

---

## Summary

This report covers **all work completed since the last reported commit** [`fd2296b`](https://github.com/lawalletio/lawallet-nwc/commit/fd2296b), which closed out the Month 1 report.

During this reporting period, the project advanced from a hardened backend foundation into a much more complete product surface. Work focused on four major areas:

1. completing key infrastructure and CI/CD improvements,
2. migrating authentication from raw NIP-98 flows into a practical JWT session model,
3. implementing the new Figma-based admin/dashboard experience, and
4. evolving the public `lawallet.io` presence into a dedicated, separately maintained landing application.

In practical terms, this means LaWallet NWC is no longer only a backend-ready platform. It now includes a coherent operator-facing interface for managing users, cards, addresses, branding, and setup flows, while also establishing a clearer separation between the application itself and the public marketing/onboarding site.

This period also pulled meaningful work forward from later roadmap phases, especially around branding, white-label foundations, configurable UX, and the customizable landing direction.

**Main repository stats (`lawallet-nwc`):** 221 files changed, 11,043 insertions, 10,452 deletions — 58 commits across 4 merged PRs.  
**Landing repository (`lawallet-landing`):** created as a separate repository during this period and used to continue development of the public `lawallet.io` experience.

---

## What Was Delivered

### CI/CD & Quality Gates ([PR #183](https://github.com/lawalletio/lawallet-nwc/pull/183))

- Improved GitHub Actions pipeline with build integration
- Added security scanning in CI
- Configured coverage thresholds and cleaned up test exclusions
- Added Vercel configuration with framework detection and security headers

This closes an important part of the originally planned Month 2 work and improves the project’s deployment and verification posture.

### Authentication Flow Upgrade ([PR #184](https://github.com/lawalletio/lawallet-nwc/pull/184), [PR #185](https://github.com/lawalletio/lawallet-nwc/pull/185))

- Migrated authentication from direct NIP-98 request handling into a JWT session model
- Updated authentication documentation to reflect the new approach
- Aligned frontend login behavior with the JWT-based admin experience

This preserves Nostr-native authentication while making the application significantly more usable as an authenticated web product.

### Figma Implementation, Admin Dashboard Rebuild & Frontend Restructure

- Stripped down the previous frontend and rebuilt it around the new dashboard direction
- Mapped updated Figma screens into implementation tasks and shipped them into the product
- Restructured admin layout to match the new navigation model
- Added new Home, Users, Activity, Cards, and Settings experiences
- Implemented a full-page login flow
- Introduced responsive/mobile layout support
- Added a component preview environment to speed UI iteration
- Introduced shadcn/ui as the base component system for the new frontend

This is the first substantial operator-facing interface for the project and marks an important transition from infrastructure work to usable product delivery.

### Settings, Branding & White-Label Controls

- Added multi-tab Settings layout for Branding, Wallet, and Infrastructure
- Implemented a dynamic theme system with 8 presets
- Applied theme-aware styling across admin flows
- Added image uploads for logotype/isotype branding
- Wired border radius presets and additional branding controls into the application
- Added setup banner and domain configuration UX
- Established core groundwork for a customizable landing/app experience through branding, theming, and domain-oriented onboarding

These changes move forward part of the white-label and customization work that was originally scheduled for later phases.

### Onboarding & Domain Claim Flow

- Redesigned the onboarding wizard for domain setup
- Added community lookup from veintiuno.lat during onboarding
- Implemented debounced username availability checks
- Added claim flow behavior that redirects authenticated users into the dashboard
- Extracted a shared NostrConnect form for reuse across flows
- Improved unsaved-change handling with save/cancel/revert behavior in settings

This work materially improves first-time setup and reduces friction for operators configuring a deployment.

### New `lawallet.io` Landing, Customizable Landing Direction & Repository Split

- Substantially redesigned the public `lawallet.io` landing during this period
- Iterated on the landing first inside `lawallet-nwc`, then extracted it into the dedicated [`lawallet-landing`](https://github.com/lawalletio/lawallet-landing) repository
- Continued shipping the public experience in the separate landing repo, including waitlist UX and visual/interaction improvements
- Added OpenSats attribution/banner to the landing
- Aligned the landing design with the `lawallet.io` brand direction
- Shifted the product direction from a fixed marketing page toward a more customizable landing/app setup tied to branding and community/domain onboarding
- Updated `lawallet-nwc` so the root path redirects to the public landing while the product app remains centered on `/admin`

This separation creates a cleaner architecture: the product application and the public-facing site can now evolve independently, while also supporting the longer-term goal of customizable public deployments.

### Release v0.9.0

- Bumped the project version to `0.9.0`
- Published the changelog for the reporting period
- Documented the root redirect behavior via environment configuration
- Published the release to GitHub

---

## Pull Requests Merged (4)

| PR | Description |
|----|-------------|
| [#183](https://github.com/lawalletio/lawallet-nwc/pull/183) | CI/CD improvements, coverage thresholds, Vercel config |
| [#184](https://github.com/lawalletio/lawallet-nwc/pull/184) | NIP-98 → JWT session authentication |
| [#185](https://github.com/lawalletio/lawallet-nwc/pull/185) | Auth documentation updates |
| [#186](https://github.com/lawalletio/lawallet-nwc/pull/186) | Frontend/admin refactor, onboarding, settings, landing/app split |

---

## Roadmap Impact

The original roadmap positioned Month 2 around CI/CD, SDK, and React Hooks, and Month 3 around admin dashboard enhancement, frontend cleanup, and Nostr login.

During this period, the project completed the CI/CD portion and made substantial progress on the Month 3 admin/dashboard work. It also pulled forward parts of Month 4, particularly white-label customization, onboarding flows, domain configuration UX, and the broader customizable landing direction.

The most significant remaining items from the previously planned next steps are:

- TypeScript Client SDK packaging and endpoint coverage
- React Hooks package work
- Playwright E2E coverage
- User dashboard completion
- Courtesy NWC Proxy service

The key takeaway is that the project now has a stronger product surface earlier than originally planned.

---

## Next Quarter (Apr – Jun 2026)

The next phase should focus on consolidating the new product surface and completing the remaining platform work needed for production readiness:

- Finish the User Dashboard (profile, address management, NWC connection, preferences)
- Ship the Courtesy NWC Proxy service
- Add Playwright E2E coverage for critical onboarding and admin flows
- Advance LUD-16/21/22 compliance work, redirects, and webhook support
- Resume SDK and React Hooks work so external apps can consume the platform cleanly
- Continue deployment and documentation work for self-hosted and managed environments

See the full [ROADMAP](../ROADMAP.md) for the 6-month plan.

---

## Links

- **Repository:** [github.com/lawalletio/lawallet-nwc](https://github.com/lawalletio/lawallet-nwc)
- **Public landing:** [github.com/lawalletio/lawallet-landing](https://github.com/lawalletio/lawallet-landing)
- **Full changelog:** [v0.9.0.md](../changelogs/v0.9.0.md)
- **Roadmap:** [ROADMAP.md](../ROADMAP.md)
- **Architecture:** [ARCHITECTURE.md](../ARCHITECTURE.md)
