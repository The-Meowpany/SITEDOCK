import { describe, it, expect, beforeEach } from "vitest";
import { EmailAddress, UserId } from "@sitedock/shared";
import { User } from "../domain/user.entity";
import type {
  AccountDeletionRepository,
  PasswordHasher,
  PasswordResetRepository,
  SessionAdminRepository,
  SessionSummary,
  UserRepository,
} from "../domain/ports";
import {
  ChangeEmailUseCase,
  ChangePasswordUseCase,
  DeleteAccountUseCase,
  ManageSessionsUseCase,
  UpdateProfileUseCase,
} from "../application/account-management.use-cases";
import { ConfirmPasswordResetUseCase } from "../application/password-reset.use-case";
import { hashToken } from "../application/login-user.use-case";

const ALICE = UserId("11111111-1111-1111-1111-111111111111");
const BOB = UserId("22222222-2222-2222-2222-222222222222");

class FakeHasher implements PasswordHasher {
  async hash(p: string) { return `hashed:${p}`; }
  async verify(p: string, h: string) { return h === `hashed:${p}`; }
}

class FakeUsers implements UserRepository {
  rows = new Map<string, User>();
  async findById(id: UserId) { return this.rows.get(id) ?? null; }
  async findByEmail(email: EmailAddress) {
    return [...this.rows.values()].find((u) => u.email.value === email.value) ?? null;
  }
  async save(user: User) { this.rows.set(user.id, user); }
}

class FakeSessions implements SessionAdminRepository {
  rows: Array<SessionSummary & { userId: string }> = [];
  add(userId: string, id: string, token: string) {
    this.rows.push({ userId, id, tokenHash: hashToken(token), userAgent: null, ipAddress: null, createdAt: new Date(), expiresAt: new Date(Date.now() + 1e6) });
  }
  async listActiveByUserId(userId: UserId, now: Date) {
    return this.rows.filter((r) => r.userId === userId && r.expiresAt > now);
  }
  async revokeAllByUserId(userId: UserId, except?: string) {
    const before = this.rows.length;
    this.rows = this.rows.filter((r) => !(r.userId === userId && r.tokenHash !== except));
    return before - this.rows.length;
  }
  async revokeByIdForUser(userId: UserId, sessionId: string) {
    const before = this.rows.length;
    this.rows = this.rows.filter((r) => !(r.userId === userId && r.id === sessionId));
    return this.rows.length < before;
  }
}

function makeUser(id: UserId, email: string, role: "DEVELOPER" | "PLATFORM_ADMIN" = "DEVELOPER") {
  return User.hydrate({
    id, email: EmailAddress.create(email), passwordHash: "hashed:old-password", fullName: "Test User",
    platformRole: role, emailVerifiedAt: new Date(), suspendedAt: null, createdAt: new Date(), updatedAt: new Date(),
  });
}

describe("account management", () => {
  let users: FakeUsers;
  let sessions: FakeSessions;
  const hasher = new FakeHasher();

  beforeEach(() => {
    users = new FakeUsers();
    sessions = new FakeSessions();
    users.rows.set(ALICE, makeUser(ALICE, "alice@example.com"));
    users.rows.set(BOB, makeUser(BOB, "bob@example.com"));
    sessions.add(ALICE, "a1", "alice-current");
    sessions.add(ALICE, "a2", "alice-other");
    sessions.add(BOB, "b1", "bob-session");
  });

  describe("ChangePasswordUseCase", () => {
    const uc = () => new ChangePasswordUseCase(users, hasher, sessions);

    it("changes the password and revokes only the user's OTHER sessions", async () => {
      const res = await uc().execute({ userId: ALICE, currentPassword: "old-password", newPassword: "new-password-1", currentSessionTokenHash: hashToken("alice-current") });
      expect(res.revokedSessions).toBe(1);
      expect(users.rows.get(ALICE)!.passwordHash).toBe("hashed:new-password-1");
      expect(sessions.rows.map((r) => r.id).sort()).toEqual(["a1", "b1"]);
    });
    it("rejects a wrong current password with a non-401 code and changes nothing", async () => {
      await expect(uc().execute({ userId: ALICE, currentPassword: "nope", newPassword: "new-password-1" }))
        .rejects.toMatchObject({ code: "INVALID_PASSWORD" });
      expect(users.rows.get(ALICE)!.passwordHash).toBe("hashed:old-password");
      expect(sessions.rows).toHaveLength(3);
    });
    it("rejects weak and unchanged passwords", async () => {
      await expect(uc().execute({ userId: ALICE, currentPassword: "old-password", newPassword: "short" })).rejects.toMatchObject({ code: "WEAK_PASSWORD" });
      await expect(uc().execute({ userId: ALICE, currentPassword: "old-password", newPassword: "old-password" })).rejects.toMatchObject({ code: "PASSWORD_UNCHANGED" });
    });
  });

  describe("ChangeEmailUseCase", () => {
    const uc = () => new ChangeEmailUseCase(users, hasher, sessions);

    it("changes email, marks it unverified and revokes other sessions", async () => {
      const res = await uc().execute({ userId: ALICE, newEmail: "alice2@example.com", currentPassword: "old-password", currentSessionTokenHash: hashToken("alice-current") });
      expect(res).toEqual({ oldEmail: "alice@example.com", newEmail: "alice2@example.com" });
      expect(users.rows.get(ALICE)!.emailVerifiedAt).toBeNull();
      expect(sessions.rows.some((r) => r.id === "a2")).toBe(false);
      expect(sessions.rows.some((r) => r.id === "a1")).toBe(true);
    });
    it("refuses an address that belongs to another account", async () => {
      await expect(uc().execute({ userId: ALICE, newEmail: "bob@example.com", currentPassword: "old-password" })).rejects.toMatchObject({ code: "CONFLICT" });
    });
    it("requires the current password and a valid, different address", async () => {
      await expect(uc().execute({ userId: ALICE, newEmail: "x@example.com", currentPassword: "wrong" })).rejects.toMatchObject({ code: "INVALID_PASSWORD" });
      await expect(uc().execute({ userId: ALICE, newEmail: "not-an-email", currentPassword: "old-password" })).rejects.toMatchObject({ code: "INVALID_EMAIL" });
      await expect(uc().execute({ userId: ALICE, newEmail: "alice@example.com", currentPassword: "old-password" })).rejects.toMatchObject({ code: "EMAIL_UNCHANGED" });
    });
  });

  describe("UpdateProfileUseCase", () => {
    it("renames and validates", async () => {
      const uc = new UpdateProfileUseCase(users);
      expect(await uc.execute({ userId: ALICE, fullName: "  Alice New  " })).toEqual({ fullName: "Alice New" });
      await expect(uc.execute({ userId: ALICE, fullName: "x" })).rejects.toMatchObject({ code: "INVALID_FULL_NAME" });
    });
  });

  describe("ManageSessionsUseCase", () => {
    it("lists only the caller's sessions", async () => {
      const list = await new ManageSessionsUseCase(sessions).list(ALICE);
      expect(list.map((s) => s.id).sort()).toEqual(["a1", "a2"]);
    });
    it("cannot revoke another user's session by id (IDOR)", async () => {
      const uc = new ManageSessionsUseCase(sessions);
      await expect(uc.revokeOne(ALICE, "b1")).rejects.toMatchObject({ code: "NOT_FOUND" });
      expect(sessions.rows.some((r) => r.id === "b1")).toBe(true);
      await uc.revokeOne(ALICE, "a2");
      expect(sessions.rows.some((r) => r.id === "a2")).toBe(false);
    });
  });

  describe("DeleteAccountUseCase", () => {
    function accounts(soleOwner: string[]): AccountDeletionRepository & { deleted: string[] } {
      return { deleted: [], async findSoleOwnerWorkspaceIds() { return soleOwner; }, async deleteUser(id) { this.deleted.push(id); } };
    }
    it("deletes after password check when it orphans nothing", async () => {
      const acc = accounts([]);
      await new DeleteAccountUseCase(users, hasher, acc).execute({ userId: ALICE, currentPassword: "old-password" });
      expect(acc.deleted).toEqual([ALICE]);
    });
    it("blocks deletion when the user is the sole owner of a workspace", async () => {
      const acc = accounts(["ws-1"]);
      await expect(new DeleteAccountUseCase(users, hasher, acc).execute({ userId: ALICE, currentPassword: "old-password" }))
        .rejects.toMatchObject({ code: "ACCOUNT_OWNS_WORKSPACES" });
      expect(acc.deleted).toEqual([]);
    });
    it("requires the password and blocks platform admins", async () => {
      const acc = accounts([]);
      await expect(new DeleteAccountUseCase(users, hasher, acc).execute({ userId: ALICE, currentPassword: "wrong" })).rejects.toMatchObject({ code: "INVALID_PASSWORD" });
      users.rows.set(ALICE, makeUser(ALICE, "alice@example.com", "PLATFORM_ADMIN"));
      await expect(new DeleteAccountUseCase(users, hasher, acc).execute({ userId: ALICE, currentPassword: "old-password" })).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(acc.deleted).toEqual([]);
    });
  });

  describe("password reset ends all sessions", () => {
    it("revokes every session of the user after a successful reset", async () => {
      const resets: PasswordResetRepository = {
        async create() {},
        async findValidByTokenHash(h) { return h === hashToken("reset-token-123") ? { userId: ALICE } : null; },
        async markUsed() {},
      };
      await new ConfirmPasswordResetUseCase(users, resets, hasher, sessions).execute("reset-token-123", "brand-new-password");
      expect(sessions.rows.filter((r) => r.userId === ALICE)).toHaveLength(0);
      expect(sessions.rows.filter((r) => r.userId === BOB)).toHaveLength(1);
    });
  });
});
