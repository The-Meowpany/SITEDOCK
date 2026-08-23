import { WebsiteId } from "@sitedock/shared";
import { SubscriptionRepository } from "../domain/ports";

/**
 * Read-side query for the Client Portal and Developer Console (docs/
 * ARCHITECTURE.md §15 / §18 "CQRS-lite"). Deliberately separate from the
 * write-side lifecycle use cases — this never mutates anything. Reads price
 * and billing interval directly off the Subscription (captured at subscribe
 * time), not off the ServicePlan. `kind` selects which membership: HOSTING by
 * default; MAINTENANCE returns the maintenance tier membership when present.
 */
export class GetSubscriptionForWebsiteUseCase {
  constructor(private readonly subscriptions: SubscriptionRepository) {}

  async execute(websiteId: string, kind: "HOSTING" | "MAINTENANCE" = "HOSTING") {
    const subscription =
      kind === "HOSTING"
        ? await this.subscriptions.findByWebsiteId(WebsiteId(websiteId))
        : await this.subscriptions.findByWebsiteIdAndKind(WebsiteId(websiteId), "MAINTENANCE");
    if (!subscription) return null;

    return {
      id: subscription.id,
      kind: subscription.kind,
      status: subscription.status,
      priceDecimal: subscription.price.toDecimalString(),
      currency: subscription.price.currency,
      billingInterval: subscription.billingInterval,
      nextBillingDate: subscription.nextBillingDate,
      gracePeriodEndsAt: subscription.gracePeriodEndsAt,
      cancellationDate: subscription.cancellationDate,
    };
  }
}
