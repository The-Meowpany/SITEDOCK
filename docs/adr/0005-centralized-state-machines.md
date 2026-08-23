# ADR-005: Máquinas de estado centralizadas para Website/Deployment/Subscription

## Status
Accepted

## Context
Los tres agregados críticos tienen lifecycles con transiciones restringidas (el brief
exige explícitamente no permitir transiciones arbitrarias). Dispersar `if status === X`
por controllers y use cases garantiza inconsistencias y estados imposibles.

## Decision
Una `StateMachine<T>` genérica en `packages/shared` define, por agregado, el mapa de
transiciones válidas. Cada entidad la invoca desde métodos de comportamiento nombrados
(`subscription.activate()`, `website.publish()`, `deployment.fail()`); ninguna capa
externa puede asignar `status` directamente — las entidades exponen getters, no setters,
y las transiciones ilegales lanzan `DomainError` en compile-safe runtime.

Mapas vigentes:

- Website: `DRAFT→PREVIEW→PENDING_APPROVAL→APPROVED→LIVE⇄PAST_DUE→GRACE_PERIOD→SUSPENDED→LIVE | →ARCHIVED→DELETED`
- Deployment: `QUEUED→BUILDING→READY→PUBLISHED | BUILDING→FAILED | QUEUED→CANCELED`
- Subscription: `INCOMPLETE/TRIALING→ACTIVE⇄PAST_DUE→GRACE_PERIOD→SUSPENDED→ACTIVE(cobro recuperado) | ACTIVE/…→CANCELED→EXPIRED`

## Alternatives considered
- Enum + switch en cada use case: descartado — duplica las reglas y no protege invariantes.
- Event sourcing completo para lifecycles: prematuro (ADR-001); los `SubscriptionEvent`s
  ya registran el historial sin reemplazar el estado actual.

## Consequences
- Los tests de dominio ejercitan transiciones legítimas e ilegales sin base de datos.
- Agregar un estado nuevo es tocar un único mapa + su entidad, y el compilador marca los
  switches exhaustivos de consumidores.
