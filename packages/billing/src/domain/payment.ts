import { Money } from "@sitedock/shared";

export type InvoiceStatus = "OPEN" | "PAID" | "FAILED" | "VOID";
export type PaymentStatus = "PENDING" | "SUCCEEDED" | "FAILED" | "REFUNDED";

/**
 * SUBSCRIPTION invoices belong to a recurring membership; ONE_TIME invoices
 * record project fees charged outside any subscription (creation/deploy).
 */
export type InvoiceKind = "SUBSCRIPTION" | "ONE_TIME";

export interface Invoice {
  id: string;
  kind: InvoiceKind;
  /** Set for SUBSCRIPTION invoices; NULL for ONE_TIME. */
  subscriptionId: string | null;
  /** Set for ONE_TIME invoices tied to a website; NULL for SUBSCRIPTION. */
  websiteId: string | null;
  amount: Money;
  status: InvoiceStatus;
  dueDate: Date;
  paidAt: Date | null;
  createdAt: Date;
}

export interface Payment {
  id: string;
  invoiceId: string;
  amount: Money;
  status: PaymentStatus;
  provider: string;
  externalPaymentId: string | null;
  platformFee: Money;
  /** Fase 16 — ancla de reconciliación con la autoridad externa. */
  externalBalanceTxnId: string | null;
  /** Total devuelto al cliente vía refunds (≤ amount). */
  refundedCents: number;
  createdAt: Date;
}

/**
 * Anti-corruption layer boundary (docs/ARCHITECTURE.md §62). The domain never
 * imports Stripe/MercadoPago SDKs directly — it only sees this port and the
 * normalized events it returns after signature verification.
 */
export interface CheckoutSession {
  id: string;
  url: string;
  status: "OPEN" | "COMPLETE" | "EXPIRED";
}

export type NormalizedProviderEvent =
  | { type: "payment.succeeded"; eventId: string; externalSubscriptionId: string; externalPaymentId: string; amountCents: number; currency: string; externalBalanceTxnId?: string }
  | { type: "payment.failed"; eventId: string; externalSubscriptionId: string; externalPaymentId: string; reason: string }
  | { type: "subscription.canceled"; eventId: string; externalSubscriptionId: string }
  | { type: "charge.succeeded"; eventId: string; externalChargeId: string; externalPaymentId: string; amountCents: number; currency: string; externalBalanceTxnId?: string }
  // Fase 16 — movimientos de dinero reales (autoridad externa):
  | { type: "refund.succeeded"; eventId: string; externalPaymentId: string; externalRefundId: string; amountCents: number; currency: string }
  | { type: "dispute.created"; eventId: string; externalPaymentId: string; externalDisputeId: string; amountCents: number; currency: string; evidenceDueBy?: string }
  | { type: "dispute.closed"; eventId: string; externalDisputeId: string; won: boolean }
  // Eventos del provider no relevantes para el ledger — se ACKean sin mutar nada.
  | { type: "ignored"; eventId: string };

export interface PaymentProvider {
  readonly name: string;

  createCheckoutSession(params: {
    subscriptionId: string;
    amount: Money;
    billingInterval: "MONTHLY" | "YEARLY";
    successUrl: string;
    cancelUrl: string;
  }): Promise<CheckoutSession>;

  /**
   * One-time checkout (creation/initial-deploy fee). The provider echoes
   * `chargeId` back on the charge.succeeded webhook — never trust any
   * frontend confirmation for marking it PAID.
   */
  createOneTimeCheckout(params: {
    chargeId: string;
    description: string;
    amount: Money;
    successUrl: string;
    cancelUrl: string;
  }): Promise<CheckoutSession>;

  /** Verifies the webhook signature and maps the provider's raw payload to a normalized event. Throws if the signature is invalid. */
  verifyAndParseWebhook(rawBody: Buffer, signatureHeader: string): NormalizedProviderEvent;
}
