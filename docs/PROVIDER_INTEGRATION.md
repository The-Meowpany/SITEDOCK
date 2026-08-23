# Provider Integration

Arquitectura de integración con proveedores externos mediante ports/adapters.

## Patrón

```
Domain (ports.ts)  ←  Application (use cases)  ←  Infrastructure (adapters)
```

Cada provider implementa el MISMO port que su contraparte mock. Cambiar de
provider solo requiere cambiar la fábrica en infraestructura — el dominio y
los use cases no se modifican.

## Stripe Connect

| Aspecto | Detalle |
|---------|---------|
| Port | `PaymentProvider` + `ConnectedAccountGateway` + `RefundGateway` |
| Mock | `MockPaymentProvider` (default, sin credenciales) |
| Real | `StripePaymentProvider` + `StripeRefundGateway` (requiere credenciales) |
| Activación | `PAYMENT_PROVIDER=stripe` + `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` |
| Webhooks | POST `/api/v1/webhooks/payments/stripe` (firma `stripe-signature`) |
| Idempotencia | Header `Idempotency-Key: checkout:{subscriptionId\|chargeId}` |
| Validación | Monto y moneda validados contra precio capturado antes de mutar |

### Eventos manejados

| Evento Stripe | Efecto en SiteDock |
|--------------|-------------------|
| checkout.session.completed (subscription) | Suscripción → ACTIVE + Invoice PAID + Payment SUCCEEDED |
| checkout.session.completed (payment) | Charge → PAID + Invoice ONE_TIME PAID |
| invoice.payment_failed | Suscripción → PAST_DUE + Invoice FAILED + Payment FAILED |
| customer.subscription.deleted | Suscripción → CANCELED |
| charge.refunded | Payment.refundedCents acumulado; total → REFUNDED |
| charge.dispute.created | Dispute OPEN con deadline |
| charge.dispute.closed | Dispute WON/LOST |

## S3 Storage

| Aspecto | Detalle |
|---------|---------|
| Port | `StorageProvider` |
| Mock | `MockStorageProvider` (in-memory, default) |
| Real | `S3StorageProvider` (SigV4 propio, fetch inyectado) |
| Activación | `STORAGE_PROVIDER=s3` + `S3_BUCKET/S3_REGION/S3_ACCESS_KEY_ID/S3_SECRET_ACCESS_KEY` |
| Namespace | `websites/{websiteId}/deployments/{deploymentId}/...` y `websites/{websiteId}/backups/{backupId}/...` |
| Sanitización | Path traversal (`..`, `//`, `/` inicial) bloqueado en put/get/delete/exists |

## Resend Email

| Aspecto | Detalle |
|---------|---------|
| Port | `EmailProvider` |
| Mock | `MockEmailProvider` (log-only, default) |
| Real | `ResendEmailProvider` (POST https://api.resend.com/emails) |
| Activación | `EMAIL_PROVIDER=resend` + `RESEND_API_KEY` + `RESEND_FROM` |
| Errores | Mapeados a InfrastructureError — nunca afectan operaciones de negocio |
