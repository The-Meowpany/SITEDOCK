import { ForbiddenError, NotFoundError, UserId, WorkspaceId } from "@sitedock/shared";
import { WorkspaceRepository } from "../domain/ports";
import { Workspace, WorkspaceRole } from "../domain/workspace.entity";

/**
 * Central tenant-isolation gate. Every request that touches a workspace-scoped
 * resource must go through this before reaching any repository — never trust
 * `WHERE id = resourceId` alone (see docs/ARCHITECTURE.md section 6 / SECURITY.md).
 */
export class AssertWorkspaceAccessUseCase {
  constructor(private readonly workspaces: WorkspaceRepository) {}

  async execute(params: { workspaceId: string; userId: string; requiredRoles?: WorkspaceRole[] }): Promise<Workspace> {
    const workspace = await this.workspaces.findById(WorkspaceId(params.workspaceId));
    if (!workspace) {
      throw new NotFoundError("Workspace", params.workspaceId);
    }

    const role = workspace.roleOf(UserId(params.userId));
    if (!role) {
      throw new ForbiddenError("You do not have access to this workspace");
    }

    if (params.requiredRoles && !params.requiredRoles.includes(role)) {
      throw new ForbiddenError(`This action requires one of roles: ${params.requiredRoles.join(", ")}`);
    }

    return workspace;
  }
}
