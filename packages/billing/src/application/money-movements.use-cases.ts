import { randomUUID } from "node:crypto";
import { ApplicationError, NotFoundError } from "@sitedock/shared";
import {
  LedgerSidePayment,
  ReconciliationException,
  ReconciliationSource,
  reconcilePayments,
  RefundGateway,
} from "../domain/money-gateways";
import { PaymentRepository, RefundRepository } from "../domain/ports";

/** Tenant-scoped read of the internal side of the reconciliation. */
export interface ReconciliationLedgerPort {
  listWorkspacePaymentsSince(workspaceId: string, since: Date): Promise<LedgerSidePayment[]>;
}

/**
 * Creates a refund (partial by default = full if no amount is passed) ONLY for
 * real Stripe payments with a registered payment_intent. The final state
 * arrives via the refund.succeeded webhook — here it is only initiated.
 */
export class CreateRefundUseCase {
  constructor(
    private readonly payments: PaymentRepository,
    private readonly gateway: RefundGateway,
    private readonly refunds?: RefundRepository
  ) {}

  async execute(params: {
    paymentId: string;
    amountDecimal?: string;
    reason?: string;
    actorId: string;
  }): Promise<{ refundId: string; status: "PENDING" | "SUCCEEDED" }> {
    const payment = await this.payments.findById(params.paymentId);
    if (!payment) throw new NotFoundError("Payment", params.paymentId);
    if (!payment.externalPaymentId) {
      throw new ApplicationError(
        "This payment has no provider reference to refund against",
        "PAYMENT_NOT_REFUNDABLE"
      );
    }
    if (payment.status !== "SUCCEEDED") {
      throw new ApplicationError(`Cannot refund a ${payment.status} payment`, "PAYMENT_NOT_REFUNDABLE");
    }

    const remainingCents = payment.amount.amountCents - payment.refundedCents;
    if (remainingCents <= 0) {
      throw new ApplicationError("This payment is already fully refunded", "ALREADY_REFUNDED");
    }

    let amountCents: number | undefined;
    if (params.amountDecimal !== undefined) {
      if (!/^\d+(\.\d{1,2})?$/.test(params.amountDecimal)) {
        throw new ApplicationError(`Invalid refund amount: "${params.amountDecimal}"`, "INVALID_REFUND_AMOUNT");
      }
      const [whole, fraction = "0"] = params.amountDecimal.split(".");
      amountCents = Number(whole) * 100 + Number(fraction.padEnd(2, "0").slice(0, 2));
      if (amountCents > remainingCents) {
        throw new ApplicationError(
          `Refund ${amountCents} exceeds remaining ${remainingCents}`,
          "REFUND_EXCEEDS_REMAINING"
        );
      }
    }

    // Real gateway → Stripe creates the refund NOW (money in motion).
    const result = await this.gateway.createRefund({
      externalPaymentId: payment.externalPaymentId,
      amountCents,
      currency: payment.amount.currency,
    });

    // Anti-duplicate guard by the provider's external reference.
    const existing = this.refunds ? await this.refunds.findByExternalRefundId(result.externalRefundId) : null;
    if (existing) return { refundId: existing.id, status: existing.status === "FAILED" ? ("PENDING" as const) : existing.status };

    const record = {
      id: randomUUID(),
      paymentId: payment.id,
      amountCents: amountCents ?? remainingCents,
      currency: payment.amount.currency,
      reason: params.reason ?? null,
      status: result.status,
      externalRefundId: result.externalRefundId,
      createdAt: new Date(),
    };
    await this.refunds?.save(record);

    return { refundId: record.id, status: record.status as "PENDING" | "SUCCEEDED" };
  }
}

export interface ReconciliationReport {
  since: string;
  ledgerCount: number;
  stripeCount: number;
  exceptions: ReconciliationException[];
}

/**
 * Phase 16 §4 — the central piece: proves
 *   Stripe balance transaction ↔ internal charge ↔ ledger ↔ merchant balance.
 *
 * It does not "fix" anything: it produces explicit EXCEPTIONS for investigation. The
 * caller (admin route / scheduled job) decides whether to audit and alert on them.
 */
export class ReconcileStripePaymentsUseCase {
  constructor(
    private readonly payments: PaymentRepository,
    private readonly source: ReconciliationSource,
    private readonly ledger: ReconciliationLedgerPort
  ) {}

  async execute(params: { workspaceId: string; days?: number }): Promise<ReconciliationReport> {
    const days = params.days ?? 30;
    const since = new Date();
    since.setDate(since.getDate() - days);

    const stripeEntries = await this.source.listBalanceTransactions(since);

    // Ledger side: SUCCEEDED/REFUNDED payments of the workspace within the window,
    // read through the tenant-scoped port (Prisma: invoice→subscription→website).
    const ledgerPayments = await this.ledger.listWorkspacePaymentsSince(params.workspaceId, since);
    const exceptions = reconcilePayments(ledgerPayments, stripeEntries);

    return {
      since: since.toISOString(),
      ledgerCount: ledgerPayments.length,
      stripeCount: stripeEntries.length,
      exceptions,
    };
  }
}






