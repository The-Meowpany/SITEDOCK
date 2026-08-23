# Production Readiness — Estado Real

> Última actualización: Fase 20. Etiquetas usadas: IMPLEMENTED / TESTED / VERIFIED / MISSING.
> Nada se marca VERIFIED sin ejecución real contra infraestructura externa.

## Resumen

| Capa | Estado | Detalle |
|------|--------|---------|
| Dominio | **TESTED** | 250 tests unitarios con fakes en memoria |
| API REST | **TESTED** | 10 smoke tests de contrato HTTP contra `createApp()` real |
| E2E script | **IMPLEMENTED** | `npm run e2e` — 21 pasos, requiere stack local |
| PostgreSQL | **MISSING** | Docker/Postgres no disponible en este entorno |
| Stripe Connect | **IMPLEMENTED** | Sandbox-first; live requiere credenciales reales |
| S3 Storage | **IMPLEMENTED** | SigV4 propio; live requiere bucket real |
| Resend Email | **IMPLEMENTED** | Live requiere API key + remitente verificado |
| CI/CD | **IMPLEMENTED** | GitHub Actions: lint→typecheck→test→build |
| Fail-closed producción | **TESTED** | `validateProductionConfig()` con tests |
| Métricas providers | **IMPLEMENTED** | Contadores en proceso; endpoint admin |
| Backups integridad | **TESTED** | SHA-256 verificado antes de restaurar |
| White-label | **ASSESSMENT** | Ver WHITE_LABEL_ARCHITECTURE.md |
| IaC | **ASSESSMENT** | Ver INFRASTRUCTURE_ASSESSMENT.md |

## Verificación de providers

```
STRIPE LIVE:      NOT VERIFIED — EXTERNAL CREDENTIALS REQUIRED
S3 LIVE:          NOT VERIFIED — EXTERNAL BUCKET REQUIRED
RESEND LIVE:      NOT VERIFIED — EXTERNAL API KEY REQUIRED
POSTGRESQL E2E:   NOT VERIFIED — EXTERNAL DATABASE REQUIRED
SANDBOX CODE:     IMPLEMENTED AND TESTED (offline, fakes)
```

## Qué falta para producción

1. Postgres real → correr migraciones → ejecutar `npm run e2e`
2. Credenciales sandbox de cada provider → verificar protocolo end-to-end
3. Dockerfile para apps/api, apps/dashboard, apps/web
4. Reverse proxy (Caddy/Nginx) + TLS
5. Secret management (Vault/AWS Secrets Manager)
6. Monitoring (Prometheus scrape del endpoint /admin/metrics o OTel)
7. Backup automatizado de Postgres (pg_dump cron + S3)

## Checklist para el primer deploy

- [ ] Provisionar Postgres (RDS/Neon/local)
- [ ] `npm run db:migrate` (primera vez crea el schema completo)
- [ ] Configurar STRIPE_SECRET_KEY + STRIPE_WEBHOOK_SECRET (sandbox)
- [ ] Crear bucket S3 + credenciales IAM mínimas
- [ ] RESEND_API_KEY + RESEND_FROM (dominio verificado)
- [ ] NODE_ENV=production + CORS_ORIGIN=https://tu-dominio.com
- [ ] Ejecutar `npm run e2e` contra el stack desplegado
- [ ] Verificar reconciliación: GET /admin/reconciliation?workspaceId=...
