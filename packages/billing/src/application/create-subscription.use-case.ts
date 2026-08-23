import { randomUUID } from "node:crypto";
import { ConflictError, NotFoundError, ServicePlanId, SubscriptionId, WebsiteId, WorkspaceId } from "@sitedock/shared";
import { Subscription } from "../domain/subscription.entity";
import { ServicePlanRepository, SubscriptionRepository } from "../domain/ports";

export interface CreateSubscriptionCommand {
  workspaceId: string;
  websiteId: string;
  planId: string;
  paymentProvider: string;
}

/**
 * Creates an INCOMPLETE subscription for a website — the "checkout" step
 * before any payment has actually succeeded.
 *
 * A website holds at most one subscription PER KIND (unique (websiteId, kind)):
 * one HOSTING + optionally one MAINTENANCE membership. Attaching a second
 * active subscription of the same kind is a conflict — switching tiers later
 * goes through ChangeSubscriptionPlanUseCase, not by creating another row.
 */
export class CreateSubscriptionUseCase {
  constructor(
    private readonly subscriptions: SubscriptionRepository,
    private readonly plans: ServicePlanRepository
  ) {}

  async execute(command: CreateSubscriptionCommand): Promise<{ subscriptionId: string; kind: "HOSTING" | "MAINTENANCE" }> {
    const workspaceId = WorkspaceId(command.workspaceId);
    const websiteId = WebsiteId(command.websiteId);

    const plan = await this.plans.findByIdInWorkspace(ServicePlanId(command.planId), workspaceId);
    if (!plan) throw new NotFoundError("ServicePlan", command.planId);
    if (!plan.active) throw new ConflictError("This plan is no longer available");

    const existing = await this.subscriptions.findByWebsiteIdAndKind(websiteId, plan.kind);
    if (existing && existing.status !== "CANCELED" && existing.status !== "EXPIRED") {
      throw new ConflictError(
        plan.kind === "MAINTENANCE"
          ? "This website already has a maintenance membership"
          : "This website already has an active or pending hosting subscription"
      );
    }

    const subscription = Subscription.create({
      id: SubscriptionId(randomUUID()),
      websiteId,
      kind: plan.kind,
      planId: plan.id,
      price: plan.price,
      billingInterval: plan.billingInterval,
      paymentProvider: command.paymentProvider,
    });

    await this.subscriptions.save(subscription);
    return { subscriptionId: subscription.id, kind: subscription.kind };
  }
}
