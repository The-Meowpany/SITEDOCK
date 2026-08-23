import { Money, ServicePlanId, SubscriptionId, WebsiteId } from "@sitedock/shared";
import { BillingInterval, PlanKind } from "./service-plan.entity";
import { SubscriptionStatus, subscriptionStateMachine } from "./subscription-status";

export interface SubscriptionProps {
  id: SubscriptionId;
  websiteId: WebsiteId;
  /** Denormalized from the plan at creation — one HOSTING + one MAINTENANCE per website. */
  kind: PlanKind;
  planId: ServicePlanId;
  status: SubscriptionStatus;
  price: Money; // captured at subscription time — plan price changes don't retroactively affect existing subscriptions
  billingInterval: BillingInterval;
  startDate: Date | null;
  nextBillingDate: Date | null;
  trialEnd: Date | null;
  gracePeriodEndsAt: Date | null;
  cancellationDate: Date | null;
  paymentProvider: string;
  externalSubscriptionId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const GRACE_PERIOD_DAYS = 7;

function addInterval(date: Date, interval: BillingInterval): Date {
  const next = new Date(date);
  if (interval === "MONTHLY") next.setMonth(next.getMonth() + 1);
  else next.setFullYear(next.getFullYear() + 1);
  return next;
}

/**
 * Subscription aggregate. Owns the billing lifecycle state machine and never
 * lets the frontend/webhook layer set `status` directly — every transition
 * goes through a named method that also updates the derived dates.
 */
export class Subscription {
  private constructor(private props: SubscriptionProps) {}

  static create(params: {
    id: SubscriptionId;
    websiteId: WebsiteId;
    kind?: PlanKind;
    planId: ServicePlanId;
    price: Money;
    billingInterval: BillingInterval;
    paymentProvider: string;
  }): Subscription {
    const now = new Date();
    return new Subscription({
      id: params.id,
      websiteId: params.websiteId,
      kind: params.kind ?? "HOSTING",
      planId: params.planId,
      status: "INCOMPLETE",
      price: params.price,
      billingInterval: params.billingInterval,
      startDate: null,
      nextBillingDate: null,
      trialEnd: null,
      gracePeriodEndsAt: null,
      cancellationDate: null,
      paymentProvider: params.paymentProvider,
      externalSubscriptionId: null,
      createdAt: now,
      updatedAt: now,
    });
  }

  static hydrate(props: SubscriptionProps): Subscription {
    return new Subscription(props);
  }

  private transitionTo(next: SubscriptionStatus): void {
    subscriptionStateMachine.assertCanTransition(this.props.status, next);
    this.props.status = next;
    this.props.updatedAt = new Date();
  }

  attachExternalSubscription(externalSubscriptionId: string): void {
    this.props.externalSubscriptionId = externalSubscriptionId;
  }

  /** First successful payment — moves INCOMPLETE/TRIALING straight to ACTIVE. */
  activate(now: Date = new Date()): void {
    this.transitionTo("ACTIVE");
    if (!this.props.startDate) this.props.startDate = now;
    this.props.nextBillingDate = addInterval(now, this.props.billingInterval);
    this.props.gracePeriodEndsAt = null;
  }

  /** Renewal payment succeeded — extends nextBillingDate without changing status if already ACTIVE. */
  renew(now: Date = new Date()): void {
    if (this.props.status !== "ACTIVE") {
      this.activate(now);
      return;
    }
    this.props.nextBillingDate = addInterval(now, this.props.billingInterval);
    this.props.updatedAt = new Date();
  }

  markPastDue(): void {
    this.transitionTo("PAST_DUE");
  }

  enterGracePeriod(now: Date = new Date()): void {
    this.transitionTo("GRACE_PERIOD");
    const endsAt = new Date(now);
    endsAt.setDate(endsAt.getDate() + GRACE_PERIOD_DAYS);
    this.props.gracePeriodEndsAt = endsAt;
  }

  suspend(): void {
    this.transitionTo("SUSPENDED");
  }

  pause(): void {
    this.transitionTo("PAUSED");
  }

  cancel(now: Date = new Date()): void {
    this.transitionTo("CANCELED");
    this.props.cancellationDate = now;
  }

  markExpired(): void {
    this.transitionTo("EXPIRED");
  }

  isPastDueBeyondGracePeriod(now: Date = new Date()): boolean {
    return this.props.status === "GRACE_PERIOD" && !!this.props.gracePeriodEndsAt && now > this.props.gracePeriodEndsAt;
  }

  get id() { return this.props.id; }
  get websiteId() { return this.props.websiteId; }
  get kind() { return this.props.kind; }
  get planId() { return this.props.planId; }
  get status() { return this.props.status; }
  get price() { return this.props.price; }
  get billingInterval() { return this.props.billingInterval; }
  get startDate() { return this.props.startDate; }
  get nextBillingDate() { return this.props.nextBillingDate; }
  get gracePeriodEndsAt() { return this.props.gracePeriodEndsAt; }
  get cancellationDate() { return this.props.cancellationDate; }
  get paymentProvider() { return this.props.paymentProvider; }
  get externalSubscriptionId() { return this.props.externalSubscriptionId; }
  get createdAt() { return this.props.createdAt; }
  get updatedAt() { return this.props.updatedAt; }
}
