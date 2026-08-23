# Troubleshooting

Guía de resolución de problemas comunes en SiteDock.

## API

| Síntoma | Causa | Solución |
|---------|-------|----------|
| `ECONNREFUSED` al iniciar API | Postgres no está corriendo | `docker compose up -d` y verificar con `docker compose ps` |
| `P1012` error en prisma generate | Schema.prisma inválido | Revisar sintaxis del schema |
| `P2002` unique constraint violation | Registro duplicado | Verificar unique constraints en schema |
| 401 en rutas protegidas | Falta cookie `sid` o sesión expirada | Hacer login primero |
| 403 Forbidden | Usuario sin rol requerido para la operación | Verificar rol en workspace_members |

## Providers

| Síntoma | Causa | Solución |
|---------|-------|----------|
| Stripe: `Invalid webhook signature` | STRIPE_WEBHOOK_SECRET incorrecto | Verificar que coincida con el secret del endpoint en Stripe Dashboard |
| Stripe: 429 Rate Limited | Demasiadas requests a la API de Stripe | Esperar el tiempo indicado en Retry-After; los jobs respetan backoff |
| S3: `Access Denied` | Credenciales IAM insuficientes | Verificar permisos s3:PutObject, s3:GetObject, s3:DeleteObject |
| S3: `NoSuchBucket` | Bucket no existe o región incorrecta | Verificar S3_BUCKET y S3_REGION |
| Resend: 422 validation_error | Email o formato inválido | Verificar RESEND_FROM (dominio verificado) y destinatario |
| Resend: 401 | RESEND_API_KEY inválida o revocada | Regenerar API key en dashboard de Resend |

## Workers

| Síntoma | Causa | Solución |
|---------|-------|----------|
| Worker no procesa jobs | Postgres no accesible | Verificar DATABASE_URL y conectividad |
| Duplicate notifications | No debería ocurrir — ledger dedup previene | Si ocurre, verificar que NotificationLogRepository esté correctamente cableado |
| SSL renewal falla repetidamente | Dominio DNS no apunta a SiteDock o provider rechaza | Verificar DNS y estado del dominio en /domains |

## Frontend

| Síntoma | Causa | Solución |
|---------|-------|----------|
| CORS error en browser | NEXT_PUBLIC_API_URL no coincide con CORS_ORIGIN del API | Configurar ambos con el mismo origen |
| 404 en todas las rutas del dashboard | API no está corriendo en :4000 | Iniciar API primero |
| Redirect infinito a login | Sesión expirada pero cookie residual | Limpiar cookies del navegador |
| Branding PATCH retorna 500 | Error interno — revisar logs del API | Verificar formato JSON del payload |

## Base de datos

| Síntoma | Causa | Solución |
|---------|-------|----------|
| `P3006` migration failed | BD en estado inconsistente | Usar `prisma migrate reset` solo en desarrollo |
| Prisma Client out of date | Cambios al schema sin regenerar | Ejecutar `npm run db:generate -w packages/database` |
| Connection pool exhausted | Demasiadas conexiones concurrentes | Verificar connection_limit en DATABASE_URL |
