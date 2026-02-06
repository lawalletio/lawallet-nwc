# Month 6: Documentation + Deployment

**Period:** June 5 - July 5, 2026
**Status:** Planned
**Depends on:** Month 5 (Lightning Compliance + NWC Listener)

## Summary

Finalize all documentation, configure deployment targets, and prepare the codebase for security audit. This month transitions the project from active development to production-ready state.

---

## Goals

- Create comprehensive documentation for API, codebase, and all 3 services
- Configure deployment for Vercel, Netlify, Umbrel, Start9, Docker
- Prepare for security audit
- Finalize SDK and Hooks documentation

---

## API Documentation

- OpenAPI/Swagger specification for all 30 API routes
- Request/response schemas derived from existing Zod validation schemas
- Authentication requirements per endpoint (NIP-98, JWT, public)
- Example payloads for every endpoint
- Deploy interactive documentation at `/docs/api` (Swagger UI or Redoc)

---

## Codebase Documentation

### ARCHITECTURE.md (Expand Existing)

- System diagrams showing 3 independent services
- Data flow for payments (NWC and alias/redirect)
- Address resolution priority logic
- Service communication patterns
- Auth chain documentation (NIP-98 → admin-auth → permissions)

### CONTRIBUTING.md

- Local development setup guide (all 3 services)
- Coding standards and conventions
- PR process and review requirements
- Testing requirements (unit, integration, E2E)

### Environment Variable Reference

- Complete reference for all 3 services
- lawallet-web: 30+ variables (already validated by Zod)
- lawallet-listener variables
- lawallet-nwc-proxy variables
- Required vs optional, defaults, examples

### Service Guides

- NWC Payment Listener: setup, configuration, monitoring, troubleshooting
- Courtesy NWC Proxy: setup, provider configuration, adding new providers

---

## Integration Examples

- Lightning address integration (external app consuming LUD-16)
- WordPress integration (expand existing `integrations/WORDPRESS.md`)
- NWC connection sample code
- Webhook receiver example (Node.js)
- Custom domain setup guide
- Client SDK usage examples
- React Hooks usage examples with code snippets

---

## Deployment

### Vercel

- `vercel.json` configuration (already exists, validate)
- Environment variable mapping
- One-click deploy button
- Note: Next.js app only; Listener + Proxy deployed separately

### Netlify

- `netlify.toml` configuration
- Build settings for Next.js
- Redirect rules

### Umbrel

- Updated `umbrel-app-store` package
- All 3 containers included
- Comprehensive configuration options
- Installation documentation

### Start9

- Embassy service wrapper
- Manifest with all 3 services
- Health checks
- Submit to Start9 registry

### Docker Compose

- Production `docker-compose.yml` with 3 independent containers
- Reverse proxy configuration (Traefik or nginx)
- SSL/TLS setup guide
- Backup strategy documentation
- Volume configuration (each service isolated)

---

## Security Preparation

- Document all cryptographic operations:
  - NWC encryption (NIP-47)
  - NTAG424 chip encryption (AES-CMAC)
  - Webhook HMAC-SHA256 signing
  - JWT token generation/verification
  - Nostr key handling
- Review authentication flows for vulnerabilities
- Create threat model documentation
- Identify attack surfaces per service
- Prepare codebase for external security audit

---

## SDK + Hooks Finalization

- Full Client SDK API reference documentation
- Full React Hooks documentation with usage examples
- Code snippets for every hook
- Migration guide for SDK updates

---

## Acceptance Criteria

| Deliverable | Criteria | Priority |
|-------------|----------|----------|
| API docs | OpenAPI spec complete, interactive docs deployed | P0 |
| ARCHITECTURE.md | Diagrams, data flow, all 3 services documented | P0 |
| CONTRIBUTING.md | Setup guide, standards, PR process | P0 |
| Vercel config | One-click deploy working | P1 |
| Netlify config | Deploy guide working | P1 |
| Umbrel package | All 3 containers, installable from app store | P0 |
| Start9 package | Embassy package submitted | P1 |
| Docker Compose | All 3 containers running with reverse proxy | P0 |
| Security docs | Threat model, crypto operations documented | P1 |
| SDK/Hooks docs | Full API reference, usage examples | P1 |
