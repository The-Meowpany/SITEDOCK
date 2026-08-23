import { Money, ServicePlanId, SubscriptionId, WebsiteId } from "@sitedock/shared";
import { Subscription } from "../../domain/subscription.entity";
import { SubscriptionRepository } from "../../domain/ports";

const WEBSITE = WebsiteId("11111111-1111-1111-1111-111111111111");

/** Shared in-memory SubscriptionRepository for billing tests. */
export class InMemorySubscriptionRepository implements SubscriptionRepository {
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

export { WEBSITE };

export function newIncompleteSubscription(
  id = "33333333-3333-3333-3333-333333333333",
  websiteId: string = WEBSITE as string
) {
  return Subscription.create({
    id: SubscriptionId(id),
    websiteId: WebsiteId(websiteId),
    planId: ServicePlanId("22222222-2222-2222-2222-222222222222"),
    price: Money.fromCents(2900, "USD"),
    billingInterval: "MONTHLY",
    paymentProvider: "mock",
  });
}

// Keep the type-level import used (tree-shakes to nothing at runtime).
export type { SubscriptionRepository };
