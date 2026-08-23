import { Router } from "express";
import { z } from "zod";
import { ListWorkspaceAuditLogUseCase, PrismaAuditLogRepository } from "@sitedock/audit";
import { AssertWorkspaceAccessUseCase, PrismaWorkspaceRepository } from "@sitedock/workspace";
import { requireSession } from "../middleware/require-session";

const auditLog = new PrismaAuditLogRepository();
const workspaces = new PrismaWorkspaceRepository();
const assertWorkspaceAccess = new AssertWorkspaceAccessUseCase(workspaces);
const listWorkspaceAuditLog = new ListWorkspaceAuditLogUseCase(auditLog);

type WorkspaceParams = { workspaceId: string };

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

// Mounted at /api/v1/workspaces/:workspaceId/audit-logs
export const auditRouter = Router({ mergeParams: true });
auditRouter.use(requireSession);

/**
 * Read-only, tenant-scoped audit trail for a workspace's owners/admins
 * (docs/ARCHITECTURE.md §27 "Admin Panel" / §37). Restricted to OWNER/ADMIN —
 * a developer with lesser standing shouldn't necessarily see every action,
 * and a CLIENT role should never see it at all.
 */
auditRouter.get<WorkspaceParams>("/", async (req, res, next) => {
  try {
    await assertWorkspaceAccess.execute({ workspaceId: req.params.workspaceId, userId: req.userId!, requiredRoles: ["OWNER", "ADMIN"] });
    const { limit } = listQuerySchema.parse(req.query);
    res.json(await listWorkspaceAuditLog.execute(req.params.workspaceId, { limit }));
  } catch (err) {
    next(err);
  }
});
