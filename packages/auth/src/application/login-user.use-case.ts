import { createHash, randomBytes } from "node:crypto";
import { EmailAddress, UnauthorizedError } from "@sitedock/shared";
import { PasswordHasher, SessionRepository, UserRepository } from "../domain/ports";

export interface LoginUserCommand {
  email: string;
  password: string;
  userAgent?: string;
  ipAddress?: string;
}

export interface LoginUserResult {
  sessionToken: string;
  expiresAt: Date;
  userId: string;
  fullName: string;
}

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export class LoginUserUseCase {
  constructor(
    private readonly users: UserRepository,
    private readonly hasher: PasswordHasher,
    private readonly sessions: SessionRepository
  ) {}

  async execute(command: LoginUserCommand): Promise<LoginUserResult> {
    // Constant generic error message: never reveal whether the email exists.
    const invalidCredentials = () => new UnauthorizedError("Invalid email or password");

    let email: EmailAddress;
    try {
      email = EmailAddress.create(command.email);
    } catch {
      throw invalidCredentials();
    }

    const user = await this.users.findByEmail(email);
    if (!user) throw invalidCredentials();

    const valid = await this.hasher.verify(command.password, user.passwordHash);
    if (!valid) throw invalidCredentials();

    // Checked AFTER credential verification: the message is only shown to
    // someone who just proved ownership of the account, so it leaks nothing.
    if (user.isSuspended()) {
      throw new UnauthorizedError("This account has been suspended. Contact support.");
    }

    const rawToken = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

    await this.sessions.create({
      userId: user.id,
      tokenHash: hashToken(rawToken),
      expiresAt,
      userAgent: command.userAgent,
      ipAddress: command.ipAddress,
    });

    return { sessionToken: rawToken, expiresAt, userId: user.id, fullName: user.fullName };
  }
}

export { hashToken };
