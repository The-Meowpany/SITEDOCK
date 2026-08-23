# ADR-003: Provider abstractions para servicios externos

## Status
Accepted

## Context
La plataforma depende de proveedores externos (pagos, storage, dominios, email) que van
a cambiar: se arranca con mocks sin credenciales y luego Stripe/S3/Resend u otros. El
dominio no debe acoplarse a ningún SDK de terceros (docs/ARCHITECTURE.md §61).

## Decision
Cada servicio externo queda detrás de un port (`domain/ports.ts`) con una sola
implementación activa por entorno:

- `PaymentProvider`: `MockPaymentProvider` hoy (checkout firmado + webhooks simulados),
  `StripePaymentProvider` / `MercadoPagoPaymentProvider` después.
- `StorageProvider`: `MockStorageProvider` hoy, S3-compatible después.
- `DomainProvider`, `EmailProvider`: mismo patrón.

Los webhooks de pago pasan SIEMPRE por verify→idempotencia→comando, nunca por la
respuesta del frontend (docs/ARCHITECTURE.md §17).

## Alternatives considered
- Acoplarse directo a Stripe: descartado — el mercado hispano exige MercadoPago y el
  brief exige poder cambiar de proveedor sin reescribir billing.
- Una capa genérica "integrations": descartada — cada port tiene la forma exacta que su
  caso de uso necesita, no un SDK wrapper genérico.

## Consequences
- Los tests unitarios usan fakes que implementan los mismos ports (contract tests
  pendientes cuando exista más de una implementación real por port).
- Los mocks no son atajos: `MockPaymentProvider` firma payloads y recorre el mismo
  camino de verificación/idempotencia que un provider real.
