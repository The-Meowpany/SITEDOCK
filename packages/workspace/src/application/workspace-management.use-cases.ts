import { ConflictError, ForbiddenError, NotFoundError, UserId, WorkspaceId } from "@sitedock/shared";
import { WorkspaceLifecycleRepository, WorkspaceRepository } from "../domain/ports";
import { Workspace, WorkspaceRole } from "../domain/workspace.entity";

async function load(workspaces: WorkspaceRepository, workspaceId: string): Promise<Workspace> {
  const workspace = await workspaces.findById(WorkspaceId(workspaceId));
  if (!workspace) throw new NotFoundError("Workspace", workspaceId);
  return workspace;
}

function actorRoleOf(workspace: Workspace, actorId: string): WorkspaceRole {
  const role = workspace.roleOf(UserId(actorId));
  if (!role) throw new ForbiddenError("You do not have access to this workspace");
  return role;
}

/**
 * Who may act on whom. OWNER manages everyone below OWNER; ADMIN manages only
 * DEVELOPER and CLIENT members. Nobody else manages anybody.
 */
export function canManageRole(actor: WorkspaceRole, target: WorkspaceRole): boolean {
  if (actor === "OWNER") return target !== "OWNER";
  if (actor === "ADMIN") return target === "DEVELOPER" || target === "CLIENT";
  return false;
}

export class RenameWorkspaceUseCase {
  constructor(private readonly workspaces: WorkspaceRepository) {}

  async execute(params: { workspaceId: string; actorId: string; name: string }): Promise<{ name: string }> {
    const workspace = await load(this.workspaces, params.workspaceId);
    const role = actorRoleOf(workspace, params.actorId);
    if (role !== "OWNER" && role !== "ADMIN") {
      throw new ForbiddenError("Only owners and admins can rename a workspace");
    }
    workspace.rename(params.name);
    await this.workspaces.save(workspace);
    return { name: workspace.name };
  }
}

export class ChangeMemberRoleUseCase {
  constructor(private readonly workspaces: WorkspaceRepository) {}

  async execute(params: {
    workspaceId: string;
    actorId: string;
    targetUserId: string;
    role: Exclude<WorkspaceRole, "OWNER">;
  }): Promise<void> {
    const workspace = await load(this.workspaces, params.workspaceId);
    const actorRole = actorRoleOf(workspace, params.actorId);
    if (params.actorId === params.targetUserId) {
      throw new ForbiddenError("You cannot change your own role");
    }
    const targetRole = workspace.roleOf(UserId(params.targetUserId));
    if (!targetRole) throw new NotFoundError("WorkspaceMember", params.targetUserId);
    // Both the member's CURRENT role and the role being granted must be within the actor's reach
    // (an ADMIN could otherwise mint new ADMINs or demote one).
    if (!canManageRole(actorRole, targetRole) || !canManageRole(actorRole, params.role)) {
      throw new ForbiddenError("You are not allowed to assign that role");
    }
    workspace.changeMemberRole(UserId(params.targetUserId), params.role);
    await this.workspaces.save(workspace);
  }
}

export class RemoveWorkspaceMemberUseCase {
  constructor(
    private readonly workspaces: WorkspaceRepository,
    private readonly lifecycle: WorkspaceLifecycleRepository
  ) {}

  async execute(params: { workspaceId: string; actorId: string; targetUserId: string }): Promise<void> {
    const workspace = await load(this.workspaces, params.workspaceId);
    const actorRole = actorRoleOf(workspace, params.actorId);
    const targetRole = workspace.roleOf(UserId(params.targetUserId));
    if (!targetRole) throw new NotFoundError("WorkspaceMember", params.targetUserId);

    const leavingVoluntarily = params.actorId === params.targetUserId;
    if (!leavingVoluntarily && !canManageRole(actorRole, targetRole)) {
      throw new ForbiddenError("You are not allowed to remove that member");
    }
    // Domain invariant (owner is protected) is checked on the aggregate; the delete itself is a
    // single-row operation so a stale snapshot can never remove anyone else.
    workspace.removeMember(UserId(params.targetUserId));
    await this.lifecycle.removeMember(workspace.id, UserId(params.targetUserId));
  }
}

export class TransferWorkspaceOwnershipUseCase {
  constructor(private readonly workspaces: WorkspaceRepository) {}

  async execute(params: { workspaceId: string; actorId: string; newOwnerUserId: string }): Promise<void> {
    const workspace = await load(this.workspaces, params.workspaceId);
    actorRoleOf(workspace, params.actorId);
    workspace.transferOwnership(UserId(params.actorId), UserId(params.newOwnerUserId));
    await this.workspaces.save(workspace);
  }
}

export class DeleteWorkspaceUseCase {
  constructor(
    private readonly workspaces: WorkspaceRepository,
    private readonly lifecycle: WorkspaceLifecycleRepository
  ) {}

  async execute(params: { workspaceId: string; actorId: string; confirmName: string }): Promise<{ name: string }> {
    const workspace = await load(this.workspaces, params.workspaceId);
    if (actorRoleOf(workspace, params.actorId) !== "OWNER") {
      throw new ForbiddenError("Only the owner can delete a workspace");
    }
    // Typed confirmation: a wrong or stale identifier must never delete anything.
    if (params.confirmName !== workspace.name) {
      throw new ConflictError("Confirmation name does not match the workspace name");
    }
    await this.lifecycle.deleteIfEmpty(workspace.id);
    return { name: workspace.name };
  }
}
