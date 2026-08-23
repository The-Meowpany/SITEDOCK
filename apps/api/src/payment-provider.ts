import { MockPaymentProvider } from "@sitedock/billing";

/**
 * Process-wide PaymentProvider singleton (ADR-003). A real deployment swaps
 * this for StripePaymentProvider/MercadoPagoPaymentProvider built from
 * env-configured credentials — every consumer imports this module instead of
 * instantiating providers directly.
 */
export const paymentProvider = new MockPaymentProvider();
