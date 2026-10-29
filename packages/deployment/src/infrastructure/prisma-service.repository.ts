import { prisma } from "@sitedock/database";
import { Service } from "../domain/service.entity";
import { ServiceRepository } from "../domain/ports";

type ServiceRow = {
  id: string;
  projectId: string;
  environmentId?: string | null;
  name: string;
  type: string;
  status: string;
  hostname: string;
  activeDeploymentId: string | null;
  sourceType: string;
  sourceUrl: string | null;
  sourceBranch: string | null;
  sourcePath: string | null;
  dockerfile: string | null;
  contextFiles: unknown;
  buildCommand: string | null;
  startCommand: string | null;
  port: number;
  env: unknown;
  secrets?: unknown;
  cpuLimit: string | null;
  memoryLimit: string | null;
  pidsLimit: number | null;
  readonlyRoot: boolean;
  createdAt: Date;
  updatedAt: Date;
};

function toDomain(row: ServiceRow): Service {
  return Service.hydrate({
    id: row.id,
    projectId: row.projectId,
    environmentId: row.environmentId ?? null,
    name: row.name,
    type: row.type as Service["type"],
    status: row.status as Service["status"],
    hostname: row.hostname,
    activeDeploymentId: row.activeDeploymentId,
    sourceType: row.sourceType,
    sourceUrl: row.sourceUrl,
    sourceBranch: row.sourceBranch,
    sourcePath: row.sourcePath,
    dockerfile: row.dockerfile,
    contextFiles: (row.contextFiles as Record<string, string> | null) ?? null,
    buildCommand: row.buildCommand,
    startCommand: row.startCommand,
    port: row.port,
    env: row.env as Record<string, unknown> | null,
    secrets: (row.secrets as Record<string, unknown> | null) ?? null,
    cpuLimit: row.cpuLimit,
    memoryLimit: row.memoryLimit,
    pidsLimit: row.pidsLimit,
    readonlyRoot: row.readonlyRoot,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

export class PrismaServiceRepository implements ServiceRepository {
  async findById(id: string): Promise<Service | null> {
    const row = await prisma.service.findUnique({ where: { id } });
    return row ? toDomain(row) : null;
  }

  async findByIdForProject(id: string, projectId: string): Promise<Service | null> {
    const row = await prisma.service.findFirst({ where: { id, projectId } });
    return row ? toDomain(row) : null;
  }

  async findByIdForWorkspace(id: string, workspaceId: string): Promise<Service | null> {
    const row = await prisma.service.findFirst({
      where: { id, project: { workspaceId } },
    });
    return row ? toDomain(row) : null;
  }

  async findByHostname(hostname: string): Promise<Service | null> {
    const row = await prisma.service.findUnique({ where: { hostname } });
    return row ? toDomain(row) : null;
  }

  async listByProject(projectId: string): Promise<Service[]> {
    const rows = await prisma.service.findMany({
      where: { projectId },
      orderBy: { createdAt: "desc" },
    });
    return rows.map(toDomain);
  }

  /** Services visible to a workspace (used by the workspace-scoped API). */
  async findByWorkspace(workspaceId: string): Promise<Service[]> {
    const rows = await prisma.service.findMany({
      where: { project: { workspaceId } },
      orderBy: { createdAt: "desc" },
    });
    return rows.map(toDomain);
  }

  async getNextVersion(_projectId: string): Promise<number> {
    // Services don't have versions - deployments do
    return 1;
  }

  async save(service: Service): Promise<void> {
    await prisma.service.upsert({
      where: { id: service.id },
      create: {
        id: service.id,
        projectId: service.projectId,
        environmentId: service.environmentId ?? null,
        name: service.name,
        type: service.type as never,
        status: service.status as never,
        hostname: service.hostname,
        activeDeploymentId: service.activeDeploymentId,
        sourceType: service.sourceType,
        sourceUrl: service.sourceUrl,
        sourceBranch: service.sourceBranch,
        sourcePath: service.sourcePath,
        dockerfile: service.dockerfile,
        contextFiles: service.contextFiles as unknown as Parameters<typeof prisma.service.upsert>[0]["create"]["contextFiles"],
        buildCommand: service.buildCommand,
        startCommand: service.startCommand,
        port: service.port,
        env: service.env as unknown as Parameters<typeof prisma.service.upsert>[0]["create"]["env"],
        secrets: (service.secrets ?? null) as unknown as Parameters<typeof prisma.service.upsert>[0]["create"]["secrets"],
        cpuLimit: service.cpuLimit,
        memoryLimit: service.memoryLimit,
        pidsLimit: service.pidsLimit,
        readonlyRoot: service.readonlyRoot,
      },
      update: {
        environmentId: service.environmentId ?? null,
        name: service.name,
        type: service.type as never,
        status: service.status as never,
        hostname: service.hostname,
        activeDeploymentId: service.activeDeploymentId,
        sourceType: service.sourceType,
        sourceUrl: service.sourceUrl,
        sourceBranch: service.sourceBranch,
        sourcePath: service.sourcePath,
        dockerfile: service.dockerfile,
        contextFiles: service.contextFiles as unknown as Parameters<typeof prisma.service.upsert>[0]["create"]["contextFiles"],
        buildCommand: service.buildCommand,
        startCommand: service.startCommand,
        port: service.port,
        env: service.env as unknown as Parameters<typeof prisma.service.upsert>[0]["create"]["env"],
        secrets: (service.secrets ?? null) as unknown as Parameters<typeof prisma.service.upsert>[0]["create"]["secrets"],
        cpuLimit: service.cpuLimit,
        memoryLimit: service.memoryLimit,
        pidsLimit: service.pidsLimit,
        readonlyRoot: service.readonlyRoot,
      },
    });
  }
}
