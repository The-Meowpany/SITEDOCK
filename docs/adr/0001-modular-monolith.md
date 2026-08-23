# ADR-001: Modular Monolith + Async Workers

## Status
Accepted

## Context
El producto necesita moverse rápido (MVP con 100 developers / 1.000 websites) sin
bloquear una evolución futura hacia servicios extraídos (deployment, billing) si el
crecimiento lo justifica.

## Decision
Un único backend deployable (`apps/api`) organizado en bounded contexts aislados por
carpeta (`packages/<context>/{domain,application,infrastructure}`), comunicados
internamente por interfaces de dominio y eventos, no por imports directos entre
`domain` de distintos contextos. Trabajos pesados/asíncronos corren en `apps/worker`,
compartiendo los mismos paquetes de dominio.

## Alternatives considered
- Microservicios desde el día 1: descartado — sobrecarga operativa injustificada para
  el volumen inicial y para un equipo pequeño.
- Monolito no modular: descartado — dificulta aislar billing/deployment más adelante.

## Consequences
- Un solo pipeline de CI/CD y una sola base de datos al inicio (con `workspace_id`
  como frontera lógica de tenant).
- Extraer un contexto a servicio propio en el futuro implica: mover su carpeta,
  exponer su API vía HTTP/eventos en vez de llamada in-process, sin reescribir domain.
