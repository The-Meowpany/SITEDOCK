# Configuration Reference

Todas las variables de entorno de SiteDock. Ninguna contiene credenciales reales.

## Core

| Variable | Required | Default | Production | Description |
|----------|----------|---------|-----------|-------------|
| NODE_ENV | Yes | development | **production** | Entorno de ejecución |
| PORT | No | 4000 | 4000 | Puerto del API |
| DATABASE_URL | Yes (prod) | — | **REQUERIDO** | URL PostgreSQL |
| CORS_ORIGIN | No | http://localhost:3000 | **REQUERIDO** | Origen permitido para CORS |
| COOKIE_DOMAIN | No | — | dominio.com | Dominio de la cookie de sesión |
| TRUST_PROXY | No | false | true en prod | Confía en X-Forwarded-For |

## Billing / Payments

| Variable | Default | Secret | Description |
|----------|---------|--------|-------------|
| PAYMENT_PROVIDER | mock | No | mock o stripe |
| PLATFORM_FEE_PERCENTAGE | 10 | No | Revenue share (%) |
| STRIPE_SECRET_KEY | — | **SÍ** | Clave secreta Stripe (sk_test_/sk_live_) |
| STRIPE_WEBHOOK_SECRET | — | **SÍ** | Secret de verificación de webhooks |
| STRIPE_API_BASE | https://api.stripe.com | No | Override para tests |

## Storage

| Variable | Default | Secret | Description |
|----------|---------|--------|-------------|
| STORAGE_PROVIDER | mock | No | mock o s3 |
| S3_BUCKET | — | No | Bucket S3 |
| S3_REGION | — | No | Región AWS |
| S3_ACCESS_KEY_ID | — | **SÍ** | Access key IAM |
| S3_SECRET_ACCESS_KEY | — | **SÍ** | Secret key IAM |
| S3_ENDPOINT | — | No | Override para MinIO/tests |

## Email

| Variable | Default | Secret | Description |
|----------|---------|--------|-------------|
| EMAIL_PROVIDER | mock | No | mock o resend |
| RESEND_API_KEY | — | **SÍ** | API key de Resend |
| RESEND_FROM | — | No | Remitente verificado |

## Demo / Feature flags

| Variable | Default | Description |
|----------|---------|-------------|
| DEMO_MODE | — | Fuerza OFF de endpoints demo |
| BACKUP_RETENTION_DAYS | 30 | Días antes de cleanup automático |

## Fail-closed rules

En producción (`NODE_ENV=production`):
- PAYMENT_PROVIDER=stripe sin STRIPE_SECRET_KEY → exit(1)
- STORAGE_PROVIDER=s3 sin credenciales completas → exit(1)
- EMAIL_PROVIDER=resend sin RESEND_API_KEY → exit(1)

Nunca hay fallback silencioso a mocks en producción.
