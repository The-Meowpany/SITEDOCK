# SiteDock

**Recurring Website Infrastructure for Freelancers.**

SiteDock convierte un proyecto web de pago unico en un servicio mensual: el
freelancer desarrolla el sitio una vez y la plataforma gestiona hosting,
deployment, dominios, SSL, backups, clientes, suscripciones y cobros
recurrentes.

No es "otro hosting". Es la infraestructura tecnica **y financiera** para que
un desarrollador convierta un proyecto en ingreso recurrente.

## Arquitectura

Modular Monolith + Async Workers (DDD tactico, Clean/Hexagonal por bounded
context). Un backend Express, tres frontends Next.js 15, PostgreSQL,
Stripe Connect, S3, Resend.

```
Internet -> Reverse Proxy/TLS -> API (:4000)
                                  |- PostgreSQL
                                  |- Stripe (pagos + Connect)
                                  |- S3 (deployments + backups)
                                  |- Resend (emails)
                                  `- Workers (jobs programados)

Dashboard Developer (:3001) --+
Portal Cliente (:3000) -------+-- consumen API REST v1
Admin Console (:3002) --------+
```

## Capacidades principales

- Multi-tenant con aislamiento estructural (workspace/client/website)
- Deployments versionados e inmutables con rollback
- Suscripciones recurrentes con tiers de mantenimiento customizables
- Cobros unicos por proyecto separados de la membresia mensual
- Backups con verificacion de integridad SHA-256
- Renovacion automatica de certificados SSL
- Solicitudes de mantenimiento con cuota por tier
- Stripe Connect para pagos reales del freelancer
- Audit log append-only de acciones criticas

## Stack

| Capa | Tecnologia |
|------|-----------|
| Backend | Node 20 - TypeScript - Express |
| Base de datos | PostgreSQL 16 - Prisma ORM |
| Frontend | Next.js 15 - React 18 - CSS Modules |
| Pagos | Stripe (Connect Express) - Mock provider para demo |
| Storage | S3-compatible - Mock provider para demo |
| Email | Resend - Mock provider para demo |
| Testing | Vitest (250+ tests de dominio con fakes en memoria) |
| CI | GitHub Actions |
| Linting | ESLint 9 flat config |

## Estructura del monorepo

Ver [DOCUMENTATION_INDEX.md](docs/DOCUMENTATION_INDEX.md) para el mapa completo.

## Quick start

```bash
cp .env.example .env
docker compose up -d          # Postgres local
npm install
npm run db:generate -w packages/database
npm run db:migrate -w packages/database
npm run dev                   # API :4000
npm run dev -w apps/dashboard # Consola developer :3001 (opcional)
npm run dev -w apps/web       # Portal cliente :3000 (opcional)
npm run e2e                   # Flujo completo E2E contra stack local
```

## Testing

```bash
npm test                      # 311 tests de dominio (fakes en memoria, sin BD)
npm run lint                  # ESLint 9 flat config
npm run typecheck             # TypeScript strict en 16 workspaces
```

## Seguridad

Ver [SECURITY.md](docs/SECURITY.md), [THREAT_MODEL.md](docs/THREAT_MODEL.md),
[AUTHORIZATION_MATRIX.md](docs/AUTHORIZATION_MATRIX.md),
[MULTI_TENANT_SECURITY_MODEL.md](docs/MULTI_TENANT_SECURITY_MODEL.md).

## Estado de verificacion

| Nivel | Estado | Evidencia |
|-------|--------|-----------|
| Development | VERIFIED | 311 tests · lint 0 · typecheck 0 · builds OK |
| Security | VERIFIED | 88+ tests de seguridad · audit estatica limpia |
| PostgreSQL E2E | NOT VERIFIED | Requiere Postgres real |
| Docker build | NOT VERIFIED | Requiere Docker daemon |
| Stripe sandbox | IMPLEMENTED | Requiere credenciales sandbox |
| S3 sandbox | IMPLEMENTED | Requiere bucket + credenciales |
| Resend sandbox | IMPLEMENTED | Requiere API key + dominio verificado |
| Staging/Production | NOT DEPLOYED | Requiere infraestructura |

## Limitaciones actuales

- Sin PostgreSQL real en este entorno: los repositorios Prisma nunca han
  sido ejecutados contra una base real.
- Providers reales implementados pero no verificados contra servicios live.
- White-label: branding basico implementado; dominios custom pendientes.
