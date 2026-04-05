# Progress Report — Months 2–3

**Project:** LaWallet NWC  
**Period:** February 6 – April 5, 2026  
**Grant:** [OpenSats — Fifteenth Wave of Bitcoin Grants](https://opensats.org/blog/fifteenth-wave-of-bitcoin-grants)

---

## Summary

This report covers **all work since the last reported commit** [`fd2296b`](https://github.com/lawalletio/lawallet-nwc/commit/fd2296b), which closed out the Month 1 report.

The main theme of this period was turning the project from a hardened backend foundation into a product with a real operator surface and a clearer public-facing architecture. We shipped CI/CD improvements, migrated NIP-98 login into JWT session auth, rebuilt the admin/dashboard experience from Figma, added onboarding/domain setup flows, implemented white-label branding and theme controls, and separated the public `lawallet.io` landing into its own dedicated repository.

A major outcome of this period is that the project is no longer only "backend-ready" — it now has a coherent operator experience for managing users, cards, addresses, branding, and setup flows, plus a dedicated public site that can evolve independently from the app. We also delivered substantial Month 3 and Month 4 work ahead of the original roadmap, especially around Figma implementation, configurable branding, and the customizable landing direction.

**Main repo stats (`lawallet-nwc`):** 221 files changed, 11,043 insertions, 10,452 deletions — 58 commits across 4 merged PRs.  
**Landing repo (`lawallet-landing`):** created as a separate repository during this period and used to continue the public `lawallet.io` landing implementation.

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

### Figma Implementation, Admin Dashboard Rebuild & Frontend Restructure

- Frontend stripped down and rebuilt against the new dashboard direction
- Figma dashboard screens were mapped into implementation work and then shipped into the app
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
- Core groundwork shipped for a customizable landing/app experience through branding, theming, and domain-oriented onboarding

These changes pull forward white-label and customization work that was originally scheduled later in the roadmap.

### Onboarding & Domain Claim Flow

- Redesigned onboarding wizard for domain setup
- Community lookup from veintiuno.lat during onboarding
- Username availability checks with debounced validation
- Claim flow that redirects authenticated users into the dashboard
- Shared NostrConnect form extracted for reuse
- Improved unsaved-change handling with save/cancel/revert flows in settings

This makes first-time setup materially smoother for operators and prepares the app for broader real-world usage.

### New `lawallet.io` Landing, Customizable Landing Direction & Repository Split

- The public `lawallet.io` landing was substantially redesigned during this period
- The landing was first iterated inside `lawallet-nwc`, then extracted into the dedicated [`lawallet-landing`](https://github.com/lawalletio/lawallet-landing) repository
- The separate landing repo continued shipping the public experience with waitlist UX, visual improvements, and standalone deployment flow
- OpenSats attribution/banner was added to the landing
- Landing design was aligned with the `lawallet.io` direction and the broader brand system
- The product direction shifted from a fixed marketing page toward a more customizable landing/app setup tied to branding and community/domain onboarding
- `lawallet-nwc` root path now redirects to the public landing while the product app remains centered on `/admin`

This separation makes the architecture clearer: the product app and the marketing site can now evolve independently, while also supporting the longer-term goal of customizable public-facing deployments.

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

The roadmap originally positioned Month 2 around CI/CD, SDK, and React Hooks, and Month 3 around admin dashboard enhancement, frontend cleanup, and Nostr login. During this period, we completed the CI/CD portion and made substantial progress on the Month 3 admin/dashboard work, while also pulling in parts of Month 4 such as white-label customization, onboarding flows, domain configuration UX, and the customizable landing direction.

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
