#!/usr/bin/env bash
# A7.4 — local TLS harness bootstrap. Idempotent. Reads SAN list from the
# generated `mkcert-sans.txt` and writes `local-harness/certs/{cert,key}.pem`.
# Run once after `bun run setup:env` to mint the cert; the Caddyfile points
# at the resulting files.

set -euo pipefail

HARNESS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SANS_FILE="${HARNESS_DIR}/mkcert-sans.txt"
CERT_DIR="${HARNESS_DIR}/certs"

if ! command -v mkcert >/dev/null 2>&1; then
  echo "Error: mkcert not installed."
  echo "  macOS:   brew install mkcert"
  echo "  Linux:   see https://github.com/FiloSottile/mkcert#installation"
  exit 1
fi

if [ ! -f "${SANS_FILE}" ]; then
  echo "Error: ${SANS_FILE} not found. Run \`bun run setup:env\` first."
  exit 1
fi

mkcert -install >/dev/null

mkdir -p "${CERT_DIR}"

# Read SANs (strip blank lines) into an array.
SANS=()
while IFS= read -r line; do
  if [ -n "${line}" ]; then
    SANS+=("${line}")
  fi
done < "${SANS_FILE}"

if [ "${#SANS[@]}" -eq 0 ]; then
  echo "Error: ${SANS_FILE} contained zero SANs."
  exit 1
fi

mkcert \
  -cert-file "${CERT_DIR}/cert.pem" \
  -key-file "${CERT_DIR}/key.pem" \
  "${SANS[@]}"

chmod 0644 "${CERT_DIR}/cert.pem"
chmod 0600 "${CERT_DIR}/key.pem"

echo "  Wrote ${CERT_DIR}/cert.pem"
echo "  Wrote ${CERT_DIR}/key.pem"
echo
echo "Next: caddy run --config ${HARNESS_DIR}/Caddyfile"
