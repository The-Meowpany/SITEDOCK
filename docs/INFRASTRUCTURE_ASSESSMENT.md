# Infrastructure Assessment

> Fase 20 — evaluación honesta de lo que existe y lo que falta para deploy.
> Principio: la menor infraestructura confiable. Sin Kubernetes.

## Lo que YA existe en el repo

| Componente | Estado | Ubicación |
|---|---|---|
| docker-compose.yml | IMPLEMENTED | Postgres 16 + healthcheck |
| GitHub Actions CI | IMPLEMENTED | .github/workflows/ci.yml |
| Schema Prisma | IMPLEMENTED | packages/database/prisma/schema.prisma |
| Health checks | IMPLEMENTED | /health/live (sin BD) + /health/ready (con BD) |
| E2E script | IMPLEMENTED | scripts/e2e-demo.mjs |
| Rate limiting | IMPLEMENTED | express-rate-limit por endpoint |
| Provider metrics | IMPLEMENTED | providerMetrics + GET /admin/metrics |
| Dockerfile apps | **MISSING** | No hay ningún Dockerfile |

## Lo que falta para el primer deploy real

### 1. Dockerfiles (3 imágenes pequeñas)

```
apps/api:       Node 20 slim → npm ci → tsc → node dist/server.js
apps/dashboard: Node 20 → next build → next start
apps/web:       Node 20 → next build → next start
```

Cada una < 200MB con multi-stage. No requieren Kubernetes.

### 2. Postgres gestionado

Recomendación: Neon, Supabase, o RDS según presupuesto. El schema se aplica
con `prisma migrate dev` (primera vez) y `prisma migrate deploy` (subsecuentes).

### 3. Object storage

S3 (o MinIO self-hosted para staging). Ya implementado vía `STORAGE_PROVIDER=s3`.

### 4. Secretos

Variables de entorno inyectadas por la plataforma de deploy
(Railway/Fly.io/Render/ECS). Nunca en el repo. `validateProductionConfig()`
bloquea arranque si faltan.

### 5. Reverse proxy + TLS

Caddy (automático Let's Encrypt) o Cloudflare delante. Tres dominios:
- api.tudominio.com → :4000
- app.tudominio.com → :3001 (dashboard)
- tudominio.com → :3000 (portal cliente)

### 6. Monitoring mínimo

- Uptime: UptimeRobot/BetterUptime sobre /health/live
- Métricas: GET /api/v1/admin/metrics (JSON) scrapeado o revisado manualmente
- Logs: pino JSON a stdout → recopilados por la plataforma

### 7. Backup de Postgres

pg_dump cron diario → S3 (el mismo bucket ya configurado).
Restauración: pg_restore + verificación con el flujo E2E.

## Decisión IaC

**NO usar Terraform/Pulumi todavía.**

Justificación:
- 1 equipo pequeño, 1 entorno inicial, 3 contenedores
- Railway/Fly.io/Render despliegan desde Dockerfile sin IaC
- Terraform añade valor cuando hay >2 entornos o >5 recursos cloud que cambian frecuentemente

**Cuándo reconsiderar**: al agregar un segundo entorno estable (staging) o
múltiples regiones. En ese momento, Terraform para: DNS, S3, IAM, secrets.

## Deploy recomendado (mínimo viable)

Railway o Fly.io: detectan Dockerfile, provisionan Postgres managed, inyectan
secrets como variables de entorno, TLS automático, health checks nativos.
Costo marginal ~$15-30/mes para 100 developers / 1000 websites.
