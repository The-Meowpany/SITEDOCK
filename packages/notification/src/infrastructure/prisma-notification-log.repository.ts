import { prisma, Prisma } from "@sitedock/database";
import { NotificationLogRepository } from "../domain/ports";

export class PrismaNotificationLogRepository implements NotificationLogRepository {
  async record(params: { recipient: string; type: string; payload: unknown; sentAt: Date | null }): Promise<void> {
    await prisma.notification.create({
      data: {
        recipient: params.recipient,
        type: params.type,
        payload: params.payload as Prisma.InputJsonValue,
        sentAt: params.sentAt,
      },
    });
  }

  async hasEntrySince(params: {
    type: string;
    recipient: string;
    since: Date;
    payloadMatches?: Record<string, unknown>;
  }): Promise<boolean> {
    const entry = await prisma.notification.findFirst({
      where: {
        type: params.type,
        recipient: params.recipient,
        createdAt: { gte: params.since },
        // JSON-path filters are Postgres-specific but that is this repo's only
        // datasource (packages/database/prisma/schema.prisma).
        ...(params.payloadMatches
          ? {
              AND: Object.entries(params.payloadMatches).map(([key, value]) => ({
                payload: { path: [key], equals: value as Prisma.InputJsonValue },
              })),
            }
          : {}),
      },
      select: { id: true },
    });
    return entry !== null;
  }
}
