import { DomainError, Money, ServicePlanId, WorkspaceId } from "@sitedock/shared";

export type BillingInterval = "MONTHLY" | "YEARLY";

/**
 * Two product lines share the plan/subscription machinery:
 * - HOSTING: infrastructure for one website.
 * - MAINTENANCE: the recurring membership that covers modifications — the
 *   "tiers" (Basic/Pro/Premium) a freelancer offers. A website holds at most
 *   one subscription of each kind.
 */
export type PlanKind = "HOSTING" | "MAINTENANCE";

export interface PlanFeatures {
  storageMb?: number;
  bandwidthMb?: number;
  maxDeployments?: number;
  backups?: boolean;
  customDomain?: boolean;
  ssl?: boolean;
  analytics?: boolean;
  support?: "email" | "priority" | "none";
  // Freeform extension point — plans are workspace-defined, so unknown keys are legal.
  [key: string]: unknown;
}

export interface ServicePlanProps {
  id: ServicePlanId;
  workspaceId: WorkspaceId;
  name: string;
  kind: PlanKind;
  price: Money;
  billingInterval: BillingInterval;
  /**
   * MAINTENANCE only: modification requests included per billing period.
   * NULL = unlimited. Must be NULL for HOSTING plans (invariant enforced here).
   */
  includedRequestQuota: number | null;
  features: PlanFeatures;
  active: boolean;
  createdAt: Date;
}

/**
 * ServicePlan aggregate. Plans are freeform and workspace-defined
 * (docs/ARCHITECTURE.md §7 "Service Plans") — never hardcoded tiers. Price is
 * captured as a Money value object, never a raw number.
 */
export class ServicePlan {
  private constructor(private props: ServicePlanProps) {}

  static create(params: {
    id: ServicePlanId;
    workspaceId: WorkspaceId;
    name: string;
    kind?: PlanKind;
    price: Money;
    billingInterval: BillingInterval;
    includedRequestQuota?: number | null;
    features?: PlanFeatures;
  }): ServicePlan {
    if (params.name.trim().length < 2) {
      throw new DomainError("Plan name must have at least 2 characters", "INVALID_PLAN_NAME");
    }
    if (params.price.amountCents <= 0) {
      throw new DomainError("Plan price must be greater than zero", "INVALID_PLAN_PRICE");
    }

    const kind = params.kind ?? "HOSTING";
    const quota = params.includedRequestQuota ?? null;

    if (quota !== null) {
      if (!Number.isInteger(quota) || quota < 0) {
        throw new DomainError("includedRequestQuota must be a non-negative integer", "INVALID_REQUEST_QUOTA");
      }
      // A quota on a hosting plan is meaningless — it would silently imply
      // maintenance coverage that the kind doesn't represent.
      if (kind !== "MAINTENANCE") {
        throw new DomainError(
          "Only MAINTENANCE plans can define an included request quota",
          "QUOTA_REQUIRES_MAINTENANCE_KIND"
        );
      }
    }

    return new ServicePlan({
      id: params.id,
      workspaceId: params.workspaceId,
      name: params.name.trim(),
      kind,
      price: params.price,
      billingInterval: params.billingInterval,
      includedRequestQuota: quota,
      features: params.features ?? {},
      active: true,
      createdAt: new Date(),
    });
  }

  static hydrate(props: ServicePlanProps): ServicePlan {
    return new ServicePlan(props);
  }

  deactivate(): void {
    this.props.active = false;
  }

  reactivate(): void {
    this.props.active = true;
  }

  get id() { return this.props.id; }
  get workspaceId() { return this.props.workspaceId; }
  get name() { return this.props.name; }
  get kind() { return this.props.kind; }
  get price() { return this.props.price; }
  get billingInterval() { return this.props.billingInterval; }
  get includedRequestQuota() { return this.props.includedRequestQuota; }
  get features() { return this.props.features; }
  get active() { return this.props.active; }
  get createdAt() { return this.props.createdAt; }
}
