import { NotFoundError, WebsiteId } from "@sitedock/shared";
import { Deployment } from "../domain/deployment.entity";
import { DeploymentRepository } from "../domain/ports";

/**
 * Marks a deployment as PUBLISHED. This is intentionally decoupled from
 * Website.publish() — the interfaces layer (apps/api) orchestrates both calls
 * in the same request so a deployment is never marked PUBLISHED without the
 * website actually pointing at it, and vice versa is avoided by ordering:
 * mark deployment PUBLISHED first, then Website.publish() only accepts
 * READY/PUBLISHED deployments.
 */
export class MarkDeploymentPublishedUseCase {
  constructor(private readonly deployments: DeploymentRepository) {}

  async execute(deploymentId: string, websiteId: string): Promise<void> {
    const deployment = await this.deployments.findByIdForWebsite(deploymentId, WebsiteId(websiteId));
    if (!deployment) throw new NotFoundError("Deployment", deploymentId);

    deployment.publish();
    await this.deployments.save(deployment);
  }
}

export class GetDeploymentUseCase {
  constructor(private readonly deployments: DeploymentRepository) {}

  async execute(deploymentId: string, websiteId: string) {
    const deployment = await this.deployments.findByIdForWebsite(deploymentId, WebsiteId(websiteId));
    if (!deployment) throw new NotFoundError("Deployment", deploymentId);
    return this.toDto(deployment);
  }

  private toDto(d: Deployment) {
    return {
      id: d.id,
      version: d.version,
      status: d.status,
      fileCount: d.fileCount,
      sizeBytes: d.sizeBytes,
      errorMessage: d.errorMessage,
      createdAt: d.createdAt,
      publishedAt: d.publishedAt,
    };
  }
}

export class ListDeploymentsUseCase {
  constructor(private readonly deployments: DeploymentRepository) {}

  async execute(websiteId: string) {
    const list = await this.deployments.listByWebsite(WebsiteId(websiteId));
    return list
      .sort((a, b) => b.version - a.version)
      .map((d) => ({ id: d.id, version: d.version, status: d.status, createdAt: d.createdAt, publishedAt: d.publishedAt }));
  }
}
