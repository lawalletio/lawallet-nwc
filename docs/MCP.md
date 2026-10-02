# MCP Server for AI Agents

Every LaWallet instance serves a remote
[Model Context Protocol](https://modelcontextprotocol.io) (MCP) server. An AI
agent — Claude, ChatGPT, Cursor, Claude Code — connects to it and operates the
instance for a signed-in user: reads balances and invoices, creates invoices
and lightning addresses, and, only when the user allows it, pays Lightning
invoices within a daily limit.

This is the full reference. The user guide at
[docs.lawallet.io/docs/guides/mcp](https://docs.lawallet.io/docs/guides/mcp)
covers the same ground with less detail on internals.

- **One instance only.** The MCP endpoint _is_ the instance: it reads and
  writes this instance's database and the wallets connected to it, and never
  reaches another community's deployment. Tokens are bound to the instance's
  URL, so a token issued by one instance is refused by every other.
- **Bitcoin over Lightning only.** Amounts are in sats unless a field name
  says msats. The one exception, `request_address_invoice`, is flagged where
  it is described.
- **Nothing extra to deploy.** The server runs inside the web app
  (`apps/web`). It adds no service and no environment variable.

Throughout this document, `https://<instance>` stands for the instance's
public URL — the value of its `endpoint` setting, for example
`https://wallet.example.com`.

## Endpoints

| URL                                 | Who can call                                                                         | Tools                                                                                                                                    |
| ----------------------------------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `https://<instance>/api/mcp`        | A signed-in agent: an OAuth access token or a session JWT (never a device token)     | Every tool the connection's permissions and the account's role allow                                                                     |
| `https://<instance>/api/mcp/public` | Anyone. No credentials needed; credentials that are sent are ignored, never rejected | Public tools only: instance information, and lookups of this instance's lightning addresses (including requesting an invoice to pay one) |

Both accept `POST` only.

**Find the exact URL.** A signed-in user sees the instance's MCP URL, with a
copy button, in the **MCP server URL** field under **Connected apps**:

- in the wallet: **Settings → Security → Connected apps**
  (`https://<instance>/wallet/settings/security`);
- in the admin dashboard: **Account** in the sidebar → **Connected apps**
  (`https://<instance>/admin/account`).

Use that URL exactly as shown. It is read from the instance's OAuth metadata,
so it is the canonical URL every token is bound to — which can differ from the
address in your browser's address bar.

## Prerequisites

### For users

- The instance's MCP URL (above).
- A Nostr identity you can sign in with on the instance. Approving a
  connection creates the account if the identity does not have one yet.
- For ChatGPT, Claude (claude.ai, Claude Desktop, the mobile apps), the Claude
  API and the OpenAI API: the provider's servers make the connection, so the
  instance must be reachable on a **public HTTPS URL**. An instance on a home
  network (Umbrel, Start9) needs a public URL or a tunnel for these clients.
  Claude Code, Cursor and the MCP Inspector run on your computer and can use
  any URL your computer reaches — as long as it is the canonical MCP URL.

### For operators

- **Set the `endpoint` setting** (Admin → Settings → Infrastructure → **This
  instance endpoint**) to the instance's public URL, exactly as clients reach
  it: scheme, host and port. The MCP URL, the OAuth issuer and metadata, and
  every access token are derived from it.
  - When `endpoint` is unset, each request's `Host` header is used instead,
    with `https://` unless the host is `localhost`. That works for an instance
    served under a single hostname, but set the value explicitly.
  - For an instance served over plain HTTP on a local network (other than
    `localhost`), write the `http://` scheme: a value without a scheme is read
    as `https://`.
  - Changing `endpoint` disconnects every connected app: their tokens are
    bound to the old URL and are refused with
    `Access token was issued for a different resource`. Users connect again. It
    also invalidates every device token, as documented in the
    [JWT guide](https://docs.lawallet.io/docs/guides/jwt-authentication#instance-scoping-apiurl).
- **`JWT_SECRET` must be configured.** Users approve connections from a signed-in
  session, and tool calls from OAuth connections run the REST handlers with a
  short-lived internal session token. Any instance where users can sign in
  already has it.
- **No new environment variables.** The existing `RATE_LIMIT_*` and
  `REQUEST_MAX_JSON_SIZE` variables apply. The feature adds three tables
  (`OAuthClient`, `OAuthGrant`, `McpPayment`, migration
  `20260930150454_add_mcp_oauth`), applied with the other migrations on
  upgrade.
- **Serve `/api/mcp` on the endpoint host.** Do not redirect it to another host
  (for example apex to `www`): Claude drops the `Authorization` header on a
  cross-host redirect. Reverse proxies must pass the `Authorization` header
  through.
- **Allow 60-second requests.** A tool call waits up to about 45 seconds for a
  payment to settle, and the route declares `maxDuration = 60`. A host that
  stops functions sooner cuts slow payment calls off; the payment is then
  re-checked through `wallet_list_payments` (see [Payments](#payments)).

## Connect a client

Client interfaces change. The steps below follow each vendor's documentation
as checked on **2026-09-30**; if a label has moved, look for the equivalent
option.

| Client                              | Connects from       | OAuth                                   | Static bearer token          | Home-network instance |
| ----------------------------------- | ------------------- | --------------------------------------- | ---------------------------- | --------------------- |
| Claude (claude.ai, Desktop, mobile) | Anthropic's servers | Yes — choose **Register automatically** | Beta, organization-wide only | Needs a public URL    |
| ChatGPT (developer mode)            | OpenAI's servers    | Yes                                     | No                           | Needs a public URL    |
| Claude Code                         | Your computer       | Yes                                     | Yes                          | Reachable directly    |
| Cursor                              | Your computer       | Yes                                     | Yes                          | Reachable directly    |
| Claude API (MCP connector)          | Anthropic's servers | Your code obtains the token             | Yes                          | Needs a public URL    |
| OpenAI Responses API                | OpenAI's servers    | Your code obtains the token             | Yes                          | Needs a public URL    |
| MCP Inspector                       | Your computer       | Yes                                     | Yes                          | Reachable directly    |

OAuth works with every client and is the only way to grant `spend`. A static
bearer token (see [Bearer tokens instead of OAuth](#bearer-tokens-instead-of-oauth))
suits scripts and API integrations, never spends, and only works where the
client can send an `Authorization` header.

### Claude (claude.ai, Claude Desktop, mobile)

A custom connector works in claude.ai, Claude Desktop and the Claude mobile
apps. Anthropic's servers make the connection, so the instance needs a public
HTTPS URL.

**Free, Pro and Max plans** (Free allows one custom connector):

1. Open **Customize → Connectors → Add custom connector**.
2. Enter `https://<instance>/api/mcp` — the canonical URL from Connected apps,
   including `/api/mcp`.
3. For authentication, choose **Sign in now**.
4. For the OAuth client, choose **Register automatically**. Do not choose _Use
   Claude's published identity_: this instance does not support client ID
   metadata documents.
5. Add the connector. The instance's consent page opens: sign in, choose the
   permissions, approve (see [The consent screen](#the-consent-screen)).
6. In a chat, turn the connector on under **+ → Connectors**.

**Team and Enterprise plans:** an Owner — or an Enterprise member with a
qualifying custom role — adds the connector under **Organization settings →
Connectors → Add → Custom (Web)**, with the same URL and choices. Each member
then clicks **Connect** under **Customize → Connectors** and approves the
consent page with their own LaWallet account.

Gotchas:

- **Authentication settings cannot be edited after the connector is added.**
  To change them, remove the connector and add it again. (To change the
  _permissions_ you granted, see [Revoking and changing access](#revoking-and-changing-access).)
- **The URL must be the canonical one.** Claude requires the `resource` in the
  instance's protected-resource metadata to equal the URL you entered, path
  included. A different host, scheme, or a missing `/api/mcp` fails.
- **Public reachability.** The hostname must resolve to public IP addresses
  (Anthropic connects from `160.79.104.0/21`), and the URL must not redirect to
  another host.
- **Metadata is cached** for about five minutes. After an operator fixes the
  `endpoint` setting, wait before retrying.
- **Static tokens:** claude.ai sends custom request headers only through a beta
  _Request headers_ option available to some organizations, and the value is
  shared by the whole organization. Use OAuth.
- **Public tools only:** to add just the anonymous tools, use
  `https://<instance>/api/mcp/public` and choose **No sign-in**.

The consent page shows these requests as coming from `claude.ai`.

### Claude Code

Add the server (run in any directory):

```bash
claude mcp add --transport http lawallet https://<instance>/api/mcp
```

Sign in with OAuth, either inside a Claude Code session — run `/mcp`, pick
`lawallet`, and a browser opens the consent page — or from the shell:

```bash
claude mcp login lawallet
```

Over SSH, add `--no-browser` to `claude mcp login`. Claude Code receives the
sign-in on `http://localhost:<random port>/callback`; the instance accepts any
port on a loopback address, and the consent page shows the request as coming
from `localhost` ("Runs on this computer").

**With a bearer token instead**, pass the header when adding the server:

```bash
claude mcp add --transport http lawallet https://<instance>/api/mcp \
  --header "Authorization: Bearer $LAWALLET_MCP_TOKEN"
```

The shell expands `$LAWALLET_MCP_TOKEN` when you run the command, so the token
itself is stored in Claude Code's configuration. For a project configuration
that is shared or committed, reference the variable in `.mcp.json` (the file
`claude mcp add --scope project` writes) instead; Claude Code expands `${VAR}`
in `url` and `headers` when it loads the file:

```json
{
  "mcpServers": {
    "lawallet": {
      "type": "http",
      "url": "https://<instance>/api/mcp",
      "headers": { "Authorization": "Bearer ${LAWALLET_MCP_TOKEN}" }
    }
  }
}
```

Leave out `headers` to use OAuth. `type` is required for URL entries.

Gotchas:

- If the instance rejects a configured `Authorization` header (for example, the
  token expired), the connection fails. Claude Code does not fall back to
  OAuth: renew the token or remove the header.
- Tools appear as `mcp__lawallet__<tool>`, for example
  `mcp__lawallet__wallet_get_balance`.
- Newer Claude Code versions first try the 2026-07-28 protocol revision and
  fall back to the older handshake otherwise. The instance serves both. If you
  suspect negotiation is the problem, `MCP_PROTOCOL_NEGOTIATION=legacy` turns
  the probe off.

### ChatGPT

Available on Pro, Plus, Business, Enterprise and Education accounts, on the
web; a workspace policy can restrict it. ChatGPT calls the instance from
OpenAI's servers, so the instance needs a public HTTPS URL.

1. In ChatGPT, open **Settings → Security and login** and turn on **Developer
   mode**.
2. Go to [chatgpt.com/plugins](https://chatgpt.com/plugins) and click **+**.
   Enter a name and a description.
3. Under **Connection**, enter `https://<instance>/api/mcp`, with the path.
4. Choose **OAuth** for authentication, without client credentials: the
   instance supports dynamic client registration, which ChatGPT uses to
   register itself.
5. Create the app, sign in on the instance's consent page when it opens, and
   review the tools ChatGPT discovered. The app is listed under **Drafts**.
6. To use it in a conversation: composer **+** menu → **Developer mode** →
   select the app.

Gotchas:

- **OAuth only.** ChatGPT cannot send custom headers or API keys, so bearer
  tokens do not work.
- **Press Refresh after changing permissions.** ChatGPT takes a snapshot of the
  tool list when the app is created and when you press **Refresh**, and the
  list depends on the permissions you approved.
- **Confirmations.** ChatGPT asks for confirmation before any tool not marked
  read-only, and for explicit approval of tools marked destructive
  (`wallet_pay_invoice`, `api_write`). A choice can be remembered per tool for
  the current conversation — do not do that for `wallet_pay_invoice`.
- **`invalid_client`.** ChatGPT registers once per app and reuses the
  registration. The instance deletes registrations that were never used to
  connect an account after 30 days; if that happened, delete the app in ChatGPT
  and create it again.
- The connection form also offers a **Tunnel** option (Secure MCP Tunnel); it
  is not covered here.

The consent page shows these requests as coming from `chatgpt.com`.

### Cursor

Put the server in `.cursor/mcp.json` in a project, or in `~/.cursor/mcp.json`
for every project:

```json
{
  "mcpServers": {
    "lawallet": {
      "url": "https://<instance>/api/mcp"
    }
  }
}
```

Cursor signs in to remote servers with OAuth; approve the request on the
instance's consent page. Cursor's documented desktop callback is
`http://localhost:8787/callback`, a loopback address the instance accepts.

**With a bearer token instead:**

```json
{
  "mcpServers": {
    "lawallet": {
      "url": "https://<instance>/api/mcp",
      "headers": { "Authorization": "Bearer ${env:LAWALLET_MCP_TOKEN}" }
    }
  }
}
```

Cursor interpolates `${env:NAME}` in `url` and `headers`; remote entries do not
support `envFile`. Tool approval is on by default in Cursor — keep it on for
`wallet_pay_invoice`.

Cursor staff have reported (on the Cursor forum, not in the documentation)
that Cursor's registration also lists a `cursor://` app link. The instance
accepts app-link redirect URIs, so this does not break registration.

### Claude API (MCP connector)

The Messages API can call the instance's tools directly. Send the beta header
`anthropic-beta: mcp-client-2025-11-20`, declare the server in `mcp_servers`
and enable it in `tools`. Set `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` (the model
ID you use) and `LAWALLET_MCP_TOKEN`, replace `<instance>`, then run:

```bash
curl https://api.anthropic.com/v1/messages \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "anthropic-beta: mcp-client-2025-11-20" \
  -H "content-type: application/json" \
  -d @- <<EOF
{
  "model": "$ANTHROPIC_MODEL",
  "max_tokens": 1024,
  "messages": [{ "role": "user", "content": "What is my wallet balance?" }],
  "mcp_servers": [
    {
      "type": "url",
      "url": "https://<instance>/api/mcp",
      "name": "lawallet",
      "authorization_token": "$LAWALLET_MCP_TOKEN"
    }
  ],
  "tools": [{ "type": "mcp_toolset", "mcp_server_name": "lawallet" }]
}
EOF
```

- Only tool calls are supported, and the instance must be on a public HTTPS
  URL.
- Your code supplies the token and renews it: a session JWT (`read` and
  `write`), or an access token from an OAuth flow your code runs (required
  for `spend`; it expires after an hour, renew it with the refresh token).
- Available on the Claude API, Claude Platform on AWS and Foundry; not on
  Amazon Bedrock or Google Cloud Vertex AI.
- The older beta header `mcp-client-2025-04-04` is deprecated.

### OpenAI Responses API

Add an `mcp` tool to the request with `server_url` set to
`https://<instance>/api/mcp` and the token in `authorization`. OpenAI does not
store the token, so send it with every request. Extra headers go in `headers`.
The token options are the same as for the Claude API. See OpenAI's
[MCP tool guide](https://developers.openai.com/api/docs/guides/tools-connectors-mcp)
for the rest of the request.

### Smoke test

Check the instance from a terminal before blaming a client. Plain `curl`
first:

```bash
# Public tools — no token needed
curl -s https://<instance>/api/mcp/public \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'

# The 401 challenge that starts OAuth (look for WWW-Authenticate)
curl -si https://<instance>/api/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'

# The discovery documents clients read
curl -s https://<instance>/.well-known/oauth-protected-resource/api/mcp
curl -s https://<instance>/.well-known/oauth-authorization-server
```

The protected-resource document must name the exact URL clients use as
`resource`, and the instance URL as its authorization server:

```json
{
  "resource": "https://<instance>/api/mcp",
  "authorization_servers": ["https://<instance>"],
  "scopes_supported": ["read", "write", "spend"],
  "bearer_methods_supported": ["header"]
}
```

Then the MCP Inspector CLI (package `@modelcontextprotocol/inspector`, binary
`mcp-inspector`), which speaks the protocol like a real client:

```bash
# Public endpoint
npx @modelcontextprotocol/inspector@latest --cli https://<instance>/api/mcp/public \
  --transport http --method tools/list --format json

# Authenticated endpoint with a bearer token
npx @modelcontextprotocol/inspector@latest --cli https://<instance>/api/mcp --transport http \
  --header "Authorization: Bearer $LAWALLET_MCP_TOKEN" --method tools/list --format json
npx @modelcontextprotocol/inspector@latest --cli https://<instance>/api/mcp --transport http \
  --header "Authorization: Bearer $LAWALLET_MCP_TOKEN" \
  --method tools/call --tool-name get_instance_info --tool-args-json '{}'
```

- Without `--header`, the CLI signs in with OAuth when it runs in a terminal;
  it receives the sign-in on `http://127.0.0.1:6276/oauth/callback`. Without a
  terminal (CI) it fails fast with `auth_required`; `--stored-auth-only` never
  starts an interactive sign-in.
- Exit codes: `0` success, `1` usage error, `3` authentication required
  (401/403), `4` unreachable, `5` tool error (`isError`) or unknown tool. On
  failure it writes one JSON line to stderr.
- `--method initialize` only connects and reports capabilities.
  `--tool-arg key=value` passes one argument (JSON-coerced); `--tool-args-json`
  passes the object verbatim.

## Sign-in and permissions

Each approval creates a **connection**: one app's access to one account, with
its own permissions and, when payments are allowed, its own daily limit. The
API calls them grants (`/api/oauth/grants`).

### The consent screen

When an app starts OAuth, it opens `https://<instance>/oauth/authorize` in your
browser. If you are not signed in there, the page shows **Sign in to
continue** and uses the instance's normal sign-in. Nothing is shared until you
approve. The page shows:

- **Request from** — the host that receives your approval: the address the app
  registered to get its answer back, for example `claude.ai` or `chatgpt.com`.
  For an app on your computer it is `localhost` (or `127.0.0.1`), marked "Runs
  on this computer".
- **Calls itself "…"** — the name the app registered. Anyone can register any
  name, so judge the request by the host above, never by the name.
- **Signed in as** — the account the app will act as, with **Switch account**.
- **It will be able to** — the permissions the app asked for, as checkboxes.
- **Daily limit (sats)** — shown when **Send payments** is ticked.
- A reminder that the app acts as you, with your role's permissions if you are
  not a regular member, and that access can be revoked under Connected apps.
- **Approve** and **Deny**. Deny sends the app an `access_denied` answer.

A request the instance cannot accept — an unknown app registration, a return
address the app did not register, or a `resource` that is not this instance's
MCP URL — is shown on the page as **Can't connect this app**, with the reason.
Nothing is authorized and the page does not redirect.

The page cannot be embedded in another site (`X-Frame-Options: DENY`,
`Content-Security-Policy: frame-ancestors 'none'`) and sends no `Referer`.

### Scopes

| Scope   | Consent screen label                                      | Allows                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `read`  | View balances, addresses, cards and activity              | Read-only tools.                                                                                                                                                                                                                                                                                                                                                                                                   |
| `write` | Create and change addresses, invoices and wallet settings | Tools that create or change data: new lightning addresses and the primary one, invoices, wallet names and defaults, removing a wallet, LNCurl wallets, vouchers, your own preferences; for operators and admins also card designs, address provisioning and deleting cards. This includes which of your own wallets receives incoming payments. It cannot send funds, bind a card to a wallet, or free a username. |
| `spend` | Send payments from your wallets                           | `wallet_pay_invoice`, within the daily limit.                                                                                                                                                                                                                                                                                                                                                                      |

- **`read` comes with `write` and `spend`.** On the consent screen it is
  ticked and locked while either is ticked, and the instance adds it to the
  connection either way. `spend` does not include `write`.
- **Defaults.** `read` and `write` are pre-selected when the app asks for them;
  `spend` never is.
- **What apps ask for.** The instance's 401 challenge names no scopes, so
  clients request every scope the instance lists (`read`, `write`, `spend`) and
  you choose on the consent screen. An app that asks only for scopes the
  instance does not know is offered all three.
- **Scopes gate tools, not the account.** The account's role and the usual
  ownership rules still apply underneath: a `write` connection of a regular
  member cannot do admin work, and an admin's connection can do what the admin
  can, except the operations listed in [Not exposed](#not-exposed).

### The daily spend limit

`spend` always comes with a daily limit in sats, chosen on the consent screen:
10,000 sats by default, from 1 to 10,000,000.

- The window is a **rolling 24 hours**, not a calendar day.
- It counts the amount **plus routing fees** of every payment the connection
  made in the last 24 hours that did not fail. Pending payments and payments
  with an unknown outcome count; failed ones do not.
- The limit is **per connection**. Two connected apps with `spend` have two
  limits, and the amounts add up.
- A payment needs room for its amount **plus a routing-fee reserve** of 1% of
  the amount, at least 10 sats: paying 500 sats needs 510 left, paying 5,000
  needs 5,050. The reserve is only headroom; the fee actually paid is counted
  once known. A fee above the reserve, or fees of payments still in flight,
  can still put the total a few sats over the limit.
- **An agent cannot change its own limit.** Only you can, by approving a new
  connection on the consent page. A new connection starts with nothing spent
  (see [Revoking and changing access](#revoking-and-changing-access) for when
  it replaces the old one).

See [Payments](#payments) for how the limit is enforced.

### Tokens

| Credential                    | Lifetime                            |
| ----------------------------- | ----------------------------------- |
| Authorization code (`lwac_…`) | 5 minutes, single use               |
| Access token (`lwat_…`)       | 1 hour                              |
| Refresh token (`lwrt_…`)      | 30 days, restarted by every refresh |

- Clients refresh automatically. Every refresh replaces both tokens, and the
  previous ones stop working at once.
- A connection unused for 30 days expires and disappears from Connected apps.
  Connect the app again.
- The instance stores only SHA-256 hashes of codes and tokens; reading the
  database never yields a usable credential.
- Tokens are bound to the instance's MCP URL. An authorization code presented
  twice revokes its connection, because the code has leaked.
- The prefixes make the credentials recognizable to secret scanners, and the
  error reporter scrubs them.

### Revoking and changing access

- **Revoke** an app under **Connected apps** (confirm the dialog). Its tokens
  stop working immediately.
- An app can also revoke its own tokens through the revocation endpoint
  (`POST /api/oauth/revoke`). Whether it does so when you remove it depends on
  the client, so check Connected apps afterwards.
- Connected apps lists the active connections, newest first: the app's name,
  its permissions (with the daily limit on **Spend**), when it was connected and
  when it was last used (updated at most once a minute).
- **To change an app's permissions**, revoke it and connect it again, choosing
  the new permissions on the consent screen. Then refresh the tool list in the
  client if it keeps a snapshot (ChatGPT: **Refresh**).
- Approving the same app registration again replaces its previous connection
  once the app exchanges the new authorization code. Until then the old
  connection keeps working, so an abandoned reconnect leaves you connected.
  Some clients (claude.ai among them) register anew for every fresh
  connection, so their old entry stays until you revoke it or it expires.
- Payment records of revoked connections are kept.

## Bearer tokens instead of OAuth

For scripts, CI and API integrations, where a browser sign-in is impractical,
`/api/mcp` also accepts a **session JWT** in an `Authorization: Bearer`
header. Get one from `POST /api/jwt` with a NIP-98-signed request; it is valid
for up to 24 hours — see the
[JWT guide](https://docs.lawallet.io/docs/guides/jwt-authentication).

A session JWT gets the `read` and `write` scopes — **never `spend`**. Payments
always need an OAuth connection with a daily limit you approved, and
`wallet_list_payments` has nothing to show for these tokens.

**Device tokens** (minted under **Settings → Device Tokens**) are refused with
401 `invalid_token`: they are narrowed to a few permissions for one device,
which the wallet tools would not honor.

Clients that can send the header: Claude Code, Cursor, the MCP Inspector, the
Claude API and the OpenAI Responses API. ChatGPT cannot; claude.ai only
through its beta, organization-wide request headers.

A token in a configuration file is a credential:

- It carries your account's full read and write access — an admin's token
  carries admin powers. Prefer OAuth: its access is scoped, revocable, and
  refreshes itself.
- Session JWTs cannot be revoked before they expire (only
  rotating `JWT_SECRET` ends them all). Use the shortest workable lifetime.
- Keep tokens out of shared or committed configuration: reference an
  environment variable (`${LAWALLET_MCP_TOKEN}` in Claude Code's `.mcp.json`,
  `${env:LAWALLET_MCP_TOKEN}` in Cursor's `mcp.json`).
- When the token expires, a client configured with it can no longer connect;
  Claude Code does not fall back to OAuth.

## Tools

### What a connection sees

`tools/list` returns only the tools the caller can use, in a stable order:

- `/api/mcp/public`: `get_instance_info`, `resolve_lightning_address`,
  `request_address_invoice`, `verify_address_payment`,
  `check_address_availability`, `api_list_operations` and `api_read` (the last
  two limited to public operations).
- `/api/mcp`: the tools the connection's scopes allow, minus operations above
  the account's role (roles, low to high: USER, VIEWER, OPERATOR, ADMIN). A
  connection with every scope on an admin account sees 26 tools.

Calling a tool the caller cannot use returns an error result that says what
is missing — a scope, a role, or a sign-in — not a protocol error.

Every tool has a `title` and sets `readOnlyHint`, `destructiveHint` and
`openWorldHint` explicitly, so clients can decide what needs confirmation.
Only `wallet_pay_invoice` and `api_write` are marked destructive.

### Instance information

`get_instance_info` (public, no arguments) returns the instance URL, both MCP
URLs, the software version and the domain its lightning addresses use. For a
signed-in caller it adds the connection: pubkey, role, scopes, how it is
connected (`oauth` or `session token`), the app's name, and the remaining
daily spend budget. The server's instructions tell agents to call it first.

### Wallet tools

Wallet tools reach the account's wallets through the instance's wallet driver
(Nostr Wallet Connect). A tool that takes `walletId` uses the account's
**primary wallet** unless `walletId` (from `list_wallets`) is given; the
wallet must belong to the account and be active. Balance, invoice and lookup
calls wait at most 30 seconds for the wallet.

| Tool                            | Scope   | Arguments                                                                    | Result                                                              |
| ------------------------------- | ------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `wallet_get_balance`            | `read`  | `walletId`?                                                                  | `walletId`, `walletName`, `balanceSats`                             |
| `wallet_make_invoice`           | `write` | `amountSats`, `description`? (up to 500 characters), `walletId`?             | `walletId`, `bolt11`, `paymentHash`, `amountSats`, `expiresAt`      |
| `wallet_lookup_invoice`         | `read`  | `paymentHash` (64 hex characters), `walletId`?                               | `walletId`, `paymentHash`, `settled`, `preimage`, `settledAt`       |
| `lightning_address_get_invoice` | `read`  | `address` (`name@domain`, any domain), `amountSats`, `comment`?              | `address`, `bolt11`, `paymentHash`, `amountSats`, `expiresAt`       |
| `wallet_pay_invoice`            | `spend` | `bolt11`, `amountSats`? (only for an invoice without an amount), `walletId`? | Payment status and the remaining budget — see [Payments](#payments) |
| `wallet_list_payments`          | `read`  | `limit`? (1–50, default 20)                                                  | This connection's payments, newest first, and its budget            |

- `wallet_make_invoice` creates an invoice that pays into the user's wallet;
  `wallet_lookup_invoice` checks whether it was paid.
- `lightning_address_get_invoice` fetches an invoice from any lightning address
  through LNURL-pay. **No funds move**; it prepares an invoice that
  `wallet_pay_invoice` can pay. It fetches over HTTPS only, refuses private
  network addresses, sends `comment` only when the recipient accepts comments,
  and the invoice can be up to 10 sats below the requested amount when the
  recipient rounds.

### Promoted operations

Common REST operations are offered as tools with friendly names and flat
arguments. Their input schemas come from the OpenAPI document, and a call runs
the real REST handler (see [How a tool call runs](#how-a-tool-call-runs)).

| Tool                         | Operation                                                                     | Scope   | Minimum role |
| ---------------------------- | ----------------------------------------------------------------------------- | ------- | ------------ |
| `resolve_lightning_address`  | `lud16.payRequest` — `GET /api/lud16/{username}`                              | public  | —            |
| `request_address_invoice`    | `lud16.callback` — `GET /api/lud16/{username}/cb`                             | public  | —            |
| `verify_address_payment`     | `lud16.verify` — `GET /api/lud16/{username}/verify/{paymentHash}`             | public  | —            |
| `check_address_availability` | `lightningAddresses.check` — `GET /api/lightning-addresses/check`             | public  | —            |
| `get_my_account`             | `users.me` — `GET /api/users/me`                                              | `read`  | USER         |
| `list_lightning_addresses`   | `wallet.addresses.list` — `GET /api/wallet/addresses`                         | `read`  | USER         |
| `get_lightning_address`      | `wallet.addresses.get` — `GET /api/wallet/addresses/{username}`               | `read`  | USER         |
| `list_address_invoices`      | `wallet.addresses.invoices` — `GET /api/wallet/addresses/{username}/invoices` | `read`  | USER         |
| `list_wallets`               | `remoteWallets.list` — `GET /api/remote-wallets`                              | `read`  | USER         |
| `list_my_cards`              | `wallet.cards.list` — `GET /api/wallet/cards`                                 | `read`  | USER         |
| `get_settings`               | `settings.get` — `GET /api/settings`                                          | `read`  | USER         |
| `list_cards`                 | `cards.list` — `GET /api/cards`                                               | `read`  | VIEWER       |
| `get_card`                   | `cards.get` — `GET /api/cards/{id}`                                           | `read`  | VIEWER       |
| `list_users`                 | `users.list` — `GET /api/users`                                               | `read`  | VIEWER       |
| `list_activity`              | `activity.list` — `GET /api/activity`                                         | `read`  | VIEWER       |
| `create_lightning_address`   | `wallet.addresses.create` — `POST /api/wallet/addresses`                      | `write` | USER         |

- The four public tools concern addresses **on this instance** (`username` is
  the part before the `@`). To get an invoice from an address elsewhere, use
  `lightning_address_get_invoice`.
- **`request_address_invoice` takes `amount` in millisats**, as LUD-06
  requires, although the field name does not say so. It mints an invoice for
  someone to pay _to_ that address; no funds leave any wallet.
- `resolve_lightning_address` returns the LUD-06 pay request, whose
  `minSendable` and `maxSendable` are millisats.
- `get_my_account` returns the account with its wallet connection string
  replaced by `[redacted]` (see [Security](#security)).

### The API gateway

Three generic tools reach the rest of the REST API without a tool per
operation:

| Tool                  | Scope                               | Does                                             |
| --------------------- | ----------------------------------- | ------------------------------------------------ |
| `api_list_operations` | none                                | Searches the operations this connection may call |
| `api_read`            | `read` (none for public operations) | Calls a read operation by `operationId`          |
| `api_write`           | `write`                             | Calls a write operation by `operationId`         |

- `api_list_operations` takes `query` (words matched against the operation's
  id, path, summary, description and tag), `tag` (for example `Cards`),
  `access` (`read` or `write`) and `limit` (1–100, default 25). It returns
  `total` and, per operation: `operationId`, `method`, `path`, `summary`,
  `tag`, `access`, `requiredRole`, `tool` (`api_read` or `api_write`) and
  `inputSchema`. It lists only operations the caller may call; without
  `write`, a note says write operations are hidden.
- `api_read` and `api_write` take `operationId` and `params` — the path and
  query parameters plus the body fields, as described by `inputSchema`. A body
  that is not an object, or whose field names clash with a parameter, goes
  under `params.body` instead; `inputSchema` shows which.
- Reads are `GET` operations plus two `POST`s that only read
  (`nostr.profiles.resolve`, `wallet.addresses.probeAlias`). Writes are
  everything else, plus one `GET` that mints an invoice (`lud16.callback`).
  Calling an operation with the wrong tool returns an error naming the right
  one.
- A typical agent flow: call `api_list_operations` with a few words, pick an
  operation, then call `api_read` or `api_write` with its `operationId` and the
  arguments its `inputSchema` describes.

### How a tool call runs

Promoted and gateway tools call the operation's real route handler
in-process, so validation, role checks, ownership checks, rate limits,
maintenance mode and activity logging are exactly those of the REST API.

- A REST error comes back as an `isError: true` result carrying the HTTP
  status and the API's (sanitized) error body, so the model can correct
  itself.
- For an OAuth connection, the handler is called with an internal session JWT
  for the connected account, valid for 60 seconds and never sent outside the
  process. Its role is re-read from the database on every request, so a
  demoted account loses its privileges at once. For a session JWT, the
  caller's own token is passed through.
- Wallet tools and `get_instance_info` run without a REST round-trip and apply
  maintenance mode themselves.
- Every result is one text block holding JSON. Results longer than 80,000
  characters are cut, with a note asking the agent to narrow the request.

### Not exposed

An operation is reachable only if it is in the OpenAPI document and
classified as read or write in `lib/mcp/policy.ts`; anything new is refused
until someone classifies it. These are excluded on purpose and stay in the web
app:

| What                                                  | Operations                                                                                                                                                                                                                                                                                                                   | Why                                                                                                                                                                             |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Moving funds out of a wallet                          | `wallet.addresses.proxyBalance.forward`, `remoteWallets.receiveAction.force`, `remoteWallets.forwardingReceipts.retry`, `lud16Proxy.payments.retry`, `cards.scan.callback`, `cards.emulateTap`, `wallet.vouchers.send`                                                                                                       | Spending happens only in `wallet_pay_invoice`, inside the daily limit                                                                                                           |
| Changing where incoming funds go, outside the account | `wallet.addresses.update` (alias and proxy modes forward to any external address), `remoteWallets.create` (adds an external wallet, which can become the default), `remoteWallets.receiveAction.configure`, `remoteWallets.receiveAction.toggle`, `wallet.addresses.invoices.forwarding.recover`, `lud16Proxy.config.update` | An agent that could repoint an address could take future payments without touching the daily limit                                                                              |
| Freeing a username                                    | `wallet.addresses.delete`, `users.lightningAddress.set` (replaces the primary address by deleting the old one)                                                                                                                                                                                                               | Anyone could then register the username and receive the payments sent to it                                                                                                     |
| Leaking incoming-payment details                      | `remoteWallets.notifications.create`                                                                                                                                                                                                                                                                                         | Sends details of every incoming payment to any webhook URL or Nostr key the caller names                                                                                        |
| Binding a card to a wallet                            | `cards.update`, `cards.otc.activate`, `activationTokens.claim`, `wallet.cards.update` (also moves the account-recovery MASTER card)                                                                                                                                                                                          | Whoever holds the card can then spend from the wallet by tapping                                                                                                                |
| Card claim credentials (activation QRs)               | `cards.create`, `cards.activationTokens.create`, `cards.activationTokens.list`, `cards.rescue`                                                                                                                                                                                                                               | They mint or expose a credential; claiming it binds the card to a wallet                                                                                                        |
| Instance configuration and privileges                 | `settings.update`, `settings.domainProbe`, `settings.listenerProbe`, `plugins.update`, `users.role.set`, `lud16Proxy.config.test`                                                                                                                                                                                            | They change instance-wide settings and plugins, reach the root admin, secrets and payment destinations, hand another account those powers, or send stored credentials elsewhere |
| Credential minting and session plumbing               | `auth.qrJwt.generate`, `auth.validate`, `auth.protected.get`, `auth.protected.post`; everything under `/api/oauth` and `/api/mcp`                                                                                                                                                                                            | An agent must not mint or manage credentials, including a broader connection for itself                                                                                         |
| Account security                                      | `passkey.registration.options`, `passkey.registration.verify`, `passkey.credentials.update`, `passkey.credentials.delete`, `account.link.*`, `account.merge*`, `account.identities.*`                                                                                                                                        | These need the user's own authenticator or keys                                                                                                                                 |
| BoltCard device protocol and key material             | `cards.write`, `cards.writeToken`, `cards.wipe`, `cards.scan`, `cards.lnurlp`, `cards.lnurlp.callback`, `cards.otc.get`                                                                                                                                                                                                      | Called by the card or a paying wallet; some return or mint card keys, and the one-time code is a claim credential                                                               |
| Device pairing, setup callbacks, voucher delivery     | `remoteConnections.get`, `remoteConnections.cards.create`, `setup.verify.get`, `setup.verify.post`, `lud16.callbackAction`                                                                                                                                                                                                   | Protocol endpoints for devices and other servers; the device key in the path is a credential                                                                                    |
| Operations that do not take a Bearer token            | `POST /api/jwt` (`auth.exchange`), `admin.assign.*`, `cardDesigns.getById` (NIP-98 only); CORS preflights; everything under `/api/internal`, `/api/dev`, `/api/webhooks`, `/api/events`                                                                                                                                      | Agents hold no NIP-98 signature, listener secret or SSE token                                                                                                                   |

`passkey.credentials.list` and `account.get` stay readable. An agent cannot
add an external wallet (an NWC connection string) — add those in the web app.
When the instance enables LNCurl, a `write` connection can create a disposable
LNCurl wallet (`remoteWallets.createLncurl`); the instance mints and keeps its
connection string, and with `isDefault: true` binds the account's primary
lightning address to it.

## Payments

Spending exists in exactly one place: `wallet_pay_invoice`. It needs an OAuth
connection with the `spend` scope and a daily limit; session tokens are
refused.

### What happens on a call

1. The invoice is decoded. A `lightning:` prefix is accepted. An invoice with
   an amount must not be given a different `amountSats`; an invoice without
   one needs `amountSats`. The budget is charged the invoice amount rounded up
   to whole sats.
2. The wallet is resolved (primary unless `walletId` is given).
3. If the account already paid, or is paying, this invoice through MCP, the
   stored result is returned — nothing is sent again (see
   [Paying twice](#paying-twice)).
4. The wallet must be able to send: its connection must allow `pay_invoice`.
   Expired invoices are refused.
5. In one database transaction, holding a lock on the connection, the instance
   checks that the connection is still valid, sums its last 24 hours, refuses
   the payment if its amount plus the fee reserve (see
   [The daily spend limit](#the-daily-spend-limit)) does not fit, and records
   it as `PENDING`. Nothing reaches
   the wallet before this record exists.
6. The wallet pays. The tool waits up to 45 seconds for the answer.

Every result includes the budget after the operation:
`{ limitSats, spentLast24hSats, remainingSats }`.

### Paying twice

Repeating a call never pays twice. The ledger holds at most one payment per
wallet and payment hash, and the instance also refuses to pay an invoice that
any wallet of the account already paid, or is paying, through MCP. A repeat
returns the stored result (`alreadyPaid: true` once paid). The ledger only
knows payments made through this tool — not payments made in the web app or
elsewhere.

### Payment status

| Status      | Meaning                                                                                                                                                                                                                                                                   | Daily limit | What the agent must do                                                                                |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ----------------------------------------------------------------------------------------------------- |
| `SUCCEEDED` | Paid. The result includes `preimage` (proof of payment, only to the connection that paid) and `feesPaidSats`.                                                                                                                                                             | Charged     | Nothing. Repeating returns the stored result.                                                         |
| `FAILED`    | The wallet refused the payment before sending anything (`INSUFFICIENT_BALANCE`, `QUOTA_EXCEEDED`, `RESTRICTED`, `UNAUTHORIZED`, `NOT_IMPLEMENTED` or `RATE_LIMITED`), or a later lookup proved it failed. No funds left. Returned as an error result with the error code. | Released    | Fix the cause (for example the balance). Calling again retries the payment.                           |
| `PENDING`   | Another call is paying this invoice right now.                                                                                                                                                                                                                            | Charged     | Do not retry. Check `wallet_list_payments` in a few minutes.                                          |
| `UNKNOWN`   | The outcome could not be confirmed: no answer within 45 seconds, a lost connection, any other wallet rejection (including `PAYMENT_FAILED`, `INTERNAL` or no error code), an unexpected error, or a preimage that does not match. The funds may have left.                | Charged     | Do not retry and do not pay another invoice for the same purpose. Check `wallet_list_payments` later. |

The instance re-checks unresolved payments with the wallet — a read-only
lookup, for payments older than a minute — when the agent calls
`wallet_list_payments` (up to five per call) or repeats `wallet_pay_invoice`
with the same invoice. A payment the wallet reports as settled becomes
`SUCCEEDED`; one it reports as failed becomes `FAILED` and releases its share
of the limit. A late answer from the original payment is recorded too. A
rejection other than the pre-flight codes above is not proof of failure — a
wallet can report `PAYMENT_FAILED` while the payment is still in flight (a
payee can hold it open on purpose) — so such a payment stays `UNKNOWN`, its
budget held, until a lookup shows it failed.

`wallet_list_payments` returns this connection's payments, newest first
(`paymentId`, `walletId`, `paymentHash`, `amountSats`, `feesPaidSats`,
`status`, `preimage`, `error`, `createdAt`, `resolvedAt`), and the budget. It
only covers OAuth connections; payments are recorded per connection.

## Security

- **Secrets never reach the model.** Every tool result is scanned before it is
  returned: any string holding an NWC connection string
  (`nostr+walletconnect:` or `nostrwalletconnect:`) or an `nsec1…` key is
  replaced with a `[redacted …]` marker, and values under keys that name secret
  material are replaced with `[redacted]` — names containing `secret`, `nsec`,
  `privatekey`, `connectionstring`, `nwcstring`, `nwcuri`, `password`,
  `mnemonic`, `devicekey`, `accesstoken` or `refreshtoken`, plus the card keys
  `k0`–`k4`, the card one-time code `otc`, `nonce`, `voucherEvent`, and the
  card activation token fields `tokenId` and `qrPayload`. Any string holding a
  card activation link (`/wallet/activate/…`) is replaced as well, whatever
  its key. An agent never needs these: wallet tools use the connection stored
  on the instance.
- **Do not paste an NWC connection string, an nsec, or an admin token into a
  chat or a shared agent configuration.** Whatever the model reads can be
  repeated or exfiltrated, and a connection string spends without any daily
  limit.
- **Least privilege.** Connect with `read` when that is enough; add `write`
  only for agents that must change things, and `spend` only with a limit you
  can afford to lose. `write` is broad: besides addresses and invoices it can,
  for example, change which of your wallets is the default, remove a wallet
  from the account, or create an LNCurl wallet and make it the default. An admin who connects an agent hands it their
  admin permissions (except what is [not exposed](#not-exposed)); use a
  separate member account for day-to-day agent use.
- **Prompt injection.** Text that arrives through tools — payment comments,
  invoice descriptions, names, activity messages, anything fetched from other
  servers — is untrusted and may contain instructions. The server tells
  agents to treat it as data, but a model can still be misled. That is why
  `spend` is off by default and always capped, and why `wallet_pay_invoice` is
  marked destructive: keep your client's confirmation on for it.
- **Revocation.** Revoke any app at once under Connected apps. Connections
  unused for 30 days expire on their own.
- **Audit trail.** The activity log (Admin → Activity) records
  `user.oauth_grant_created` (at warning level when `spend` is granted, with the
  limit), `user.oauth_grant_revoked` (by the user, by the app, when a newer
  approval of the same app replaces it, or because an authorization code was
  replayed), `nwc.mcp_payment_sent` (at warning level
  when the outcome is unknown) and `nwc.mcp_payment_failed`. Operations run
  through tools log their usual REST activity events. The server log has one
  `mcp.tool_call` line per call with the tool name, the first 8 characters of
  the pubkey, the app name, the outcome and the duration — never arguments or
  tokens.
- **Stored credentials.** Codes and tokens are stored only as SHA-256 hashes;
  the consent page cannot be framed, and the app's name on it is treated as an
  unverified claim.

## Troubleshooting

### 401, or the client keeps asking to sign in

Check what the instance answers:

```bash
curl -si https://<instance>/api/mcp \
  -H "Authorization: Bearer $LAWALLET_MCP_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

The `error_description` in the 401 body says why:

- `Access token was issued for a different resource` — the `endpoint` setting
  changed since the app connected, or the app connected through a different
  URL. Connect again with the canonical URL.
- `Access token has been revoked` / `Unknown access token` — the connection
  was revoked, or replaced by a newer approval. Connect again.
- `Access token has expired` — the client should refresh on its own. If
  refreshing fails too (the connection was unused for 30 days, or a refresh
  answer was lost and the rotated token is gone), connect again.
- `Invalid or expired JWT` — a session token expired or belongs to another
  instance. Renew it; Claude Code does not fall back to OAuth while a header is
  configured.
- `Device tokens cannot be used here; connect through OAuth or use a session token`
  — a device token was sent. `/api/mcp` refuses device tokens; connect through
  OAuth or use a session JWT. (A device token can also fail an earlier check
  with ``Device tokens cannot be verified until `endpoint` is configured`` or
  `Token is not valid for this instance`; the fix is the same.)
- `Authorization required` — no token reached the instance. A reverse proxy
  may be dropping the `Authorization` header, or the URL redirects to another
  host. (`Only Bearer tokens are accepted here` means a header arrived with
  another scheme, such as a NIP-98 `Nostr` header.)

### Wrong instance URL

Symptoms: the client refuses to sign in and reports that the protected
resource does not match, the consent page says **Can't connect this app** with
`invalid_target`, or every call fails with
`Access token was issued for a different resource`.

The URL given to the client must be exactly the canonical MCP URL — the one in
Connected apps, which comes from the `endpoint` setting. Common mismatches:
`http` versus `https`, `www` versus the bare domain, a local IP versus the
public name, a missing `/api/mcp`. If the canonical URL itself is wrong, an
operator fixes the `endpoint` setting; users then connect again.

### Payments are refused

| Message starts with                                                                  | Cause and fix                                                                                                                                                                               |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Sending payments needs the "spend" scope, which only an OAuth connection can grant` | The caller uses a session token. Connect through OAuth and tick **Send payments**.                                                                                                          |
| `This needs the "spend" scope`                                                       | The OAuth connection was approved without **Send payments**. Revoke it and connect again with a daily limit.                                                                                |
| `This connection has no daily spend limit`                                           | Connect again and set a limit.                                                                                                                                                              |
| `Paying … would exceed this connection's daily budget`                               | The amount plus the fee reserve (1%, at least 10 sats) does not fit in what is left. Wait for earlier payments to leave the 24-hour window, or connect again with a higher limit.           |
| `Wallet "…" cannot send payments`                                                    | The wallet's NWC connection does not allow `pay_invoice` (a receive-only connection), or the wallet could not be reached. Use another `walletId`, or replace the connection in the web app. |
| `Wallet "…" is … and cannot be used`                                                 | The wallet is not active. Pick an active one from `list_wallets`.                                                                                                                           |
| `No walletId was given and this account has no primary wallet`                       | Pass a `walletId` from `list_wallets`.                                                                                                                                                      |
| `This invoice has expired`                                                           | Ask the payee for a new invoice.                                                                                                                                                            |
| `This connection was revoked or may no longer send payments`                         | The connection was revoked during the call. Nothing was sent.                                                                                                                               |

### Tools are missing

- The connection lacks a scope: `api_write`, `wallet_make_invoice` and
  `create_lightning_address` need `write`; `wallet_pay_invoice` needs `spend`.
  Call `get_instance_info` to see the connection's scopes.
- The account's role is too low: `list_cards`, `get_card`, `list_users` and
  `list_activity` need VIEWER or above.
- ChatGPT: press **Refresh** on the app after reconnecting.
- The client is connected to `/api/mcp/public`, which only serves public tools.

### A hosted client cannot reach the instance

ChatGPT, Claude (all surfaces), the Claude API and the OpenAI API connect from
their providers' servers: a `umbrel.local` name or a private IP address does
not work. Expose the instance on a public HTTPS URL (or a tunnel), set
`endpoint` to that URL, and connect again. Claude Code, Cursor and the
Inspector reach local addresses directly.

### The consent page asks you to sign in again

The consent page opens in your browser, not in the installed wallet app. If
you installed the wallet as a home-screen app, the browser may not share its
sign-in, so sign in again on the consent page. Use **Switch account** if the
page shows the wrong account.

### A payment is reported as UNKNOWN

The wallet did not confirm the outcome in time, or rejected the payment with
an error that does not prove nothing was sent; the funds may have left. Do not
pay again. Call `wallet_list_payments` after a few minutes: the instance
asks the wallet what happened and updates the status. Until it resolves, the
payment counts against the daily limit. The wallet's own history is the final
word.

### HTTP 429

The MCP endpoint allows, per minute and by default, 300 requests per signed-in
account and 60 per IP address for anonymous calls (`RATE_LIMIT_MAX_REQUESTS_AUTH`,
`RATE_LIMIT_MAX_REQUESTS`, `RATE_LIMIT_WINDOW_MS`). Hosted clients call from
their providers' shared addresses, so anonymous requests from many of their
users share one limit. The token endpoint allows 60 requests per minute per IP
address and registration 30. Operations run through tools keep their own REST
limits. Every call inside a JSON-RPC batch counts as one request. Wait for
the `Retry-After` seconds.

### Other errors

- Tool calls fail with status 503 for everyone but admins: the instance is in
  maintenance mode.
- `Internal error` (`-32603`) on every call: check the server log for
  `mcp.caller_failed` or `mcp.request_failed`.
- HTTP 413: the request body exceeds `REQUEST_MAX_JSON_SIZE` (100 KB by
  default).

## Protocol notes

For client implementers and anyone debugging at the wire level.

### Transport

- Streamable HTTP, **stateless**: every `POST` gets one `application/json`
  answer. No SSE stream, no session: `Mcp-Session-Id` is never issued.
- `GET` and `DELETE` answer 405. `OPTIONS` is the CORS preflight.
- CORS allows any origin — authentication is a bearer token, never a cookie.
  Allowed request headers: `Authorization`, `Content-Type`,
  `Mcp-Protocol-Version`, `Mcp-Method`, `Mcp-Name`, `Mcp-Session-Id`,
  `Last-Event-ID`. `WWW-Authenticate` is exposed.
- A JSON-RPC notification (no `id`) gets 202 with an empty body.

### Protocol revisions

Both eras are served on both URLs:

- **2026-07-28** (modern): a request whose
  `params._meta["io.modelcontextprotocol/protocolVersion"]` is present.
  Methods: `server/discover`, `tools/list`, `tools/call`. The
  `MCP-Protocol-Version` header must equal the `_meta` version, `Mcp-Method`
  must equal `method`, and on `tools/call` `Mcp-Name` must equal `params.name`
  (the `=?base64?…?=` form is decoded first). `_meta["io.modelcontextprotocol/clientCapabilities"]`
  is required.
- **2025-11-25, 2025-06-18, 2025-03-26, 2024-11-05** (legacy): everything
  else. Methods: `initialize`, `ping`, `tools/list`, `tools/call`.
  `initialize` echoes the client's version when it is one of these, and
  answers `2025-11-25` otherwise. The `MCP-Protocol-Version` header is optional
  but, when present, must name one of these. JSON-RPC batches (2025-03-26) of
  1 to 20 messages are answered with an array; every call in a batch counts
  against the rate limit.

Every result carries `resultType: "complete"` and
`_meta["io.modelcontextprotocol/serverInfo"]` (`name: "lawallet-nwc"` and the
version). `tools/list` results carry `ttlMs: 60000` and `cacheScope`: `private`
on `/api/mcp` (the list depends on the token), `public` on `/api/mcp/public`.
`initialize` answers `serverInfo` (`name: "lawallet-nwc"`, `title: "LaWallet"`,
`version`), `capabilities: { tools: { listChanged: false } }` and
`instructions`, whose essentials fit in the first 500 characters.
`server/discover` answers `supportedVersions` (modern first),
`capabilities: { tools: {} }`, the same `instructions`, `ttlMs` and
`cacheScope: "public"`.

A modern request by hand:

```bash
curl -s https://<instance>/api/mcp/public \
  -H 'Content-Type: application/json' \
  -H 'MCP-Protocol-Version: 2026-07-28' \
  -H 'Mcp-Method: server/discover' \
  -d '{"jsonrpc":"2.0","id":1,"method":"server/discover","params":{"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientCapabilities":{}}}}'
```

### Errors

| Code     | Meaning                                                              | HTTP status                                                    |
| -------- | -------------------------------------------------------------------- | -------------------------------------------------------------- |
| `-32700` | Parse error                                                          | 400                                                            |
| `-32600` | Invalid request (bad envelope, empty or oversized batch)             | 400                                                            |
| `-32602` | Invalid params, unknown tool, missing client capabilities            | 400; 200 in legacy for an unknown tool or non-object arguments |
| `-32601` | Method not found                                                     | 404 modern, 200 legacy                                         |
| `-32020` | A `Mcp-*` or `MCP-Protocol-Version` header disagrees with the body   | 400                                                            |
| `-32022` | Unsupported protocol version; `data` has `supported` and `requested` | 400                                                            |
| `-32603` | Internal error                                                       | 200                                                            |

A well-formed request never gets a 5xx or an empty 2xx: dual-era clients
probe with a modern request and treat either as a hard failure. Tool failures
are results with `isError: true` at HTTP 200.

Without valid credentials `/api/mcp` answers 401 with
`WWW-Authenticate: Bearer resource_metadata="https://<instance>/.well-known/oauth-protected-resource/api/mcp"`
(plus `, error="invalid_token"` when a token was presented and rejected) and a
body of `{ "error": "unauthorized" | "invalid_token", "error_description": "…" }`.
The challenge names no `scope` on purpose.

### Authorization server

The instance is its own OAuth 2.1 authorization server; its issuer is the
instance URL.

| Document or endpoint                     | URL                                                                                                         |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Protected resource metadata (RFC 9728)   | `/.well-known/oauth-protected-resource/api/mcp` and `/.well-known/oauth-protected-resource` (same document) |
| Authorization server metadata (RFC 8414) | `/.well-known/oauth-authorization-server`                                                                   |
| Authorization (consent page)             | `/oauth/authorize`                                                                                          |
| Token                                    | `POST /api/oauth/token`                                                                                     |
| Dynamic client registration (RFC 7591)   | `POST /api/oauth/register`                                                                                  |
| Revocation (RFC 7009)                    | `POST /api/oauth/revoke`                                                                                    |
| Connected apps                           | `GET /api/oauth/grants`, `DELETE /api/oauth/grants/{id}` (signed-in session; device tokens refused)         |

- **Clients are public**: `token_endpoint_auth_method: "none"`, whatever the
  registration asks for. PKCE with `S256` is required. Grant types:
  `authorization_code` and `refresh_token`; every refresh rotates both tokens.
- **Registration** needs only `redirect_uris` (1 to 10); other metadata is
  ignored except `client_name`, which is stripped of control and formatting
  characters, cut to 100 characters, and defaults to `MCP client`. Redirect
  URIs: `https:` on any host; `http:` only on `localhost`, `127.0.0.1` or
  `[::1]`, matched ignoring the port; native app schemes such as `cursor://`;
  never `javascript:`, `data:`, `vbscript:`, `file:`, `blob:`, `about:`,
  `ws:`, `wss:`, `ftp:`, `chrome:`, `view-source:` or `intent:`; no fragment;
  at most 2,000 characters each and 4,096 in total. Registrations never used to connect an account are
  deleted after 30 days; one with any connection is kept.
- **Client ID metadata documents are not supported yet** — dynamic client
  registration only. That is why claude.ai users must choose **Register
  automatically**.
- **`resource`** (RFC 8707) may be the MCP URL or the instance's bare origin;
  anything else is `invalid_target`. Connections always store the canonical MCP
  URL.
- **`iss`** (RFC 9207) is returned on every authorization response, success or
  `access_denied`, and advertised with
  `authorization_response_iss_parameter_supported: true`.
- The metadata lists `scopes_supported: ["read", "write", "spend"]` — no
  `offline_access` and no OpenID scopes; refresh tokens are issued without
  being asked for.
- Protocol errors use the RFC 6749 shape `{ "error", "error_description" }`
  with status 400. Token and registration responses carry
  `Cache-Control: no-store`.
- The token endpoint accepts `application/x-www-form-urlencoded` and JSON.

## Code map

| Path                                                            | Role                                                                           |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `apps/web/app/api/mcp/route.ts`, `…/public/route.ts`            | The two endpoints (`POST` only, `maxDuration = 60`)                            |
| `apps/web/lib/mcp/protocol.ts`                                  | JSON-RPC handling, both protocol eras, server instructions                     |
| `apps/web/lib/mcp/caller.ts`                                    | Resolves the caller from the bearer token; the 401 challenge                   |
| `apps/web/lib/mcp/tools.ts`                                     | Tool registry, filtering by scope and role, result redaction and size cap      |
| `apps/web/lib/mcp/catalog.ts`                                   | OpenAPI document → operation catalog with input schemas                        |
| `apps/web/lib/mcp/policy.ts`                                    | Which operations are read, write or excluded; the promoted tools               |
| `apps/web/lib/mcp/dispatch.ts`                                  | Runs an operation's route handler in-process                                   |
| `apps/web/lib/mcp/route-manifest.ts`                            | Generated map from OpenAPI path to route module                                |
| `apps/web/lib/mcp/wallet-tools.ts`, `instance-tools.ts`         | Native tools; the payment ledger and daily limit                               |
| `apps/web/lib/mcp/redact.ts`                                    | Secret redaction                                                               |
| `apps/web/lib/oauth/`                                           | Scopes, lifetimes, metadata, clients, connections (grants), token verification |
| `apps/web/app/api/oauth/**`, `apps/web/app/.well-known/oauth-*` | OAuth endpoints and discovery documents                                        |
| `apps/web/app/oauth/authorize/`, `apps/web/components/oauth/`   | Consent page and Connected apps                                                |
| `packages/openapi/src/paths/mcp.ts`, `oauth.ts`                 | OpenAPI operations for the endpoints above                                     |

Two rules are easy to break:

- **Classify every new OpenAPI operation** in `OPERATION_POLICY`
  (`apps/web/lib/mcp/policy.ts`) as read, write or excluded.
  `apps/web/tests/unit/lib/mcp/policy.test.ts` fails on an unclassified
  operation. Exclude anything that moves funds or changes where they go.
- **Regenerate the route manifest** with `pnpm docs:sync` (from the repository
  root) after adding, moving or deleting a route. `pnpm docs:check` — the "Docs
  Drift" CI job — fails when it is stale.
