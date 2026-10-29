import { prisma } from "@sitedock/database";
import { Money } from "@sitedock/shared";
import { Invoice } from "../domain/payment";
import { InvoiceRepository } from "../domain/ports";

type InvoiceRow = {
  id: string;
  kind: string;
  subscriptionId: string | null;
  websiteId: string | null;
  amountCents: number;
  currency: string;
  status: string;
  dueDate: Date;
  paidAt: Date | null;
  createdAt: Date;
};

function toDomain(row: InvoiceRow): Invoice {
  return {
    id: row.id,
    kind: row.kind as Invoice["kind"],
    subscriptionId: row.subscriptionId,
    websiteId: row.websiteId,
    amount: Money.fromCents(row.amountCents, row.currency),
    status: row.status as Invoice["status"],
    dueDate: row.dueDate,
    paidAt: row.paidAt,
    createdAt: row.createdAt,
  };
}

export class PrismaInvoiceRepository implements InvoiceRepository {
  async findById(id: string): Promise<Invoice | null> {
    const row = await prisma.invoice.findUnique({ where: { id } });
    return row ? toDomain(row) : null;
  }

  async findOpenBySubscription(subscriptionId: string): Promise<Invoice | null> {
    const row = await prisma.invoice.findFirst({
      where: { subscriptionId, status: "OPEN" },
      orderBy: { createdAt: "desc" },
    });
    return row ? toDomain(row) : null;
  }

  async save(invoice: Invoice): Promise<void> {
    const data = {
      id: invoice.id,
      kind: invoice.kind,
      subscriptionId: invoice.subscriptionId,
      websiteId: invoice.websiteId,
      amountCents: invoice.amount.amountCents,
      currency: invoice.amount.currency,
      status: invoice.status,
      dueDate: invoice.dueDate,
      paidAt: invoice.paidAt,
    };
    await prisma.invoice.upsert({
      where: { id: invoice.id },
      create: data,
      update: {
        status: invoice.status,
        paidAt: invoice.paidAt,
        websiteId: invoice.websiteId,
        kind: invoice.kind,
      },
    });
  }
}
