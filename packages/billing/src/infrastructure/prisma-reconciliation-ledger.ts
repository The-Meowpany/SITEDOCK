import { prisma } from "@sitedock/database";
import { LedgerSidePayment } from "../domain/money-gateways";
import { ReconciliationLedgerPort } from "../application/money-movements.use-cases";

/**
 * Lado LEDGER de la reconciliación (Fase 16 §4): pagos reales de un workspace,
 * resueltos por la cadena Payment → Invoice → Subscription → Website, que es
 * donde vive la frontera del tenant.
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
