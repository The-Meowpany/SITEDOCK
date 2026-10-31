#!/usr/bin/env bash
# Production environment deployment
set -euo pipefail

ENVIRONMENT="production"
COMPOSE_FILE="docker-compose.production.yml"
BASE_DOMAIN="${SITEDOCK_BASE_DOMAIN:-sitedock.us.ci}"
API_HOST="${SITEDOCK_API_HOST:-api.${BASE_DOMAIN}}"
ADMIN_HOST="${SITEDOCK_ADMIN_HOST:-admin.${BASE_DOMAIN}}"

echo "=== Deploying SiteDock to ${ENVIRONMENT} ==="

# 1. Verify required variables (no default values)
REQUIRED_VARS=(
  "POSTGRES_PASSWORD"
  "STRIPE_SECRET_KEY"
  "STRIPE_WEBHOOK_SECRET"
  "S3_BUCKET"
  "S3_ACCESS_KEY_ID"
  "S3_SECRET_ACCESS_KEY"
  "RESEND_API_KEY"
  "RESEND_FROM"
  "ACME_EMAIL"
  "CORS_ORIGIN"
  "COOKIE_DOMAIN"
  "SITEDOCK_BASE_DOMAIN"
  "SITEDOCK_PUBLIC_IP"
  "TLS_ASK_SECRET"
)

for var in "${REQUIRED_VARS[@]}"; do
  if [ -z "${!var:-}" ]; then
    echo "ERROR: Required variable not set: ${var}"
    exit 1
  fi
done

if [ "${DOMAIN_PROVIDER:-dnshe}" = "dnshe" ]; then
  for var in DNSHE_API_KEY DNSHE_API_SECRET; do
    if [ -z "${!var:-}" ]; then
      echo "ERROR: DOMAIN_PROVIDER=dnshe requires ${var}"
      exit 1
    fi
  done
fi

# 2. Confirm NODE_ENV=production
if [ "${NODE_ENV:-}" != "production" ]; then
  echo "ERROR: NODE_ENV must be 'production' to deploy to production"
  exit 1
fi

# 3. Run database migrations
echo "Running database migrations..."
npx prisma migrate deploy --schema packages/database/prisma/schema.prisma

# 4. Build and start services (without --build if images already exist in the registry)
echo "Starting containers..."
docker compose -f "${COMPOSE_FILE}" up -d

# 5. Verify health checks
echo "Checking health endpoints..."
for i in $(seq 1 60); do
  if curl -sf https://${API_HOST}/health/ready > /dev/null 2>&1; then
    echo "API is ready."
    break
  fi
  echo "Waiting for the API... (${i}/60)"
  sleep 5
done

# 6. Run E2E against production (smoke)
echo "Running E2E (smoke) tests..."
npm run e2e

# 7. Verify payment reconciliation
echo "Verifying payment reconciliation..."
curl -sf https://${ADMIN_HOST}/admin/reconciliation || true

echo "=== Deployment to ${ENVIRONMENT} completed ==="
