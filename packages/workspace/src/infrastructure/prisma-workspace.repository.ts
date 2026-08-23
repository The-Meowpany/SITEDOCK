import { prisma, Prisma } from "@sitedock/database";
import { UserId, WorkspaceId } from "@sitedock/shared";
import { Workspace } from "../domain/workspace.entity";
import { WorkspaceRepository } from "../domain/ports";

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

export class PrismaWorkspaceRepository implements WorkspaceRepository {
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
    });
  }
}


