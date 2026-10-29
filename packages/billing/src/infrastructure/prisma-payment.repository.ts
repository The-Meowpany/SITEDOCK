import { prisma } from "@sitedock/database";
import { Money } from "@sitedock/shared";
import { Payment } from "../domain/payment";
import { PaymentRepository } from "../domain/ports";

function toDomain(row: {
  id: string;
  invoiceId: string;
  amountCents: number;
  currency: string;
  status: string;
  provider: string;
  externalPaymentId: string | null;
  platformFeeCents: number;
  externalBalanceTxnId: string | null;
  refundedCents: number;
  createdAt: Date;
}): Payment {
  return {
    id: row.id,
    invoiceId: row.invoiceId,
    amount: Money.fromCents(row.amountCents, row.currency),
    status: row.status as Payment["status"],
    provider: row.provider,
    externalPaymentId: row.externalPaymentId,
    platformFee: Money.fromCents(row.platformFeeCents, row.currency),
    externalBalanceTxnId: row.externalBalanceTxnId,
    refundedCents: row.refundedCents,
    createdAt: row.createdAt,
  };
}

export class PrismaPaymentRepository implements PaymentRepository {
  async findById(id: string): Promise<Payment | null> {
    const row = await prisma.payment.findUnique({ where: { id } });
    return row ? toDomain(row) : null;
  }

  async findByExternalPaymentId(provider: string, externalPaymentId: string): Promise<Payment | null> {
    const row = await prisma.payment.findFirst({
      where: { provider, externalPaymentId },
      orderBy: { createdAt: "desc" },
    });
    return row ? toDomain(row) : null;
  }

  async save(payment: Payment): Promise<void> {
    const data = {
      id: payment.id,
      invoiceId: payment.invoiceId,
      amountCents: payment.amount.amountCents,
      currency: payment.amount.currency,
      status: payment.status,
      provider: payment.provider,
      externalPaymentId: payment.externalPaymentId,
      platformFeeCents: payment.platformFee.amountCents,
      externalBalanceTxnId: payment.externalBalanceTxnId,
      refundedCents: payment.refundedCents,
    };
    await prisma.payment.upsert({
      where: { id: payment.id },
      create: data,
      update: {
        status: payment.status,
        externalPaymentId: payment.externalPaymentId,
        platformFeeCents: payment.platformFee.amountCents,
        externalBalanceTxnId: payment.externalBalanceTxnId,
        refundedCents: payment.refundedCents,
      },
    });
  }
}
