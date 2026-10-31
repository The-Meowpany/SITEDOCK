import { describe, it, expect, beforeEach } from "vitest";
import { UserId, WorkspaceId } from "@sitedock/shared";
import { Workspace } from "../domain/workspace.entity";
import type { WorkspaceLifecycleRepository, WorkspaceRepository } from "../domain/ports";
import {
  ChangeMemberRoleUseCase,
  DeleteWorkspaceUseCase,
  RemoveWorkspaceMemberUseCase,
  RenameWorkspaceUseCase,
  TransferWorkspaceOwnershipUseCase,
  canManageRole,
} from "../application/workspace-management.use-cases";

const WS = WorkspaceId("33333333-3333-3333-3333-333333333333");
const OWNER = UserId("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
const ADMIN = UserId("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");
const ADMIN2 = UserId("cccccccc-cccc-cccc-cccc-cccccccccccc");
const DEV = UserId("dddddddd-dddd-dddd-dddd-dddddddddddd");
const CLIENT = UserId("eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee");
const STRANGER = UserId("ffffffff-ffff-ffff-ffff-ffffffffffff");

class Repo implements WorkspaceRepository, WorkspaceLifecycleRepository {
  store = new Map<string, Workspace>();
  removed: string[] = [];
  deleted: string[] = [];
  hasResources = false;
  async findById(id: string) { return this.store.get(id) ?? null; }
  async listForUser() { return []; }
  async save(w: Workspace) { this.store.set(w.id, w); }
  async removeMember(_w: string, userId: string) { this.removed.push(userId); }
  async deleteIfEmpty(id: string) {
    if (this.hasResources) throw Object.assign(new Error("has resources"), { code: "CONFLICT" });
    this.deleted.push(id);
  }
}

let repo: Repo;
beforeEach(() => {
  repo = new Repo();
  const ws = Workspace.create({ id: WS, name: "Studio", ownerId: OWNER });
  ws.addMember(ADMIN, "ADMIN");
  ws.addMember(ADMIN2, "ADMIN");
  ws.addMember(DEV, "DEVELOPER");
  ws.addMember(CLIENT, "CLIENT");
  repo.store.set(WS, ws);
});

describe("canManageRole", () => {
  it("owner manages all but owner; admin only developer/client; others nobody", () => {
    expect(canManageRole("OWNER", "ADMIN")).toBe(true);
    expect(canManageRole("OWNER", "OWNER")).toBe(false);
    expect(canManageRole("ADMIN", "ADMIN")).toBe(false);
    expect(canManageRole("ADMIN", "DEVELOPER")).toBe(true);
    expect(canManageRole("DEVELOPER", "CLIENT")).toBe(false);
    expect(canManageRole("CLIENT", "CLIENT")).toBe(false);
  });
});

describe("Workspace aggregate invariants", () => {
  it("never lets the owner be demoted via changeMemberRole or removed", () => {
    const ws = repo.store.get(WS)!;
    expect(() => ws.changeMemberRole(OWNER, "ADMIN")).toThrow(/transferring ownership/);
    expect(() => ws.removeMember(OWNER)).toThrow(/transfer ownership first/);
  });
  it("transfer keeps exactly one owner and demotes the previous one to ADMIN", () => {
    const ws = repo.store.get(WS)!;
    ws.transferOwnership(OWNER, DEV);
    expect(ws.roleOf(DEV)).toBe("OWNER");
    expect(ws.roleOf(OWNER)).toBe("ADMIN");
    expect(ws.ownerCount()).toBe(1);
  });
  it("refuses transfer to a client, a stranger, oneself, or from a non-owner", () => {
    const ws = repo.store.get(WS)!;
    expect(() => ws.transferOwnership(OWNER, CLIENT)).toThrow(/client/i);
    expect(() => ws.transferOwnership(OWNER, STRANGER)).toThrow(/already be a member/);
    expect(() => ws.transferOwnership(OWNER, OWNER)).toThrow(/already belongs/);
    expect(() => ws.transferOwnership(ADMIN, DEV)).toThrow(/current owner/);
  });
});

describe("RenameWorkspaceUseCase", () => {
  it("allows owner/admin and rejects developers and strangers", async () => {
    const uc = new RenameWorkspaceUseCase(repo);
    expect(await uc.execute({ workspaceId: WS, actorId: ADMIN, name: " New Name " })).toEqual({ name: "New Name" });
    await expect(uc.execute({ workspaceId: WS, actorId: DEV, name: "Nope" })).rejects.toThrow(/owners and admins/);
    await expect(uc.execute({ workspaceId: WS, actorId: STRANGER, name: "Nope" })).rejects.toThrow(/access/);
  });
});

describe("ChangeMemberRoleUseCase", () => {
  const uc = () => new ChangeMemberRoleUseCase(repo);
  it("owner can promote a developer to admin", async () => {
    await uc().execute({ workspaceId: WS, actorId: OWNER, targetUserId: DEV, role: "ADMIN" });
    expect(repo.store.get(WS)!.roleOf(DEV)).toBe("ADMIN");
  });
  it("admin cannot mint admins, demote admins, or touch the owner", async () => {
    await expect(uc().execute({ workspaceId: WS, actorId: ADMIN, targetUserId: DEV, role: "ADMIN" })).rejects.toThrow(/not allowed/);
    await expect(uc().execute({ workspaceId: WS, actorId: ADMIN, targetUserId: ADMIN2, role: "CLIENT" })).rejects.toThrow(/not allowed/);
    await expect(uc().execute({ workspaceId: WS, actorId: ADMIN, targetUserId: OWNER, role: "CLIENT" })).rejects.toThrow(/not allowed/);
  });
  it("admin can move a developer to client; nobody changes their own role; developers manage nobody", async () => {
    await uc().execute({ workspaceId: WS, actorId: ADMIN, targetUserId: DEV, role: "CLIENT" });
    await expect(uc().execute({ workspaceId: WS, actorId: ADMIN, targetUserId: ADMIN, role: "DEVELOPER" })).rejects.toThrow(/own role/);
    await expect(uc().execute({ workspaceId: WS, actorId: DEV, targetUserId: CLIENT, role: "DEVELOPER" })).rejects.toThrow(/not allowed/);
  });
  it("404s for a non-member target and never leaks across tenants", async () => {
    await expect(uc().execute({ workspaceId: WS, actorId: OWNER, targetUserId: STRANGER, role: "CLIENT" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(uc().execute({ workspaceId: WS, actorId: STRANGER, targetUserId: DEV, role: "CLIENT" })).rejects.toThrow(/access/);
  });
});

describe("RemoveWorkspaceMemberUseCase", () => {
  const uc = () => new RemoveWorkspaceMemberUseCase(repo, repo);
  it("owner removes an admin; admin removes a client but not another admin", async () => {
    await uc().execute({ workspaceId: WS, actorId: OWNER, targetUserId: ADMIN2 });
    await uc().execute({ workspaceId: WS, actorId: ADMIN, targetUserId: CLIENT });
    expect(repo.removed).toEqual([ADMIN2, CLIENT]);
    repo.store.get(WS)!.addMember(ADMIN2, "ADMIN");
    await expect(uc().execute({ workspaceId: WS, actorId: ADMIN, targetUserId: ADMIN2 })).rejects.toThrow(/not allowed/);
  });
  it("a member may leave voluntarily, but the owner can never be removed (even by themselves)", async () => {
    await uc().execute({ workspaceId: WS, actorId: DEV, targetUserId: DEV });
    expect(repo.removed).toEqual([DEV]);
    await expect(uc().execute({ workspaceId: WS, actorId: OWNER, targetUserId: OWNER })).rejects.toThrow(/transfer ownership first/);
    await expect(uc().execute({ workspaceId: WS, actorId: ADMIN, targetUserId: OWNER })).rejects.toThrow(/not allowed/);
    expect(repo.removed).toEqual([DEV]);
  });
});

describe("TransferWorkspaceOwnershipUseCase", () => {
  it("only the owner can transfer; result persisted with one owner", async () => {
    const uc = new TransferWorkspaceOwnershipUseCase(repo);
    await expect(uc.execute({ workspaceId: WS, actorId: ADMIN, newOwnerUserId: DEV })).rejects.toThrow(/current owner/);
    await uc.execute({ workspaceId: WS, actorId: OWNER, newOwnerUserId: ADMIN });
    const ws = repo.store.get(WS)!;
    expect(ws.roleOf(ADMIN)).toBe("OWNER");
    expect(ws.roleOf(OWNER)).toBe("ADMIN");
    expect(ws.ownerCount()).toBe(1);
  });
});

describe("DeleteWorkspaceUseCase", () => {
  const uc = () => new DeleteWorkspaceUseCase(repo, repo);
  it("requires the owner and the exact workspace name", async () => {
    await expect(uc().execute({ workspaceId: WS, actorId: ADMIN, confirmName: "Studio" })).rejects.toThrow(/Only the owner/);
    await expect(uc().execute({ workspaceId: WS, actorId: OWNER, confirmName: "studio" })).rejects.toThrow(/does not match/);
    expect(repo.deleted).toEqual([]);
    await uc().execute({ workspaceId: WS, actorId: OWNER, confirmName: "Studio" });
    expect(repo.deleted).toEqual([WS]);
  });
  it("propagates the refusal when the workspace still has resources", async () => {
    repo.hasResources = true;
    await expect(uc().execute({ workspaceId: WS, actorId: OWNER, confirmName: "Studio" })).rejects.toThrow(/has resources/);
    expect(repo.deleted).toEqual([]);
  });
});
