import { NotFoundError, WebsiteId, WorkspaceId } from "@sitedock/shared";
import { ProjectRepository, WebsiteRepository } from "../domain/ports";

/**
 * Publishes a deployment to production. This use case receives the deployment's
 * status as a parameter rather than reaching into the Deployment repository
 * directly — Website and Deployment are separate aggregates/contexts and only
 * talk through explicit application-level orchestration (docs/ARCHITECTURE.md §68).
 */
export class PublishDeploymentToWebsiteUseCase {
  constructor(private readonly websites: WebsiteRepository) {}

  async execute(params: { websiteId: string; workspaceId: string; deploymentId: string; deploymentStatus: "READY" | "PUBLISHED" }) {
    const website = await this.websites.findByIdInWorkspace(WebsiteId(params.websiteId), WorkspaceId(params.workspaceId));
    if (!website) throw new NotFoundError("Website", params.websiteId);

    website.publish(params.deploymentId, params.deploymentStatus);
    await this.websites.save(website);
  }
}

export class RollbackWebsiteUseCase {
  constructor(private readonly websites: WebsiteRepository) {}

  async execute(params: { websiteId: string; workspaceId: string; targetDeploymentId: string }) {
    const website = await this.websites.findByIdInWorkspace(WebsiteId(params.websiteId), WorkspaceId(params.workspaceId));
    if (!website) throw new NotFoundError("Website", params.websiteId);

    website.rollbackTo(params.targetDeploymentId);
    await this.websites.save(website);
  }
}

export class ListProjectsUseCase {
  constructor(private readonly projects: ProjectRepository) {}

  async execute(workspaceId: string) {
    const list = await this.projects.listByWorkspace(WorkspaceId(workspaceId));
    return list.map((p) => ({ id: p.id, name: p.name, createdAt: p.createdAt }));
  }
}

export class GetWebsiteUseCase {
  constructor(private readonly websites: WebsiteRepository) {}

  async execute(websiteId: string, workspaceId: string) {
    const website = await this.websites.findByIdInWorkspace(WebsiteId(websiteId), WorkspaceId(workspaceId));
    if (!website) throw new NotFoundError("Website", websiteId);
    return {
      id: website.id,
      name: website.name,
      subdomain: website.subdomain,
      status: website.status,
      projectId: website.projectId,
      productionDeploymentId: website.productionDeploymentId,
      clientId: website.clientId,
    };
  }
}

export class ListWebsitesUseCase {
  constructor(private readonly websites: WebsiteRepository) {}

  async execute(workspaceId: string) {
    const list = await this.websites.listByWorkspace(WorkspaceId(workspaceId));
    return list.map((w) => ({
      id: w.id,
      name: w.name,
      subdomain: w.subdomain,
      status: w.status,
      productionDeploymentId: w.productionDeploymentId,
      // Exposed so the API layer can enforce per-client scoping for CLIENT-role members.
      clientId: w.clientId,
    }));
  }
}
