# Environment Capability Audit

> Fase 23 §1 — auditoría del entorno de ejecución.
> Principio: no asumir nada. Clasificar cada capacidad con evidencia.

## Herramientas disponibles

| Herramienta | Versión | Estado |
|------------|---------|--------|
| Node.js | v26.3.0 | ✅ AVAILABLE |
| npm | 11.16.0 | ✅ AVAILABLE |
| git | ✅ | AVAILABLE |

## Infraestructura NO disponible

| Herramienta | Estado | Bloquea |
|------------|--------|---------|
| Docker | ❌ NOT INSTALLED | Build de imágenes, E2E en contenedores |
| Docker Compose | ❌ NOT INSTALLED | PostgreSQL local, stack completo |
| PostgreSQL | ❌ NOT INSTALLED (no psql, no servicio) | Migraciones, E2E real, repositorios Prisma |

## Verificaciones clasificadas

| Verificación | Clasificación | Bloqueador |
|---|---|---|
| Tests unitarios (dominio) | ✅ **AVAILABLE** — 250 tests ejecutándose | Ninguno |
| Smoke HTTP tests | ✅ **AVAILABLE** — 10 tests contra createApp() real | Ninguno |
| Lint / Typecheck / Build | ✅ **AVAILABLE** — todos pasando | Ninguno |
| npm audit | ✅ **AVAILABLE** — 8 hallazgos analizados | Ninguno |
| Secret scanning | ✅ **AVAILABLE** — escaneo estático limpio | Ninguno |
| Dockerfiles (análisis estático) | ✅ **AVAILABLE** — auditados sin build | Ninguno |
| CI/CD workflow | ✅ **AVAILABLE** — auditado y endurecido | Ninguno |
| PostgreSQL E2E | ❌ **UNAVAILABLE** | Requiere Postgres real |
| Docker build + run | ❌ **UNAVAILABLE** | Requiere Docker daemon |
| Stripe sandbox E2E | 🔑 **REQUIRES_CREDENTIALS** | STRIPE_SECRET_KEY + STRIPE_WEBHOOK_SECRET |
| S3 sandbox E2E | 🔑 **REQUIRES_CREDENTIALS** | S3_BUCKET + S3_REGION + credenciales IAM |
| Resend sandbox E2E | 🔑 **REQUIRES_CREDENTIALS** | RESEND_API_KEY + RESEND_FROM |
| Backup/restore drill | ❌ **UNAVAILABLE** | Requiere Postgres + S3 reales |
| TLS / reverse proxy | ❌ **UNAVAILABLE** | Requiere dominio + certificado |

## Acción concreta para desbloquear cada ítem

| Ítem bloqueado | Acción única que lo desbloquea |
|---|---|
| PostgreSQL E2E | `docker compose up -d` → `npm run db:migrate` → `npm run e2e` |
| Docker build | Instalar Docker Desktop → `docker build -t sitedock-api apps/api/` |
| Stripe sandbox | Crear cuenta Stripe → obtener claves test → configurar env vars |
| S3 sandbox | Crear bucket → crear credenciales IAM → configurar env vars |
| Resend sandbox | Crear cuenta Resend → verificar dominio → obtener API key |
