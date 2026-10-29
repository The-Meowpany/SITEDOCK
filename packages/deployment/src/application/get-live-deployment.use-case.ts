import { Deployment } from "../domain/deployment.entity";
import { WebsiteId } from "@sitedock/shared";
import { DeploymentRepository } from "../domain/ports";

/** Gets a live (published) deployment for a website. */
export class GetLiveDeploymentUseCase {
  constructor(private readonly deployments: DeploymentRepository) {}

  async execute(websiteId: string): Promise<Deployment | null> {
    const deployments = await this.deployments.listByWebsite(WebsiteId(websiteId));
    const live = deployments.find((d) => d.status === "PUBLISHED");
    return live ?? null;
  }
}