import { AuditEntry } from "./audit-entry.entity";

export interface AuditLogListOptions {
  limit?: number;
  before?: Date;
}

export interface AuditLogRepository {
  record(entry: AuditEntry): Promise<void>;
  /** Tenant-scoped read — a workspace can only ever see its own audit trail. */
  listByWorkspace(workspaceId: string, options?: AuditLogListOptions): Promise<AuditEntry[]>;
  /** Platform-admin-only read across all tenants — never exposed to a developer/client role. */
  listAll(options?: AuditLogListOptions): Promise<AuditEntry[]>;
}
