# Rate Limiting Configuration

> Fase 23 §11 — límites de tasa por categoría de riesgo.
> Implementado con express-rate-limit. Todos los límites son por ventana deslizante.

## Trust Proxy

Cuando la API corre detrás de un reverse proxy (Caddy/Nginx), `app.set("trust proxy", true)`
debe estar activo para que express-rate-limit identifique la IP real del cliente
(vía X-Forwarded-For) y no la IP del proxy. Se activa automáticamente en producción
o con `TRUST_PROXY=true`.

Sin trust proxy, un atacante NO puede evadir el límite rotando X-Forwarded-For
porque Express ignora esos headers.

## Categorías

| Categoría | Ventana | Límite | Endpoints | Justificación |
|-----------|---------|--------|-----------|---------------|
| **auth** | 15 min | 10 req/IP | login, register, password-reset/* | Previene brute force y credential stuffing |
| **publicDemo** | 15 min | 30 req/IP | /public/demo-checkout/* | Superficie sin auth; previene abuse |
| **api** | 1 min | 120 req/IP | Todas las rutas bajo /api/v1 (default) | Previene abuse general sin afectar UX normal |

## Operaciones costosas (no rate-limited explícitamente, mitigadas por auth)

| Operación | Mitigación adicional |
|-----------|---------------------|
| Upload ZIP (250MB max) | Requiere DEVELOPER+ + límite de tamaño en multer |
| Create backup | Requiere DEVELOPER+ + idempotente por deployment |
| Publish deployment | Requiere DEVELOPER+ + state machine valida transición |
| Restore backup | Requiere DEVELOPER+ + integridad verificada |

## Evolución futura

- Rate limiting por workspaceId (además de IP) para operaciones autenticadas
- Redis-backed rate limiter para multi-instancia (actualmente in-memory por proceso)
- Rate limiting específico para Stripe webhooks (separado del API general)
