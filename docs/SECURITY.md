# SiteDock — Security Model

Resumen operativo del modelo de seguridad implementado. Este documento describe el
sistema real, no una aspiración.

## Identidad y sesión

- **Passwords**: Argon2id (`Argon2PasswordHasher`). Nunca se exponen hashes fuera del
  aggregate `User`.
- **Sesiones**: token aleatorio de 32 bytes en cookie `sid` httpOnly/Secure(en prod)/
  SameSite=Lax; en DB solo vive el SHA-256 del token. TTL de 7 días.
- **Revocación inmediata**: `requireSession` revalida la cuenta en cada request — un
  usuario suspendido o eliminado pierde acceso al instante aunque su cookie siga vigente.
  Lo mismo aplica al gate admin (`requirePlatformAdmin`).
- **Login sin enumeración**: credenciales inválidas devuelven siempre el mismo error
  genérico. La suspensión se informa SOLO después de verificar credenciales correctas.
- Password reset: token hasheado + expiración + single-use; nunca se devuelve el token
  crudo en producción.

## Autorización (defensa en profundidad, 4 capas)

1. **Tenant gate** — `AssertWorkspaceAccessUseCase`: membership obligatoria; ninguna
   query llega a los repositorios sin pasar por él.
2. **Role policy** — `requiredRoles` explícitos en cada endpoint de escritura
   (OWNER/ADMIN/DEVELOPER para operaciones staff).
3. **Client scoping** — rol CLIENT ≠ miembro pleno: `resolveWorkspaceAccess` /
   `assertWebsiteAccess` (apps/api/src/middleware/access-control.ts) resuelven qué
   registro de cliente representa al usuario y **fallan con 404** ante recursos de otros
   clientes (no confirman existencia). Aplica a lectura de sitios, suscripción,
   maintenance requests, dominios, approve/reject y comentarios.
4. **Platform admin** — `/api/v1/admin/*` exige doble gate (sesión + PLATFORM_ADMIN
   re-verificado contra DB); es el único lector cross-tenant permitido.

## Multi-tenancy

`workspace_id` en cada recurso comercial; los repositorios filtran por tenant en cada
query (incluidas las cadenas Payment→Invoice→Subscription→Website). Los únicos métodos
sin filtro están marcados como system-level y solo son legítimos desde scheduled jobs o
rutas admin.

## Entradas no confiables

- **Uploads ZIP** (`extractZipSafely`): path traversal, symlinks, extensiones peligrosas
  y zip-bombs bloqueados antes de tocar storage; límites de tamaño duros.
- **Validación de boundary** con zod en cada ruta; validación de dominio en los
  aggregates (las dos capas NO son intercambiables).
- **Webhooks de pago**: firma verificada sobre bytes crudos (`express.raw()` previo al
  parser global) → claim atómico del evento por constraint única → procesamiento →
  marca PROCESSED. Fallo = release del claim para que el retry del provider aplique.

## Dinero

Enteros minor units exclusivamente (`Money`, ADR-004); nunca float. Revenue-share vía
`PlatformFeePolicy` inyectable (`PLATFORM_FEE_PERCENTAGE`, default 10).

## Endpoints demo

`/demo-payments/*` (simulación de pagos y suspensión forzada) solo existen cuando
`NODE_ENV !== production && DEMO_MODE !== false`. En producción ni siquiera se montan.

## Transporte y headers

Helmet, CORS con origen único configurable + credentials, rate limiting diferenciado
(auth 10/15min, API general 120/min). Errores estructurados `{code,message,requestId}` —
nunca stack traces.

## Secretos

Solo variables de entorno (`.env.example` como plantilla); nada hardcodeado; logs
estructurados sin tokens ni secretos.
