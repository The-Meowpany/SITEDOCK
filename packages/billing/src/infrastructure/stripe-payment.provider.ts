import { randomUUID } from "node:crypto";
import { Money } from "@sitedock/shared";
import { CheckoutSession, NormalizedProviderEvent, PaymentProvider } from "../domain/payment";
import { StripeHttpClient } from "./stripe-http.client";
import { verifyStripeSignature } from "./stripe-signature";

export interface StripePaymentProviderConfig {
  secretKey: string;
  /** Webhook endpoint's whsec — Stripe's economic authority. */
  webhookSecret: string;
  apiBase?: string;
  fetchImpl?: typeof fetch;
}

interface StripeCheckoutSession {
  id: string;
  url: string | null;
  mode: "payment" | "subscription";
  payment_intent?: string | null;
  subscription?: string | null;
}

interface StripeEventEnvelope {
  id: string;
  type: string;
  data: { object: Record<string, unknown> & {
    id?: string;
    mode?: string;
    amount_total?: number;
    amount_refunded?: number;
    amount?: number;
    currency?: string;
    payment_intent?: string | null;
    subscription?: string | null;
    status?: string;
    client_reference_id?: string | null;
    metadata?: Record<string, string>;
    refunds?: { data?: Array<{ id: string; amount: number; currency: string }> };
    evidence_details?: { due_by?: number | null } | null;
  } };
}

/**
 * REAL Stripe adapter (Phase 16 / ADR-006) that implements the SAME
 * `PaymentProvider` port as the mock — the verify→claim→process pipeline does not change,
 * only the origin of the money.
 *
 * Rules followed:
 * - Metadata carries our ids (subscription_id / charge_id): the final economic
 *   state is declared by the confirmed EVENT, never by the frontend.
 * - The signature is verified with Stripe's real scheme (t + v1 HMAC-SHA256).
 * - Money is always in whole cents.
 */
export class StripePaymentProvider implements PaymentProvider {
  readonly name = "stripe";
  private readonly http: StripeHttpClient;
  private readonly webhookSecret: string;

  constructor(config: StripePaymentProviderConfig) {
    this.http = new StripeHttpClient({
      secretKey: config.secretKey,
      apiBase: config.apiBase,
      fetchImpl: config.fetchImpl,
    });
    this.webhookSecret = config.webhookSecret;
  }

  async createCheckoutSession(params: {
    subscriptionId: string;
    amount: Money;
    billingInterval: "MONTHLY" | "YEARLY";
    successUrl: string;
    cancelUrl: string;
  }): Promise<CheckoutSession> {
    const session = await this.http.post<StripeCheckoutSession>(
      "/checkout/sessions",
      {
        mode: "subscription",
        success_url: params.successUrl,
        cancel_url: params.cancelUrl,
        client_reference_id: params.subscriptionId,
        metadata: { subscription_id: params.subscriptionId },
        subscription_data: { metadata: { subscription_id: params.subscriptionId } },
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: params.amount.currency,
              unit_amount: params.amount.amountCents,
              recurring: { interval: params.billingInterval === "MONTHLY" ? "month" : "year" },
            },
          },
        ],
      },
      // End-to-end idempotency (Phase 19 §7): retrying the creation after a
      // lost response yields THE SAME session, never a second charge.
      { idempotencyKey: `checkout:subscription:${params.subscriptionId}` }
    );
    return { id: session.id, url: session.url ?? "", status: "OPEN" };
  }

  async createOneTimeCheckout(params: {
    chargeId: string;
    description: string;
    amount: Money;
    successUrl: string;
    cancelUrl: string;
  }): Promise<CheckoutSession> {
    const session = await this.http.post<StripeCheckoutSession>(
      "/checkout/sessions",
      {
        mode: "payment",
        success_url: params.successUrl,
        cancel_url: params.cancelUrl,
        client_reference_id: params.chargeId,
        metadata: { charge_id: params.chargeId },
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: params.amount.currency,
              unit_amount: params.amount.amountCents,
              product_data: { name: params.description },
            },
          },
        ],
      },
      { idempotencyKey: `checkout:charge:${params.chargeId}` }
    );
    return { id: session.id, url: session.url ?? "", status: "OPEN" };
  }

  verifyAndParseWebhook(rawBody: Buffer, signatureHeader: string): NormalizedProviderEvent {
    const verification = verifyStripeSignature(rawBody, signatureHeader, this.webhookSecret);
    if (!verification.valid) {
      throw new Error(`Invalid webhook signature (${verification.reason})`);
    }

    const envelope = JSON.parse(rawBody.toString("utf8")) as StripeEventEnvelope;
    const obj = envelope.data?.object ?? {};
    const eventId = envelope.id || `evt_${randomUUID()}`;
    const currency = String(obj.currency ?? "").toUpperCase();

    switch (envelope.type) {
      case "checkout.session.completed": {
        if (obj.mode === "payment") {
          // One-time charge — the charge_id traveled in metadata when the session was created.
          const externalChargeId = obj.metadata?.charge_id ?? obj.client_reference_id ?? "";
          if (!externalChargeId) throw new Error("checkout.session.completed without charge_id metadata");
          return {
            type: "charge.succeeded",
            eventId,
            externalChargeId,
            externalPaymentId: String(obj.payment_intent ?? ""),
            amountCents: Number(obj.amount_total ?? 0),
            currency,
          };
        }
        const externalSubscriptionId =
          obj.metadata?.subscription_id ??
          obj.client_reference_id ??
          (() => {
            throw new Error("checkout.session.completed without subscription_id metadata");
          })();
        return {
          type: "payment.succeeded",
          eventId,
          externalSubscriptionId,
          externalPaymentId: String(obj.payment_intent ?? ""),
          amountCents: Number(obj.amount_total ?? 0),
          currency,
        };
      }

      case "invoice.payment_failed":
        return {
          type: "payment.failed",
          eventId,
          externalSubscriptionId: String(obj.subscription ?? ""),
          externalPaymentId: String(obj.payment_intent ?? ""),
          reason: "invoice_payment_failed",
        };

      case "customer.subscription.deleted":
        return {
          type: "subscription.canceled",
          eventId,
          externalSubscriptionId: String(obj.id ?? ""),
        };

      case "charge.refunded": {
        const refunds = obj.refunds?.data ?? [];
        const latest = refunds.at(-1);
        if (!latest) throw new Error("charge.refunded without refund entries");
        return {
          type: "refund.succeeded",
          eventId,
          externalPaymentId: String(obj.payment_intent ?? ""),
          externalRefundId: latest.id,
          amountCents: Number(latest.amount),
          currency: String(latest.currency).toUpperCase(),
        };
      }

      case "charge.dispute.created":
        return {
          type: "dispute.created",
          eventId,
          externalPaymentId: String(obj.payment_intent ?? ""),
          externalDisputeId: String(obj.id ?? ""),
          amountCents: Number(obj.amount ?? 0),
          currency,
          evidenceDueBy:
            typeof obj.evidence_details?.due_by === "number"
              ? new Date((obj.evidence_details.due_by as number) * 1000).toISOString()
              : undefined,
        };

      case "charge.dispute.closed":
        return {
          type: "dispute.closed",
          eventId,
          externalDisputeId: String(obj.id ?? ""),
          won: obj.status === "won",
        };

      default:
        // Stripe events not relevant to the ledger (ping, customer.updated,
        // payout.created...) are ACKed as a no-op: the pipeline marks them PROCESSED
        // without mutating anything.
        return { type: "ignored", eventId };
    }
  }
}


