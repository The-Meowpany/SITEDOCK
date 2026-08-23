import { ApplicationError, EmailAddress, UserId } from "@sitedock/shared";
import { WorkspaceInvitationRepository, WorkspaceRepository } from "../domain/ports";
import { hashInvitationToken } from "./create-workspace-invitation.use-case";

export interface AcceptWorkspaceInvitationCommand {
  rawToken: string;
  acceptingUserId: string;
  acceptingUserEmail: string;
}

export interface AcceptWorkspaceInvitationResult {
  workspaceId: string;
}

/**
 * Accepts a pending invitation and adds the accepting user to the workspace.
 * The invitation aggregate itself enforces that only the person the
 * invitation was addressed to can accept it, and that it hasn't expired
 * (WorkspaceInvitation.accept()) — this use case is just orchestration:
 * validate the invitation, then reuse Workspace.addMember() the exact same
 * way AddWorkspaceMemberUseCase does for the direct (already-has-account) path.
 */
export class AcceptWorkspaceInvitationUseCase {
  constructor(
    private readonly invitations: WorkspaceInvitationRepository,
    private readonly workspaces: WorkspaceRepository
  ) {}

  async execute(command: AcceptWorkspaceInvitationCommand): Promise<AcceptWorkspaceInvitationResult> {
    const invitation = await this.invitations.findByTokenHash(hashInvitationToken(command.rawToken));
    if (!invitation) {
      throw new ApplicationError("Invalid or unknown invitation", "INVITATION_NOT_FOUND");
    }

    invitation.accept(EmailAddress.create(command.acceptingUserEmail));

    const workspace = await this.workspaces.findById(invitation.workspaceId);
    if (!workspace) {
      throw new ApplicationError("The workspace for this invitation no longer exists", "WORKSPACE_NOT_FOUND");
    }

    if (!workspace.hasMember(UserId(command.acceptingUserId))) {
      workspace.addMember(UserId(command.acceptingUserId), invitation.role);
      await this.workspaces.save(workspace);
    }

    await this.invitations.save(invitation);

    return { workspaceId: workspace.id };
  }
}
