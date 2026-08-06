---
description: Weekly Sentry triage — review errors + perf regressions, open fix PRs via /start-work
---

> Run this weekly in an INTERACTIVE session. The Sentry MCP is interactively
> authenticated — headless or scheduled runs will not have its tools.

Weekly Sentry triage loop for org `la-crypta`, projects `lawallet-web` and
`lawallet-listener`. Do exactly:

1. **List unresolved issues** from both projects for the last 7 days, sorted
   by event count (use the Sentry MCP `search_issues` tool).
2. **Check performance**: query the slowest web transactions / p95 durations
   for the last 7 days and compare against the prior week. Flag any
   transaction whose p95 regressed meaningfully as a performance regression.
3. **For the top actionable items** (highest-impact real bugs and flagged
   regressions): analyze with Seer (`analyze_issue_with_seer`) or read the
   stack trace, locate the offending code in this repo, then follow the
   /start-work flow (feature branch off latest main + draft PR) to implement
   the fix or performance improvement. One branch + draft PR per fix.
4. **Clean up triaged noise**: resolve or ignore issues that are not
   actionable (third-party noise, already-fixed, duplicates) via
   `update_issue`.
5. **End with a short report**: issues triaged, PRs opened, regressions
   flagged.
