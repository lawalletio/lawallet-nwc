# Progress Report — Months 2–3

**Project:** LaWallet NWC  
**Period:** February 6 – April 5, 2026  
**Grant:** [OpenSats — Fifteenth Wave of Bitcoin Grants](https://opensats.org/blog/fifteenth-wave-of-bitcoin-grants)

---

## Summary

This reporting period focused on shipping the first full product-facing version of LaWallet NWC. We moved from a hardened backend foundation into a working admin experience, JWT session auth based on NIP-98, frontend restructuring, onboarding/domain configuration flows, white-label theme controls, and a dedicated public landing split.

A major outcome of this period is that the project is no longer only "backend-ready" — it now has a coherent operator experience for managing users, cards, addresses, branding, and setup flows. We also completed CI/CD work that was originally planned for Month 2 and delivered a significant amount of Month 3 and Month 4 frontend/admin work ahead of the original roadmap.

**Stats:** 221 files changed, 11,043 insertions, 10,452 deletions — 58 commits across 4 merged PRs.

---

## What Was Delivered

### CI/CD & Quality Gates ([PR #183](https://github.com/lawalletio/lawallet-nwc/pull/183))

- GitHub Actions pipeline improvements with build job integration
- Security scanning added to CI
- Coverage thresholds configured and test exclusions cleaned up
- Vercel configuration added with framework detection and security headers

This closes key Month 2 delivery work and makes the project easier to validate and deploy continuously.

### Authentication Flow Upgrade ([PR #184](https://github.com/lawalletio/lawallet-nwc/pull/184), [PR #185](https://github.com/lawalletio/lawallet-nwc/pull/185))

- NIP-98 authentication flow converted into JWT session auth
- Auth documentation updated to reflect the new session model
- Frontend login behavior updated around the JWT-based admin experience

This provides a more practical app session model while preserving Nostr-native authentication at the edge.

### Admin Dashboard Rebuild & Frontend Restructure

- Frontend stripped down and rebuilt against the new dashboard direction
- Admin layout restructured to match the updated Figma navigation
- New Home, Users, Activity, Cards, and Settings experiences added
- Full-page login implemented
- Responsive mobile layout introduced
- Component preview environment added to speed UI iteration
- shadcn/ui component library introduced for the new frontend system

This is the first substantial operator-facing interface for the project and represents a major step from prototype infrastructure to usable product.

### Settings, Branding & White-Label Controls

- Multi-tab Settings layout for Branding, Wallet, and Infrastructure
- Dynamic theme system with 8 presets
- Theme-aware UI updates across admin flows
- Image uploads for logotype/isotype branding
- Border radius presets and branding controls wired into the app
- Setup banner and domain configuration UX added

These changes pull forward white-label and customization work that was originally scheduled later in the roadmap.

### Onboarding & Domain Claim Flow

- Redesigned onboarding wizard for domain setup
- Community lookup from veintiuno.lat during onboarding
- Username availability checks with debounced validation
- Claim flow that redirects authenticated users into the dashboard
- Shared NostrConnect form extracted for reuse
- Improved unsaved-change handling with save/cancel/revert flows in settings

This makes first-time setup materially smoother for operators and prepares the app for broader real-world usage.

### Public Landing Evolution & Repository Split

- Public landing iterated substantially during the period
- OpenSats attribution/banner added to the landing
- Waitlist/Tally logic removed as the product direction evolved
- Landing design aligned with the lawallet.io direction
- Public landing responsibilities were split into the dedicated [`lawallet-landing`](https://github.com/lawalletio/lawallet-landing) repository
- `lawallet-nwc` root path now redirects to the public landing while the product app remains centered on `/admin`

This separation makes the architecture clearer: the product app and the marketing site can now evolve independently.

### Release v0.9.0

- Version bump to `0.9.0`
- Changelog published for the reporting period
- Root redirect documented via environment configuration
- Release published to GitHub

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

The roadmap originally positioned Month 2 around CI/CD, SDK, and React Hooks, and Month 3 around admin dashboard enhancement, frontend cleanup, and Nostr login. During this period, we completed the CI/CD portion and made substantial progress on the Month 3 admin/dashboard work, while also pulling in parts of Month 4 such as white-label customization, onboarding flows, and domain configuration UX.

What remains from the original next steps is primarily:

- TypeScript Client SDK packaging and endpoint coverage
- React Hooks package work
- Playwright E2E coverage
- User dashboard completion
- Courtesy NWC Proxy service

The key difference versus the original plan is that the project now has a significantly stronger product surface earlier than expected.

---

## Next Quarter (Apr – Jun 2026)

The next phase should focus on consolidating the new product surface and completing the remaining platform pieces that unlock production readiness:

- Finish the User Dashboard (profile, address management, NWC connection, preferences)
- Ship the Courtesy NWC Proxy service
- Add Playwright E2E coverage for critical onboarding and admin flows
- Advance LUD-16/21/22 compliance work, redirects, and webhook support
- Resume SDK and React Hooks work so external apps can consume the platform cleanly
- Continue deployment/documentation work for self-hosted and managed environments

See the full [ROADMAP](../ROADMAP.md) for the 6-month plan.

---

## Links

- **Repository:** [github.com/lawalletio/lawallet-nwc](https://github.com/lawalletio/lawallet-nwc)
- **Public landing:** [github.com/lawalletio/lawallet-landing](https://github.com/lawalletio/lawallet-landing)
- **Full changelog:** [v0.9.0.md](../changelogs/v0.9.0.md)
- **Roadmap:** [ROADMAP.md](../ROADMAP.md)
- **Architecture:** [ARCHITECTURE.md](../ARCHITECTURE.md)
