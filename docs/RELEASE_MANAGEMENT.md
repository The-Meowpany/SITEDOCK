# Release Management

## Versionado

SiteDock usa Semantic Versioning (`MAJOR.MINOR.PATCH`).

- **MAJOR**: breaking changes en API, schema de BD incompatible, cambios de configuración requerida
- **MINOR**: nuevas features backward-compatible
- **PATCH**: bug fixes sin cambios de API ni schema

## Proceso de release

### 1. Pre-release checklist

Ejecutar `docs/SECURITY_CHECKLIST.md` completo.

```bash
npm run lint          # 0 errores
npm run typecheck     # 0 errores
npm test              # todos pasando
npm run build --workspaces --if-present
npm audit             # revisar hallazgos nuevos
```

### 2. Migraciones

Si hay cambios al schema:
```bash
npm run db:migrate -w packages/database   # genera y aplica localmente
git add packages/database/prisma/migrations/
git commit -m "feat(db): <descripción>"
```

En producción: `prisma migrate deploy` (nunca `migrate dev`).

### 3. Deploy

Ver [DEPLOYMENT_RUNBOOK.md](DEPLOYMENT_RUNBOOK.md).

### 4. Post-deploy verification

```bash
curl https://api.domain.com/health/live    # 200
curl https://api.domain.com/health/ready   # 200
npm run e2e                                 # contra el stack desplegado
```

### 5. Rollback

Si el deploy falla:
1. Revertir a la imagen anterior del contenedor
2. Si hay migraciones destructivas: restaurar backup de BD
3. Verificar health checks después del rollback

## Hotfix

Para fixes críticos en producción:
1. Branch desde main
2. Fix + test de regresión
3. PR acelerado con review
4. Deploy directo a producción
5. Merge a develop

## Security releases

Vulnerabilidades de seguridad siguen el mismo proceso pero con:
- Review obligatorio de al menos un ingeniero senior
- Prioridad máxima en CI
- Comunicación a usuarios afectados si aplica
