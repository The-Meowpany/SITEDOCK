import { prisma } from "@sitedock/database";
import { Money, ServicePlanId, SubscriptionId, WebsiteId } from "@sitedock/shared";
import { Subscription } from "../domain/subscription.entity";
import type { PlanKind } from "../domain/service-plan.entity";
import { SubscriptionRepository } from "../domain/ports";

type SubscriptionRow = {
  id: string;
  websiteId: string;
  kind: string;
  planId: string;
  status: string;
  priceCents: number;
  currency: string;
  billingInterval: string;
  startDate: Date | null;
  nextBillingDate: Date | null;
  trialEnd: Date | null;
  gracePeriodEndsAt: Date | null;
  cancellationDate: Date | null;
  paymentProvider: string;
  externalSubscriptionId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

function toDomain(row: SubscriptionRow): Subscription {
  return Subscription.hydrate({
    id: SubscriptionId(row.id),
    websiteId: WebsiteId(row.websiteId),
    kind: row.kind as PlanKind,
    planId: ServicePlanId(row.planId),
    status: row.status as Subscription["status"],
    price: Money.fromCents(row.priceCents, row.currency),
    billingInterval: row.billingInterval as Subscription["billingInterval"],
    startDate: row.startDate,
    nextBillingDate: row.nextBillingDate,
    trialEnd: row.trialEnd,
    gracePeriodEndsAt: row.gracePeriodEndsAt,
    cancellationDate: row.cancellationDate,
    paymentProvider: row.paymentProvider,
    externalSubscriptionId: row.externalSubscriptionId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

export class PrismaSubscriptionRepository implements SubscriptionRepository {
  async findById(id: SubscriptionId): Promise<Subscription | null> {
    const row = await prisma.subscription.findUnique({ where: { id } });
    return row ? toDomain(row) : null;
  }

  async findByWebsiteId(websiteId: WebsiteId): Promise<Subscription | null> {
    // With two kinds per website, the HOSTING subscription is the canonical one
    // callers of this legacy convenience mean.
    const row = await prisma.subscription.findFirst({
      where: { websiteId, kind: "HOSTING" },
    });
    return row ? toDomain(row) : null;
  }

  async findByWebsiteIdAndKind(websiteId: WebsiteId, kind: PlanKind): Promise<Subscription | null> {
    const row = await prisma.subscription.findUnique({
      where: { websiteId_kind: { websiteId, kind } },
    });
    return row ? toDomain(row) : null;
  }

  async findByExternalId(provider: string, externalSubscriptionId: string): Promise<Subscription | null> {
    const row = await prisma.subscription.findFirst({ where: { paymentProvider: provider, externalSubscriptionId } });
    return row ? toDomain(row) : null;
  }

  async listByStatus(status: Subscription["status"]): Promise<Subscription[]> {
    const rows = await prisma.subscription.findMany({ where: { status } });
    return rows.map(toDomain);
  }

  async save(subscription: Subscription): Promise<void> {
    await prisma.subscription.upsert({
      where: { id: subscription.id },
      create: {
        id: subscription.id,
        websiteId: subscription.websiteId,
        kind: subscription.kind,
        planId: subscription.planId,
        status: subscription.status,
        priceCents: subscription.price.amountCents,
        currency: subscription.price.currency,
        billingInterval: subscription.billingInterval,
        startDate: subscription.startDate,
        nextBillingDate: subscription.nextBillingDate,
        gracePeriodEndsAt: subscription.gracePeriodEndsAt,
        cancellationDate: subscription.cancellationDate,
        paymentProvider: subscription.paymentProvider,
        externalSubscriptionId: subscription.externalSubscriptionId,
      },
      update: {
        status: subscription.status,
        startDate: subscription.startDate,
        nextBillingDate: subscription.nextBillingDate,
        gracePeriodEndsAt: subscription.gracePeriodEndsAt,
        cancellationDate: subscription.cancellationDate,
        externalSubscriptionId: subscription.externalSubscriptionId,
      },
    });
  }
}
