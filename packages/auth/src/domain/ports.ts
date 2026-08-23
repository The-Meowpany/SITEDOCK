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
