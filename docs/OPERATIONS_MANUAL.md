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

## Public website delivery

Published static websites are served through `GET /public/sites/:subdomain/:path(*)`
(proxied by Caddy at `http://<host>:80/sites/<subdomain>/` in local development).

- Only websites with `status = LIVE` and a non-null `productionDeploymentId`
  are served. All other statuses return 404.
- Assets are fetched from the configured StorageProvider (mock in dev, S3 in prod)
  at `websites/{websiteId}/deployments/{productionDeploymentId}/{path}`.
- Unpublished deployments, backups, and internal metadata are never accessible
  through this route.
- Path traversal (`..`, absolute paths, null bytes) is rejected with 404.

Example: a website with subdomain `mi-sitio` and published deployment `dep-1`
serves `index.html` at `http://localhost:80/sites/mi-sitio/`.

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

## Runtime agent (service deployments)

Los servicios (contenedores) no se construyen en el worker: éste llama al
runtime agent, el único proceso con acceso a podman.

```bash
# 1. Host Linux con podman rootless. El usuario del agente necesita rangos
#    subordinados, si no `podman run` falla con "no subuid ranges found".
usermod --add-subuids 100000-165535 --add-subgids 100000-165535 <agent-user>
podman system migrate
grep <agent-user> /etc/subuid /etc/subgid   # debe mostrar el rango

# 2. Variables (API y worker comparten estas dos):
export RUNTIME_AGENT_URL=http://127.0.0.1:4010
export RUNTIME_AGENT_TOKEN=$(openssl rand -hex 32)   # mínimo 32 caracteres

# 3. Arranque del agente
node apps/runtime-agent/agent.mjs

# 4. Verificación (debe responder {"status":"ok","podman":"podman version ..."})
curl -H "authorization: Bearer $RUNTIME_AGENT_TOKEN" http://127.0.0.1:4010/healthz
```

Diagnóstico rápido de un deployment:

```bash
# Estado del deployment y logs visibles al cliente
curl -b cookies.txt "$API/workspaces/$WS/services/$SVC/deployments"
curl -b cookies.txt "$API/workspaces/$WS/services/$SVC/logs"

# Contenedores gestionados por SiteDock en el host del runtime
podman ps -a --filter label=sitedock.managed=true
```

| Síntoma | Causa | Acción |
|---------|-------|--------|
| `RUNTIME_AGENT_UNAVAILABLE` | agente caído o token distinto entre API/worker | revisar el paso 4 |
| `no subuid ranges found` | faltan rangos subordinados | comando `usermod` de arriba |
| Deployment `QUEUED` con `attempts` creciendo | el build falla y reintenta (máx. 3) | leer `/logs` del servicio |
| Servicio en `FAILED` | el primer build nunca llegó a producción | corregir Dockerfile y volver a desplegar |

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
