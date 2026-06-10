---
description: Security audit of auth/RBAC/validation via the security-auditor agent — optionally scope with /audit-auth <route or area>
---

Delegate to the `security-auditor` agent (read-only): audit $ARGUMENTS

If no scope given, audit the full surface: `lib/auth/`, `lib/jwt.ts`,
`lib/jwt-auth.ts`, `lib/nip98.ts`, `lib/admin-auth.ts`,
`lib/middleware/rate-limit.ts`, `lib/middleware/request-limits.ts`, and the
public endpoints under `app/api/lud16/`, `app/api/jwt/`, `app/api/auth/`.

Present its findings as a table (severity / file:line / finding / suggested
fix) and do NOT apply fixes in the same turn — let the user pick what to
address.
