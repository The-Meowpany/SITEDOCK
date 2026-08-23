import { randomUUID } from "node:crypto";
import { NotFoundError, Money, WebsiteId, WorkspaceId } from "@sitedock/shared";
import { PaymentProvider } from "../domain/payment";
import { ProjectCharge } from "../domain/project-charge.entity";
import { ProjectChargeRepository } from "../domain/ports";

export interface CreateProjectChargeCommand {
  workspaceId: string;
  websiteId: string;
  title: string;
  priceDecimal: string;
  currency: string;
  successUrl: string;
  cancelUrl: string;
}

/**
 * One-time charge for project work (creation, initial deploy, a big redesign)
 * — the counterpart of the recurring maintenance tiers. Creates a PENDING
 * charge and its checkout session; PAID is only ever set by the verified
 * charge.succeeded webhook (ProcessPaymentWebhookUseCase), never here.
 */
export class CreateProjectChargeUseCase {
  constructor(
    private readonly charges: ProjectChargeRepository,
    private readonly provider: PaymentProvider
  ) {}

  async execute(command: CreateProjectChargeCommand): Promise<{ chargeId: string; checkoutUrl: string }> {
    const charge = ProjectCharge.create({
      id: randomUUID(),
      workspaceId: command.workspaceId,
      websiteId: command.websiteId,
      title: command.title,
      amount: Money.fromDecimalString(command.priceDecimal, command.currency),
      provider: this.provider.name,
    });

    const session = await this.provider.createOneTimeCheckout({
      chargeId: charge.id,
      description: charge.title,
      amount: charge.amount,
      successUrl: command.successUrl,
      cancelUrl: command.cancelUrl,
    });
    charge.attachCheckout(session.id);

    await this.charges.save(charge);
    return { chargeId: charge.id, checkoutUrl: session.url };
  }
}

export class ListProjectChargesUseCase {
  constructor(private readonly charges: ProjectChargeRepository) {}

  async execute(websiteId: string) {
    const list = await this.charges.listByWebsite(WebsiteId(websiteId));
    return list.map((c) => ({
      id: c.id,
      title: c.title,
      status: c.status,
      amountDecimal: c.amount.toDecimalString(),
      currency: c.amount.currency,
      paidAt: c.paidAt,
      createdAt: c.createdAt,
    }));
  }
}

export class CancelProjectChargeUseCase {
  constructor(private readonly charges: ProjectChargeRepository) {}

  async execute(params: { chargeId: string; workspaceId: string }): Promise<void> {
    const charge = await this.charges.findByIdInWorkspace(params.chargeId, WorkspaceId(params.workspaceId));
    if (!charge) throw new NotFoundError("ProjectCharge", params.chargeId);
    charge.cancel();
    await this.charges.save(charge);
  }
}
