# Security Checklist

> Usar antes de cada release. Cada ítem debe estar verificado, no asumido.

## Código y tests

- [ ] Todos los tests pasan (`npm test`)
- [ ] Lint sin errores (`npm run lint`)
- [ ] Typecheck sin errores (`npm run typecheck`)
- [ ] Builds OK (api + dashboard + web)
- [ ] Regresiones H1-H5 cubiertas
- [ ] Nuevas rutas tienen gates de autorización apropiados
- [ ] Nuevas queries de repositorio filtran por workspaceId
- [ ] Cambios en billing incluyen regresiones financieras

## Seguridad

- [ ] Secret scan limpio (no credenciales commiteadas)
- [ ] `npm audit` revisado — vulnerabilidades runtime clasificadas
- [ ] Branding validation pasa (prototype pollution, XSS)
- [ ] S3 key sanitization pasa (path traversal)
- [ ] Webhook signature verification pasa
- [ ] Password reset token NO aparece en logs ni respuestas API
- [ ] Suspended users no acceden (requireSession valida por request)

## Infraestructura

- [ ] Dockerfiles usan non-root user
- [ ] `.dockerignore` excluye `.env`, `node_modules`, `.git`
- [ ] CI workflow usa SHA-pinned actions
- [ ] CI tiene `permissions: contents: read`
- [ ] Variables de entorno documentadas en `.env.example`
- [ ] `validateProductionConfig()` cubre nuevos providers agregados

## Deploy

- [ ] Migraciones aplicadas contra la BD de destino
- [ ] Health checks responden (/health/live + /health/ready)
- [ ] Rollback disponible (imagen anterior o migración inversa)
- [ ] Backup de BD ejecutado antes del deploy
