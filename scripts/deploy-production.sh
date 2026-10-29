#!/usr/bin/env bash
# Despliegue en entorno de Producción
set -euo pipefail

ENVIRONMENT="production"
COMPOSE_FILE="docker-compose.production.yml"
BASE_DOMAIN="${SITEDOCK_BASE_DOMAIN:-sitedock.us.ci}"
API_HOST="${SITEDOCK_API_HOST:-api.${BASE_DOMAIN}}"
ADMIN_HOST="${SITEDOCK_ADMIN_HOST:-admin.${BASE_DOMAIN}}"

echo "=== Despliegue SiteDock en ${ENVIRONMENT} ==="

# 1. Verificar variables requeridas (no valores por defecto)
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
    echo "ERROR: Variable requerida no definida: ${var}"
    exit 1
  fi
done

if [ "${DOMAIN_PROVIDER:-dnshe}" = "dnshe" ]; then
  for var in DNSHE_API_KEY DNSHE_API_SECRET; do
    if [ -z "${!var:-}" ]; then
      echo "ERROR: DOMAIN_PROVIDER=dnshe requiere ${var}"
      exit 1
    fi
  done
fi

# 2. Confirmar NODE_ENV=production
if [ "${NODE_ENV:-}" != "production" ]; then
  echo "ERROR: NODE_ENV debe ser 'production' para desplegar en producción"
  exit 1
fi

# 3. Ejecutar migraciones de base de datos
echo "Ejecutando migraciones de base de datos..."
npx prisma migrate deploy --schema packages/database/prisma/schema.prisma

# 4. Construir y levantar servicios (sin --build si ya hay imágenes en registry)
echo "Levantando contenedores..."
docker compose -f "${COMPOSE_FILE}" up -d

# 5. Verificar health checks
echo "Verificando health checks..."
for i in $(seq 1 60); do
  if curl -sf https://${API_HOST}/health/ready > /dev/null 2>&1; then
    echo "API lista."
    break
  fi
  echo "Esperando a la API... (${i}/60)"
  sleep 5
done

# 6. Ejecutar E2E contra producción (smoke)
echo "Ejecutando tests E2E (smoke)..."
npm run e2e

# 7. Verificar reconciliación de pagos
echo "Verificando reconciliación de pagos..."
curl -sf https://${ADMIN_HOST}/admin/reconciliation || true

echo "=== Despliegue en ${ENVIRONMENT} completado ==="
