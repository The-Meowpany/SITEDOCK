import { describe, expect, it, beforeEach } from "vitest";
import { AuditEntry } from "../domain/audit-entry.entity";
import { AuditLogListOptions, AuditLogRepository } from "../domain/ports";
import { ListPlatformAuditLogUseCase, ListWorkspaceAuditLogUseCase, RecordAuditEntryUseCase } from "../application/audit.use-cases";

class InMemoryAuditLogRepository implements AuditLogRepository {
  entries: AuditEntry[] = [];

  async record(entry: AuditEntry) {
    this.entries.push(entry);
  }
  async listByWorkspace(workspaceId: string, options?: AuditLogListOptions) {
    return this.entries
      .filter((e) => e.workspaceId === workspaceId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, options?.limit ?? 100);
  }
  async listAll(options?: AuditLogListOptions) {
    return [...this.entries].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, options?.limit ?? 100);
  }
}

describe("AuditEntry", () => {
  it("is created with all fields and no mutation methods", () => {
    const entry = AuditEntry.create({
      id: "e1",
      workspaceId: "ws1",
      actorId: "user1",
      action: "WEBSITE_CREATED",
      resourceType: "Website",
      resourceId: "site1",
      metadata: { name: "Restaurante Pérez" },
    });

    expect(entry.action).toBe("WEBSITE_CREATED");
    expect(entry.resourceId).toBe("site1");
    expect(entry.metadata).toEqual({ name: "Restaurante Pérez" });
    // The class exposes only getters — no setter or update method exists at all,
    // which is the actual enforcement of "append-only" here (TypeScript would
    // reject `entry.action = "X"` at compile time since there's no such property).
  });

  it("defaults resourceId and metadata to null when omitted", () => {
    const entry = AuditEntry.create({ id: "e1", workspaceId: null, actorId: null, action: "USER_LOGIN", resourceType: "User" });
    expect(entry.resourceId).toBeNull();
    expect(entry.metadata).toBeNull();
    expect(entry.workspaceId).toBeNull();
    expect(entry.actorId).toBeNull();
  });
});

describe("RecordAuditEntryUseCase", () => {
  it("records an entry into the repository", async () => {
    const repo = new InMemoryAuditLogRepository();
    const useCase = new RecordAuditEntryUseCase(repo);

    await useCase.execute({
      workspaceId: "ws1",
      actorId: "user1",
      action: "PAYMENT_RECEIVED",
      resourceType: "Subscription",
      resourceId: "sub1",
      metadata: { amountCents: 2900 },
    });

    expect(repo.entries).toHaveLength(1);
    expect(repo.entries[0]!.action).toBe("PAYMENT_RECEIVED");
  });
});

describe("ListWorkspaceAuditLogUseCase — tenant isolation", () => {
  let repo: InMemoryAuditLogRepository;

  beforeEach(async () => {
    repo = new InMemoryAuditLogRepository();
    const record = new RecordAuditEntryUseCase(repo);
    await record.execute({ workspaceId: "ws-a", actorId: "u1", action: "WEBSITE_CREATED", resourceType: "Website", resourceId: "site-a" });
    await record.execute({ workspaceId: "ws-b", actorId: "u2", action: "WEBSITE_CREATED", resourceType: "Website", resourceId: "site-b" });
  });

  it("only returns entries for the requested workspace", async () => {
    const listWorkspace = new ListWorkspaceAuditLogUseCase(repo);
    const resultA = await listWorkspace.execute("ws-a");
    expect(resultA).toHaveLength(1);
    expect(resultA[0]!.resourceId).toBe("site-a");

    const resultB = await listWorkspace.execute("ws-b");
    expect(resultB).toHaveLength(1);
    expect(resultB[0]!.resourceId).toBe("site-b");
  });

  it("lists all entries across tenants only via the platform-admin use case", async () => {
    const listAll = new ListPlatformAuditLogUseCase(repo);
    const result = await listAll.execute();
    expect(result).toHaveLength(2);
  });
});
