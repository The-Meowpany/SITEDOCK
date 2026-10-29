# Developer Guide

> Esta guía permite que un developer nuevo comprenda SiteDock y contribuya
> sin romper las reglas arquitectónicas.

## Reglas que NO deben romperse

1. **`domain/` nunca importa Prisma, HTTP, Stripe, S3 ni ningún framework.**
   Solo habla con interfaces definidas en `domain/ports.ts`.
2. **Money siempre en centavos enteros** (`Money` VO). Nunca float.
3. **Toda query de repositorio que retorne datos de workspace DEBE filtrar por `workspaceId`.**
4. **Toda ruta website-scoped usa `assertWebsiteAccess`** (no `assertWorkspaceAccess`).
5. **Los métodos `listByStatus` son solo para scheduled jobs.**
6. **El estado de los aggregates solo cambia por métodos nombrados** (nunca setters).
7. **Branding es data validada en dominio** — nunca HTML arbitrario.
8. **Los webhooks son la única autoridad económica** — nunca el frontend.

## Estructura del monorepo

```
apps/
  api/          Express REST API (capa "interfaces" de todos los contexts)
  worker/       Scheduled jobs (suspensión, renovación, SSL, backups, cleanup)
  web/          Client Portal (Next.js 15) — lo que ve el cliente final
  dashboard/    Developer Console (Next.js 15) — cartera del freelancer
  admin/        Admin Console (Next.js 15) — panel PLATFORM_ADMIN
packages/
  shared/       Value Objects, errores, StateMachine, money-math
  database/     Prisma schema + client (única fuente del modelo)
  auth/         Identity: users, sessions, password reset
  workspace/    Workspaces, members, invitations, branding
  client/       Client Management
  website/      Websites + Projects + lifecycle
  deployment/   Deployments + Backups (upload seguro, versionado)
  billing/      Plans, Subscriptions, Invoices, Payments, Charges, Webhooks
  maintenance/  Maintenance Requests (soporte + trabajo pago por tier)
  domains/      Custom Domains + SSL (DomainProvider abstraction)
  notification/ Emails transaccionales (EmailProvider abstraction)
  audit/        Audit log append-only
  dashboard/    Read-side métricas Developer Console
  admin/        Read-side métricas Platform Admin
docs/           Documentación técnica y operacional
scripts/        E2E script y utilidades
```

## Bounded context structure

Cada package sigue la misma estructura:

```
packages/<context>/src/
  domain/           Entidades, VOs, ports (interfaces), state machines
  application/      Use cases (orquestan aggregates + ports)
  infrastructure/   Implementaciones Prisma/adapters de providers
  __tests__/        Tests unitarios con fakes en memoria
```

**Regla de dependencia:** `interfaces → application → domain ← infrastructure`

## Cómo agregar una feature nueva

1. Define el bounded context (¿es nuevo o extiende uno existente?)
2. Si es nuevo: crea `packages/<context>/` con package.json, tsconfig, vitest.config
3. Define las entidades en `domain/` con invariantes en los métodos
4. Define los ports en `domain/ports.ts`
5. Implementa use cases en `application/` (inyección de dependencias por constructor)
6. Implementa repositories Prisma en `infrastructure/`
7. Agrega tests con fakes en `__tests__/`
8. Wire la ruta en `apps/api/src/interfaces/*.routes.ts` con gates apropiados
9. Exporta todo desde `index.ts`
10. Ejecuta: `npm test && npm run lint && npm run typecheck`

## Testing

- Los tests de dominio usan **fakes en memoria**, no Prisma ni base de datos.
- Cada fake implementa el MISMO port que Prisma implementa en producción.
- Los tests verifican comportamiento (invariantes), no implementación.

```bash
# Todos los tests
npm test

# Un paquete específico
npm run test -w packages/billing

# Un archivo específico
npx vitest run packages/auth/src/__tests__/auth-adversarial.test.ts
```

## Migraciones

```bash
npm run db:migrate -w packages/database   # prisma migrate dev (crea/aplica)
npm run db:generate -w packages/database  # regenera el cliente Prisma
npm run db:deploy -w packages/database    # prisma migrate deploy (producción/CI)
```

La primera vez contra una BD vacía, `migrate dev` genera el schema completo.
Subsecuentes migraciones son incrementales. Nunca edites el SQL generado manualmente.

**Migración inicial:** `packages/database/prisma/migrations/0001_init/migration.sql`
contiene el schema completo derivado de `schema.prisma`. Esta migración se aplica
automáticamente al arrancar el contenedor de la API vía `entrypoint.sh`.

## Docker y orquestación local

El repositorio incluye Dockerfiles para los 5 componentes (`apps/api`, `apps/dashboard`,
`apps/web`, `apps/admin`, `apps/worker`) y un `docker-compose.yml` completo.

### Arranque local con Docker Compose

```bash
# 1. Copiar variables de entorno (los valores por defecto usan mocks —
#    no se necesitan credenciales externas para desarrollo local)
cp .env.example .env

# 2. Levantar todo el stack (Postgres + API + worker + 3 frontends + Caddy)
docker compose up -d

# 3. Verificar salud
curl http://localhost:4000/health/live    # 200 {"status":"ok"}
curl http://localhost:4000/health/ready   # 200 cuando Postgres responde

# 4. La API aplica migraciones automáticamente al arrancar (entrypoint.sh)
#    Si necesitas aplicarlas manualmente:
npm run db:deploy -w packages/database

# 5. URLs locales
#    API:          http://localhost:4000
#    Portal cliente: http://localhost:3000
#    Consola dev:   http://localhost:3001
#    Consola admin: http://localhost:3002
#    Caddy proxy:   http://localhost:80
#    Sitios públicos: http://localhost:80/sites/<subdomain>/
```

### Entorno de desarrollo sin Docker

```bash
# 1. PostgreSQL local (requiere Postgres instalado o docker solo para la BD)
docker compose up -d postgres

# 2. Instalar dependencias
npm install

# 3. Generar cliente Prisma y aplicar migraciones
npm run db:generate -w packages/database
npm run db:migrate -w packages/database

# 4. Ejecutar la API en modo desarrollo (usa mocks para Stripe/S3/Resend)
npm run dev
```

Los valores por defecto en `.env.example` y `docker-compose.yml` usan `mock` para
`PAYMENT_PROVIDER`, `STORAGE_PROVIDER` y `EMAIL_PROVIDER`, por lo que el stack
local funciona sin credenciales externas. Para usar proveedores reales, edita
`.env` con `PAYMENT_PROVIDER=stripe`, `STORAGE_PROVIDER=s3`, `EMAIL_PROVIDER=resend`
y las credenciales correspondientes.

## Entrega de sitios web públicos (M1+M2)

Los sitios publicados se sirven a través de la ruta
`GET /public/sites/:subdomain/:path(*)` montada fuera de `/api/v1`.

- **URL pública:** `http://<host>:80/sites/<subdomain>/<ruta-del-archivo>`
- **Solo sitios LIVE:** cualquier otro estado (DRAFT, SUSPENDED, DELETED, etc.)
  devuelve 404 — no se confirma existencia del sitio.
- **Solo despliegues publicados:** la ruta usa `productionDeploymentId` del
  sitio; despliegues no publicados, backups y metadatos internos nunca se exponen.
- **Aislamiento por tenant:** cada sitio se sirve desde su propio
  `websites/{websiteId}/deployments/{deploymentId}/` en storage.
- **Seguridad:** path traversal, symlinks, null bytes y extensiones peligrosas
  se bloquean al subir el ZIP (`validateUploadEntries`). El servidor público
  rechaza rutas con `..`, rutas absolutas y bytes nulos.

## Pull requests

- Conventional Commits (`feat:`, `fix:`, `security:`, `chore:`)
- CI debe pasar: lint + typecheck + test + build
- Toda modificación a rutas debe mantener los gates de autorización
- Toda modificación a billing debe incluir regresiones financieras
- No mezclar features con refactoring en un mismo PR

## Seguridad

Ver [SECURITY.md](SECURITY.md) para el modelo completo. Reglas críticas:

- Nunca loggear tokens, secrets ni passwords
- Nunca confiar en IDs del frontend sin verificar ownership
- Nunca usar `assertWorkspaceAccess` para recursos website-scoped (usar `assertWebsiteAccess`)
- Nunca exponer `storagePath`, `externalSubscriptionId` ni tokens en respuestas API
