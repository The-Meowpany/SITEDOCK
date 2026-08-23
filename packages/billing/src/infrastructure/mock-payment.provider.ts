import { randomUUID, createHmac, timingSafeEqual } from "node:crypto";
import { Money } from "@sitedock/shared";
import { CheckoutSession, NormalizedProviderEvent, PaymentProvider } from "../domain/payment";

/**
 * Demo/mock payment provider (docs/ARCHITECTURE.md §45 "Demo Mode"). Simulates
 * a real provider's checkout + webhook flow without any external credentials —
 * signs its own webhook payloads with a shared secret so the same signature
 * verification code path runs as it would with Stripe/MercadoPago.
 */
export class MockPaymentProvider implements PaymentProvider {
  readonly name = "mock";
  private readonly webhookSecret = "demo_webhook_secret";
  private sessions = new Map<string, { subscriptionId: string; amountCents: number; currency: string }>();
  private oneTimeSessions = new Map<string, { chargeId: string; amountCents: number; currency: string }>();

  async createCheckoutSession(params: {
    subscriptionId: string;
    amount: Money;
    billingInterval: "MONTHLY" | "YEARLY";
    successUrl: string;
    cancelUrl: string;
  }): Promise<CheckoutSession> {
    const sessionId = `demo_cs_${randomUUID()}`;
    this.sessions.set(sessionId, {
      subscriptionId: params.subscriptionId,
      amountCents: params.amount.amountCents,
      currency: params.amount.currency,
    });
    return { id: sessionId, url: `https://pay.sitedock.demo/checkout/${sessionId}`, status: "OPEN" };
  }

  async createOneTimeCheckout(params: {
    chargeId: string;
    description: string;
    amount: Money;
    successUrl: string;
    cancelUrl: string;
  }): Promise<CheckoutSession> {
    const sessionId = `demo_otc_${randomUUID()}`;
    this.oneTimeSessions.set(sessionId, {
      chargeId: params.chargeId,
      amountCents: params.amount.amountCents,
      currency: params.amount.currency,
    });
    return { id: sessionId, url: `https://pay.sitedock.demo/checkout/${sessionId}`, status: "OPEN" };
  }

  verifyAndParseWebhook(rawBody: Buffer, signatureHeader: string): NormalizedProviderEvent {
    const expected = createHmac("sha256", this.webhookSecret).update(rawBody).digest("hex");
    const provided = Buffer.from(signatureHeader || "", "hex");
    const expectedBuf = Buffer.from(expected, "hex");

    if (provided.length !== expectedBuf.length || !timingSafeEqual(provided, expectedBuf)) {
      throw new Error("Invalid webhook signature");
    }

    return JSON.parse(rawBody.toString("utf-8")) as NormalizedProviderEvent;
  }

  /** Test/demo helper only — signs a payload the same way a real provider would. */
  signPayload(payload: NormalizedProviderEvent): { rawBody: Buffer; signature: string } {
    const rawBody = Buffer.from(JSON.stringify(payload), "utf-8");
    const signature = createHmac("sha256", this.webhookSecret).update(rawBody).digest("hex");
    return { rawBody, signature };
  }

  /** Test/demo helper only — simulates a successful demo checkout completing. */
  simulateSuccessfulPayment(sessionId: string): { rawBody: Buffer; signature: string } {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Unknown demo checkout session: ${sessionId}`);
    return this.signPayload({
      type: "payment.succeeded",
      eventId: `evt_${randomUUID()}`,
      externalSubscriptionId: sessionId,
      externalPaymentId: `demo_pay_${randomUUID()}`,
      amountCents: session.amountCents,
      currency: session.currency,
    });
  }

  simulateFailedPayment(sessionId: string): { rawBody: Buffer; signature: string } {
    return this.signPayload({
      type: "payment.failed",
      eventId: `evt_${randomUUID()}`,
      externalSubscriptionId: sessionId,
      externalPaymentId: `demo_pay_${randomUUID()}`,
      reason: "insufficient_funds",
    });
  }

  /** Test/demo helper only — simulates a one-time charge completing successfully. */
  simulateSuccessfulCharge(sessionId: string): { rawBody: Buffer; signature: string } {
    const session = this.oneTimeSessions.get(sessionId);
    if (!session) throw new Error(`Unknown demo one-time checkout session: ${sessionId}`);
    return this.signPayload({
      type: "charge.succeeded",
      eventId: `evt_${randomUUID()}`,
      externalChargeId: session.chargeId,
      externalPaymentId: `demo_pay_${randomUUID()}`,
      amountCents: session.amountCents,
      currency: session.currency,
    });
  }

  /**
   * Introspection for the PUBLIC demo checkout page: what is this session, how
   * much, and which business object it settles (subscription id or charge id).
   * Demo-only — a real provider hosts its own checkout UI.
   */
  describeSession(
    sessionId: string
  ): { kind: "SUBSCRIPTION" | "ONE_TIME"; amountCents: number; currency: string; referenceId: string } | null {
    const sub = this.sessions.get(sessionId);
    if (sub) {
      return { kind: "SUBSCRIPTION", amountCents: sub.amountCents, currency: sub.currency, referenceId: sub.subscriptionId };
    }
    const otc = this.oneTimeSessions.get(sessionId);
    if (otc) {
      return { kind: "ONE_TIME", amountCents: otc.amountCents, currency: otc.currency, referenceId: otc.chargeId };
    }
    return null;
  }
}
