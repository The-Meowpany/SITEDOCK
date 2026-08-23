# Multi-Tenant Security Model

> Fase 21 — modelo de amenazas y fronteras de aislamiento entre tenants.
> Principio: USER_A jamás lee, muta, elimina, exporta, enumera o infiere datos
> de WORKSPACE_B sin una operación cross-workspace explícitamente autorizada.

## Entidades y fronteras

| Entidad | Tenant owner | FK al tenant | Autorización API | Storage namespace |
|---------|-------------|-------------|------------------|-------------------|
| User | Global (sin workspace) | — | requireSession | N/A |
| Workspace | Self | id = tenant_id | Membership check | N/A |
| WorkspaceMember | Workspace padre | workspace_id FK | OWNER/ADMIN para mutations | N/A |
| Client | Workspace padre | workspace_id FK + unique(ws,email) | assertWorkspaceAccess | N/A |
| Project | Workspace padre | workspace_id FK | assertWorkspaceAccess staff | N/A |
| Website | Workspace padre | workspace_id FK | assertWebsiteAccess (client-scoped) | websites/{websiteId}/... |
| Deployment | Website padre | websiteId FK | assertWebsiteAccess staff | websites/{websiteId}/deployments/{id} |
| Backup | Website padre | websiteId FK | assertWebsiteAccess staff | websites/{websiteId}/backups/{id} |
| Domain | Website padre | websiteId FK | assertWebsiteAccess | N/A |
| ServicePlan | Workspace padre | workspace_id FK | assertWorkspaceAccess staff | N/A |
| Subscription | Website padre (unique ws+kind) | → Website → WS | assertWebsiteAccess | N/A |
| Invoice | Subscription padre | subscription_id FK | Hereda de subscription | N/A |
| Payment | Invoice padre | invoice_id FK | Hereda de invoice | N/A |
| Refund | Payment padre | payment_id FK | PLATFORM_ADMIN only | N/A |
| Dispute | Payment padre | payment_id FK | PLATFORM_ADMIN only | N/A |
| Charge (one-time) | Website padre | website_id FK | assertWebsiteAccess | N/A |
| MaintenanceRequest | Website padre | website_id FK | assertWebsiteAccess | N/A |
| ConnectedAccount | Workspace padre | workspace_id UNIQUE | PLATFORM_ADMIN / merchant route | N/A |
| AuditLog | Workspace padre (nullable) | workspace_id nullable | assertWorkspaceAccess OWNER/ADMIN | N/A |

## Capas de defensa (en orden)

1. **requireSession** → autenticación + verificación de suspensión en cada request
2. **assertWorkspaceAccess** → membership + rol requerido
3. **resolveWorkspaceAccess** → CLIENT role resuelve su clientId para scoping
4. **assertWebsiteAccess** → ownership del recurso específico para CLIENT-role
5. **Repository** → cada query filtra por workspaceId (o cadena FK que lo incluye)
6. **Domain aggregate** → invariantes de negocio (status transitions, ownership)

## Superficies públicas (sin auth)

| Ruta | Gate | Riesgo mitigado |
|------|------|----------------|
| POST /auth/register | rate limiter | brute force |
| POST /auth/login | rate limiter | credential stuffing |
| POST /auth/password-reset/* | rate limiter | enumeration |
| GET /public/demo-checkout/:sessionId | demo gate + 404 si no existe | information disclosure |
| POST /public/demo-checkout/:sessionId/pay | demo gate + firma Stripe/Mock | unauthorized charge |
| POST /webhooks/payments/:provider | firma + claim-first idempotencia | forgery/replay |
| GET /health/live | ninguno (liveness) | nada sensible expuesto |

## Reglas estructurales

1. Toda query de repositorio que retorna datos de un workspace DEBE filtrar por workspaceId.
2. Las únicas excepciones son: scheduled jobs (`listByStatus`), admin reader (`PlatformAdminReader`),
   y el webhook handler — todas documentadas como system-level.
3. `assertWebsiteAccess` resuelve CLIENT-role → clientId scope y verifica ownership del sitio.
4. Un 404 es preferible a un 403 cuando se accede a recursos de otro cliente (no confirma existencia).
