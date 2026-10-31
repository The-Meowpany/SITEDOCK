import { randomBytes } from "node:crypto";
import { ApplicationError, UserId } from "@sitedock/shared";
import { EmailVerificationRepository, UserRepository } from "../domain/ports";
import { hashToken } from "./login-user.use-case";

const VERIFICATION_TTL_MS = 1000 * 60 * 60 * 24; // 24 hours

/**
 * Issues a verification link for the user's CURRENT email address. The raw token is returned
 * to the interfaces layer (which emails it) and is never stored or logged in plain form.
 * Returns null when there is nothing to verify (unknown user or already verified).
 */
export class RequestEmailVerificationUseCase {
  constructor(
    private readonly users: UserRepository,
    private readonly verifications: EmailVerificationRepository
  ) {}

  async execute(userId: UserId): Promise<{ rawToken: string; email: string } | null> {
    const user = await this.users.findById(userId);
    if (!user || user.emailVerifiedAt) return null;

    await this.verifications.invalidateOutstanding(userId);
    const rawToken = randomBytes(32).toString("hex");
    await this.verifications.create({
      userId,
      email: user.email.value,
      tokenHash: hashToken(rawToken),
      expiresAt: new Date(Date.now() + VERIFICATION_TTL_MS),
    });
    return { rawToken, email: user.email.value };
  }
}

export class ConfirmEmailVerificationUseCase {
  constructor(
    private readonly users: UserRepository,
    private readonly verifications: EmailVerificationRepository
  ) {}

  async execute(rawToken: string): Promise<{ userId: UserId; email: string }> {
    const tokenHash = hashToken(rawToken);
    const record = await this.verifications.findValidByTokenHash(tokenHash);
    const invalid = () => new ApplicationError("Invalid or expired verification link", "INVALID_VERIFICATION_TOKEN");
    if (!record) throw invalid();

    const user = await this.users.findById(record.userId);
    // The token proves one specific address: if the account moved to another one meanwhile, reject it.
    if (!user || user.email.value !== record.email) throw invalid();

    user.markEmailVerified();
    await this.users.save(user);
    await this.verifications.markUsed(tokenHash);
    return { userId: user.id, email: user.email.value };
  }
}
