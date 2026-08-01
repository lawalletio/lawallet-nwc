#!/usr/bin/env bash
set -euo pipefail

umask 077

usage() {
  cat <<'USAGE'
Provision secrets for and deploy apps/listener to Fly.io.

Usage:
  ./scripts/deploy-listener-fly.sh [options]

Options:
  --app NAME              Fly app name. Default: lawallet-listener
  --web-origin URL        Base URL of apps/web — the webhook target.
  --from-vercel SCOPE/PRJ Read DATABASE_URL_UNPOOLED from that Vercel
                          project's production environment, so the credential
                          never passes through a shell history or clipboard.
  --database-url URL      Supply the Postgres URL directly instead.
  --secrets-only          Stage secrets, skip the deploy.
  --deploy-only           Skip secrets, just deploy.
  --help                  Show this help.

The listener refuses to boot without DATABASE_URL, WEB_ORIGIN,
LISTENER_AUTH_SECRET and NWC_VAULT_SECRET (Zod-validated in
apps/listener/src/env.ts). Secrets already set on the app are left alone;
the two shared ones are generated on first run and printed once, because you
need the same values on the web side.

DATABASE_URL must be a DIRECT connection. The wallet-change listener holds a
dedicated LISTEN client, and transaction-mode poolers drop LISTEN/NOTIFY
silently — this script refuses a pooled URL rather than let you find out via
wallets that only reconcile every five minutes.
USAGE
}

app="lawallet-listener"
web_origin=""
from_vercel=""
database_url=""
do_secrets=1
do_deploy=1

while [[ $# -gt 0 ]]; do
  case "$1" in
    --app)
      [[ $# -ge 2 ]] || { echo "Missing value for --app." >&2; exit 2; }
      app="$2"; shift 2 ;;
    --web-origin)
      [[ $# -ge 2 ]] || { echo "Missing value for --web-origin." >&2; exit 2; }
      web_origin="$2"; shift 2 ;;
    --from-vercel)
      [[ $# -ge 2 ]] || { echo "Missing value for --from-vercel." >&2; exit 2; }
      from_vercel="$2"; shift 2 ;;
    --database-url)
      [[ $# -ge 2 ]] || { echo "Missing value for --database-url." >&2; exit 2; }
      database_url="$2"; shift 2 ;;
    --secrets-only) do_deploy=0; shift ;;
    --deploy-only) do_secrets=0; shift ;;
    --help|-h) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
done

# The Docker build context must be the repo root — apps/listener/Dockerfile
# copies the root lockfile and packages/shared.
if [[ ! -f apps/listener/fly.toml ]]; then
  echo "Run this from the repository root (apps/listener/fly.toml not found)." >&2
  exit 1
fi

command -v fly >/dev/null 2>&1 || {
  echo "flyctl not found. Install it with: brew install flyctl" >&2
  exit 1
}

fly auth whoami >/dev/null 2>&1 || {
  echo "flyctl is not authenticated. Run: fly auth login" >&2
  exit 1
}

fly apps list 2>/dev/null | awk '{print $1}' | grep -qx "$app" || {
  echo "Fly app '$app' does not exist. Create it with: fly apps create $app" >&2
  exit 1
}

# ── secrets ───────────────────────────────────────────────────────────────
if [[ "$do_secrets" == "1" ]]; then
  existing=$(fly secrets list --app "$app" 2>/dev/null | awk 'NR>1 {print $1}')
  has_secret() { grep -qx "$1" <<<"$existing"; }

  if [[ -n "$from_vercel" && -z "$database_url" ]]; then
    command -v vercel >/dev/null 2>&1 || {
      echo "--from-vercel needs the Vercel CLI on PATH." >&2
      exit 1
    }
    scope="${from_vercel%%/*}"
    project="${from_vercel##*/}"
    [[ "$scope" != "$from_vercel" ]] || {
      echo "--from-vercel expects SCOPE/PROJECT (e.g. lacrypta/lawallet-nwc)." >&2
      exit 2
    }
    work=$(mktemp -d)
    trap 'rm -rf "$work"' EXIT
    echo "==> Reading DATABASE_URL_UNPOOLED from $scope/$project (production)"
    (
      cd "$work"
      vercel link --scope "$scope" --project "$project" --yes >/dev/null 2>&1
      vercel env pull .env.prod --environment=production --yes >/dev/null 2>&1
    ) || { echo "Could not pull the Vercel environment." >&2; exit 1; }
    database_url=$(grep -m1 '^DATABASE_URL_UNPOOLED=' "$work/.env.prod" | cut -d= -f2- | tr -d '"') || true
    [[ -n "$database_url" ]] || {
      echo "DATABASE_URL_UNPOOLED not found in $scope/$project production." >&2
      exit 1
    }
  fi

  args=()

  if [[ -n "$database_url" ]]; then
    host=$(printf '%s' "$database_url" | sed -E 's#^[^:]+://[^@]*@([^/?]+).*#\1#')
    case "$host" in
      *-pooler.*|*:6543)
        echo "Refusing a pooled connection string ($host)." >&2
        echo "The listener needs a DIRECT Postgres connection — transaction-mode" >&2
        echo "poolers drop LISTEN/NOTIFY. Use Neon's DATABASE_URL_UNPOOLED host," >&2
        echo "or Supabase port 5432 instead of 6543." >&2
        exit 1 ;;
    esac
    echo "    database host: $host"
    args+=("DATABASE_URL=$database_url")
  elif ! has_secret DATABASE_URL; then
    echo "DATABASE_URL is not set on '$app'. Pass --database-url or --from-vercel." >&2
    exit 1
  fi

  if [[ -n "$web_origin" ]]; then
    args+=("WEB_ORIGIN=$web_origin")
  elif ! has_secret WEB_ORIGIN; then
    echo "WEB_ORIGIN is not set on '$app'. Pass --web-origin https://your-web-host." >&2
    exit 1
  fi

  # Shared with the web side. Generated once, then never rotated silently:
  # changing NWC_VAULT_SECRET after wallets are encrypted makes them
  # undecryptable, and changing LISTENER_AUTH_SECRET breaks the pairing.
  generated=""
  for name in LISTENER_AUTH_SECRET NWC_VAULT_SECRET; do
    if ! has_secret "$name"; then
      value=$(openssl rand -hex 32)
      args+=("$name=$value")
      generated+="  $name = $value"$'\n'
    fi
  done

  if [[ ${#args[@]} -gt 0 ]]; then
    echo "==> Staging secrets on $app"
    fly secrets set --app "$app" --stage "${args[@]}" >/dev/null
    printf '    set: %s\n' "${args[@]%%=*}"
  else
    echo "==> All required secrets already present on $app"
  fi
fi

# ── deploy ────────────────────────────────────────────────────────────────
if [[ "$do_deploy" == "1" ]]; then
  echo "==> Deploying $app (context: repo root)"
  fly deploy --config apps/listener/fly.toml --app "$app"
fi

if [[ -n "${generated:-}" ]]; then
  cat <<EOF

────────────────────────────────────────────────────────────────────────
Generated secrets — copy them now, they are not recoverable from Fly:

$generated
Both are SHARED with the web app:

  * LISTENER_AUTH_SECRET → web admin, Settings ▸ NWC Services: paste it with
    the listener URL, then enable the toggle and hit Test connection.
  * NWC_VAULT_SECRET → set the identical value on the web host before any
    RemoteWallet gets encrypted, or web and listener end up with different
    vault keys.
────────────────────────────────────────────────────────────────────────
EOF
fi

echo
echo "Health:  curl https://$app.fly.dev/health"
echo "Logs:    fly logs --app $app"
