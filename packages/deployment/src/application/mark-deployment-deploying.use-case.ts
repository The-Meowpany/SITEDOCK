import { DeploymentRepository } from "../domain/ports";

/** Marks a deployment as "deploying" - the deployment is being processed. */
export class MarkDeploymentDeployingUseCase {
  constructor(private readonly deployments: DeploymentRepository) {}

  async execute(deploymentId: string): Promise<void> {
    const deployment = await this.deployments.findById(deploymentId);
    if (!deployment) {
      throw new Error(`Deployment ${deploymentId} not found`);
    }
    deployment.startBuilding();
    await this.deployments.save(deployment);
  }
}