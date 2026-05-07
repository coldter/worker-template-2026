#!/usr/bin/env bash
# Generate workspace .dev.vars (worker secrets) and .env (non-wrangler) from root .env.
# Run from repo root: bun run setup:env
#
# Non-secret env-specific vars (NODE_ENV, APP_URL, CORS_ORIGINS) live in
# wrangler.jsonc "vars" and are overridden at deploy time via --var flags.
# .dev.vars files only contain secrets needed by wrangler dev.

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

# --- apps/server/.dev.vars (wrangler secrets only) ----------------------------
cat > apps/server/.dev.vars <<EOF
FIREBASE_SERVICE_ACCOUNT_KEY_BASE64=$(get_var FIREBASE_SERVICE_ACCOUNT_KEY_BASE64)
RESEND_API_KEY=$(get_var RESEND_API_KEY)
VAULT_MASTER_KEY=$(get_var VAULT_MASTER_KEY)
SSO_KEY=$(get_var SSO_KEY)
EOF
echo "  Generated apps/server/.dev.vars"

# --- apps/auth/.dev.vars (wrangler secrets only) ------------------------------
cat > apps/auth/.dev.vars <<EOF
BETTER_AUTH_SECRET=$(get_var BETTER_AUTH_SECRET)
RESEND_API_KEY=$(get_var RESEND_API_KEY)
EOF
echo "  Generated apps/auth/.dev.vars"

# --- apps/admin-ui/.env (Vite public vars) ------------------------------------
cat > apps/admin-ui/.env <<EOF
NODE_ENV=$(get_var NODE_ENV)
VITE_SERVER_URL=$(get_var VITE_SERVER_URL)
EOF
echo "  Generated apps/admin-ui/.env"

echo ""
echo "Done. Worker .dev.vars (secrets) and .env files generated from root .env."
