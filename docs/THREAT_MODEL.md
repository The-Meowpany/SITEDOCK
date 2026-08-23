# Threat Model

> Fase 21-22 — modelo de amenazas de SiteDock.
> Clasificación: CRÍTICO / ALTO / MEDIO / BAJO / INFO

## Activos protegidos

| Activo | Sensibilidad | Impacto de compromiso |
|--------|-------------|----------------------|
| Credenciales de usuario (hashes) | Alta | Suplantación de identidad |
| Sesiones activas (tokens) | Crítica | Acceso completo como usuario |
| Datos de clientes finales (emails, nombres) | Media | Violación de privacidad |
| Contenido de sitios (deployments) | Media | Defacement |
| Información de facturación (montos, estados) | Alta | Fraude financiero |
| Claves de API de providers (Stripe, S3, Resend) | Crítica | Movimiento directo de dinero / datos |
| Tokens de webhook (secrets) | Crítica | Inyección de eventos económicos falsos |

## Fronteras de confianza

```
Internet ──[TLS]── Reverse Proxy ──[HTTP]── API Server
                                              │
                                    requireSession
                                    assertWorkspaceAccess
                                    assertWebsiteAccess
                                              │
                                    Domain Layer (sin I/O)
                                              │
                              ┌───────────────┼───────────────┐
                              ↓               ↓               ↓
                          PostgreSQL      S3 Storage     Stripe/Resend
                          [confiable]    [semi-confiable] [externo]
```

## Superficies de ataque y controles

| Superficie | Ataque vectorial | Control implementado | Estado |
|-----------|-----------------|---------------------|--------|
| Autenticación | Brute force, credential stuffing | Argon2id + rate limiter 10/15min + sin enumeración | TESTED |
| Sesiones | Session fixation, replay | Token aleatorio 256 bits, SHA-256 en DB, suspensión verificada por request | TESTED |
| Multi-tenancy | IDOR/BOLA entre workspaces | assertWorkspaceAccess + assertWebsiteAccess + client scoping en cada ruta | TESTED |
| Webhooks | Forgery, replay, amount tampering | Firma HMAC-SHA256 + tolerancia temporal + claim-first idempotencia | TESTED |
| Upload ZIP | Path traversal, zip bomb, malware | extractZipSafely + límites de tamaño/tipo | IMPLEMENTED |
| Branding | XSS almacenado, inyección HTML | Validación en dominio: patrones peligrosos, URL HTTPS-only, límites | TESTED |
| S3 keys | Path traversal, prefix escape | sanitizeKey() rechaza `..`, `//`, `/` inicial | TESTED |
| Rate limiting | DoS, abuse | express-rate-limit diferenciado (auth 10/15min, general 120/min, público 30/15min) | IMPLEMENTED |
| Error leakage | Stack traces, SQL, paths | errorHandler centralizado → JSON estructurado {code,message,requestId} | TESTED |
| CORS | Cross-origin theft | Origen único configurable + credentials | IMPLEMENTED |
| Supply chain | Dependencias maliciosas | npm audit: 8 hallazgos en build/dev deps (no runtime), documentados | AUDITED |

## Hallazgos históricos (nunca eliminar — conocimiento institucional)

| # | Fase | Severidad | Vulnerabilidad | Corrección |
|---|------|-----------|---------------|------------|
| H1 | 19 | CRÍTICO | Branding PATCH route desconectada del API | Ruta conectada con OWNER/ADMIN gate |
| H2 | 19 | ALTO | Deployment GET/POST accesible cross-client dentro del workspace | Cambiado a assertWebsiteAccess con client scoping |
| H3 | 19 | ALTO | Backup routes mismo patrón IDOR | Igual corrección |
| H4 | 19 | MEDIO | Webhook no validaba monto/moneda en payment.succeeded | Validación agregada antes de mutar |

## Riesgo residual aceptado

- Rate limiting solo por IP (sin trust proxy configurado): aceptable en MVP detrás
  de reverse proxy que ya normaliza la IP real.
- No hay CSRF token explícito: SameSite=Lax + credentials-only-to-configured-origin
  mitiga el vector principal. Revisar si se agregan subdominios de terceros.
- Sin Row Level Security en PostgreSQL: el aislamiento es application-level.
  RLS sería defense-in-depth adicional pero complica las queries de admin/scheduled jobs.

## Recomendaciones para producción

1. Configurar `trust proxy` en Express para que express-rate-limit use la IP real
2. Habilitar HSTS + CSP headers en reverse proxy
3. Rotar STRIPE_WEBHOOK_SECRET periódicamente
4. Monitorear GET /admin/metrics para detectar anomalías de providers
5. Ejecutar `npm audit fix` antes del primer deploy (8 vulnerabilidades en build/dev deps)
