import { SubscriptionRepository } from "../domain/ports";

export interface SuspensionCandidate {
  subscriptionId: string;
  websiteId: string;
}

/**
 * Scheduled-job use case (docs/ARCHITECTURE.md §31 "Scheduled Jobs" / §17
 * "Billing Lifecycle": GRACE_PERIOD → SUSPENDED). Idempotent by construction:
 * re-running it only ever suspends subscriptions still in GRACE_PERIOD whose
 * window has actually elapsed — a subscription already SUSPENDED or reactivated
 * simply won't match `listByStatus("GRACE_PERIOD")` on the next run.
 *
 * This use case only touches Subscription state. The caller (apps/worker) is
 * responsible for suspending the corresponding Website via the Website bounded
 * context's own use case — Billing never mutates Website state directly
 * (docs/ARCHITECTURE.md §67).
 */
export class SuspendOverdueSubscriptionsUseCase {
  constructor(private readonly subscriptions: SubscriptionRepository) {}

  async execute(now: Date = new Date()): Promise<SuspensionCandidate[]> {
    const graceperiodSubscriptions = await this.subscriptions.listByStatus("GRACE_PERIOD");
    const suspended: SuspensionCandidate[] = [];

    for (const subscription of graceperiodSubscriptions) {
      if (!subscription.isPastDueBeyondGracePeriod(now)) continue;

      subscription.suspend();
      await this.subscriptions.save(subscription);
      suspended.push({ subscriptionId: subscription.id, websiteId: subscription.websiteId });
    }

    return suspended;
  }
}
