import { prisma } from "@sitedock/database";
import { WebhookEventStore } from "../domain/ports";

/**
 * Backed by the payment_events table's unique (provider, externalEventId)
 * constraint (packages/database/prisma/schema.prisma) — the constraint is
 * what actually guarantees idempotency under concurrent webhook delivery,
 * this repository just exposes it through the domain port.
 */
export class PrismaWebhookEventStore implements WebhookEventStore {
  async hasBeenProcessed(provider: string, externalEventId: string): Promise<boolean> {
    const existing = await prisma.paymentEvent.findUnique({
      where: { provider_externalEventId: { provider, externalEventId } },
    });
    return existing !== null;
  }

  async claimEvent(
    provider: string,
    externalEventId: string,
    eventType: string,
    payloadHash: string
  ): Promise<boolean> {
    try {
      await prisma.paymentEvent.create({
        data: { provider, externalEventId, eventType, payloadHash, processingStatus: "PROCESSING" },
      });
      return true; // we own this event now
    } catch (err) {
      // P2002 = unique violation on (provider, externalEventId) → already claimed.
      if ((err as { code?: string }).code === "P2002") return false;
      throw err;
    }
  }

  async releaseEvent(provider: string, externalEventId: string): Promise<void> {
    await prisma.paymentEvent.deleteMany({ where: { provider, externalEventId, processingStatus: "PROCESSING" } });
  }

  async recordProcessed(provider: string, externalEventId: string, eventType: string, payloadHash: string): Promise<void> {
    await prisma.paymentEvent.upsert({
      where: { provider_externalEventId: { provider, externalEventId } },
      create: { provider, externalEventId, eventType, payloadHash, processingStatus: "PROCESSED" },
      update: { processingStatus: "PROCESSED", eventType },
    });
  }
}
