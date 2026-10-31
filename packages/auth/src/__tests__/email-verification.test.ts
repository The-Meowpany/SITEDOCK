import { describe, it, expect, beforeEach } from "vitest";
import { EmailAddress, UserId } from "@sitedock/shared";
import { User } from "../domain/user.entity";
import type { EmailVerificationRepository, UserRepository } from "../domain/ports";
import {
  ConfirmEmailVerificationUseCase,
  RequestEmailVerificationUseCase,
} from "../application/email-verification.use-cases";

const ALICE = UserId("11111111-1111-1111-1111-111111111111");

class FakeUsers implements UserRepository {
  rows = new Map<string, User>();
  async findById(id: UserId) { return this.rows.get(id) ?? null; }
  async findByEmail(email: EmailAddress) {
    return [...this.rows.values()].find((u) => u.email.value === email.value) ?? null;
  }
  async save(user: User) { this.rows.set(user.id, user); }
}

class FakeVerifications implements EmailVerificationRepository {
  rows: Array<{ userId: string; email: string; tokenHash: string; expiresAt: Date; usedAt: Date | null }> = [];
  async create(p: { userId: UserId; email: string; tokenHash: string; expiresAt: Date }) {
    this.rows.push({ ...p, usedAt: null });
  }
  async findValidByTokenHash(tokenHash: string) {
    const row = this.rows.find((r) => r.tokenHash === tokenHash);
    if (!row || row.usedAt || row.expiresAt < new Date()) return null;
    return { userId: UserId(row.userId), email: row.email };
  }
  async markUsed(tokenHash: string) {
    const row = this.rows.find((r) => r.tokenHash === tokenHash);
    if (row) row.usedAt = new Date();
  }
  async invalidateOutstanding(userId: UserId) {
    for (const r of this.rows) if (r.userId === userId && !r.usedAt) r.usedAt = new Date();
  }
}

function makeUser(verified: boolean) {
  return User.hydrate({
    id: ALICE, email: EmailAddress.create("alice@example.com"), passwordHash: "x", fullName: "Alice",
    platformRole: "DEVELOPER", emailVerifiedAt: verified ? new Date() : null, suspendedAt: null,
    createdAt: new Date(), updatedAt: new Date(),
  });
}

describe("email verification", () => {
  let users: FakeUsers;
  let verifications: FakeVerifications;

  beforeEach(() => {
    users = new FakeUsers();
    verifications = new FakeVerifications();
    users.rows.set(ALICE, makeUser(false));
  });

  const request = () => new RequestEmailVerificationUseCase(users, verifications);
  const confirm = () => new ConfirmEmailVerificationUseCase(users, verifications);

  it("verifies the address with a freshly issued token, and the token is single use", async () => {
    const issued = await request().execute(ALICE);
    expect(issued?.email).toBe("alice@example.com");
    expect(verifications.rows[0]!.tokenHash).not.toBe(issued!.rawToken); // only the hash is stored

    await confirm().execute(issued!.rawToken);
    expect(users.rows.get(ALICE)!.emailVerifiedAt).not.toBeNull();
    await expect(confirm().execute(issued!.rawToken)).rejects.toMatchObject({ code: "INVALID_VERIFICATION_TOKEN" });
  });

  it("issues nothing when the address is already verified or the user is unknown", async () => {
    users.rows.set(ALICE, makeUser(true));
    expect(await request().execute(ALICE)).toBeNull();
    expect(await request().execute(UserId("99999999-9999-9999-9999-999999999999"))).toBeNull();
    expect(verifications.rows).toHaveLength(0);
  });

  it("only the most recent link works", async () => {
    const first = await request().execute(ALICE);
    const second = await request().execute(ALICE);
    await expect(confirm().execute(first!.rawToken)).rejects.toMatchObject({ code: "INVALID_VERIFICATION_TOKEN" });
    await expect(confirm().execute(second!.rawToken)).resolves.toBeDefined();
  });

  it("rejects expired and unknown tokens", async () => {
    const issued = await request().execute(ALICE);
    verifications.rows[0]!.expiresAt = new Date(Date.now() - 1000);
    await expect(confirm().execute(issued!.rawToken)).rejects.toMatchObject({ code: "INVALID_VERIFICATION_TOKEN" });
    await expect(confirm().execute("not-a-real-token-at-all")).rejects.toMatchObject({ code: "INVALID_VERIFICATION_TOKEN" });
  });

  it("a link for an address the user has since replaced cannot verify the new one", async () => {
    const issued = await request().execute(ALICE);
    const user = users.rows.get(ALICE)!;
    user.changeEmail(EmailAddress.create("alice2@example.com"));
    await users.save(user);
    await expect(confirm().execute(issued!.rawToken)).rejects.toMatchObject({ code: "INVALID_VERIFICATION_TOKEN" });
    expect(users.rows.get(ALICE)!.emailVerifiedAt).toBeNull();
  });
});
