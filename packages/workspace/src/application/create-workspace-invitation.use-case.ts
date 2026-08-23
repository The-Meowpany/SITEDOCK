import { randomBytes, createHash, randomUUID } from "node:crypto";
import { ConflictError, UserId, WorkspaceId } from "@sitedock/shared";
import { WorkspaceInvitation } from "../domain/workspace-invitation.entity";
import { WorkspaceInvitationRepository } from "../domain/ports";
import { WorkspaceRole } from "../domain/workspace.entity";

export function hashInvitationToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export interface CreateWorkspaceInvitationCommand {
  workspaceId: string;
  email: string;
  role: Exclude<WorkspaceRole, "OWNER">;
  invitedById: string;
}

/**
 * Creates a pending invitation — the "invite client" mechanism that works
 * regardless of whether the invited person has a SiteDock account yet
 * (docs/ARCHITECTURE.md onboarding step 6). Returns the raw token so the
 * interfaces layer can hand it to NotificationService; only the hash is
 * persisted, same pattern as password-reset tokens in @sitedock/auth.
 */
export class CreateWorkspaceInvitationUseCase {
  constructor(private readonly invitations: WorkspaceInvitationRepository) {}

  async execute(command: CreateWorkspaceInvitationCommand): Promise<{ invitationId: string; rawToken: string; expiresAt: Date }> {
    const workspaceId = WorkspaceId(command.workspaceId);

    const existing = await this.invitations.findPendingByEmail(workspaceId, command.email);
    if (existing) {
      throw new ConflictError(`An invitation is already pending for ${command.email}`);
    }

    const rawToken = randomBytes(32).toString("hex");
    const invitation = WorkspaceInvitation.create({
      id: randomUUID(),
      workspaceId,
      email: command.email,
      role: command.role,
      tokenHash: hashInvitationToken(rawToken),
      invitedById: UserId(command.invitedById),
    });

    await this.invitations.save(invitation);

    return { invitationId: invitation.id, rawToken, expiresAt: invitation.expiresAt };
  }
}
