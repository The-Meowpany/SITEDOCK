# Operations Manual

> Manual operacional para operar SiteDock. Un operador que jamás haya visto
> el proyecto debe poder usar esta guía.

## Inicio rápido

```bash
# 1. Postgres
docker compose up -d

# 2. Dependencias
npm install

# 3. Schema
npm run db:generate -w packages/database
npm run db:migrate -w packages/database

# 4. API
npm run dev                          # :4000

# 5. Frontends (opcional)
npm run dev -w apps/dashboard        # :3001
npm run dev -w apps/web              # :3000
```

## Detener

```bash
# Ctrl+C en cada proceso dev
docker compose down                  # detiene Postgres (preserva datos)
docker compose down -v               # detiene Y elimina datos (destructivo)
```

## Logs

La API usa pino (JSON estructurado). En desarrollo, `pino-pretty` formatea:

```bash
npm run dev                          # logs formateados automáticamente
```

En producción, los logs van a stdout en JSON. Filtrar por:
- `reqId`: correlation ID de cada request
- `level`: `info`, `warn`, `error`, `fatal`
- `msg`: mensaje legible

## Health checks

```bash
curl http://localhost:4000/health/live   # siempre 200 si el proceso vive
curl http://localhost:4000/health/ready  # 200 si Postgres responde, 503 si no
```

## Métricas

```bash
# Requiere sesión PLATFORM_ADMIN
curl http://localhost:4000/api/v1/admin/metrics \
  -H "Cookie: sid=<session-token>"
```

Retorna contadores por provider:operación con success/failure/latencia.

## Migraciones

```bash
# Primera vez (crea schema completo desde cero)
npm run db:migrate -w packages/database

# Subsecuentes cambios al schema.prisma
# 1. Editar schema.prisma
# 2. npm run db:generate -w packages/database
# 3. npm run db:migrate -w packages/database
```

## Rollback

No hay rollback automático de migraciones. Para revertir:
1. Identificar la migración problemática en `prisma/migrations/`
2. Crear una migración inversa manualmente
3. Aplicar con `prisma migrate deploy`

## Suspender/reactivar usuario

```bash
# Requiere PLATFORM_ADMIN
curl -X POST http://localhost:4000/api/v1/admin/users/<userId>/suspend \
  -H "Cookie: sid=<admin-session>"
```

El usuario suspendido pierde acceso inmediatamente (todas las sesiones son
invalidadas por `requireSession` que verifica suspensión en cada request).

## Suspender sitio

```bash
# Vía admin panel o directamente:
curl -X POST http://localhost:4000/api/v1/admin/websites/<websiteId>/suspend \
  -H "Cookie: sid=<admin-session>"
```

## Workers

```bash
npm run dev -w apps/worker           # long-lived: corre todos los jobs en sus intervalos
npm run run-once -w apps/worker      # dispara cada job una vez y sale (para cron externo)
```

Jobs incluidos:
| Job | Intervalo | Función |
|-----|-----------|---------|
| suspend-overdue-subscriptions | 15 min | GRACE_PERIOD → SUSPENDED |
| notify-upcoming-renewals | 6 h | Recordatorio antes del cobro |
| notify-expiring-ssl-domains | 24 h | Renueva SSL + alerta si falla |
| backup-live-websites | 1 h | Backup de sitios LIVE |
| cleanup-expired-backups | 24 h | Elimina backups vencidos |

## Secrets

Todos los secrets se inyectan por variables de entorno. Nunca en el código.

Ver `.env.example` para la lista completa. En producción, usar secret manager
de la plataforma de deploy.

## Provider failures

| Provider falla | Efecto | Acción |
|---------------|--------|--------|
| Stripe down | Checkout no genera URL; webhooks no llegan | Verificar status.stripe.com; los pagos pendientes se procesan cuando vuelva |
| S3 down | Deployments y backups fallan | Los jobs reintentan en la próxima corrida; verificar credenciales |
| Resend down | Emails no se envían (best-effort) | No afecta operaciones críticas; revisar RESEND_API_KEY |

## Rollback de deployment

```bash
# Via API: restaurar un backup como nueva versión y publicar
# Ver docs/BACKUP_RESTORE.md para el flujo completo
```
