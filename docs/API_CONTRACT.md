# API Contract

> Todos los endpoints de SiteDock API v1.
> Base URL: `http://localhost:4000/api/v1`

## Autenticación

Todas las rutas excepto las marcadas como PUBLIC requieren una cookie de sesión (`sid`).
La sesión se obtiene mediante login y se invalida con logout o suspensión.

También se acepta `Authorization: Bearer sitedock_pat_...` para API tokens de workspace.
Los tokens solo pueden operar dentro de su propio workspace (`/workspaces/:workspaceId/...`),
no pueden administrar tokens, acceder a `/admin`, aceptar invitaciones ni crear workspaces.
Los scopes son `read` (GET) y `write` (POST/PATCH/DELETE). `GET /auth/me` y `GET /workspaces`
(limitado al workspace del token) son las únicas rutas no scoped.

---

## Auth

### POST `/auth/register`

| Campo | Valor |
|---|---|
| Auth | ❌ Público |
| Rate limit | 10 req/15 min |
| Input | `{ email, password (min 8), fullName (min 2) }` |
| Output 201 | `{ userId, email, fullName }` |
| Errores | 409 CONFFLICT (email duplicado), 400 INVALID |

### POST `/auth/login`

| Campo | Valor |
|---|---|
| Auth | ❌ Público |
| Rate limit | 10 req/15 min |
| Input | `{ email, password }` |
| Output 200 | Cookie `sid` httpOnly + `{ userId, fullName }` |
| Errores | 401 UNAUTHORIZED (credenciales inválidas o cuenta suspendida) |

### POST `/auth/logout`

Requiere sesión. Revoca la sesión y limpia la cookie. 204.

### POST `/auth/password-reset/request`

Rate limited. Input: `{ email }`. Output: siempre 202 genérico (sin enumeración).

### POST `/auth/password-reset/confirm`

Rate limited. Input: `{ token, newPassword (min 8) }`. 204 en éxito.

### GET `/auth/me`

Requiere sesión. Retorna `{ id, email, fullName, platformRole }`.

---

## Workspaces

### POST `/workspaces`

Staff (cualquier usuario autenticado). Crea workspace con el usuario como OWNER.

### GET `/workspaces`

Lista los workspaces del usuario autenticado.

### GET `/workspaces/:workspaceId`

Retorna workspace con miembros. Requiere membership.

### PATCH `/workspaces/:workspaceId/branding`

OWNER/ADMIN. Actualiza branding white-label (nombre visible, color, logo).
Input: `{ branding: Record<string,string\|number\|bool> \| null }`.

---

## Clients

| Método | Ruta | Roles | Descripción |
|--------|------|-------|-------------|
| POST | `/workspaces/:ws/clients` | staff | Crear cliente |
| GET | `/workspaces/:ws/clients` | cualquier miembro | Listar clientes |
| GET | `/workspaces/:ws/clients/:clientId` | cualquier miembro | Leer cliente |

---

## Projects

| Método | Ruta | Roles |
|--------|------|-------|
| GET | `/workspaces/:ws/projects` | cualquier miembro |
| POST | `/workspaces/:ws/projects` | staff |

---

## Websites

| Método | Ruta | Roles | Notas |
|--------|------|-------|-------|
| POST | `/websites` | staff | Requiere projectId |
| GET | `/websites` | scoped por cliente si CLIENT | Lista filtrada para CLIENT-role |
| GET | `/websites/:id` | assertWebsiteAccess | CLIENT solo su sitio |
| POST | `/:id/submit-for-approval` | staff | DRAFT→PREVIEW→PENDING_APPROVAL |
| POST | `/:id/approve` | assertWebsiteAccess | CLIENT puede aprobar su sitio |
| POST | `/:id/reject-approval` | assertWebsiteAccess | CLIENT puede rechazar su sitio |
| POST | `/:id/rollback` | staff | Rollback a versión anterior |

## Deployments

Montado en `/workspaces/:ws/websites/:websiteId/deployments`.

| Método | Ruta | Roles | Input | Output |
|--------|------|-------|-------|--------|
| POST | `/` (multipart) | staff | ZIP file ≤250MB | `{ deploymentId, version, previewUrl }` |
| GET | `/` | assertWebsiteAccess | — | Lista de deployments |
| GET | `/:deploymentId` | assertWebsiteAccess | — | Detalle de un deployment |
| POST | `/:deploymentId/publish` | staff | — | Publica READY deployment |

## Backups

Montado en `/websites/:websiteId/backups`.

| Método | Roles | Descripción |
|--------|-------|-------------|
| GET `/` | assertWebsiteAccess | Lista backups del sitio |
| POST `/` | staff | Backup manual (default = producción actual) |
| POST `/:backupId/restore` | staff | Restaura como NUEVA versión (no sobrescribe) |

## Charges (cobros únicos)

Montado en `/websites/:websiteId/charges`.

| Método | Roles | Descripción |
|--------|-------|-------------|
| GET `/` | assertWebsiteAccess | Lista charges |
| POST `/` | staff | Crea charge PENDING + checkout link |
| POST `/:chargeId/cancel` | staff | Cancela charge pendiente |

## Billing

Montado en `/workspaces/:ws/plans` y `/workspaces/:ws/websites/:websiteId/subscription`.

| Método | Ruta | Roles | Descripción |
|--------|------|-------|-------------|
| POST | `/plans` | staff | Crea plan (kind: HOSTING\|MAINTENANCE) |
| GET | `/plans` | cualquier miembro | Lista planes (?kind= filtra) |
| PATCH | `/plans/:planId` | staff | Edita plan (precio futuro, no retroactivo) |
| POST | `/subscription/assign-client` | staff | Asigna cliente al sitio |
| POST | `/subscription` | staff | Crea suscripción desde plan |
| GET | `/subscription?kind=` | assertWebsiteAccess | Lee suscripción (HOSTING default, MAINTENANCE opcional) |
| POST | `/subscription/:subId/checkout` | staff | Genera checkout link |

## Maintenance

Montado en `/websites/:websiteId/maintenance-requests`.

| Método | Ruta | Roles | Transición |
|--------|------|-------|------------|
| GET | `/allowance` | assertWebsiteAccess | Consulta cuota del tier |
| POST | `/` | assertWebsiteAccess | Crea solicitud → OPEN |
| GET | `/` | assertWebsiteAccess | Lista solicitudes |
| POST | `/:id/start` | staff | OPEN→IN_PROGRESS |
| POST | `/:id/quote` | staff | Fija precio → PENDING_PAYMENT |
| POST | `/:id/mark-paid` | staff | PAID |
| POST | `/:id/complete` | staff | IN_PROGRESS→COMPLETED |
| POST | `/:id/approve` | assertWebsiteAccess | COMPLETED→APPROVED |
| POST | `/:id/request-changes` | assertWebsiteAccess | Vuelve a estado previo |
| POST | `/:id/cancel` | assertWebsiteAccess | CANCELED |
| POST | `/:id/comments` | assertWebsiteAccess | Agrega comentario |
| GET | `/:id/comments` | assertWebsiteAccess | Lista comentarios |

## Domains

Montado en `/workspaces/:workspaceId/websites/:websiteId/domains`.

| Método | Ruta | Roles | Descripción |
|--------|------|-------|-------------|
| GET | `/` | cualquier miembro | Lista dominios, estado DNS/SSL y provider |
| POST | `/` | OWNER/ADMIN/DEVELOPER | Registra `{ hostname, serviceId?, autoManage? }` |
| POST | `/:domainId/verify` | OWNER/ADMIN/DEVELOPER | Verifica TXT + routing + TLS |
| POST | `/:domainId/check` | OWNER/ADMIN/DEVELOPER | Re-chequea DNS, routing y certificado |
| DELETE | `/:domainId` | OWNER/ADMIN/DEVELOPER | Desconecta y limpia el registro del provider |

## GitHub

Webhook montado en `/github/webhook`; es público y valida la firma HMAC.

| Método | Ruta | Roles | Descripción |
|--------|------|-------|-------------|
| POST | `/github/webhook` | público, firma HMAC | Push/PR → deployment de servicio o preview |

Conexiones por sitio, montadas en
`/workspaces/:workspaceId/websites/:websiteId/github`:

| Método | Ruta | Roles | Descripción |
|--------|------|-------|-------------|
| GET | `/` | cualquier miembro | Lista conexiones del sitio |
| GET | `/repositories?installationId=` | OWNER/ADMIN/DEVELOPER | Lista repositorios de la instalación |
| POST | `/` | OWNER/ADMIN/DEVELOPER | Conecta `{ installationId, repositoryId, repositoryFullName, serviceId? }` |
| DELETE | `/:connectionId` | OWNER/ADMIN/DEVELOPER | Desconecta repositorio |

## API Tokens

Montado en `/workspaces/:workspaceId/api-tokens`. Solo sesión, nunca API token.

| Método | Ruta | Roles | Descripción |
|--------|------|-------|-------------|
| GET | `/` | OWNER/ADMIN | Lista tokens (sin hash ni secreto) |
| POST | `/` | OWNER/ADMIN | Crea `{ name, scopes, expiresAt? }` y devuelve el token una vez |
| DELETE | `/:tokenId` | OWNER/ADMIN | Revoca token |

## Merchant (Stripe Connect)

Montado en `/workspaces/:ws/merchant`.

| Método | Roles | Descripción |
|--------|-------|-------------|
| POST | `/connect` | OWNER/ADMIN | Inicia onboarding Connect Express |
| GET | `/status` | DEVELOPER+ | Estado de conexión Stripe |

## Dashboard

| Método | Ruta | Roles |
|--------|------|-------|
| GET | `/workspaces/:ws/dashboard` | OWNER/ADMIN/DEVELOPER |

## Audit Log

| Método | Ruta | Roles |
|--------|------|-------|
| GET | `/workspaces/:ws/audit-logs` | OWNER/ADMIN |

## Demo Payments

Solo disponible cuando `NODE_ENV !== production && DEMO_MODE !== false`.
Si PAYMENT_PROVIDER=stripe activo, estas rutas retornan 501.

| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | `/simulate-payment-succeeded` | Simula pago exitoso |
| POST | `/simulate-payment-failed` | Simula pago fallido |
| POST | `/simulate-charge-succeeded` | Simula cobro único exitoso |
| POST | `/suspend-for-nonpayment` | Fuerza suspensión |

## Admin (PLATFORM_ADMIN únicamente)

Montado en `/admin`. Doble gate: requireSession + requirePlatformAdmin.

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/overview` | Métricas globales plataforma |
| GET | `/workspaces` | Lista tenants con conteos |
| GET | `/users` | Lista usuarios |
| POST | `/users/:id/suspend` | Suspende usuario |
| POST | `/users/:id/reinstate` | Reactiva usuario |
| GET | `/websites` | Lista sitios cross-tenant |
| POST | `/websites/:id/suspend` | Suspende sitio + notifica cliente |
| GET | `/payments` | Pagos recientes |
| GET | `/webhook-events` | Ledger de eventos webhook |
| GET | `/reconciliation` | Excepciones de reconciliación |

## Admin DNSHE

Montado en `/admin/dns`. Requiere PLATFORM_ADMIN.

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/status` | Estado de credenciales, zona y registros DNS |
| POST | `/provision-base` | Asegura `@`/`*` A; `{ publicIp?, apply? }`, dry-run por defecto |

## Webhooks (público, firma verificada)

| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | `/webhooks/payments/stripe` | Webhook Stripe Connect (firma stripe-signature) |
| POST | `/webhooks/payments/mock` | Webhook mock demo (firma x-sitedock-signature) |

## Health

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/health/live` | Liveness (sin BD) |
| GET | `/health/ready` | Readiness (verifica BD) |

## Public Demo Checkout

Solo disponible en modo demo. Sin auth.

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/public/demo-checkout/:sessionId` | Info del checkout |
| POST | `/public/demo-checkout/:sessionId/pay` | Procesa pago demo |
