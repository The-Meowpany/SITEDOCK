# SiteDock

**Recurring Website Infrastructure for Freelancers.**

SiteDock convierte un proyecto web de pago único en un servicio mensual: el freelancer
desarrolla el sitio una vez, y la plataforma se encarga de hosting, deployment, dominios,
SSL, backups, versionado, clientes, suscripciones y cobros recurrentes.

No es "otro hosting". Es la infraestructura técnica **y financiera** para que un
desarrollador convierta un proyecto en ingreso recurrente.

## Estado actual del proyecto

Arquitectura: **Modular Monolith + Async Workers** (DDD táctico, Clean/Hexagonal por
bounded context). Ver [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) para el mapa
completo de contextos, modelo de dominio y máquinas de estado.

Implementado hasta ahora:

**Fase 1**
- ✅ **Identity** — registro, login, logout, reset de contraseña, sesiones (Argon2id + cookie httpOnly)
- ✅ **Workspace** — creación de workspace, membresía, y el gate central de **aislamiento multi-tenant**

**Fase 2**
- ✅ **Client** — clientes por workspace, unicidad de email por tenant
- ✅ **Website** — máquina de estados completa (`DRAFT→PREVIEW→PENDING_APPROVAL→APPROVED→LIVE→PAST_DUE→GRACE_PERIOD→SUSPENDED→ARCHIVED→DELETED`), invariante "no LIVE sin deployment READY"
- ✅ **Deployment** — upload ZIP con validación de seguridad (path traversal, symlinks, extensiones peligrosas, zip-bomb guard, límites de tamaño), versiones inmutables, `MockStorageProvider`
- ✅ **Billing** — ServicePlan configurables, Subscription con máquina de estados y revenue-share (`FlatPercentageFeePolicy`), Checkout + webhook con **verificación de firma + idempotencia real** (`MockPaymentProvider`)

**Fase 3**
- ✅ **Maintenance** — solicitudes de soporte gratuitas y de trabajo pago con cotización (`OPEN→...→PENDING_PAYMENT→PAID→IN_PROGRESS→COMPLETED→APPROVED`), comentarios
- ✅ **Domain Management** — registro de dominios personalizados, verificación de ownership vía `DomainProvider`, emisión de SSL solo tras verificación (`MockDomainProvider`)
- ✅ **Notification** — `NotificationService` con 12 tipos de eventos (bienvenida, checkout, pago exitoso/fallido, deployment listo, sitio suspendido/reactivado, dominio por vencer...), templates puros y testeables, `MockEmailProvider`; cableado en registro, webhook de pago, publicación de deployment y suspensión manual

**Fase 4**
- ✅ **Audit** — `AuditEntry` inmutable y append-only (sin métodos de mutación, ni siquiera a nivel de clase), catálogo cerrado de acciones auditables verificado en compile-time, endpoint de consulta tenant-scoped (`GET /workspaces/:id/audit-logs`, solo OWNER/ADMIN); cableado en login, creación de workspace/cliente/website/deployment/plan/suscripción/dominio/maintenance request, publicación y rollback de deployments, y en el resultado del webhook de pago (pago recibido/fallido, sitio suspendido/reactivado)

**Fase 5**
- ✅ **`apps/worker`** — primer scheduled job real: `SuspendOverdueSubscriptionsJob` cierra automáticamente el ciclo `GRACE_PERIOD → SUSPENDED` que antes solo existía como endpoint de demo manual. Idempotente por construcción (una suscripción ya suspendida simplemente deja de aparecer en la próxima corrida), con `RetryPolicy` compartida (`@sitedock/shared`) para absorber fallos transitorios de infraestructura dentro de una misma corrida. Dos formas de ejecutarlo: proceso long-lived con `setInterval` (`npm run dev -w apps/worker`) o disparo único para cron/CI externo (`npm run run-once -w apps/worker`)

**Fase 6**
- ✅ **`apps/web` — Client Portal** — la interfaz que ve el cliente final (docs/ARCHITECTURE.md §15): estado del sitio, suscripción y solicitudes de mantenimiento, sin exponer nada de la complejidad técnica subyacente. Next.js 15 (App Router) + TypeScript + CSS Modules, sin librerías de UI externas — design system propio ("Service Passbook": el estado del sitio se muestra como un sello de tinta que encodifica literalmente la máquina de estados de `WebsiteStatus`). Build de producción verificado (5 rutas, ~104-106KB First Load JS)
- ✅ **Flujo de invitación por token** — `WorkspaceInvitation` aggregate propio (estado `PENDING→ACCEPTED/EXPIRED/REVOKED`, invariantes de expiración y de coincidencia de email verificados en el dominio, no solo en la API), `POST /workspaces/:id/invitations` + `POST /invitations/:token/accept`, y `/invite/[token]` en el portal con redirect automático a login (`?returnTo=`) si hace falta. Cierra por completo el gap de "invite client" que quedaba solo parcialmente resuelto (el atajo directo `POST /workspaces/:id/members` para cuentas ya existentes sigue disponible como alternativa rápida)
- ✅ **`GetSubscriptionForWebsiteUseCase`** — primer query de lectura de Billing, necesario para que el portal muestre el estado de la suscripción sin acoplarse a los casos de uso de escritura (CQRS-lite)

**Fase 7**
- ✅ **`apps/dashboard` — Developer Console** — la interfaz que le muestra al freelancer su cartera como un negocio recurrente (docs/ARCHITECTURE.md §18): MRR/ARR, MRR en riesgo (suscripciones `PAST_DUE`/`GRACE_PERIOD`), suscripciones y sitios activos, pagos fallidos, solicitudes abiertas, deployments, almacenamiento, gráfico de ingresos de 6 meses (SVG propio, sin librerías), altas/bajas por mes con churn de 30 días, sitios por estado y principales clientes. Comparte el ADN visual del portal ("Service Passbook") con tipografía tabular para lectura rápida de números. Redirige automáticamente al primer workspace del developer
- ✅ **`@sitedock/dashboard`** — nuevo bounded context de solo lectura (CQRS read-side) que agrega métricas entre contextos: port `DashboardReader` con snapshots planos, matemática pura y testeada en `domain/metrics.ts` (`normalizeToMonthlyCents`, churn, series cero-rellenas, top clients), implementación Prisma workspace-scoped en cada query. Endpoint `GET /api/v1/workspaces/:id/dashboard` restringido a `OWNER/ADMIN/DEVELOPER` (los clientes no ven revenue del workspace). 10 tests nuevos, incluido uno de fuga entre tenants

**Fase 8**
- ✅ **Recordatorio de renovación automático** — segundo scheduled job (`NotifyUpcomingRenewalsJob`, cada 6 horas en `apps/worker`): encuentra suscripciones `ACTIVE` cuya próxima renovación cae dentro de una ventana de 3 días (`FindUpcomingRenewalsUseCase`, Billing) y les avisa al cliente antes del cobro — menos pagos fallidos significa que el ciclo `PAST_DUE→GRACE_PERIOD→SUSPENDED` ni siquiera arranca. **Idempotencia real vía ledger de notificaciones**: el port `NotificationLogRepository` ganó `hasEntrySince` (con matching por `payload.subscriptionId`), así que correr el job cada 6 horas manda como máximo un recordatorio por suscripción por período — el corte se calcula espejando hacia atrás el intervalo de facturación desde `nextBillingDate`. Nuevo evento `renewal_reminder` en el catálogo exhaustivo de templates. Dos jobs restantes del roadmap (expiración de dominio, limpieza de backups) quedan explícitamente bloqueados: requieren columna `expiresAt` en `Domain` y la feature de backups, respectivamente
- ✅ **ADRs 002–005 escritos** — PostgreSQL+Prisma, provider abstractions, Money en minor units, state machines centralizadas (referenciados por ARCHITECTURE.md desde la Fase 1 pero recién ahora documentados con contexto/decisión/alternativas/consecuencias)

**Fase 9**
- ✅ **Admin Panel completo (brief §27)** — cierre del último ítem del MVP obligatorio:
  - **`@sitedock/admin`** — bounded context read-side de plataforma: `PlatformAdminReader` (el único reader que cruza tenants a propósito, montable SOLO detrás del gate admin) + queries tipadas; el MRR de plataforma usa la misma matemática integer-safe vía nueva `money-math` en `@sitedock/shared` (deduplicada desde dashboard)
  - **Suspensión de usuarios** — `User.suspendedAt` (schema + aggregate con invariantes `suspend()/reinstate()` que rechazan doble suspensión), login rechaza cuentas suspendidas solo tras verificar credenciales, y el gate `requirePlatformAdmin` re-verifica rol+suspensión contra DB en cada request
  - **API `/api/v1/admin/*`** — overview (MRR/ARR plataforma, sitios por estado, pagos fallidos, deployments/storage), tenants, usuarios, sitios, pagos recientes, ledger de webhook events; acciones `suspend/reinstate user` y `suspend website` (reutiliza el use case del contexto Website + notifica al cliente), todas auditadas como `ADMIN_ACTION`/`WEBSITE_SUSPENDED` con actorId del admin
  - **`apps/admin` — consola web (puerto 3002)** — métricas de plataforma + tablas de tenants/usuarios/sitios/pagos/webhooks con botones de suspensión (con confirmación), mismo ADN visual "Service Passbook"; verifica rol antes de mostrar nada. Build verificado (3 rutas)

**Fase 10**
- ✅ **Backups como feature (brief §29)** — cierre de la última feature pendiente del MVP:
  - **`WebsiteBackup` aggregate** en `packages/deployment`: copia inmutable de los artefactos de un deployment, con retención materializada (`expiresAt`) y unicidad `(websiteId, sourceDeploymentId)` — el par único es lo que hace idempotente al job programado
  - **Restore-as-new-version**: restaurar NUNCA sobrescribe — copia los archivos del backup a un nuevo directorio de deployment y lo registra READY en la siguiente versión; publicarlo sigue siendo un paso explícito
  - **Cleanup seguro**: borra objetos de storage primero y filas después — un crash a mitad deja una fila huérfana detectable (`BACKUP_ARTIFACTS_MISSING`), nunca objetos huérfanos sin dueño
  - **API tenant-scoped**: `GET/POST /websites/:id/backups` (manual = deployment de producción actual, o uno explícito), `POST /backups/:id/restore`, auditadas como `BACKUP_CREATED`/`BACKUP_RESTORED`
- ✅ **Renovación automática de SSL (brief §17)** — sin registrador propio, `Domain.sslExpiresAt` (del certificado que emite `DomainProvider.issueCertificate`) es el único vencimiento accionable: el job diario lo renueva automáticamente vía el mismo port, y si la renovación falla alerta al staff del workspace (`domain_expiring`, deduplicado 24h por dominio contra el ledger). Nuevo `WorkspaceStaffDirectory` para reach operacional sin exponer miembros
- ✅ **Las 5 scheduled jobs del ciclo de vida completos** (§17/§31): suspensión por mora · recordatorio de renovación · expiración SSL · backups de sitios LIVE · limpieza de backups expirados
- ✅ **Mejora integral de las tres vistas** — sesión visible con cierre de sesión (identidad + logout vía `POST /auth/logout`, que ninguna vista tenía): Consola del developer con tabla **Mis sitios** (estado por chip) y estado vacío con checklist de onboarding hacia el primer ingreso; Admin Console con navegación por anclas y estados vacíos en todas las tablas; Client Portal con chips de estado en el selector de sitios y salida discreta respetando la estética passbook. Builds de producción verificados (web 4 rutas, dashboard 4, admin 3)

**Fase 11 — Auditoría integral y hardening**
- ✅ **Auditoría de seguridad completa con fixes implementados** (docs/SECURITY.md):
  - **IDOR cross-client cerrado** — el rol CLIENT ya no puede listar/leer/aprobar sitios de otros clientes del mismo workspace: nuevo gate `assertWebsiteAccess` (membership → role → ownership por `Client.userId`) aplicado a todos los endpoints portal-facing; recursos ajenos responden **404** (no confirman existencia)
  - **Sesión fail-closed** — `requireSession` revalida la cuenta en cada request: suspensión/baja revoca acceso inmediato aunque la cookie siga vigente
  - **Endpoints demo gated** — `/demo-payments/*` ni siquiera se montan salvo en desarrollo (`DEMO_MODE`)
- ✅ **Integridad financiera real** — el webhook ahora persiste **Invoice + Payment** (con revenue-share vía `PlatformFeePolicy`): ingresos del dashboard, pagos fallidos y tabla admin de pagos dejan de estar vacíos; ledger de webhooks migrado a **claim-first + release-on-failure** (cierra la ventana de crash que duplicaba aplicación de eventos)
- ✅ **Tooling profesional** — ESLint 9 flat config (correctness-only) con **0 violaciones** (cazó y eliminó imports muertos, casts `any`, y una regresión real: router desmontado), CI GitHub Actions (lint→typecheck→test→build), script `npm run lint`
- ✅ Limpieza: fetch paralelo en portal, redirect si ya autenticado en los 3 logins, script `db:seed` dangling eliminado, casts `as any` tipados

**Fase 12 — Desacoplamiento comercial: tiers de mantenimiento**
- ✅ **`PlanKind` (HOSTING | MAINTENANCE)** — una cosa es cobrar hosting/infraestructura, otra la **membresía mensual de mantenimiento y modificaciones** que el freelancer ofrece en tiers (Básico 2/mes · Pro 6 · Premium ilimitado). `ServicePlan.includedRequestQuota` con invariante de dominio (quota solo en MAINTENANCE, entero ≥ 0)
- ✅ **Un sitio puede tener dos suscripciones** — unique `(websiteId, kind)` reemplaza el único por website; kind se desnormaliza en la Subscription al crearse
- ✅ **Allowance de tier** — `GetMaintenanceAllowanceForWebsiteUseCase` + endpoint `GET .../maintenance-requests/allowance`: cuota incluida vs usada en el período corriente (derivado del `nextBillingDate`, misma aritmética que el aggregate), remaining nunca negativo, NULL = ilimitado
- ✅ **Feedback end-to-end en el portal** — crear una solicitud devuelve veredicto de cobertura (`covered / over-quota / sin membresía`) y el portal lo muestra al instante ("Cubierto por tu plan Pro — quedan 2 este período")
- ⬜ Sigue: cobro único por creación/deploy (`ProjectCharge` + checkout one-time), cambio de tier con prorrateo

**Fase 13 — Cobro único por creación/deploy (`ProjectCharge`)**
- ✅ **Segundo flujo comercial desacoplado** — además del hosting (suscripción) y los tiers de mantenimiento (membresía), ahora existe el **cobro único por proyecto**: `ProjectCharge` PENDING→PAID con checkout propio (`createOneTimeCheckout` en el port `PaymentProvider`)
- ✅ **PAID solo desde webhook verificado** — nuevo evento `charge.succeeded`: marca PAID, registra Invoice `ONE_TIME` + Payment con revenue-share, y valida que el monto del provider coincida con el registrado (guard anti-tampering). Idempotente por el mismo ledger claim-first
- ✅ **API completa**: `POST/GET /websites/:id/charges` + cancel (staff-only writes, lectura también para el cliente), `simulate-charge-succeeded` en el router demo (gated), auditadas como `PROJECT_CHARGE_*`
- ✅ Tiers 100% customizables end-to-end: `POST/PATCH /plans` aceptan kind+cuota, `GET /plans?kind=` filtra, editar precio no retro-afecta suscripciones existentes
- ⬜ Sigue: consola developer operativa (crear sitio, subir ZIP, publicar, crear tiers y charges desde la UI)

**Fase 14 — Consola developer operativa (cero curl)**
- ✅ **Shell con navegación** — sidebar Resumen/Sitios/Planes y tiers + header de sesión; mismo ADN Passbook
- ✅ **Sitios**: creación proyecto→sitio en un formulario, grid de sitios con chips de estado, y **centro de operaciones por sitio**: upload ZIP drag&drop → deployment versionado, tabla de versiones con **Publicar** (encadena submit→approve→publish tolerando transiciones ya hechas) y **Rollback** a cualquier versión
- ✅ **Monetización por sitio**: asignar cliente (existente o alta inline), suscribir hosting y tier de mantenimiento desde selects del catálogo, **generar+copiar link de checkout** en un click, resumen de cuota del tier ("2/6 usadas este período")
- ✅ **Cobros únicos desde la UI**: formulario título+monto → link copiado al portapapeles; listado con estados Pagado/Pendiente/Cancelado y cancelación
- ✅ **Mantenimiento staff-side**: solicitudes con acciones según estado (Cotizar/Iniciar/Completar/Marcar pagada/Aprobar)
- ✅ **Planes y tiers**: alta por tipo con cuota, edición inline (nombre/precio/cuota), activar/desactivar — todo customizable por el freelancer
- ⬜ Sigue: providers reales (Stripe Connect/S3/Resend), white-label

**Fase 15 — Checkout público demo + pulido integral**
- ✅ **El cliente ya puede pagar su link** — faltaba el eslabón final: nueva página pública `/checkout/[sessionId]` en el portal (Passbook, sin auth) que muestra descripción+monto y botón de pago; `POST /public/demo-checkout/:id/pay` corre el MISMO pipeline verify→claim→process que un webhook real (sin atajos de confianza), con rate limiting propio y desaparición total fuera de modo demo. El flujo del criterio final del brief ahora es 100% clickable: crear sitio → publicar → checkout → el cliente paga → LIVE
- ✅ **Portal del cliente completo** — muestra el tier de mantenimiento activo ("Pro · te quedan 2 de 6 este período") y los cobros únicos con estado
- ✅ **Invitar al portal desde la consola** — botón "Invitar al portal" junto al cliente asignado; en demo copia el link directo (el token solo se expone con `allowDemoEndpoints`; en producción viaja por email)
- ✅ Pulidos: bug de estado stale al suscribir (checkout usaba la suscripción vieja), cancelación de charges vía api-client, helper `moneyFromDecimal`, contenedor compartido de billing (una sola instancia del pipeline para rutas autenticadas y públicas)

**Fase 16 — Stripe Connect: infraestructura de dinero real (ADR-006)**
- ✅ **El pipeline no cambia, cambia el origen del dinero** — `PAYMENT_PROVIDER=mock|stripe` selecciona entre `MockPaymentProvider` y `StripePaymentProvider` real, ambos implementando el mismo port. El circuito verify→claim→process→ledger queda intacto
- ✅ **Merchant onboarding Connect Express** — `ConnectedAccount` persistente (`acct_...`, estado PENDING_ONBOARDING→ACTIVE→RESTRICTED/DISCONNECTED), KYC/KYB hosted 100% en Stripe; `POST /merchant/connect` + `GET /merchant/status` sincronizan desde la autoridad externa
- ✅ **Checkouts reales** — Checkout Sessions de Stripe con metadata puente (`subscription_id`/`charge_id`); `verifyAndParseWebhook` implementa la firma REAL de Stripe (`t`+`v1` HMAC-SHA256 + tolerancia anti-replay), testeada offline contra payloads firmados localmente
- ✅ **Webhooks como autoridad económica** — mapping completo de eventos reales: checkout.session.completed, invoice.payment_failed, customer.subscription.deleted, charge.refunded, charge.dispute.created/closed; irrelevants → ACK no-op
- ✅ **Refunds + disputes con estados** — refunds parciales/totales acumulando `refundedCents` (total → REFUNDED), disputes append-only WON/LOST con deadline de evidencia; guard anti-tampering de montos y dedup por `externalRefundId` único
- ✅ **Reconciliación Stripe ↔ ledger** — `reconcilePayments()` compara balance transactions vs pagos internos y produce EXCEPCIONES tipadas (`MISSING_BALANCE_TRANSACTION`/`AMOUNT_MISMATCH`/`UNKNOWN_BALANCE_TRANSACTION`) sin corregir nada en silencio; endpoint PLATFORM_ADMIN `GET /admin/reconciliation`
- ✅ **Sandbox-first verificable sin red** — cliente REST tipado propio sobre `fetch` inyectado (cero dependencia del SDK oficial): firma, mapping, creación de checkouts, refunds y reconciliación testeados offline con fakes; live mode requiere credenciales reales + suite adversa ya cubierta
- ✅ **Loop de Connect cerrado** — webhook `account.updated` de Stripe sincroniza el estado del merchant (header real `stripe-signature`, resuelto por `acct_id` antes del pipeline económico); `GET /merchant/status` distingue NOT_CONNECTED/PENDING/ACTIVE/RESTRICTED; **tarjeta Stripe en el overview** con CTA de onboarding hosted y badge verde cuando está activa
- ✅ Refund staff-scoped con verificación de cadena Payment→Invoice→Subscription→Website antes de mover un centavo

**Fase 17 — QA: contrato HTTP + E2E automatizado**
- ✅ **Suite de contrato HTTP sin BD** (`apps/api`, 10 tests): levanta `createApp()` real en puerto efímero y fija garantías de la capa interfaces — errores estructurados con `requestId` sin stack traces, 401 fail-closed, gating de rutas demo, cabeceras de rate-limit/CORS, checkout público 404 ante sesión desconocida. Corre en CI sin servicios
- ✅ **`npm run e2e`** — el criterio final §51 completo automatizado en 21 pasos contra stack local (API+Postgres): registro→workspace→sitio→ZIP→LIVE→cliente→tiers con cuota (2/2→over-quota verificado)→cobro único $1500 PAID→pago fallido→PAST_DUE→suspensión→recuperación→LIVE→MRR>0→audit log. Fail-fast paso a paso
- ✅ `apps/api` suma script test propio; smoke suite corre también en CI

**Fase 18 — Providers reales completados (S3 + Resend), sandbox-first**
- ✅ **`S3StorageProvider`** — cliente REST de S3 con firma SigV4 implementada localmente (sin SDK, fetch inyectado): put/get/delete idempotente/list con paginación y parser XML mínimo. Mismo port `StorageProvider` — el pipeline de deployments/backups no cambia una línea. `STORAGE_PROVIDER=s3` + `S3_*` lo activa; `S3_ENDPOINT` soporta MinIO/tests
- ✅ **`ResendEmailProvider`** — POST /emails con remitente verificado (`RESEND_FROM`); errores HTTP/red mapeados a `InfrastructureError`. `EMAIL_PROVIDER=resend` lo activa en API y worker vía fábrica
- ✅ Fábricas por entorno en infraestructura (la app nunca lee process.env): `createStorageProviderFromEnv()` / `createEmailProviderFromEnv()` — mock sigue siendo default first-class
- ✅ 10 tests nuevos offline (firma presente con formato AWS4 correcto, flows put/get/delete/list contra fake S3, mapping de errores Resend)
- ⬜ Verificación live de ambos providers (requiere credenciales reales — la lógica ya está cubierta offline)

**Fase 19 — Production Provider Verification & Operational Hardening**
- ✅ **Fail-closed de producción** — `validateProductionConfig()` centralizada: PAYMENT_PROVIDER=stripe sin credenciales, STORAGE_PROVIDER=s3 sin bucket, EMAIL_PROVIDER=resend sin API key → **exit(1) al arrancar**, nunca fallback silencioso a mocks
- ✅ **Métricas de providers** — `providerMetrics` en `@sitedock/shared`: contadores success/failure/timeout/rate_limited + latencia acumulada por provider:operación; cableado en Stripe HTTP client, S3 y Resend; endpoint `GET /api/v1/admin/metrics` (PLATFORM_ADMIN)
- ✅ **Backoff exponencial con jitter** — `exponentialBackoffWithJitter()` acotado con RNG inyectable (tests deterministas); `StripeRateLimitError` con retryAfterMs del header Retry-After de Stripe
- ✅ **Idempotencia keys** — checkout sessions de Stripe envían `Idempotency-Key: checkout:{subscriptionId|chargeId}` → respuesta perdida + retry = misma sesión, nunca segundo cobro
- ✅ **Validación económica** — webhook payment.succeeded valida monto Y moneda contra el precio capturado de la suscripción antes de mutar (divergencia = excepción explícita, jamás silencio)
- ✅ **Integridad de backups** — SHA-256 del contenido ordenado persistido al crear backup; restore verifica hash ANTES de desplegar (backup corrupto = BACKUP_INTEGRITY_FAILED, nunca deployment corrupto)
- ✅ **S3 key sanitization** — path traversal (`../`, `//`, `/raíz`) bloqueado en put/get/delete/exists; tests de aislamiento entre tenants a nivel storage
- ✅ **S3 failure injection** — 403/500/503 en PUT/GET lanzan InfrastructureError tipado (nunca éxito silencioso); XML malformado no produce keys fantasma
- ✅ **10 smoke tests HTTP** contra `createApp()` real sin BD: health checks, 401 fail-closed, gating demo, webhook firma inválida, CORS/rate-limit headers, admin metrics auth

Común a todas las fases:
- ✅ API REST completa cableando los 12 bounded contexts, siempre a través de `AssertWorkspaceAccessUseCase`
- ✅ Schema completo de base de datos (todo el modelo de dominio, incluyendo `ownershipProofToken` para verificación de dominios y la tabla `workspace_invitations`)
- ✅ **189 tests unitarios de dominio** — todos con fakes en memoria, sin base de datos
- ⬜ White-label, Infrastructure-as-Code, providers reales (Stripe/S3/Resend) — próximas fases del roadmap original
- ⬜ Deuda conocida declarada: servir previews/sitios públicos requiere un host dedicado o CDN (servir HTML de usuarios desde el dominio de la API sería XSS por diseño — la URL `/preview/:id` que hoy devuelve la API está pensada para ese host); tests de integración contra Postgres real (los actuales cubren dominio con fakes); providers reales detrás de los ports existentes

Cada fase sigue el orden definido en la arquitectura:

```
Identity → Workspace → Website → Deployment → Client → ServicePlan
→ Checkout → Subscription → Payment → Website Lifecycle
```

## Estructura del monorepo

```
apps/
  api/            REST API (Express) — capa "interfaces" de todos los bounded contexts
  worker/         Scheduled jobs (suspensión por mora, recordatorios de renovación)
  web/            Client Portal (Next.js 15) — la vista que ve el cliente final
  dashboard/      Developer Console (Next.js 15) — la cartera del freelancer como negocio
  admin/          Admin Console (Next.js 15) — panel PLATFORM_ADMIN de la plataforma
packages/
  shared/         Value Objects, errores, StateMachine, money-math — sin dependencias externas
  database/       Prisma schema + client compartido (única fuente de verdad del modelo)
  auth/           Bounded context: Identity (incluye suspensión de cuentas)
  workspace/      Bounded context: Workspace (incluye el gate de tenant isolation)
  client/         Bounded context: Client Management
  website/        Bounded context: Website (lifecycle) + Project
  deployment/     Bounded context: Deployment (upload seguro, versionado inmutable)
  billing/        Bounded context: Billing (ServicePlan, Subscription, Checkout, Webhooks)
  maintenance/    Bounded context: Maintenance Requests (soporte + trabajo pago)
  domains/        Bounded context: Domain Management (DNS/SSL)
  notification/   Bounded context: Notification (emails transaccionales)
  audit/          Bounded context: Audit (registro append-only de acciones críticas)
  dashboard/      Bounded context read-side: métricas agregadas del Developer Console
  admin/          Bounded context read-side: administración de plataforma (cross-tenant)
docs/
  ARCHITECTURE.md
  adr/            Architecture Decision Records
  LOCAL_DEVELOPMENT.md
```

Cada bounded context sigue `domain/ → application/ → infrastructure/`, donde `domain`
nunca importa Prisma, HTTP ni ningún framework — ver ADR-001.

## Arrancar en local

Ver [`docs/LOCAL_DEVELOPMENT.md`](./docs/LOCAL_DEVELOPMENT.md) para el paso a paso completo.

Resumen rápido:

```bash
cp .env.example .env
docker compose up -d          # Postgres local
npm install
npm run db:generate -w packages/database
npm run db:migrate -w packages/database
npm run dev                          # API en http://localhost:4000
npm run dev -w apps/dashboard        # Consola del developer en http://localhost:3001 (opcional)
npm run dev -w apps/web              # Portal del cliente en http://localhost:3000 (opcional)
npm run dev -w apps/admin            # Admin console en http://localhost:3002 (requiere PLATFORM_ADMIN)
```

## Tests

```bash
npm run test --workspaces --if-present
```

Los tests de dominio usan fakes en memoria (repositorios y providers que implementan
los mismos puertos que Prisma/proveedores reales implementan en `infrastructure/`) y
**no requieren base de datos** — corren en milisegundos y validan las invariantes de
negocio de forma aislada, incluyendo el aislamiento multi-tenant.
