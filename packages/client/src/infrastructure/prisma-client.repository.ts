import { prisma } from "@sitedock/database";
import { ClientId, EmailAddress, UserId, WorkspaceId } from "@sitedock/shared";
import { Client } from "../domain/client.entity";
import { ClientRepository } from "../domain/ports";

type ClientRow = {
  id: string;
  workspaceId: string;
  fullName: string;
  email: string;
  userId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

function toDomain(row: ClientRow): Client {
  return Client.hydrate({
    id: ClientId(row.id),
    workspaceId: WorkspaceId(row.workspaceId),
    fullName: row.fullName,
    email: EmailAddress.create(row.email),
    userId: row.userId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

export class PrismaClientRepository implements ClientRepository {
  async findById(id: ClientId): Promise<Client | null> {
    const row = await prisma.client.findUnique({ where: { id } });
    return row ? toDomain(row) : null;
  }

  async findByIdInWorkspace(id: ClientId, workspaceId: WorkspaceId): Promise<Client | null> {
    const row = await prisma.client.findFirst({ where: { id, workspaceId } });
    return row ? toDomain(row) : null;
  }

  async findByEmailInWorkspace(email: EmailAddress, workspaceId: WorkspaceId): Promise<Client | null> {
    const row = await prisma.client.findUnique({
      where: { workspaceId_email: { workspaceId, email: email.value } },
    });
    return row ? toDomain(row) : null;
  }

  async findByUserIdInWorkspace(userId: UserId, workspaceId: WorkspaceId): Promise<Client | null> {
    const row = await prisma.client.findFirst({ where: { userId, workspaceId } });
    return row ? toDomain(row) : null;
  }

  async listByWorkspace(workspaceId: WorkspaceId): Promise<Client[]> {
    const rows = await prisma.client.findMany({ where: { workspaceId }, orderBy: { createdAt: "desc" } });
    return rows.map(toDomain);
  }

  async save(client: Client): Promise<void> {
    await prisma.client.upsert({
      where: { id: client.id },
      create: {
        id: client.id,
        workspaceId: client.workspaceId,
        fullName: client.fullName,
        email: client.email.value,
        userId: client.userId,
      },
      update: {
        fullName: client.fullName,
        userId: client.userId,
      },
    });
  }
}
