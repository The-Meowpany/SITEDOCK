import { DomainError, EmailAddress, UserId } from "@sitedock/shared";

export type PlatformRole = "PLATFORM_ADMIN" | "DEVELOPER" | "CLIENT";

export interface UserProps {
  id: UserId;
  email: EmailAddress;
  passwordHash: string;
  fullName: string;
  platformRole: PlatformRole;
  emailVerifiedAt: Date | null;
  /** Set by PLATFORM_ADMIN action — a suspended user can never log in again until reinstated. */
  suspendedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * User aggregate. Holds behavior (not just data) for its own invariants —
 * e.g. it never exposes a raw password, only a pre-hashed value coming from
 * the PasswordHasher port.
 */
export class User {
  private constructor(private props: UserProps) {}

  static register(params: {
    id: UserId;
    email: EmailAddress;
    passwordHash: string;
    fullName: string;
  }): User {
    if (params.fullName.trim().length < 2) {
      throw new DomainError("Full name must have at least 2 characters", "INVALID_FULL_NAME");
    }
    const now = new Date();
    return new User({
      id: params.id,
      email: params.email,
      passwordHash: params.passwordHash,
      fullName: params.fullName.trim(),
      platformRole: "DEVELOPER",
      emailVerifiedAt: null,
      suspendedAt: null,
      createdAt: now,
      updatedAt: now,
    });
  }

  static hydrate(props: UserProps): User {
    return new User(props);
  }

  changePasswordHash(newHash: string): void {
    this.props.passwordHash = newHash;
    this.props.updatedAt = new Date();
  }

  rename(fullName: string): void {
    const trimmed = fullName.trim();
    if (trimmed.length < 2) {
      throw new DomainError("Full name must have at least 2 characters", "INVALID_FULL_NAME");
    }
    this.props.fullName = trimmed;
    this.props.updatedAt = new Date();
  }

  /** A new address is unverified until the owner proves control of it. */
  changeEmail(email: EmailAddress): void {
    this.props.email = email;
    this.props.emailVerifiedAt = null;
    this.props.updatedAt = new Date();
  }

  isSuspended(): boolean {
    return this.props.suspendedAt !== null;
  }

  suspend(): void {
    if (this.isSuspended()) {
      throw new DomainError("User is already suspended", "ALREADY_SUSPENDED");
    }
    this.props.suspendedAt = new Date();
    this.props.updatedAt = this.props.suspendedAt;
  }

  reinstate(): void {
    if (!this.isSuspended()) {
      throw new DomainError("User is not suspended", "NOT_SUSPENDED");
    }
    this.props.suspendedAt = null;
    this.props.updatedAt = new Date();
  }

  get id() { return this.props.id; }
  get email() { return this.props.email; }
  get passwordHash() { return this.props.passwordHash; }
  get fullName() { return this.props.fullName; }
  get platformRole() { return this.props.platformRole; }
  get emailVerifiedAt() { return this.props.emailVerifiedAt; }
  get suspendedAt() { return this.props.suspendedAt; }
  get createdAt() { return this.props.createdAt; }
  get updatedAt() { return this.props.updatedAt; }
}
