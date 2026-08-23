# Real Infrastructure Verification

> Fase 25 — estado de verificación contra infraestructura real.
> Principio: IMPLEMENTED ≠ VERIFIED. TESTED ≠ DEPLOYED. MOCKED ≠ LIVE.

## Matriz de verificación

| Capability | Status | Evidence | Date |
|------------|--------|----------|------|
| Unit tests (dominio) | ✅ VERIFIED | 336 tests passing · `npm test` | Session date |
| HTTP contract | ✅ VERIFIED | 10 smoke tests contra createApp() real | Session date |
| Security regression | ✅ VERIFIED | 88+ security tests · H1-H5 cubiertos | Session date |
| Lint (ESLint 9 flat) | ✅ VERIFIED | 0 errors · `npm run lint` | Session date |
| Typecheck (strict ×16 ws) | ✅ VERIFIED | 0 errors · `npm run typecheck` | Session date |
| Builds (API+dash+web) | ✅ VERIFIED | `npm run build` sin errores | Session date |
| npm audit | ✅ AUDITED | 8 hallazgos build/dev-only, 0 runtime explotable | Session date |
| Secret scan | ✅ VERIFIED | Escaneo estático limpio | Session date |
| CI/CD workflow | ✅ VERIFIED | SHA-pinned, least-privilege, sin secrets en PRs | Static analysis |
| PostgreSQL migrations | ❌ NOT RUN | Requiere Postgres real | — |
| PostgreSQL E2E | ❌ NOT RUN | Requiere Postgres + API corriendo | — |
| Docker build | ❌ NOT RUN | Requiere Docker daemon | — |
| Docker runtime | ❌ NOT RUN | Requiere Docker daemon | — |
| Stripe sandbox E2E | ⚙️ READY TO VERIFY | Código completo; requiere credenciales sandbox | — |
| Stripe live | ❌ NOT RUN | Requiere credenciales live + suite adversa | — |
| S3 sandbox E2E | ⚙️ READY TO VERIFY | Código completo; requiere bucket + credenciales | — |
| S3 live | ❌ NOT RUN | Requiere credenciales producción | — |
| Resend sandbox E2E | ⚙️ READY TO VERIFY | Código completo; requiere API key | — |
| Resend live | ❌ NOT RUN | Requiere credenciales producción | — |
| Staging deployment | ❌ NOT DEPLOYED | Requiere plataforma + dominio + TLS | — |
| Production deployment | ❌ NOT DEPLOYED | Requiere staging verificado previamente | — |

## Cómo desbloquear cada ítem

| Para verificar... | Ejecuta |
|---|---|
| PostgreSQL E2E | Instalar Docker → `docker compose up -d` → `npm run db:migrate` → `npm run e2e` |
| Docker build | Instalar Docker → `docker build -t sitedock-api apps/api/` → `docker run -p 4000:4000 sitedock-api` → curl /health/live |
| Stripe sandbox | Obtener sk_test + whsec → configurar env vars → ejecutar flujo checkout→webhook→ACTIVE |
| S3 sandbox | Crear bucket → configurar S3_* → ejecutar backup→restore→verificar integridad |
| Resend sandbox | Verificar dominio → RESEND_API_KEY → probar envío de email transaccional |

## Script de verificación

```bash
# Verifica qué puede verificarse con el entorno actual
node scripts/verify-infrastructure.mjs

# Solo categorías específicas
node scripts/verify-infrastructure.mjs --only=docker,postgres,e2e
```
