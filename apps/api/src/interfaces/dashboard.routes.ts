import { Router } from "express";
import { GetWorkspaceDashboardUseCase, PrismaDashboardReader } from "@sitedock/dashboard";
import { AssertWorkspaceAccessUseCase, PrismaWorkspaceRepository } from "@sitedock/workspace";
import { requireSession } from "../middleware/require-session";

const reader = new PrismaDashboardReader();
const assertWorkspaceAccess = new AssertWorkspaceAccessUseCase(new PrismaWorkspaceRepository());

/**
 * Developer Dashboard metrics (docs/ARCHITECTURE.md §18). OWNER/ADMIN/DEVELOPER
 * only: workspace-wide revenue is commercially sensitive, so workspace members
 * with the CLIENT role are explicitly excluded here.
 */
export const dashboardRouter = Router({ mergeParams: true });
dashboardRouter.use(requireSession);

dashboardRouter.get<{ workspaceId: string }>("/", async (req, res, next) => {
  try {
    await assertWorkspaceAccess.execute({
      workspaceId: req.params.workspaceId,
      userId: req.userId!,
      requiredRoles: ["OWNER", "ADMIN", "DEVELOPER"],
    });
    res.json(await new GetWorkspaceDashboardUseCase(reader).execute(req.params.workspaceId));
  } catch (err) {
    next(err);
  }
});
