# SiteDock — Checklist de despliegue a producción

## 1. Infraestructura (antes del despliegue)

- [ ] Servidor con Docker + Docker Compose instalado
- [ ] PostgreSQL provisionado (RDS, Neon, o Docker local)
- [ ] Bucket S3 creado con credenciales IAM mínimas
- [ ] Cuenta de Stripe con modo live activado
- [ ] Cuenta de Resend con dominio verificado
- [ ] Dominios apuntando a la IP del servidor (A records)
- [ ] Puertos 80 y 443 abiertos en el firewall

## 2. Variables de entorno (.env)

- [ ] POSTGRES_USER / POSTGRES_PASSWORD / POSTGRES_DB
- [ ] DATABASE_URL (apuntando a PostgreSQL real)
- [ ] NODE_ENV=production
- [ ] CORS_ORIGIN (dominios reales del dashboard y portal)
- [ ] COOKIE_DOMAIN / COOKIE_SECURE=true
- [ ] STRIPE_SECRET_KEY (sk_live_...)
- [ ] STRIPE_WEBHOOK_SECRET (whsec_...)
- [ ] STORAGE_PROVIDER=s3
- [ ] S3_BUCKET / S3_REGION / S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY
- [ ] EMAIL_PROVIDER=resend
- [ ] RESEND_API_KEY / RESEND_FROM (dominio verificado)
- [ ] DEMO_MODE=false
- [ ] BACKUP_RETENTION_DAYS=30
- [ ] ACME_EMAIL (para certificados Let's Encrypt)

## 3. Despliegue

- [ ] `cp .env.example .env` y editar con valores reales
- [ ] `docker compose up -d` (levantar todo el stack)
- [ ] Verificar `GET /health/ready` en la API
- [ ] Ejecutar `npx prisma migrate deploy` (migraciones)
- [ ] Configurar webhook de Stripe apuntando a `https://api.tudominio.com/webhooks/payments/stripe`
- [ ] Verificar que Caddy obtuvo certificados TLS (candado en el navegador)

## 4. Post-despliegue

- [ ] Ejecutar `npm run e2e` contra el stack desplegado
- [ ] Verificar `GET /admin/reconciliation` sin excepciones
- [ ] Configurar cron para `scripts/backup-postgres.sh` (diario)
- [ ] Verificar métricas en Prometheus (puerto 9090)
- [ ] Configurar alertas de caída del contenedor API

## 5. Operaciones continuas

- [ ] Rotación de certificados TLS (automática con Caddy)
- [ ] Limpieza de backups antiguos (30 días por defecto)
- [ ] Monitoreo de logs del worker (jobs fallidos)
- [ ] Rotación de secretos (Stripe, S3, Resend) cada 90 días
