import { prisma } from "@sitedock/database";
import { DisputeRecord, DisputeRepository } from "../domain/ports";

function toDomain(row: {
  id: string;
  paymentId: string;
  externalDisputeId: string;
  amountCents: number;
  currency: string;
  status: string;
  evidenceDueBy: Date | null;
  createdAt: Date;
  closedAt: Date | null;
}): DisputeRecord {
  return {
    id: row.id,
    paymentId: row.paymentId,
    externalDisputeId: row.externalDisputeId,
    amountCents: row.amountCents,
    currency: row.currency,
    status: row.status as DisputeRecord["status"],
    evidenceDueBy: row.evidenceDueBy?.toISOString() ?? null,
    createdAt: row.createdAt,
    closedAt: row.closedAt,
  };
}

export class PrismaDisputeRepository implements DisputeRepository {
  async findByExternalDisputeId(externalDisputeId: string): Promise<DisputeRecord | null> {
    const row = await prisma.dispute.findUnique({ where: { externalDisputeId } });
    return row ? toDomain(row) : null;
  }

  async save(dispute: DisputeRecord): Promise<void> {
    const data = {
      id: dispute.id,
      paymentId: dispute.paymentId,
      externalDisputeId: dispute.externalDisputeId,
      amountCents: dispute.amountCents,
      currency: dispute.currency,
      status: dispute.status,
      evidenceDueBy: dispute.evidenceDueBy ? new Date(dispute.evidenceDueBy) : null,
      closedAt: dispute.closedAt ?? null,
    };
    await prisma.dispute.upsert({
      where: { id: data.id },
      create: data,
      update: { status: dispute.status, closedAt: dispute.closedAt ?? null },
    });
  }
}
