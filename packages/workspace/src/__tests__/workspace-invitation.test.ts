import { describe, expect, it, beforeEach } from "vitest";
import { ConflictError, DomainError, EmailAddress, UserId, WorkspaceId } from "@sitedock/shared";
import { WorkspaceInvitation } from "../domain/workspace-invitation.entity";
import { Workspace } from "../domain/workspace.entity";
import { WorkspaceInvitationRepository, WorkspaceRepository } from "../domain/ports";
import { CreateWorkspaceInvitationUseCase } from "../application/create-workspace-invitation.use-case";
import { AcceptWorkspaceInvitationUseCase } from "../application/accept-workspace-invitation.use-case";

const WORKSPACE = WorkspaceId("11111111-1111-1111-1111-111111111111");
const OWNER = UserId("22222222-2222-2222-2222-222222222222");
const CLIENT_USER = UserId("33333333-3333-3333-3333-333333333333");

function newInvitation(now = new Date("2026-01-01T00:00:00Z")) {
  return WorkspaceInvitation.create({
    id: "inv-1",
    workspaceId: WORKSPACE,
    email: "cliente@restaurante.com",
    role: "CLIENT",
    tokenHash: "hash123",
    invitedById: OWNER,
    now,
  });
}

describe("WorkspaceInvitation aggregate", () => {
  it("starts PENDING with a 7-day expiry", () => {
    const inv = newInvitation(new Date("2026-01-01T00:00:00Z"));
    expect(inv.status).toBe("PENDING");
    expect(inv.expiresAt.toISOString()).toBe("2026-01-08T00:00:00.000Z");
  });

  it("accepts when the email matches and it hasn't expired", () => {
    const inv = newInvitation(new Date("2026-01-01T00:00:00Z"));
    inv.accept(EmailAddress.create("cliente@restaurante.com"), new Date("2026-01-03T00:00:00Z"));
    expect(inv.status).toBe("ACCEPTED");
    expect(inv.acceptedAt).not.toBeNull();
  });

  it("rejects acceptance from a different email", () => {
    const inv = newInvitation(new Date("2026-01-01T00:00:00Z"));
    expect(() => inv.accept(EmailAddress.create("otro@example.com"), new Date("2026-01-03T00:00:00Z"))).toThrow(
      /different email/
    );
    expect(inv.status).toBe("PENDING"); // unchanged
  });

  it("marks itself EXPIRED and rejects acceptance once past expiresAt", () => {
    const inv = newInvitation(new Date("2026-01-01T00:00:00Z"));
    expect(() =>
      inv.accept(EmailAddress.create("cliente@restaurante.com"), new Date("2026-01-10T00:00:00Z"))
    ).toThrow(/expired/);
    expect(inv.status).toBe("EXPIRED");
  });

  it("cannot be accepted twice", () => {
    const inv = newInvitation(new Date("2026-01-01T00:00:00Z"));
    inv.accept(EmailAddress.create("cliente@restaurante.com"), new Date("2026-01-02T00:00:00Z"));
    expect(() => inv.accept(EmailAddress.create("cliente@restaurante.com"))).toThrow(DomainError);
  });

  it("can be revoked while PENDING", () => {
    const inv = newInvitation();
    inv.revoke();
    expect(inv.status).toBe("REVOKED");
  });

  it("cannot be revoked once ACCEPTED", () => {
    const inv = newInvitation(new Date("2026-01-01T00:00:00Z"));
    inv.accept(EmailAddress.create("cliente@restaurante.com"), new Date("2026-01-02T00:00:00Z"));
    expect(() => inv.revoke()).toThrow(DomainError);
  });
});

class InMemoryInvitationRepository implements WorkspaceInvitationRepository {
  store = new Map<string, WorkspaceInvitation>();
  async findByTokenHash(tokenHash: string) {
    return [...this.store.values()].find((i) => i.tokenHash === tokenHash) ?? null;
  }
  async findPendingByEmail(workspaceId: string, email: string) {
    return (
      [...this.store.values()].find((i) => i.workspaceId === workspaceId && i.email.value === email && i.status === "PENDING") ??
      null
    );
  }
  async save(invitation: WorkspaceInvitation) {
    this.store.set(invitation.id, invitation);
  }
}

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

describe("CreateWorkspaceInvitationUseCase", () => {
  it("creates a pending invitation and returns a raw token", async () => {
    const repo = new InMemoryInvitationRepository();
    const useCase = new CreateWorkspaceInvitationUseCase(repo);

    const result = await useCase.execute({ workspaceId: WORKSPACE, email: "cliente@restaurante.com", role: "CLIENT", invitedById: OWNER });

    expect(result.rawToken).toHaveLength(64);
    expect(repo.store.size).toBe(1);
  });

  it("rejects a duplicate pending invitation for the same email", async () => {
    const repo = new InMemoryInvitationRepository();
    const useCase = new CreateWorkspaceInvitationUseCase(repo);

    await useCase.execute({ workspaceId: WORKSPACE, email: "cliente@restaurante.com", role: "CLIENT", invitedById: OWNER });
    await expect(
      useCase.execute({ workspaceId: WORKSPACE, email: "cliente@restaurante.com", role: "CLIENT", invitedById: OWNER })
    ).rejects.toThrow(ConflictError);
  });
});

describe("AcceptWorkspaceInvitationUseCase", () => {
  let invitations: InMemoryInvitationRepository;
  let workspaces: InMemoryWorkspaceRepository;

  beforeEach(() => {
    invitations = new InMemoryInvitationRepository();
    const ws = Workspace.create({ id: WORKSPACE, name: "Studio XYZ", ownerId: OWNER });
    workspaces = new InMemoryWorkspaceRepository(new Map([[ws.id, ws]]));
  });

  it("adds the accepting user to the workspace with the invited role", async () => {
    const createInvitation = new CreateWorkspaceInvitationUseCase(invitations);
    const { rawToken } = await createInvitation.execute({
      workspaceId: WORKSPACE,
      email: "cliente@restaurante.com",
      role: "CLIENT",
      invitedById: OWNER,
    });

    const accept = new AcceptWorkspaceInvitationUseCase(invitations, workspaces);
    const result = await accept.execute({ rawToken, acceptingUserId: CLIENT_USER, acceptingUserEmail: "cliente@restaurante.com" });

    expect(result.workspaceId).toBe(WORKSPACE);
    const ws = await workspaces.findById(WORKSPACE);
    expect(ws?.roleOf(CLIENT_USER)).toBe("CLIENT");
  });

  it("rejects an unknown token", async () => {
    const accept = new AcceptWorkspaceInvitationUseCase(invitations, workspaces);
    await expect(
      accept.execute({ rawToken: "not-a-real-token", acceptingUserId: CLIENT_USER, acceptingUserEmail: "cliente@restaurante.com" })
    ).rejects.toThrow(/Invalid or unknown/);
  });

  it("rejects acceptance from an email that doesn't match the invitation", async () => {
    const createInvitation = new CreateWorkspaceInvitationUseCase(invitations);
    const { rawToken } = await createInvitation.execute({
      workspaceId: WORKSPACE,
      email: "cliente@restaurante.com",
      role: "CLIENT",
      invitedById: OWNER,
    });

    const accept = new AcceptWorkspaceInvitationUseCase(invitations, workspaces);
    await expect(
      accept.execute({ rawToken, acceptingUserId: CLIENT_USER, acceptingUserEmail: "impostor@example.com" })
    ).rejects.toThrow(/different email/);
  });

  it("is idempotent if the user somehow already became a member", async () => {
    const createInvitation = new CreateWorkspaceInvitationUseCase(invitations);
    const { rawToken } = await createInvitation.execute({
      workspaceId: WORKSPACE,
      email: "cliente@restaurante.com",
      role: "CLIENT",
      invitedById: OWNER,
    });

    const ws = await workspaces.findById(WORKSPACE);
    ws!.addMember(CLIENT_USER, "CLIENT");
    await workspaces.save(ws!);

    const accept = new AcceptWorkspaceInvitationUseCase(invitations, workspaces);
    await expect(
      accept.execute({ rawToken, acceptingUserId: CLIENT_USER, acceptingUserEmail: "cliente@restaurante.com" })
    ).resolves.toEqual({ workspaceId: WORKSPACE });
  });
});

