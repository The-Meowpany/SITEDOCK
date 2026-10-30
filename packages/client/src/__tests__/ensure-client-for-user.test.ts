import { describe, expect, it } from "vitest";
import { ClientId, EmailAddress, UserId, WorkspaceId } from "@sitedock/shared";
import { Client } from "../domain/client.entity";
import { ClientRepository } from "../domain/ports";
import { EnsureClientForUserUseCase } from "../application/ensure-client-for-user.use-case";

const WORKSPACE = WorkspaceId("11111111-1111-1111-1111-111111111111");
const USER = UserId("33333333-3333-3333-3333-333333333333");
const EMAIL = "cliente@restaurante.com";

class InMemoryClientRepository implements ClientRepository {
  private store = new Map<string, Client>();

  async findById(id: string) {
    return this.store.get(id) ?? null;
  }
  async findByIdInWorkspace(id: string, workspaceId: string) {
    const client = this.store.get(id);
    return client && client.workspaceId === workspaceId ? client : null;
  }
  async findByEmailInWorkspace(email: EmailAddress, workspaceId: string) {
    for (const client of this.store.values()) {
      if (client.workspaceId === workspaceId && client.email.equals(email)) return client;
    }
    return null;
  }
  async findByUserIdInWorkspace(userId: string, workspaceId: string) {
    for (const client of this.store.values()) {
      if (client.workspaceId === workspaceId && client.userId === userId) return client;
    }
    return null;
  }
  async listByWorkspace(workspaceId: string) {
    return [...this.store.values()].filter((client) => client.workspaceId === workspaceId);
  }
  async save(client: Client) {
    this.store.set(client.id, client);
  }
}

describe("EnsureClientForUserUseCase", () => {
  it("links an existing unlinked client record to the accepting user", async () => {
    const repo = new InMemoryClientRepository();
    const existing = Client.create({
      id: ClientId("44444444-4444-4444-4444-444444444444"),
      workspaceId: WORKSPACE,
      fullName: "Cliente Existente",
      email: EMAIL,
    });
    await repo.save(existing);

    const result = await new EnsureClientForUserUseCase(repo).execute({
      workspaceId: WORKSPACE,
      userId: USER,
      fullName: "Cliente Existente",
      email: EMAIL,
    });

    expect(result).toEqual({ clientId: existing.id, created: false });
    expect((await repo.findByEmailInWorkspace(EmailAddress.create(EMAIL), WORKSPACE))?.userId).toBe(USER);
  });

  it("creates and links a client when no client record exists", async () => {
    const repo = new InMemoryClientRepository();
    const result = await new EnsureClientForUserUseCase(repo).execute({
      workspaceId: WORKSPACE,
      userId: USER,
      fullName: "Cliente Nuevo",
      email: EMAIL,
    });

    expect(result.created).toBe(true);
    const client = await repo.findByEmailInWorkspace(EmailAddress.create(EMAIL), WORKSPACE);
    expect(client?.userId).toBe(USER);
    expect(client?.fullName).toBe("Cliente Nuevo");
  });

  it("does not create a duplicate client when run twice", async () => {
    const repo = new InMemoryClientRepository();
    const useCase = new EnsureClientForUserUseCase(repo);
    const command = { workspaceId: WORKSPACE, userId: USER, fullName: "Cliente Nuevo", email: EMAIL };

    await useCase.execute(command);
    const second = await useCase.execute(command);

    expect(second.created).toBe(false);
    expect(await repo.listByWorkspace(WORKSPACE)).toHaveLength(1);
  });
});
