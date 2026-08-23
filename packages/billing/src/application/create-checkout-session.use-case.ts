import { NotFoundError, SubscriptionId } from "@sitedock/shared";
import { PaymentProvider } from "../domain/payment";
import { SubscriptionRepository } from "../domain/ports";

export interface CreateCheckoutSessionCommand {
  subscriptionId: string;
  successUrl: string;
  cancelUrl: string;
}

/**
 * Generates the checkout link the developer sends to their client
 * (docs/ARCHITECTURE.md §9 flow step 8). The frontend never confirms payment
 * itself — it only redirects here and later reacts to the subscription's
 * status, which is only ever changed by a verified webhook.
 */
export class CreateCheckoutSessionUseCase {
  constructor(
    private readonly subscriptions: SubscriptionRepository,
    private readonly paymentProvider: PaymentProvider
  ) {}

  async execute(command: CreateCheckoutSessionCommand): Promise<{ checkoutUrl: string }> {
    const subscription = await this.subscriptions.findById(SubscriptionId(command.subscriptionId));
    if (!subscription) throw new NotFoundError("Subscription", command.subscriptionId);

    const session = await this.paymentProvider.createCheckoutSession({
      subscriptionId: subscription.id,
      amount: subscription.price,
      billingInterval: subscription.billingInterval,
      successUrl: command.successUrl,
      cancelUrl: command.cancelUrl,
    });

    subscription.attachExternalSubscription(session.id);
    await this.subscriptions.save(subscription);

    return { checkoutUrl: session.url };
  }
}
