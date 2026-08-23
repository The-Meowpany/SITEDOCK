import { describe, expect, it, beforeEach } from "vitest";
import { Money, ServicePlanId, SubscriptionId, WebsiteId } from "@sitedock/shared";
import { Subscription } from "../domain/subscription.entity";
import { SubscriptionRepository } from "../domain/ports";
import { SuspendOverdueSubscriptionsUseCase } from "../application/suspend-overdue-subscriptions.use-case";

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

function activeSubscription(id: string, websiteId: string) {
  const sub = Subscription.create({
    id: SubscriptionId(id),
    websiteId: WebsiteId(websiteId),
    planId: ServicePlanId("22222222-2222-2222-2222-222222222222"),
    price: Money.fromCents(2900, "USD"),
    billingInterval: "MONTHLY",
    paymentProvider: "mock",
  });
  sub.activate();
  return sub;
}

const WEBSITE_A = "11111111-1111-1111-1111-111111111111";
const WEBSITE_B = "44444444-4444-4444-4444-444444444444";
const SUB_A = "33333333-3333-3333-3333-333333333333";
const SUB_B = "55555555-5555-5555-5555-555555555555";

describe("SuspendOverdueSubscriptionsUseCase (scheduled job)", () => {
  let subscriptions: InMemorySubscriptionRepository;
  let useCase: SuspendOverdueSubscriptionsUseCase;

  beforeEach(() => {
    subscriptions = new InMemorySubscriptionRepository();
    useCase = new SuspendOverdueSubscriptionsUseCase(subscriptions);
  });

  it("suspends a subscription whose grace period has elapsed", async () => {
    const sub = activeSubscription(SUB_A, WEBSITE_A);
    sub.markPastDue();
    sub.enterGracePeriod(new Date("2026-01-01T00:00:00Z"));
    await subscriptions.save(sub);

    const result = await useCase.execute(new Date("2026-01-10T00:00:00Z")); // 9 days later, grace is 7 days

    expect(result).toEqual([{ subscriptionId: SUB_A, websiteId: WEBSITE_A }]);
    const updated = await subscriptions.findById(SUB_A);
    expect(updated?.status).toBe("SUSPENDED");
  });

  it("does not suspend a subscription still within its grace period", async () => {
    const sub = activeSubscription(SUB_A, WEBSITE_A);
    sub.markPastDue();
    sub.enterGracePeriod(new Date("2026-01-01T00:00:00Z"));
    await subscriptions.save(sub);

    const result = await useCase.execute(new Date("2026-01-03T00:00:00Z")); // only 2 days later

    expect(result).toEqual([]);
    const updated = await subscriptions.findById(SUB_A);
    expect(updated?.status).toBe("GRACE_PERIOD");
  });

  it("ignores subscriptions that are ACTIVE or already SUSPENDED", async () => {
    const active = activeSubscription(SUB_A, WEBSITE_A);
    await subscriptions.save(active);

    const result = await useCase.execute();
    expect(result).toEqual([]);
  });

  it("processes multiple overdue subscriptions in a single run", async () => {
    const subA = activeSubscription(SUB_A, WEBSITE_A);
    subA.markPastDue();
    subA.enterGracePeriod(new Date("2026-01-01T00:00:00Z"));
    await subscriptions.save(subA);

    const subB = activeSubscription(SUB_B, WEBSITE_B);
    subB.markPastDue();
    subB.enterGracePeriod(new Date("2026-01-01T00:00:00Z"));
    await subscriptions.save(subB);

    const result = await useCase.execute(new Date("2026-01-10T00:00:00Z"));
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.websiteId).sort()).toEqual([WEBSITE_A, WEBSITE_B].sort());
  });

  it("is idempotent: running it twice only suspends once", async () => {
    const sub = activeSubscription(SUB_A, WEBSITE_A);
    sub.markPastDue();
    sub.enterGracePeriod(new Date("2026-01-01T00:00:00Z"));
    await subscriptions.save(sub);

    const now = new Date("2026-01-10T00:00:00Z");
    const first = await useCase.execute(now);
    const second = await useCase.execute(now);

    expect(first).toHaveLength(1);
    expect(second).toHaveLength(0); // already SUSPENDED, no longer matches listByStatus("GRACE_PERIOD")
  });
});

