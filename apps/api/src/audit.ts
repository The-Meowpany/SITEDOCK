import { PrismaAuditLogRepository, RecordAuditEntryUseCase, RecordAuditEntryCommand } from "@sitedock/audit";
import { logger } from "./logger";

const auditLog = new PrismaAuditLogRepository();
const recordAuditEntry = new RecordAuditEntryUseCase(auditLog);

/**
 * Fire-and-forget audit write, called from the interfaces layer alongside the
 * actual operation (docs/ARCHITECTURE.md §37). Unlike notifications, a failed
 * audit write is a compliance concern, not just a UX nicety — it's logged at
 * error level (not warn) — but it still must never block or fail the request
 * that triggered it, since AuditLog is a separate bounded context and its
 * availability is not a precondition for the core operation to succeed.
 */
export function auditBestEffort(command: RecordAuditEntryCommand) {
  recordAuditEntry.execute(command).catch((err) => {
    logger.error({ err, action: command.action, resourceType: command.resourceType }, "Failed to write audit log entry");
  });
}
