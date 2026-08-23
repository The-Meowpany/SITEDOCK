import { randomBytes } from "node:crypto";
import { ApplicationError, EmailAddress } from "@sitedock/shared";
import { PasswordHasher, PasswordResetRepository, UserRepository } from "../domain/ports";
import { hashToken } from "./login-user.use-case";

const RESET_TTL_MS = 1000 * 60 * 30; // 30 minutes

/**
 * Emits a raw reset token via return value so the interfaces layer can hand it
 * to the NotificationService (email). Never persisted or logged in plain form.
 */
export class RequestPasswordResetUseCase {
  constructor(
    private readonly users: UserRepository,
    private readonly resets: PasswordResetRepository
  ) {}

  async execute(rawEmail: string): Promise<{ rawToken: string } | null> {
    let email: EmailAddress;
    try {
      email = EmailAddress.create(rawEmail);
    } catch {
      return null; // don't leak validation details for account enumeration reasons
    }

    const user = await this.users.findByEmail(email);
    if (!user) return null; // don't reveal whether the account exists

    const rawToken = randomBytes(32).toString("hex");
    await this.resets.create({
      userId: user.id,
      tokenHash: hashToken(rawToken),
      expiresAt: new Date(Date.now() + RESET_TTL_MS),
    });

    return { rawToken };
  }
}

export class ConfirmPasswordResetUseCase {
  constructor(
    private readonly users: UserRepository,
    private readonly resets: PasswordResetRepository,
    private readonly hasher: PasswordHasher
  ) {}

  async execute(rawToken: string, newPassword: string): Promise<void> {
    if (newPassword.length < 8) {
      throw new ApplicationError("Password must be at least 8 characters long", "WEAK_PASSWORD");
    }

    const record = await this.resets.findValidByTokenHash(hashToken(rawToken));
    if (!record) {
      throw new ApplicationError("Invalid or expired reset token", "INVALID_RESET_TOKEN");
    }

    const user = await this.users.findById(record.userId);
    if (!user) {
      throw new ApplicationError("Invalid or expired reset token", "INVALID_RESET_TOKEN");
    }

    user.changePasswordHash(await this.hasher.hash(newPassword));
    await this.users.save(user);
    await this.resets.markUsed(hashToken(rawToken));
  }
}
