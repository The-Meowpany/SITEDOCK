import { prisma, Prisma } from "@sitedock/database";
import { AuditAction } from "../domain/audit-action";
import { AuditEntry } from "../domain/audit-entry.entity";
import { AuditLogListOptions, AuditLogRepository } from "../domain/ports";

type AuditLogRow = {
  id: string;
  workspaceId: string | null;
  actorId: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  metadata: unknown;
  createdAt: Date;
};

function toDomain(row: AuditLogRow): AuditEntry {
  return AuditEntry.hydrate({
    id: row.id,
    workspaceId: row.workspaceId,
    actorId: row.actorId,
    action: row.action as AuditAction,
    resourceType: row.resourceType,
    resourceId: row.resourceId,
    metadata: (row.metadata as Record<string, unknown> | null) ?? null,
    createdAt: row.createdAt,
  });
}

const DEFAULT_LIMIT = 100;

/**
 * Append-only at the infrastructure level too: this repository intentionally
 * exposes only `create` (via `record`) — there is no `update` or `delete`
 * method anywhere in this class.
 */
export class PrismaAuditLogRepository implements AuditLogRepository {
  async record(entry: AuditEntry): Promise<void> {
    await prisma.auditLog.create({
      data: {
        id: entry.id,
        workspaceId: entry.workspaceId,
        actorId: entry.actorId,
        action: entry.action,
        resourceType: entry.resourceType,
        resourceId: entry.resourceId,
        metadata: entry.metadata as Prisma.InputJsonValue | undefined,
      },
    });
  }

  async listByWorkspace(workspaceId: string, options?: AuditLogListOptions): Promise<AuditEntry[]> {
    const rows = await prisma.auditLog.findMany({
      where: { workspaceId, ...(options?.before ? { createdAt: { lt: options.before } } : {}) },
      orderBy: { createdAt: "desc" },
      take: options?.limit ?? DEFAULT_LIMIT,
    });
    return rows.map(toDomain);
  }

  async listAll(options?: AuditLogListOptions): Promise<AuditEntry[]> {
    const rows = await prisma.auditLog.findMany({
      where: options?.before ? { createdAt: { lt: options.before } } : undefined,
      orderBy: { createdAt: "desc" },
      take: options?.limit ?? DEFAULT_LIMIT,
    });
    return rows.map(toDomain);
  }
}

