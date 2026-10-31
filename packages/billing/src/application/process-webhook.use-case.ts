import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";
import { ApplicationError, Money } from "@sitedock/shared";
import { Invoice, NormalizedProviderEvent, Payment } from "../domain/payment";
import { PlatformFeePolicy } from "../domain/revenue-share";
import {
  DisputeRepository,
  InvoiceRepository,
  PaymentRepository,
  ProjectChargeRepository,
  RefundRepository,
  SubscriptionRepository,
  WebhookEventStore,
} from "../domain/ports";

export interface ProcessedWebhookResult {
  duplicate: boolean;
  websiteId?: string;
  subscriptionStatus?: string;
  subscriptionKind?: string;
}

/**
 * Single entry point for payment-provider webhooks after signature
 * verification (docs/ARCHITECTURE.md §16/§17/§76 — webhook architecture).
 * Handles BOTH commercial lines AND the real-money movements of Phase 16:
 *   - subscription events (payment.succeeded/failed, subscription.canceled)
 *   - one-time charges (charge.succeeded — the creation/deploy fee)
 *   - refund.succeeded / dispute.created / dispute.closed
 *   - ignored (provider events irrelevant to the ledger — ACKed cleanly)
 *
 * Correctness model:
 * 1. CLAIM the event first (atomic INSERT against a unique constraint) —
 *    concurrent or retried deliveries collapse into one `duplicate: true`.
 * 2. Mutate the target AND persist the financial records that dashboards and
 *    admin reporting read from.
 * 3. Mark the ledger entry PROCESSED. If anything throws, RELEASE the claim so
 *    the provider's retry is handled cleanly instead of being swallowed.
 */
export class ProcessPaymentWebhookUseCase {
  constructor(
    private readonly subscriptions: SubscriptionRepository,
    private readonly webhookEvents: WebhookEventStore,
    private readonly invoices: InvoiceRepository,
    private readonly payments: PaymentRepository,
    private readonly feePolicy: PlatformFeePolicy,
    private readonly charges?: ProjectChargeRepository,
    private readonly refunds?: RefundRepository,
    private readonly disputes?: DisputeRepository
  ) {}

  async execute(provider: string, event: NormalizedProviderEvent, rawPayload: Buffer): Promise<ProcessedWebhookResult> {
    const payloadHash = createHash("sha256").update(rawPayload).digest("hex");
    const claimed = await this.webhookEvents.claimEvent(provider, event.eventId, event.type, payloadHash);
    if (!claimed) {
      return { duplicate: true };
    }

    try {
      // Provider noise (pings, customer/payout updates): ACK without mutating.
      if (event.type === "ignored") {
        await this.webhookEvents.recordProcessed(provider, event.eventId, event.type, payloadHash);
        return { duplicate: false };
      }

      if (event.type === "charge.succeeded") return await this.handleChargeSucceeded(provider, event);
      if (event.type === "refund.succeeded") return await this.handleRefundSucceeded(provider, event);
      if (event.type === "dispute.created") return await this.handleDisputeCreated(provider, event);
      if (event.type === "dispute.closed") return await this.handleDisputeClosed(event);

      const subscription = await this.subscriptions.findByExternalId(provider, event.externalSubscriptionId);
      if (!subscription) {
        throw new ApplicationError(
          `No subscription found for ${provider} external id ${event.externalSubscriptionId}`,
          "SUBSCRIPTION_NOT_FOUND_FOR_WEBHOOK"
        );


      }

      switch (event.type) {
        case "payment.succeeded": {
          // Phase 19 §3 — economic validation: the confirmed event must match
          // the price captured at subscription time. A divergence indicates plan
          // desync or tampering → explicit exception, never a silent mutation.
          if (
            event.amountCents !== subscription.price.amountCents ||
            event.currency !== subscription.price.currency
          ) {
            throw new ApplicationError(
              `Payment amount mismatch for subscription ${subscription.id}: expected ${subscription.price.toDecimalString()} ${subscription.price.currency}, got ${event.amountCents} ${event.currency}`,
              "SUBSCRIPTION_AMOUNT_MISMATCH"
            );
          }

          if (subscription.status === "ACTIVE") subscription.renew();
          else subscription.activate();

          const amount = Money.fromCents(event.amountCents, event.currency);
          const split = this.feePolicy.computeSplit(amount);

          const invoice: Invoice = {
            id: randomUUID(),
            kind: "SUBSCRIPTION",
            subscriptionId: subscription.id,
            websiteId: null,
            amount,
            status: "PAID",
            dueDate: new Date(),
            paidAt: new Date(),
            createdAt: new Date(),
          };
          const payment: Payment = {
            id: randomUUID(),
            invoiceId: invoice.id,
            amount,
            status: "SUCCEEDED",
            provider,
            externalPaymentId: event.externalPaymentId,
            platformFee: split.platformFee,
            externalBalanceTxnId: event.type === "payment.succeeded" ? (event.externalBalanceTxnId ?? null) : null,
            refundedCents: 0,
            createdAt: new Date(),
          };

          await this.subscriptions.save(subscription);
          await this.invoices.save(invoice);
          await this.payments.save(payment);
          break;
        }

        case "payment.failed": {
          subscription.markPastDue();

          // Financial records document the FAILED attempt too — failed-payment
          // metrics and the admin console read from these rows.
          const invoice: Invoice = {
            id: randomUUID(),
            kind: "SUBSCRIPTION",
            subscriptionId: subscription.id,
            websiteId: null,
            amount: subscription.price,
            status: "FAILED",
            dueDate: new Date(),
            paidAt: null,
            createdAt: new Date(),
          };
          const payment: Payment = {
            id: randomUUID(),
            invoiceId: invoice.id,
            amount: subscription.price,
            status: "FAILED",
            provider,
            externalPaymentId: event.externalPaymentId,
            platformFee: Money.fromCents(0, subscription.price.currency),
            externalBalanceTxnId: null,
            refundedCents: 0,
            createdAt: new Date(),
          };

          await this.subscriptions.save(subscription);
          await this.invoices.save(invoice);
          await this.payments.save(payment);
          break;
        }

        case "subscription.canceled":
          subscription.cancel();
          await this.subscriptions.save(subscription);
          break;
      }

      await this.webhookEvents.recordProcessed(provider, event.eventId, event.type, payloadHash);

      return { duplicate: false, websiteId: subscription.websiteId, subscriptionStatus: subscription.status, subscriptionKind: subscription.kind };
    } catch (err) {
      // Release the claim so the provider's retry isn't treated as a duplicate.
      await this.webhookEvents.releaseEvent(provider, event.eventId).catch(() => {});
      throw err;
    }
  }

  /**
   * One-time charge completion: marks the charge PAID (the ONLY path to that
   * state — verified webhook, never frontend) and records Invoice + Payment so
   * revenue reporting includes project fees, not just subscriptions.
   */
  private async handleChargeSucceeded(
    provider: string,
    event: Extract<NormalizedProviderEvent, { type: "charge.succeeded" }>
  ): Promise<ProcessedWebhookResult> {
    if (!this.charges) {
      throw new ApplicationError("One-time charges are not configured on this deployment", "CHARGES_NOT_SUPPORTED");
    }

    // The provider echoes back the chargeId we handed it at checkout time
    // (client_reference_id/metadata in Stripe terms).
    const charge = await this.charges.findById(event.externalChargeId);
    if (!charge || charge.provider !== provider) {
      throw new ApplicationError(
        `No charge found for ${provider} external charge ${event.externalChargeId}`,
        "CHARGE_NOT_FOUND_FOR_WEBHOOK"
      );
    }

    // Amount guard: a provider event that disagrees with our recorded amount is
    // a tampering/misconfiguration signal — fail loudly instead of marking paid.
    if (charge.amount.amountCents !== event.amountCents || charge.amount.currency !== event.currency) {
      throw new ApplicationError(
        `Charge amount mismatch for ${charge.id}: expected ${charge.amount.toDecimalString()} ${charge.amount.currency}, got ${event.amountCents} ${event.currency}`,
        "CHARGE_AMOUNT_MISMATCH"
      );
    }

    const wasAlreadyPaid = charge.status === "PAID";
    if (!wasAlreadyPaid) charge.markPaidFromWebhook();

    const invoice: Invoice = {
      id: randomUUID(),
      kind: "ONE_TIME",
      subscriptionId: null,
      websiteId: charge.websiteId,
      amount: charge.amount,
      status: "PAID",
      dueDate: new Date(),
      paidAt: new Date(),
      createdAt: new Date(),
    };
    const split = this.feePolicy.computeSplit(charge.amount);
    const payment: Payment = {
      id: randomUUID(),
      invoiceId: invoice.id,
      amount: charge.amount,
      status: "SUCCEEDED",
      provider,
      externalPaymentId: event.externalPaymentId,
      platformFee: split.platformFee,
      externalBalanceTxnId: null,
      refundedCents: 0,
      createdAt: new Date(),
    };

    await this.charges.save(charge);
    await this.invoices.save(invoice);
    await this.payments.save(payment);

    return { duplicate: false, websiteId: charge.websiteId };
  }

  /**
   * Refund confirmed by the external authority. Idempotent by
   * externalRefundId (unique constraint) in addition to the event claim. The payment
   * accumulates refundedCents and becomes REFUNDED only when the total is covered —
   * a partial refund does NOT change the payment status.
   */
  private async handleRefundSucceeded(
    provider: string,
    event: Extract<NormalizedProviderEvent, { type: "refund.succeeded" }>
  ): Promise<ProcessedWebhookResult> {
    if (!this.refunds) {
      throw new ApplicationError("Refunds are not configured on this deployment", "REFUNDS_NOT_SUPPORTED");
    }

    const existing = await this.refunds.findByExternalRefundId(event.externalRefundId);
    if (existing?.status === "SUCCEEDED") return { duplicate: false };

    const payment = await this.payments.findByExternalPaymentId(provider, event.externalPaymentId);
    if (!payment || payment.provider !== provider) {
      throw new ApplicationError(
        `No payment found for ${provider} external id ${event.externalPaymentId}`,
        "PAYMENT_NOT_FOUND_FOR_WEBHOOK"
      );
    }
    if (event.amountCents > payment.amount.amountCents) {
      throw new ApplicationError(
        `Refund amount ${event.amountCents} exceeds payment total ${payment.amount.amountCents}`,
        "REFUND_EXCEEDS_PAYMENT"
      );
    }

    const refundedCents = Math.min(payment.amount.amountCents, payment.refundedCents + event.amountCents);

    await this.refunds.save({
      id: existing?.id ?? randomUUID(),
      paymentId: payment.id,
      amountCents: event.amountCents,
      currency: event.currency,
      reason: null,
      status: "SUCCEEDED",
      externalRefundId: event.externalRefundId,
      createdAt: existing?.createdAt ?? new Date(),
    });

    await this.payments.save({
      ...payment,
      status: refundedCents >= payment.amount.amountCents ? "REFUNDED" : "SUCCEEDED",
      refundedCents,
    });

    return { duplicate: false };
  }

  /** Dispute opened: append-only record with an evidence deadline. */
  private async handleDisputeCreated(
    provider: string,
    event: Extract<NormalizedProviderEvent, { type: "dispute.created" }>
  ): Promise<ProcessedWebhookResult> {
    if (!this.disputes) {
      throw new ApplicationError("Disputes are not configured on this deployment", "DISPUTES_NOT_SUPPORTED");
    }

    const existing = await this.disputes.findByExternalDisputeId(event.externalDisputeId);
    if (existing) return { duplicate: false };

    const payment = await this.payments.findByExternalPaymentId(provider, event.externalPaymentId);
    if (!payment || payment.provider !== provider) {
      throw new ApplicationError(
        `No payment found for ${provider} external id ${event.externalPaymentId}`,
        "PAYMENT_NOT_FOUND_FOR_WEBHOOK"
      );
    }

    await this.disputes.save({
      id: randomUUID(),
      paymentId: payment.id,
      externalDisputeId: event.externalDisputeId,
      amountCents: event.amountCents,
      currency: event.currency,
      status: "OPEN",
      evidenceDueBy: event.evidenceDueBy ?? null,
      createdAt: new Date(),
      closedAt: null,
    });
    return { duplicate: false };
  }

  /** Dispute closed: WON/LOST with closedAt — a previous dispute is never edited. */
  private async handleDisputeClosed(
    event: Extract<NormalizedProviderEvent, { type: "dispute.closed" }>
  ): Promise<ProcessedWebhookResult> {
    if (!this.disputes) {
      throw new ApplicationError("Disputes are not configured on this deployment", "DISPUTES_NOT_SUPPORTED");
    }

    const dispute = await this.disputes.findByExternalDisputeId(event.externalDisputeId);
    if (!dispute) {
      throw new ApplicationError(
        `No dispute found for external id ${event.externalDisputeId}`,
        "DISPUTE_NOT_FOUND_FOR_WEBHOOK"
      );
    }

    await this.disputes.save({
      ...dispute,
      status: event.won ? "WON" : "LOST",
      closedAt: new Date(),
    });
    return { duplicate: false };
  }
}


