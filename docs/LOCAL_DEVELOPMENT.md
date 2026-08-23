# Local Development

## Requisitos

- Node.js ≥ 20
- Docker (para Postgres local) — o un Postgres 16 accesible por otra vía
- npm ≥ 10 (el repo usa npm workspaces)

## 1. Variables de entorno

```bash
cp .env.example .env
```

`DATABASE_URL` ya apunta al Postgres del `docker-compose.yml` incluido. Nunca commitees
un `.env` con secretos reales — `.env.example` es la única plantilla versionada.

## 2. Levantar Postgres

```bash
docker compose up -d
docker compose ps   # confirmar que el healthcheck está "healthy"
```

## 3. Instalar dependencias

```bash
npm install
```

Esto instala todos los workspaces (`apps/*`, `packages/*`) de una sola vez.

## 4. Generar el cliente de Prisma y migrar

```bash
npm run db:generate -w packages/database
npm run db:migrate -w packages/database
```

> **Nota sobre entornos con red restringida**: `prisma generate` descarga un motor
> nativo desde `binaries.prisma.sh`. Si trabajás detrás de un proxy/firewall que bloquea
> ese dominio, agregalo a tu allowlist o usá `PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING=1`
> como workaround temporal (no recomendado en CI/producción). En una máquina de
> desarrollo normal esto no requiere ningún paso adicional.
>
> Esta limitación se confirmó durante el desarrollo: en el sandbox usado para construir
> este repo, `binaries.prisma.sh` no está en la allowlist de red y `prisma generate`
> falla con `403 Forbidden` incluso con `PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING=1`. Como
> consecuencia, `apps/api` no pudo arrancarse en runtime en ese entorno — todos los
> paquetes de dominio (`packages/shared|auth|workspace|client|website|deployment|billing`)
> importan `@sitedock/database`, y el `PrismaClient` sin generar lanza en el `import`.
> Esto **no es un defecto del código**: los 86 tests unitarios de dominio (que usan
> repositorios en memoria, no Prisma) pasan sin problema, y `npx tsc --noEmit` está
> limpio en los 8 paquetes. En cualquier máquina con acceso normal a internet,
> `prisma generate` + `npm run dev` deberían funcionar de punto a punto sin cambios.

## 5. Levantar la API

```bash
npm run dev
```

La API queda en `http://localhost:4000`. Probar:

```bash
curl http://localhost:4000/health/live
curl http://localhost:4000/health/ready   # requiere Postgres arriba
```

## 6. Flujo de humo manual (Identity → Workspace → Client → Website → Deployment → Billing)

```bash
# Registrar un developer
curl -X POST http://localhost:4000/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"dev@example.com","password":"supersecret","fullName":"Jane Dev"}'

# Login (guarda la cookie de sesión)
curl -c cookies.txt -X POST http://localhost:4000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"dev@example.com","password":"supersecret"}'

# Crear un workspace — guardá el workspaceId de la respuesta
curl -b cookies.txt -X POST http://localhost:4000/api/v1/workspaces \
  -H "Content-Type: application/json" -d '{"name":"Studio XYZ"}'
WS=<workspaceId>

# Crear un cliente
curl -b cookies.txt -X POST http://localhost:4000/api/v1/workspaces/$WS/clients \
  -H "Content-Type: application/json" \
  -d '{"fullName":"Juan Pérez","email":"juan@restaurante.com"}'
CLIENT=<clientId>

# Crear un proyecto y un website
curl -b cookies.txt -X POST http://localhost:4000/api/v1/workspaces/$WS/projects \
  -H "Content-Type: application/json" -d '{"name":"Restaurante Pérez"}'
PROJECT=<projectId>

curl -b cookies.txt -X POST http://localhost:4000/api/v1/workspaces/$WS/websites \
  -H "Content-Type: application/json" -d "{\"projectId\":\"$PROJECT\",\"name\":\"Restaurante Pérez\"}"
SITE=<websiteId>

# Subir un ZIP con index.html (deployment v1) y verlo en preview
curl -b cookies.txt -X POST http://localhost:4000/api/v1/workspaces/$WS/websites/$SITE/deployments \
  -F "file=@site-v1.zip"
DEPLOY=<deploymentId>

# Aprobar el website y publicar el deployment (APPROVED → LIVE)
curl -b cookies.txt -X POST http://localhost:4000/api/v1/workspaces/$WS/websites/$SITE/submit-for-approval
curl -b cookies.txt -X POST http://localhost:4000/api/v1/workspaces/$WS/websites/$SITE/approve
curl -b cookies.txt -X POST http://localhost:4000/api/v1/workspaces/$WS/websites/$SITE/deployments/$DEPLOY/publish

# Crear un plan de US$29/mes
curl -b cookies.txt -X POST http://localhost:4000/api/v1/workspaces/$WS/plans \
  -H "Content-Type: application/json" \
  -d '{"name":"Professional","priceDecimal":"29.00","currency":"USD","billingInterval":"MONTHLY"}'
PLAN=<planId>

# Asignar el cliente al website y crear la suscripción
curl -b cookies.txt -X POST http://localhost:4000/api/v1/workspaces/$WS/websites/$SITE/subscription/assign-client \
  -H "Content-Type: application/json" -d "{\"clientId\":\"$CLIENT\"}"

curl -b cookies.txt -X POST http://localhost:4000/api/v1/workspaces/$WS/websites/$SITE/subscription \
  -H "Content-Type: application/json" -d "{\"planId\":\"$PLAN\"}"
SUB=<subscriptionId>

# Generar el checkout — el "checkoutSessionId" es el último segmento de la URL
curl -b cookies.txt -X POST http://localhost:4000/api/v1/workspaces/$WS/websites/$SITE/subscription/$SUB/checkout
# => { "checkoutUrl": "https://pay.sitedock.demo/checkout/demo_cs_..." }
SESSION=<demo_cs_...>

# Simular el pago exitoso: firma y entrega el webhook por el mismo camino
# verify→idempotencia→lifecycle que usaría un proveedor real
curl -b cookies.txt -X POST http://localhost:4000/api/v1/workspaces/$WS/demo-payments/simulate-payment-succeeded \
  -H "Content-Type: application/json" -d "{\"checkoutSessionId\":\"$SESSION\"}"
# => Subscription ACTIVE, Website reactivado si correspondía

# Simular un pago fallido (Subscription → PAST_DUE) y luego suspensión manual
curl -b cookies.txt -X POST http://localhost:4000/api/v1/workspaces/$WS/demo-payments/simulate-payment-failed \
  -H "Content-Type: application/json" -d "{\"checkoutSessionId\":\"$SESSION\"}"

curl -b cookies.txt -X POST http://localhost:4000/api/v1/workspaces/$WS/demo-payments/suspend-for-nonpayment \
  -H "Content-Type: application/json" -d "{\"websiteId\":\"$SITE\"}"

# Reactivar tras pago recuperado
curl -b cookies.txt -X POST http://localhost:4000/api/v1/workspaces/$WS/demo-payments/simulate-payment-succeeded \
  -H "Content-Type: application/json" -d "{\"checkoutSessionId\":\"$SESSION\"}"
```

Este flujo ejercita exactamente los pasos 1–22 del criterio final del brief original
(`Create Website → Upload → Deploy → Create Client → Create Plan → Checkout → Payment
→ Subscription Active → Website Live → payment_failed → PAST_DUE → SUSPENDED → pago
exitoso → LIVE`), incluyendo el camino real de verificación de firma + idempotencia de
webhooks (no solo un atajo que fuerza el estado).

### 6.1 · E2E automatizado (`npm run e2e`)

El mismo flujo completo, automatizado en `scripts/e2e-demo.mjs` — 21 pasos que cubren el
criterio final §51 incluyendo tiers de mantenimiento con cuota, cobro único por proyecto,
pago del cliente vía la página pública demo, suspensión por mora, recuperación y
verificación de MRR/audit log:

```bash
# Con API corriendo en :4000 (y Postgres arriba):
npm run e2e

# Contra otra base URL:
BASE_URL=http://localhost:4000 node scripts/e2e-demo.mjs
```

El script es fail-fast: corta en el primer paso que falle indicando cuál fue — pensado
para validar la plataforma completa tras cambios de infraestructura.

## 7. Tests

```bash
# Todos los paquetes con script "test" definido
npm run test --workspaces --if-present

# Un paquete específico
npx vitest run --root packages/workspace
```

Los tests de dominio no tocan la base de datos: usan repositorios en memoria (fakes)
que implementan los mismos puertos (`UserRepository`, `WorkspaceRepository`, etc.) que
Prisma implementa en `infrastructure/`. Esto es lo que permite testear las reglas de
negocio — incluido el aislamiento multi-tenant — sin levantar Postgres.

## 8. Maintenance requests y dominios personalizados (Fase 3)

```bash
# Crear una solicitud de mantenimiento
curl -b cookies.txt -X POST http://localhost:4000/api/v1/workspaces/$WS/websites/$SITE/maintenance-requests \
  -H "Content-Type: application/json" \
  -d '{"title":"Cambiar horario","description":"El restaurante ahora cierra a las 23hs"}'
REQ=<requestId>

curl -b cookies.txt -X POST http://localhost:4000/api/v1/workspaces/$WS/websites/$SITE/maintenance-requests/$REQ/start
curl -b cookies.txt -X POST http://localhost:4000/api/v1/workspaces/$WS/websites/$SITE/maintenance-requests/$REQ/complete
curl -b cookies.txt -X POST http://localhost:4000/api/v1/workspaces/$WS/websites/$SITE/maintenance-requests/$REQ/approve

# Registrar y verificar un dominio personalizado
curl -b cookies.txt -X POST http://localhost:4000/api/v1/workspaces/$WS/websites/$SITE/domains \
  -H "Content-Type: application/json" -d '{"hostname":"restauranteperez.com"}'
DOMAIN=<domainId>

curl -b cookies.txt -X POST http://localhost:4000/api/v1/workspaces/$WS/websites/$SITE/domains/$DOMAIN/verify
```

Las notificaciones (`@sitedock/notification`) están cableadas en modo demo
(`MockEmailProvider`, que solo guarda los emails en memoria/log — no envía nada real).
Se disparan automáticamente al registrarse, al confirmar un pago, al publicar un
deployment y al suspender un sitio. Revisá los logs de la API (`pino-pretty`) para ver
cada notificación "enviada" en modo demo.

## 9. Audit log (Fase 4)

Todas las acciones críticas quedan registradas de forma append-only. Para consultarlas:

```bash
curl -b cookies.txt http://localhost:4000/api/v1/workspaces/$WS/audit-logs
```

Requiere rol `OWNER` o `ADMIN` en el workspace. Cada entrada incluye `action`
(`USER_LOGIN`, `WEBSITE_CREATED`, `PAYMENT_RECEIVED`, `WEBSITE_SUSPENDED`, etc.),
`actorId`, `resourceType`/`resourceId`, `metadata` y `createdAt`. El registro nunca se
edita ni se borra — cada operación crea una entrada nueva; no existe ningún endpoint de
actualización o eliminación en `@sitedock/audit`.

## 10. Scheduled jobs (Fase 5/8/10)

`apps/worker` corre trabajos periódicos fuera del ciclo de request HTTP
(docs/ARCHITECTURE.md §29/§31). Hay cinco:

**`suspend-overdue-subscriptions`** (cada 15 minutos) — busca cada suscripción en
`GRACE_PERIOD` cuyo plazo ya venció, la marca `SUSPENDED`, suspende el website
correspondiente y notifica al cliente — cerrando automáticamente el ciclo que antes solo
se podía disparar a mano desde `/demo-payments/suspend-for-nonpayment`.

**`notify-upcoming-renewals`** (cada 6 horas) — busca suscripciones `ACTIVE` cuya
próxima renovación está a menos de 3 días (`FindUpcomingRenewalsUseCase`) y les envía al
cliente un recordatorio con monto y fecha antes del cobro, reduciendo los pagos
fallidos por tarjeta vencida. Es idempotente contra el ledger de notificaciones: como
mucho UN recordatorio por suscripción por período de facturación, sin importar cuántas
veces corra el job.

**`notify-expiring-ssl-domains`** (diario) — renueva automáticamente los certificados
SSL de dominios VERIFIED cuyo vencimiento entra en una ventana de 30 días (vía el mismo
`DomainProvider` que los emitió). Si una renovación falla, alerta al staff del
workspace (`domain_expiring`, máximo un email por dominio por día).

**`backup-live-websites`** (cada hora) — garantiza que cada sitio LIVE tenga backup de
sus artefactos de producción actuales (`BACKUP_RETENTION_DAYS`, default 30). Idempotente
por deployment: un nuevo publish genera exactamente un backup nuevo en la próxima
corrida.

**`cleanup-expired-backups`** (diario) — elimina backups vencidos: primero los objetos
de storage, después las filas.

Dos formas de correrlos:

```bash
# Proceso long-lived: corre cada job una vez al arrancar y después en su propio
# intervalo (15 minutos para SuspendOverdueSubscriptionsJob)
npm run dev -w apps/worker

# Disparo único, pensado para cron externo / CI en vez de mantener un proceso vivo
npm run run-once -w apps/worker
```

Para probarlo manualmente sin esperar el intervalo: dejá una suscripción en
`GRACE_PERIOD` (por ejemplo con el flujo de `simulate-payment-failed` +
`suspend-for-nonpayment` del paso 6, pero deteniéndote antes de la suspensión
real), y corré `npm run run-once -w apps/worker` — el log debería mostrar
`"Suspended overdue subscription and website"`.

El job de suspensión es idempotente: correrlo dos veces seguidas solo suspende una vez,
porque una suscripción ya `SUSPENDED` deja de aparecer en `listByStatus("GRACE_PERIOD")`
en la siguiente corrida. El de recordatorios es idempotente contra el ledger: la
segunda corrida del mismo día reporta `alreadyNotifiedCount` y no reenvía nada. Para
verlo en acción: creá una suscripción activa cuyo `nextBillingDate` quede a menos de 3
días (se setea solo al activarla) y corré `npm run run-once -w apps/worker` — el log
debería mostrar `"NotifyUpcomingRenewalsJob run complete"` con `remindedCount: 1`, y el
email "enviado" queda visible en los logs (`MockEmailProvider`).

## 11. Client Portal (Fase 6)

`apps/web` es la interfaz que ve el cliente final del freelancer — estado del sitio,
suscripción y solicitudes de mantenimiento, sin nada de la complejidad técnica
subyacente (docs/ARCHITECTURE.md §15).

```bash
cp apps/web/.env.local.example apps/web/.env.local
npm run dev -w apps/web
```

Corre en `http://localhost:3000` por defecto, apuntando a la API en
`http://localhost:4000` (`NEXT_PUBLIC_API_URL`). Para probarlo con datos reales, seguí
el flujo del paso 6 hasta tener un website LIVE con suscripción activa, invitá al
cliente al workspace (ver §11.1 abajo), y logueate como esa persona en `/login`. Ver
`apps/web/README.md` para el detalle completo.

Build de producción:

```bash
npm run build -w apps/web
```

### 11.1 Invitar a un cliente (flujo por token)

```bash
# Genera una invitación pendiente por 7 días, funciona exista o no la cuenta todavía
curl -b cookies.txt -X POST http://localhost:4000/api/v1/workspaces/$WS/invitations \
  -H "Content-Type: application/json" \
  -d '{"email":"cliente@example.com","role":"CLIENT"}'
```

En modo demo el email no se envía de verdad (`MockEmailProvider`) — el link de
invitación queda en los logs de la API. El cliente lo abre en
`http://localhost:3000/invite/<token>`; si no tiene cuenta, se registra primero con
**el mismo email** al que se invitó (la aceptación valida que coincidan — ver
`WorkspaceInvitation.accept()` en `packages/workspace`), y después de loguearse queda
sumado automáticamente al workspace con el rol asignado.

Atajo directo si el cliente ya tiene cuenta y no hace falta el paso de aceptación:

```bash
curl -b cookies.txt -X POST http://localhost:4000/api/v1/workspaces/$WS/members \
  -H "Content-Type: application/json" \
  -d '{"email":"cliente@example.com","role":"CLIENT"}'
```

## 12. Admin Console (Fase 9)

`apps/admin` es el panel de administración de la plataforma (brief §27): métricas
globales (MRR/ARR de plataforma, sitios por estado, pagos fallidos, deployments),
tenants, usuarios, sitios, pagos recientes y ledger de webhook events — con acciones
auditadas de suspender/reactivar usuarios y suspender sitios.

```bash
# Promover una cuenta existente a PLATFORM_ADMIN (no hay signup admin por diseño):
docker compose exec postgres psql -U sitedock -d sitedock \
  -c "UPDATE users SET platform_role = 'PLATFORM_ADMIN' WHERE email = 'admin@example.com';"

cp apps/admin/.env.local.example apps/admin/.env.local
npm run dev -w apps/admin
```

Corre en `http://localhost:3002`. La API exige doble gate en `/api/v1/admin/*`:
sesión válida + `platform_role = 'PLATFORM_ADMIN'` (re-verificado contra DB en cada
request; un admin suspendido pierde acceso al instante). Cada mutación queda auditada
con `ADMIN_ACTION` o `WEBSITE_SUSPENDED` y el actorId del admin.

Build de producción:

```bash
npm run build -w apps/admin
```

## 13. Developer Console (Fase 7)

`apps/dashboard` es la interfaz del freelancer: su cartera de sitios vista como un
negocio recurrente (docs/ARCHITECTURE.md §18). Muestra MRR/ARR, MRR en riesgo,
suscripciones activas, sitios por estado, pagos fallidos, solicitudes abiertas,
deployments, almacenamiento, ingresos de los últimos 6 meses, altas/bajas con churn y
principales clientes.

```bash
cp apps/dashboard/.env.local.example apps/dashboard/.env.local
npm run dev -w apps/dashboard
```

Corre en `http://localhost:3001` por defecto. Logueate con tu cuenta de developer (la
misma que usaste en el paso 6) — al entrar redirige automáticamente a tu primer
workspace. Los datos vienen de `GET /api/v1/workspaces/:id/dashboard`, un read model
de solo lectura (`@sitedock/dashboard`) con aislamiento de tenant verificado en cada
query; requiere rol `OWNER`, `ADMIN` o `DEVELOPER`.

Build de producción:

```bash
npm run build -w apps/dashboard
```

## 14. Typecheck

```bash
npm run typecheck --workspaces --if-present
```

## Troubleshooting

| Síntoma | Causa probable |
|---|---|
| `ECONNREFUSED` al pegarle a la API | Postgres no está arriba o `DATABASE_URL` mal configurado |
| `403` en `prisma generate` | Red restringida — ver nota en el paso 4 |
| `401 Unauthorized` en rutas de workspace | Falta la cookie `sid` — hacé login primero |
| `403 Forbidden` en `/workspaces/:id` | El usuario autenticado no es miembro de ese workspace (aislamiento de tenant funcionando como se espera) |


