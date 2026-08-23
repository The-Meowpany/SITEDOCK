# SiteDock — Client Portal (`apps/web`)

Portal del cliente final: una vista de solo lo esencial (docs/ARCHITECTURE.md §15
"Client Portal") — estado del sitio, suscripción y solicitudes de mantenimiento — sin
exponer nada de la complejidad técnica subyacente (deployments, dominios, storage).

## Stack

Next.js 15 (App Router) + TypeScript + CSS Modules. Sin Tailwind ni librerías de UI —
un pequeño design system propio ("Service Passbook") definido en `app/globals.css` como
variables CSS, para evitar el look genérico por defecto.

## Rutas

| Ruta | Qué hace |
|---|---|
| `/login` | Login contra `POST /api/v1/auth/login` de la API. Soporta `?returnTo=/algo` para volver adonde el usuario intentaba ir (usado por el flujo de invitación) |
| `/` | Resuelve la sesión → workspaces → websites del usuario. Si hay un solo sitio, redirige directo al portal; si hay varios, muestra un selector |
| `/portal/[workspaceId]/[websiteId]` | La vista principal: sello de estado del sitio, recibo de suscripción, lista de solicitudes de mantenimiento + formulario para pedir cambios |
| `/invite/[token]` | Acepta una invitación a un workspace. Si no hay sesión, redirige a `/login` con `returnTo` y vuelve automáticamente después de loguearse |

## Diseño

Elemento firma: el estado del sitio (`WebsiteStatus` del dominio) se muestra como un
sello de tinta rotado — verde para `LIVE`, ámbar para `PAST_DUE`/`GRACE_PERIOD`, rojo
para `SUSPENDED`. Las secciones están separadas por un divisor perforado estilo ticket.
Tipografía: serif ledger + mono para cifras/fechas, usando únicamente fuentes del
sistema (sin dependencias de red a Google Fonts u otro CDN).

## Correrlo en local

```bash
cp .env.local.example .env.local
npm run dev -w apps/web
```

Por defecto apunta a `http://localhost:4000` (la API corriendo con `npm run dev -w apps/api`).
`NEXT_PUBLIC_API_URL` en `.env.local` debe coincidir con `CORS_ORIGIN` configurado en el
`.env` de la API (por defecto ambos usan `localhost:3000` ↔ `localhost:4000`).

## Cómo probarlo con datos reales

1. Seguí el flujo de humo de `docs/LOCAL_DEVELOPMENT.md` §6 hasta tener un website LIVE
   con una suscripción activa.
2. Invitá al cliente por email (funciona exista o no la cuenta todavía — es un flujo de
   invitación real con token, expira a los 7 días):
   ```bash
   curl -b cookies.txt -X POST http://localhost:4000/api/v1/workspaces/$WS/invitations \
     -H "Content-Type: application/json" \
     -d '{"email":"cliente@example.com","role":"CLIENT"}'
   ```
   En modo demo (`MockEmailProvider`), el link de invitación no se envía por email real —
   revisá los logs de la API para verlo, o mirá la tabla `workspace_invitations` en la DB.
3. El cliente abre `/invite/<token>` en el navegador. Si no tiene cuenta, debe
   registrarse primero (`POST /api/v1/auth/register`) con **el mismo email** al que se
   envió la invitación — la aceptación valida que coincidan.
4. Tras aceptar, queda como miembro del workspace con rol `CLIENT` y es redirigido
   automáticamente al portal de su sitio.

Alternativa más rápida para pruebas: si el "cliente" ya tiene cuenta, se lo puede sumar
directamente sin invitación (`POST /workspaces/:id/members`), sin passo de aceptación.

## Build de producción

```bash
npm run build -w apps/web
```

Verificado: 5 rutas, ~104-106KB First Load JS por página, sin errores de tipos.
