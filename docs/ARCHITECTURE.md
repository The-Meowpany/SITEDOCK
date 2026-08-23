# SiteDock — Architecture Overview

> "Recurring Website Infrastructure for Freelancers." No es un hosting: convierte un
> proyecto web de pago único en un servicio mensual gestionado.

## 1. Estilo arquitectónico

**Modular Monolith + Async Workers**, DDD táctico + Clean/Hexagonal por bounded context.
Un único deployable (`apps/api`) al inicio, con `apps/worker` para trabajos asíncronos,
compartiendo el mismo código de dominio vía `packages/*`. Cada bounded context vive en
`packages/<context>/{domain,application,infrastructure}` con `interfaces` expuestas desde
`apps/api`.

Regla de dependencia: `interfaces → application → domain ← infrastructure`.
`domain` no importa Prisma, HTTP, Stripe, S3 ni ningún framework.

## 2. Context Map (bounded contexts)

| Context | Responsabilidad | Depende de (vía eventos/interfaces) |
|---|---|---|
| Identity | users, auth, sessions, roles | — |
| Workspace | workspaces, members, tenancy | Identity |
| Client Management | clients, invitations | Workspace |
| Website | lifecycle, environments | Workspace, Deployment(read), Billing(read via events) |
| Deployment | versions, previews, rollback | Website, Storage |
| Billing | plans, subscriptions, invoices, payments | Client, Website (events) |
| Domain Management | domains, DNS, SSL | Website |
| Maintenance | requests, comments | Client, Website, Billing(opcional) |
| Notification | emails/plantillas | todos (consumidor de eventos) |
| Infra Usage | storage/bandwidth accounting | Deployment, Storage |
| Audit | audit trail | todos (consumidor de eventos) |
| Dashboard | read-side métricas agregadas (MRR, churn, growth) | todos (read model de solo lectura) |

La integración entre contextos se hace por **Domain Events → Transactional Outbox →
Integration Events**, nunca por imports cruzados de `domain`.

## 3. Modelo de dominio (resumen)

```
User ──< WorkspaceMember >── Workspace ──< Client
Workspace ──< Project ──< Website ──< Deployment
Website ──< Domain
Website ──1── Subscription ──1── ServicePlan
Subscription ──< Invoice ──< Payment
Website ──< MaintenanceRequest ──< MaintenanceComment
* ──< AuditLog / DomainEvent(outbox)
```

Aggregates: Workspace, Website, Deployment, Subscription, ServicePlan, Client, Domain,
MaintenanceRequest. Cada uno protege sus invariantes (ver ADR-005) y expone métodos de
comportamiento (`subscription.activate()`, `website.publish(deployment)`), nunca setters
crudos de estado.

Value Objects clave: `Money` (integer minor units + `Currency`, nunca float), `EmailAddress`,
`DomainName`, `WorkspaceId`/`WebsiteId`/... (branded UUIDs), `BillingInterval`,
`WebsiteStatus`, `SubscriptionStatus`, `DeploymentStatus`.

## 4. Máquinas de estado

**Website**: `DRAFT → PREVIEW → PENDING_APPROVAL → APPROVED → LIVE ⇄ PAST_DUE →
GRACE_PERIOD → SUSPENDED → LIVE` (al pagar) `| → ARCHIVED → DELETED`.

**Deployment**: `QUEUED → BUILDING → READY → PUBLISHED` / `BUILDING → FAILED` /
`QUEUED → CANCELED`.

**Subscription**: `INCOMPLETE → TRIALING → ACTIVE ⇄ PAST_DUE → PAUSED |
GRACE_PERIOD → SUSPENDED → CANCELED/EXPIRED`. Reactivar desde `CANCELED` requiere una
nueva `Subscription` (no reutiliza la cancelada) salvo `SUSPENDED → ACTIVE` que sí es una
transición válida de recuperación de pago.

Todas las transiciones están centralizadas en una `StateMachine` genérica por agregado
(`packages/shared/state-machine.ts`), nunca `if/else` disperso.

## 5. Infraestructura (MVP)

PostgreSQL + Prisma (infra layer) · Object Storage S3-compatible detrás de
`StorageProvider` · CDN delante del storage · `PaymentProvider`
(`MockPaymentProvider` en MVP, `StripePaymentProvider` después) · `DomainProvider` mock ·
`EmailProvider` mock · Queue simple (Postgres-backed) para jobs, migrable a
BullMQ/Redis sin tocar dominio.

Nada de Kubernetes, microservicios, Kafka ni event sourcing completo en el MVP (ver ADR-001).

## 6. Seguridad (resumen — detalle en SECURITY.md cuando se genere)

Argon2id para passwords · sesiones firmadas httpOnly/secure/sameSite · RBAC (roles) +
policies explícitas (`CanPublishDeployment`, etc.) · tenant isolation obligatoria en cada
query (`WHERE id = X AND workspace_id = currentWorkspace`) · validación de uploads
(zip bombs, path traversal, MIME) · webhooks verificados + idempotentes · rate limiting
por endpoint · nunca loguear secrets/tokens/tarjetas.

## 7. MVP — orden de implementación

```
Identity → Workspace → Website → Deployment → Client → ServicePlan
→ Checkout → Subscription → Payment → Website Lifecycle
```

Este documento se ampliará por fases con `DOMAIN_MODEL.md`, `DATABASE.md`, `API.md`,
`BILLING.md`, `SECURITY.md` y ADRs conforme se implementa cada bounded context, en vez
de generarse todo de antemano de forma especulativa.

## 8. ADRs iniciales

- **ADR-001**: Modular Monolith en vez de microservicios — ver `docs/adr/0001-modular-monolith.md`
- **ADR-002**: PostgreSQL + Prisma como infra de persistencia — `docs/adr/0002-postgresql-prisma.md`
- **ADR-003**: Provider abstractions (Storage/Payment/Domain/Email) desde el día 1 — `docs/adr/0003-provider-abstractions.md`
- **ADR-004**: Money como integer minor units, nunca float — `docs/adr/0004-money-integer-minor-units.md`
- **ADR-005**: State machines centralizadas para Website/Deployment/Subscription — `docs/adr/0005-centralized-state-machines.md`
