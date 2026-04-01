#!/usr/bin/env bash
# Generate workspace .env files from the root .env.
# Run from repo root: bun run setup:env

set -euo pipefail

ROOT_ENV=".env"

if [ ! -f "$ROOT_ENV" ]; then
  echo "Error: $ROOT_ENV not found. Copy .env.example first:"
  echo "  cp .env.example .env"
  exit 1
fi

# Extract a variable value from root .env (skips comments and blank lines)
get_var() {
  grep -E "^$1=" "$ROOT_ENV" | head -1 | cut -d'=' -f2-
}

# --- packages/db/.env (database credentials for drizzle-kit) ------------------
cat > packages/db/.env <<EOF
NODE_ENV=$(get_var NODE_ENV)
DATABASE_URL=$(get_var DATABASE_URL)
DATABASE_TEST_URL=$(get_var DATABASE_TEST_URL)
EOF
echo "  Generated packages/db/.env"

# --- apps/server/.env (wrangler secrets) --------------------------------------
cat > apps/server/.env <<EOF
NODE_ENV=$(get_var NODE_ENV)
FIREBASE_SERVICE_ACCOUNT_KEY_BASE64=$(get_var FIREBASE_SERVICE_ACCOUNT_KEY_BASE64)
RESEND_API_KEY=$(get_var RESEND_API_KEY)
VAULT_MASTER_KEY=$(get_var VAULT_MASTER_KEY)
EOF
echo "  Generated apps/server/.env"

# --- apps/auth/.env (wrangler secrets) ----------------------------------------
cat > apps/auth/.env <<EOF
NODE_ENV=$(get_var NODE_ENV)
BETTER_AUTH_SECRET=$(get_var BETTER_AUTH_SECRET)
RESEND_API_KEY=$(get_var RESEND_API_KEY)
EOF
echo "  Generated apps/auth/.env"

# --- apps/web/.env (Vite public vars) -----------------------------------------
cat > apps/web/.env <<EOF
NODE_ENV=$(get_var NODE_ENV)
VITE_SERVER_URL=$(get_var VITE_SERVER_URL)
EOF
echo "  Generated apps/web/.env"

echo ""
echo "Done. Workspace .env files generated from root .env."
