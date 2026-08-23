import { describe, expect, it } from "vitest";
import { DomainError, InvalidStateTransitionError, Money, ServicePlanId, SubscriptionId, WebsiteId, WorkspaceId } from "@sitedock/shared";
import { ServicePlan } from "../domain/service-plan.entity";
import { Subscription } from "../domain/subscription.entity";
import { FlatPercentageFeePolicy } from "../domain/revenue-share";

const WORKSPACE = WorkspaceId("11111111-1111-1111-1111-111111111111");
const WEBSITE = WebsiteId("22222222-2222-2222-2222-222222222222");
const PLAN = ServicePlanId("33333333-3333-3333-3333-333333333333");

describe("ServicePlan entity", () => {
  it("creates an active plan with a positive price", () => {
    const plan = ServicePlan.create({
      id: PLAN,
      workspaceId: WORKSPACE,
      name: "Professional",
      price: Money.fromDecimalString("29.00", "USD"),
      billingInterval: "MONTHLY",
    });
    expect(plan.active).toBe(true);
    expect(plan.price.toDecimalString()).toBe("29.00");
  });

  it("rejects a zero or negative price", () => {
    expect(() =>
      ServicePlan.create({
        id: PLAN,
        workspaceId: WORKSPACE,
        name: "Free",
        price: Money.fromDecimalString("0.00", "USD"),
        billingInterval: "MONTHLY",
      })
    ).toThrow(DomainError);
  });

  it("can be deactivated and reactivated", () => {
    const plan = ServicePlan.create({
      id: PLAN,
      workspaceId: WORKSPACE,
      name: "Professional",
      price: Money.fromDecimalString("29.00", "USD"),
      billingInterval: "MONTHLY",
    });
    plan.deactivate();
    expect(plan.active).toBe(false);
    plan.reactivate();
    expect(plan.active).toBe(true);
  });
});

describe("FlatPercentageFeePolicy — revenue share", () => {
  it("computes a 10% platform fee split", () => {
    const policy = new FlatPercentageFeePolicy(10);
    const split = policy.computeSplit(Money.fromDecimalString("29.00", "USD"));
    expect(split.platformFee.toDecimalString()).toBe("2.90");
    expect(split.developerShare.toDecimalString()).toBe("26.10");
  });

  it("supports a different fee percentage per policy instance (not hardcoded 10%)", () => {
    const policy = new FlatPercentageFeePolicy(15);
    const split = policy.computeSplit(Money.fromDecimalString("100.00", "USD"));
    expect(split.platformFee.toDecimalString()).toBe("15.00");
    expect(split.developerShare.toDecimalString()).toBe("85.00");
  });

  it("rejects an invalid percentage", () => {
    expect(() => new FlatPercentageFeePolicy(150)).toThrow(RangeError);
  });
});

function newSubscription() {
  return Subscription.create({
    id: SubscriptionId("44444444-4444-4444-4444-444444444444"),
    websiteId: WEBSITE,
    planId: PLAN,
    price: Money.fromDecimalString("29.00", "USD"),
    billingInterval: "MONTHLY",
    paymentProvider: "mock",
  });
}

describe("Subscription lifecycle", () => {
  it("starts INCOMPLETE with no dates set", () => {
    const sub = newSubscription();
    expect(sub.status).toBe("INCOMPLETE");
    expect(sub.startDate).toBeNull();
    expect(sub.nextBillingDate).toBeNull();
  });

  it("activates on first successful payment and computes nextBillingDate", () => {
    const sub = newSubscription();
    const now = new Date("2026-01-15T00:00:00Z");
    sub.activate(now);
    expect(sub.status).toBe("ACTIVE");
    expect(sub.startDate).toEqual(now);
    expect(sub.nextBillingDate?.toISOString()).toBe("2026-02-15T00:00:00.000Z");
  });

  it("renews by extending nextBillingDate while remaining ACTIVE", () => {
    const sub = newSubscription();
    sub.activate(new Date("2026-01-15T00:00:00Z"));
    sub.renew(new Date("2026-02-15T00:00:00Z"));
    expect(sub.status).toBe("ACTIVE");
    expect(sub.nextBillingDate?.toISOString()).toBe("2026-03-15T00:00:00.000Z");
  });

  it("walks ACTIVE → PAST_DUE → GRACE_PERIOD → SUSPENDED", () => {
    const sub = newSubscription();
    sub.activate();
    sub.markPastDue();
    expect(sub.status).toBe("PAST_DUE");
    sub.enterGracePeriod(new Date("2026-01-01T00:00:00Z"));
    expect(sub.status).toBe("GRACE_PERIOD");
    expect(sub.gracePeriodEndsAt?.toISOString()).toBe("2026-01-08T00:00:00.000Z");
    sub.suspend();
    expect(sub.status).toBe("SUSPENDED");
  });

  it("recovers directly from PAST_DUE to ACTIVE (payment retried successfully)", () => {
    const sub = newSubscription();
    sub.activate();
    sub.markPastDue();
    sub.activate();
    expect(sub.status).toBe("ACTIVE");
  });

  it("recovers from SUSPENDED back to ACTIVE when payment succeeds", () => {
    const sub = newSubscription();
    sub.activate();
    sub.markPastDue();
    sub.enterGracePeriod();
    sub.suspend();
    sub.activate();
    expect(sub.status).toBe("ACTIVE");
  });

  it("detects when grace period has elapsed", () => {
    const sub = newSubscription();
    sub.activate();
    sub.markPastDue();
    sub.enterGracePeriod(new Date("2026-01-01T00:00:00Z"));
    expect(sub.isPastDueBeyondGracePeriod(new Date("2026-01-05T00:00:00Z"))).toBe(false);
    expect(sub.isPastDueBeyondGracePeriod(new Date("2026-01-10T00:00:00Z"))).toBe(true);
  });

  it("cancels and sets a cancellationDate", () => {
    const sub = newSubscription();
    sub.activate();
    const now = new Date("2026-03-01T00:00:00Z");
    sub.cancel(now);
    expect(sub.status).toBe("CANCELED");
    expect(sub.cancellationDate).toEqual(now);
  });

  it("never allows reactivating a CANCELED subscription — it is terminal", () => {
    const sub = newSubscription();
    sub.activate();
    sub.cancel();
    expect(() => sub.activate()).toThrow(InvalidStateTransitionError);
  });

  it("never allows reactivating an EXPIRED trial — it is terminal", () => {
    // simulate a trial that expired without conversion — INCOMPLETE has no TRIALING
    // path exercised here, so go through the domain API directly for a realistic case
    const trialSub = Subscription.hydrate({
      id: SubscriptionId("55555555-5555-5555-5555-555555555555"),
      websiteId: WEBSITE,
      kind: "HOSTING",
      planId: PLAN,
      status: "TRIALING",
      price: Money.fromDecimalString("29.00", "USD"),
      billingInterval: "MONTHLY",
      startDate: null,
      nextBillingDate: null,
      trialEnd: new Date(),
      gracePeriodEndsAt: null,
      cancellationDate: null,
      paymentProvider: "mock",
      externalSubscriptionId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    trialSub.markExpired();
    expect(() => trialSub.activate()).toThrow(InvalidStateTransitionError);
  });
});

