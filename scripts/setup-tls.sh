#!/usr/bin/env bash
# Obtain Let's Encrypt TLS certificates before the first deployment.
# Requires DNS pointing at this machine and ports 80/443 open.
set -euo pipefail

BASE_DOMAIN="${SITEDOCK_BASE_DOMAIN:-sitedock.us.ci}"
EMAIL="${ACME_EMAIL:-admin@${BASE_DOMAIN}}"
DOMAINS=("api.${BASE_DOMAIN}" "www.${BASE_DOMAIN}" "app.${BASE_DOMAIN}" "admin.${BASE_DOMAIN}")

echo "=== Generating TLS certificates with Caddy ==="

if [ "${EMAIL}" = "admin@${BASE_DOMAIN}" ] && [ -z "${ACME_EMAIL:-}" ]; then
  echo "WARNING: ACME_EMAIL is not set. Edit .env before continuing."
fi

for domain in "${DOMAINS[@]}"; do
  echo "Caddy will request the certificate for ${domain} on startup."
done

echo "Done. Run: docker compose up -d"
echo "Caddy will obtain and renew certificates automatically."
