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
  /** White-label: optional branding per workspace (display name, logo, color). */
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

// ── Branding validation (Phase 21 §6/§8) ──────────────────

const BRANDING_MAX_KEYS = 20;
const BRANDING_MAX_STRING_LENGTH = 500;
export const SAFE_URL_RE = /^https:\/\//;
export const SAFE_COLOR_RE = /^#[0-9a-fA-F]{3,8}$/;
export const DANGEROUS_PATTERNS = [
  /<script/i,
  /<iframe/i,
  /<object/i,
  /<embed/i,
  /on\w+\s*=/i,
  /javascript:/i,
  /data:text\/html/i,
];

/** Keys that allow prototype pollution if stored in a JS object. */
const FORBIDDEN_BRANDING_KEYS = new Set([
  "__proto__",
  "constructor",
  "prototype",
  "hasOwnProperty",
  "toString",
  "valueOf",
]);

function validateBranding(branding: Record<string, unknown>): void {
  const keys = Object.keys(branding);
  if (keys.length > BRANDING_MAX_KEYS) {
    throw new DomainError(
      `Branding exceeds ${BRANDING_MAX_KEYS} keys`,
      "BRANDING_TOO_MANY_KEYS"
    );
  }

  for (const key of keys) {
    if (key.length > 50) {
      throw new DomainError(`Branding key "${key}" too long`, "BRANDING_KEY_TOO_LONG");
    }
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key)) {
      throw new DomainError(`Invalid branding key "${key}"`, "INVALID_BRANDING_KEY");
    }
    if (FORBIDDEN_BRANDING_KEYS.has(key)) {
      throw new DomainError(
        `Branding key "${key}" is forbidden (prototype pollution vector)`,
        "FORBIDDEN_BRANDING_KEY"
      );
    }

    const value = branding[key];
    if (value === null || value === undefined) continue;

    if (typeof value === "string") {
      if (value.length > BRANDING_MAX_STRING_LENGTH) {
        throw new DomainError(
          `Branding value for "${key}" exceeds ${BRANDING_MAX_STRING_LENGTH} chars`,
          "BRANDING_VALUE_TOO_LONG"
        );
      }
      for (const pattern of DANGEROUS_PATTERNS) {
        if (pattern.test(value)) {
          throw new DomainError(
            `Branding value for "${key}" contains unsafe content`,
            "UNSAFE_BRANDING_CONTENT"
          );
        }
      }
      // URL fields must use HTTPS
      if (/url$/i.test(key) && !SAFE_URL_RE.test(value)) {
        throw new DomainError(
          `Branding URL "${key}" must use https://`,
          "UNSAFE_BRANDING_URL"
        );
      }
      // Color fields must be valid hex
      if (/color$/i.test(key) && typeof value === "string" && value.length > 1) {
        if (!SAFE_COLOR_RE.test(value)) {
          throw new DomainError(
            `Branding color "${key}" must be a valid hex color`,
            "INVALID_BRANDING_COLOR"
          );
        }
      }
    } else if (typeof value === "number" || typeof value === "boolean") {
      continue; // primitives are safe
    } else if (typeof value === "object") {
      throw new DomainError(
        `Branding value for "${key}" cannot be a nested object`,
        "BRANDING_NESTED_OBJECT"
      );
    }
  }
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

  rename(name: string): void {
    if (name.trim().length < 2) {
      throw new DomainError("Workspace name must have at least 2 characters", "INVALID_WORKSPACE_NAME");
    }
    this.props.name = name.trim();
    this.props.updatedAt = new Date();
  }

  /** The OWNER role is never assigned here: use transferOwnership so there is always exactly one accountable owner. */
  changeMemberRole(userId: UserId, role: Exclude<WorkspaceRole, "OWNER">): void {
    const member = this.props.members.find((m) => m.userId === userId);
    if (!member) throw new DomainError("User is not a member of this workspace", "NOT_A_MEMBER");
    if (member.role === "OWNER") {
      throw new DomainError("The owner's role can only change by transferring ownership", "OWNER_ROLE_PROTECTED");
    }
    member.role = role;
    this.props.updatedAt = new Date();
  }

  removeMember(userId: UserId): void {
    const member = this.props.members.find((m) => m.userId === userId);
    if (!member) throw new DomainError("User is not a member of this workspace", "NOT_A_MEMBER");
    if (member.role === "OWNER") {
      throw new DomainError("The owner cannot be removed: transfer ownership first", "OWNER_ROLE_PROTECTED");
    }
    this.props.members = this.props.members.filter((m) => m.userId !== userId);
    this.props.updatedAt = new Date();
  }

  /** Hands the workspace to an existing staff member; the previous owner becomes ADMIN (never loses access silently). */
  transferOwnership(fromUserId: UserId, toUserId: UserId): void {
    if (fromUserId === toUserId) {
      throw new DomainError("The workspace already belongs to that user", "OWNERSHIP_UNCHANGED");
    }
    const from = this.props.members.find((m) => m.userId === fromUserId);
    if (!from || from.role !== "OWNER") {
      throw new DomainError("Only the current owner can transfer ownership", "NOT_OWNER");
    }
    const to = this.props.members.find((m) => m.userId === toUserId);
    if (!to) throw new DomainError("The new owner must already be a member of the workspace", "NOT_A_MEMBER");
    if (to.role === "CLIENT") {
      throw new DomainError("A client cannot own a workspace", "INVALID_NEW_OWNER");
    }
    from.role = "ADMIN";
    to.role = "OWNER";
    this.props.updatedAt = new Date();
  }

  ownerCount(): number {
    return this.props.members.filter((m) => m.role === "OWNER").length;
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
    if (branding !== null) {
      validateBranding(branding);
    }
    this.props.branding = branding;
    this.props.updatedAt = new Date();
  }
  get members() { return [...this.props.members]; }
  get createdAt() { return this.props.createdAt; }
}


