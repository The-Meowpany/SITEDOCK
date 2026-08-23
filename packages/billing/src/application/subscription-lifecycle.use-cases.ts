import { NotFoundError, SubscriptionId } from "@sitedock/shared";
import { SubscriptionRepository } from "../domain/ports";

/**
 * These use cases are the only legal entry point for payment-provider webhooks
 * to affect subscription state (docs/ARCHITECTURE.md §9/§17/§76). The webhook
 * handler in apps/api verifies the signature and idempotency key BEFORE calling
 * any of these — never trust an unverified payload to reach this layer.
 */
export class ActivateSubscriptionOnPaymentSucceededUseCase {
  constructor(private readonly subscriptions: SubscriptionRepository) {}

  async execute(subscriptionId: string): Promise<{ status: string; websiteId: string }> {
    const subscription = await this.subscriptions.findById(SubscriptionId(subscriptionId));
    if (!subscription) throw new NotFoundError("Subscription", subscriptionId);

    if (subscription.status === "ACTIVE") {
      subscription.renew();
    } else {
      subscription.activate();
    }

    await this.subscriptions.save(subscription);
    return { status: subscription.status, websiteId: subscription.websiteId };
  }
}

export class MarkSubscriptionPastDueUseCase {
  constructor(private readonly subscriptions: SubscriptionRepository) {}

  async execute(subscriptionId: string): Promise<{ websiteId: string }> {
    const subscription = await this.subscriptions.findById(SubscriptionId(subscriptionId));
    if (!subscription) throw new NotFoundError("Subscription", subscriptionId);

    subscription.markPastDue();
    await this.subscriptions.save(subscription);
    return { websiteId: subscription.websiteId };
  }
}

export class EnterGracePeriodUseCase {
  constructor(private readonly subscriptions: SubscriptionRepository) {}

  async execute(subscriptionId: string): Promise<{ websiteId: string; gracePeriodEndsAt: Date | null }> {
    const subscription = await this.subscriptions.findById(SubscriptionId(subscriptionId));
    if (!subscription) throw new NotFoundError("Subscription", subscriptionId);

    subscription.enterGracePeriod();
    await this.subscriptions.save(subscription);
    return { websiteId: subscription.websiteId, gracePeriodEndsAt: subscription.gracePeriodEndsAt };
  }
}

export class SuspendSubscriptionUseCase {
  constructor(private readonly subscriptions: SubscriptionRepository) {}

  async execute(subscriptionId: string): Promise<{ websiteId: string }> {
    const subscription = await this.subscriptions.findById(SubscriptionId(subscriptionId));
    if (!subscription) throw new NotFoundError("Subscription", subscriptionId);

    subscription.suspend();
    await this.subscriptions.save(subscription);
    return { websiteId: subscription.websiteId };
  }
}

export class CancelSubscriptionUseCase {
  constructor(private readonly subscriptions: SubscriptionRepository) {}

  async execute(subscriptionId: string): Promise<{ websiteId: string }> {
    const subscription = await this.subscriptions.findById(SubscriptionId(subscriptionId));
    if (!subscription) throw new NotFoundError("Subscription", subscriptionId);

    subscription.cancel();
    await this.subscriptions.save(subscription);
    return { websiteId: subscription.websiteId };
  }
}
