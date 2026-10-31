#!/usr/bin/env bash
# Staging environment deployment
set -euo pipefail

ENVIRONMENT="staging"
COMPOSE_FILE="docker-compose.staging.yml"

echo "=== Deploying SiteDock to ${ENVIRONMENT} ==="

# 1. Verify required variables
REQUIRED_VARS=(
  "POSTGRES_PASSWORD"
  "STRIPE_SECRET_KEY"
  "STRIPE_WEBHOOK_SECRET"
  "S3_BUCKET"
  "S3_ACCESS_KEY_ID"
  "S3_SECRET_ACCESS_KEY"
  "RESEND_API_KEY"
  "ACME_EMAIL"
  "CORS_ORIGIN"
)

for var in "${REQUIRED_VARS[@]}"; do
  if [ -z "${!var:-}" ]; then
    echo "ERROR: Required variable not set: ${var}"
    exit 1
  fi
done

# 2. Copy environment variables
cp .env.example .env.${ENVIRONMENT}

# 3. Run database migrations
echo "Running database migrations..."
npx prisma migrate deploy --schema packages/database/schema.prisma

# 4. Build and start services
echo "Starting containers..."
docker compose -f "${COMPOSE_FILE}" up -d --build

# 5. Verify health checks
echo "Checking health endpoints..."
for i in $(seq 1 30); do
  if curl -sf http://localhost:4000/health/ready > /dev/null 2>&1; then
    echo "API is ready."
    break
  fi
  echo "Waiting for the API... (${i}/30)"
  sleep 2
done

# 6. Run E2E against staging
echo "Running E2E tests..."
npm run e2e

echo "=== Deployment to ${ENVIRONMENT} completed ==="
