# ADR-006: Stripe Connect como autoridad de dinero real

## Status
Accepted (implementación sandbox-first; live mode requiere la suite de escenarios §8 del brief)

## Context
Hasta Fase 15 todo el circuito económico era demo (`MockPaymentProvider`). El producto
necesita demostrar que puede mover dinero real sin romper sus invariantes: merchant
real → checkout → webhook verificado → ledger → portal — y reconciliar cada centavo.

## Decision
1. **El pipeline NO cambia.** `verify → claim → process → ledger` es único y compartido
   por todas las superficies. Solo cambia el adapter de entrada:
   `PAYMENT_PROVIDER=mock|stripe` selecciona entre `MockPaymentProvider` y
   `StripePaymentProvider`, ambos implementando el mismo port `PaymentProvider`.

2. **Stripe Connect Express** para merchants: KYC/KYB 100% delegado a Stripe
   (hosted onboarding). `ConnectedAccount` persiste `externalAccountId`,
   estado (`PENDING_ONBOARDING→ACTIVE→RESTRICTED/DISCONNECTED`) y capabilities.
   SiteDock jamás toca documentos ni fondos del merchant.

3. **Metadata como puente de ids**: al crear checkouts viajamos
   `subscription_id`/`charge_id` en metadata; los eventos confirmados vuelven con
   esos ids y así resolvemos contra NUESTRO ledger sin tablas de mapping frágiles.

4. **Webhooks = única autoridad económica**: firma verificada con el esquema real
   (`t` + `v1` HMAC-SHA256 + tolerancia temporal, implementado localmente y testeado
   offline), claim-first idempotente, release-on-failure, eventos irrelevantes ACKeados
   como no-op (`ignored`).

5. **Refunds/disputes**: ciclo completo dirigido por webhooks
   (`charge.refunded`, `charge.dispute.created/closed`). Un refund parcial acumula
   `refundedCents` sin cambiar el status; total → `REFUNDED`. Disputes son append-only
   con estados terminales WON/LOST.

6. **Reconciliación explícita**: `reconcilePayments()` compara ledger ↔ balance
   transactions y produce EXCEPCIONES tipadas (`MISSING_BALANCE_TRANSACTION`,
   `AMOUNT_MISMATCH`, `UNKNOWN_BALANCE_TRANSACTION`). Jamás corrige saldos en silencio.

7. **Cero dependencia del SDK oficial** en esta fase: cliente REST tipado propio sobre
   `fetch` inyectable — testeable offline, swap a SDK documentado si la superficie crece.

## Alternatives considered
- SDK oficial `stripe`: diferido — superficie chica hoy; el wrapper evita ~3MB y mantiene
  todo fake-testeable.
- Reemplazar el pipeline por "integración Stripe directa": rechazado — rompería la regla
  de oro del proyecto (pipeline único compartido) y mataría el modo demo.

## Consequences
- Live mode requiere: configurar endpoint+secret reales, correr la suite de escenarios
  adversos del brief §8 (ya cubiertos en tests offline: duplicados, replay, mismatch,
  refund parcial, dispute won/lost) y habilitar monitoreo de excepciones de
  reconciliación en el panel admin.
- El modo demo sigue siendo first-class: mismo código, otro adapter.
