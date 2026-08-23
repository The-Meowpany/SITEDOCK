import { randomUUID } from "node:crypto";
import { DomainError, Money, NotFoundError, ServicePlanId, WorkspaceId } from "@sitedock/shared";
import { BillingInterval, PlanFeatures, PlanKind, ServicePlan } from "../domain/service-plan.entity";
import { ServicePlanRepository } from "../domain/ports";

export interface CreateServicePlanCommand {
  workspaceId: string;
  name: string;
  /** HOSTING (default) or MAINTENANCE — the maintenance "tiers" a freelancer offers. */
  kind?: PlanKind;
  priceDecimal: string; // e.g. "29.00" — never accept a raw float from the API boundary
  currency: string;
  billingInterval: BillingInterval;
  /** MAINTENANCE only: requests included per billing period. Omitted/NULL = unlimited. */
  includedRequestQuota?: number | null;
  features?: PlanFeatures;
}

export class CreateServicePlanUseCase {
  constructor(private readonly plans: ServicePlanRepository) {}

  async execute(command: CreateServicePlanCommand): Promise<{ planId: string }> {
    const plan = ServicePlan.create({
      id: ServicePlanId(randomUUID()),
      workspaceId: WorkspaceId(command.workspaceId),
      name: command.name,
      kind: command.kind,
      price: Money.fromDecimalString(command.priceDecimal, command.currency),
      billingInterval: command.billingInterval,
      includedRequestQuota: command.includedRequestQuota ?? null,
      features: command.features,
    });

    await this.plans.save(plan);
    return { planId: plan.id };
  }
}

export interface UpdateServicePlanCommand {
  workspaceId: string;
  planId: string;
  name?: string;
  priceDecimal?: string;
  currency?: string;
  billingInterval?: BillingInterval;
  includedRequestQuota?: number | null;
  features?: PlanFeatures;
  active?: boolean;
}

/**
 * Edits a freelancer-defined tier (rename, reprice, resize its request quota,
 * activate/deactivate). Tiers are NOT platform presets — every field here is
 * freelancer-owned.
 *
 * Pricing semantics: an edited price applies to FUTURE subscriptions only.
 * Existing ones captured their price at subscribe time and are never
 * retro-billed differently (docs/ARCHITECTURE.md "Money" notes).
 */
export class UpdateServicePlanUseCase {
  constructor(private readonly plans: ServicePlanRepository) {}

  async execute(command: UpdateServicePlanCommand): Promise<{ planId: string }> {
    const plan = await this.plans.findByIdInWorkspace(
      ServicePlanId(command.planId),
      WorkspaceId(command.workspaceId)
    );
    if (!plan) throw new NotFoundError("ServicePlan", command.planId);

    if (command.name !== undefined && command.name.trim().length < 2) {
      throw new DomainError("Plan name must have at least 2 characters", "INVALID_PLAN_NAME");
    }

    let newPrice = plan.price;
    if (command.priceDecimal !== undefined || command.currency !== undefined) {
      const decimal = command.priceDecimal ?? plan.price.toDecimalString();
      const currency = command.currency ?? plan.price.currency;
      if (!/^\d+(\.\d{1,2})?$/.test(decimal)) {
        throw new DomainError(`Invalid decimal amount: "${decimal}"`, "INVALID_PLAN_PRICE");
      }
      newPrice = Money.fromDecimalString(decimal, currency);
      if (newPrice.amountCents <= 0) {
        throw new DomainError("Plan price must be greater than zero", "INVALID_PLAN_PRICE");
      }
    }

    // Quota rules mirror ServicePlan.create()'s invariants for the plan's kind.
    let newQuota = plan.includedRequestQuota;
    if (command.includedRequestQuota !== undefined) {
      const quota = command.includedRequestQuota;
      if (quota !== null && (!Number.isInteger(quota) || quota < 0)) {
        throw new DomainError("includedRequestQuota must be a non-negative integer", "INVALID_REQUEST_QUOTA");
      }
      if (quota !== null && plan.kind !== "MAINTENANCE") {
        throw new DomainError(
          "Only MAINTENANCE plans can define an included request quota",
          "QUOTA_REQUIRES_MAINTENANCE_KIND"
        );
      }
      newQuota = quota;
    }

    const updated = ServicePlan.hydrate({
      id: plan.id,
      workspaceId: plan.workspaceId,
      name: command.name?.trim() ?? plan.name,
      kind: plan.kind, // kind is immutable once defined — switching product lines means creating a new plan
      price: newPrice,
      billingInterval: command.billingInterval ?? plan.billingInterval,
      includedRequestQuota: newQuota,
      features: command.features ?? plan.features,
      active: command.active ?? plan.active,
      createdAt: plan.createdAt,
    });

    await this.plans.save(updated);
    return { planId: updated.id };
  }
}

export class ListServicePlansUseCase {
  constructor(private readonly plans: ServicePlanRepository) {}

  async execute(workspaceId: string, kind?: PlanKind) {
    let list = await this.plans.listByWorkspace(WorkspaceId(workspaceId));
    if (kind) list = list.filter((p) => p.kind === kind);
    return list.map((p) => ({
      id: p.id,
      name: p.name,
      kind: p.kind,
      price: p.price.toDecimalString(),
      currency: p.price.currency,
      billingInterval: p.billingInterval,
      includedRequestQuota: p.kind === "MAINTENANCE" ? p.includedRequestQuota : null,
      features: p.features,
      active: p.active,
    }));
  }
}
