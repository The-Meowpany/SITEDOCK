import { prisma } from "@sitedock/database";
import { UserId } from "@sitedock/shared";
import { PasswordResetRepository, SessionRepository } from "../domain/ports";

export class PrismaSessionRepository implements SessionRepository {
  async create(params: { userId: UserId; tokenHash: string; expiresAt: Date; userAgent?: string; ipAddress?: string }): Promise<void> {
    await prisma.session.create({
      data: {
        userId: params.userId,
        tokenHash: params.tokenHash,
        expiresAt: params.expiresAt,
        userAgent: params.userAgent,
        ipAddress: params.ipAddress,
      },
    });
  }

  async findByTokenHash(tokenHash: string): Promise<{ userId: UserId; expiresAt: Date } | null> {
    const row = await prisma.session.findUnique({ where: { tokenHash } });
    if (!row) return null;
    return { userId: UserId(row.userId), expiresAt: row.expiresAt };
  }

  async revokeByTokenHash(tokenHash: string): Promise<void> {
    await prisma.session.deleteMany({ where: { tokenHash } });
  }
}

export class PrismaPasswordResetRepository implements PasswordResetRepository {
  async create(params: { userId: UserId; tokenHash: string; expiresAt: Date }): Promise<void> {
    await prisma.passwordResetToken.create({
      data: { userId: params.userId, tokenHash: params.tokenHash, expiresAt: params.expiresAt },
    });
  }

  async findValidByTokenHash(tokenHash: string): Promise<{ userId: UserId } | null> {
    const row = await prisma.passwordResetToken.findUnique({ where: { tokenHash } });
    if (!row || row.usedAt || row.expiresAt < new Date()) return null;
    return { userId: UserId(row.userId) };
  }

  async markUsed(tokenHash: string): Promise<void> {
    await prisma.passwordResetToken.update({ where: { tokenHash }, data: { usedAt: new Date() } });
  }
}
