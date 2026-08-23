import { prisma } from "@sitedock/database";
import { WebsiteId } from "@sitedock/shared";
import { Deployment } from "../domain/deployment.entity";
import { DeploymentRepository } from "../domain/ports";

type DeploymentRow = {
  id: string;
  websiteId: string;
  version: number;
  status: string;
  storagePath: string;
  fileCount: number | null;
  sizeBytes: bigint | null;
  errorMessage: string | null;
  uploadedById: string;
  createdAt: Date;
  publishedAt: Date | null;
};

function toDomain(row: DeploymentRow): Deployment {
  return Deployment.hydrate({
    id: row.id,
    websiteId: WebsiteId(row.websiteId),
    version: row.version,
    status: row.status as Deployment["status"],
    storagePath: row.storagePath,
    fileCount: row.fileCount,
    sizeBytes: row.sizeBytes !== null ? Number(row.sizeBytes) : null,
    errorMessage: row.errorMessage,
    uploadedById: row.uploadedById,
    createdAt: row.createdAt,
    publishedAt: row.publishedAt,
  });
}

export class PrismaDeploymentRepository implements DeploymentRepository {
  async findById(id: string): Promise<Deployment | null> {
    const row = await prisma.deployment.findUnique({ where: { id } });
    return row ? toDomain(row) : null;
  }

  async findByIdForWebsite(id: string, websiteId: WebsiteId): Promise<Deployment | null> {
    const row = await prisma.deployment.findFirst({ where: { id, websiteId } });
    return row ? toDomain(row) : null;
  }

  async listByWebsite(websiteId: WebsiteId): Promise<Deployment[]> {
    const rows = await prisma.deployment.findMany({ where: { websiteId }, orderBy: { version: "desc" } });
    return rows.map(toDomain);
  }

  async getNextVersion(websiteId: WebsiteId): Promise<number> {
    const latest = await prisma.deployment.findFirst({ where: { websiteId }, orderBy: { version: "desc" } });
    return (latest?.version ?? 0) + 1;
  }

  async save(deployment: Deployment): Promise<void> {
    await prisma.deployment.upsert({
      where: { id: deployment.id },
      create: {
        id: deployment.id,
        websiteId: deployment.websiteId,
        version: deployment.version,
        status: deployment.status,
        storagePath: deployment.storagePath,
        fileCount: deployment.fileCount,
        sizeBytes: deployment.sizeBytes !== null ? BigInt(deployment.sizeBytes) : null,
        errorMessage: deployment.errorMessage,
        uploadedById: deployment.uploadedById,
        publishedAt: deployment.publishedAt,
      },
      update: {
        status: deployment.status,
        fileCount: deployment.fileCount,
        sizeBytes: deployment.sizeBytes !== null ? BigInt(deployment.sizeBytes) : null,
        errorMessage: deployment.errorMessage,
        publishedAt: deployment.publishedAt,
      },
    });
  }
}
