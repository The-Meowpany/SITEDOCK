import { prisma } from "@sitedock/database";
import { Money, WebsiteId } from "@sitedock/shared";
import { MaintenanceRequest } from "../domain/maintenance-request.entity";
import { MaintenanceComment, MaintenanceCommentRepository, MaintenanceRequestRepository } from "../domain/ports";

type RequestRow = {
  id: string;
  websiteId: string;
  title: string;
  description: string;
  status: string;
  priceCents: number | null;
  createdAt: Date;
  updatedAt: Date;
};

function toDomain(row: RequestRow): MaintenanceRequest {
  return MaintenanceRequest.hydrate({
    id: row.id,
    websiteId: WebsiteId(row.websiteId),
    title: row.title,
    description: row.description,
    status: row.status as MaintenanceRequest["status"],
    price: row.priceCents !== null ? Money.fromCents(row.priceCents, "USD") : null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

export class PrismaMaintenanceRequestRepository implements MaintenanceRequestRepository {
  async findByIdForWebsite(id: string, websiteId: WebsiteId): Promise<MaintenanceRequest | null> {
    const row = await prisma.maintenanceRequest.findFirst({ where: { id, websiteId } });
    return row ? toDomain(row) : null;
  }

  async listByWebsite(websiteId: WebsiteId): Promise<MaintenanceRequest[]> {
    const rows = await prisma.maintenanceRequest.findMany({ where: { websiteId }, orderBy: { createdAt: "desc" } });
    return rows.map(toDomain);
  }

  async countCreatedBetween(websiteId: WebsiteId, from: Date, to: Date): Promise<number> {
    return prisma.maintenanceRequest.count({
      where: { websiteId, createdAt: { gte: from, lt: to } },
    });
  }

  async save(request: MaintenanceRequest): Promise<void> {
    await prisma.maintenanceRequest.upsert({
      where: { id: request.id },
      create: {
        id: request.id,
        websiteId: request.websiteId,
        title: request.title,
        description: request.description,
        status: request.status,
        priceCents: request.price?.amountCents ?? null,
      },
      update: {
        status: request.status,
        priceCents: request.price?.amountCents ?? null,
      },
    });
  }
}

export class PrismaMaintenanceCommentRepository implements MaintenanceCommentRepository {
  async listByRequest(requestId: string): Promise<MaintenanceComment[]> {
    const rows = await prisma.maintenanceComment.findMany({
      where: { maintenanceRequestId: requestId },
      orderBy: { createdAt: "asc" },
    });
    return rows.map((row: { id: string; maintenanceRequestId: string; authorId: string; body: string; createdAt: Date }) =>
      MaintenanceComment.hydrate({
        id: row.id,
        maintenanceRequestId: row.maintenanceRequestId,
        authorId: row.authorId,
        body: row.body,
        createdAt: row.createdAt,
      })
    );
  }

  async save(comment: MaintenanceComment): Promise<void> {
    await prisma.maintenanceComment.create({
      data: {
        id: comment.id,
        maintenanceRequestId: comment.maintenanceRequestId,
        authorId: comment.authorId,
        body: comment.body,
      },
    });
  }
}
