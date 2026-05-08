# Month 8: AI Agents (Intelligence Plane)

**Period:** August 5 – September 5, 2026
**Status:** Planned
**Depends on:** [Month 7](MONTH-7.md) (Subscription Manager + Nostr Chat) — and indirectly all of [Month 6](MONTH-6.md) (NWC Proxy Lite, Listener)

## Summary

Month 8 turns LaWallet NWC into a platform where operators can run AI agents as first-class participants. **Each agent has its own Lightning address, its own Nostr identity, and its own NWC wallet.** Operators spawn agents from the dashboard with one click, fund them with sats, and configure schedules and prompts. Agents participate in Nostr Chat (M7), run autonomous Nostr actions on a cron, and serve user-facing AI requests billed in sats — with subscriber discounts via the M7 sat allowance.

The model router is the **Vercel AI SDK + AI Gateway**, running inside `apps/web` route handlers. The agent scheduler / heartbeat ticker lives in `apps/listener` (which already runs as a long-lived process and holds relay-pool connections). **Container count stays at 3.**

---

## Goals

- One-click agent spawn from the dashboard
- Per-agent Lightning address (`<slug>@domain.com`) reusing existing LN address infra
- Per-agent NWC wallet provisioned via NWC Proxy Lite (M6)
- Two identity modes:
  - **Mode A (autonomous):** server-side encrypted nsec
  - **Mode B (delegated):** NIP-46 bunker URI (Amber etc.) for human-approved signing
- Dashboard funding flow — operator pays an invoice from the agent's wallet to top it up
- Agent NWC wallet supports outbound payments (zaps, agent-to-agent payments, paid services)
- Heartbeats / scheduled tasks via cron in `apps/listener`
- Autonomous Nostr task types: `POST`, `REPLY_TO_MENTIONS`, `ZAP_LIST`, `CUSTOM_PROMPT`
- Sat-metered user-facing inference with M7 allowance debit and 402-style invoice fallback
- Two reference agents (Drafter, Summarizer) plus a custom OperatorBot
- Tier discount / allowance via the M7 ledger
- Agent chat participation reusing the M7 chat surface

---

## A. Agent Spawn + Identity

### One-click spawn (admin)

`POST /api/admin/agents` from a dashboard form (name, description, system prompt, default model, optional Amber bunker URI). On create:

1. Generate or import a Nostr keypair (depending on mode)
2. Provision a Lightning address `<slug>@domain.com` reusing the existing `LightningAddress` infra
3. Create an NWC connection for the agent's wallet via NWC Proxy Lite (M6)
4. Persist the `Agent` row and register it in the dashboard list

Spawning is interactive — no CLI, no migration steps. Operator picks Mode A or Mode B at creation time.

### Identity Mode A — Autonomous (server-side nsec)

- The agent's nsec is generated server-side and encrypted at rest using the same scheme as the M5 instance nsec
- Agent signs Nostr events directly without human approval
- Required for full automation (heartbeats, autonomous posts at scheduled times)
- Risk: server compromise leaks the nsec — recommended for low-stakes agents

### Identity Mode B — Delegated (NIP-46 / Amber)

- Agent stores a **NIP-46 bunker URI** instead of an nsec (e.g., `bunker://...?relay=...&secret=...`)
- Signing requests go to the bunker — typically Amber on the operator's phone — for explicit approval
- Recommended for high-stakes agents (zaps, replies that represent the operator)
- Trade-off: operator must be on-call for autonomous tasks; `apps/listener` may queue requests if Amber is offline

---

## B. Per-Agent Lightning Address + Funding

### Lightning address

- Each agent has `<slug>@domain.com`, resolved through the existing M4/M6 LN address path
- Agents receive sats like users (zaps, payments, agent-to-agent transfers)

### Dashboard funding

1. Operator opens an agent in the dashboard, clicks **Fund Agent**, enters a sat amount
2. Backend calls `POST /api/admin/agents/[id]/fund` — creates an invoice from the agent's NWC wallet via Proxy Lite
3. Operator pays from their own wallet (any NWC client — including their LaWallet user wallet)
4. Listener detects the payment, agent balance updates in dashboard
5. UI shows agent balance, deposit history, and outbound spend

### Outbound payments

- Agents pay invoices, send zaps, and pay for agent-to-agent services from their own NWC wallet
- Wallet API mirrors the existing user wallet, scoped to the agent
- All outbound spends recorded in `AgentRequest` (when triggered by user inference) or in a dedicated `AgentTransaction` log (for autonomous spend like scheduled zaps)

---

## C. Heartbeats / Scheduled Tasks

### Scheduling model

- `AgentSchedule` model: `id, agentId, cron, taskType, taskConfig (Json), isActive, lastRunAt, nextRunAt`
- Operator defines cron expressions per agent (e.g., `0 9 * * *` for daily 09:00) and picks a `taskType`
- Listener ticker scans `AgentSchedule WHERE nextRunAt <= now() AND isActive` every minute
- On trigger, listener calls `apps/web` for any LLM work, then publishes Nostr events via its existing relay pool (Mode A) or via the NIP-46 bunker (Mode B)

### Task types

| Task | Behavior |
|------|----------|
| `POST` | Publishes a `kind:1` from a stored prompt (LLM call → publish) |
| `REPLY_TO_MENTIONS` | Scans recent mentions of the agent's npub, drafts replies, publishes |
| `ZAP_LIST` | Zaps a stored list of npubs from a prompt-derived amount |
| `CUSTOM_PROMPT` | Runs an LLM call with stored prompt; output handled per `taskConfig` (e.g., DM the operator with the result) |

### Autonomous Nostr actions

When triggered, an agent can post, react, follow, zap, or DM. All actions go through the agent's identity (npub + nsec/bunker) and, where money is involved, the agent's NWC wallet. Funded from operator deposits.

---

## D. User-Facing Inference (Sat-Metered)

### Run endpoint

`POST /api/agents/[agentId]/run` accepts `{ messages: [...], stream?: true }`. Middleware:

1. Resolves the user (JWT or NIP-98)
2. Looks up the agent's pricing (`pricePerRequestSats`, `pricePerKTokenSats`) and any active subscription
3. Checks the user's `TokenAllocation` balance from the M7 sat-allowance ledger:
   - If sufficient → debit the ledger and stream the response
   - Otherwise → return a 402-style payload with an invoice from the **agent's NWC wallet**
4. On payment (listener webhook), settles the request and streams the response

### AgentRequest ledger

- `AgentRequest` model: `id, userId, agentId, model, tokensIn, tokensOut, costSats, paidVia (ALLOCATION | INVOICE | AGENT_WALLET), invoiceId?, subscriptionId?, status, createdAt`
- Every run logged for billing, abuse detection, and admin reporting

### Tier discount / allowance

- Active subscribers' allowance from M7 covers requests transparently — they pay 0 sats while the allowance lasts
- Free tier always pays per-request to the agent's NWC wallet (operator's revenue)
- Operators can set per-tier multipliers (e.g., Pro tier = 2× allowance per month)

---

## E. Reference Agents + OperatorBot

### Drafter (P0)

- System prompt: "Draft a Nostr post or DM matching the user's voice"
- Spawnable from a one-click button in the dashboard (no manual prompt entry)
- Works from admin UI and SDK; usable in chat (DM the agent with a topic, get a draft back)

### Summarizer (P0)

- System prompt: "Summarize a Nostr thread or article"
- Same spawn UX
- Pairs well with the M7 chat surface (DM the agent a thread root id, get a summary)

### OperatorBot (custom)

- Admin defines a custom system prompt during spawn
- Becomes a fully-fledged agent (own LN address, own npub, own wallet)
- Appears in the user-facing agent list

---

## F. Agent Chat Participation

- Agents are first-class participants in the M7 Nostr Chat surface
- Users DM an agent's npub → agent sees the DM (Mode A signs decryption keys server-side; Mode B requests via Amber)
- Agent processes the DM (LLM call) and replies via DM through the same M7 chat infrastructure
- Agents can also receive zaps to their LN address mid-conversation

---

## G. Settings Extensions

Namespaced keys added to `Settings` (no migration):

- `agents.enabled` — master toggle
- `agents.gatewayKey` — Vercel AI Gateway API key (encrypted)
- `agents.defaultModel` — fallback model string (e.g., `gpt-4o`)
- `agents.allowAmberMode` — per-instance opt-in for Mode B
- `agents.maxConcurrentRuns` — rate limit per user

---

## API Routes (added in M8)

- `/api/admin/agents` — `GET` list, `POST` spawn (5 routes total with `[id]` GET/PATCH/DELETE)
- `/api/admin/agents/[id]/fund` — `POST` create invoice from agent wallet
- `/api/admin/agents/[id]/schedules` — `GET`, `POST`, `[scheduleId]` `DELETE`
- `/api/agents` — `GET` user-facing list, `[id]` `GET` detail
- `/api/agents/[id]/run` — `POST` streaming
- `/api/agents/[id]/wallet` — `GET` balance, `POST` pay invoice (admin-only)

---

## Architecture Notes

- **No new containers.** Container count stays at 3 (`web`, `listener`, `nwc-proxy`).
- **Agent inference** runs inside `apps/web` route handlers via the Vercel AI SDK (streaming responses are first-class in Next.js).
- **Agent scheduler / heartbeat ticker** lives in `apps/listener`. The listener already has the M7 daily expiry cron; per-agent cron tick is incremental.
- **NIP-46 client (Mode B)** reuses the existing client used in admin login (NConnectSigner / nostr-tools nip46). Lives in shared client code and is called from `apps/listener` when an agent in Mode B needs a signature.
- **Vercel AI Gateway** is the only LLM dependency — provider keys live in encrypted Settings.

---

## Acceptance Criteria

| Deliverable | Criteria | Priority |
|-------------|----------|----------|
| One-click agent spawn | Admin form creates agent with npub + LN address + NWC wallet in under 5s | P0 |
| Per-agent LN address | `<slug>@domain.com` resolves; agent receives sats | P0 |
| Agent NWC wallet | Agent can pay invoices and send zaps from its own balance | P0 |
| Dashboard funding | "Fund Agent" → invoice from agent wallet → operator pays → balance updates | P0 |
| Agent identity Mode A (nsec) | Server-side encrypted nsec; agent signs autonomously | P0 |
| Agent identity Mode B (Amber/NIP-46) | Operator selects bunker URI; signing requests reach Amber and return | P0 |
| Agent run endpoint | Streams response; debits user's M7 allowance or returns invoice from agent wallet | P0 |
| `AgentRequest` ledger | Every run logged with cost, tokens, plan, paidVia | P0 |
| Drafter + Summarizer agents | Both spawnable in one click; work from admin UI and SDK | P0 |
| OperatorBot custom prompt | Admin sets system prompt during spawn; new agent appears in user-facing list | P0 |
| Agent chat participation | User DMs agent npub → agent replies via DM through M7 chat surface | P0 |
| Scheduled tasks (cron) | Operator sets cron + task type; listener triggers at scheduled time | P0 |
| Autonomous Nostr tasks | `POST`, `REPLY_TO_MENTIONS`, `ZAP_LIST`, `CUSTOM_PROMPT` task types execute | P0 |
| Tier allowance / discount | Subscriber pays 0 sats while M7 allowance lasts | P0 |
| Agent-to-agent payments | One agent zaps another's LN address from its NWC wallet | P1 |
| Agent invocation via Nostr DM | DM the OperatorBot npub from any Nostr client → reply via DM | P1 |
| Group threads (NIP-29) | Deferred to M9 / post-roadmap | — |

---

## Non-goals

- No fine-tuning, no custom model hosting (Vercel AI Gateway only).
- No multi-tenant isolation beyond the existing per-operator scoping.
- No streaming over WebSocket — HTTP streaming is sufficient.
- No NIP-29 group chat threads (M9 / post-roadmap).
- No agent marketplace, no public agent discovery beyond the operator's instance.
- No cross-instance agent federation.
