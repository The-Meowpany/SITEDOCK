# ADR-002: PostgreSQL + Prisma como infraestructura de persistencia

## Status
Accepted

## Context
El modelo de dominio es relacional por naturaleza (workspaces → clients → websites →
subscriptions → invoices → payments, todos con FKs e invariantes transaccionales). El
equipo es pequeño y necesita migraciones versionadas y reproducibles desde el día 1.

## Decision
PostgreSQL como única base de datos. Prisma como ORM, confinado a la capa
`infrastructure/` de cada bounded context — `domain/` nunca importa `@prisma/client` ni
`@sitedock/database`; habla solo con interfaces de repositorio definidas en `domain/ports.ts`.

## Alternatives considered
- Drizzle: igualmente válido, descartado porque Prisma ofrece migrations + client
  generados con menos cableado inicial.
- MongoDB: descartado — los invariantes financieros (Invoice/Payment/Subscription)
  exigen transacciones y constraints relacionales fuertes.

## Consequences
- Las máquinas de estado y reglas de negocio viven en las entidades; Prisma solo mapea
  filas ↔ agregados (`hydrate`).
- Cambiar de ORM toca únicamente los archivos de `infrastructure/`, no el dominio ni
  los tests (que usan fakes en memoria).
