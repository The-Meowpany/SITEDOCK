import { EmailAddress, UserId } from "@sitedock/shared";
import { User } from "./user.entity";

/** Domain defines the interface; infrastructure implements it. Never the reverse. */
export interface UserRepository {
  findById(id: UserId): Promise<User | null>;
  findByEmail(email: EmailAddress): Promise<User | null>;
  save(user: User): Promise<void>;
}

/** Password hashing is infrastructure (Argon2id today), domain only sees the port. */
export interface PasswordHasher {
  hash(plainPassword: string): Promise<string>;
  verify(plainPassword: string, hash: string): Promise<boolean>;
}

export interface SessionRepository {
  create(params: { userId: UserId; tokenHash: string; expiresAt: Date; userAgent?: string; ipAddress?: string }): Promise<void>;
  findByTokenHash(tokenHash: string): Promise<{ userId: UserId; expiresAt: Date } | null>;
  revokeByTokenHash(tokenHash: string): Promise<void>;
}

export interface PasswordResetRepository {
  create(params: { userId: UserId; tokenHash: string; expiresAt: Date }): Promise<void>;
  findValidByTokenHash(tokenHash: string): Promise<{ userId: UserId } | null>;
  markUsed(tokenHash: string): Promise<void>;
}

export interface SessionSummary {
  id: string;
  tokenHash: string;
  userAgent: string | null;
  ipAddress: string | null;
  createdAt: Date;
  expiresAt: Date;
}

/** Session management beyond login/logout. Kept separate so existing fakes of SessionRepository stay valid. */
export interface SessionAdminRepository {
  listActiveByUserId(userId: UserId, now: Date): Promise<SessionSummary[]>;
  /** Revokes every session of the user, optionally keeping one (the caller's). Returns how many were revoked. */
  revokeAllByUserId(userId: UserId, exceptTokenHash?: string): Promise<number>;
  /** Revokes a session only if it belongs to `userId` (never revoke someone else's by guessing an id). */
  revokeByIdForUser(userId: UserId, sessionId: string): Promise<boolean>;
}

export interface AccountDeletionRepository {
  /** Workspaces where `userId` is the ONLY owner: deleting the user would orphan them. */
  findSoleOwnerWorkspaceIds(userId: UserId): Promise<string[]>;
  deleteUser(userId: UserId): Promise<void>;
}
