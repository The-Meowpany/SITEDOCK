import { prisma, Prisma } from "@sitedock/database";
import { Money, ServicePlanId, WorkspaceId } from "@sitedock/shared";
import { ServicePlan } from "../domain/service-plan.entity";
import { ServicePlanRepository } from "../domain/ports";

type PlanRow = {
  id: string;
  workspaceId: string;
  name: string;
  kind: string;
  priceCents: number;
  currency: string;
  billingInterval: string;
  includedRequestQuota: number | null;
  features: unknown;
  active: boolean;
  createdAt: Date;
};

function toDomain(row: PlanRow): ServicePlan {
  return ServicePlan.hydrate({
    id: ServicePlanId(row.id),
    workspaceId: WorkspaceId(row.workspaceId),
    name: row.name,
    kind: row.kind as ServicePlan["kind"],
    price: Money.fromCents(row.priceCents, row.currency),
    billingInterval: row.billingInterval as ServicePlan["billingInterval"],
    includedRequestQuota: row.includedRequestQuota,
    features: (row.features as ServicePlan["features"]) ?? {},
    active: row.active,
    createdAt: row.createdAt,
  });
}

export class PrismaServicePlanRepository implements ServicePlanRepository {
  async findByIdInWorkspace(id: ServicePlanId, workspaceId: WorkspaceId): Promise<ServicePlan | null> {
    const row = await prisma.servicePlan.findFirst({ where: { id, workspaceId } });
    return row ? toDomain(row) : null;
  }

  async listByWorkspace(workspaceId: WorkspaceId): Promise<ServicePlan[]> {
    const rows = await prisma.servicePlan.findMany({ where: { workspaceId }, orderBy: { createdAt: "asc" } });
    return rows.map(toDomain);
  }

  async save(plan: ServicePlan): Promise<void> {
    await prisma.servicePlan.upsert({
      where: { id: plan.id },
      create: {
        id: plan.id,
        workspaceId: plan.workspaceId,
        name: plan.name,
        kind: plan.kind,
        priceCents: plan.price.amountCents,
        currency: plan.price.currency,
        billingInterval: plan.billingInterval,
        includedRequestQuota: plan.kind === "MAINTENANCE" ? plan.includedRequestQuota : null,
        features: plan.features as unknown as Prisma.InputJsonValue,
        active: plan.active,
      },
      update: {
        name: plan.name,
        active: plan.active,
        features: plan.features as unknown as Prisma.InputJsonValue,
      },
    });
  }
}


