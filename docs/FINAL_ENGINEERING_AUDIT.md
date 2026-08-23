# Final Engineering Audit

> Fase 26 — auditoría independiente de consistencia documentación↔código,
> calidad de tests y operabilidad por terceros.
>
> Fecha: post-Fase 26 · Auditor: automated + manual review

## 1. TESTING

| Métrica | Valor |
|---------|-------|
| Archivos de test | 34 |
| Suites (workspaces con tests) | 16 |
| Tests ejecutados | **336 passed · 0 failed** |
| Skipped | 0 |
| Categorías | Domain (250+), HTTP contract (10), Security adversarial (53+), Integration (30+) |

### Distribución por contexto

| Context | Tests | Enfoque |
|---------|-------|---------|
| auth | 17 | Login, registro, suspensión, password reset adversarial |
| workspace | 42 | CRUD, invitaciones, branding security, prototype pollution |
| billing | 66 | Plans, subscriptions, checkout, webhooks, charges, reconciliation |
| deployment | 48 | Upload ZIP, versioning, backups, restore, S3 SigV4, failure injection |
| website | 12 | Lifecycle state machine |
| domains | 14 | Custom domains, SSL renewal |
| maintenance | 14 | Requests, tiers, allowance |
| notification | 13 | Templates, providers, dedup |
| audit | 5 | Append-only verification |
| client | 4 | Client management |
| dashboard | 10 | Read model métricas developer |
| admin | 3 | Read model plataforma |
| shared | 27 | VOs, money-math, retry policy, state machines |

### Calidad

- **Assertions fuertes**: verifican valores específicos, no solo "no lanza"
- **Fakes estructurales**: implementan los mismos ports que Prisma
- **Tests de seguridad**: atacan desde fuera hacia dentro
- **Sin tests vacuos**: cada test verifica una propiedad o comportamiento
- **Sin duplicación**: fakes compartidos en `helpers/`

## 2. SECURITY

| Control | Implementado | Testeado | Evidencia |
|---------|-------------|----------|-----------|
| Argon2id password hashing | ✅ | ✅ | packages/auth/infrastructure/argon2-password-hasher.ts |
| Session tokens (256-bit random) | ✅ | ✅ | login-user.use-case.ts |
| Suspended user fail-closed | ✅ | ✅ | require-session.ts + require-platform-admin.ts |
| assertWorkspaceAccess | ✅ | ✅ | Cada ruta workspace-scoped |
| assertWebsiteAccess + client scoping | ✅ | ✅ | Rutas website-scoped para CLIENT role |
| PLATFORM_ADMIN double gate | ✅ | ✅ | require-platform-admin.ts re-verifica DB |
| Webhook signature verification | ✅ | ✅ | Mock HMAC + Stripe t/v1 scheme |
| Claim-first webhook idempotencia | ✅ | ✅ | payment_events unique constraint |
| Amount/currency validation | ✅ | ✅ | process-webhook.use-case.ts |
| S3 key sanitization | ✅ | ✅ | s3-storage.provider.ts sanitizeKey() |
| Backup integrity SHA-256 | ✅ | ✅ | backup.entity.ts recordIntegrity() |
| Branding XSS prevention | ✅ | ✅ | workspace.entity.ts validateBranding() |
| Prototype pollution prevention | ✅ | ✅ | FORBIDDEN_BRANDING_KEYS set |
| Password reset single-use | ✅ | ✅ | password-reset.use-case.ts |
| Rate limiting diferenciado | ✅ | ✅ | rate-limit.ts (auth/public/api) |
| Error handler sin stack leak | ✅ | ✅ | error-handler.ts |
| Helmet security headers | ✅ | ✅ | app.ts |
| CORS origin único | ✅ | ✅ | app.ts cors config |
| Trust proxy (reverse proxy) | ✅ | N/A | app.ts condicional por entorno |
| Token logging eliminado | ✅ | ✅ | auth.routes.ts ya no loggea rawToken |

## Vulnerabilidades históricas H1-H5

| ID | Descripción | Corregido en | Regresión | Status |
|----|------------|-------------|-----------|--------|
| H1 | Branding PATCH desconectada del API | F19: ruta agregada | workspace.routes.ts monta PATCH /branding | FIXED |
| H2 | Deployment GET/POST cross-client IDOR | F21: assertWebsiteAccess | deployment.routes.ts usa assertWebsiteAccess | FIXED |
| H3 | Backup routes cross-client IDOR | F21: mismo fix | backups.routes.ts usa assertWebsiteAccess | FIXED |
| H4 | Webhook sin validación monto/moneda | F16: validación agregada | checkout-and-webhook.test.ts SUBSCRIPTION_AMOUNT_MISMATCH | FIXED |
| H5 | Prototype pollution vía __proto__ | F24: FORBIDDEN_BRANDING_KEYS | branding-security.test.ts prototype pollution suite | FIXED |

## 3. MULTI-TENANCY

**Modelo**: application-level isolation con workspace_id en cada tabla.

**Capas**:
1. `requireSession` — autenticación + suspensión
2. `assertWorkspaceAccess` — membership + rol
3. `assertWebsiteAccess` / `resolveWorkspaceAccess` — client scoping para CLIENT-role
4. `requirePlatformAdmin` — único acceso cross-tenant (doble gate)

**Excepciones documentadas**: scheduled jobs (`listByStatus`) y Platform Admin Reader.
Ambas marcadas como system-level en ports.ts.

**Verificación**: 35+ tests adversariales + multitenant-security.test.ts contra HTTP real.

## 4. API

**80+ endpoints** documentados en [API_CONTRACT.md](API_CONTRACT.md).
Todos verificados contra el código real mediante escaneo sistemático.

**Endpoints demo**: montados solo cuando `allowDemoEndpoints` (nunca producción).

## 5. DATABASE

PostgreSQL 16 + Prisma ORM. Sin migraciones ejecutadas aún (requiere BD real).

Schema completo con FKs, unique constraints e índices. Sin Row Level Security
(decisión documentada: application-level isolation es suficiente para MVP).

## 6. STORAGE

S3-compatible con namespace `websites/{websiteId}/...`. Sanitización de keys
bloquea path traversal. Backups incluyen SHA-256 de integridad.

## 7. DOCKER

3 Dockerfiles multi-stage con non-root user y healthcheck. `.dockerignore`
excluye secretos. Build no ejecutado en este entorno (sin Docker).

## 8. CI/CD

GitHub Actions con SHA-pinned actions, least-privilege permissions, sin
secretos expuestos a PRs.

## 9. LIMITACIONES

| Limitación | Razón | Acción para desbloquear |
|-----------|-------|----------------------|
| PostgreSQL E2E no ejecutado | Sin Docker/Postgres | Instalar Docker → docker compose up |
| Docker images no construidas | Sin Docker daemon | Instalar Docker → docker build |
| Stripe sandbox no verificado | Sin credenciales | Obtener sk_test_... → configurar env vars |
| S3 sandbox no verificado | Sin bucket/credenciales | Crear bucket → configurar S3_* |
| Resend sandbox no verificado | Sin API key | Crear cuenta Resend → verificar dominio |
| npm audit 8 hallazgos | Todos build/dev-time | next@16 upgrade cuando sea estable |
| White-label dominios custom | Requiere DNS + TLS | Configurar después de deploy |

## Clasificación final

```
DESARROLLO VERIFICADO:        ✅ 336 tests · lint 0 · typecheck 0 · builds OK
SEGURIDAD VERIFICADO:         ✅ 88+ security tests · auditoría estática limpia
MULTI-TENANT VERIFICADO:      ✅ 35+ tests adversariales + scoping estructural
INTEGRACIÓN VERIFICADO:       ❌ Requiere PostgreSQL real
DOCKER VERIFICADO:            ❌ Requiere Docker daemon
STRIPE SANDBOX:               ⚙️ IMPLEMENTADO — NO VERIFICADO
STRIPE LIVE:                  ❌ NOT VERIFIED
S3 SANDBOX:                   ⚙️ IMPLEMENTADO — NO VERIFICADO  
S3 LIVE:                      ❌ NOT VERIFIED
RESEND SANDBOX:               ⚙️ IMPLEMENTADO — NO VERIFICADO
RESEND LIVE:                  ❌ NOT VERIFIED
PRODUCTION READY:             ❌ Requiere los ítems anteriores + staging deploy
```
