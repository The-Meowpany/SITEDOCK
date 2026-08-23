import { NotFoundError, UserId, WorkspaceId } from "@sitedock/shared";
import { WorkspaceRepository } from "../domain/ports";
import { WorkspaceRole } from "../domain/workspace.entity";

export interface AddWorkspaceMemberCommand {
  workspaceId: string;
  targetUserId: string;
  role: Exclude<WorkspaceRole, "OWNER">;
}

/**
 * Adds an existing platform User to a workspace with a given role — the
 * mechanism behind "invite client" (docs/ARCHITECTURE.md onboarding step 6 /
 * §32 MVP checklist "CLIENTS - invite client"). Role authorization (only
 * OWNER/ADMIN can invite) is enforced by the caller via
 * AssertWorkspaceAccessUseCase, same as every other write endpoint — this use
 * case only encodes the Workspace aggregate's own membership invariant
 * (no duplicate members), via Workspace.addMember().
 *
 * Resolving an email to a UserId is deliberately NOT this use case's job —
 * Workspace never imports Identity's UserRepository (bounded contexts stay
 * decoupled per docs/ARCHITECTURE.md §4). The interfaces layer (apps/api)
 * resolves the email first and passes in a UserId.
 */
export class AddWorkspaceMemberUseCase {
  constructor(private readonly workspaces: WorkspaceRepository) {}

  async execute(command: AddWorkspaceMemberCommand): Promise<void> {
    const workspace = await this.workspaces.findById(WorkspaceId(command.workspaceId));
    if (!workspace) throw new NotFoundError("Workspace", command.workspaceId);

    workspace.addMember(UserId(command.targetUserId), command.role);
    await this.workspaces.save(workspace);
  }
}
