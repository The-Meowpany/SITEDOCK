# White-label Architecture Assessment

> Fase 20 — evaluación de la arquitectura actual ANTES de implementar.
> Principio: no hacer theme switching cosmático y llamarlo white-label.

## Pregunta central

¿Un freelancer/agencia puede ofrecer SiteDock bajo SU propia marca, con SU
propio dominio, SIN que sus clientes vean "SiteDock" en ningún lado?

## Lo que YA está bien separado

| Capa | Aislamiento actual | Suficiente? |
|------|-------------------|-------------|
| Tenant (workspace_id) | ✅ En cada query, enforced por AssertWorkspaceAccessUseCase | ✅ |
| Datos financieros | ✅ Por workspace, sin fugas (tests de IDOR) | ✅ |
| Storage namespace | ✅ websites/{websiteId}/... por tenant implícito | ⚠️ Falta validación explícita de ownership del key prefix |
| Dominios personalizados | ✅ Modelo Domain + DomainProvider existe | ✅ Base lista |
| Roles y permisos | ✅ OWNER/ADMIN/DEVELOPER/CLIENT por workspace | ✅ |

## Lo que falta para white-label real

### 1. Branding por workspace (CRÍTICO)

```
Workspace.branding Json? → {
  "name": "Studio XYZ",
  "logoUrl": "...",
  "primaryColor": "#2e6b57",
  "customDomain": "portal.studioxyz.com"
}
```

Afecta: portal cliente, checkout page, emails. La consola developer NO se
white-labela (es la cara de SiteDock hacia el freelancer).

### 2. Email sender por workspace

Hoy: `RESEND_FROM` global. Para white-label cada workspace necesita su propio
remitente verificado en Resend (o subdomain). Requiere:
- Resend domain verification per-workspace
- Almacenar el remitente en Workspace.branding
- NotificationService recibe `from` dinámico por evento

### 3. Custom domain para el portal cliente

El modelo Domain ya existe pero apunta a websites. White-label requiere un
dominio a nivel WORKSPACE (portal.studioxyz.com) que enrute al portal con el
branding correcto. Resolución: middleware que hace lookup inverso
host→workspaceId.

### 4. Feature flags por workspace

Algunos workspaces tendrían features que otros no (ej: cobro único vs solo
membresía). El campo `features Json` en ServicePlan ya es un patrón; falta
equivalente a nivel workspace.

## Orden de implementación recomendado (cuando toque)

1. `Workspace.branding Json?` + endpoint PATCH /workspaces/:id/branding
2. Middleware de resolución host→workspace para dominios custom
3. NotificationService acepta `from` override desde branding
4. Portal/dashboard leen branding del API en el layout
5. Validación de dominio custom vía el mismo DomainProvider existente

## Lo que NO se debe hacer

- No crear una tabla BrandingTheme separada — JSON en Workspace es suficiente
- No implementar multi-tenant DNS wildcard genérico — usar DomainProvider existente
- No abstraer el motor de templates — los templates ya son funciones puras tipadas
