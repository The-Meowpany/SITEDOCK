#!/usr/bin/env bash
# Despliegue en entorno de Staging
set -euo pipefail

ENVIRONMENT="staging"
COMPOSE_FILE="docker-compose.staging.yml"

echo "=== Despliegue SiteDock en ${ENVIRONMENT} ==="

# 1. Verificar variables requeridas
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
    echo "ERROR: Variable requerida no definida: ${var}"
    exit 1
  fi
done

# 2. Copiar variables de entorno
cp .env.example .env.${ENVIRONMENT}

# 3. Ejecutar migraciones de base de datos
echo "Ejecutando migraciones de base de datos..."
npx prisma migrate deploy --schema packages/database/schema.prisma

# 4. Construir y levantar servicios
echo "Levantando contenedores..."
docker compose -f "${COMPOSE_FILE}" up -d --build

# 5. Verificar health checks
echo "Verificando health checks..."
for i in $(seq 1 30); do
  if curl -sf http://localhost:4000/health/ready > /dev/null 2>&1; then
    echo "API lista."
    break
  fi
  echo "Esperando a la API... (${i}/30)"
  sleep 2
done

# 6. Ejecutar E2E contra staging
echo "Ejecutando tests E2E..."
npm run e2e

echo "=== Despliegue en ${ENVIRONMENT} completado ==="
