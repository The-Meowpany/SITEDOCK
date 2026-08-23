import { describe, expect, it, beforeEach } from "vitest";
import { EmailAddress, UserId, ConflictError, NotFoundError } from "@sitedock/shared";
import { User } from "../domain/user.entity";
import { UserRepository, PasswordHasher, SessionRepository } from "../domain/ports";
import { RegisterUserUseCase } from "../application/register-user.use-case";
import { LoginUserUseCase } from "../application/login-user.use-case";
import { SuspendUserUseCase, ReinstateUserUseCase } from "../application/admin-user.use-cases";

class InMemoryUserRepository implements UserRepository {
  private byId = new Map<string, User>();

  async findById(id: string) {
    return this.byId.get(id) ?? null;
  }
  async findByEmail(email: EmailAddress) {
    for (const u of this.byId.values()) {
      if (u.email.equals(email)) return u;
    }
    return null;
  }
  async save(user: User) {
    this.byId.set(user.id, user);
  }
}

class FakeHasher implements PasswordHasher {
  async hash(plain: string) {
    return `hashed:${plain}`;
  }
  async verify(plain: string, hash: string) {
    return hash === `hashed:${plain}`;
  }
}

class InMemorySessionRepository implements SessionRepository {
  sessions = new Map<string, { userId: string; expiresAt: Date }>();
  async create(params: { userId: string; tokenHash: string; expiresAt: Date }) {
    this.sessions.set(params.tokenHash, { userId: params.userId, expiresAt: params.expiresAt });
  }
  async findByTokenHash(tokenHash: string) {
    const session = this.sessions.get(tokenHash);
    return session ? { userId: UserId(session.userId), expiresAt: session.expiresAt } : null;
  }
  async revokeByTokenHash(tokenHash: string) {
    this.sessions.delete(tokenHash);
  }
}

describe("User entity", () => {
  it("registers with a normalized name and no verified email yet", () => {
    const user = User.register({
      id: UserId("11111111-1111-1111-1111-111111111111"),
      email: EmailAddress.create("dev@example.com"),
      passwordHash: "hashed:secret123",
      fullName: "  Jane Dev  ",
    });
    expect(user.fullName).toBe("Jane Dev");
    expect(user.platformRole).toBe("DEVELOPER");
    expect(user.emailVerifiedAt).toBeNull();
  });
});

describe("RegisterUserUseCase", () => {
  let users: InMemoryUserRepository;
  let hasher: FakeHasher;
  let useCase: RegisterUserUseCase;

  beforeEach(() => {
    users = new InMemoryUserRepository();
    hasher = new FakeHasher();
    useCase = new RegisterUserUseCase(users, hasher);
  });

  it("registers a new developer", async () => {
    const result = await useCase.execute({
      email: "dev@example.com",
      password: "supersecret",
      fullName: "Jane Dev",
    });
    expect(result.email).toBe("dev@example.com");
    const stored = await users.findByEmail(EmailAddress.create("dev@example.com"));
    expect(stored?.passwordHash).toBe("hashed:supersecret");
  });

  it("rejects duplicate emails", async () => {
    await useCase.execute({ email: "dev@example.com", password: "supersecret", fullName: "Jane" });
    await expect(
      useCase.execute({ email: "dev@example.com", password: "anotherpass", fullName: "Jane 2" })
    ).rejects.toThrow(ConflictError);
  });

  it("rejects short passwords", async () => {
    await expect(
      useCase.execute({ email: "short@example.com", password: "abc", fullName: "Short Pw" })
    ).rejects.toThrow();
  });
});

describe("LoginUserUseCase", () => {
  it("logs in with correct credentials and issues a session", async () => {
    const users = new InMemoryUserRepository();
    const hasher = new FakeHasher();
    const sessions = new InMemorySessionRepository();
    const register = new RegisterUserUseCase(users, hasher);
    const login = new LoginUserUseCase(users, hasher, sessions);

    await register.execute({ email: "dev@example.com", password: "supersecret", fullName: "Jane" });
    const result = await login.execute({ email: "dev@example.com", password: "supersecret" });

    expect(result.sessionToken).toHaveLength(64);
    expect(sessions.sessions.size).toBe(1);
  });

  it("rejects wrong password with a generic message (no user enumeration)", async () => {
    const users = new InMemoryUserRepository();
    const hasher = new FakeHasher();
    const sessions = new InMemorySessionRepository();
    const register = new RegisterUserUseCase(users, hasher);
    const login = new LoginUserUseCase(users, hasher, sessions);

    await register.execute({ email: "dev@example.com", password: "supersecret", fullName: "Jane" });

    await expect(login.execute({ email: "dev@example.com", password: "wrongpass" })).rejects.toThrow(
      "Invalid email or password"
    );
    await expect(login.execute({ email: "ghost@example.com", password: "whatever" })).rejects.toThrow(
      "Invalid email or password"
    );
  });

  it("rejects a suspended account even with correct credentials", async () => {
    const users = new InMemoryUserRepository();
    const hasher = new FakeHasher();
    const sessions = new InMemorySessionRepository();
    const register = new RegisterUserUseCase(users, hasher);
    const login = new LoginUserUseCase(users, hasher, sessions);
    const suspendUser = new SuspendUserUseCase(users);

    await register.execute({ email: "dev@example.com", password: "supersecret", fullName: "Jane" });
    const stored = await users.findByEmail(EmailAddress.create("dev@example.com"));
    await suspendUser.execute({ userId: stored!.id as string });

    await expect(login.execute({ email: "dev@example.com", password: "supersecret" })).rejects.toThrow(
      "suspended"
    );
    expect(sessions.sessions.size).toBe(0); // no session was ever issued
  });
});

describe("SuspendUserUseCase / ReinstateUserUseCase (PLATFORM_ADMIN only path)", () => {
  let users: InMemoryUserRepository;
  let register: RegisterUserUseCase;

  beforeEach(() => {
    users = new InMemoryUserRepository();
    register = new RegisterUserUseCase(users, new FakeHasher());
  });

  it("suspends and reinstates a user, enforcing the entity invariants", async () => {
    await register.execute({ email: "dev@example.com", password: "supersecret", fullName: "Jane" });
    const stored = await users.findByEmail(EmailAddress.create("dev@example.com"));
    const userId = stored!.id as string;
    const suspendUser = new SuspendUserUseCase(users);
    const reinstateUser = new ReinstateUserUseCase(users);

    const suspended = await suspendUser.execute({ userId });
    expect(suspended.suspendedAt).not.toBeNull();

    // Double suspension is rejected by the aggregate itself.
    await expect(suspendUser.execute({ userId })).rejects.toThrow(/already suspended/);

    const reinstated = await reinstateUser.execute({ userId });
    expect(reinstated.suspendedAt).toBeNull();
    await expect(reinstateUser.execute({ userId })).rejects.toThrow(/not suspended/);
  });

  it("returns NotFoundError for unknown ids", async () => {
    const suspendUser = new SuspendUserUseCase(users);
    await expect(
      suspendUser.execute({ userId: "99999999-9999-9999-9999-999999999999" })
    ).rejects.toThrow(NotFoundError);
  });
});


