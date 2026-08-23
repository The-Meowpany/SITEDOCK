# Production Configuration Matrix

> Fase 23 §8 — matriz de configuración por entorno.
> Principio: fail-closed. Un default prohibido en producción bloquea el arranque.

## Variables por entorno

| Variable | Development | Test | Staging | Production |
|----------|------------|------|---------|-----------|
| NODE_ENV | development | test | staging | **production** |
| DATABASE_URL | localhost:5432 | N/A (fakes) | staging DB URL | **REQUERIDO** |
| CORS_ORIGIN | http://localhost:3000 | N/A | https://staging.domain | **REQUERIDO** |
| COOKIE_DOMAIN | localhost | N/A | staging domain | **REQUERIDO** |
| PORT | 4000 | N/A | 4000 | 4000 |
| PAYMENT_PROVIDER | mock | mock | stripe | **stripe** |
| STRIPE_SECRET_KEY | opcional (mock) | N/A | sk_test_... | **sk_live_... REQUERIDO** |
| STRIPE_WEBHOOK_SECRET | opcional | N/A | whsec_... | **whsec_... REQUERIDO** |
| STRIPE_API_BASE | default | N/A | default | default |
| PLATFORM_FEE_PERCENTAGE | 10 | 10 | 10 | **configurado** |
| STORAGE_PROVIDER | mock | mock | s3 | **s3** |
| S3_BUCKET | opcional | N/A | staging-bucket | **REQUERIDO** |
| S3_REGION | opcional | N/A | us-east-1 | **REQUERIDO** |
| S3_ACCESS_KEY_ID | opcional | N/A | **REQUERIDO** | **REQUERIDO** |
| S3_SECRET_ACCESS_KEY | opcional | N/A | **REQUERIDO** | **REQUERIDO** |
| EMAIL_PROVIDER | mock | mock | resend | **resend** |
| RESEND_API_KEY | opcional | N/A | re_... | **re_... REQUERIDO** |
| RESEND_FROM | opcional | N/A | **REQUERIDO** | **REQUERIDO** |
| DEMO_MODE | true | true | false | **NUNCA** |
| TRUST_PROXY | false | N/A | true | **true** |
| BACKUP_RETENTION_DAYS | 30 | 30 | 30 | **configurado** |

## Defaults PROHIBIDOS en producción

| Default | Por qué es peligroso | Mecanismo de bloqueo |
|---------|---------------------|---------------------|
| `PAYMENT_PROVIDER=mock` | Simula pagos sin dinero real | validateProductionConfig → exit(1) si stripe sin credenciales |
| `STORAGE_PROVIDER=mock` | Los backups/deployments no persisten | validateProductionConfig → exit(1) si s3 sin credenciales |
| `EMAIL_PROVIDER=mock` | Los emails no se envían | validateProductionConfig → exit(1) si resend sin credenciales |
| `DEMO_MODE=true` | Endpoints mutantes accesibles | app.ts no monta /demo-payments en producción |
| `CORS_ORIGIN=*` | Permite cualquier origen con credentials | config requiere origen explícito |

## Fail-closed verificado

```
validateProductionConfig() es llamada en server.ts ANTES de app.listen().
Si retorna errores → logger.fatal + process.exit(1).
Tests verifican cada combinación inválida.
```
