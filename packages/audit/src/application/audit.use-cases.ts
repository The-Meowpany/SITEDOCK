import { randomUUID } from "node:crypto";
import { AuditAction } from "../domain/audit-action";
import { AuditEntry } from "../domain/audit-entry.entity";
import { AuditLogListOptions, AuditLogRepository } from "../domain/ports";

export interface RecordAuditEntryCommand {
  workspaceId?: string | null;
  actorId?: string | null;
  action: AuditAction;
  resourceType: string;
  resourceId?: string | null;
  metadata?: Record<string, unknown> | null;
}

/**
 * The single write path for the audit trail (docs/ARCHITECTURE.md §37). Other
 * bounded contexts never write to AuditLog directly — the interfaces layer
 * (apps/api) calls this use case alongside the actual operation, the same
 * pattern already used for NotificationService, keeping AUDIT a genuinely
 * separate bounded context rather than a table every domain reaches into.
 */
export class RecordAuditEntryUseCase {
  constructor(private readonly audit: AuditLogRepository) {}

  async execute(command: RecordAuditEntryCommand): Promise<void> {
    const entry = AuditEntry.create({
      id: randomUUID(),
      workspaceId: command.workspaceId ?? null,
      actorId: command.actorId ?? null,
      action: command.action,
      resourceType: command.resourceType,
      resourceId: command.resourceId,
      metadata: command.metadata,
    });
    await this.audit.record(entry);
  }
}

export class ListWorkspaceAuditLogUseCase {
  constructor(private readonly audit: AuditLogRepository) {}

  async execute(workspaceId: string, options?: AuditLogListOptions) {
    const entries = await this.audit.listByWorkspace(workspaceId, options);
    return entries.map(toDto);
  }
}

export class ListPlatformAuditLogUseCase {
  constructor(private readonly audit: AuditLogRepository) {}

  async execute(options?: AuditLogListOptions) {
    const entries = await this.audit.listAll(options);
    return entries.map(toDto);
  }
}

function toDto(entry: AuditEntry) {
  return {
    id: entry.id,
    workspaceId: entry.workspaceId,
    actorId: entry.actorId,
    action: entry.action,
    resourceType: entry.resourceType,
    resourceId: entry.resourceId,
    metadata: entry.metadata,
    createdAt: entry.createdAt,
  };
}
