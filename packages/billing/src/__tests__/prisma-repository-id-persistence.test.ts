import { beforeEach, describe, expect, it, vi } from "vitest";
import { Money } from "@sitedock/shared";
import type { Invoice, Payment } from "../domain/payment";
import type { ConnectedAccountRecord } from "../application/merchant-onboarding.use-cases";

const db = vi.hoisted(() => ({
  invoiceUpsert: vi.fn(),
  paymentUpsert: vi.fn(),
  connectedAccountUpsert: vi.fn(),
}));

vi.mock("@sitedock/database", () => ({
  prisma: {
    invoice: { upsert: db.invoiceUpsert },
    payment: { upsert: db.paymentUpsert },
    connectedAccount: { upsert: db.connectedAccountUpsert },
  },
}));

import { PrismaInvoiceRepository } from "../infrastructure/prisma-invoice.repository";
import { PrismaPaymentRepository } from "../infrastructure/prisma-payment.repository";
import { PrismaConnectedAccountRepository } from "../infrastructure/prisma-connected-account.repository";

const WORKSPACE_ID = "11111111-1111-1111-1111-111111111111";
const INVOICE_ID = "22222222-2222-2222-2222-222222222222";
const PAYMENT_ID = "33333333-3333-3333-3333-333333333333";
const ACCOUNT_ID = "44444444-4444-4444-4444-444444444444";
const CREATED_AT = new Date("2026-10-29T12:00:00Z");

describe("Prisma money repositories persist caller-generated ids", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("writes the invoice id on create so later payment FKs resolve", async () => {
    const invoice: Invoice = {
      id: INVOICE_ID,
      kind: "ONE_TIME",
      subscriptionId: null,
      websiteId: null,
      amount: Money.fromCents(2500, "USD"),
      status: "OPEN",
      dueDate: CREATED_AT,
      paidAt: null,
      createdAt: CREATED_AT,
    };

    await new PrismaInvoiceRepository().save(invoice);

    expect(db.invoiceUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: INVOICE_ID },
        create: expect.objectContaining({ id: INVOICE_ID }),
      })
    );
  });

  it("writes the payment id on create", async () => {
    const payment: Payment = {
      id: PAYMENT_ID,
      invoiceId: INVOICE_ID,
      amount: Money.fromCents(2500, "USD"),
      status: "SUCCEEDED",
      provider: "stripe",
      externalPaymentId: "pi_test",
      platformFee: Money.fromCents(100, "USD"),
      externalBalanceTxnId: null,
      refundedCents: 0,
      createdAt: CREATED_AT,
    };

    await new PrismaPaymentRepository().save(payment);

    expect(db.paymentUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: PAYMENT_ID },
        create: expect.objectContaining({
          id: PAYMENT_ID,
          invoiceId: INVOICE_ID,
        }),
      })
    );
  });

  it("writes the connected-account id on create", async () => {
    const account: ConnectedAccountRecord = {
      id: ACCOUNT_ID,
      workspaceId: WORKSPACE_ID,
      provider: "stripe",
      externalAccountId: "acct_test",
      status: "PENDING_ONBOARDING",
      chargesEnabled: false,
      payoutsEnabled: false,
      onboardedAt: null,
    };

    await new PrismaConnectedAccountRepository().save(account);

    expect(db.connectedAccountUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: ACCOUNT_ID },
        create: expect.objectContaining({
          id: ACCOUNT_ID,
          workspaceId: WORKSPACE_ID,
        }),
      })
    );
  });
});
