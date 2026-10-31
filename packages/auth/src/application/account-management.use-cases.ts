import { ApplicationError, EmailAddress, UserId } from "@sitedock/shared";
import {
  AccountDeletionRepository,
  PasswordHasher,
  SessionAdminRepository,
  SessionSummary,
  UserRepository,
} from "../domain/ports";

const MIN_PASSWORD_LENGTH = 8;

async function loadUserVerifyingPassword(
  users: UserRepository,
  hasher: PasswordHasher,
  userId: UserId,
  password: string
) {
  const user = await users.findById(userId);
  if (!user) throw new ApplicationError("Account not found", "NOT_FOUND");
  // 400 (not 401) on purpose: a wrong password here must not look like an expired session to the client.
  if (!(await hasher.verify(password, user.passwordHash))) {
    throw new ApplicationError("Current password is incorrect", "INVALID_PASSWORD");
  }
  return user;
}

export class ChangePasswordUseCase {
  constructor(
    private readonly users: UserRepository,
    private readonly hasher: PasswordHasher,
    private readonly sessions: SessionAdminRepository
  ) {}

  async execute(params: {
    userId: UserId;
    currentPassword: string;
    newPassword: string;
    currentSessionTokenHash?: string;
  }): Promise<{ revokedSessions: number }> {
    if (params.newPassword.length < MIN_PASSWORD_LENGTH) {
      throw new ApplicationError("Password must be at least 8 characters long", "WEAK_PASSWORD");
    }
    if (params.newPassword === params.currentPassword) {
      throw new ApplicationError("New password must differ from the current one", "PASSWORD_UNCHANGED");
    }
    const user = await loadUserVerifyingPassword(this.users, this.hasher, params.userId, params.currentPassword);
    user.changePasswordHash(await this.hasher.hash(params.newPassword));
    await this.users.save(user);
    // A password change must end every other login (they may belong to whoever knew the old password).
    const revokedSessions = await this.sessions.revokeAllByUserId(params.userId, params.currentSessionTokenHash);
    return { revokedSessions };
  }
}

export class UpdateProfileUseCase {
  constructor(private readonly users: UserRepository) {}

  async execute(params: { userId: UserId; fullName: string }): Promise<{ fullName: string }> {
    const user = await this.users.findById(params.userId);
    if (!user) throw new ApplicationError("Account not found", "NOT_FOUND");
    user.rename(params.fullName);
    await this.users.save(user);
    return { fullName: user.fullName };
  }
}

export class ChangeEmailUseCase {
  constructor(
    private readonly users: UserRepository,
    private readonly hasher: PasswordHasher,
    private readonly sessions: SessionAdminRepository
  ) {}

  async execute(params: {
    userId: UserId;
    newEmail: string;
    currentPassword: string;
    currentSessionTokenHash?: string;
  }): Promise<{ oldEmail: string; newEmail: string }> {
    let next: EmailAddress;
    try {
      next = EmailAddress.create(params.newEmail);
    } catch {
      throw new ApplicationError("Invalid email address", "INVALID_EMAIL");
    }
    const user = await loadUserVerifyingPassword(this.users, this.hasher, params.userId, params.currentPassword);
    const oldEmail = user.email.value;
    if (next.value === oldEmail) {
      throw new ApplicationError("That is already your email address", "EMAIL_UNCHANGED");
    }
    const existing = await this.users.findByEmail(next);
    if (existing) {
      throw new ApplicationError("That email address is already in use", "CONFLICT");
    }
    user.changeEmail(next);
    await this.users.save(user);
    await this.sessions.revokeAllByUserId(params.userId, params.currentSessionTokenHash);
    return { oldEmail, newEmail: next.value };
  }
}

export class ManageSessionsUseCase {
  constructor(private readonly sessions: SessionAdminRepository) {}

  list(userId: UserId, now: Date = new Date()): Promise<SessionSummary[]> {
    return this.sessions.listActiveByUserId(userId, now);
  }

  async revokeOne(userId: UserId, sessionId: string): Promise<void> {
    const ok = await this.sessions.revokeByIdForUser(userId, sessionId);
    if (!ok) throw new ApplicationError("Session not found", "NOT_FOUND");
  }

  revokeOthers(userId: UserId, currentSessionTokenHash: string): Promise<number> {
    return this.sessions.revokeAllByUserId(userId, currentSessionTokenHash);
  }
}

export class DeleteAccountUseCase {
  constructor(
    private readonly users: UserRepository,
    private readonly hasher: PasswordHasher,
    private readonly accounts: AccountDeletionRepository
  ) {}

  async execute(params: { userId: UserId; currentPassword: string }): Promise<{ email: string; fullName: string }> {
    const user = await loadUserVerifyingPassword(this.users, this.hasher, params.userId, params.currentPassword);
    if (user.platformRole === "PLATFORM_ADMIN") {
      throw new ApplicationError("Platform administrators cannot delete their own account", "FORBIDDEN");
    }
    const orphaned = await this.accounts.findSoleOwnerWorkspaceIds(params.userId);
    if (orphaned.length > 0) {
      throw new ApplicationError(
        "You are the only owner of one or more workspaces. Transfer ownership or delete those workspaces first.",
        "ACCOUNT_OWNS_WORKSPACES"
      );
    }
    await this.accounts.deleteUser(params.userId);
    return { email: user.email.value, fullName: user.fullName };
  }
}
