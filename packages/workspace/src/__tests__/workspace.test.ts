import { describe, expect, it } from "vitest";
import { ConflictError, ForbiddenError, NotFoundError, UserId, WorkspaceId } from "@sitedock/shared";
import { Workspace } from "../domain/workspace.entity";
import { WorkspaceRepository } from "../domain/ports";
import { AssertWorkspaceAccessUseCase } from "../application/assert-workspace-access.use-case";
import { AddWorkspaceMemberUseCase } from "../application/add-workspace-member.use-case";

const OWNER = UserId("11111111-1111-1111-1111-111111111111");
const OTHER_USER = UserId("22222222-2222-2222-2222-222222222222");

describe("Workspace aggregate", () => {
  it("creates with the creator as OWNER", () => {
    const ws = Workspace.create({ id: WorkspaceId("33333333-3333-3333-3333-333333333333"), name: "Studio XYZ", ownerId: OWNER });
    expect(ws.roleOf(OWNER)).toBe("OWNER");
    expect(ws.members).toHaveLength(1);
  });

  it("generates a URL-safe unique slug", () => {
    const ws = Workspace.create({
      id: WorkspaceId("33333333-3333-3333-3333-333333333333"),
      name: "Café Pérez!!",
      ownerId: OWNER,
    });
    expect(ws.slug).toMatch(/^cafe-perez-[0-9a-f]{8}$/);
  });

  it("prevents adding a duplicate member (tenant membership invariant)", () => {
    const ws = Workspace.create({ id: WorkspaceId("33333333-3333-3333-3333-333333333333"), name: "Studio XYZ", ownerId: OWNER });
    expect(() => ws.addMember(OWNER, "DEVELOPER")).toThrow(ConflictError);
  });

  it("adds a new member with a non-owner role", () => {
    const ws = Workspace.create({ id: WorkspaceId("33333333-3333-3333-3333-333333333333"), name: "Studio XYZ", ownerId: OWNER });
    ws.addMember(OTHER_USER, "CLIENT");
    expect(ws.roleOf(OTHER_USER)).toBe("CLIENT");
  });
});

class InMemoryWorkspaceRepository implements WorkspaceRepository {
  constructor(private store: Map<string, Workspace>) {}
  async findById(id: string) {
    return this.store.get(id) ?? null;
  }
  async listForUser(userId: string) {
    return [...this.store.values()].filter((w) => w.hasMember(userId as never));
  }
  async save(workspace: Workspace) {
    this.store.set(workspace.id, workspace);
  }
}

describe("AssertWorkspaceAccessUseCase (tenant isolation gate)", () => {
  it("throws NotFoundError for a workspace that doesn't exist", async () => {
    const repo = new InMemoryWorkspaceRepository(new Map());
    const useCase = new AssertWorkspaceAccessUseCase(repo);
    await expect(
      useCase.execute({ workspaceId: "99999999-9999-9999-9999-999999999999", userId: OWNER })
    ).rejects.toThrow(NotFoundError);
  });

  it("throws ForbiddenError when the user is not a member — tenant B cannot see tenant A", async () => {
    const ws = Workspace.create({ id: WorkspaceId("33333333-3333-3333-3333-333333333333"), name: "Tenant A", ownerId: OWNER });
    const repo = new InMemoryWorkspaceRepository(new Map([[ws.id, ws]]));
    const useCase = new AssertWorkspaceAccessUseCase(repo);

    await expect(useCase.execute({ workspaceId: ws.id, userId: OTHER_USER })).rejects.toThrow(ForbiddenError);
  });

  it("throws ForbiddenError when role is insufficient for the required action", async () => {
    const ws = Workspace.create({ id: WorkspaceId("33333333-3333-3333-3333-333333333333"), name: "Tenant A", ownerId: OWNER });
    ws.addMember(OTHER_USER, "CLIENT");
    const repo = new InMemoryWorkspaceRepository(new Map([[ws.id, ws]]));
    const useCase = new AssertWorkspaceAccessUseCase(repo);

    await expect(
      useCase.execute({ workspaceId: ws.id, userId: OTHER_USER, requiredRoles: ["OWNER", "ADMIN"] })
    ).rejects.toThrow(ForbiddenError);
  });

  it("succeeds and returns the workspace for a legitimate member", async () => {
    const ws = Workspace.create({ id: WorkspaceId("33333333-3333-3333-3333-333333333333"), name: "Tenant A", ownerId: OWNER });
    const repo = new InMemoryWorkspaceRepository(new Map([[ws.id, ws]]));
    const useCase = new AssertWorkspaceAccessUseCase(repo);

    const result = await useCase.execute({ workspaceId: ws.id, userId: OWNER });
    expect(result.id).toBe(ws.id);
  });
});

describe("AddWorkspaceMemberUseCase (invite client)", () => {
  it("adds a new member with the given role", async () => {
    const ws = Workspace.create({ id: WorkspaceId("33333333-3333-3333-3333-333333333333"), name: "Tenant A", ownerId: OWNER });
    const repo = new InMemoryWorkspaceRepository(new Map([[ws.id, ws]]));
    const useCase = new AddWorkspaceMemberUseCase(repo);

    await useCase.execute({ workspaceId: ws.id, targetUserId: OTHER_USER, role: "CLIENT" });

    const updated = await repo.findById(ws.id);
    expect(updated?.roleOf(OTHER_USER)).toBe("CLIENT");
  });

  it("throws NotFoundError for a workspace that doesn't exist", async () => {
    const repo = new InMemoryWorkspaceRepository(new Map());
    const useCase = new AddWorkspaceMemberUseCase(repo);

    await expect(
      useCase.execute({ workspaceId: "99999999-9999-9999-9999-999999999999", targetUserId: OTHER_USER, role: "CLIENT" })
    ).rejects.toThrow(NotFoundError);
  });

  it("rejects adding a user who is already a member — the aggregate's own invariant", async () => {
    const ws = Workspace.create({ id: WorkspaceId("33333333-3333-3333-3333-333333333333"), name: "Tenant A", ownerId: OWNER });
    const repo = new InMemoryWorkspaceRepository(new Map([[ws.id, ws]]));
    const useCase = new AddWorkspaceMemberUseCase(repo);

    await expect(useCase.execute({ workspaceId: ws.id, targetUserId: OWNER, role: "CLIENT" })).rejects.toThrow(ConflictError);
  });
});

