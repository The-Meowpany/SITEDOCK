import { prisma } from "@sitedock/database";
import { Money, WebsiteId, WorkspaceId } from "@sitedock/shared";
import { ProjectCharge } from "../domain/project-charge.entity";
import { ProjectChargeRepository } from "../domain/ports";

type ChargeRow = {
  id: string;
  workspaceId: string;
  websiteId: string;
  title: string;
  amountCents: number;
  currency: string;
  status: string;
  provider: string;
  externalCheckoutId: string | null;
  paidAt: Date | null;
  createdAt: Date;
};

function toDomain(row: ChargeRow): ProjectCharge {
  return ProjectCharge.hydrate({
    id: row.id,
    workspaceId: row.workspaceId,
    websiteId: row.websiteId,
    title: row.title,
    amount: Money.fromCents(row.amountCents, row.currency),
    status: row.status as ProjectCharge["status"],
    provider: row.provider,
    externalCheckoutId: row.externalCheckoutId,
    paidAt: row.paidAt,
    createdAt: row.createdAt,
  });
}

export class PrismaProjectChargeRepository implements ProjectChargeRepository {
  async findById(id: string): Promise<ProjectCharge | null> {
    const row = await prisma.projectCharge.findUnique({ where: { id } });
    return row ? toDomain(row) : null;
  }

  async findByIdInWorkspace(id: string, workspaceId: WorkspaceId): Promise<ProjectCharge | null> {
    const row = await prisma.projectCharge.findFirst({ where: { id, workspaceId } });
    return row ? toDomain(row) : null;
  }

  async findByExternalCheckoutId(provider: string, externalCheckoutId: string): Promise<ProjectCharge | null> {
    const row = await prisma.projectCharge.findFirst({ where: { provider, externalCheckoutId } });
    return row ? toDomain(row) : null;
  }

  async listByWebsite(websiteId: WebsiteId): Promise<ProjectCharge[]> {
    const rows = await prisma.projectCharge.findMany({
      where: { websiteId },
      orderBy: { createdAt: "desc" },
    });
    return rows.map(toDomain);
  }

  async save(charge: ProjectCharge): Promise<void> {
    await prisma.projectCharge.upsert({
      where: { id: charge.id },
      create: {
        id: charge.id,
        workspaceId: charge.workspaceId,
        websiteId: charge.websiteId,
        title: charge.title,
        amountCents: charge.amount.amountCents,
        currency: charge.amount.currency,
        status: charge.status,
        provider: charge.provider,
        externalCheckoutId: charge.externalCheckoutId,
        paidAt: charge.paidAt,
      },
      update: {
        status: charge.status,
        externalCheckoutId: charge.externalCheckoutId,
        paidAt: charge.paidAt,
      },
    });
  }
}
