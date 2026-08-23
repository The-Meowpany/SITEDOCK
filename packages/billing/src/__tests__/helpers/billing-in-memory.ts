import { Invoice, Payment } from "../../domain/payment";
import { InvoiceRepository, PaymentRepository, WebhookEventStore } from "../../domain/ports";

export class InMemoryWebhookEventStore implements WebhookEventStore {
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

export class InMemoryInvoiceRepository implements InvoiceRepository {
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

export class InMemoryPaymentRepository implements PaymentRepository {
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

