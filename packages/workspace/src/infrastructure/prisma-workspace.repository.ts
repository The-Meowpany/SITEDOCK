import { prisma, Prisma } from "@sitedock/database";
import { ConflictError, UserId, WorkspaceId } from "@sitedock/shared";
import { Workspace } from "../domain/workspace.entity";
import { WorkspaceLifecycleRepository, WorkspaceRepository } from "../domain/ports";

type WorkspaceRow = {
  id: string;
  name: string;
  slug: string;
  branding: unknown;
  createdAt: Date;
  updatedAt: Date;
  members: { userId: string; role: string; joinedAt: Date | null }[];
};

function toDomain(row: WorkspaceRow): Workspace {
  return Workspace.hydrate({
    id: WorkspaceId(row.id),
    name: row.name,
    slug: row.slug,
    branding: (row.branding as Record<string, unknown>) ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    members: row.members.map((m) => ({
      userId: UserId(m.userId),
      role: m.role as Workspace["members"][number]["role"],
      joinedAt: m.joinedAt,
    })),
  });
}

const include = { members: true } as const;

export class PrismaWorkspaceRepository implements WorkspaceRepository, WorkspaceLifecycleRepository {
  async findById(id: WorkspaceId): Promise<Workspace | null> {
    const row = await prisma.workspace.findUnique({ where: { id }, include });
    return row ? toDomain(row) : null;
  }

  async listForUser(userId: UserId): Promise<Workspace[]> {
    const rows = await prisma.workspace.findMany({
      where: { members: { some: { userId } } },
      include,
      orderBy: { createdAt: "asc" },
    });
    return rows.map(toDomain);
  }

  async save(workspace: Workspace): Promise<void> {
    // `tx` is typed `any` here because this environment could not run `prisma generate`
    // (see docs/LOCAL_DEVELOPMENT.md troubleshooting) — on a normal dev machine the
    // generated PrismaClient types make this inference work without an annotation.
    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // Serialise membership changes per workspace so two concurrent role changes cannot
      // both pass their own owner check and leave the workspace ownerless.
      await tx.$queryRaw`SELECT id FROM "workspaces" WHERE id = ${workspace.id} FOR UPDATE`;
      await tx.workspace.upsert({
        where: { id: workspace.id },
        create: { id: workspace.id, name: workspace.name, slug: workspace.slug, branding: workspace.branding === null ? Prisma.DbNull : workspace.branding as Prisma.InputJsonValue },
        update: { name: workspace.name, branding: workspace.branding === null ? Prisma.DbNull : workspace.branding as Prisma.InputJsonValue },
      });

      for (const member of workspace.members) {
        await tx.workspaceMember.upsert({
          where: { workspaceId_userId: { workspaceId: workspace.id, userId: member.userId } },
          create: {
            workspaceId: workspace.id,
            userId: member.userId,
            role: member.role,
            joinedAt: member.joinedAt,
          },
          update: { role: member.role, joinedAt: member.joinedAt },
        });
      }

      const owners = await tx.workspaceMember.count({ where: { workspaceId: workspace.id, role: "OWNER" } });
      if (owners < 1) {
        // Throwing inside the transaction rolls every upsert back. (>= 1, not == 1, so legacy rows
        // that already deviate from the single-owner convention keep working.)
        throw new ConflictError("A workspace must always have an owner");
      }
    });
  }

  async removeMember(workspaceId: WorkspaceId, userId: UserId): Promise<void> {
    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.$queryRaw`SELECT id FROM "workspaces" WHERE id = ${workspaceId} FOR UPDATE`;
      const row = await tx.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId, userId } },
        select: { role: true },
      });
      if (!row) return;
      if (row.role === "OWNER") {
        throw new ConflictError("The owner cannot be removed: transfer ownership first");
      }
      await tx.workspaceMember.delete({ where: { workspaceId_userId: { workspaceId, userId } } });
    });
  }

  async deleteIfEmpty(workspaceId: WorkspaceId): Promise<void> {
    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.$queryRaw`SELECT id FROM "workspaces" WHERE id = ${workspaceId} FOR UPDATE`;
      const [projects, websites] = await Promise.all([
        tx.project.count({ where: { workspaceId } }),
        tx.website.count({ where: { workspaceId } }),
      ]);
      if (projects > 0 || websites > 0) {
        throw new ConflictError(
          "This workspace still has projects or websites. Delete them first so their runtime, DNS and storage are cleaned up."
        );
      }
      await tx.workspace.delete({ where: { id: workspaceId } });
    });
  }
}


