import { SubscriptionRepository } from "../domain/ports";

export interface UpcomingRenewal {
  subscriptionId: string;
  websiteId: string;
  nextBillingDate: Date;
  billingInterval: "MONTHLY" | "YEARLY";
  amountDecimal: string;
  currency: string;
}

/** How many days before `nextBillingDate` a reminder should fire. */
export const DEFAULT_REMINDER_WINDOW_DAYS = 3;

/**
 * Start of the billing period that ends at `nextBillingDate` — the mirror of
 * Subscription's private addInterval(). Used as the dedup cutoff for renewal
 * reminders: at most one reminder per billing period, no matter how often the
 * scheduled job runs.
 */
export function previousPeriodStart(nextBillingDate: Date, interval: "MONTHLY" | "YEARLY"): Date {
  const start = new Date(nextBillingDate);
  if (interval === "MONTHLY") start.setMonth(start.getMonth() - 1);
  else start.setFullYear(start.getFullYear() - 1);
  return start;
}

/**
 * Scheduled-job read (docs/ARCHITECTURE.md §17/§31 "renewals"): ACTIVE
 * subscriptions whose next charge falls inside the reminder window. Pure
 * candidate-finding — deciding whether a client was already reminded (the
 * idempotency ledger lives in the Notification context) and actually sending
 * are the caller's job, exactly like SuspendOverdueSubscriptionsUseCase.
 *
 * listByStatus("ACTIVE") is documented as system-level only; this use case is
 * exclusively for scheduled jobs, never user-facing requests.
 */
export class FindUpcomingRenewalsUseCase {
  constructor(private readonly subscriptions: SubscriptionRepository) {}

  async execute(
    options: { now?: Date; windowDays?: number } = {}
  ): Promise<UpcomingRenewal[]> {
    const now = options.now ?? new Date();
    const windowDays = options.windowDays ?? DEFAULT_REMINDER_WINDOW_DAYS;
    const windowEnd = new Date(now);
    windowEnd.setDate(windowEnd.getDate() + windowDays);

    const actives = await this.subscriptions.listByStatus("ACTIVE");

    return actives
      .filter(
        (s): s is typeof s & { nextBillingDate: Date } =>
          s.nextBillingDate !== null && s.nextBillingDate >= now && s.nextBillingDate <= windowEnd
      )
      .map((s) => ({
        subscriptionId: s.id,
        websiteId: s.websiteId,
        nextBillingDate: s.nextBillingDate,
        billingInterval: s.billingInterval,
        amountDecimal: s.price.toDecimalString(),
        currency: s.price.currency,
      }));
  }
}
