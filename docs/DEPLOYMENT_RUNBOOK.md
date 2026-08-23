# Deployment Runbook

> Runbook de deployment paso a paso. Cada paso incluye prerequisitos,
> comando, output esperado, condición de fallo y recuperación.

## Pre-requisitos globales

- Node.js ≥ 20
- npm ≥ 10
- Docker (para PostgreSQL local o imágenes)
- Acceso al repositorio
- Credenciales de providers (Stripe, S3, Resend) según entorno

---

## Paso 1: DATABASE

**Prerequisites:** PostgreSQL 16 accesible.

```bash
# Verificar conexión
psql $DATABASE_URL -c "SELECT 1"
```

**Output esperado:** `1`

**Si falla:** Verificar DATABASE_URL, firewall, credenciales.

---

## Paso 2: ENVIRONMENT

**Prerequisites:** `.env` configurado con todas las variables requeridas.

```bash
cp .env.example .env
# Editar .env con valores reales para el entorno
```

**Verificar fail-closed:**

El API valida la configuración al arrancar (`validateProductionConfig`).
En producción con PAYMENT_PROVIDER=stripe sin STRIPE_SECRET_KEY → exit(1).

---

## Paso 3: MIGRATIONS

```bash
npm run db:generate -w packages/database
npm run db:migrate -w packages/database
```

**Output esperado:** migraciones aplicadas sin errores.

**Si falla:** verificar DATABASE_URL y permisos DDL del usuario.

---

## Paso 4: BUILD

```bash
npm ci
npm run build -w apps/api -w apps/dashboard -w apps/web
```

**Output esperado:** builds sin errores en los 3 apps.

---

## Paso 5: START

### Desarrollo local

```bash
npm run dev
```

### Producción (Docker)

```bash
docker build -t sitedock-api apps/api/
docker run -d --name sitedock-api -p 4000:4000 \
  --env-file .env \
  sitedock-api
```

---

## Paso 6: HEALTH CHECK

```bash
curl http://localhost:4000/health/live   # 200 {"status":"ok"}
curl http://localhost:4000/health/ready  # 200 si Postgres responde
```

---

## Paso 7: SMOKE TEST

```bash
# Registro + login + workspace
curl -X POST http://localhost:4000/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"smoke@test.com","password":"supersecret","fullName":"Smoke"}'

curl -c cookies.txt -X POST http://localhost:4000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"smoke@test.com","password":"supersecret"}'

curl -b cookies.txt -X POST http://localhost:4000/api/v1/workspaces \
  -H "Content-Type: application/json" \
  -d '{"name":"Smoke Test WS"}'
```

O ejecutar el E2E completo:

```bash
npm run e2e
```

---

## Paso 8: PROVIDERS

Configurar según entorno (ver PRODUCTION_CONFIGURATION_MATRIX.md):

- Stripe: webhook endpoint → `{BASE}/api/v1/webhooks/payments/stripe`
- S3: bucket + credenciales IAM
- Resend: API key + dominio verificado

---

## Rollback

Si el deploy falla después de aplicar:

1. Identificar el paso que falló
2. Si es código: revertir a la imagen/tag anterior
3. Si es migración: crear migración inversa (no hay rollback automático)
4. Si es configuración: corregir env vars y reiniciar
