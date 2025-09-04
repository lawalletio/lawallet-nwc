# Environment Variables

## Required

You can leave it as is for local development.

```bash
## Public access
NEXT_PUBLIC_DOMAIN=localhost:3000
NEXT_PUBLIC_ENDPOINT=http://localhost:3000
```

You can leave it as is for local development.

```bash
## Database
DATABASE_URL="file:./dev.db"
```

## Optional

Required for subscribing to the waitlist provided in the landing page.
Uses [Sendy](https://sendy.co/) API to subscribe to the waitlist.

```bash
## Email
SENDY_URL="https://sendy.url"
SENDY_API_KEY="SENDY_API_KEY"
SENDY_LIST_ID="LIST_ID"
```

## Alby

Optional for creating Alby subaccounts for users.
You need to set `AUTO_GENERATE_ALBY_SUBACCOUNTS` to `true` to automatically create subaccounts (NWC) for users.
Requires an [Alby](https://albyhub.com/) instance. Local or remotely hosted.

```bash
ALBY_API_URL="http://umbrel.local:5900/api"
ALBY_BEARER_TOKEN="Generated in Alby Hub"
AUTO_GENERATE_ALBY_SUBACCOUNTS="false"
```
