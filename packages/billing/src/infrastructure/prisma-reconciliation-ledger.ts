import { prisma } from "@sitedock/database";
import { LedgerSidePayment } from "../domain/money-gateways";
import { ReconciliationLedgerPort } from "../application/money-movements.use-cases";

/**
 * LEDGER side of the reconciliation (Phase 16 §4): real payments of a workspace,
 * resolved through the Payment → Invoice → Subscription → Website chain, which is
 * where the tenant boundary lives.
 */
export class PrismaReconciliationLedger implements ReconciliationLedgerPort {
  async listWorkspacePaymentsSince(workspaceId: string, since: Date): Promise<LedgerSidePayment[]> {
    const rows = await prisma.payment.findMany({
      where: {
        status: { in: ["SUCCEEDED", "REFUNDED"] },
        createdAt: { gte: since },
        invoice: { subscription: { website: { workspaceId } } },
      },
      select: {
        externalPaymentId: true,
        amountCents: true,
        currency: true,
        externalBalanceTxnId: true,
      },
    });
    return rows
      .filter((r): r is typeof r & { externalPaymentId: string } => r.externalPaymentId !== null)
      .map((r) => ({
        externalPaymentId: r.externalPaymentId,
        amountCents: r.amountCents,
        currency: r.currency,
        externalBalanceTxnId: r.externalBalanceTxnId,
      }));
  }
}
