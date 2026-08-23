import { describe, expect, it, beforeEach } from "vitest";
import { Money, ServicePlanId, SubscriptionId, WebsiteId } from "@sitedock/shared";
import { Subscription } from "../domain/subscription.entity";
import { SubscriptionRepository } from "../domain/ports";
import {
  DEFAULT_REMINDER_WINDOW_DAYS,
  FindUpcomingRenewalsUseCase,
  previousPeriodStart,
} from "../application/find-upcoming-renewals.use-case";

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
  async findByExternalId() {
    return null;
  }
  async listByStatus(status: Subscription["status"]) {
    return [...this.store.values()].filter((s) => s.status === status);
  }
  async save(subscription: Subscription) {
    this.store.set(subscription.id, subscription);
  }
}

function activeSubscription(params: {
  id: string;
  websiteId: string;
  interval?: "MONTHLY" | "YEARLY";
  priceCents?: number;
  /** Activation moment — nextBillingDate lands exactly one interval later. */
  activateAt?: Date;
}) {
  const sub = Subscription.create({
    id: SubscriptionId(params.id),
    websiteId: WebsiteId(params.websiteId),
    planId: ServicePlanId("22222222-2222-2222-2222-222222222222"),
    price: Money.fromCents(params.priceCents ?? 2900, "USD"),
    billingInterval: params.interval ?? "MONTHLY",
    paymentProvider: "mock",
  });
  sub.activate(params.activateAt ?? new Date("2026-07-24T00:00:00Z"));
  return sub;
}

const NOW = new Date("2026-08-22T12:00:00Z"); // window: Aug 22 – Aug 25

describe("previousPeriodStart", () => {
  it("mirrors Subscription.addInterval backwards", () => {
    expect(previousPeriodStart(new Date("2026-09-01T00:00:00Z"), "MONTHLY")).toEqual(
      new Date("2026-08-01T00:00:00Z")
    );
    expect(previousPeriodStart(new Date("2027-03-15T00:00:00Z"), "YEARLY")).toEqual(
      new Date("2026-03-15T00:00:00Z")
    );
  });

  it("handles month-end rollover the same way addInterval does", () => {
    // Sep 30 - 1 month = Aug 31 in JS Date arithmetic (same behavior as the entity)
    expect(previousPeriodStart(new Date("2026-09-30T10:00:00Z"), "MONTHLY").getUTCMonth()).toBe(7);
  });
});

describe("FindUpcomingRenewalsUseCase", () => {
  let subscriptions: InMemorySubscriptionRepository;
  let useCase: FindUpcomingRenewalsUseCase;

  beforeEach(() => {
    subscriptions = new InMemorySubscriptionRepository();
    useCase = new FindUpcomingRenewalsUseCase(subscriptions);
  });

  it("returns ACTIVE subscriptions renewing inside the default window with their captured price", async () => {
    const inWindow = activeSubscription({ id: "33333333-3333-3333-3333-333333333331", websiteId: "11111111-1111-1111-1111-111111111111" });
    await subscriptions.save(inWindow);

    const result = await useCase.execute({ now: NOW });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      subscriptionId: inWindow.id,
      amountDecimal: "29.00",
      currency: "USD",
      billingInterval: "MONTHLY",
    });
    expect(DEFAULT_REMINDER_WINDOW_DAYS).toBe(3);
  });

  it("excludes renewals beyond the window and subscriptions that left ACTIVE", async () => {
    // Renewed Jul 20 → nextBillingDate Sep 20, well beyond the window.
    const farFuture = activeSubscription({
      id: "33333333-3333-3333-3333-333333333332",
      websiteId: "11111111-1111-1111-1111-111111111112",
      activateAt: new Date("2026-07-20T00:00:00Z"),
    });
    await subscriptions.save(farFuture);

    // Inside the window, but no longer ACTIVE (payment failed).
    const leftActive = activeSubscription({ id: "33333333-3333-3333-3333-333333333333", websiteId: "11111111-1111-1111-1111-111111111113" });
    leftActive.markPastDue();
    await subscriptions.save(leftActive);

    const result = await useCase.execute({ now: NOW });
    expect(result).toHaveLength(0);
  });

  it("supports yearly plans and keeps their interval for dedup math", async () => {
    const yearly = activeSubscription({
      id: "33333333-3333-3333-3333-333333333334",
      websiteId: "11111111-1111-1111-1111-111111111114",
      interval: "YEARLY",
      activateAt: new Date("2025-08-23T00:00:00Z"), // + 1 year → renews inside the window
    });
    await subscriptions.save(yearly);

    const result = await useCase.execute({ now: NOW });

    expect(result).toHaveLength(1);
    expect(result[0]!.billingInterval).toBe("YEARLY");
    expect(result[0]!.nextBillingDate.getUTCFullYear()).toBe(2026);
  });

  it("never returns candidates for an empty workspace of subscriptions", async () => {
    const result = await useCase.execute({ now: NOW });
    expect(result).toEqual([]);
  });
});

