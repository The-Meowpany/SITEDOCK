import { describe, expect, it } from "vitest";
import { Money, ServicePlanId, SubscriptionId, WebsiteId, WorkspaceId } from "@sitedock/shared";
import { ServicePlan } from "../domain/service-plan.entity";
import { Subscription } from "../domain/subscription.entity";

const WS = WorkspaceId("11111111-1111-1111-1111-111111111111");
const SITE = WebsiteId("22222222-2222-2222-2222-222222222222");

function plan(kind: "HOSTING" | "MAINTENANCE", quota?: number | null) {
  return ServicePlan.create({
    id: ServicePlanId("33333333-3333-3333-3333-333333333333"),
    workspaceId: WS,
    name: kind === "MAINTENANCE" ? "Pro" : "Hosting",
    kind,
    price: Money.fromCents(2900, "USD"),
    billingInterval: "MONTHLY",
    includedRequestQuota: quota ?? null,
  });
}

function subscriptionFor(kind: "HOSTING" | "MAINTENANCE") {
  return Subscription.create({
    id: SubscriptionId("44444444-4444-4444-4444-444444444444"),
    websiteId: SITE,
    kind,
    planId: plan(kind).id,
    price: Money.fromCents(2900, "USD"),
    billingInterval: "MONTHLY",
    paymentProvider: "mock",
  });
}

describe("Maintenance tiers (PlanKind)", () => {
  it("defaults plans to HOSTING kind with no quota", () => {
    const p = ServicePlan.create({
      id: ServicePlanId("33333333-3333-3333-3333-333333333331"),
      workspaceId: WS,
      name: "Legacy plan",
      price: Money.fromCents(1000, "USD"),
      billingInterval: "MONTHLY",
    });
    expect(p.kind).toBe("HOSTING");
    expect(p.includedRequestQuota).toBeNull();
  });

  it("accepts a MAINTENANCE tier with an explicit request quota", () => {
    const pro = plan("MAINTENANCE", 6);
    expect(pro.kind).toBe("MAINTENANCE");
    expect(pro.includedRequestQuota).toBe(6);
  });

  it("accepts NULL quota as unlimited for maintenance tiers", () => {
    const premium = plan("MAINTENANCE", null);
    expect(premium.includedRequestQuota).toBeNull();
  });

  it("rejects a request quota on a HOSTING plan (invariant)", () => {
    expect(() => plan("HOSTING", 4)).toThrow(/Only MAINTENANCE plans/i);
  });

  it("rejects negative or non-integer quotas", () => {
    expect(() => plan("MAINTENANCE", -1)).toThrow(/non-negative integer/i);
    expect(() => plan("MAINTENANCE", 2.5)).toThrow(/non-negative integer/i);
  });
});

describe("Subscription kinds", () => {
  it("carries the denormalized kind from its plan", () => {
    expect(subscriptionFor("HOSTING").kind).toBe("HOSTING");
    expect(subscriptionFor("MAINTENANCE").kind).toBe("MAINTENANCE");
  });

  it("keeps lifecycle behavior identical across kinds — tiers are commercial, not structural", () => {
    const membership = subscriptionFor("MAINTENANCE");
    membership.activate();
    expect(membership.status).toBe("ACTIVE");
    expect(membership.nextBillingDate).not.toBeNull();

    membership.markPastDue();
    membership.enterGracePeriod(new Date("2026-01-01T00:00:00Z"));
    membership.suspend();
    expect(membership.status).toBe("SUSPENDED");
  });
});
