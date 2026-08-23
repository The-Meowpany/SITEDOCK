import { prisma } from "@sitedock/database";
import { WebsiteId } from "@sitedock/shared";
import { WebsiteBackup } from "../domain/backup.entity";
import { BackupRowSnapshot, WebsiteBackupRepository } from "../domain/ports";

type BackupRow = {
  id: string;
  websiteId: string;
  sourceDeploymentId: string;
  status: string;
  storagePath: string;
  integritySha256: string | null;
  sizeBytes: bigint | null;
  createdAt: Date;
  expiresAt: Date;
};

function toDomain(row: BackupRow): WebsiteBackup {
  return WebsiteBackup.hydrate({
    id: row.id,
    websiteId: row.websiteId,
    sourceDeploymentId: row.sourceDeploymentId,
    status: row.status as WebsiteBackup["status"],
    storagePath: row.storagePath,
    sizeBytes: row.sizeBytes === null ? null : Number(row.sizeBytes),

    integritySha256: row.integritySha256,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
  });
}

export class PrismaWebsiteBackupRepository implements WebsiteBackupRepository {
  async findById(id: string): Promise<WebsiteBackup | null> {
    const row = await prisma.websiteBackup.findUnique({ where: { id } });
    return row ? toDomain(row) : null;
  }

  async findByIdForWebsite(id: string, websiteId: WebsiteId): Promise<WebsiteBackup | null> {
    const row = await prisma.websiteBackup.findFirst({ where: { id, websiteId } });
    return row ? toDomain(row) : null;
  }

  async existsForSource(websiteId: WebsiteId, sourceDeploymentId: string): Promise<boolean> {
    const row = await prisma.websiteBackup.findFirst({
      where: { websiteId, sourceDeploymentId },
      select: { id: true },
    });
    return row !== null;
  }

  async listByWebsite(websiteId: WebsiteId): Promise<WebsiteBackup[]> {
    const rows = await prisma.websiteBackup.findMany({
      where: { websiteId },
      orderBy: { createdAt: "desc" },
    });
    return rows.map((row: BackupRow) => toDomain(row));
  }

  async listExpired(before: Date): Promise<BackupRowSnapshot[]> {
    const rows = await prisma.websiteBackup.findMany({
      where: { expiresAt: { lte: before } },
      select: { id: true, websiteId: true, sourceDeploymentId: true },
    });
    return rows.map((r) => ({ backupId: r.id, websiteId: r.websiteId, sourceDeploymentId: r.sourceDeploymentId }));
  }

  async save(backup: WebsiteBackup): Promise<void> {
    await prisma.websiteBackup.upsert({
      where: { id: backup.id },
      create: {
        id: backup.id,
        websiteId: backup.websiteId,
        sourceDeploymentId: backup.sourceDeploymentId,
        status: backup.status,
        storagePath: backup.storagePath,
        integritySha256: backup.integritySha256,
        sizeBytes: backup.sizeBytes,
        expiresAt: backup.expiresAt,
      },
      update: {
        status: backup.status,
        sizeBytes: backup.sizeBytes,
      },
    });
  }

  async delete(backupId: string): Promise<void> {
    await prisma.websiteBackup.delete({ where: { id: backupId } });
  }
}



