import { UserId, WorkspaceId } from "@sitedock/shared";
import { Workspace } from "./workspace.entity";
import { WorkspaceInvitation } from "./workspace-invitation.entity";

export interface WorkspaceRepository {
  findById(id: WorkspaceId): Promise<Workspace | null>;
  listForUser(userId: UserId): Promise<Workspace[]>;
  save(workspace: Workspace): Promise<void>;
}

export interface WorkspaceInvitationRepository {
  findByTokenHash(tokenHash: string): Promise<WorkspaceInvitation | null>;
  findPendingByEmail(workspaceId: WorkspaceId, email: string): Promise<WorkspaceInvitation | null>;
  save(invitation: WorkspaceInvitation): Promise<void>;
}

/**
 * Read-side port for scheduled jobs that must reach the humans running a
 * workspace (e.g. "domain expiring → notify developer", docs/ARCHITECTURE.md
 * §17). Only staff roles — CLIENT members never receive operational alerts.
 */
export interface WorkspaceStaffDirectory {
  listStaffEmails(workspaceId: WorkspaceId): Promise<string[]>;
}
