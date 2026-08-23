import { describe, expect, it, beforeEach } from "vitest";
import { ClientId, ConflictError, EmailAddress, WorkspaceId } from "@sitedock/shared";
import { Client } from "../domain/client.entity";
import { ClientRepository } from "../domain/ports";
import { CreateClientUseCase } from "../application/create-client.use-case";

const WORKSPACE_A = WorkspaceId("11111111-1111-1111-1111-111111111111");
const WORKSPACE_B = WorkspaceId("22222222-2222-2222-2222-222222222222");

class InMemoryClientRepository implements ClientRepository {
  private store = new Map<string, Client>();

  async findById(id: string) {
    return this.store.get(id) ?? null;
  }
  async findByIdInWorkspace(id: string, workspaceId: string) {
    const c = this.store.get(id);
    return c && c.workspaceId === workspaceId ? c : null;
  }
  async findByEmailInWorkspace(email: EmailAddress, workspaceId: string) {
    for (const c of this.store.values()) {
      if (c.workspaceId === workspaceId && c.email.equals(email)) return c;
    }
    return null;
  }
  async findByUserIdInWorkspace() {
    return null;
  }
  async listByWorkspace(workspaceId: string) {
    return [...this.store.values()].filter((c) => c.workspaceId === workspaceId);
  }
  async save(client: Client) {
    this.store.set(client.id, client);
  }
}

describe("Client entity", () => {
  it("creates with a trimmed name and normalized email", () => {
    const client = Client.create({
      id: ClientId("33333333-3333-3333-3333-333333333333"),
      workspaceId: WORKSPACE_A,
      fullName: "  Juan Pérez  ",
      email: "Juan@Restaurante.com",
    });
    expect(client.fullName).toBe("Juan Pérez");
    expect(client.email.value).toBe("juan@restaurante.com");
    expect(client.userId).toBeNull();
  });
});

describe("CreateClientUseCase", () => {
  let repo: InMemoryClientRepository;
  let useCase: CreateClientUseCase;

  beforeEach(() => {
    repo = new InMemoryClientRepository();
    useCase = new CreateClientUseCase(repo);
  });

  it("creates a client in a workspace", async () => {
    const result = await useCase.execute({
      workspaceId: WORKSPACE_A,
      fullName: "Juan Pérez",
      email: "juan@restaurante.com",
    });
    expect(result.clientId).toBeTruthy();
  });

  it("rejects duplicate email within the same workspace", async () => {
    await useCase.execute({ workspaceId: WORKSPACE_A, fullName: "Juan", email: "juan@restaurante.com" });
    await expect(
      useCase.execute({ workspaceId: WORKSPACE_A, fullName: "Juan 2", email: "juan@restaurante.com" })
    ).rejects.toThrow(ConflictError);
  });

  it("allows the same email across different workspaces (tenant isolation)", async () => {
    await useCase.execute({ workspaceId: WORKSPACE_A, fullName: "Juan", email: "juan@restaurante.com" });
    await expect(
      useCase.execute({ workspaceId: WORKSPACE_B, fullName: "Juan", email: "juan@restaurante.com" })
    ).resolves.toBeDefined();
  });
});

