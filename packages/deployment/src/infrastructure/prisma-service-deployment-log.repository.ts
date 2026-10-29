import { prisma } from "@sitedock/database";
import { Prisma } from "@prisma/client";
import { DeploymentLog } from "../domain/deployment-log.entity";
import { DeploymentLogRepository } from "../domain/ports";

type ServiceDeploymentLogRow = {
  id: string;
  deploymentId: string;
  level: string;
  message: string;
  timestamp: Date;
  metadata: unknown;
};

function toDomain(row: ServiceDeploymentLogRow): DeploymentLog {
  return DeploymentLog.hydrate({
    id: row.id,
    deploymentId: row.deploymentId,
    level: row.level,
    message: row.message,
    timestamp: row.timestamp,
    metadata: (row.metadata as Record<string, unknown> | null) ?? null,
  });
}

export class PrismaServiceDeploymentLogRepository implements DeploymentLogRepository {
  async create(
    deploymentId: string,
    level: string,
    message: string,
    metadata?: Record<string, unknown> | null
  ): Promise<DeploymentLog> {
    const row = await prisma.serviceDeploymentLog.create({
      data: {
        deploymentId,
        level,
        message,
        ...(metadata !== undefined ? { metadata: metadata as Prisma.InputJsonValue } : {}),
      },
    });
    return toDomain(row);
  }

  async listByDeployment(deploymentId: string): Promise<DeploymentLog[]> {
    const rows = await prisma.serviceDeploymentLog.findMany({
      where: { deploymentId },
      orderBy: { timestamp: "asc" },
    });
    return rows.map(toDomain);
  }
}
