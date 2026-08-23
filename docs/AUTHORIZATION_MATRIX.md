# Authorization Matrix

> Fase 21 §5 — matriz explícita de autorización por rol.
> Leyenda: ✅ ALLOW · ❌ DENY · 🔶 CONDITIONAL (con restricciones)

## Operaciones sobre Workspace

| Operación | ANON | USER | CLIENT member | DEVELOPER member | ADMIN member | OWNER | PLATFORM_ADMIN |
|-----------|------|------|--------------|-----------------|-------------|-------|---------------|
| Create workspace | ❌ | ✅ (self) | N/A | N/A | N/A | N/A | ✅ |
| Read own workspace | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Read other workspace | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| Update branding | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ | ❌ |
| Add member | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ | ❌ |
| Invite client | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ | ❌ |

## Operaciones sobre Websites

| Operación | CLIENT member | DEVELOPER | ADMIN/OWNER |
|-----------|--------------|-----------|-------------|
| List websites | 🔶 solo propios | ✅ todos | ✅ todos |
| Read website detail | 🔶 solo propio | ✅ | ✅ |
| Create website | ❌ | ✅ | ✅ |
| Submit for approval | ❌ | ✅ | ✅ |
| Approve website | 🔶 solo propio | ✅ | ✅ |
| Reject approval | 🔶 solo propio | ✅ | ✅ |
| Rollback deployment | ❌ | ✅ | ✅ |

## Operaciones sobre Deployments

| Operación | CLIENT member | DEVELOPER+ |
|-----------|--------------|------------|
| List deployments (por sitio) | 🔶 solo de su sitio | ✅ |
| Read deployment | 🔶 solo de su sitio | ✅ |
| Upload ZIP → create deployment | ❌ | ✅ |
| Publish deployment | ❌ | ✅ |
| Force publish (submit→approve→publish) | ❌ | ✅ |

## Operaciones sobre Backups

| Operación | CLIENT member | DEVELOPER+ |
|-----------|--------------|------------|
| List backups | 🔶 solo de su sitio | ✅ |
| Create backup | ❌ | ✅ |
| Restore backup | ❌ | ✅ |

## Operaciones sobre Billing

| Operación | CLIENT member | DEVELOPER | ADMIN/OWNER |
|-----------|--------------|-----------|-------------|
| Read subscription (propio sitio) | 🔶 solo propio | ✅ | ✅ |
| Create subscription | ❌ | ✅ | ✅ |
| Generate checkout link | ❌ | ✅ | ✅ |
| Assign client to website | ❌ | ✅ | ✅ |
| List charges (propio sitio) | 🔶 solo propios | ✅ | ✅ |
| Create one-time charge | ❌ | ✅ | ✅ |
| Cancel charge | ❌ | ✅ | ✅ |

## Operaciones sobre Maintenance

| Operación | CLIENT member | DEVELOPER+ |
|-----------|--------------|------------|
| List requests (propio sitio) | 🔶 solo propias | ✅ |
| Create request | 🔶 solo en su sitio | ✅ |
| Quote request | ❌ | ✅ |
| Start request | ❌ | ✅ |
| Complete request | ❌ | ✅ |
| Mark as paid | ❌ | ✅ |
| Approve request | 🔶 solo su sitio | ✅ |
| Request changes | 🔶 solo su sitio | ✅ |
| Cancel request | 🔶 solo su sitio | ✅ |
| View comments | 🔶 solo su sitio | ✅ |
| Add comment | 🔶 solo su sitio | ✅ |

## Operaciones sobre Merchant/Stripe

| Operación | CLIENT | DEVELOPER | OWNER/ADMIN |
|-----------|--------|-----------|-------------|
| Connect Stripe account | ❌ | ❌ | ✅ |
| View connection status | ❌ | ✅ | ✅ |
| Create refund | ❌ | ❌ | ✅ (OWNER/ADMIN) |

## System-level (scheduled jobs / workers)

| Operación | Restricción |
|-----------|------------|
| listByStatus (cualquier aggregate) | Solo scheduled jobs, nunca user-facing |
| SuspendOverdueSubscriptionsJob | Sistema, sin tenant context |
| NotifyUpcomingRenewalsJob | Sistema, sin tenant context |
| BackupLiveWebsitesJob | Sistema, itera LIVE websites |
| CleanupExpiredBackupsJob | Sistema, sin tenant context |
| ReconciliationSource | Sistema, cross-tenant por diseño |

## Reglas estructurales

1. **CLIENT ≠ miembro pleno**: un CLIENT con sesión válida NO hereda acceso
   a todos los recursos del workspace. `assertWebsiteAccess` resuelve el
   clientId y verifica ownership por recurso.
2. **404 > 403**: cuando un usuario no autorizado accede a un recurso de otro
   cliente, la API responde 404 para no confirmar existencia.
3. **PLATFORM_ADMIN es el único rol cross-tenant** y requiere doble gate.
