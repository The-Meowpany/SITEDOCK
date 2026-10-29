import { prisma } from "@sitedock/database";
import { ContainerInstance } from "../domain/container-instance.entity";
import { ContainerInstanceRepository } from "../domain/ports";

type ContainerInstanceRow = {
  id: string;
  serviceId: string;
  deploymentId: string | null;
  containerId: string;
  status: string;
  hostPort: number | null;
  containerPort: number;
  startedAt: Date;
  stoppedAt: Date | null;
  restartCount: number;
  lastHealthCheck: Date | null;
};

function toDomain(row: ContainerInstanceRow): ContainerInstance {
  return ContainerInstance.hydrate({
    id: row.id,
    serviceId: row.serviceId,
    deploymentId: row.deploymentId,
    containerId: row.containerId,
    status: row.status as ContainerInstance["status"],
    hostPort: row.hostPort,
    containerPort: row.containerPort,
    startedAt: row.startedAt,
    stoppedAt: row.stoppedAt,
    restartCount: row.restartCount,
    lastHealthCheck: row.lastHealthCheck,
  });
}

export class PrismaContainerInstanceRepository implements ContainerInstanceRepository {
  async findById(id: string): Promise<ContainerInstance | null> {
    const row = await prisma.containerInstance.findUnique({ where: { id } });
    return row ? toDomain(row) : null;
  }

  async findByIdForDeployment(id: string, deploymentId: string): Promise<ContainerInstance | null> {
    const row = await prisma.containerInstance.findFirst({ where: { id, deploymentId } });
    return row ? toDomain(row) : null;
  }

  async listByDeployment(deploymentId: string): Promise<ContainerInstance[]> {
    const rows = await prisma.containerInstance.findMany({
      where: { deploymentId },
      orderBy: { startedAt: "desc" },
    });
    return rows.map(toDomain);
  }

  async listLiveByDeployment(deploymentId: string): Promise<ContainerInstance | null> {
    const row = await prisma.containerInstance.findFirst({
      where: { deploymentId, status: "RUNNING" },
    });
    return row ? toDomain(row) : null;
  }

  async save(instance: ContainerInstance): Promise<void> {
    await prisma.containerInstance.upsert({
      where: { id: instance.id },
      create: {
        id: instance.id,
        serviceId: instance.serviceId,
        deploymentId: instance.deploymentId!,
        containerId: instance.containerId,
        status: instance.status,
        hostPort: instance.hostPort,
        containerPort: instance.containerPort,
        startedAt: instance.startedAt,
        stoppedAt: instance.stoppedAt,
        restartCount: instance.restartCount,
        lastHealthCheck: instance.lastHealthCheck,
      },
      update: {
        deploymentId: instance.deploymentId!,
        containerId: instance.containerId,
        status: instance.status,
        hostPort: instance.hostPort,
        containerPort: instance.containerPort,
        stoppedAt: instance.stoppedAt,
        restartCount: instance.restartCount,
        lastHealthCheck: instance.lastHealthCheck,
      },
    });
  }

  async delete(id: string): Promise<void> {
    await prisma.containerInstance.delete({ where: { id } });
  }
}
