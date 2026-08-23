# Database Guide

## Motor

PostgreSQL 16. Prisma ORM como única interfaz de persistencia.

## Schema

Fuente de verdad: `packages/database/prisma/schema.prisma`.

### Tablas tenant-owned

| Tabla | FK al tenant | Unique scope | Cascade |
|-------|-------------|-------------|---------|
| workspaces | id = tenant | slug UNIQUE | — |
| workspace_members | workspace_id | (workspace_id, userId) UNIQUE | CASCADE |
| clients | workspace_id | (workspace_id, email) UNIQUE | CASCADE |
| projects | workspace_id | — | CASCADE (desde Workspace) |
| websites | workspace_id | subdomain UNIQUE | CASCADE (desde Workspace) |
| service_plans | workspace_id | — | CASCADE (desde Workspace) |
| connected_accounts | workspace_id | external_account_id UNIQUE | CASCADE |

### Tablas anidadas (heredan tenant a través del padre)

| Tabla | Padre | Constraint clave |
|-------|-------|-----------------|
| deployments | website_id → Website | (websiteId, version) UNIQUE |
| website_backups | website_id → Website | (websiteId, sourceDeploymentId) UNIQUE |
| domains | website_id → Website | hostname UNIQUE, sslExpiresAt indexado |
| subscriptions | website_id → Website | (websiteId, kind) UNIQUE |
| invoices | subscription_id → Subscription | — |
| payments | invoice_id → Invoice | — |
| maintenance_requests | website_id → Website | — |
| refunds | payment_id → Payment | externalRefundId UNIQUE |
| disputes | payment_id → Payment | externalDisputeId UNIQUE |

### Tablas globales

| Tabla | Tenant key | Descripción |
|-------|-----------|-------------|
| users | — (global) | platformRole: DEVELOPER/CLIENT/PLATFORM_ADMIN |
| sessions | user_id FK | tokenHash UNIQUE, suspensión verificada por request |
| password_reset_tokens | user_id FK | tokenHash UNIQUE, single-use + expiry |
| audit_logs | workspace_id nullable | Append-only, sin UPDATE ni DELETE |
| payment_events | — | (provider, externalEventId) UNIQUE = idempotencia |
| outbox_events | workspace_id nullable | Transactional outbox para eventos |

### Convenciones

- Todas las tablas usan `@map` con snake_case en la BD
- Todos los timestamps usan `createdAt`/`updatedAt` automáticos
- Los deletes son CASCADE desde el padre (eliminar workspace elimina todo)
- `audit_logs` es la única tabla append-only (sin FK cascade)

## Migraciones

```bash
# Desarrollo
npm run db:migrate -w packages/database

# Solo regenerar cliente (sin migrar)
npm run db:generate -w packages/database
```

La primera ejecución genera el schema completo. Subsecuentes son incrementales.

**Nunca editar el SQL generado manualmente.**

## Aislamiento

El aislamiento es application-level: cada query de repositorio filtra por
`workspaceId`. No se usa Row Level Security de PostgreSQL.

Ver [MULTI_TENANT_SECURITY_MODEL.md](MULTI_TENANT_SECURITY_MODEL.md) para el
modelo completo de fronteras y [SECURITY.md](SECURITY.md) para los controles.
