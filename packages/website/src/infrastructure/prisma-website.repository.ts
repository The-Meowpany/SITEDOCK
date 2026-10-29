import { prisma } from "@sitedock/database";
import { ClientId, WebsiteId, WorkspaceId } from "@sitedock/shared";
import { Project } from "../domain/project.entity";
import { Website } from "../domain/website.entity";
import { ProjectRepository, WebsiteRepository } from "../domain/ports";

type ProjectRow = { id: string; workspaceId: string; name: string; createdAt: Date };
type WebsiteRow = {
  id: string;
  workspaceId: string;
  projectId: string;
  clientId: string | null;
  name: string;
  subdomain: string;
  status: string;
  productionDeploymentId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

function projectToDomain(row: ProjectRow): Project {
  return Project.hydrate({ id: row.id, workspaceId: WorkspaceId(row.workspaceId), name: row.name, createdAt: row.createdAt });
}

function websiteToDomain(row: WebsiteRow): Website {
  return Website.hydrate({
    id: WebsiteId(row.id),
    workspaceId: WorkspaceId(row.workspaceId),
    projectId: row.projectId,
    clientId: row.clientId === null ? null : ClientId(row.clientId),
    name: row.name,
    subdomain: row.subdomain,
    status: row.status as Website["status"],
    productionDeploymentId: row.productionDeploymentId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

export class PrismaProjectRepository implements ProjectRepository {
  async findByIdInWorkspace(id: string, workspaceId: WorkspaceId): Promise<Project | null> {
    const row = await prisma.project.findFirst({ where: { id, workspaceId } });
    return row ? projectToDomain(row) : null;
  }

  async listByWorkspace(workspaceId: WorkspaceId): Promise<Project[]> {
    const rows = await prisma.project.findMany({ where: { workspaceId }, orderBy: { createdAt: "desc" } });
    return rows.map(projectToDomain);
  }

  async save(project: Project): Promise<void> {
    await prisma.project.upsert({
      where: { id: project.id },
      create: { id: project.id, workspaceId: project.workspaceId, name: project.name },
      update: { name: project.name },
    });
  }
}

export class PrismaWebsiteRepository implements WebsiteRepository {
  async findById(id: WebsiteId): Promise<Website | null> {
    const row = await prisma.website.findUnique({ where: { id } });
    return row ? websiteToDomain(row) : null;
  }

  async findByIdInWorkspace(id: WebsiteId, workspaceId: WorkspaceId): Promise<Website | null> {
    const row = await prisma.website.findFirst({ where: { id, workspaceId } });
    return row ? websiteToDomain(row) : null;
  }

  async findBySubdomain(subdomain: string): Promise<Website | null> {
    const row = await prisma.website.findUnique({ where: { subdomain } });
    return row ? websiteToDomain(row) : null;
  }

  async listByWorkspace(workspaceId: WorkspaceId): Promise<Website[]> {
    const rows = await prisma.website.findMany({ where: { workspaceId }, orderBy: { createdAt: "desc" } });
    return rows.map(websiteToDomain);
  }

  async listByStatus(status: Website["status"]): Promise<Website[]> {
    const rows = await prisma.website.findMany({ where: { status } });
    return rows.map(websiteToDomain);
  }

  async save(website: Website): Promise<void> {
    // Scalar foreign keys (not relation `connect`) are required here: once a
    // relation field exists, Prisma's checked Create/Update inputs drop the
    // scalar FK, so `clientId` is only valid on the Unchecked variants.
    await prisma.website.upsert({
      where: { id: website.id },
      create: {
        id: website.id,
        workspaceId: website.workspaceId,
        projectId: website.projectId,
        clientId: website.clientId,
        name: website.name,
        subdomain: website.subdomain,
        status: website.status,
        productionDeploymentId: website.productionDeploymentId,
      },
      update: {
        clientId: website.clientId,
        name: website.name,
        status: website.status,
        productionDeploymentId: website.productionDeploymentId,
      },
    });
  }
}

