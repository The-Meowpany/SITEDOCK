import { ConflictError, DomainError, UserId, WorkspaceId } from "@sitedock/shared";

export type WorkspaceRole = "OWNER" | "ADMIN" | "DEVELOPER" | "CLIENT";

export interface WorkspaceMemberProps {
  userId: UserId;
  role: WorkspaceRole;
  joinedAt: Date | null;
}

export interface WorkspaceProps {
  id: WorkspaceId;
  name: string;
  slug: string;
  /** White-label: branding opcional por workspace (nombre visible, logo, color). */
  branding: Record<string, unknown> | null;
  members: WorkspaceMemberProps[];
  createdAt: Date;
  updatedAt: Date;
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

/**
 * Workspace aggregate. Protects tenancy invariants: a workspace always has
 * exactly one OWNER at creation, and membership changes go through the
 * aggregate root rather than being written directly to a join table.
 */
export class Workspace {
  private constructor(private props: WorkspaceProps) {}

  static create(params: { id: WorkspaceId; name: string; ownerId: UserId }): Workspace {
    if (params.name.trim().length < 2) {
      throw new DomainError("Workspace name must have at least 2 characters", "INVALID_WORKSPACE_NAME");
    }
    const now = new Date();
    return new Workspace({
      id: params.id,
      name: params.name.trim(),
      slug: `${slugify(params.name)}-${params.id.slice(0, 8)}`,
      branding: null,
      members: [{ userId: params.ownerId, role: "OWNER", joinedAt: now }],
      createdAt: now,
      updatedAt: now,
    });
  }

  static hydrate(props: WorkspaceProps): Workspace {
    return new Workspace(props);
  }

  addMember(userId: UserId, role: Exclude<WorkspaceRole, "OWNER">): void {
    if (this.props.members.some((m) => m.userId === userId)) {
      throw new ConflictError("User is already a member of this workspace");
    }
    this.props.members.push({ userId, role, joinedAt: null });
    this.props.updatedAt = new Date();
  }

  hasMember(userId: UserId): boolean {
    return this.props.members.some((m) => m.userId === userId);
  }

  roleOf(userId: UserId): WorkspaceRole | null {
    return this.props.members.find((m) => m.userId === userId)?.role ?? null;
  }

  get id() { return this.props.id; }
  get name() { return this.props.name; }
  get slug() { return this.props.slug; }
  get branding() { return this.props.branding; }

  updateBranding(branding: Record<string, unknown> | null): void {
    this.props.branding = branding;
    this.props.updatedAt = new Date();
  }
  get members() { return [...this.props.members]; }
  get createdAt() { return this.props.createdAt; }
}
