import { DomainError, EmailAddress, UserId, WorkspaceId } from "@sitedock/shared";
import { WorkspaceInvitationStatus, workspaceInvitationStateMachine } from "./workspace-invitation-status";
import { WorkspaceRole } from "./workspace.entity";

export interface WorkspaceInvitationProps {
  id: string;
  workspaceId: WorkspaceId;
  email: EmailAddress;
  role: Exclude<WorkspaceRole, "OWNER">;
  tokenHash: string;
  status: WorkspaceInvitationStatus;
  invitedById: UserId;
  expiresAt: Date;
  acceptedAt: Date | null;
  createdAt: Date;
}

const DEFAULT_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

/**
 * WorkspaceInvitation aggregate — represents a pending "invite client" (or
 * teammate) that exists independently of whether the target person has a
 * SiteDock account yet (docs/ARCHITECTURE.md onboarding step 6 / §32 MVP
 * checklist "CLIENTS - invite client"). Protects two invariants: it can only
 * be accepted while PENDING and not expired, and only the person whose email
 * it was sent to can accept it — enforced here, not just at the API layer.
 */
export class WorkspaceInvitation {
  private constructor(private props: WorkspaceInvitationProps) {}

  static create(params: {
    id: string;
    workspaceId: WorkspaceId;
    email: string;
    role: Exclude<WorkspaceRole, "OWNER">;
    tokenHash: string;
    invitedById: UserId;
    now?: Date;
  }): WorkspaceInvitation {
    const now = params.now ?? new Date();
    return new WorkspaceInvitation({
      id: params.id,
      workspaceId: params.workspaceId,
      email: EmailAddress.create(params.email),
      role: params.role,
      tokenHash: params.tokenHash,
      status: "PENDING",
      invitedById: params.invitedById,
      expiresAt: new Date(now.getTime() + DEFAULT_TTL_MS),
      acceptedAt: null,
      createdAt: now,
    });
  }

  static hydrate(props: WorkspaceInvitationProps): WorkspaceInvitation {
    return new WorkspaceInvitation(props);
  }

  private transitionTo(next: WorkspaceInvitationStatus): void {
    workspaceInvitationStateMachine.assertCanTransition(this.props.status, next);
    this.props.status = next;
  }

  /**
   * Validates and accepts the invitation on behalf of `accepterEmail`. Throws
   * if the invitation isn't PENDING, has expired, or the accepting person's
   * email doesn't match who it was sent to — an invitation is not a generic
   * "join this workspace" link.
   */
  accept(accepterEmail: EmailAddress, now: Date = new Date()): void {
    if (this.props.status === "PENDING" && this.props.expiresAt < now) {
      this.transitionTo("EXPIRED");
      throw new DomainError("This invitation has expired", "INVITATION_EXPIRED");
    }
    if (!this.props.email.equals(accepterEmail)) {
      throw new DomainError("This invitation was sent to a different email address", "INVITATION_EMAIL_MISMATCH");
    }
    this.transitionTo("ACCEPTED");
    this.props.acceptedAt = now;
  }

  revoke(): void {
    this.transitionTo("REVOKED");
  }

  get id() { return this.props.id; }
  get workspaceId() { return this.props.workspaceId; }
  get email() { return this.props.email; }
  get role() { return this.props.role; }
  get tokenHash() { return this.props.tokenHash; }
  get status() { return this.props.status; }
  get invitedById() { return this.props.invitedById; }
  get expiresAt() { return this.props.expiresAt; }
  get acceptedAt() { return this.props.acceptedAt; }
  get createdAt() { return this.props.createdAt; }
}
