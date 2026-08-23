import { prisma } from "@sitedock/database";
import { EmailAddress, UserId, WorkspaceId } from "@sitedock/shared";
import { WorkspaceInvitation } from "../domain/workspace-invitation.entity";
import { WorkspaceInvitationRepository } from "../domain/ports";
import { WorkspaceRole } from "../domain/workspace.entity";

type InvitationRow = {
  id: string;
  workspaceId: string;
  email: string;
  role: string;
  tokenHash: string;
  status: string;
  invitedById: string;
  expiresAt: Date;
  acceptedAt: Date | null;
  createdAt: Date;
};

function toDomain(row: InvitationRow): WorkspaceInvitation {
  return WorkspaceInvitation.hydrate({
    id: row.id,
    workspaceId: WorkspaceId(row.workspaceId),
    email: EmailAddress.create(row.email),
    role: row.role as Exclude<WorkspaceRole, "OWNER">,
    tokenHash: row.tokenHash,
    status: row.status as WorkspaceInvitation["status"],
    invitedById: UserId(row.invitedById),
    expiresAt: row.expiresAt,
    acceptedAt: row.acceptedAt,
    createdAt: row.createdAt,
  });
}

export class PrismaWorkspaceInvitationRepository implements WorkspaceInvitationRepository {
  async findByTokenHash(tokenHash: string): Promise<WorkspaceInvitation | null> {
    const row = await prisma.workspaceInvitation.findUnique({ where: { tokenHash } });
    return row ? toDomain(row) : null;
  }

  async findPendingByEmail(workspaceId: WorkspaceId, email: string): Promise<WorkspaceInvitation | null> {
    const row = await prisma.workspaceInvitation.findFirst({
      where: { workspaceId, email: email.toLowerCase(), status: "PENDING" },
    });
    return row ? toDomain(row) : null;
  }

  async save(invitation: WorkspaceInvitation): Promise<void> {
    await prisma.workspaceInvitation.upsert({
      where: { id: invitation.id },
      create: {
        id: invitation.id,
        workspaceId: invitation.workspaceId,
        email: invitation.email.value,
        role: invitation.role,
        tokenHash: invitation.tokenHash,
        status: invitation.status,
        invitedById: invitation.invitedById,
        expiresAt: invitation.expiresAt,
        acceptedAt: invitation.acceptedAt,
      },
      update: {
        status: invitation.status,
        acceptedAt: invitation.acceptedAt,
      },
    });
  }
}
