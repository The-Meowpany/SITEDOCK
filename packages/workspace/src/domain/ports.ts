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

/**
 * Destructive/structural operations kept off WorkspaceRepository so `save()` can stay
 * an idempotent upsert: a stale aggregate snapshot must never be able to delete members.
 */
export interface WorkspaceLifecycleRepository {
  /** Deletes exactly one membership row and refuses (rolling back) if it would leave the workspace without an owner. */
  removeMember(workspaceId: WorkspaceId, userId: UserId): Promise<void>;
  /** Deletes the workspace only if it has no projects or websites; otherwise throws ConflictError. */
  deleteIfEmpty(workspaceId: WorkspaceId): Promise<void>;
}
