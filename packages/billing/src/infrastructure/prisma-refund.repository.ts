import { randomUUID } from "node:crypto";
import { prisma } from "@sitedock/database";
import { RefundRecord, RefundRepository } from "../domain/ports";

function toDomain(row: {
  id: string;
  paymentId: string;
  amountCents: number;
  currency: string;
  reason: string | null;
  status: string;
  externalRefundId: string | null;
  createdAt: Date;
}): RefundRecord {
  return {
    id: row.id,
    paymentId: row.paymentId,
    amountCents: row.amountCents,
    currency: row.currency,
    reason: row.reason,
    status: row.status as RefundRecord["status"],
    externalRefundId: row.externalRefundId,
    createdAt: row.createdAt,
  };
}

export class PrismaRefundRepository implements RefundRepository {
  async findByExternalRefundId(externalRefundId: string): Promise<RefundRecord | null> {
    const row = await prisma.refund.findUnique({ where: { externalRefundId } });
    return row ? toDomain(row) : null;
  }

  async save(refund: RefundRecord): Promise<void> {
    const data = {
      id: refund.id ?? randomUUID(),
      paymentId: refund.paymentId,
      amountCents: refund.amountCents,
      currency: refund.currency,
      reason: refund.reason ?? null,
      status: refund.status,
      externalRefundId: refund.externalRefundId,
    };
    await prisma.refund.upsert({
      where: { id: data.id },
      create: data,
      update: { status: refund.status },
    });
  }
}
