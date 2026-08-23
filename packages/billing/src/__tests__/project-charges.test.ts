import { describe, expect, it, beforeEach } from "vitest";
import { NormalizedProviderEvent } from "../domain/payment";
import { FlatPercentageFeePolicy } from "../domain/revenue-share";
import { MockPaymentProvider } from "../infrastructure/mock-payment.provider";
import { InMemorySubscriptionRepository } from "./helpers/in-memory-subscription.repository";
import {
  InMemoryInvoiceRepository,
  InMemoryPaymentRepository,
  InMemoryWebhookEventStore,
} from "./helpers/billing-in-memory";
import { InMemoryProjectChargeRepository } from "./helpers/in-memory-project-charge.repository";
import { CreateProjectChargeUseCase } from "../application/project-charge.use-cases";
import { ProcessPaymentWebhookUseCase } from "../application/process-webhook.use-case";

const WS = "11111111-1111-1111-1111-111111111111";
const SITE = "22222222-2222-2222-2222-222222222222";

describe("One-time project charges (creation/deploy fee)", () => {
  let charges: InMemoryProjectChargeRepository;
  let invoices: InMemoryInvoiceRepository;
  let payments: InMemoryPaymentRepository;
  let provider: MockPaymentProvider;
  let processWebhook: ProcessPaymentWebhookUseCase;

  beforeEach(() => {
    charges = new InMemoryProjectChargeRepository();
    invoices = new InMemoryInvoiceRepository();
    payments = new InMemoryPaymentRepository();
    provider = new MockPaymentProvider();
    processWebhook = new ProcessPaymentWebhookUseCase(
      new InMemorySubscriptionRepository(),
      new InMemoryWebhookEventStore(),
      invoices,
      payments,
      new FlatPercentageFeePolicy(10),
      charges
    );
  });

  async function createCharge(title = "Diseño y desarrollo inicial") {
    const useCase = new CreateProjectChargeUseCase(charges, provider);
    return useCase.execute({
      workspaceId: WS,
      websiteId: SITE,
      title,
      priceDecimal: "1500.00",
      currency: "USD",
      successUrl: "https://example.com/ok",
      cancelUrl: "https://example.com/no",
    });
  }

  it("creates a PENDING charge with a one-time checkout link", async () => {
    const result = await createCharge();

    expect(result.checkoutUrl).toMatch(/^https:\/\/pay\.sitedock\.demo\/checkout\/demo_otc_/);
    const stored = await charges.findById(result.chargeId);
    expect(stored?.status).toBe("PENDING");
    expect(stored?.externalCheckoutId).toBe(result.checkoutUrl.split("/").pop());
    expect(stored?.amount.amountCents).toBe(150000);
  });

  it("marks the charge PAID and records Invoice+Payment from the verified webhook — never before", async () => {
    const { chargeId, checkoutUrl } = await createCharge();

    // Not paid just because a checkout exists.
    expect((await charges.findById(chargeId))?.status).toBe("PENDING");

    const sessionId = checkoutUrl.split("/").pop()!;
    const { rawBody, signature } = provider.simulateSuccessfulCharge(sessionId);
    const event = provider.verifyAndParseWebhook(rawBody, signature);

    const result = await processWebhook.execute("mock", event, rawBody);

    expect(result.duplicate).toBe(false);
    expect(result.websiteId).toBe(SITE);

    const stored = await charges.findById(chargeId);
    expect(stored?.status).toBe("PAID");
    expect(stored?.paidAt).not.toBeNull();

    // Financial record lands too (ONE_TIME invoice + SUCCEEDED payment with fee).
    const invoice = [...invoices.store.values()][0]!;
    expect(invoice.kind).toBe("ONE_TIME");
    expect(invoice.websiteId).toBe(SITE);
    expect(invoice.subscriptionId).toBeNull();
    const payment = [...payments.store.values()][0]!;
    expect(payment.status).toBe("SUCCEEDED");
    expect(payment.platformFee.amountCents).toBe(15000); // 10% of 1500.00
  });

  it("is idempotent: a retried charge.succeeded event only pays once", async () => {
    const { checkoutUrl } = await createCharge();
    const sessionId = checkoutUrl.split("/").pop()!;
    const { rawBody, signature } = provider.simulateSuccessfulCharge(sessionId);
    const event = provider.verifyAndParseWebhook(rawBody, signature);

    await processWebhook.execute("mock", event, rawBody);
    const second = await processWebhook.execute("mock", event, rawBody);

    expect(second.duplicate).toBe(true);
    expect(payments.store.size).toBe(1);
  });

  it("fails loudly when the provider amount disagrees with the recorded charge", async () => {
    const { chargeId } = await createCharge();

    // Hand-craft a signed event whose amount doesn't match the stored charge.
    // externalChargeId echoes OUR charge id — exactly what a real provider
    // returns via client_reference_id/metadata.
    const tampered: NormalizedProviderEvent = {
      type: "charge.succeeded",
      eventId: `evt_${Date.now()}`,
      externalChargeId: chargeId,
      externalPaymentId: "demo_pay_x",
      amountCents: 100, // recorded was 150000
      currency: "USD",
    };
    const { rawBody } = provider.signPayload(tampered);

    await expect(processWebhook.execute("mock", tampered, rawBody)).rejects.toThrow(/amount mismatch/i);
    expect((await charges.findById(chargeId))?.status).toBe("PENDING");
  });
});

