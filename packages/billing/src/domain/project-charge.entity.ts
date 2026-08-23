import { DomainError, Money } from "@sitedock/shared";

export type ProjectChargeStatus = "PENDING" | "PAID" | "CANCELED";

export interface ProjectChargeProps {
  id: string;
  workspaceId: string;
  websiteId: string;
  title: string;
  amount: Money;
  status: ProjectChargeStatus;
  provider: string;
  /** The checkout reference the provider echoes back on its webhook. */
  externalCheckoutId: string | null;
  paidAt: Date | null;
  createdAt: Date;
}

/**
 * One-time commercial charge — the "creation/initial-deploy fee" that is
 * deliberately separate from the recurring maintenance membership.
 *
 * Invariant: PAID is only ever reached through `markPaidFromWebhook()` after a
 * signature-verified provider event; nobody flips status directly.
 */
export class ProjectCharge {
  private constructor(private props: ProjectChargeProps) {}

  static create(params: {
    id: string;
    workspaceId: string;
    websiteId: string;
    title: string;
    amount: Money;
    provider: string;
  }): ProjectCharge {
    if (params.title.trim().length < 3) {
      throw new DomainError("Charge title must have at least 3 characters", "INVALID_CHARGE_TITLE");
    }
    if (params.amount.amountCents <= 0) {
      throw new DomainError("Charge amount must be greater than zero", "INVALID_CHARGE_AMOUNT");
    }
    return new ProjectCharge({
      id: params.id,
      workspaceId: params.workspaceId,
      websiteId: params.websiteId,
      title: params.title.trim(),
      amount: params.amount,
      status: "PENDING",
      provider: params.provider,
      externalCheckoutId: null,
      paidAt: null,
      createdAt: new Date(),
    });
  }

  static hydrate(props: ProjectChargeProps): ProjectCharge {
    return new ProjectCharge(props);
  }

  attachCheckout(externalCheckoutId: string): void {
    this.props.externalCheckoutId = externalCheckoutId;
  }

  markPaidFromWebhook(): void {
    if (this.props.status === "PAID") {
      throw new DomainError("Charge is already paid", "CHARGE_ALREADY_PAID");
    }
    this.props.status = "PAID";
    this.props.paidAt = new Date();
  }

  cancel(): void {
    if (this.props.status === "PAID") {
      throw new DomainError("A paid charge cannot be canceled", "CHARGE_ALREADY_PAID");
    }
    this.props.status = "CANCELED";
  }

  get id() { return this.props.id; }
  get workspaceId() { return this.props.workspaceId; }
  get websiteId() { return this.props.websiteId; }
  get title() { return this.props.title; }
  get amount() { return this.props.amount; }
  get status() { return this.props.status; }
  get provider() { return this.props.provider; }
  get externalCheckoutId() { return this.props.externalCheckoutId; }
  get paidAt() { return this.props.paidAt; }
  get createdAt() { return this.props.createdAt; }
}
