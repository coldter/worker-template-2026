#!/usr/bin/env bash

set -euo pipefail

ROOT_ENV=".env"

if [ ! -f "$ROOT_ENV" ]; then
  echo "Error: $ROOT_ENV not found. Copy .env.example first:"
  echo "  cp .env.example .env"
  exit 1
fi

get_var() {
  grep -E "^$1=" "$ROOT_ENV" | head -1 | cut -d'=' -f2-
}

write_env_file() {
  local target="$1"
  shift
  local keys=("$@")
  local generated
  generated="$(mktemp)"

  local key
  for key in "${keys[@]}"; do
    printf '%s=%s\n' "$key" "$(get_var "$key")" >> "$generated"
  done

  if [ -f "$target" ]; then
    local line existing managed
    while IFS= read -r line || [ -n "$line" ]; do
      if [[ ! "$line" =~ ^[A-Za-z_][A-Za-z0-9_]*= ]]; then
        continue
      fi
      existing="${line%%=*}"
      managed=false
      for key in "${keys[@]}"; do
        if [ "$existing" = "$key" ]; then
          managed=true
          break
        fi
      done
      if [ "$managed" = false ]; then
        printf '%s\n' "$line" >> "$generated"
      fi
    done < "$target"
  fi

  mv "$generated" "$target"
  echo "  Generated $target"
}

write_env_file packages/db/.env \
  NODE_ENV DATABASE_URL DATABASE_TEST_URL

write_env_file apps/server/.dev.vars \
  FIREBASE_SERVICE_ACCOUNT_KEY_BASE64 RESEND_API_KEY VAULT_MASTER_KEY

write_env_file apps/auth/.dev.vars \
  BETTER_AUTH_SECRET RESEND_API_KEY

WEB_KEYS=(NODE_ENV APP_URL)
while IFS= read -r key; do
  WEB_KEYS+=("$key")
done < <(grep -E '^VITE_[A-Za-z0-9_]+=' "$ROOT_ENV" | cut -d'=' -f1)

write_env_file apps/web/.env "${WEB_KEYS[@]}"

echo ""
echo "Done. Worker .dev.vars (secrets) and .env files generated from root .env."
