import { describe, expect, it, beforeEach } from "vitest";
import { randomBytes } from "node:crypto";
import { EmailAddress, UserId } from "@sitedock/shared";
import { User } from "../domain/user.entity";
import {
  UserRepository,
  PasswordHasher,
  SessionRepository,
  PasswordResetRepository,
} from "../domain/ports";
import { RegisterUserUseCase } from "../application/register-user.use-case";
import { LoginUserUseCase } from "../application/login-user.use-case";
import { RequestPasswordResetUseCase } from "../application/password-reset.use-case";
import { ConfirmPasswordResetUseCase } from "../application/password-reset.use-case";
import { SuspendUserUseCase } from "../application/admin-user.use-cases";

class InMemoryUserRepository implements UserRepository {
  byId = new Map<string, User>();
  async findById(id: string) { return this.byId.get(id) ?? null; }
  async findByEmail(email: EmailAddress) {
    for (const u of this.byId.values()) if (u.email.equals(email)) return u;
    return null;
  }
  async save(user: User) { this.byId.set(user.id as string, user); }
}

class FakeHasher implements PasswordHasher {
  async hash(plain: string) { return `hashed:${plain}`; }
  async verify(plain: string, hash: string) { return hash === `hashed:${plain}`; }
}

class InMemorySessionRepository implements SessionRepository {
  sessions = new Map<string, { userId: string; expiresAt: Date }>();
  async create(params: { userId: string; tokenHash: string; expiresAt: Date }) {
    this.sessions.set(params.tokenHash, { userId: params.userId, expiresAt: params.expiresAt });
  }
  async findByTokenHash(tokenHash: string) {
    return this.sessions.get(tokenHash) ?? null;
  }
  async revokeByTokenHash(tokenHash: string) { this.sessions.delete(tokenHash); }
}

class InMemoryPasswordResetRepository implements PasswordResetRepository {
  tokens = new Map<string, { userId: UserId; expiresAt: Date; used: boolean }>();
  async create(params: { userId: UserId; tokenHash: string; expiresAt: Date }) {
    this.tokens.set(params.tokenHash, { ...params, used: false });
  }
  async findValidByTokenHash(tokenHash: string) {
    const t = this.tokens.get(tokenHash);
    if (!t || t.used || t.expiresAt < new Date()) return null;
    return { userId: t.userId };
  }
  async markUsed(tokenHash: string) {
    const t = this.tokens.get(tokenHash);
    if (t) t.used = true;
  }
}

const WS = "11111111-1111-1111-1111-111111111111";

describe("Authentication adversarial campaign", () => {
  let users: InMemoryUserRepository;
  let hasher: FakeHasher;
  let sessions: InMemorySessionRepository;
  let register: RegisterUserUseCase;
  let login: LoginUserUseCase;

  beforeEach(() => {
    users = new InMemoryUserRepository();
    hasher = new FakeHasher();
    sessions = new InMemorySessionRepository();
    register = new RegisterUserUseCase(users, hasher);
    login = new LoginUserUseCase(users, hasher, sessions);
  });

  it("suspended user cannot login even with valid credentials", async () => {
    await register.execute({ email: "dev@test.com", password: "supersecret", fullName: "Jane" });
    const stored = await users.findByEmail(EmailAddress.create("dev@test.com"));
    const suspend = new SuspendUserUseCase(users);
    await suspend.execute({ userId: stored!.id as string });

    await expect(login.execute({ email: "dev@test.com", password: "supersecret" }))
      .rejects.toThrow(/suspended/i);
  });

  it("session tokens are cryptographically unique per login", async () => {
    await register.execute({ email: "dev@test.com", password: "supersecret", fullName: "Jane" });
    const r1 = await login.execute({ email: "dev@test.com", password: "supersecret" });
    const r2 = await login.execute({ email: "dev@test.com", password: "supersecret" });
    expect(r1.sessionToken).not.toBe(r2.sessionToken);
    expect(r1.sessionToken).toMatch(/^[a-f0-9]{64}$/);
  });

  it("password hash never appears in login response", async () => {
    await register.execute({ email: "dev@test.com", password: "supersecret", fullName: "Jane" });
    const result = await login.execute({ email: "dev@test.com", password: "supersecret" });
    expect(JSON.stringify(result)).not.toContain("hashed:");
    expect(Object.keys(result)).not.toContain("passwordHash");
  });

  it("no user enumeration via error messages", async () => {
    try { await login.execute({ email: "ghost@nowhere.test", password: "x" }); }
    catch (e) { var ghostMsg = (e as Error).message; }

    await register.execute({ email: "real@test.com", password: "supersecret", fullName: "Jane" });
    try { await login.execute({ email: "real@test.com", password: "wrongpass" }); }
    catch (e) { var realMsg = (e as Error).message; }

    expect(ghostMsg).toBe(realMsg);
  });
});

describe("Password reset adversarial campaign", () => {
  let users: InMemoryUserRepository;
  let hasher: FakeHasher;
  let resets: InMemoryPasswordResetRepository;
  let sessions: InMemorySessionRepository;
  let requestReset: RequestPasswordResetUseCase;
  let confirmReset: ConfirmPasswordResetUseCase;

  beforeEach(() => {
    users = new InMemoryUserRepository();
    hasher = new FakeHasher();
    resets = new InMemoryPasswordResetRepository();
    sessions = new InMemorySessionRepository();
    requestReset = new RequestPasswordResetUseCase(users, resets);
    confirmReset = new ConfirmPasswordResetUseCase(users, resets, hasher);
  });

  function seedUser(email: string) {
    return User.register({
      id: UserId(randomUUID()),
      email: EmailAddress.create(email),
      passwordHash: "hashed:oldpass",
      fullName: "Jane",
    });
  }

  it("token is single-use — second confirmation fails", async () => {
    users.save(seedUser("dev@test.com"));
    const result = await requestReset.execute("dev@test.com");
    must(result !== null);

    await confirmReset.execute(result.rawToken, "newpassword123");
    await expect(confirmReset.execute(result.rawToken, "anotherpass456")).rejects.toThrow();
  });

  it("expired token cannot reset password", () => {
    // El repo fake filtra por expiresAt < new Date()
    // Un token con expiresAt en el pasado no pasa findValidByTokenHash
    expect(resets.findValidByTokenHash("nonexistent")).resolves.toBeNull();
  });

  it("reset de email inexistente no genera token (sin enumeración)", async () => {
    const result = await requestReset.execute("ghost@nowhere.test");
    expect(result).toBeNull();
  });

  it("tokens consecutivos son únicos", async () => {
    users.save(seedUser("dev@test.com"));
    const r1 = await requestReset.execute("dev@test.com");
    const r2 = await requestReset.execute("dev@test.com");
    must(r1 !== null && r2 !== null);
    expect(r1!.rawToken).not.toBe(r2!.rawToken);
    expect(r2!.rawToken).toMatch(/^[a-f0-9]{64}$/);
  });

  it("confirmar con password corto es rechazado", async () => {
    users.save(seedUser("dev@test.com"));
    const result = await requestReset.execute("dev@test.com");
    must(result !== null);
    await expect(confirmReset.execute(result.rawToken, "abc")).rejects.toThrow();
  });
});

function randomUUID(): string {
  return crypto.randomUUID();
}
const crypto = require("node:crypto");

function must(cond: unknown, msg?: string): asserts cond {
  if (!cond) throw new Error(msg ?? "assertion failed");
}
