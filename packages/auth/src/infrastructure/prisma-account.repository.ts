import { prisma } from "@sitedock/database";
import { UserId } from "@sitedock/shared";
import { AccountDeletionRepository, SessionAdminRepository, SessionSummary } from "../domain/ports";

export class PrismaSessionAdminRepository implements SessionAdminRepository {
  async listActiveByUserId(userId: UserId, now: Date): Promise<SessionSummary[]> {
    const rows = await prisma.session.findMany({
      where: { userId, expiresAt: { gt: now } },
      orderBy: { createdAt: "desc" },
    });
    return rows.map((r) => ({
      id: r.id,
      tokenHash: r.tokenHash,
      userAgent: r.userAgent,
      ipAddress: r.ipAddress,
      createdAt: r.createdAt,
      expiresAt: r.expiresAt,
    }));
  }

  async revokeAllByUserId(userId: UserId, exceptTokenHash?: string): Promise<number> {
    const result = await prisma.session.deleteMany({
      where: { userId, ...(exceptTokenHash ? { tokenHash: { not: exceptTokenHash } } : {}) },
    });
    return result.count;
  }

  async revokeByIdForUser(userId: UserId, sessionId: string): Promise<boolean> {
    // The userId in the filter is the ownership check: ids of other users' sessions match nothing.
    const result = await prisma.session.deleteMany({ where: { id: sessionId, userId } });
    return result.count > 0;
  }
}

export class PrismaAccountDeletionRepository implements AccountDeletionRepository {
  async findSoleOwnerWorkspaceIds(userId: UserId): Promise<string[]> {
    const owned = await prisma.workspaceMember.findMany({
      where: { userId, role: "OWNER" },
      select: { workspaceId: true },
    });
    if (owned.length === 0) return [];
    const counts = await prisma.workspaceMember.groupBy({
      by: ["workspaceId"],
      where: { workspaceId: { in: owned.map((o) => o.workspaceId) }, role: "OWNER" },
      _count: { _all: true },
    });
    return counts.filter((c) => c._count._all === 1).map((c) => c.workspaceId);
  }

  async deleteUser(userId: UserId): Promise<void> {
    // Sessions, memberships, reset tokens and org memberships cascade; audit rows keep
    // their history with actorId set to NULL.
    await prisma.user.delete({ where: { id: userId } });
  }
}
