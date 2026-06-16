#!/usr/bin/env bash

set -uo pipefail

ROOT="${1:-/Users/agustinkassis/Development}"
HOURS="${2:-48}"
OUT_DIR="${OUT_DIR:-/tmp/woocommerce-search-$(date +%Y%m%d-%H%M%S)}"
DEEP_GIT="${DEEP_GIT:-0}"
MAX_REFS="${MAX_REFS:-25}"

PATTERN="${PATTERN:-woocommerce|woo[ -]?commerce|WC_Payment_Gateway|woocommerce_payment_gateways|Plugin Name:|wp-content/plugins|add_filter\\([^)]*woocommerce|add_action\\([^)]*woocommerce|payment_gateway}"
PATH_PATTERN="${PATH_PATTERN:-woocommerce|woo-commerce|woo_commerce|wp-content/plugins|wordpress}"

WINDOW_MINUTES=$((HOURS * 60))

mkdir -p "$OUT_DIR"

PROJECT_CANDIDATES="$OUT_DIR/project-candidates.txt"
RECENT_PROJECTS="$OUT_DIR/recent-projects.txt"
RECENT_FILES="$OUT_DIR/recent-files.txt"
PATH_HITS="$OUT_DIR/path-hits.txt"
FILE_HITS="$OUT_DIR/file-hits.txt"
GIT_GREP_HITS="$OUT_DIR/git-grep-hits.txt"
GIT_PATH_HITS="$OUT_DIR/git-path-hits.txt"
GIT_LOG_HITS="$OUT_DIR/git-log-hits.txt"
SUMMARY="$OUT_DIR/summary.txt"

: > "$PROJECT_CANDIDATES"
: > "$RECENT_PROJECTS"
: > "$RECENT_FILES"
: > "$PATH_HITS"
: > "$FILE_HITS"
: > "$GIT_GREP_HITS"
: > "$GIT_PATH_HITS"
: > "$GIT_LOG_HITS"

prune_expr=(
  -name .git -o
  -name node_modules -o
  -name .next -o
  -name dist -o
  -name build -o
  -name coverage -o
  -name .turbo -o
  -name .cache -o
  -name .venv -o
  -name vendor -o
  -name __pycache__
)

rg_globs=(
  --hidden
  --glob '!**/.git/**'
  --glob '!**/node_modules/**'
  --glob '!**/.next/**'
  --glob '!**/dist/**'
  --glob '!**/build/**'
  --glob '!**/coverage/**'
  --glob '!**/.turbo/**'
  --glob '!**/.cache/**'
  --glob '!**/.venv/**'
  --glob '!**/vendor/**'
  --glob '!**/__pycache__/**'
)

git_text_pathspec=(
  '*.php'
  '*.inc'
  '*.phtml'
  '*.md'
  '*.mdx'
  '*.txt'
  '*.json'
  '*.yml'
  '*.yaml'
  '*.toml'
  '*.ini'
  '*.xml'
  '*.html'
  '*.css'
  '*.js'
  '*.jsx'
  '*.ts'
  '*.tsx'
  '*.mjs'
  '*.cjs'
  'composer.json'
  'package.json'
  'README*'
)

notice() {
  printf '%s\n' "$*" >&2
}

has_recent_files() {
  local dir="$1"

  find "$dir" \
    \( "${prune_expr[@]}" \) -prune -o \
    -type f -mmin "-$WINDOW_MINUTES" -print -quit 2>/dev/null |
    grep -q .
}

has_recent_git_activity() {
  local dir="$1"
  local latest

  latest="$(git -C "$dir" log --all --since="$HOURS hours ago" -1 --format=%H 2>/dev/null || true)"
  [ -n "$latest" ]
}

discover_git_projects() {
  find "$ROOT" \
    \( -name node_modules -o -name .next -o -name dist -o -name build -o -name coverage -o -name .turbo -o -name .cache -o -name .venv -o -name vendor -o -name __pycache__ \) -prune -o \
    -name .git -print 2>/dev/null |
    while IFS= read -r git_marker; do
      local dir top
      dir="$(dirname "$git_marker")"
      top="$(git -C "$dir" rev-parse --show-toplevel 2>/dev/null || printf '%s\n' "$dir")"
      printf '%s\n' "$top"
    done
}

discover_marker_projects() {
  find "$ROOT" -maxdepth 6 \
    \( -name node_modules -o -name .next -o -name dist -o -name build -o -name coverage -o -name .turbo -o -name .cache -o -name .venv -o -name vendor -o -name __pycache__ \) -prune -o \
    \( -name package.json -o -name composer.json -o -name wp-config.php -o -name pnpm-workspace.yaml -o -name turbo.json -o -name vite.config.ts -o -name next.config.js -o -name next.config.mjs \) -print 2>/dev/null |
    while IFS= read -r marker; do
      dirname "$marker"
    done
}

scan_filesystem_for_recent_matches() {
  notice "Scanning recent files under $ROOT..."

  find "$ROOT" \
    \( "${prune_expr[@]}" \) -prune -o \
    -type f -mmin "-$WINDOW_MINUTES" -print 2>/dev/null |
    tee "$RECENT_FILES" |
    grep -Ei "$PATH_PATTERN" > "$PATH_HITS" || true

  if command -v rg >/dev/null 2>&1; then
    if [ -s "$RECENT_FILES" ]; then
      xargs -0 rg -n -i -S "$PATTERN" --no-heading < <(tr '\n' '\0' < "$RECENT_FILES") > "$FILE_HITS" 2>/dev/null || true
    fi
  else
    notice "rg not found; skipping content search for recent loose files."
  fi
}

scan_project_files() {
  local project="$1"

  if command -v rg >/dev/null 2>&1; then
    {
      printf '\n## %s\n' "$project"
      rg -n -i -S "$PATTERN" "${rg_globs[@]}" "$project" 2>/dev/null || true
    } >> "$FILE_HITS"
  fi
}

git_refs_for_project() {
  local project="$1"

  if [ "$DEEP_GIT" = "1" ]; then
    git -C "$project" for-each-ref --format='%(refname)' refs/heads refs/remotes refs/tags 2>/dev/null |
      grep -v '/HEAD$' || true
  else
    git -C "$project" for-each-ref --sort=-committerdate --format='%(refname)' refs/heads refs/remotes 2>/dev/null |
      grep -v '/HEAD$' |
      head -n "$MAX_REFS" || true
  fi
}

scan_project_git() {
  local project="$1"
  local refs

  git -C "$project" rev-parse --is-inside-work-tree >/dev/null 2>&1 || return 0

  refs="$(git_refs_for_project "$project")"
  if [ -n "$refs" ]; then
    {
      printf '\n## %s\n' "$project"
      printf '# refs scanned: %s%s\n' "$(printf '%s\n' "$refs" | wc -l | tr -d ' ')" "$([ "$DEEP_GIT" = "1" ] && printf ' (deep)' || printf ' (recent refs)')"
      # shellcheck disable=SC2086
      git -C "$project" grep -n -i -I -E "$PATTERN" $refs -- "${git_text_pathspec[@]}" 2>/dev/null || true
    } >> "$GIT_GREP_HITS"

    {
      printf '\n## %s\n' "$project"
      while IFS= read -r ref; do
        git -C "$project" ls-tree -r --name-only "$ref" 2>/dev/null |
          awk -v ref="$ref" -v pat="$PATH_PATTERN" 'tolower($0) ~ tolower(pat) { print ref ":" $0 }'
      done <<< "$refs"
    } >> "$GIT_PATH_HITS"
  fi

  {
    printf '\n## %s\n' "$project"
    if [ "$DEEP_GIT" = "1" ]; then
      git -C "$project" log --all --decorate --oneline --regexp-ignore-case \
        --grep='woocommerce\|woo commerce\|wordpress plugin\|payment gateway' 2>/dev/null || true
      git -C "$project" log --all --decorate --oneline \
        -G'woocommerce|WooCommerce|WC_Payment_Gateway|woocommerce_payment_gateways|Plugin Name:|payment_gateway' -- . 2>/dev/null || true
    elif [ -n "$refs" ]; then
      # shellcheck disable=SC2086
      git -C "$project" log $refs --since="$HOURS hours ago" --decorate --oneline --regexp-ignore-case \
        --grep='woocommerce\|woo commerce\|wordpress plugin\|payment gateway' 2>/dev/null || true
      # shellcheck disable=SC2086
      git -C "$project" log $refs --since="$HOURS hours ago" --decorate --oneline \
        -G'woocommerce|WooCommerce|WC_Payment_Gateway|woocommerce_payment_gateways|Plugin Name:|payment_gateway' -- . 2>/dev/null || true
    fi
  } >> "$GIT_LOG_HITS"
}

notice "Discovering projects under $ROOT..."
{
  discover_git_projects
  discover_marker_projects
} | sort -u > "$PROJECT_CANDIDATES"

notice "Filtering projects with activity in the last $HOURS hours..."
while IFS= read -r project; do
  [ -d "$project" ] || continue

  if has_recent_files "$project" || has_recent_git_activity "$project"; then
    printf '%s\n' "$project" >> "$RECENT_PROJECTS"
  fi
done < "$PROJECT_CANDIDATES"

scan_filesystem_for_recent_matches

notice "Scanning recent projects and their Git refs/history..."
while IFS= read -r project; do
  [ -d "$project" ] || continue
  notice "  - $project"
  scan_project_files "$project"
  scan_project_git "$project"
done < "$RECENT_PROJECTS"

{
  printf 'WooCommerce search report\n'
  printf '=========================\n\n'
  printf 'Root: %s\n' "$ROOT"
  printf 'Recent window: %s hours\n' "$HOURS"
  printf 'Regex: %s\n' "$PATTERN"
  printf 'Deep Git mode: %s\n' "$DEEP_GIT"
  printf 'Max refs per repo in fast mode: %s\n' "$MAX_REFS"
  printf 'Output dir: %s\n\n' "$OUT_DIR"
  printf 'Candidate projects: %s\n' "$(wc -l < "$PROJECT_CANDIDATES" | tr -d ' ')"
  printf 'Recent projects scanned: %s\n' "$(wc -l < "$RECENT_PROJECTS" | tr -d ' ')"
  printf 'Recent files inspected: %s\n\n' "$(wc -l < "$RECENT_FILES" | tr -d ' ')"

  printf 'Files with matching paths:\n'
  if [ -s "$PATH_HITS" ]; then
    sed 's/^/  /' "$PATH_HITS"
  else
    printf '  none\n'
  fi

  printf '\nReports:\n'
  printf '  %s\n' "$RECENT_PROJECTS"
  printf '  %s\n' "$PATH_HITS"
  printf '  %s\n' "$FILE_HITS"
  printf '  %s\n' "$GIT_GREP_HITS"
  printf '  %s\n' "$GIT_PATH_HITS"
  printf '  %s\n' "$GIT_LOG_HITS"
} > "$SUMMARY"

cat "$SUMMARY"
