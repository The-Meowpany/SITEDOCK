import { describe, expect, it, beforeEach } from "vitest";
import { Money, ServicePlanId, SubscriptionId, WebsiteId } from "@sitedock/shared";
import { Subscription } from "../domain/subscription.entity";
import { InvoiceRepository, PaymentRepository, SubscriptionRepository, WebhookEventStore } from "../domain/ports";
import { Invoice, NormalizedProviderEvent, Payment } from "../domain/payment";
import { FlatPercentageFeePolicy } from "../domain/revenue-share";
import { MockPaymentProvider } from "../infrastructure/mock-payment.provider";
import { CreateCheckoutSessionUseCase } from "../application/create-checkout-session.use-case";
import { ProcessPaymentWebhookUseCase } from "../application/process-webhook.use-case";

const WEBSITE = WebsiteId("11111111-1111-1111-1111-111111111111");
const PLAN = ServicePlanId("22222222-2222-2222-2222-222222222222");

class InMemorySubscriptionRepository implements SubscriptionRepository {
  store = new Map<string, Subscription>();

  async findById(id: string) {
    return this.store.get(id) ?? null;
  }
  async findByWebsiteId(websiteId: string) {
    return [...this.store.values()].find((s) => s.websiteId === websiteId) ?? null;
  }
  async findByWebsiteIdAndKind(websiteId: string) {
    return this.findByWebsiteId(websiteId);
  }
  async findByExternalId(_provider: string, externalSubscriptionId: string) {
    return [...this.store.values()].find((s) => s.externalSubscriptionId === externalSubscriptionId) ?? null;
  }
  async listByStatus(status: Subscription["status"]) {
    return [...this.store.values()].filter((s) => s.status === status);
  }
  async save(subscription: Subscription) {
    this.store.set(subscription.id, subscription);
  }
}

class InMemoryWebhookEventStore implements WebhookEventStore {
  private claimed = new Set<string>();
  processedKeys: string[] = [];
  releasedKeys: string[] = [];

  private key(provider: string, externalEventId: string) {
    return `${provider}:${externalEventId}`;
  }

  async hasBeenProcessed(provider: string, externalEventId: string) {
    return this.processedKeys.includes(this.key(provider, externalEventId));
  }
  async claimEvent(provider: string, externalEventId: string) {
    const key = this.key(provider, externalEventId);
    // Mirrors the Prisma unique constraint: claimed OR already-processed rows block re-claiming.
    if (this.claimed.has(key) || this.processedKeys.includes(key)) return false;
    this.claimed.add(key);
    return true;
  }
  async releaseEvent(provider: string, externalEventId: string) {
    const key = this.key(provider, externalEventId);
    this.claimed.delete(key);
    this.releasedKeys.push(key);
  }
  async recordProcessed(provider: string, externalEventId: string) {
    const key = this.key(provider, externalEventId);
    this.claimed.delete(key); // claim bookkeeping done — the event is final now
    this.processedKeys.push(key);
  }
}

class InMemoryInvoiceRepository implements InvoiceRepository {
  store = new Map<string, Invoice>();
  async findById(id: string) {
    return this.store.get(id) ?? null;
  }
  async findOpenBySubscription(subscriptionId: string) {
    return [...this.store.values()].find((i) => i.subscriptionId === subscriptionId && i.status === "OPEN") ?? null;
  }
  async save(invoice: Invoice) {
    this.store.set(invoice.id, invoice);
  }
}

class InMemoryPaymentRepository implements PaymentRepository {
  store = new Map<string, Payment>();
  async findById(id: string) {
    return this.store.get(id) ?? null;
  }
  async findByExternalPaymentId(provider: string, externalPaymentId: string) {
    return [...this.store.values()].find((p) => p.provider === provider && p.externalPaymentId === externalPaymentId) ?? null;
  }
  async save(payment: Payment) {
    this.store.set(payment.id, payment);
  }
}

function newIncompleteSubscription() {
  return Subscription.create({
    id: SubscriptionId("33333333-3333-3333-3333-333333333333"),
    websiteId: WEBSITE,
    planId: PLAN,
    price: Money.fromCents(2900, "USD"),
    billingInterval: "MONTHLY",
    paymentProvider: "mock",
  });
}

describe("Checkout + webhook flow (billing lifecycle end-to-end with fakes)", () => {
  let subscriptions: InMemorySubscriptionRepository;
  let webhookEvents: InMemoryWebhookEventStore;
  let invoices: InMemoryInvoiceRepository;
  let payments: InMemoryPaymentRepository;
  let provider: MockPaymentProvider;
  let processWebhook: ProcessPaymentWebhookUseCase;

  beforeEach(() => {
    subscriptions = new InMemorySubscriptionRepository();
    webhookEvents = new InMemoryWebhookEventStore();
    invoices = new InMemoryInvoiceRepository();
    payments = new InMemoryPaymentRepository();
    provider = new MockPaymentProvider();
    processWebhook = new ProcessPaymentWebhookUseCase(
      subscriptions,
      webhookEvents,
      invoices,
      payments,
      new FlatPercentageFeePolicy(10)
    );
  });

  it("creates a checkout session and attaches the external id to the subscription", async () => {
    const subscription = newIncompleteSubscription();
    await subscriptions.save(subscription);

    const checkout = new CreateCheckoutSessionUseCase(subscriptions, provider);
    const result = await checkout.execute({
      subscriptionId: subscription.id,
      successUrl: "https://example.com/success",
      cancelUrl: "https://example.com/cancel",
    });

    expect(result.checkoutUrl).toMatch(/^https:\/\/pay\.sitedock\.demo\/checkout\//);
    const updated = await subscriptions.findById(subscription.id);
    expect(updated?.externalSubscriptionId).toBeTruthy();
  });

  it("activates the subscription AND records a PAID invoice + SUCCEEDED payment on payment.succeeded", async () => {
    const subscription = newIncompleteSubscription();
    await subscriptions.save(subscription);

    const checkout = new CreateCheckoutSessionUseCase(subscriptions, provider);
    const { checkoutUrl } = await checkout.execute({
      subscriptionId: subscription.id,
      successUrl: "https://example.com/success",
      cancelUrl: "https://example.com/cancel",
    });
    const sessionId = checkoutUrl.split("/").pop()!;

    const { rawBody, signature } = provider.simulateSuccessfulPayment(sessionId);
    const event = provider.verifyAndParseWebhook(rawBody, signature);

    const result = await processWebhook.execute("mock", event, rawBody);

    expect(result.duplicate).toBe(false);
    expect(result.subscriptionStatus).toBe("ACTIVE");

    const updated = await subscriptions.findById(subscription.id);
    expect(updated?.status).toBe("ACTIVE");
    expect(updated?.nextBillingDate).not.toBeNull();

    // Financial records exist — dashboards read from these.
    expect(invoices.store.size).toBe(1);
    const invoice = [...invoices.store.values()][0]!;
    expect(invoice.status).toBe("PAID");
    expect(invoice.paidAt).not.toBeNull();

    expect(payments.store.size).toBe(1);
    const payment = [...payments.store.values()][0]!;
    expect(payment.status).toBe("SUCCEEDED");
    expect(payment.amount.amountCents).toBe(2900);
    expect(payment.platformFee.amountCents).toBe(290); // 10% revenue share
  });

  it("rejects a webhook with an invalid signature", () => {
    const tampered = Buffer.from('{"type":"payment.succeeded"}');
    expect(() => provider.verifyAndParseWebhook(tampered, "deadbeef")).toThrow(/Invalid webhook signature/);
  });

  it("is idempotent: processing the same webhook event twice only activates once", async () => {
    const subscription = newIncompleteSubscription();
    await subscriptions.save(subscription);

    const checkout = new CreateCheckoutSessionUseCase(subscriptions, provider);
    const { checkoutUrl } = await checkout.execute({
      subscriptionId: subscription.id,
      successUrl: "https://example.com/success",
      cancelUrl: "https://example.com/cancel",
    });
    const sessionId = checkoutUrl.split("/").pop()!;

    const { rawBody, signature } = provider.simulateSuccessfulPayment(sessionId);
    const event = provider.verifyAndParseWebhook(rawBody, signature);

    const first = await processWebhook.execute("mock", event, rawBody);
    const second = await processWebhook.execute("mock", event, rawBody); // same eventId, simulating provider retry

    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);

    // No double financial records either.
    expect(invoices.store.size).toBe(1);
    expect(payments.store.size).toBe(1);
  });

  it("marks the subscription PAST_DUE and records a FAILED payment attempt", async () => {
    const subscription = newIncompleteSubscription();
    subscription.activate(); // must be ACTIVE first — PAST_DUE is only reachable from ACTIVE
    subscription.attachExternalSubscription("demo_cs_test123");
    await subscriptions.save(subscription);

    const { rawBody, signature } = provider.simulateFailedPayment("demo_cs_test123");
    const event: NormalizedProviderEvent = provider.verifyAndParseWebhook(rawBody, signature);

    const result = await processWebhook.execute("mock", event, rawBody);

    expect(result.subscriptionStatus).toBe("PAST_DUE");

    expect(payments.store.size).toBe(1);
    const payment = [...payments.store.values()][0]!;
    expect(payment.status).toBe("FAILED");
    expect(invoices.store.size).toBe(1);
    expect([...invoices.store.values()][0]!.status).toBe("FAILED");
  });

  it("releases the ledger claim when processing fails, so a retry is not swallowed", async () => {
    // Valid, correctly-signed event for a session nobody attached to a subscription.
    const orphanEvent: NormalizedProviderEvent = {
      type: "payment.succeeded",
      eventId: "evt_orphan",
      externalSubscriptionId: "demo_cs_never_attached",
      externalPaymentId: "demo_pay_orphan",
      amountCents: 2900,
      currency: "USD",
    };

    await expect(processWebhook.execute("mock", orphanEvent, Buffer.from("{}"))).rejects.toThrow(/No subscription found/);
    expect(webhookEvents.releasedKeys).toEqual(["mock:evt_orphan"]);

    // Now attach the subscription and retry the SAME event id — it must process.
    const subscription = newIncompleteSubscription();
    subscription.attachExternalSubscription(orphanEvent.externalSubscriptionId);
    await subscriptions.save(subscription);

    const retried = await processWebhook.execute("mock", orphanEvent, Buffer.from("{}"));
    expect(retried.duplicate).toBe(false);
    expect(retried.subscriptionStatus).toBe("ACTIVE");
  });

  it("throws when simulating a payment for a checkout session that was never created", () => {
    expect(() => provider.simulateSuccessfulPayment("unknown_session")).toThrow(/Unknown demo checkout session/);
  });
});


